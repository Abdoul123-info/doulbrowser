import { app, shell, BrowserWindow, ipcMain, dialog, Notification, session } from 'electron'
import type { DownloadItem } from 'electron'
import { join, basename, dirname } from 'path'
import { existsSync, promises as fsPromises, readFileSync, writeFileSync } from 'fs'
import * as fs from 'fs'
import { spawn, execSync } from 'child_process'
import { URL } from 'url'
import { createServer } from 'http'
import * as https from 'https'
import icon from '../../resources/icon.png?asset'
import { pluginManager } from './plugins/manager'

// DEBUG REMOVE
// console.log('Electron require:', require('electron'));

// SIMPLIFIED FIX: Minimal flags to avoid TikTok detection
// Remove aggressive flags that might trigger anti-bot systems
// Minimal flags to avoid TikTok detection
// Ensure app is defined before using it (Electron initialization safety)
if (app) {
  try {
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
    app.commandLine.appendSwitch('disable-site-isolation-trials')

    const USER_AGENT =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    app.userAgentFallback = USER_AGENT
  } catch (e) {
    console.error('Failed to set app flags:', e)
  }
} else {
  console.error('CRITICAL: Electron app object is undefined at startup!')
}

// Store active downloads
interface DownloadTracker {
  item: DownloadItem | null
  url: string
  startTime: number
  lastBytes: number
  lastTime: number
  savePath?: string
  isYouTube?: boolean
  headers?: Record<string, string> // Store headers
  // For yt-dlp based downloads
  process?: any
  cancelled?: boolean
  paused?: boolean
  lastProgress?: number // Store last known progress percentage
  // For multi-threaded downloads
  httpRequests?: Array<{ destroy: () => void }> // Store HTTP requests to cancel them
  // Queue management
  priority?: number // Higher number = higher priority
  retryCount?: number // Number of retry attempts
  maxRetries?: number // Maximum retry attempts
  audioOnly?: boolean // New flag
  filename?: string // Explicit filename if provided
  strategy?: 'yt-dlp' | 'direct' | 'electron'
  logs?: string[] // Technical logs for debugging (v1.0.8)
}

const activeDownloads = new Map<string, DownloadTracker>()

// Queue system for managing downloads
interface QueuedDownload {
  url: string
  savePath?: string
  filename?: string
  type?: string
  mimeType?: string
  headers?: Record<string, string> // Store headers
  priority: number
  retryCount: number
  maxRetries: number
  mainWindow: BrowserWindow
  audioOnly?: boolean // New flag
}

const downloadQueue: QueuedDownload[] = []
let maxConcurrentDownloads = 3 // Default: 3 téléchargements simultanés
let activeDownloadCount = 0 // Nombre de téléchargements actuellement actifs

// Interface pour les paramètres de l'application
interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  maxRetries: number
  autoStart: boolean
  notifications: boolean
  soundNotifications: boolean
  language: string
}

// Chemin du fichier de paramètres
const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

// Charger les paramètres
function loadSettings(): AppSettings {
  const defaultSettings: AppSettings = {
    downloadPath: app.getPath('downloads'),
    maxConcurrentDownloads: 3,
    maxRetries: 3,
    autoStart: false,
    notifications: true,
    soundNotifications: false,
    language: 'fr'
  }

  try {
    const settingsPath = getSettingsPath()
    if (existsSync(settingsPath)) {
      const data = readFileSync(settingsPath, 'utf-8')
      const loaded = JSON.parse(data)
      // Merger avec les paramètres par défaut pour les nouvelles propriétés
      return { ...defaultSettings, ...loaded }
    }
  } catch (error) {
    console.error('Error loading settings:', error)
  }

  return defaultSettings
}

// Sauvegarder les paramètres
function saveSettings(settings: Partial<AppSettings>) {
  try {
    const currentSettings = loadSettings()
    const newSettings = { ...currentSettings, ...settings }
    const settingsPath = getSettingsPath()
    writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8')

    // Appliquer les paramètres immédiatement
    if (settings.maxConcurrentDownloads !== undefined) {
      maxConcurrentDownloads = settings.maxConcurrentDownloads
      processDownloadQueue() // Traiter la queue avec la nouvelle limite
    }
    if (settings.downloadPath !== undefined) {
      // Le chemin sera utilisé lors des prochains téléchargements
    }

    return newSettings
  } catch (error) {
    console.error('Error saving settings:', error)
    return null
  }
}

// Initialiser avec des paramètres par défaut au niveau module
let appSettings: AppSettings = {
  downloadPath: '', // Sera initialisé dans app.whenReady()
  maxConcurrentDownloads: 3,
  maxRetries: 3,
  autoStart: false,
  notifications: true,
  soundNotifications: false,
  language: 'fr'
}

// Charger les vraies valeurs quand l'app est prête
// Charger les vraies valeurs dans le bloc principal app.whenReady

// Fonction pour envoyer des notifications système
function sendNotification(title: string, body: string, sound: boolean = false) {
  if (!appSettings.notifications) return

  // Vérifier si les notifications sont supportées
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: !sound || !appSettings.soundNotifications
    })
    notification.show()
  }
}

// Serveur HTTP pour communiquer avec l'extension de navigateur
let extensionServer: any = null
const EXTENSION_PORT = 8765

// AUTO-UPDATE YT-DLP
// Function to check and update yt-dlp automatically
async function autoUpdateYtDlp(): Promise<void> {
  try {
    console.log('[yt-dlp] Checking for updates...')

    const https = require('https')
    const userDataPath = app.getPath('userData')

    // v20: Platform-aware binary detection
    const platform = process.platform
    const isMac = platform === 'darwin'
    const isWindows = platform === 'win32'

    const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp'
    const targetPath = join(userDataPath, binaryName)

    // Download URL based on platform
    let downloadUrl: string
    if (isWindows) {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    } else if (isMac) {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    } else {
      // Linux
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
    }

    console.log(`[yt-dlp] Platform: ${platform}, Binary: ${binaryName}`)

    const downloadFile = async (url: string, dest: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest)
        https
          .get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
              file.close()
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              const redirectUrl = response.headers.location
              if (redirectUrl) {
                downloadFile(redirectUrl, dest).then(resolve).catch(reject)
              } else {
                reject(new Error('Redirect location missing'))
              }
              return
            }
            if (response.statusCode !== 200) {
              file.close()
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              reject(new Error(`Failed to download: ${response.statusCode}`))
              return
            }
            response.pipe(file)
            file.on('finish', () => {
              file.close()
              // Make executable on Unix systems
              if (!isWindows) {
                try {
                  fs.chmodSync(dest, 0o755)
                } catch (e) {
                  console.warn('[yt-dlp] Could not set executable permission:', e)
                }
              }
              resolve()
            })
            file.on('error', (err) => {
              file.close()
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              reject(err)
            })
          })
          .on('error', (err) => {
            file.close()
            if (fs.existsSync(dest)) fs.unlinkSync(dest)
            reject(err)
          })
      })
    }

    const ytDlpPath = ensureYtDlpAvailable()
    if (!ytDlpPath) {
      console.log('[yt-dlp] Not found. Performing initial installation...')
      await downloadFile(downloadUrl, targetPath)
      console.log('[yt-dlp] Initial installation successful')
      return
    }

    const getCurrentVersion = (): Promise<string> => {
      return new Promise((resolve) => {
        const proc = spawn(ytDlpPath as string, ['--version'])
        let version = ''
        proc.stdout.on('data', (data) => {
          version += data.toString().trim()
        })
        proc.on('close', () => {
          resolve(version || 'unknown')
        })
        setTimeout(() => {
          proc.kill()
          resolve('unknown')
        }, 5000)
      })
    }

    const currentVersion = await getCurrentVersion()
    const getLatestVersion = (): Promise<string> => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.github.com',
          path: '/repos/yt-dlp/yt-dlp/releases/latest',
          headers: { 'User-Agent': 'DoulBrowser' }
        }
        https
          .get(options, (res) => {
            let data = ''
            res.on('data', (chunk) => (data += chunk))
            res.on('end', () => {
              try {
                resolve(JSON.parse(data).tag_name || 'unknown')
              } catch (e) {
                reject(e)
              }
            })
          })
          .on('error', reject)
      })
    }

    const latestVersion = await getLatestVersion()
    if (currentVersion === latestVersion) {
      console.log('[yt-dlp] Already up to date')
      return
    }

    console.log(`[yt-dlp] New version available: ${latestVersion}`)
    const tempPath = targetPath + '.tmp'
    console.log('[yt-dlp] Downloading update...')
    await downloadFile(downloadUrl, tempPath)

    if (existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath)
      } catch (err: any) {
        if (err.code === 'EPERM' || err.code === 'EBUSY') {
          console.warn('[yt-dlp] Binary is locked, will attempt replacement on next start')
          return
        }
        throw err
      }
    }

    try {
      fs.renameSync(tempPath, targetPath)
    } catch (err: any) {
      console.warn('[yt-dlp] Could not rename update, binary likely in use:', err.message)
      return
    }

    console.log(`[yt-dlp] Successfully updated to ${latestVersion} at ${targetPath}`)
    sendNotification('yt-dlp mis à jour', `Version ${latestVersion} installée`, false)
  } catch (error) {
    console.error('[yt-dlp] Auto-update failed:', error)
  }
}

// UTILITY: Ensure yt-dlp is available (check bundled or user data)
function ensureYtDlpAvailable(): string | null {
  const userDataPath = app.getPath('userData')
  const platform = process.platform
  const binaryName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'

  // Check in user data directory first
  const userDataBinary = join(userDataPath, binaryName)
  if (existsSync(userDataBinary)) {
    return userDataBinary
  }

  // Check in system PATH (fallback)
  try {
    const which = platform === 'win32' ? 'where' : 'which'
    const result = execSync(`${which} yt-dlp`, { encoding: 'utf8' }).trim()
    if (result) {
      console.log('[yt-dlp] Found in system PATH:', result)
      return result.split('\n')[0]
    }
  } catch (_e) {
    console.log('[yt-dlp] Not found in system PATH')
  }

  console.warn('[yt-dlp] Not found.')
  return null
}

// UTILITY + AUTO-DOWNLOAD: Ensure FFmpeg is available
async function ensureFfmpegAvailable(win?: BrowserWindow): Promise<string | null> {
  const userDataPath = app.getPath('userData')
  const platform = process.platform
  const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

  // 1. Check in user data directory
  const userDataBinary = join(userDataPath, binaryName)
  if (existsSync(userDataBinary)) {
    return userDataBinary
  }

  // 2. Check in system PATH (Homebrew on macOS, or manual install)
  try {
    const which = platform === 'win32' ? 'where' : 'which'
    const result = execSync(`${which} ffmpeg`, { encoding: 'utf8' }).trim()
    if (result) {
      console.log('[FFmpeg] Found in system PATH:', result)
      return result.split('\\n')[0]
    }
  } catch (_e) {
    console.log('[FFmpeg] Not found in system PATH')
  }

  // 3. AUTO-DOWNLOAD for macOS (portable mode)
  if (platform === 'darwin') {
    console.log('[FFmpeg] Not found. Downloading for macOS...')
    try {
      const targetPath = join(userDataPath, 'ffmpeg')

      const downloadFile = (url: string, dest: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(dest)
          https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
              file.close()
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              const redirectUrl = response.headers.location
              if (redirectUrl) {
                downloadFile(redirectUrl, dest).then(resolve).catch(reject)
              } else {
                reject(new Error('Redirect location missing'))
              }
              return
            }
            if (response.statusCode !== 200) {
              file.close()
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              reject(new Error(`Failed to download: ${response.statusCode}`))
              return
            }
            response.pipe(file)
            file.on('finish', () => {
              file.close()
              fs.chmodSync(dest, 0o755) // Make executable
              resolve()
            })
            file.on('error', (err) => {
              file.close()
              if (fs.existsSync(dest)) fs.unlinkSync(dest)
              reject(err)
            })
          }).on('error', (err) => {
            file.close()
            if (fs.existsSync(dest)) fs.unlinkSync(dest)
            reject(err)
          })
        })
      }

      // Download FFmpeg binary for macOS from GitHub (single static binary)
      const githubUrl = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/darwin-x64'
      await downloadFile(githubUrl, targetPath)
      console.log('[FFmpeg] Successfully downloaded for macOS at:', targetPath)

      if (win) {
        win.webContents.send('notification', {
          title: 'FFmpeg téléchargé',
          body: 'FFmpeg a été installé automatiquement'
        })
      }

      return targetPath
    } catch (error) {
      console.error('[FFmpeg] Auto-download failed:', error)
      console.log('[FFmpeg] macOS/Linux: Please install ffmpeg via Homebrew or package manager')
      console.log('[FFmpeg] macOS: brew install ffmpeg')
      console.log('[FFmpeg] Linux: sudo apt install ffmpeg (Debian/Ubuntu) or sudo yum install ffmpeg (RHEL/CentOS)')
      return null
    }
  }

  // For Windows or if macOS download fails, show manual install instructions
  console.log('[FFmpeg] Not found.')
  console.log('[FFmpeg] macOS/Linux: Please install ffmpeg via Homebrew or package manager')
  console.log('[FFmpeg] macOS: brew install ffmpeg')
  console.log('[FFmpeg] Linux: sudo apt install ffmpeg (Debian/Ubuntu) or sudo yum install ffmpeg (RHEL/CentOS)')
  return null
}

// Helper to ensure Node.js is available for YouTube "n" challenge solving
async function ensureNodeAvailable(win?: BrowserWindow): Promise<string | null> {
  const userDataPath = app.getPath('userData')
  const nodeBinary = process.platform === 'win32' ? 'node.exe' : 'node'
  const targetPath = join(userDataPath, nodeBinary)

  try {
    if (existsSync(targetPath)) return targetPath
  } catch (e) { }

  if (process.platform === 'darwin') {
    console.log('[Node.js] Not found. Downloading portable Node.js v18 for signature solving...')
    // Node 18 is more compatible with older Big Sur versions
    const downloadUrl = 'https://nodejs.org/dist/v18.20.0/node-v18.20.0-darwin-x64.tar.gz'
    const tempTarPath = targetPath + '.tar.gz'

    try {
      const download = async (url: string, dest: string): Promise<any> => {
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(dest)
          https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
              download(response.headers.location!, dest).then(resolve).catch(reject)
              return
            }
            response.pipe(file)
            file.on('finish', () => {
              file.close()
              resolve(true)
            })
          }).on('error', (err) => {
            fs.unlink(dest, () => { })
            reject(err)
          })
        })
      }

      await download(downloadUrl, tempTarPath)
      console.log('[Node.js] Downloaded tar.gz (v18), extracting...')

      execSync(`tar -xzf "${tempTarPath}" -C "${userDataPath}" --strip-components 2 "node-v18.20.0-darwin-x64/bin/node"`)
      fs.unlinkSync(tempTarPath)

      if (fs.existsSync(targetPath)) {
        fs.chmodSync(targetPath, 0o755)
        console.log('[Node.js] Portable Node.js v18 installed at:', targetPath)
        return targetPath
      }
    } catch (error) {
      console.error('[Node.js] Auto-download/Extraction failed:', error)
    }
  }

  return null
}

function createWindow(): void {
  console.log('[DEBUG] createWindow() called')
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: !app.isPackaged, // Show immediately in dev to debug loading issues
    title: 'DoulBrowser',
    autoHideMenuBar: true,
    icon: icon, // Utiliser l'icône pour toutes les plateformes
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false, // CRITICAL: Disable web security to bypass CORS/CSP on TikTok
      allowRunningInsecureContent: true,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required' // Allow autoplay without interaction
    }
  })

  // [DEBUG] Add loaders error tracking
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[DEBUG] Failed to load URL: ${validatedURL}, Error: ${errorDescription} (${errorCode})`
      )
    }
  )

  // Use render-process-gone instead of deprecated crashed
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[DEBUG] Renderer process gone! Reason: ${details.reason}, ExitCode: ${details.exitCode}`
    )
  })

  mainWindow.webContents.on('dom-ready', () => {
    console.log('[DEBUG] DOM is ready')
  })

  mainWindow.on('ready-to-show', () => {
    console.log('[DEBUG] Window ready-to-show event fired')
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  console.log('[DEBUG] app.isPackaged:', app.isPackaged)
  console.log('[DEBUG] ELECTRON_RENDERER_URL:', process.env['ELECTRON_RENDERER_URL'])

  // Load the remote URL for development or the local html file for production.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    console.log('[DEBUG] Detected Dev Mode - Loading URL:', process.env['ELECTRON_RENDERER_URL'])
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // Open DevTools immediately in dev mode
    mainWindow.webContents.openDevTools()
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    console.log('[DEBUG] Detected Prod Mode - Loading File:', htmlPath)
    mainWindow.loadFile(htmlPath)
  }

  // Activer l'extension de capture de téléchargements (style IDM)

  // Handle downloads
  mainWindow.webContents.session.on('will-download', (_event, item, _webContents) => {
    const url = item.getURL()
    const now = Date.now()

    // Create tracker for this download
    const tracker: DownloadTracker = {
      item,
      url,
      startTime: now,
      lastBytes: 0,
      lastTime: now
    }

    activeDownloads.set(url, tracker)

    item.on('updated', (_event, state) => {
      const tracker = activeDownloads.get(url)
      if (!tracker) return

      const now = Date.now()
      const receivedBytes = item.getReceivedBytes()
      const totalBytes = item.getTotalBytes()

      if (state === 'interrupted') {
        mainWindow.webContents.send('download-progress', {
          filename: item.getFilename(),
          url: item.getURL(),
          progress: totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0,
          receivedBytes,
          totalBytes,
          state: 'interrupted',
          canResume: item.canResume()
        })
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          mainWindow.webContents.send('download-progress', {
            filename: item.getFilename(),
            url: item.getURL(),
            progress: totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0,
            receivedBytes,
            totalBytes,
            state: 'paused',
            speed: 0,
            timeLeft: '--'
          })
        } else {
          // Calculate speed
          const timeDiff = (now - tracker.lastTime) / 1000 // seconds
          const bytesDiff = receivedBytes - tracker.lastBytes
          const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0 // bytes per second

          // Calculate time left
          const remainingBytes = totalBytes - receivedBytes
          const timeLeft = speed > 0 ? remainingBytes / speed : Infinity
          const timeLeftStr = timeLeft === Infinity ? '--' : formatTime(timeLeft)

          const progress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0

          // Update tracker
          tracker.lastBytes = receivedBytes
          tracker.lastTime = now
          tracker.lastProgress = Math.round(progress) // Store progress for pause

          mainWindow.webContents.send('download-progress', {
            filename: item.getFilename(),
            url: item.getURL(),
            progress,
            receivedBytes,
            totalBytes,
            state: 'downloading',
            speed,
            timeLeft: timeLeftStr
          })
        }
      }
    })

    item.once('done', (_event, state) => {
      const tracker = activeDownloads.get(url)
      if (tracker) {
        tracker.savePath = item.getSavePath()
        if (state === 'completed') {
          mainWindow.webContents.send('download-complete', {
            filename: item.getFilename(),
            url: item.getURL(),
            state: 'finished',
            savePath: item.getSavePath()
          })
        } else {
          mainWindow.webContents.send('download-complete', {
            filename: item.getFilename(),
            url: item.getURL(),
            state: state === 'cancelled' ? 'cancelled' : 'error',
            savePath: item.getSavePath()
          })
        }
        // Keep tracker for a while to allow opening folder, then remove
        setTimeout(() => activeDownloads.delete(url), 60000)
      }
    })
  })
}

function formatTime(seconds: number): string {
  if (seconds === Infinity || isNaN(seconds)) return '--'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs} s`
  } else if (minutes > 0) {
    return `${minutes}m ${secs} s`
  } else {
    return `${secs} s`
  }
}

// Check if URL is a supported social media platform
function isSocialMediaURL(url: string): { isSocial: boolean; platform: string } {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // CRITICAL FIX: If the URL is a direct file (mp4, m3u8, etc.) OR a CDN link, treat it as a direct download.
    // This allows the "Network Sniffer" strategy to work by bypassing yt-dlp for direct links.

    // 1. Check file extensions in path
    // EXCEPTION: Do not treat as direct download if it's a known social CDN (fbcdn, tiktokcdn)
    // This allows yt-dlp to handle headers/cookies for these platforms.
    if (
      urlObj.pathname.match(/\.(mp4|webm|mkv|avi|mov|m3u8|ts)$/i) &&
      !hostname.includes('fbcdn.net') &&
      !hostname.includes('tiktokcdn') &&
      !hostname.includes('webapp-prime.tiktok.com')
    ) {
      return { isSocial: false, platform: '' }
    }

    // 2. Check query parameters for mime types (common in TikTok/FB CDNs)
    if (url.includes('mime_type=video_mp4') || url.includes('mime_type=video/mp4')) {
      return { isSocial: false, platform: '' }
    }

    // 3. Check for specific CDN subdomains that are definitely NOT user pages
    if (hostname.includes('googlevideo.com')) {
      // YouTube CDN
      return { isSocial: false, platform: '' }
    }

    // YouTube
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return { isSocial: true, platform: 'YouTube' }
    }
    // Facebook
    if (
      hostname.includes('facebook.com') ||
      hostname.includes('fb.com') ||
      hostname.includes('fb.watch') ||
      hostname.includes('fbcdn.net')
    ) {
      return { isSocial: true, platform: 'Facebook' }
    }
    // Instagram
    if (hostname.includes('instagram.com')) {
      return { isSocial: true, platform: 'Instagram' }
    }
    // TikTok
    if (
      hostname.includes('tiktok.com') ||
      hostname.includes('vm.tiktok.com') ||
      hostname.includes('tiktokcdn') ||
      hostname.includes('webapp-prime.tiktok.com')
    ) {
      return { isSocial: true, platform: 'TikTok' }
    }
    // Twitter/X
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return { isSocial: true, platform: 'Twitter' }
    }
    // Reddit
    if (hostname.includes('reddit.com') || hostname.includes('redd.it')) {
      return { isSocial: true, platform: 'Reddit' }
    }
    // Vimeo
    if (hostname.includes('vimeo.com')) {
      return { isSocial: true, platform: 'Vimeo' }
    }
    // Dailymotion
    if (hostname.includes('dailymotion.com')) {
      return { isSocial: true, platform: 'Dailymotion' }
    }
    // Xvideos
    if (hostname.includes('xvideos.com') || hostname.includes('xvideos2.com')) {
      return { isSocial: true, platform: 'Xvideos' }
    }
    // Twitch
    if (hostname.includes('twitch.tv')) {
      return { isSocial: true, platform: 'Twitch' }
    }

    return { isSocial: false, platform: '' }
  } catch {
    return { isSocial: false, platform: '' }
  }
}

// Fonction pour télécharger ffmpeg automatiquement
// Fonction de téléchargement multi-threaded à la IDM pour fichiers directs
async function downloadWithMultiThreading(url: string, savePath: string, win: BrowserWindow) {
  try {
    const https = require('https')
    const http = require('http')
    const urlObj = new URL(url)
    const protocol = urlObj.protocol === 'https:' ? https : http
    const numThreads = 8 // Nombre de connexions parallèles (comme IDM)

    // Get headers from tracker
    const tracker = activeDownloads.get(url)
    const requestHeaders = tracker?.headers || {}

    // Étape 1: Obtenir la taille du fichier et vérifier le support Range
    const fileInfo = await new Promise<{
      size: number
      supportsRange: boolean
      filename: string
      mimeType: string
    }>((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...requestHeaders // Inject captured headers
        }
      }

      const req = protocol.request(options, (res: any) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve({
            size: 0,
            supportsRange: false,
            filename: 'download',
            mimeType: 'application/octet-stream' // fallback
          })
          return
        }

        if (res.statusCode >= 400) {
          // If 403 or similar, we might want to trigger fallback immediately
          reject(new Error(`HTTP Status ${res.statusCode}`))
          return
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10)
        const acceptsRanges = res.headers['accept-ranges'] === 'bytes'
        const contentDisposition = res.headers['content-disposition'] || ''

        // Extraire le nom de fichier depuis Content-Disposition ou URL
        let filename = urlObj.pathname.split('/').pop() || 'download'
        if (contentDisposition) {
          const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
          if (match) {
            filename = match[1].replace(/['"]/g, '')
          }
        }

        resolve({
          size: contentLength,
          supportsRange: acceptsRanges,
          filename: decodeURIComponent(filename),
          mimeType: res.headers['content-type'] || ''
        })
      })

      req.on('error', reject)
      req.setTimeout(10000, () => {
        req.destroy()
        reject(new Error('Timeout getting file info'))
      })
      req.end()
    })

    // Check content type to avoid downloading HTML pages
    if (
      fileInfo.mimeType &&
      (fileInfo.mimeType.includes('text/html') || fileInfo.mimeType.includes('application/json'))
    ) {
      console.warn('Detected invalid content type:', fileInfo.mimeType)
      throw new Error(`Invalid content type: ${fileInfo.mimeType}. Likely an error page.`)
    }

    if (!fileInfo.supportsRange || fileInfo.size === 0) {
      // FALLBACK: Téléchargement simple en flux unique AVEC LES HEADERS
      const fs = require('fs')
      const filePath = join(savePath, fileInfo.filename || 'download.mp4')
      const fileStream = fs.createWriteStream(filePath)

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...requestHeaders
        }
      }

      const req = protocol.request(options, (res: any) => {
        if (res.statusCode >= 400) {
          fileStream.close()
          fs.unlink(filePath, () => { })
          throw new Error(`HTTP ${res.statusCode} during single stream download`)
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0

        res.pipe(fileStream)

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          const tracker = activeDownloads.get(url)
          if (tracker && !tracker.paused && !tracker.cancelled) {
            const progress = totalSize > 0 ? (downloaded / totalSize) * 100 : 0
            const speed =
              (downloaded - tracker.lastBytes) / ((Date.now() - tracker.lastTime) / 1000)
            tracker.lastProgress = Math.round(progress)
            tracker.lastBytes = downloaded
            tracker.lastTime = Date.now()

            win.webContents.send('download-progress', {
              url,
              progress: tracker.lastProgress,
              receivedBytes: downloaded,
              totalBytes: totalSize,
              state: 'downloading',
              speed: speed,
              timeLeft: '--',
              originalUrl: url,
              canResume: true
            })
          }
        })

        fileStream.on('finish', () => {
          fileStream.close()
          handleDownloadEnd(url)
          win.webContents.send('download-complete', { url, filePath })
        })

        fileStream.on('error', (err: any) => {
          fs.unlink(filePath, () => { })
          win.webContents.send('download-error', { url, error: err.message })
        })
      })

      req.on('error', (err: any) => {
        win.webContents.send('download-error', { url, error: err.message })
      })
      req.end()
      return
    }

    // Étape 2: Diviser le fichier en segments et télécharger en parallèle
    const segmentSize = Math.ceil(fileInfo.size / numThreads)
    const filePath = join(savePath, fileInfo.filename)
    const segmentBuffers: Buffer[] = new Array(numThreads)

    await Promise.all(
      Array.from({ length: numThreads }, async (_, index) => {
        return new Promise<void>((resolve, reject) => {
          const start = index * segmentSize
          const end = index === numThreads - 1 ? fileInfo.size - 1 : start + segmentSize - 1

          const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
              Range: `bytes = ${start} -${end} `,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...requestHeaders
            }
          }

          const chunks: Buffer[] = []
          const req = protocol.request(options, (res: any) => {
            const trackerStart = activeDownloads.get(url)
            if (trackerStart?.paused || trackerStart?.cancelled) {
              req.destroy()
              resolve()
              return
            }

            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode} for segment ${index}`))
              return
            }

            res.on('data', (chunk: Buffer) => {
              const trackerData = activeDownloads.get(url)
              if (trackerData?.paused || trackerData?.cancelled) {
                req.destroy()
                resolve()
                return
              }
              chunks.push(chunk)

              const tracker = activeDownloads.get(url)
              if (tracker && !tracker.paused && !tracker.cancelled) {
                // Calculate global progress
                // For simplicity, we just add this chunk to tracker
                // But strictly we should sum all segments.
                // We'll rely on global tracking in IDM style later or approximate here.
                // For now, let's just trigger progress update
                tracker.lastBytes += chunk.length

                // Calculate progress based on total size
                const progress = (tracker.lastBytes / fileInfo.size) * 100
                tracker.lastProgress = Math.min(Math.round(progress), 100) // Caps at 100%

                // Speed calculation based on time elapsed since chunk received
                const now = Date.now()
                const elapsedSinceLast = (now - tracker.lastTime + 1) / 1000
                const speed = chunk.length / elapsedSinceLast
                tracker.lastTime = now

                win.webContents.send('download-progress', {
                  filename: fileInfo.filename,
                  url: url,
                  progress: tracker.lastProgress,
                  receivedBytes: tracker.lastBytes,
                  totalBytes: fileInfo.size,
                  state: 'downloading',
                  speed: speed, // Placeholder
                  timeLeft: '--',
                  originalUrl: url,
                  canResume: true
                })
              }
            })

            res.on('end', () => {
              const trackerEnd = activeDownloads.get(url)
              if (trackerEnd?.paused || trackerEnd?.cancelled) {
                resolve()
                return
              }
              segmentBuffers[index] = Buffer.concat(chunks)
              resolve()
            })

            res.on('error', reject)
          })

          req.on('error', reject)
          req.end()
        })
      })
    )

    const trackerFinal = activeDownloads.get(url)
    if (trackerFinal?.cancelled) {
      win.webContents.send('download-cancelled', { url })
      handleDownloadEnd(url)
      return
    }
    if (trackerFinal?.paused) return

    const finalBuffer = Buffer.concat(segmentBuffers)
    await fsPromises.writeFile(filePath, finalBuffer)

    win.webContents.send('download-complete', {
      filename: fileInfo.filename,
      url: url,
      state: 'finished',
      savePath: filePath
    })
    sendNotification(
      'Téléchargement terminé',
      `${fileInfo.filename} a été téléchargé avec succès`,
      true
    )
    handleDownloadEnd(url)
  } catch (error: any) {
    console.error('Multi-threaded download error:', error)

    console.log('Falling back to yt-dlp with headers...')
    const tracker = activeDownloads.get(url)
    if (tracker) {
      tracker.strategy = 'yt-dlp'
      win.webContents.send('download-status', { url, status: 'Falling back to safe mode...' })
      // Retry with yt-dlp using captured headers
      await downloadWithYtDlp(url, savePath, 'Generic', win)
      return
    }

    win.webContents.send('download-error', { url, error: error.message || 'Download failed' })
    handleDownloadEnd(url)
  }
}

// Helper to get video info (formats) - V22 Signature Solver Support
async function fetchVideoInfo(
  url: string,
  requestHeaders: Record<string, string> = {}
): Promise<any> {
  const runYtDlp = (useCookies: boolean) => {
    return new Promise((resolve, reject) => {
      const ytDlpPath = ensureYtDlpAvailable()
      if (!ytDlpPath) return reject(new Error('yt-dlp not found'))

      const args = ['--dump-json', '--no-warnings', '--no-check-certificates', url]

      // v22: Signature solving support (inject Node path)
      const env = { ...process.env }
      const platform = process.platform
      if (platform === 'darwin') {
        env['PATH'] = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH}`
      }

      if (useCookies && requestHeaders['Cookie']) {
        args.push('--add-header', `Cookie:${requestHeaders['Cookie']}`)
        if (requestHeaders['User-Agent']) {
          args.push('--user-agent', requestHeaders['User-Agent'])
        }
      }

      const cp = spawn(ytDlpPath, args, { env })
      let stdout = ''
      let stderr = ''

      cp.stdout.on('data', (data) => (stdout += data.toString()))
      cp.stderr.on('data', (data) => (stderr += data.toString()))

      cp.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout))
          } catch (e) {
            reject(new Error('Failed to parse yt-dlp output'))
          }
        } else {
          reject(new Error(stderr || `yt-dlp exited with code ${code}`))
        }
      })
    })
  }

  try {
    return await runYtDlp(true)
  } catch (error) {
    console.log('[fetchVideoInfo] Failed with cookies, retrying without...')
    return await runYtDlp(false)
  }
}

async function startDownloadFromQueue(queuedItem: QueuedDownload) {
  const { url, savePath, mainWindow } = queuedItem

  // Vérifier si le téléchargement existe déjà
  if (activeDownloads.has(url)) {
    console.log('Download already active:', url)
    return
  }

  try {
    const downloadPath = savePath || appSettings.downloadPath

    // USE PLUGIN SYSTEM
    const plugin = pluginManager.getPlugin(url)

    // Default Routing Logic (if no plugin found)
    let strategy = 'direct'
    let platformName = 'Direct'

    if (plugin) {
      console.log(`[DEBUG] Plugin Matched: ${plugin.name} `)
      strategy = plugin.getStrategy(url)
      platformName = plugin.name

      // Optional: prepare context (headers)
      if (plugin.prepare) {
        const context = await plugin.prepare({
          url,
          headers: queuedItem.headers,
          savePath: downloadPath
        })
        queuedItem.headers = context.headers // Update headers if modified
      }
    } else {
      // Fallback to legacy isSocialMediaURL check for non-plugin sites
      const { isSocial, platform } = isSocialMediaURL(url)
      if (isSocial) {
        strategy = 'yt-dlp'
        platformName = platform
      } else {
        // Check for likely video types
        const isDirectVideoLink =
          queuedItem.mimeType?.includes('video/') ||
          queuedItem.mimeType?.includes('application/octet-stream') ||
          url.match(/\.(mp4|webm|m4v|mkv|avi|mov|flv|wmv|ts|m3u8)(\?|$)/i) ||
          url.includes('/video/')

        if (isDirectVideoLink) {
          // For unknown direct video links, multi-threading is usually good unless it's a stream
          // But let's stick to default 'direct' (multi-threading)
          strategy = 'direct'
        }
      }
    }

    console.log(
      `[DEBUG] Routing decision for ${url}: Strategy = ${strategy}, Platform = ${platformName} `
    )

    const tracker: DownloadTracker = {
      item: null,
      url: url,
      startTime: Date.now(),
      lastBytes: 0,
      lastTime: Date.now(),
      savePath: downloadPath,
      isYouTube: platformName === 'YouTube',
      headers: queuedItem.headers || {}, // CRITICAL: Pass headers
      retryCount: queuedItem.retryCount || 0,
      maxRetries: queuedItem.maxRetries || 3,
      audioOnly: queuedItem.audioOnly || false,
      filename: queuedItem.filename,
      strategy: strategy as any
    }

    activeDownloads.set(url, tracker)
    activeDownloadCount++

    if (strategy === 'yt-dlp') {
      console.log(`[DEBUG] Starting Plugin Download(${platformName}) via yt - dlp...`)
      await downloadWithYtDlp(
        url,
        downloadPath,
        platformName,
        mainWindow,
        undefined,
        tracker.filename
      )
    } else {
      console.log('[DEBUG] Starting Direct Download (Multi-threading)...')
      // RESET tracker stats to ensure fresh progress/speed calculation
      tracker.lastBytes = 0
      tracker.startTime = Date.now()
      tracker.lastTime = Date.now()
      tracker.lastProgress = 0

      await downloadWithMultiThreading(url, downloadPath, mainWindow)
    }
  } catch (error: any) {
    console.error('Error starting download from queue:', error)

    // Retry logic
    const tracker = activeDownloads.get(url)
    if (tracker && tracker.retryCount !== undefined && tracker.maxRetries !== undefined) {
      if (tracker.retryCount < tracker.maxRetries) {
        // Retry avec backoff exponentiel
        const retryDelay = Math.min(1000 * Math.pow(2, tracker.retryCount), 30000) // Max 30 secondes
        tracker.retryCount++

        console.log(
          `Retrying download ${url} (attempt ${tracker.retryCount}/${tracker.maxRetries}) after ${retryDelay} ms`
        )

        setTimeout(() => {
          // Réajouter à la queue avec priorité plus élevée
          downloadQueue.unshift({
            ...queuedItem,
            retryCount: tracker.retryCount || 0,
            priority: (queuedItem.priority || 0) + 1
          })
          activeDownloads.delete(url)
          activeDownloadCount--
          processDownloadQueue()
        }, retryDelay)

        return
      }
    }

    // Échec définitif
    const errorMessage = error.message || 'Failed to download file'
    mainWindow.webContents.send('download-error', {
      url,
      error: errorMessage
    })
    sendNotification('Erreur de téléchargement', `Échec du téléchargement: ${errorMessage} `, false)
    handleDownloadEnd(url)
  }
  // Note: handleDownloadEnd est appelé dans downloadWithYtDlp/downloadWithMultiThreading
  // quand le téléchargement se termine vraiment (succès, erreur, annulation)
}

// Fonction pour traiter la file d'attente
function processDownloadQueue() {
  // Trier la queue par priorité (plus haute priorité en premier)
  downloadQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  // Démarrer les téléchargements jusqu'à la limite
  while (activeDownloadCount < maxConcurrentDownloads && downloadQueue.length > 0) {
    const nextItem = downloadQueue.shift()
    if (nextItem) {
      startDownloadFromQueue(nextItem)
    }
  }
}

// Helper to parse size string manually to bytes
function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 0
  const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/)
  if (!match) return 0

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  if (unit.startsWith('k')) return value * 1024
  if (unit.startsWith('m')) return value * 1024 * 1024
  if (unit.startsWith('g')) return value * 1024 * 1024 * 1024
  if (unit.startsWith('t')) return value * 1024 * 1024 * 1024 * 1024

  return value
}

// Fonction pour arrêter un téléchargement
// Fonction pour ajouter un téléchargement à la queue
function addToDownloadQueue(
  url: string,
  mainWindow: BrowserWindow,
  savePath?: string,
  filename?: string,
  type?: string,
  mimeType?: string,
  priority: number = 0,
  headers?: Record<string, string>,
  audioOnly: boolean = false
) {
  // Vérifier si déjà dans la queue ou actif
  if (downloadQueue.some((item) => item.url === url) || activeDownloads.has(url)) {
    console.log('Download already queued or active:', url)
    return
  }

  const queuedItem: QueuedDownload = {
    url,
    savePath: savePath || appSettings.downloadPath,
    filename,
    type,
    mimeType,
    priority,
    headers, // Store headers
    audioOnly, // Store preference
    retryCount: 0,
    maxRetries: appSettings.maxRetries,
    mainWindow
  }

  downloadQueue.push(queuedItem)

  // NOTIFY FRONTEND - Immediate update
  // Check if filename is known or default
  const name = filename || url.split('/').pop()?.split('?')[0] || 'unknown-file'

  mainWindow.webContents.send('download-started', {
    url,
    name: name,
    size: 'Waiting...',
    progress: 0,
    speed: '-',
    status: 'queued',
    timeLeft: '--',
    createdAt: Date.now()
  })

  processDownloadQueue()
}

// Fonction pour gérer la fin d'un téléchargement (succès, erreur, annulation)
// Fonction pour gérer la fin d'un téléchargement (succès, erreur, annulation)
function handleDownloadEnd(url: string) {
  if (activeDownloads.has(url)) {
    activeDownloads.delete(url)
    if (activeDownloadCount > 0) {
      activeDownloadCount--
    }
    // Traiter le prochain téléchargement de la queue
    processDownloadQueue()
  }
}

// Fonction pour arrêter un téléchargement
async function stopDownload(url: string) {
  const tracker = activeDownloads.get(url)
  if (tracker) {
    tracker.cancelled = true
    // Handle native Electron download
    if (tracker.item) {
      if (tracker.item.getState() === 'progressing') {
        tracker.item.cancel()
      }
    }
    // Handle process (yt-dlp or other spawned processes)
    if (tracker.process) {
      try {
        if (process.platform === 'win32' && tracker.process.pid) {
          const { exec } = require('child_process')
          exec(`taskkill /F /T /PID ${tracker.process.pid}`, () => { })
        } else {
          tracker.process.kill('SIGKILL')
        }
        tracker.process = undefined
      } catch (e) {
        console.error('Error killing process:', e)
      }
    }
    if (tracker.httpRequests) {
      tracker.httpRequests.forEach((req) => req.destroy())
    }
    activeDownloads.delete(url)
    if (activeDownloadCount > 0) activeDownloadCount--

    // Notify frontend
    const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (mainWindow) {
      mainWindow.webContents.send('download-cancelled', { url })
    }

    processDownloadQueue()
  }
}

// Fonction de téléchargement utilisant yt-dlp
async function downloadWithYtDlp(
  url: string,
  savePath: string,
  _platform: string,
  win: BrowserWindow,
  formatId?: string,
  customFilename?: string,
  isRetry: boolean = false
) {
  let cookieFile: string | null = null // Declare at function scope for cleanup in catch/finally

  try {
    // Get headers from tracker
    const tracker = activeDownloads.get(url)
    const requestHeaders = tracker?.headers || {}

    // Obtenir le chemin de yt-dlp
    const finalYtDlpPath = ensureYtDlpAvailable()

    if (finalYtDlpPath) {
      // Vérifier si ffmpeg est disponible
      const ffmpegPath = await ensureFfmpegAvailable(win)
      const hasFfmpeg = !!ffmpegPath

      // Arguments de base pour yt-dlp
      const downloadArgs = [
        url,
        '-o',
        join(savePath, customFilename || '%(title)s.%(ext)s'), // Use custom filename if provided
        '--newline', // Important for parsing output
        '--no-mtime', // Ne pas restaurer la date de modif (perf Windows)
        '--continue', // CRITIQUE: Force la reprise des fichiers partiellement téléchargés
        '--no-playlist', // CRITIQUE: Télécharger UNIQUEMENT la vidéo spécifiée, pas toute la playlist
        '-N',
        '8', // BOOST: 8 connexions simultanées (Style IDM) pour max de vitesse
        '--http-chunk-size',
        '10M' // Gros chunks pour disque rapide
      ]

      // AUDIO CONVERSION LOGIC (MP3) - EXCLUSIVE PATH

      // AUDIO CONVERSION LOGIC (MP3) - EXCLUSIVE PATH
      if (tracker?.audioOnly) {
        // ... existing audio logic ...
        downloadArgs.push(
          '-x',
          '--audio-format',
          'mp3',
          '--audio-quality',
          '0',
          '-f',
          'bestaudio/best'
        )
        if (hasFfmpeg && ffmpegPath) downloadArgs.push('--ffmpeg-location', ffmpegPath)
        console.log('[yt-dlp] Audio Extraction Enabled (MP3) for:', url)
      }
      // CUSTOM FORMAT ID (from Quality Selector)
      else if (formatId) {
        downloadArgs.push('-f', `${formatId} +bestaudio / best`)
        if (hasFfmpeg && ffmpegPath) downloadArgs.push('--ffmpeg-location', ffmpegPath)
        downloadArgs.push('--merge-output-format', 'mp4')
        console.log(`[yt - dlp] Using custom format: ${formatId} `)
      }
      // DEFAULT VIDEO LOGIC - v19: Maximum Quality
      else {
        // Detect if it's YouTube for special handling
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')

        if (isYouTube) {
          // YouTube: SIMPLE format selector to avoid signature-required formats
          // Prioritize formats that TV client can deliver without complex processing
          downloadArgs.push(
            '-f',
            'best[height<=1080]/best',
            '--no-cache-dir'
          )
          console.log('[yt-dlp] YouTube: Using simplified format selector (TV-compatible)')
        } else {
          // Other platforms: Use best available video+audio
          downloadArgs.push('-f', 'bestvideo+bestaudio/best')
          console.log('[yt-dlp] Using best available quality')
        }

        if (hasFfmpeg && ffmpegPath) {
          downloadArgs.push('--ffmpeg-location', ffmpegPath)
          downloadArgs.push('--merge-output-format', 'mp4') // Ensure final output is MP4
        }
      }
      // [DEBUG] V4: Robust extraction strategy
      console.log(`[yt-dlp] Preparing download for ${url} (Strategy: yt-dlp)`)

      // [V18 FIX] Robust Cookie Authentication for Social Media
      // Problem: --cookies-from-browser chrome fails if Chrome is running (locks database)
      // Solution: Generate a PROPER Netscape cookie file from the Cookie header
      const isSocialPlatform =
        url.includes('tiktok.com') ||
        url.includes('instagram.com') ||
        url.includes('facebook.com') ||
        url.includes('twitter.com') ||
        url.includes('youtube.com') ||
        url.includes('youtu.be')

      if (isSocialPlatform && requestHeaders['Cookie']) {
        try {
          // Extract domain from URL
          const urlObj = new URL(url)
          const domain = urlObj.hostname

          // Create proper Netscape cookie file
          const cookieTempPath = join(app.getPath('temp'), `cookies_${Date.now()}.txt`)
          let netscapeContent = '# Netscape HTTP Cookie File\n'
          netscapeContent += '# This is a generated file! Do not edit.\n\n'

          // Parse Cookie header and convert to Netscape format
          const cookies = requestHeaders['Cookie'].split(';').map((c) => c.trim())
          const expiration = Math.floor(Date.now() / 1000) + 86400 // 24h from now

          for (const cookie of cookies) {
            const [name, ...valueParts] = cookie.split('=')
            const value = valueParts.join('=')
            if (name && value) {
              // YouTube extreme authentication: Add cookie for multiple domains
              // This is crucial because YouTube auth is shared between youtube.com and google.com
              const baseDomain = domain.replace('www.', '')
              const domainsToRoot = [
                baseDomain.startsWith('.') ? baseDomain : `.${baseDomain}`,
                '.youtube.com',
                '.google.com'
              ]

              // Remove duplicates
              const uniqueDomains = [...new Set(domainsToRoot)]

              for (const d of uniqueDomains) {
                // Format: domain, flag, path, secure, expiration, name, value
                netscapeContent += `${d}\tTRUE\t/\tFALSE\t${expiration}\t${name}\t${value}\n`
              }
            }
          }

          await fsPromises.writeFile(cookieTempPath, netscapeContent)
          cookieFile = cookieTempPath
          console.log('[yt-dlp] Generated multi-domain Netscape cookie file (.youtube.com + .google.com)')
          downloadArgs.push('--cookies', cookieFile)
        } catch (err) {
          console.error('[yt-dlp] Failed to generate cookie file:', err)
          // Fallback for YouTube: Try extracting cookies directly from Chrome
          if (url.includes('youtube.com') || url.includes('youtu.be')) {
            try {
              console.log('[yt-dlp] Attempting --cookies-from-browser chrome fallback')
              downloadArgs.push('--cookies-from-browser', 'chrome')
            } catch (e) {
              console.warn('[yt-dlp] Chrome cookie extraction unavailable')
            }
          }
        }
      } else if (Object.keys(requestHeaders).length > 0 && !isSocialPlatform) {
        // For non-social sites (YouTube, etc.), direct headers work fine
        console.log('[yt-dlp] Passing session headers directly')
        for (const key in requestHeaders) {
          downloadArgs.push('--add-header', `${key}:${requestHeaders[key]}`)
        }
        win.webContents.send('download-started', {
          url: url,
          name: initialFilename,
          size: 'Calculating...',
          progress: 0,
          speed: '-',
          status: 'downloading',
          timeLeft: '--',
          createdAt: Date.now(),
          savePath: savePath,
          canResume: true, // ALWAYS allow resume for yt-dlp
          strategy: 'yt-dlp'
        })

        // v20: Cross-platform Node.js PATH injection for signature solving
        const env = { ...process.env }
        const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'

        const isWindows = process.platform === 'win32'
        const isMac = process.platform === 'darwin'
        const nodeBinary = isWindows ? 'node.exe' : 'node'

        const possibleNodeDirs = isWindows
          ? [
            'C:\\Program Files\\nodejs',
            join(process.resourcesPath, 'node'),
            dirname(process.execPath),
            join(app.getAppPath(), 'node_modules', '.bin'),
            app.getPath('userData')
          ]
          : isMac
            ? [
              app.getPath('userData'), // Search in userData FIRST for portable Node
              '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Resources', // Mac JSC Path A
              '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Resources', // Mac JSC Path B
              '/usr/local/bin', // Intel/General
              '/opt/homebrew/bin', // Apple Silicon
              '/usr/bin',
              '/bin',
              '/usr/sbin',
              '/sbin',
              dirname(process.execPath),
              '/Applications/DoulBrowser.app/Contents/MacOS'
            ]
            : [app.getPath('userData'), '/usr/bin', '/usr/local/bin', '/bin']

        // Find and add Node.js to PATH if found
        let nodeFoundDir = ''
        for (const dir of possibleNodeDirs) {
          if (existsSync(join(dir, nodeBinary))) {
            nodeFoundDir = dir
            break
          }
        }

        // Fallback: Use 'which node' on Unix systems
        if (!nodeFoundDir && !isWindows) {
          try {
            const whichNode = execSync('which node', { encoding: 'utf8' }).trim()
            if (whichNode && existsSync(whichNode)) {
              nodeFoundDir = dirname(whichNode)
            }
          } catch (e) {
            // Ignore
          }
        }

        if (nodeFoundDir) {
          console.log(`[yt-dlp] Found Node.js for signature solving at: ${nodeFoundDir}`)
          env[pathKey] = `${nodeFoundDir}${isWindows ? ';' : ':'}${env[pathKey]}`
        } else {
          console.warn('[yt-dlp] WARNING: Node.js not found in common paths. YouTube "n" challenge may fail.')
        }

        // v25: Mac Specific - JavaScriptCore (jsc) is often the only working engine on older Macs
        if (isMac) {
          env['YTDLP_JS_ENGINE'] = 'javascriptcore,node'
          console.log('[yt-dlp] Mac Environment: Priority Engine [JavaScriptCore > Node]')

          // Ensure jsc is specifically in the PATH
          const jscPaths = [
            '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Resources',
            '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Resources'
          ]
          for (const jp of jscPaths) {
            if (existsSync(join(jp, 'jsc'))) {
              env[pathKey] = `${jp}${isMac ? ':' : ';'}${env[pathKey]}`
              console.log(`[yt-dlp] Added native Mac JSC to PATH: ${jp}`)
              break
            }
          }
        } else {
          env['YTDLP_JS_ENGINE'] = 'node'
        }

        // v23: Ensure portable Node.js is downloaded for Mac if missing
        if (isMac && !nodeFoundDir) {
          await ensureNodeAvailable(win)
          const portableNodePath = join(app.getPath('userData'), nodeBinary)
          if (existsSync(portableNodePath)) {
            console.log('[yt-dlp] Using downloaded portable Node.js for signature solving')
            env[pathKey] = `${app.getPath('userData')}${isMac ? ':' : ';'}${env[pathKey]}`
          }
        }

        // v1.2.2: Intelligent Retry Logic for YouTube
        const performDownload = async () => {
          const attempts = [
            {
              name: 'Strategy 1: TV Embedded (Fast/No Signature)',
              setup: () => {
                // Ensure we start fresh or keep previous base args
                // removing conflicting extractor args if any (both key and value)
                let cleanArgs = [...downloadArgs]

                // Remove existing extractor-args specifically for youtube:player_client
                // Note: This naive filter removal logic was buggy if flags were separate.
                // Better: reconstruct. But for now, since we removed the pre-push above, 
                // we just need to ensure we don't duplicate if retrying.

                // Filter out ANY existing --extractor-args that are attempting to set player_client
                // AND the preceding flag. Since this is hard with filter, we will doing a loop copy.

                const refinedArgs: string[] = []
                for (let j = 0; j < downloadArgs.length; j++) {
                  const arg = downloadArgs[j]
                  const nextArg = downloadArgs[j + 1]

                  if (arg === '--extractor-args' && nextArg && nextArg.includes('youtube:player_client')) {
                    // Skip both
                    j++
                    continue
                  }
                  refinedArgs.push(arg)
                }

                refinedArgs.push('--extractor-args', 'youtube:player_client=tv_embedded')
                return refinedArgs
              }
            },
            {
              name: 'Strategy 2: Web Client + Chrome Cookies (Robust Fallback)',
              setup: () => {
                const refinedArgs: string[] = []
                for (let j = 0; j < downloadArgs.length; j++) {
                  const arg = downloadArgs[j]
                  const nextArg = downloadArgs[j + 1]

                  if (arg === '--extractor-args' && nextArg && nextArg.includes('youtube:player_client')) {
                    // Skip both
                    j++
                    continue
                  }
                  refinedArgs.push(arg)
                }
                refinedArgs.push('--extractor-args', 'youtube:player_client=web')

                if (!refinedArgs.includes('--cookies-from-browser')) {
                  console.log('[yt-dlp] Retry: Adding --cookies-from-browser chrome')
                  refinedArgs.push('--cookies-from-browser', 'chrome')
                }
                return refinedArgs
              }
            }
          ]

          if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            attempts.length = 0
            attempts.push({ name: 'Standard Download', setup: () => downloadArgs })
          }

          for (let i = 0; i < attempts.length; i++) {
            const strategy = attempts[i]
            console.log(`\n[yt-dlp] --- Attempt ${i + 1}/${attempts.length}: ${strategy.name} ---`)
            const currentArgs = strategy.setup()
            console.log(`[yt-dlp] Command: ${finalYtDlpPath} ${currentArgs.join(' ')}`)

            try {
              await new Promise((resolve, reject) => {
                const ytDlpProcess = spawn(finalYtDlpPath, currentArgs, { env })

                const trackerRef = activeDownloads.get(url)
                if (trackerRef) trackerRef.process = ytDlpProcess

                let output = ''
                let stdoutBuffer = ''
                let errorOutput = ''
                let filename = customFilename || 'unknown'
                let killTimeout = null
                let wasKilledByTimeout = false

                ytDlpProcess.stdout.on('data', (data) => {
                  const chunk = data.toString()
                  output += chunk
                  stdoutBuffer += chunk

                  const trackerLog = activeDownloads.get(url)
                  if (trackerLog) {
                    if (!trackerLog.logs) trackerLog.logs = []
                    trackerLog.logs.push(chunk)
                    if (trackerLog.logs.length > 500) trackerLog.logs.shift()
                  }

                  const lines = stdoutBuffer.split('\n')
                  stdoutBuffer = lines.pop() || ''

                  for (const line of lines) {
                    const trimmedLine = line.trim()
                    if (!trimmedLine) continue

                    if (trimmedLine.includes('[download] Destination:')) {
                      const match = trimmedLine.match(/Destination: (.+)/)
                      if (match && match[1]) {
                        filename = require('path').basename(match[1])
                        if (trackerRef) trackerRef.filename = filename
                      }
                    }

                    if (trimmedLine.includes('[download]') && trimmedLine.includes('%')) {
                      const progressMatch = trimmedLine.match(/(\d+\.?\d*)%/)
                      const speedMatch = trimmedLine.match(/at\s+([\d\.]+\w+\/s)/)
                      const etaMatch = trimmedLine.match(/ETA\s+([\d:]+)/)

                      let percentage = progressMatch ? parseFloat(progressMatch[1]) : 0
                      const speed = speedMatch ? speedMatch[1] : '0B/s'
                      const timeLeft = etaMatch ? etaMatch[1] : '--:--'

                      // Simple bytes estimation not needed for live update message, just show %
                      win.webContents.send('download-progress', {
                        url, progress: percentage, receivedBytes: '...', totalBytes: '...',
                        state: 'downloading', speed, timeLeft, filename, strategy: 'yt-dlp', canResume: true
                      })

                      if (trackerRef) {
                        trackerRef.lastProgress = percentage
                        trackerRef.filename = filename
                        trackerRef.speed = speed
                        trackerRef.timeLeft = timeLeft
                      }
                    } else if (trimmedLine.includes('[download] 100% of')) {
                      win.webContents.send('download-progress', {
                        url, progress: 100, state: 'downloading', speed: 0, timeLeft: '00:00',
                        canResume: true, filename, strategy: 'yt-dlp'
                      })

                      if (!killTimeout) {
                        killTimeout = setTimeout(() => {
                          wasKilledByTimeout = true
                          resolve(true)
                          if (ytDlpProcess && !ytDlpProcess.killed) ytDlpProcess.kill('SIGKILL')
                        }, 10000)
                      }
                    }
                  }
                })

                ytDlpProcess.stderr.on('data', (data) => {
                  const errChunk = data.toString()
                  errorOutput += errChunk
                  console.error('[yt-dlp] stderr:', errChunk)

                  const trackerLog = activeDownloads.get(url)
                  if (trackerLog) {
                    if (!trackerLog.logs) trackerLog.logs = []
                    trackerLog.logs.push('ERR: ' + errChunk)
                  }
                })

                ytDlpProcess.on('close', (code) => {
                  if (killTimeout) clearTimeout(killTimeout)
                  if (wasKilledByTimeout) return

                  if (code === 0) {
                    if (!customFilename && filename === 'unknown') {
                      const m = output.match(/\[download\] Destination: (.+)/g)
                      if (m && m.length > 0) filename = require('path').basename(m[m.length - 1])
                    }
                    const finalPath = require('path').join(savePath, filename)

                    // Ensure stat check safety
                    let fileSize = 0
                    try { fileSize = fs.statSync(finalPath).size } catch (e) { }

                    win.webContents.send('download-complete', {
                      url, filePath: finalPath, filename, totalBytes: fileSize
                    })
                    if (win) win.webContents.send('notification', { title: 'Terminé', body: filename })
                    resolve(true)
                  } else {
                    const tracker = activeDownloads.get(url)
                    if (tracker && (tracker.paused || tracker.cancelled)) {
                      reject(new Error('Cancelled'))
                    } else {
                      // Check known errors for logging
                      if (errorOutput.includes('Sign in') || errorOutput.includes('403')) {
                        console.log('Retry-able error detected')
                      }
                      reject(new Error(`Exit code ${code}`))
                    }
                  }
                })

                ytDlpProcess.on('error', reject)
              })
              // If resolve(true) reached:
              return // BREAK LOOP
            } catch (err) {
              console.error(`Attempt ${i + 1} failed: ${err.message}`)
              if (i === attempts.length - 1) throw err
            }
          }
        }

        await performDownload()
        // Post-download cleanup

      } else {
        throw new Error('yt-dlp executable not found.')
      }
    }
  } catch (error: any) {
    console.error('Error in downloadWithYtDlp:', error)

    // Cleanup temporary cookie file if it was created
    if (cookieFile) {
      try {
        await fsPromises.unlink(cookieFile)
        console.log('[yt-dlp] Cleaned up temporary cookie file')
      } catch (_e) {
        // Ignore cleanup errors
      }
    }

    win.webContents.send('download-error', {
      url,
      error: error.message || 'yt-dlp download failed'
    })
    handleDownloadEnd(url)
  } finally {
    // Final cleanup: delete cookie file if it exists
    if (cookieFile) {
      try {
        if (existsSync(cookieFile)) {
          await fsPromises.unlink(cookieFile)
        }
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
  }
}

// Serveur HTTP pour recevoir les téléchargements détectés par l'extension
function startExtensionServer() {
  extensionServer = createServer((req, res) => {
    // CORS headers pour permettre les requêtes depuis l'extension
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    // Headers CORS pour permettre les requêtes depuis l'extension
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200, corsHeaders)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // Gérer la route racine
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...corsHeaders
      })
      res.end(
        JSON.stringify({
          status: 'ok',
          app: 'DoulBrowser',
          version: '1.2.5',
          endpoints: ['/ping', '/download-detected', '/download-status']
        })
      )
      return
    }

    // Gérer le favicon.ico (les navigateurs le demandent automatiquement)
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, corsHeaders) // No Content
      res.end()
      return
    }

    // Endpoint ping pour vérifier que l'application est en cours d'exécution
    if (url.pathname === '/ping' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...corsHeaders
      })
      res.end(JSON.stringify({ status: 'ok', app: 'DoulBrowser' }))
      return
    }

    // Endpoint pour recevoir les téléchargements détectés
    if (url.pathname === '/download-detected' && req.method === 'POST') {
      let body = ''

      req.on('data', (chunk) => {
        body += chunk.toString()
      })

      req.on('end', async () => {
        try {
          // Vérifier que le body n'est pas vide
          if (!body || body.trim() === '') {
            res.writeHead(400, {
              'Content-Type': 'application/json',
              ...corsHeaders
            })
            res.end(JSON.stringify({ error: 'Empty request body' }))
            return
          }

          const data = JSON.parse(body)
          const downloadUrl = data.url
          const filename = data.filename || 'download'

          console.log('📥 Download request received from extension:')
          console.log('  URL:', downloadUrl)
          console.log('  Filename:', filename)
          console.log('  Headers:', data.headers ? 'Present' : 'Missing')
          console.log('  Header details:', JSON.stringify(data.headers, null, 2))

          // Vérifier que l'URL est présente
          if (!downloadUrl) {
            res.writeHead(400, {
              'Content-Type': 'application/json',
              ...corsHeaders
            })
            res.end(JSON.stringify({ error: 'URL is required' }))
            return
          }

          // Trouver la fenêtre principale
          const windows = BrowserWindow.getAllWindows()
          const mainWindow = windows.find((w) => !w.isDestroyed())

          if (!mainWindow) {
            res.writeHead(500, {
              'Content-Type': 'application/json',
              ...corsHeaders
            })
            res.end(JSON.stringify({ error: 'Main window not found' }))
            return
          }

          // BRING TO FRONT - User wants to see the download
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()

          // Quality Selector: DISABLED categorically for maximum speed (V17)
          // Direct download proceeds for all sites

          // Ajouter à la file d'attente au lieu de démarrer directement
          const downloadPath = appSettings.downloadPath
          console.log('📁 Dossier de téléchargement:', downloadPath)

          // Ajouter à la queue (sera traité automatiquement selon la limite de téléchargements simultanés)
          addToDownloadQueue(
            downloadUrl,
            mainWindow,
            downloadPath,
            filename,
            data.type,
            data.mimeType,
            0, // Priorité par défaut
            data.headers || {}, // Pass headers
            // Déterminer si audio only
            (data.mimeType && data.mimeType.startsWith('audio/')) ||
            (filename && filename.toLowerCase().endsWith('.mp3')) ||
            false
          )

          console.log('✅ Download added to queue successfully')

          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...corsHeaders
          })
          res.end(JSON.stringify({ success: true }))
        } catch (error: any) {
          console.error('DoulBrowser: Erreur dans /download-detected:', error)
          console.error('DoulBrowser: Body reçu:', body)
          res.writeHead(400, {
            'Content-Type': 'application/json',
            ...corsHeaders
          })
          res.end(
            JSON.stringify({
              error: error.message || 'Invalid JSON',
              details: body ? 'Body received but parsing failed' : 'Empty body'
            })
          )
        }
      })
      return
    }

    // Endpoint pour obtenir le statut d'un téléchargement
    if (url.pathname === '/download-status' && req.method === 'GET') {
      const downloadUrl = url.searchParams.get('url')
      if (downloadUrl) {
        // 1. Check in Active Downloads
        let tracker = activeDownloads.get(downloadUrl)

        if (tracker) {
          const progress = tracker.lastProgress || 0
          const receivedBytes = tracker.lastBytes || 0
          const totalBytes = tracker.item?.getTotalBytes() || (tracker as any).totalBytes || 0

          const now = Date.now()
          let speed = 0
          if ((tracker as any).lastSpeed && (tracker as any).lastSpeed > 0) {
            speed = (tracker as any).lastSpeed
          } else if (tracker.lastTime && tracker.lastTime > 0 && receivedBytes > 0) {
            const elapsed = (now - tracker.startTime) / 1000
            speed = elapsed > 0 ? receivedBytes / elapsed : 0
          } else {
            const elapsed = (now - tracker.startTime) / 1000
            speed = elapsed > 0 ? receivedBytes / elapsed : 0
          }

          let speedStr = '0 B/s'
          if (speed > 0) {
            if (speed < 1024) speedStr = `${Math.round(speed)} B/s`
            else if (speed < 1024 * 1024) speedStr = `${(speed / 1024).toFixed(2)} KB/s`
            else speedStr = `${(speed / (1024 * 1024)).toFixed(2)} MB/s`
          }

          let timeLeft = '--'
          if (speed > 0 && totalBytes > 0) {
            const remaining = totalBytes - receivedBytes
            const seconds = remaining / speed
            if (seconds < 60) timeLeft = `${Math.round(seconds)}s`
            else if (seconds < 3600) timeLeft = `${Math.round(seconds / 60)}m`
            else timeLeft = `${Math.round(seconds / 3600)}h`
          }

          let status = 'downloading'
          if (tracker.cancelled) status = 'cancelled'
          else if (tracker.paused) status = 'paused'
          else if (progress >= 100 || (totalBytes > 0 && receivedBytes >= totalBytes)) status = 'completed'

          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({
            status, progress, receivedBytes, totalBytes, speed, speedFormatted: speedStr, timeLeft
          }))
        }
        // 2. Check in Queue (Fix for 404 errors)
        else {
          const queuedItem = downloadQueue.find(item => item.url === downloadUrl)
          if (queuedItem) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({
              status: 'waiting',
              progress: 0,
              receivedBytes: 0,
              totalBytes: 0,
              speed: 0,
              speedFormatted: 'Waiting...',
              timeLeft: '--'
            }))
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: 'Download not found' }))
          }
        }
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'URL parameter missing' }))
      }
      return
    }

    // Endpoints pour pause/resume/cancel depuis l'extension
    if (url.pathname === '/download-pause' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const windows = BrowserWindow.getAllWindows()
          const mainWindow = windows.find((w) => !w.isDestroyed())
          if (mainWindow) {
            mainWindow.webContents.send('download-pause', data.url)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (_error) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }

    if (url.pathname === '/download-resume' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const windows = BrowserWindow.getAllWindows()
          const mainWindow = windows.find((w) => !w.isDestroyed())
          if (mainWindow) {
            mainWindow.webContents.send('download-resume', data.url)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (_error) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }

    if (url.pathname === '/download-cancel' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const windows = BrowserWindow.getAllWindows()
          const mainWindow = windows.find((w) => !w.isDestroyed())
          if (mainWindow) {
            mainWindow.webContents.send('download-cancel', data.url)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (_error) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }

    // 404 pour les autres routes (silencieux pour éviter les erreurs dans la console)
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('')
  })

  extensionServer.listen(EXTENSION_PORT, 'localhost', () => {
    console.log(`✅ Extension server listening on http://localhost:${EXTENSION_PORT}`)
    console.log('🔍 Server is ready to receive downloads from browser extension')
  })

  extensionServer.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${EXTENSION_PORT} already in use, extension server may already be running`)
    } else {
      console.error('Extension server error:', error)
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.doulbrowser.app')
  }

  console.log('[DEBUG] app.whenReady() triggered')
  // Load Settings
  appSettings = loadSettings()
  maxConcurrentDownloads = appSettings.maxConcurrentDownloads

  // Activer l'extension de capture de téléchargements (style IDM)
  try {
    // v20: Robust extension path detection
    const possiblePaths = [
      join(__dirname, '..', '..', '..', 'extension_clean'), // Dev: logi/src/main -> logi/extension_clean
      join(process.resourcesPath, 'extension_clean'), // Prod: resources/extension_clean
      join(app.getAppPath(), 'extension_clean'), // Fallback
      join(app.getAppPath(), '..', 'extension_clean'), // Fallback 2
      'C:\\Users\\ABDOUL JABBAR\\Desktop\\Nouveau dossier\\logi\\extension_clean' // Direct path fallback
    ]

    let extensionPath = ''
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        extensionPath = p
        break
      }
    }

    console.log('Loading extension from:', extensionPath || 'NOT FOUND')

    if (extensionPath && existsSync(extensionPath)) {
      // v20: Use modern API session.extensions.loadExtension
      session.defaultSession.extensions
        .loadExtension(extensionPath, { allowFileAccess: true })
        .then((ext) => console.log('Extension loaded successfully:', ext.name))
        .catch((err) => console.error('Failed to load extension:', err))
    } else {
      console.error('Extension not found in any of the possible paths.')
    }
  } catch (err) {
    console.error('Error loading extension:', err)
  }

  // Configurer l'auto-démarrage selon les paramètres
  app.setLoginItemSettings({
    openAtLogin: appSettings.autoStart,
    openAsHidden: false
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  // app.on('browser-window-created', (_, window) => {
  //   optimizer.watchWindowShortcuts(window)
  // })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // IPC Handler for custom downloads (from Quality Selector)
  ipcMain.on('start-download-custom', async (event, { url, formatId, filename, audioOnly }) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender)
    if (!mainWindow) return

    if (audioOnly) {
      // Create/Update tracker with audio flag
      let tracker = activeDownloads.get(url)
      if (!tracker) {
        tracker = {
          item: null, // Fix lint: required property
          url,
          startTime: Date.now(),
          lastBytes: 0,
          lastTime: Date.now(),
          audioOnly: true,
          strategy: 'yt-dlp'
        }
        activeDownloads.set(url, tracker)
      } else {
        tracker.audioOnly = true
      }
    }

    // Delegate to yt-dlp with specific format
    await downloadWithYtDlp(
      url,
      appSettings.downloadPath,
      'Generic',
      mainWindow,
      formatId,
      filename
    )
  })

  // Handle get-video-info for Quality Selector
  ipcMain.handle('get-video-info', async (_event, url: string) => {
    try {
      const info = await fetchVideoInfo(url)

      const allFormats = info.formats || []

      // Video formats (those with video codec)
      const videoFormats = allFormats
        .filter((f: any) => f.vcodec !== 'none')
        .map((f: any) => ({
          id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : 'unknown'),
          height: f.height || 0,
          filesize: f.filesize || f.filesize_approx,
          note: f.format_note || '',
          vcodec: f.vcodec,
          acodec: f.acodec
        }))
        .sort((a: any, b: any) => b.height - a.height) // Highest resolution first

      // Audio formats (those with audio codec and NO video)
      const audioFormats = allFormats
        .filter((f: any) => f.vcodec === 'none' && f.acodec !== 'none')
        .map((f: any) => ({
          id: f.format_id,
          ext: f.ext,
          filesize: f.filesize || f.filesize_approx,
          abr: f.abr || 0,
          note: f.format_note || ''
        }))
        .sort((a: any, b: any) => b.abr - a.abr)

      return {
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        videoFormats,
        audioFormats
      }
    } catch (error: any) {
      console.error('[IPC] get-video-info error:', error)
      throw error
    }
  })

  ipcMain.on('download-start', async (event, url: string, savePath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    try {
      // Use the centralized queue system which now handles Plugins, Smart Routing, and Audio Support
      const downloadFolder = savePath || appSettings.downloadPath
      console.log(`[Manual Download] Adding to queue: ${url}`)

      // Determine if audio only based on simple heuristic (if user provides direct mp3 link OR filename has .mp3)
      // For manual input, we can't easily guess so we default to false (Video) unless obvious
      const isAudio =
        url.toLowerCase().includes('.mp3') ||
        url.toLowerCase().includes('.m4a') ||
        url.toLowerCase().includes('soundcloud.com')

      console.log(`[Manual Download] Processing: ${url}, Audio Detected: ${isAudio}`)

      // NEW LOGIC: Check for YouTube and trigger Quality Selector (Manual Add)
      // REMOVED: Manual YouTube Quality Selector trigger
      // Now YouTube URLs will fall through to addToDownloadQueue and be handled by the YouTubePlugin (Direct Download)

      addToDownloadQueue(
        url,
        win,
        downloadFolder,
        isAudio ? `Audio_${Date.now()}.mp3` : undefined, // Force filename hint for audio
        undefined, // type
        undefined, // mimeType
        1, // Higher priority for manual downloads
        {}, // No special headers for manual input (unless plugins add them later)
        isAudio // Pass audioOnly flag TRUE if audio detected
      )
    } catch (error: any) {
      win.webContents.send('download-error', {
        url,
        error: error.message || 'Failed to start download'
      })
    }
  })

  ipcMain.on('download-pause', (event, url: string) => {
    const tracker = activeDownloads.get(url)
    const win = BrowserWindow.fromWebContents(event.sender)

    // Cas 1 : téléchargement \"classique\" géré par Electron
    if (tracker && tracker.item && !tracker.item.isPaused()) {
      tracker.item.pause()
      // Send the last known progress percentage when pausing
      win?.webContents.send('download-paused', {
        url,
        progress: tracker.lastProgress !== undefined ? tracker.lastProgress : 0
      })
      return
    }

    // Cas 2 : téléchargement multi-threaded (fichiers directs)
    if (tracker && tracker.httpRequests && tracker.httpRequests.length > 0) {
      tracker.paused = true
      tracker.cancelled = false
      // Annuler toutes les requêtes HTTP
      tracker.httpRequests.forEach((req) => {
        try {
          req.destroy()
        } catch (error) {
          console.error('Error destroying HTTP request:', error)
        }
      })
      tracker.httpRequests = []
      win?.webContents.send('download-paused', {
        url,
        progress: tracker.lastProgress !== undefined ? tracker.lastProgress : 0
      })
      return
    }

    // Cas 3 : téléchargement géré par yt-dlp (process externe)
    if (tracker && tracker.process) {
      // Marquer comme paused AVANT de tuer le processus
      tracker.paused = true
      tracker.cancelled = false

      try {
        // Détacher les listeners pour éviter les mises à jour après la pause
        if (tracker.process.stdout) {
          tracker.process.stdout.removeAllListeners('data')
        }
        if (tracker.process.stderr) {
          tracker.process.stderr.removeAllListeners('data')
        }

        // Détacher aussi les listeners 'close' et 'error' pour éviter les événements après pause
        tracker.process.removeAllListeners('close')
        tracker.process.removeAllListeners('error')

        // Forcer l'arrêt immédiat avec SIGKILL
        if (tracker.process.killed === false && tracker.process.pid) {
          try {
            // Sur Windows, utiliser taskkill pour forcer l'arrêt
            if (process.platform === 'win32' && tracker.process.pid) {
              const { exec } = require('child_process')
              exec(`taskkill /F /T /PID ${tracker.process.pid}`, () => { })
            } else {
              tracker.process.kill('SIGKILL')
            }
          } catch (killError) {
            console.error('Error killing process:', killError)
          }
        }

        // Nettoyer la référence au processus
        tracker.process = undefined

        // DECREMENT count to allow other queued downloads to start
        if (activeDownloadCount > 0) activeDownloadCount--
        processDownloadQueue()
      } catch (error) {
        console.error('Error killing yt-dlp process for pause:', error)
      }

      // Send the last known progress percentage when pausing
      win?.webContents.send('download-paused', {
        url,
        progress: tracker.lastProgress !== undefined ? tracker.lastProgress : 0
      })
    }
  })

  ipcMain.on('download-resume', (event, url: string, savePath?: string, filename?: string) => {
    console.log(`[IPC] download-resume received for: ${url}`)
    let tracker = activeDownloads.get(url)
    const win = BrowserWindow.fromWebContents(event.sender)

    // If tracker is missing (e.g. after error/restart), try to recreate it
    if (!tracker && savePath) {
      console.log(`[Resume] Tracker missing for ${url}, recreating...`)

      // Determine strategy again using the same routing logic as startDownloadFromQueue
      let strategy: 'yt-dlp' | 'direct' | 'electron' = 'direct'
      const plugin = pluginManager.getPlugin(url)
      if (plugin) {
        const strat = plugin.getStrategy(url)
        strategy = strat === 'yt-dlp' ? 'yt-dlp' : 'direct'
      } else {
        const { isSocial } = isSocialMediaURL(url)
        if (isSocial) strategy = 'yt-dlp'
      }

      tracker = {
        item: null,
        url: url,
        startTime: Date.now(),
        lastBytes: 0,
        lastTime: Date.now(),
        savePath: savePath,
        isYouTube: url.includes('youtube.com') || url.includes('youtu.be'),
        filename: filename,
        paused: true,
        strategy: strategy
      }
      activeDownloads.set(url, tracker)
    }

    // Cas 1 : téléchargement "classique" géré par Electron
    if (tracker && tracker.item) {
      if (tracker.item.isPaused()) {
        tracker.item.resume()
      } else if (tracker.item.getState() === 'interrupted' && tracker.item.canResume()) {
        // Resume interrupted download
        tracker.item.resume()
        // Reset tracker for speed calculation
        tracker.lastBytes = tracker.item.getReceivedBytes()
        tracker.lastTime = Date.now()
      }
      win?.webContents.send('download-resumed', { url })
      return
    }

    // Cas 2 : téléchargement yt-dlp : on relance yt-dlp avec --continue
    if (
      tracker &&
      !tracker.process &&
      tracker.savePath &&
      (tracker.strategy === 'yt-dlp' || tracker.isYouTube || isSocialMediaURL(url).isSocial)
    ) {
      tracker.paused = false
      activeDownloadCount++ // Increment back while it's active

      // Envoyer immédiatement le pourcentage actuel pour éviter qu'il revienne à 0
      const currentProgress = tracker.lastProgress || 0
      const currentBytes = tracker.lastBytes || 0

      win?.webContents.send('download-progress', {
        url: url,
        progress: currentProgress,
        receivedBytes: currentBytes,
        totalBytes: 0,
        state: 'downloading',
        speed: 0,
        timeLeft: '--',
        originalUrl: url,
        canResume: true,
        filename: tracker.filename
      })

      win?.webContents.send('download-resumed', { url })
        ; (async () => {
          try {
            const { platform } = isSocialMediaURL(url)
            await downloadWithYtDlp(
              url,
              tracker.savePath as string,
              platform || (tracker.isYouTube ? 'YouTube' : ''),
              win!,
              undefined,
              tracker.filename
            )
          } catch (error: any) {
            win?.webContents.send('download-error', {
              url,
              error: error.message || 'Failed to resume download'
            })
          }
        })()
      return
    }

    // Cas 3 : téléchargement multi-threaded : reprendre à partir des segments déjà téléchargés
    if (tracker && tracker.savePath && !tracker.item && !tracker.process) {
      tracker.paused = false
      activeDownloadCount++ // Increment back

      // Envoyer immédiatement le pourcentage actuel pour éviter qu'il revienne à 0
      const currentProgress = tracker.lastProgress || 0
      const currentBytes = tracker.lastBytes || 0

      win?.webContents.send('download-progress', {
        url: url,
        progress: currentProgress,
        receivedBytes: currentBytes,
        totalBytes: 0,
        state: 'downloading',
        speed: 0,
        timeLeft: '--',
        originalUrl: url,
        canResume: true,
        filename: tracker.filename
      })

      win?.webContents.send('download-resumed', { url })

        // Relancer le téléchargement multi-threaded
        ; (async () => {
          try {
            if (win) {
              await downloadWithMultiThreading(url, tracker.savePath!, win)
            }
          } catch (error: any) {
            win?.webContents.send('download-error', {
              url,
              error: error.message || 'Failed to resume download'
            })
          }
        })()
    }
  })

  ipcMain.on('download-cancel', (_event, url: string) => {
    stopDownload(url)
  })

  ipcMain.on('download-open-folder', async (_event, url: string) => {
    const tracker = activeDownloads.get(url)
    if (tracker && tracker.savePath) {
      const path = tracker.savePath
      // Open the folder containing the file
      shell.showItemInFolder(path)
    } else {
      // If no save path, open downloads folder
      shell.openPath(app.getPath('downloads'))
    }
  })

  ipcMain.handle('download-select-path', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  // Handlers pour les paramètres
  ipcMain.handle('get-settings', () => {
    return appSettings
  })

  ipcMain.handle('save-settings', (_event, settings: Partial<AppSettings>) => {
    const saved = saveSettings(settings)
    if (saved) {
      appSettings = saved

      // Mettre à jour l'auto-démarrage si changé
      if (settings.autoStart !== undefined) {
        app.setLoginItemSettings({
          openAtLogin: settings.autoStart,
          openAsHidden: false
        })
      }
    }
    return saved
  })

  // Handler pour accepter un téléchargement détecté
  ipcMain.on('accept-detected-download', async (event, url: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // Demander le dossier de destination
    const savePath = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Sélectionner le dossier de téléchargement'
    })

    if (!savePath.canceled && savePath.filePaths.length > 0) {
      // Déclencher le téléchargement
      const { isSocial, platform } = isSocialMediaURL(url)
      if (isSocial) {
        try {
          const downloadPath = savePath.filePaths[0]
          const tracker: DownloadTracker = {
            item: null,
            url: url,
            startTime: Date.now(),
            lastBytes: 0,
            lastTime: Date.now(),
            savePath: downloadPath,
            isYouTube: platform === 'YouTube'
          }
          activeDownloads.set(url, tracker)
          await downloadWithYtDlp(url, downloadPath, platform, win)
        } catch (error: any) {
          win.webContents.send('download-error', {
            url,
            error: error.message || 'Failed to download'
          })
        }
      } else {
        try {
          const downloadPath = savePath.filePaths[0]
          const tracker: DownloadTracker = {
            item: null,
            url: url,
            startTime: Date.now(),
            lastBytes: 0,
            lastTime: Date.now(),
            savePath: downloadPath
          }
          activeDownloads.set(url, tracker)
          await downloadWithMultiThreading(url, downloadPath, win)
        } catch (error: any) {
          win.webContents.send('download-error', {
            url,
            error: error.message || 'Failed to download'
          })
        }
      }
    }
  })

  // Handler pour ignorer un téléchargement détecté
  ipcMain.on('dismiss-detected-download', () => {
    // Téléchargement ignoré - callback is intentionally empty
  })

  // Démarrer le serveur HTTP pour communiquer avec l'extension de navigateur
  startExtensionServer()

  createWindow()
  console.log('[DEBUG] createWindow() executed')

  // Defer yt-dlp update to after window creation to ensure app starts quickly
  setTimeout(() => {
    console.log('[DEBUG] Starting deferred autoUpdateYtDlp()')
    autoUpdateYtDlp()
  }, 5000)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // [v1.0.8] IPC Handler to get download logs
  ipcMain.handle('get-download-logs', (_event, url: string) => {
    const tracker = activeDownloads.get(url)
    return tracker?.logs || []
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

