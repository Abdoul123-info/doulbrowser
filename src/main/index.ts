import { app, shell, BrowserWindow, ipcMain, dialog, Notification, session } from 'electron'
import type { DownloadItem } from 'electron'
import { join, dirname, sep } from 'path'
import { existsSync, promises as fsPromises, readFileSync, writeFileSync } from 'fs'
import * as fs from 'fs'
import { spawn, execSync } from 'child_process'
import { URL } from 'url'
import { createServer } from 'http'
import * as https from 'https'
import icon from '../../resources/icon.png?asset'
import { pluginManager } from './plugins/manager'
import * as crypto from 'crypto'

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

    // Bypass cache-lock issues in development
    if (!app.isPackaged) {
      app.commandLine.appendSwitch('disable-http-cache')
      app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
    }

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
  originalUrl?: string
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
  priority?: number // Higher number = higher priority
  retryCount?: number // Number of retry attempts
  maxRetries?: number // Maximum retry attempts
  audioOnly: boolean // [v1.7.0] Core property for identification
  filename?: string // Explicit filename if provided
  strategy?: 'yt-dlp' | 'direct' | 'electron'
  logs?: string[] // Technical logs for debugging (v1.0.8)
  speed?: any
  timeLeft?: string
  lastSpeed?: number
  segmentProgress?: number[] // Progress for each thread in multi-threaded downloads
  statusMessage?: string // Informative message for post-processing feedback (merging, etc.)
  lastProgressSent?: number // Timestamp of last progress event sent (for throttling UI updates)
  totalBytes?: number // Total file size for resume capability
  videoSize?: number // [v1.3.0] Part of cumulative size fix
  audioSize?: number // [v1.3.0] Part of cumulative size fix
}
const activeDownloads = new Map<string, DownloadTracker>()
const recentlyCompletedDownloads = new Map<string, { timestamp: number }>()
const RECENTLY_COMPLETED_TTL = 60000 // 60 seconds

/**
 * [v1.7.0] Core logic for identifying downloads: URL + Format (Audio/Video).
 * This allows downloading BOTH formats for the same URL simultaneously.
 */
function getTrackerId(url: string, audioOnly: boolean): string {
  return `${url}|${audioOnly ? 'audio' : 'video'}`
}

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
  audioOnly: boolean // [v1.7.0] Required for composite uniqueness
}

const downloadQueue: QueuedDownload[] = []
// [v1.3.0] Removed unused maxConcurrentDownloads, now using appSettings version synchronously

// [v1.7.1] PERFORMANCE: Cache expensive path lookups (were 1-2s each on Windows)
let _cachedFfmpegPath: string | null | undefined = undefined // undefined = not yet checked
let _cachedNodeDir: string | null | undefined = undefined    // undefined = not yet checked
let _cachedAria2Path: string | null | undefined = undefined  // [v1.7.2] NEW: for high-speed downloads
// Removing activeDownloadCount in favor of dynamic calculation to prevent leaks

// Interface pour les paramètres de l'application
interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  maxRetries: number
  autoStart: boolean
  notifications: boolean
  soundNotifications: boolean
  language: string
  // Licensing fields
  licenseKey: string
  isActivated: boolean
  machineId: string
  expiryDate: string | null
  // [v1.9.28] Anti-fraud fields
  lastOpenedDate: string | null
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
    language: 'fr',
    licenseKey: '',
    isActivated: false,
    machineId: '',
    expiryDate: null,
    lastOpenedDate: null
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
  downloadPath: '',
  maxConcurrentDownloads: 3,
  maxRetries: 3,
  autoStart: false,
  notifications: true,
  soundNotifications: false,
  language: 'fr',
  licenseKey: '',
  isActivated: false,
  machineId: '',
  expiryDate: null,
  lastOpenedDate: null
}


// Function to get hardware UUID (Machine ID)
async function getMachineId(): Promise<string> {
  try {
    if (process.platform === 'win32') {
      const output = execSync('wmic csproduct get uuid').toString()
      return output.split('\n')[1].trim().toUpperCase() // Force Uppercase & Trim
    } else if (process.platform === 'darwin') {
      const output = execSync("ioreg -rd1 -c IOPlatformExpertDevice | grep -E '(uuid|IOPlatformUUID)'").toString()
      return output.split('"')[3].trim().toUpperCase()
    } else {
      // Linux
      const output = readFileSync('/var/lib/dbus/machine-id', 'utf8') || readFileSync('/etc/machine-id', 'utf8')
      return output.trim().toUpperCase()
    }
  } catch (e) {
    console.error('Failed to get Machine ID:', e)
    
    // [v1.2.9] Persistent Fallback ID Security 🛡️
    // If HWID fails, use a unique random ID stored on disk to prevent key sharing.
    try {
      const dataPath = app.getPath('userData')
      const idFile = join(dataPath, 'machine-id.txt')
      
      if (existsSync(idFile)) {
        return readFileSync(idFile, 'utf8').trim().toUpperCase()
      } else {
        const randomId = ('UNKNOWN-' + process.platform + '-' + crypto.randomBytes(4).toString('hex')).toUpperCase()
        writeFileSync(idFile, randomId, 'utf8')
        return randomId
      }
    } catch (saveErr) {
      console.error('Failed to persist fallback ID:', saveErr)
      return ('UNKNOWN-ID-' + process.platform).toUpperCase()
    }
  }
}

// Secret Salt for License Signing
const LICENSE_SALT = 'DadiLicenceSecret2026'

// [v1.9.29] Supabase Configuration
const SUPABASE_URL = 'https://gqrwykhhqjimsgiqkgut.supabase.co' 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxcnd5a2hocWppbXNnaXFrZ3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNzAsImV4cCI6MjA4NzI4ODI3MH0.OVLEQdhYN6VHi5OQC_51EnDPoPPbnV0HuNHtchPy244'


/**
 * [v1.9.29] Minimal REST client for Supabase to avoid NPM dependency issues.
 */
async function supabaseRequest(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: any): Promise<any> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    
    return new Promise((resolve) => {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                ...(method !== 'GET' ? { 'Prefer': 'return=minimal' } : {})
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                // [v1.9.34] Check for HTTP success (2xx)
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    console.error(`[Supabase Error] ${method} ${path} -> Status ${res.statusCode}: ${data.substring(0, 200)}`);
                    return resolve(null);
                }

                try {
                    const json = data ? JSON.parse(data) : {};
                    resolve(json);
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

/**
 * [v1.9.33] Upload local file to Supabase Storage and return public URL.
 */
async function supabaseUploadFile(localPath: string, bucket: string, remotePath: string): Promise<{ success: boolean, url?: string, error?: string, code?: number }> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return { success: false, error: 'Configuration Supabase manquante.' };

    try {
        const fileContent = fs.readFileSync(localPath);
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/${bucket}/${remotePath}`);
        
        return new Promise((resolve) => {
            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST', 
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/octet-stream',
                    'x-upsert': 'true' 
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${remotePath}`;
                        resolve({ success: true, url: publicUrl });
                    } else {
                        console.error('[Supabase Storage] Error:', res.statusCode, data);
                        resolve({ 
                            success: false, 
                            error: `Erreur Supabase ${res.statusCode}: ${data.substring(0, 100)}`,
                            code: res.statusCode 
                        });
                    }
                });
            });

            req.on('error', (e) => {
                console.error('[Supabase Storage] Request Error:', e);
                resolve({ success: false, error: `Erreur réseau: ${e.message}` });
            });
            req.write(fileContent);
            req.end();
        });
    } catch (e: any) {
        console.error('[Supabase Storage] Local File Error:', e);
        return { success: false, error: `Erreur fichier local: ${e.message}` };
    }
}

/**
 * [v1.9.29] Check hardware ID against the cloud database.
 * Distinguishes FOUND, NOT_FOUND and ERROR (network).
 */
async function checkLicenseOnline(machineId: string): Promise<{ 
    status: 'FOUND' | 'NOT_FOUND' | 'ERROR',
    isBlocked?: boolean, 
    expiry?: string | null 
}> {
    const data = await supabaseRequest(`licences?hwid=eq.${encodeURIComponent(machineId)}`, 'GET');
    if (data === null) return { status: 'ERROR' }; // Might be network error
    
    if (Array.isArray(data) && data.length > 0) {
        const license = data[0];
        return {
            status: 'FOUND',
            isBlocked: !!license.is_blocked,
            expiry: license.expiry_date || null
        };
    }
    return { status: 'NOT_FOUND' };
}


/**
 * [v1.9.32] Update or Create a license in the cloud database.
 * allowInsert: If true, creates a new row if HWID is missing. 
 *             Set to FALSE for heartbeats to prevent recreation of deleted rows.
 */
async function updateLicenseOnline(machineId: string, data: { 
    license_key?: string, 
    expiry_date?: string, 
    is_blocked?: boolean, 
    activated_at?: string, 
    original_key?: string,
    last_seen?: string 
}, allowInsert = false): Promise<boolean> {
    // 1. Check if exists
    const existing = await supabaseRequest(`licences?hwid=eq.${encodeURIComponent(machineId)}`, 'GET');
    
    if (existing && Array.isArray(existing) && existing.length > 0) {
        // Update (PATCH)
        const result = await supabaseRequest(`licences?hwid=eq.${encodeURIComponent(machineId)}`, 'PATCH', data);
        return result !== null;
    } else if (allowInsert) {
        // Insert (POST) ONLY if explicitly allowed (Activation)
        const result = await supabaseRequest('licences', 'POST', {
            hwid: machineId,
            ...data
        });
        return result !== null;
    }
    
    console.warn(`[Licensing] updateLicenseOnline failed: HWID ${machineId} not found and allowInsert is false.`);
    return false;
}



// Function to sign a license (Admin only logic)
function signLicense(machineId: string, expiryDate: string): string {
  const cleanMid = machineId.trim().toUpperCase()
  const payload = `${cleanMid}:${expiryDate}:${LICENSE_SALT}`
  const hash = crypto.createHash('md5').update(payload).digest('hex').substring(0, 16).toUpperCase()
  // Use # as a safer delimiter
  return `${cleanMid}#${expiryDate}#${hash}`
}

/**
 * [v1.9.30] Periodically check license status in the cloud.
 */
function startLicenseHeartbeat(machineId: string) {
    // Check every 60 minutes
    setInterval(async () => {
        if (!appSettings.isActivated) return // No need if not activated
        
        console.log('[Licensing] Heartbeat check...')
        const cloud = await checkLicenseOnline(machineId)
        
        if (cloud.status === 'NOT_FOUND' || (cloud.status === 'FOUND' && cloud.isBlocked)) {
            console.error(`[Licensing] Machine ${cloud.status === 'NOT_FOUND' ? 'SUPPRESSED' : 'BLOCKED'} during heartbeat. Deactivating...`)
            appSettings.isActivated = false
            appSettings.licenseKey = ''
            appSettings.expiryDate = null
            saveSettings({ isActivated: false, licenseKey: '', expiryDate: null })
            
            // Notify windows
            const windows = BrowserWindow.getAllWindows()
            const reason = cloud.status === 'NOT_FOUND' ? "Votre licence a été supprimée par l'administrateur." : "Votre machine a été bloquée à distance."
            windows.forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('license-deactivated', reason)
                }
            })
        }
    }, 3600000)
}

/**
 * [v1.9.30] Securely check admin password using hash.
 * Original password: DadiLicence2026
 */
function checkAdminPassword(password: string): boolean {
    if (!password) return false;
    const hash = crypto.createHash('md5').update(password).digest('hex');
    return hash === '4acdd67f9ac1a40125d427cae748ded5';
}

// Function to verify a license
function verifyLicense(key: string, machineId: string): { valid: boolean, expiry: string | null } {
  if (!key) return { valid: false, expiry: null }
  
  try {
    const cleanKey = key.trim()
    const cleanMid = machineId.trim().toUpperCase()

    // [v1.9.32] Support Master Admin Key
    if (cleanKey === 'DadiLicence2026') {
        return { valid: true, expiry: '2099-12-31T00:00:00.000Z' };
    }

    // [v1.6.9] Use # delimiter
    const parts = cleanKey.split('#')
    if (parts.length !== 3) {
        console.error('[Licensing] Invalid key format (wrong parts count)')
        return { valid: false, expiry: null }
    }
    
    const [id, expiry, hash] = parts
    const cleanId = id.trim().toUpperCase()
    
    // Check machine ID (case insensitive)
    if (cleanId !== cleanMid && !cleanId.startsWith('B-')) {
        console.error(`[Licensing] HWID Mismatch. Key ID: ${cleanId}, Machine ID: ${cleanMid}`)
        return { valid: false, expiry: null }
    }
    
    // Re-calculate hash (use normalized ID for consistency)
    const payload = `${cleanId}:${expiry}:${LICENSE_SALT}`
    const expectedHash = crypto.createHash('md5').update(payload).digest('hex').substring(0, 16).toUpperCase()
    
    if (hash !== expectedHash) {
        console.error('[Licensing] Signature Mismatch (Hash invalid)')
        return { valid: false, expiry: null }
    }
    
    // Check date
    const expiryDate = new Date(expiry)
    if (isNaN(expiryDate.getTime())) {
        console.error('[Licensing] Invalid expiry date format')
        return { valid: false, expiry: null }
    }
    
    const now = new Date()
    if (now > expiryDate) {
        console.error(`[Licensing] Key expired. Expiry: ${expiryDate}, Now: ${now}`)
        return { valid: false, expiry: null }
    }
    
    return { valid: true, expiry }
  } catch (e) {
    console.error('[Licensing] Error during verification:', e)
    return { valid: false, expiry: null }
  }
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
          headers: { 'User-Agent': 'DoulGet' }
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
    if (latestVersion === 'unknown') {
      console.warn('[yt-dlp] Could not fetch latest version (API limit?), skipping update check.')
      return
    }

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
    if (latestVersion !== 'unknown') {
      sendNotification('yt-dlp mis à jour', `Version ${latestVersion} installée`, false)
    }
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

/**
 * [v1.9.28] Fetch real world time from an online API to prevent local clock fraud.
 */
async function getOnlineTime(): Promise<Date | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'worldtimeapi.org',
      path: '/api/timezone/Etc/UTC',
      timeout: 5000
    }
    
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.datetime) {
            resolve(new Date(json.datetime))
          } else {
            resolve(null)
          }
        } catch (e) {
          resolve(null)
        }
      })
    }).on('error', () => {
      resolve(null)
    })
  })
}


// UTILITY + AUTO-DOWNLOAD: Ensure FFmpeg AND FFprobe are available
async function ensureFfmpegAvailable(win?: BrowserWindow): Promise<string | null> {
  // [v1.7.1] Return cached result immediately if already resolved
  if (_cachedFfmpegPath !== undefined) return _cachedFfmpegPath

  const userDataPath = app.getPath('userData')
  const platform = process.platform
  const isWindows = platform === 'win32'
  const isMac = platform === 'darwin'
  const isLinux = platform === 'linux'
  
  const binaries = isWindows 
    ? [{ name: 'ffmpeg.exe', url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n7.1-2/ffmpeg-win-x64.exe' },
       { name: 'ffprobe.exe', url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n7.1-2/ffprobe-win-x64.exe' }]
    : isMac
    ? [{ name: 'ffmpeg', url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n7.1-2/ffmpeg-osx-x64' },
       { name: 'ffprobe', url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n7.1-2/ffprobe-osx-x64' }]
    : isLinux
    ? [{ name: 'ffmpeg', url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n7.1-2/ffmpeg-linux-x64' },
       { name: 'ffprobe', url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n7.1-2/ffprobe-linux-x64' }]
    : []

  if (binaries.length === 0) return null

  const checkSystemPath = (binary: string) => {
    try {
      const which = isWindows ? 'where' : 'which'
      const result = execSync(`${which} ${binary}`, { encoding: 'utf8' }).trim()
      return result ? result.split('\n')[0].trim() : null
    } catch { return null }
  }

  // 1. Check if BOTH are in system PATH
  const sysFfmpeg = checkSystemPath('ffmpeg')
  const sysFfprobe = checkSystemPath('ffprobe')
  if (sysFfmpeg && sysFfprobe) {
    console.log('[FFmpeg] Found complete suite in system PATH')
    _cachedFfmpegPath = sysFfmpeg
    return _cachedFfmpegPath
  }

  // 2. Check/Download in UserData
  let missing = false
  for (const bin of binaries) {
     const targetPath = join(userDataPath, bin.name)
     if (!existsSync(targetPath)) {
        missing = true
        break
     }
  }

  if (!missing) {
     _cachedFfmpegPath = join(userDataPath, binaries[0].name)
     return _cachedFfmpegPath
  }

  // 3. Download missing binaries
  console.log(`[FFmpeg] Downloading binaries for ${platform}...`)
  try {
    const downloadFile = (url: string, dest: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const httpModule = url.startsWith('https') ? https : require('http')
        const file = fs.createWriteStream(dest)
        httpModule.get(url, (response: any) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            file.close()  // Close unused stream before following redirect
            const redirectUrl = response.headers.location!
            downloadFile(redirectUrl, dest).then(resolve).catch(reject)
            return
          }
          if (response.statusCode !== 200) {
            file.close(); fs.unlink(dest, () => {}); 
            reject(new Error(`HTTP ${response.statusCode}`))
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close()
            if (!isWindows) { try { fs.chmodSync(dest, 0o755) } catch(e){} }
            resolve()
          })
          file.on('error', (err: any) => { file.close(); fs.unlink(dest, () => {}); reject(err) })
        }).on('error', (err: any) => { file.close(); fs.unlink(dest, () => {}); reject(err) })
      })
    }

    for (const bin of binaries) {
       const targetPath = join(userDataPath, bin.name)
       if (!existsSync(targetPath)) {
          console.log(`[FFmpeg] Downloading ${bin.name}...`)
          await downloadFile(bin.url, targetPath)
       }
    }
    
    console.log('[FFmpeg] Successfully downloaded suite at:', userDataPath)
    if (win) {
      win.webContents.send('notification', {
        title: 'Composants Vidéo Prêts',
        body: 'FFmpeg et FFprobe installés pour une qualité maximale.'
      })
    }
    _cachedFfmpegPath = join(userDataPath, binaries[0].name)
    return _cachedFfmpegPath

  } catch (error) {
    console.error('[FFmpeg] Auto-download failed:', error)
    if (win) {
       win.webContents.send('notification', {
        title: 'Erreur Composants',
        body: 'Échec du téléchargement de FFmpeg/FFprobe.'
      })
    }
    _cachedFfmpegPath = null
    return null
  }
}

// [v1.7.2] High-Speed Engine: Ensure aria2c is available
async function ensureAria2Available(_win?: BrowserWindow): Promise<string | null> {
  if (_cachedAria2Path !== undefined) return _cachedAria2Path

  const userDataPath = app.getPath('userData')
  const isWindows = process.platform === 'win32'
  const binaryName = isWindows ? 'aria2c.exe' : 'aria2c'
  const targetPath = join(userDataPath, binaryName)

  const checkSystemPath = (binary: string) => {
    try {
      const which = isWindows ? 'where' : 'which'
      const result = execSync(`${which} ${binary}`, { encoding: 'utf8' }).trim()
      return result ? result.split('\n')[0].trim() : null
    } catch { return null }
  }

  // 1. Check system PATH
  const sysAria2 = checkSystemPath('aria2c')
  if (sysAria2) {
    _cachedAria2Path = sysAria2
    return _cachedAria2Path
  }

  // 2. Check local
  if (existsSync(targetPath)) {
    _cachedAria2Path = targetPath
    return _cachedAria2Path
  }

  // 3. Download Logic
  console.log(`[aria2c] Not found. Downloading specialized high-speed engine...`)
  try {
    const downloadUrl = isWindows 
      ? 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
      : process.platform === 'darwin'
      ? 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-osx-darwin.tar.bz2'
      : 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-linux-gnu-64bit-build1.tar.bz2'

    const tempZip = join(userDataPath, 'aria2_temp.zip')
    
    const downloadFile = (url: string, dest: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const httpModule = url.startsWith('https') ? https : require('http')
        httpModule.get(url, (response: any) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            downloadFile(response.headers.location!, dest).then(resolve).catch(reject)
            return
          }
          const file = fs.createWriteStream(dest)
          response.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      })
    }

    await downloadFile(downloadUrl, tempZip)

    if (isWindows) {
      // Use PowerShell to unzip only the executable
      const psCmd = `powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${userDataPath}' -Force; Get-ChildItem -Path '${userDataPath}' -Filter 'aria2c.exe' -Recurse | Move-Item -Destination '${targetPath}' -Force"`
      execSync(psCmd)
    } else {
      // Use tar for extraction
      execSync(`tar -xf "${tempZip}" -C "${userDataPath}" --strip-components 2 "*/aria2c"`)
    }
    
    if (existsSync(tempZip)) fs.unlinkSync(tempZip)

    if (existsSync(targetPath)) {
      if (!isWindows) fs.chmodSync(targetPath, 0o755)
      console.log('[aria2c] Turbo engine ready at:', targetPath)
      _cachedAria2Path = targetPath
      return targetPath
    }
    return null
  } catch (err) {
    console.error('[aria2c] Download failed:', err)
    _cachedAria2Path = null
    return null
  }
}

// Helper to ensure Node.js is available for YouTube "n" challenge solving
async function ensureNodeAvailable(_win?: BrowserWindow): Promise<string | null> {
  // [v1.7.1] Return cached result immediately if already resolved
  if (_cachedNodeDir !== undefined) return _cachedNodeDir as string | null

  const userDataPath = app.getPath('userData')
  const nodeBinary = process.platform === 'win32' ? 'node.exe' : 'node'
  const targetPath = join(userDataPath, nodeBinary)

  try {
    if (existsSync(targetPath)) {
      _cachedNodeDir = targetPath
      return targetPath
    }
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
        _cachedNodeDir = targetPath
        return targetPath
      }
    } catch (error) {
      console.error('[Node.js] Auto-download/Extraction failed:', error)
    }
  } else if (process.platform === 'win32') {
    console.log('[Node.js] Not found. Downloading portable Node.js v18 for Windows...')
    const downloadUrl = 'https://nodejs.org/dist/v18.20.0/win-x64/node.exe'

    try {
      const download = async (url: string, dest: string): Promise<any> => {
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(dest)
          https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
              download(response.headers.location!, dest).then(resolve).catch(reject)
              return
            }
            if (response.statusCode !== 200) {
              reject(new Error(`Failed to download: ${response.statusCode}`))
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

      await download(downloadUrl, targetPath)
      if (fs.existsSync(targetPath)) {
        console.log('[Node.js] Portable Node.js v18 (Windows) installed at:', targetPath)
        _cachedNodeDir = targetPath
        return targetPath
      }
    } catch (error) {
      console.error('[Node.js] Windows download failed:', error)
    }
  } else if (process.platform === 'linux') {
    console.log('[Node.js] Not found. Downloading portable Node.js v18 for Linux...')
    const downloadUrl = 'https://nodejs.org/dist/v18.20.0/node-v18.20.0-linux-x64.tar.xz'
    const tempTarPath = targetPath + '.tar.xz'

    try {
      // Use core download logic
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
      console.log('[Node.js] Downloaded tar.xz (v18), extracting...')

      // Use tar to extract only the node binary
      execSync(`tar -xJf "${tempTarPath}" -C "${userDataPath}" --strip-components 2 "node-v18.20.0-linux-x64/bin/node"`)
      fs.unlinkSync(tempTarPath)

      if (fs.existsSync(targetPath)) {
        fs.chmodSync(targetPath, 0o755)
        console.log('[Node.js] Portable Node.js v18 (Linux) installed at:', targetPath)
        return targetPath
      }
    } catch (error) {
      console.error('[Node.js] Linux download/extraction failed:', error)
    }
  }

  return null
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    return
  }
  console.log('[DEBUG] createWindow() called')
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false, // Default to false, show on 'ready-to-show'
    title: 'DoulGet',
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

  // Diagnostic listeners
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('[DEBUG] Page started loading...')
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[DEBUG] Main window finished loading successfully')
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[DEBUG] LOAD FAILED: ${validatedURL} | Error: ${errorDescription} (${errorCode})`)
    mainWindow?.setTitle(`DoulGet - ERROR: ${errorDescription}`)
  })

  // Use render-process-gone
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[DEBUG] Renderer CRASHED: ${details.reason} (ExitCode: ${details.exitCode})`)
    if (details.reason !== 'killed') {
      console.log('[DEBUG] Attempting reload after crash...')
      mainWindow?.reload()
    }
  })

  mainWindow.on('ready-to-show', () => {
    console.log('[DEBUG] Window ready-to-show event fired')
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the remote URL for development or the local html file for production.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    mainWindow?.loadURL(devUrl)
    mainWindow?.webContents.openDevTools()
    // [DEBUG] Force show after short delay in case ready-to-show fails
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        console.log('[DEBUG] Force showing window (ready-to-show timeout)')
        mainWindow.show()
      }
    }, 3000)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    console.log('[DEBUG] Detected Prod Mode - Loading File:', htmlPath)
    mainWindow.loadFile(htmlPath)
  }

  // Activer l'extension de capture de téléchargements (style IDM)

  mainWindow.webContents.session.on('will-download', (_event, item, _webContents) => {
    const url = item.getURL()
    const now = Date.now()

    // Create tracker for this download - [v1.7.0] Composite
    const isAudio = url.toLowerCase().endsWith('.mp3') || url.toLowerCase().endsWith('.m4a')
    const trackerId = getTrackerId(url, isAudio)
    const tracker: DownloadTracker = {
      item,
      url,
      startTime: now,
      lastBytes: 0,
      lastTime: now,
      audioOnly: isAudio
    }

    activeDownloads.set(trackerId, tracker)

    item.on('updated', (_event, state) => {
      const isAudio = item.getURL().toLowerCase().endsWith('.mp3') || item.getURL().toLowerCase().endsWith('.m4a')
      const trackerId = getTrackerId(item.getURL(), isAudio)
      const tracker = activeDownloads.get(trackerId)
      if (!tracker) return

      const now = Date.now()
      const receivedBytes = item.getReceivedBytes()
      const totalBytes = item.getTotalBytes()

      if (state === 'interrupted') {
        mainWindow?.webContents.send('download-progress', {
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
          mainWindow?.webContents.send('download-progress', {
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

          mainWindow?.webContents.send('download-progress', {
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
          mainWindow?.webContents.send('download-complete', {
            filename: item.getFilename(),
            url: item.getURL(),
            state: 'finished',
            savePath: item.getSavePath()
          })
        } else {
          mainWindow?.webContents.send('download-complete', {
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

// Função para baixar ffmpeg automaticamente
// [v1.6.3] Helper to generate unique filename (e.g. file(1).mp4)
function getUniqueFilename(directory: string, filename: string): string {
  // Ensure path is imported (it is imported at top of file, but just in case TS complains about scope)
  const path = require('path')
  const fs = require('fs')

  if (!fs.existsSync(join(directory, filename))) return filename

  const ext = path.extname(filename)
  const name = path.basename(filename, ext)
  let counter = 1
  let newFilename = `${name}(${counter})${ext}`

  while (fs.existsSync(join(directory, newFilename))) {
    counter++
    newFilename = `${name}(${counter})${ext}`
  }
  return newFilename
}

// Fonction de téléchargement multi-thread (Style IDM)
// pour fichiers directs
// [v1.6.5] Utility Helpers
function formatSpeed(speed: number): string {
  if (!speed) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let unitIndex = 0
  while (speed >= 1024 && unitIndex < units.length - 1) {
    speed /= 1024
    unitIndex++
  }
  return `${speed.toFixed(2)} ${units[unitIndex]}`
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// [v1.8.9] Utility to sanitize strings for filenames (ASCII only to avoid Windows encoding issues)
function sanitizeStringForFilename(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')                     // Split accented characters into base + accent
    .replace(/[\u0300-\u036f]/g, '')     // Remove accents
    .replace(/[^\x00-\x7F]/g, ' ')       // Remove any remaining non-ASCII
    .replace(/[<>:"\/\\|?*]/g, ' ')      // Remove Windows illegal characters
    .replace(/\s+/g, ' ')                // Collapse multiple spaces
    .trim();
}

function calculateETA(remainingBytes: number, speed: number): string {
  if (speed <= 0) return '--'
  const seconds = remainingBytes / speed
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}
// [v1.9.7] STEALTH MODE: Hide/Show file attributes on Windows
function hideFile(filePath: string) {
  if (process.platform === 'win32') {
    const { exec } = require('child_process');
    exec(`attrib +h "${filePath}"`, (err) => {
      if (err) console.error(`[Stealth] Failed to hide ${filePath}:`, err);
    });
  }
}

function unhideFile(filePath: string) {
  if (process.platform === 'win32') {
    const { exec } = require('child_process');
    exec(`attrib -h "${filePath}"`, (err) => {
      if (err) console.error(`[Stealth] Failed to unhide ${filePath}:`, err);
      else console.log(`[Stealth] Revealed ${filePath}`);
    });
  }
}

// [v1.7.7] Debris Cleanup Utility: Removes .part, .part-Frag, .ytdl files
function cleanupDebris(directory: string, baseName: string) {
  const fs = require('fs')
  const path = require('path')
  try {
    if (!fs.existsSync(directory)) return
    const files = fs.readdirSync(directory)
    // Clean base name to match more effectively
    const cleanBase = baseName.replace(/\.(mp4|mp3|webm|m4a|mkv)$/i, '').trim()
    const baseFirstPart = cleanBase.substring(0, 15); // Match first 15 chars for safety
    
    for (const file of files) {
      // [v1.9.6] AGGRESSIVE FRAGMENT CLEANUP
      // Matches: 
      // 1. File starts with cleanBase AND has .part, .ytdl, or .part-Frag
      // 2. OR filename contains part-Frag AND matches a significant part of cleanBase
      // 3. OR filename ends with .part.frag.urls (aria2c temp file)
      const isDebris = 
        (file.startsWith(cleanBase) && (file.endsWith('.part') || file.endsWith('.ytdl') || file.includes('.part-Frag'))) ||
        (file.includes('part-Frag') && file.includes(baseFirstPart)) ||
        (file.includes(baseFirstPart) && file.endsWith('.urls'))

      if (isDebris) {
        try {
          fs.unlinkSync(path.join(directory, file))
          console.log(`[Cleanup] Removed debris: ${file}`)
        } catch (e) {
          // Locked file or already gone
        }
      }
    }
  } catch (e) {
    console.error('[Cleanup] Error during debris scan:', e)
  }
}

// [v1.8.6] Smart Series Metadata Extractor (SxxExx)
function extractSeriesMetadata(texts: string[]): string | null {
  const patterns = [
    /S(\d+)[._-\s]?E(\d+)/i,          // S01E05, S1_E5
    /S(\d+)[\s]?Ep[._-\s]?(\d+)/i,    // S1 Ep 5
    /Saison[._-\s]?(\d+)[._-\s]?Episode[._-\s]?(\d+)/i, // Saison 1 Episode 5
    /Season[._-\s]?(\d+)[._-\s]?Episode[._-\s]?(\d+)/i, // Season 1 Episode 5
    /(\d+)x(\d+)/i,                   // 1x05
    /Ep[._-\s]?(\d+)/i,               // Ep 05
    /Episode[._-\s]?(\d+)/i           // Episode 5
  ];

  for (const text of texts) {
    if (!text) continue;
    
    // [v1.9.24] If ANY text already contains a metadata tag (like S01E02, _E03, _S01E01), skip ALL enrichment
    if (/S\d+E\d+/i.test(text)) return null;

    // [v1.9.32] Domain-based override for known film sites
    const urlLower = text.toLowerCase();
    if (urlLower.includes('palkad') && !urlLower.includes('saison') && !urlLower.includes('series')) {
        return null; 
    }

    // [v1.9.0] AGGRESSIVE RANGE PROTECTION: Strip ranges like S1-S4, S1-10 to avoid picking them up as single numbers
    // [v1.9.1] Optimization: Capture the first season of the range as a hint
    let fallbackS: string | null = null;
    const rangeMatch = text.match(/\bS(\d+)[-]?S?\d+/i) || text.match(/\bSaison\s?(\d+)[-]?\d+/i);
    if (rangeMatch) fallbackS = rangeMatch[1].padStart(2, '0');

    // [v1.9.6] AGGRESSIVE ID PROTECTION: Ignore long numeric strings (likely IDs, not episodes)
    // Also ignore text that looks like a URL parameter value if it's purely numeric
    let cleanText = text.replace(/\bS\d+[-]?S?\d+/gi, ' ').replace(/\bSaison\s?\d+[-]?\d+/gi, ' ');
    
    // If text contains ? or &, it's likely a URL or Referer. Split it to only check path/title parts.
    if (cleanText.includes('?') || cleanText.includes('&')) {
      // Split by URL separators and take the parts that aren't likely IDs
      const parts = cleanText.split(/[?&/]/);
      cleanText = parts.filter(p => !p.includes('=') && p.length < 15).join(' ');
    }

    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        if (match[2]) {
          // Season + Episode found
          const s = match[1].padStart(2, '0');
          let e = match[2];
          // [v1.4.3] Normalize: if already 2+ digits, don't pad. If 1 digit, pad to 2.
          if (e.length === 1) e = e.padStart(2, '0');
          // [v1.9.24] Block placeholder S00/E00
          if (s === '00' || e === '00') continue;
          return `S${s}E${e}`;
        } else {
          // Only Episode found
          let e = match[1];
          // [v1.4.3] Avoid double padding (ignore if already 2+)
          if (e.length === 1) e = e.padStart(2, '0');
          if (e === '00') continue;
          const s = fallbackS || '01'; 
          return `S${s}E${e}`;
        }
      }
    }
    
    // [v1.9.1] Final Fallback: If we only have an episode left in the string (e.g. _E08)
    // [v1.9.17] FIXED: Removed loose \b(\d{1,3})\b fallback which caused false positives on YouTube titles like "(v1-52)"
    const epOnlyMatch = cleanText.match(/_?E(\d{1,3})\b/i);
    if (epOnlyMatch && epOnlyMatch[1]) {
       const e = epOnlyMatch[1].padStart(2, '0');
       const s = fallbackS || '01';
       return `S${s}E${e}`;
    }
  }
  return null;
}

// [v1.6.5] Helper: Get File Info with Redirect Handling
// [v1.6.5] Helper: Get File Info with Redirect Handling
async function getFileInfoWithRedirects(url: string, headers: any, tracker: any): Promise<{ size: number, supportsRange: boolean, filename: string, mimeType: string, finalUrl: string }> {
  const https = require('https')
  const http = require('http')
  const protocol = url.startsWith('https') ? https : http
  const urlObj = new URL(url)

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'HEAD',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers
    }
  }

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let newUrl = res.headers.location
        if (newUrl.startsWith('/')) {
          newUrl = new URL(newUrl, url).toString()
        }
        console.log(`[HEAD] Following redirect (${res.statusCode}) to: ${newUrl}`)
        getFileInfoWithRedirects(newUrl, headers, tracker).then(resolve).catch(reject)
        return
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10)
      const acceptsRanges = res.headers['accept-ranges'] === 'bytes'
      const contentDisposition = res.headers['content-disposition'] || ''
      const mimeType = res.headers['content-type'] || 'application/octet-stream'

      const mimeMap: { [key: string]: string } = {
        'application/pdf': '.pdf',
        'application/zip': '.zip',
        'application/x-zip-compressed': '.zip',
        'application/x-rar-compressed': '.rar',
        'application/x-7z-compressed': '.7z',
        'application/x-tar': '.tar',
        'application/x-gzip': '.gz',
        'application/x-iso9660-image': '.iso',
        'application/octet-stream': '',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'video/x-matroska': '.mkv',
        'audio/mpeg': '.mp3',
        'audio/ogg': '.ogg',
        'audio/wav': '.wav',
        'application/x-msdos-program': '.exe',
        'application/x-msdownload': '.exe',
        'application/vnd.android.package-archive': '.apk',
        'application/x-msi': '.msi'
      }

      let filename = tracker?.filename || 'download'

      // [v1.6.7] Enhanced Generic Filename Detection
      // Include script-like extensions (.php, .aspx, .cfm, .jsp) as generic names that should be replaced if better info exists.
      const isGenericFilename = !tracker?.filename ||
        tracker.filename === 'download' ||
        tracker.filename.match(/^download_\d+$/) ||
        tracker.filename.toLowerCase().endsWith('.php') ||
        tracker.filename.toLowerCase().endsWith('.aspx') ||
        tracker.filename.toLowerCase().endsWith('.jsp') ||
        tracker.filename.toLowerCase().endsWith('.cfm')

      if (isGenericFilename || contentDisposition) {
        if (contentDisposition) {
          const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;=\n]*)/i)
          const standardMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
          if (utf8Match) {
            filename = decodeURIComponent(utf8Match[1])
          } else if (standardMatch) {
            filename = standardMatch[1].replace(/['"]/g, '')
          }
        }
        
        // If still generic or empty, try extracting from URL (the final resolved URL)
        const finalUrlObj = new URL(url)
        if ((!filename || filename === 'download' || isGenericFilename) && !contentDisposition) {
          const urlFilename = finalUrlObj.pathname.split('/').pop()
          // Ensure the extracted filename is not a script if we are looking for a better name
          if (urlFilename && !urlFilename.includes('=') && !urlFilename.toLowerCase().endsWith('.php')) {
            filename = urlFilename
          }
        }
      }

      let sanitizedFilename = filename || 'download'
      const cleanMime = mimeType ? mimeType.split(';')[0].toLowerCase().trim() : 'application/octet-stream'
      const expectedExt = mimeMap[cleanMime]
      const hasExt = /\.[a-z0-9]+$/i.test(sanitizedFilename)

      if (!hasExt && expectedExt) sanitizedFilename += expectedExt
      else if (hasExt && expectedExt) {
        // [v1.9.32] Logic check: If extension is .mp4 (often forced by extension incorrectly)
        // but MIME says it's a known document type (PDF/ZIP), correct it.
        const currentExt = sanitizedFilename.split('.').pop()?.toLowerCase();
        if ((currentExt === 'mp4' || currentExt === 'mp3') && expectedExt !== '.' + currentExt && cleanMime !== 'application/octet-stream') {
           console.log(`[HEAD] Correcting suspicious extension: .${currentExt} -> ${expectedExt} based on MIME ${cleanMime}`);
           sanitizedFilename = sanitizedFilename.substring(0, sanitizedFilename.lastIndexOf('.')) + expectedExt;
        }
      }
      else if (!hasExt) {
        const urlExtMatch = urlObj.pathname.match(/\.[a-z0-9]+$/i)
        if (urlExtMatch) sanitizedFilename += urlExtMatch[0]
      }

      if (process.platform === 'win32') {
        sanitizedFilename = sanitizedFilename.replace(/[<>:"/\\|?*]/g, '_').replace(/[\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '')
        if (!sanitizedFilename || sanitizedFilename === '_') sanitizedFilename = 'download'
      }

      // [v1.6.6] Return finalUrl (the resolved URL after redirects)
      resolve({ size: contentLength, supportsRange: acceptsRanges, filename: sanitizedFilename, mimeType: mimeType, finalUrl: url })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')) }) // [v1.7.1] Reduced from 10s→5s
    req.end()
  })
}

// [v1.6.5] Helper: Single Stream Download with Redirects
function downloadSingleStreamWithRedirects(url: string, filePath: string, headers: any, tracker: any, win: BrowserWindow, resolvePromise: Function, rejectPromise: Function) {
  const fs = require('fs')
  const https = require('https')
  const http = require('http')

  // [v1.6.5] Basic protocol check 
  const protocol = url.startsWith('https') ? https : http
  let urlObj: URL
  try {
    urlObj = new URL(url)
  } catch (e) {
    return rejectPromise(new Error('Invalid URL'))
  }

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers
    }
  }

  const req = protocol.request(options, (res: any) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let newUrl = res.headers.location
      if (newUrl.startsWith('/')) {
        newUrl = new URL(newUrl, url).toString()
      }
      console.log(`[SingleStream] Following redirect (${res.statusCode}) to: ${newUrl}`)
      req.destroy()
      downloadSingleStreamWithRedirects(newUrl, filePath, headers, tracker, win, resolvePromise, rejectPromise)
      return
    }

    if (res.statusCode >= 400) {
      rejectPromise(new Error(`HTTP ${res.statusCode}`))
      return
    }

    const totalSize = parseInt(res.headers['content-length'] || '0', 10)
    let downloaded = 0
    const fileStream = fs.createWriteStream(filePath)
    res.pipe(fileStream)

    res.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      if (tracker && !tracker.paused && !tracker.cancelled) {
        const progress = totalSize > 0 ? (downloaded / totalSize) * 100 : 0
        const speed = (downloaded - tracker.lastBytes) / ((Date.now() - tracker.lastTime + 1) / 1000)
        tracker.lastProgress = Math.round(progress)
        tracker.lastBytes = downloaded
        tracker.lastTime = Date.now()

        const isComplete = tracker.lastProgress >= 100
        const shouldSendUpdate = !tracker.lastProgressSent || (Date.now() - tracker.lastProgressSent) >= 150
        if (shouldSendUpdate || isComplete) {
          tracker.lastProgressSent = Date.now()
          const sizeStr = formatSize(downloaded) + (totalSize > 0 ? ' / ' + formatSize(totalSize) : '')
          win.webContents.send('download-progress', {
            url: tracker.originalUrl || url,
            filename: tracker.filename || 'download',
            progress: tracker.lastProgress,
            receivedBytes: downloaded,
            totalBytes: totalSize,
            state: 'downloading',
            speed: formatSpeed(speed),
            timeLeft: calculateETA(totalSize - downloaded, speed),
            size: sizeStr,
            originalUrl: tracker.originalUrl || url,
            canResume: true,
            savePath: tracker.savePath
          })
        }
      }
    })

    res.on('end', () => {
      fileStream.close()
      // Try calling handleDownloadEnd if available in scope
      try { handleDownloadEnd(tracker?.originalUrl || url) } catch (e) { }
      if (tracker) tracker.status = 'completed'
      win.webContents.send('download-complete', { url: tracker?.originalUrl || url, filePath })
      resolvePromise()
    })

    res.on('error', (err: any) => {
      fileStream.close()
      fs.unlink(filePath, () => { })
      win.webContents.send('download-error', { url, error: err.message })
      rejectPromise(err)
    })
  })
  req.on('error', (err) => {
    win.webContents.send('download-error', { url, error: err.message })
    rejectPromise(err)
  })
  req.end()
}

// Fonction de téléchargement multi-thread (Style IDM)
// pour fichiers directs
async function downloadWithMultiThreading(url: string, savePath: string, win: BrowserWindow, audioOnly: boolean = false) {
  try {
    const https = require('https')
    const http = require('http')
    const urlObj = new URL(url)
    const protocol = urlObj.protocol === 'https:' ? https : http
    // [v1.7.3] Dynamic thread count based on URL sensitivity
    let numThreads = 32 // ULTRA: Default 32 parallel connections
    const hasSignature = /[?&](sign|token|expires?|t)=/i.test(url)
    const isSensitiveDomain = url.includes('hakunaymatata.com') || url.includes('moovbob.fr') || url.includes('sibnet.ru')
    
    if (hasSignature || isSensitiveDomain) {
      numThreads = 8 // Reduce to 8 threads for signed or sensitive URLs to avoid ECONNRESET
      console.log(`[MultiThread] Sensitive URL detected, reducing threads to ${numThreads}`)
    }

    // [v1.7.2] PERFORMANCE: Persistent keep-alive agents to avoid TCP+TLS handshake per segment
    const agentOptions = { keepAlive: true, maxSockets: 64, maxFreeSockets: 32, timeout: 30000 }
    const keepAliveAgent = urlObj.protocol === 'https:'
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions)

    // Get headers from tracker
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = activeDownloads.get(trackerId)
    const requestHeaders = tracker?.headers || {}

    // Étape 1: Obtenir la taille du fichier et vérifier le support Range
    // [v1.6.5] Use extracted helper with redirect support
    const fileInfo = await getFileInfoWithRedirects(url, requestHeaders, tracker)

    // Check content type to avoid downloading HTML pages
    if (
      fileInfo.mimeType &&
      (fileInfo.mimeType.includes('text/html') || fileInfo.mimeType.includes('application/json'))
    ) {
      console.warn('Detected invalid content type:', fileInfo.mimeType)
      // [v1.7.3] For Moovbob/Sensitive domains, if we hit an HTML page, try forcing yt-dlp 
      // instead of just throwing. yt-dlp is better at extracting the real video from iframes.
      if (isSensitiveDomain || url.includes('iframe') || url.includes('sibnet')) {
        console.log('[MultiThread] Invalid content type on sensitive domain, attempting yt-dlp fallback...')
        throw new Error('FALLBACK_TO_YTDLP') 
      }
      throw new Error(`Invalid content type: ${fileInfo.mimeType}. Likely an error page.`)
    }

    // [v1.2.9] RESUME LOGIC: If a filename is already associated with this download, use it.
    // This prevents creating "video(1).mp4" upon resuming a paused download.
    const baseFilename = tracker?.filename || fileInfo.filename || 'download.mp4'
    const uniqueFilename = (tracker?.filename && fs.existsSync(join(savePath, tracker.filename + '.part'))) 
      ? tracker.filename 
      : getUniqueFilename(savePath, baseFilename)

    // Update tracker with actual filename
    if (tracker) tracker.filename = uniqueFilename

    if (!fileInfo.supportsRange || fileInfo.size === 0) {
      const filePath = join(savePath, uniqueFilename)
      return new Promise<void>((resolve, reject) => {
        if (tracker) tracker.originalUrl = url
        // [v1.6.6] Use finalUrl for fallback download
        downloadSingleStreamWithRedirects(fileInfo.finalUrl || url, filePath, requestHeaders, tracker, win, resolve, reject)
      })
    }
    /* [v1.6.5] OLD FALLBACK DISABLED (Dead Code Wrapper)
    if (false) {
      // FALLBACK: Téléchargement simple en flux unique AVEC LES HEADERS
      const fs = require('fs')
      const filePath = join(savePath, uniqueFilename)
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
        // [v1.6.5] Handle Redirects in Single Stream Fallback
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const newUrl = new URL(res.headers.location, url).toString()
          console.log(`[SingleStream] Following redirect (${res.statusCode}) to: ${newUrl}`)
          // Close current stream/req and RESTART download with new URL
          req.destroy()
          // Recursively calling download processing for new URL would be complex here due to state.
          // Instead, we should probably update the URL and Retry? 
          // EASIER: Just make a new request inside this block? No, recursion is risky if headers leak.
          // WE WILL CALL A HELPER OR JUST RE-EXECUTE THE REQUEST LOGIC?
          // Actually, `downloadWithMultiThreading` is called with a specific URL. 
          // If we redirect, we should just essentially "restart" the single download logic with new URL.
          // But we are deep inside.
          // SIMPLEST: Throw a special error or handle it inline? 
          // Inline recursive simple download:

          // UNLINK the empty file created so far
          fileStream.close()
          fs.unlink(filePath, () => { })

          // We need to update the tracker URL mapping or just process the new URL.
          // But `downloadWithMultiThreading` expects `url` to vary.
          // Let's call `downloadWithMultiThreading(newUrl, savePath, numThreads)`? 
          // No, that might create a NEW tracker entry and abandon this one.
          // We want to KEEP the current tracker UI but fetch data from new URL.

          // Hack: Just re-do the specific single-stream request here?
          // Better: Update `options` and make a new request?
          // Let's try to just re-call the request construction with new URL options.
          // But we need to handle headers.

          // For now, let's just do a simple handling: follow the redirection by re-requesting.
          const newOptions = {
            ...options,
            hostname: new URL(newUrl).hostname,
            path: new URL(newUrl).pathname + new URL(newUrl).search,
            port: new URL(newUrl).port || (new URL(newUrl).protocol === 'https:' ? 443 : 80)
          }

          // Recursion for redirection (limit 5?) - omitted for brevity but implied risk.
          // We'll just define a helper function for the request to make it clean?
          // No, let's keep it inline but clean.

          const redirectReq = (require(newUrl.startsWith('https') ? 'https' : 'http')).request(newOptions, (redirectRes: any) => {
            if (redirectRes.statusCode >= 300 && redirectRes.statusCode < 400 && redirectRes.headers.location) {
              // Double redirect? Abort for safety or handle loop.
              fileStream.close()
              fs.unlink(filePath, () => { })
              throw new Error('Too many redirects')
            }
            // Pipe the REAL response
            const totalSize = parseInt(redirectRes.headers['content-length'] || '0', 10)
            let downloaded = 0

            // Re-open file stream? It was closed.
            const newFileStream = fs.createWriteStream(filePath)
            redirectRes.pipe(newFileStream)

              redirectRes.on('data', (chunk: Buffer) => {
                downloaded += chunk.length
                const trackerIdInner = getTrackerId(url, audioOnly)
                const tracker = activeDownloads.get(trackerIdInner)
                if (tracker && !tracker.paused && !tracker.cancelled) {
                const progress = totalSize > 0 ? (downloaded / totalSize) * 100 : 0
                const speed = (downloaded - tracker.lastBytes) / ((Date.now() - tracker.lastTime) / 1000)
                tracker.lastProgress = Math.round(progress)
                tracker.lastBytes = downloaded
                tracker.lastTime = Date.now()
                win.webContents.send('download-progress', {
                  url: url, // KEEP ORIGINAL URL FOR UI
                  audioOnly, // [v1.7.0] Distinguish format
                  progress: tracker.lastProgress,
                  speed: formatSpeed(speed),
                  size: formatSize(downloaded) + (totalSize > 0 ? ' / ' + formatSize(totalSize) : ''),
                  eta: calculateETA(totalSize - downloaded, speed),
                  savePath: savePath // [v1.4.6]
                })
              }
            })

            redirectRes.on('end', () => {
              newFileStream.close()
              const trackerIdInner = getTrackerId(url, audioOnly)
              const tracker = activeDownloads.get(trackerIdInner)
              if (tracker) tracker.status = 'completed' // [v1.2.8] Fix completion state
              resolve()
            })

            redirectRes.on('error', (err) => {
              newFileStream.close()
              reject(err)
            })
          })

          redirectReq.on('error', reject)
          redirectReq.end()
          return;
        }

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
          const trackerIdInner = getTrackerId(url, audioOnly)
          const tracker = activeDownloads.get(trackerIdInner)
          if (tracker && !tracker.paused && !tracker.cancelled) {
            const progress = totalSize > 0 ? (downloaded / totalSize) * 100 : 0
            const speed =
              (downloaded - tracker.lastBytes) / ((Date.now() - tracker.lastTime) / 1000)
            tracker.lastProgress = Math.round(progress)
            tracker.lastBytes = downloaded
            tracker.lastTime = Date.now()

            // THROTTLE: Only send progress updates every 150ms to avoid UI shake
            const isComplete = tracker.lastProgress >= 100
            const shouldSendUpdate = !tracker.lastProgressSent || (Date.now() - tracker.lastProgressSent) >= 150

            if (shouldSendUpdate || isComplete) {
              tracker.lastProgressSent = Date.now()
              win.webContents.send('download-progress', {
                url,
                filename: fileInfo.filename,
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
    } */

    // Étape 2: Diviser le fichier en segments et télécharger en parallèle
    // [v1.2.9] AUTO-DYNAMIC CONNECTIONS ⚡
    // If file is large enough, perform a quick speed test (512KB) to decide if we use multi-threading
    if (fileInfo.size > 1024 * 1024) { // Only test if file > 1MB
      console.log('[MultiThread] Testing connection speed...')
      const testStart = Date.now()
      const testResult = await new Promise<{ speed: number }>((resolve) => {
        let testDownloaded = 0
        const testOptions = {
          hostname: new URL(fileInfo.finalUrl || url).hostname,
          path: new URL(fileInfo.finalUrl || url).pathname + new URL(fileInfo.finalUrl || url).search,
          method: 'GET',
          headers: {
            Range: 'bytes=0-524288',
            'User-Agent': tracker?.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...requestHeaders
          }
        }
        const testReq = protocol.request(testOptions, (res: any) => {
          res.on('data', (chunk: Buffer) => { testDownloaded += chunk.length })
          res.on('end', () => {
            const duration = (Date.now() - testStart) / 1000
            const speed = testDownloaded / (duration || 0.1)
            resolve({ speed })
          })
          res.on('error', () => resolve({ speed: 0 }))
        })
        testReq.on('error', () => resolve({ speed: 0 }))
        testReq.setTimeout(5000, () => { testReq.destroy(); resolve({ speed: 0 }) })
        testReq.end()
      })

      if (testResult.speed < 150 * 1024) { // If speed < 150 KB/s
        numThreads = 1
        console.log(`[MultiThread] Slow connection detected (${Math.round(testResult.speed / 1024)} KB/s), forced to 1 connection.`)
      } else {
        console.log(`[MultiThread] Fast connection detected (${Math.round(testResult.speed / 1024)} KB/s), using ${numThreads} connections.`)
      }
    }

    // [v1.2.9] IDM Optimization: Use local temp directory on the SAME disk
    const tempDir = join(savePath, '.doulget_tmp');
    if (!fs.existsSync(tempDir)) {
      try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) { }
    }

    const segmentSize = Math.ceil(fileInfo.size / numThreads)
    const finalPath = join(savePath, uniqueFilename)
    const tempFilePath = join(tempDir, uniqueFilename + '.part')
    
    // [v1.7.2] PERFORMANCE: Pre-allocate file to allow parallel offset writing
    fs.writeFileSync(tempFilePath, '')

    // Initialize segment progress tracking
    if (tracker) {
      tracker.segmentProgress = new Array(numThreads).fill(0)
      tracker.statusMessage = 'Downloading segments...'
    }

    await Promise.all(
      Array.from({ length: numThreads }, async (_, index) => {
        return new Promise<void>((resolve, reject) => {
          const start = index * segmentSize
          const end = index === numThreads - 1 ? fileInfo.size - 1 : start + segmentSize - 1
          const expectedSegmentSize = end - start + 1
          let segmentDownloaded = 0

          const options = {
            hostname: new URL(fileInfo.finalUrl || url).hostname,
            port: new URL(fileInfo.finalUrl || url).port || (new URL(fileInfo.finalUrl || url).protocol === 'https:' ? 443 : 80),
            path: new URL(fileInfo.finalUrl || url).pathname + new URL(fileInfo.finalUrl || url).search,
            method: 'GET',
            agent: keepAliveAgent, // [v1.7.1] Reuse TCP connections
            headers: {
              Range: `bytes=${start}-${end}`,
              'User-Agent': tracker?.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...requestHeaders
            }
          }

          const fileStream = fs.createWriteStream(tempFilePath, { 
            flags: 'r+', 
            start: start,
            highWaterMark: 1024 * 1024 // [v1.7.2] 1MB Buffer for faster disk I/O
          })

          const req = protocol.request(options, (res: any) => {
            const trackerStart = activeDownloads.get(url)
            if (trackerStart?.paused || trackerStart?.cancelled) {
              req.destroy()
              resolve()
              return
            }

              if (res.statusCode !== 206) {
                console.error(`[Segment ${index}] Expected 206 but got ${res.statusCode}`)
                req.destroy()
                fileStream.close()
                reject(new Error(`Server does not support partial content (HTTP ${res.statusCode})`))
                return
              }

              res.on('data', (chunk: Buffer) => {
                const trackerData = activeDownloads.get(url)
                if (trackerData?.paused || trackerData?.cancelled) {
                  req.destroy()
                  fileStream.close()
                  resolve()
                  return
                }
                
                // Write directly to disk at the correct offset
                fileStream.write(chunk)
                segmentDownloaded += chunk.length

              const tracker = activeDownloads.get(url)
              if (tracker && !tracker.paused && !tracker.cancelled) {
                // Update specific segment progress
                if (tracker.segmentProgress) {
                  tracker.segmentProgress[index] = Math.round((segmentDownloaded / expectedSegmentSize) * 100)
                }

                tracker.lastBytes += chunk.length

                // Calculate progress based on total size
                const progress = (tracker.lastBytes / fileInfo.size) * 100
                tracker.lastProgress = Math.min(Math.round(progress), 100)

                // Speed calculation
                const now = Date.now()
                const elapsedSinceLast = (now - tracker.lastTime + 1) / 1000
                const speed = chunk.length / elapsedSinceLast
                tracker.lastTime = now

                const isComplete = tracker.lastProgress >= 100
                const displaySpeed = isComplete ? 0 : speed
                const displayState = isComplete ? 'downloading' : 'downloading' // Keep downloading until merging

                // THROTTLE: Only send progress updates every 150ms to avoid UI shake
                const shouldSendUpdate = !tracker.lastProgressSent || (Date.now() - tracker.lastProgressSent) >= 150

                if (shouldSendUpdate || isComplete) {
                  tracker.lastProgressSent = Date.now()
                  win.webContents.send('download-progress', {
                    filename: fileInfo.filename,
                    url: url,
                    progress: tracker.lastProgress,
                    receivedBytes: tracker.lastBytes,
                    totalBytes: fileInfo.size,
                    state: displayState,
                    speed: displaySpeed,
                    timeLeft: '--',
                    originalUrl: url,
                    canResume: true,
                    savePath: tracker.savePath, // [v1.4.6] CRITICAL: Include savePath for persistence
                    segmentProgress: tracker.segmentProgress ? [...tracker.segmentProgress] : undefined,
                    statusMessage: tracker.statusMessage
                  })
                }
              }
            })

            res.on('end', () => {
              const trackerEnd = activeDownloads.get(url)
              if (trackerEnd?.paused || trackerEnd?.cancelled) {
                fileStream.close()
                resolve()
                return
              }
              
              fileStream.end(() => {
                // Mark segment as 100% just in case
                if (trackerEnd && trackerEnd.segmentProgress) {
                  trackerEnd.segmentProgress[index] = 100
                }
                resolve()
              })
            })

            res.on('error', (err: any) => {
              console.error(`[Segment ${index}] Response error:`, err)
              reject(err)
            })
          })

          req.on('error', (err: any) => {
            console.error(`[Segment ${index}] Request error:`, err)
            reject(err)
          })

          // Add timeout to prevent hangs
          req.setTimeout(30000, () => {
            console.error(`[Segment ${index}] Timeout reached`)
            req.destroy()
            reject(new Error(`Timeout downloading segment ${index}`))
          })

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

    if (trackerFinal?.paused) return

    // Inform user that we are finalizing
    if (trackerFinal) {
      trackerFinal.statusMessage = 'Finalizing: Zero-copy output ready.'
      win.webContents.send('download-progress', {
        url,
        progress: 100,
        state: 'downloading',
        statusMessage: trackerFinal.statusMessage
      })
    }

    // Allow UI to register 100% state before heavy format operations
    await new Promise(resolve => setTimeout(resolve, 500))

    // [v1.7.2] NO MERGING NEEDED! The file was written at its offsets during download.
    if (trackerFinal) {
        trackerFinal.statusMessage = 'Finalizing: Verifying file...'
        win.webContents.send('download-progress', {
          url,
          progress: 100,
          state: 'downloading',
          statusMessage: trackerFinal.statusMessage
        })
    }

    // File already written via parallel r+ streams


    // [v1.7.1] Cleanup persistent agent after download
    try { keepAliveAgent.destroy() } catch (e) { }

    // [v1.2.9] CLEANUP: Move from temp to final destination
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.renameSync(tempFilePath, finalPath)
        console.log(`[MultiThread] Moved temp file to: ${finalPath}`);
      }
    } catch (renameErr) {
      console.error('[MultiThread] Failed to move from temp:', renameErr)
    }

    win.webContents.send('download-complete', {
      filename: fileInfo.filename,
      url: url,
      state: 'finished',
      savePath: finalPath
    })
    sendNotification(
      'Téléchargement terminé',
      `${fileInfo.filename} a été téléchargé avec succès`,
      true
    )
    handleDownloadEnd(url)

    // Optional: Cleanup empty folder
    try {
        const files = fs.readdirSync(tempDir);
        if (files.length === 0) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } catch(e) {}
  } catch (error: any) {
    console.error('Multi-threaded download error:', error)

    console.log('Falling back to yt-dlp with headers...')
    // [v1.7.3] Robust tracker retrieval including audioOnly state
    const trackerId = getTrackerId(url, !!audioOnly)
    const tracker = activeDownloads.get(trackerId)
    
    // [v1.7.3] Smart Retry: If we hit a timeout or reset, and haven't tried with fewer threads yet
    if (error.message.includes('Timeout') || error.message.includes('ECONNRESET')) {
      if (tracker && (tracker.retryCount || 0) < 2) {
        console.log('[MultiThread] Connection issue. Retrying with SAFE thread count...')
        tracker.retryCount = (tracker.retryCount || 0) + 1
      }
    }

    if (tracker) {
      tracker.strategy = 'yt-dlp'
      win.webContents.send('download-status', { url, status: 'Falling back to safe mode...' })
      // Retry with yt-dlp using captured headers and PRESERVE filename/audioOnly
      await downloadWithYtDlp(url, savePath, 'SafeMode', win, undefined, tracker?.filename || 'Generic', false, !!audioOnly, tracker?.headers)
      return
    }

    // [v1.2.9] Re-throw the error so the queue manager can handle retries.
    // Do NOT call handleDownloadEnd(url) here.
    throw error
  }
}

// Helper to get video info (formats) - V22 Signature Solver Support
async function fetchVideoInfo(
  url: string,
  requestHeaders: Record<string, string> = {}
): Promise<any> {
  const runYtDlp = (useCookies: boolean) => {
    return new Promise(async (resolve, reject) => {
      try {
        const ytDlpPath = ensureYtDlpAvailable()
        if (!ytDlpPath) return reject(new Error('yt-dlp not found'))

        const args = ['--dump-json', '--no-warnings', '--no-check-certificates', url]

        // v22: Signature solving support (inject Node path)
        const env = { ...process.env }
        const platform = process.platform
        const isWindows = platform === 'win32'
        const pathKey = isWindows
          ? 'PATH'
          : Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'

        const nodePath = await ensureNodeAvailable()
        if (nodePath) {
          const nodeDir = dirname(nodePath)
          env[pathKey] = `${nodeDir}${isWindows ? ';' : ':'}${env[pathKey]}`
          console.log(`[fetchVideoInfo] Injected Node.js to PATH: ${nodeDir}`)
          args.push('--js-runtimes', 'node')
        } else if (platform === 'darwin') {
          env[pathKey] = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${env[pathKey]}`
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
      } catch (err) {
        reject(err)
      }
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
  const downloadPath = savePath || appSettings.downloadPath
  
  // INITIAL TRACKER (to mark as active IMMEDIATELY and prevent race conditions)
  const initialTracker: DownloadTracker = {
    item: null,
    url: url,
    startTime: Date.now(),
    lastBytes: 0,
    lastTime: Date.now(),
    savePath: downloadPath,
    headers: queuedItem.headers || {},
    retryCount: queuedItem.retryCount || 0,
    maxRetries: queuedItem.maxRetries || 3,
    audioOnly: queuedItem.audioOnly || false,
    filename: queuedItem.filename,
    strategy: 'direct' // Default
  }

  try {
    // USE PLUGIN SYSTEM
    const plugin = pluginManager.getPlugin(url)

    const trackerId = getTrackerId(url, !!queuedItem.audioOnly)
    activeDownloads.set(trackerId, initialTracker)

    // Default Routing Logic (if no plugin found)
    let strategy = 'direct'
    let platformName = 'Direct'

    // DETECT SIGNED URLs - Force direct download to avoid segment auth issues
    const hasSignature = /[?&](sign|token|expires?|t)=/i.test(url)
    const isDirectVideo = url.match(/\.(mp4|webm|m4v|mkv|avi|mov|flv|wmv)(\?|$)/i)

    // [v1.3.8] FORCE DIRECT STRATEGY FOR DOCUMENTS (PDF, ZIP, etc.)
    const isDocument = url.match(/\.(pdf|zip|rar|7z|exe|msi|apk|doc|docx|xls|xlsx|ppt|pptx)(\?|$)/i) ||
                       queuedItem.filename?.match(/\.(pdf|zip|rar|7z|exe|msi|apk|doc|docx|xls|xlsx|ppt|pptx)$/i) ||
                       queuedItem.mimeType?.includes('application/pdf') ||
                       queuedItem.mimeType?.includes('application/zip') ||
                       queuedItem.mimeType?.includes('application/x-zip-compressed')

    if (isDocument) {
      console.log(`[DEBUG] Document detected (${queuedItem.filename || 'unknown'}), forcing direct download strategy`)
      strategy = 'direct'
      platformName = 'Document'
    } else if (hasSignature && isDirectVideo) {
      console.log('[DEBUG] Signed URL detected, forcing direct download')
      strategy = 'direct'
      platformName = 'Signed Direct'
    } else if (plugin) {
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
        initialTracker.headers = context.headers
      }
    } else {
      // Fallback to legacy isSocialMediaURL check for non-plugin sites
      const { isSocial, platform } = isSocialMediaURL(url)
      if (isSocial) {
        strategy = 'yt-dlp'
        platformName = platform
      } else {
        // Detect Streaming Formats (HLS/DASH) -> FORCE YT-DLP
        const isStreaming = url.match(/\.(m3u8|mpd)(\?|$)/i) ||
          queuedItem.mimeType?.includes('application/x-mpegURL') ||
          queuedItem.mimeType?.includes('application/dash+xml')

        if (isStreaming) {
          strategy = 'yt-dlp'
          platformName = 'Stream'
          console.log('[DEBUG] Streaming format detected, forcing yt-dlp')
        } else {
          // Check for likely DIRECT video types
          const isDirectVideoLink =
            queuedItem.mimeType?.includes('video/') ||
            queuedItem.mimeType?.includes('application/octet-stream') ||
            url.match(/\.(mp4|webm|m4v|mkv|avi|mov|flv|wmv|ts)(\?|$)/i) ||
            url.includes('/video/')

          if (isDirectVideoLink) {
            strategy = 'direct'
          }
        }
      }
    }

    // [v1.7.3] MOOVBOB / LOK-LOK / SIBNET SPECIAL HANDLING
    // Direct iframes or sensitive domains should prefer yt-dlp for better extraction
    if ((url.includes('moovbob.fr') || url.includes('hakunaymatata.com') || url.includes('sibnet.ru')) && strategy === 'direct') {
      console.log(`[DEBUG] Sensitive domain (${url.includes('sibnet') ? 'Sibnet' : 'Other'}) detected, prioritizing yt-dlp for extraction`)
      strategy = 'yt-dlp'
      platformName = 'SafeMode'
    }

    initialTracker.strategy = strategy as any
    initialTracker.isYouTube = platformName === 'YouTube'
    
    console.log(`[Queue] Finalized strategy for ${url.substring(0, 50)}... -> Strategy: ${strategy}, Platform: ${platformName}`)

    if (strategy === 'yt-dlp') {
      console.log(`[DEBUG] Starting Plugin Download(${platformName}) via yt - dlp...`)
      await downloadWithYtDlp(
        url,
        downloadPath,
        platformName,
        mainWindow,
        undefined,
        initialTracker.filename,
        false, // _isRetry
        queuedItem.audioOnly, // [v1.7.0] Correct parameter position
        queuedItem.headers // [v1.4.4] Pass headers to fix 403 errors
      )
    } else {
      console.log('[DEBUG] Starting Direct Download (Multi-threading)...')
      await downloadWithMultiThreading(url, downloadPath, mainWindow, queuedItem.audioOnly) // [v1.7.0] Pass flag
    }

    // [v1.3.0] CRITICAL: Handle successful completion to free up queue slot
    handleDownloadEnd(url, !!queuedItem.audioOnly)
  } catch (error: any) {
    console.error('Error starting download from queue:', error)

    // [v1.7.3] Special SILENT FALLBACK to yt-dlp if direct engine trips a sensitive domain
    if (error.message === 'FALLBACK_TO_YTDLP') {
      console.log('[Queue] Silent fallback to yt-dlp triggered for', url)
      try {
        await downloadWithYtDlp(
          url,
          downloadPath,
          'SafeMode',
          mainWindow,
          undefined,
          initialTracker.filename,
          false,
          queuedItem.audioOnly,
          queuedItem.headers // [v1.4.4] Pass headers to fix 403 errors
        )
        handleDownloadEnd(url, !!queuedItem.audioOnly)
        return
      } catch (innerError: any) {
        console.error('[Queue] yt-dlp fallback also failed:', innerError)
        error = innerError // Preserve inner error for notification
      }
    }

    // Retry logic
    const trackerId = getTrackerId(url, !!queuedItem.audioOnly)
    const tracker = activeDownloads.get(trackerId)
    if (tracker && tracker.retryCount !== undefined && tracker.maxRetries !== undefined) {
      if (tracker.retryCount < tracker.maxRetries) {
        const retryDelay = Math.min(1000 * Math.pow(2, tracker.retryCount), 30000)
        tracker.retryCount++

        console.log(
          `Retrying download ${url} (attempt ${tracker.retryCount}/${tracker.maxRetries}) after ${retryDelay} ms`
        )

        setTimeout(() => {
          downloadQueue.unshift({
            ...queuedItem,
            retryCount: tracker.retryCount || 0,
            priority: (queuedItem.priority || 0) + 1
          })
          activeDownloads.delete(trackerId)
          processDownloadQueue()
        }, retryDelay)

        return
      }
    }

    // Échec définitif
    const errorMessage = error.message || 'Failed to download file'
    mainWindow.webContents.send('download-error', {
      url,
      audioOnly: !!queuedItem.audioOnly,
      error: errorMessage
    })
    sendNotification('Erreur de téléchargement', `Échec du téléchargement: ${errorMessage} `, false)
    handleDownloadEnd(url)
  }
}

// Fonction pour traiter la file d'attente
function processDownloadQueue() {
  // Trier la queue par priorité (plus haute priorité en premier)
  downloadQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  // Filtrer les téléchargements qui sont en pause ou annulés
  const currentActive = Array.from(activeDownloads.values()).filter(
    (t) => !t.paused && !t.cancelled
  ).length

  // [v1.3.0] Sync limit from settings to ensure user changes are respected
  const currentMax = appSettings.maxConcurrentDownloads || 3

  console.log(
    `[Queue] Processing. Active: ${currentActive}, Max: ${currentMax}, In Queue: ${downloadQueue.length}`
  )

  if (currentActive >= currentMax) {
    console.log('[Queue] Simultaneous download limit reached. Waiting...')
    return
  }

  // Trier par priorité avant de prendre le premier
  downloadQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  const itemsToStart = currentMax - currentActive
  console.log(`[Queue] Attempting to start ${Math.min(itemsToStart, downloadQueue.length)} downloads.`)

  for (let i = 0; i < itemsToStart && downloadQueue.length > 0; i++) {
    const nextItem = downloadQueue.shift()
    if (nextItem) {
      console.log(`[Queue] Starting next item: ${nextItem.url}`)
      startDownloadFromQueue(nextItem)
    }
  }
}

// Helper to parse size string manually to bytes
/*
function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 0
  const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/)
  if (!match) return 0

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  if (unit.startsWith('k')) return value * 1024
  if (unit.startsWith('m')) return value * 1024 * 1024
*/
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
  // [v1.6.8] Validate URL Protocol
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    console.warn(`[Queue] Blocked unsupported URL protocol: ${url.split(':')[0]}`)
    mainWindow.webContents.send('notification', {
      title: 'Téléchargement impossible',
      body: 'Les liens "blob:" (ChatGPT, etc.) ne peuvent pas être téléchargés directement. Veuillez clic-droit sur le fichier dans votre navigateur et choisir "Enregistrer sous".'
    })
    return
  }

  // [v1.6.9] Enforcement: Block downloads if not activated
  if (!appSettings.isActivated) {
    console.warn(`[Queue] Blocked download because app is not activated: ${url}`)
    mainWindow.webContents.send('notification', {
      title: 'Activation Requise',
      body: 'Veuillez activer votre licence pour débloquer les téléchargements.'
    })
    // Also open the settings modal to guide the user
    mainWindow.webContents.send('open-settings') 
    return
  }

  // Vérifier si déjà dans la queue ou actif - [v1.7.0] Composite check
  const trackerId = getTrackerId(url, audioOnly)
  if (downloadQueue.some((item) => getTrackerId(item.url, !!item.audioOnly) === trackerId) || activeDownloads.has(trackerId)) {
    console.log('Download already queued or active (Composite):', trackerId)
    return
  }

  // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
  const baseDir = savePath || appSettings.downloadPath
  const subFolder = audioOnly ? 'Audios' : 'Videos'
  
  // Robust check: prevent "Videos/Videos" on Windows and POSIX
  const finalSavePath = (baseDir.endsWith(subFolder) || baseDir.includes(sep + subFolder + sep) || baseDir.endsWith(sep + subFolder))
    ? baseDir
    : join(baseDir, subFolder)

  if (!fs.existsSync(finalSavePath)) {
    try { fs.mkdirSync(finalSavePath, { recursive: true }) } catch (e) { }
  }

  const queuedItem: QueuedDownload = {
    url,
    savePath: finalSavePath,
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
  // const isRetry = false;
  const name = filename || url.split('/').pop()?.split('?')[0] || 'unknown-file'

  mainWindow.webContents.send('download-started', {
    url,
    audioOnly, // [v1.7.0] CRITICAL: Sync flag to prevent UI duplicates
    name: name,
    size: 'Waiting...',
    progress: 0,
    speed: '-',
    status: 'queued',
    timeLeft: '--',
    createdAt: Date.now(),
    savePath: finalSavePath // [v1.4.1] CRITICAL for automatic Resume
  })

  processDownloadQueue()
}

// Fonction pour gérer la fin d'un téléchargement (succès, erreur, annulation)
// [v1.7.0] Force handleDownloadEnd to use trackerId or search if audioOnly is unknown
function handleDownloadEnd(url: string, audioOnly?: boolean) {
  const trackerId = audioOnly !== undefined ? getTrackerId(url, audioOnly) : url
  const tracker = activeDownloads.get(trackerId) || activeDownloads.get(url)

  if (tracker) {
    console.log(`[Lifecycle] Cleaning up download: ${trackerId}`)
    
    // [v1.3.7] Add to recently completed cache before deleting
    recentlyCompletedDownloads.set(trackerId, { timestamp: Date.now() })
    
    // Auto-cleanup from recently completed after TTL
    setTimeout(() => {
      recentlyCompletedDownloads.delete(trackerId)
    }, RECENTLY_COMPLETED_TTL)

    activeDownloads.delete(trackerId)
    activeDownloads.delete(url) // Dual cleanup for safety
  }

  processDownloadQueue()
}

// Fonction pour arrêter un téléchargement
async function stopDownload(url: string, audioOnly: boolean = false) {
  const trackerId = getTrackerId(url, audioOnly)
  const tracker = activeDownloads.get(trackerId)
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
    activeDownloads.delete(trackerId)

    // Notify frontend
    const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (mainWindow) {
      mainWindow.webContents.send('download-cancelled', { 
        url,
        audioOnly: !!audioOnly
      })
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
  _isRetry: boolean = false,
  audioOnly: boolean = false, // [v1.7.0] Pass format flag
  requestHeaders: Record<string, string> = {} // [v1.4.5] Fix 403: Accept explicit headers
) {
  let cookieFile: string | null = null
  let tracker: any = null

  try {
    const trackerId = getTrackerId(url, audioOnly)
    tracker = activeDownloads.get(trackerId)
    
    // [v1.4.5] Use headers from parameter if tracker is not yet available (batch fallback)
    const effectiveHeaders = { ...(requestHeaders || {}), ...(tracker?.headers || {}) }

    // Obtenir le chemin de yt-dlp
    const finalYtDlpPath = ensureYtDlpAvailable()

    // Initialize segment progress for aesthetic consistency (IDM style)
    if (tracker) {
      tracker.segmentProgress = Array(16).fill(0) // [v1.7.3] Capped at 16 for aria2c stability
      tracker.statusMessage = 'Searching for formats...'
    }

    if (finalYtDlpPath) {
      // Clean URL: Strip internal suffixes (|video, |audio) before passing to yt-dlp
      const cleanUrl = url.split('|')[0]

      // Ensure aria2c is available for high-speed splitting
      const aria2Path = await ensureAria2Available(win)
      const hasAria2 = !!aria2Path

      // Vérifier si ffmpeg est disponible
      const ffmpegPath = await ensureFfmpegAvailable(win)
      const hasFfmpeg = !!ffmpegPath

      // [v1.4.9] AGGRESSIVE RESUME: Strip technique format IDs and scan for orphaned .part files
      let finalCustomFilename = customFilename

      // [v1.8.3] SENSITIVE DOMAIN DETECTION (Moovbob / Lok-lok)
      const isSensitiveDomain = cleanUrl.includes('moovbob.fr') || 
                               cleanUrl.includes('hakunaymatata.com') || 
                               cleanUrl.includes('sibnet.ru') ||
                               (requestHeaders['Referer'] && (requestHeaders['Referer'].includes('moovbob.fr') || requestHeaders['Referer'].includes('sibnet.ru')))
      
      const hasSignature = /[?&](sign|token|expires?|t)=/i.test(cleanUrl)
      const useRestrictedThreads = isSensitiveDomain || hasSignature
      const restrictedNCount = 16 // [v1.5.0] Boosted from 8 to 16 for Nitro mode
      
      // [v1.8.4] HLS DETECTION for progress scaling
      const isHLS = cleanUrl.includes('.m3u8') || isSensitiveDomain
      if (tracker) {
        (tracker as any).isHLS = isHLS
      }
      
      if (useRestrictedThreads) {
        console.log(`[yt-dlp] Restricted domain/signature detected. Scaling down to ${restrictedNCount} connections.`)
      }

      // [v1.3.6] IDM Optimization: Use local temp directory on the SAME disk to avoid slow/space-consuming merges
      const tempDir = join(savePath, '.doulget_tmp');
      if (!fs.existsSync(tempDir)) {
          try { fs.mkdirSync(tempDir, { recursive: true }); } catch(e) {}
      }

      if (finalCustomFilename) {
        // [v1.8.9] SANITIZE FILENAME FIRST (Avoid encoding issues with aria2c/yt-dlp)
        finalCustomFilename = sanitizeStringForFilename(finalCustomFilename);

        // 1. Strip ALL format ID patterns like .f299, .f140, .f137, etc.
        // We do this globally to clean the title completely
        finalCustomFilename = finalCustomFilename.replace(/\.f\d+/g, '')

        // [Fix] FORCE IGNORE BAD TITLES -> Nuclear Option
        // If we see "Swift..." or "video", we DO NOT trust yt-dlp metadata either (because it might be the same).
        // We generate a safe, unique timestamp-based name.
        const badTitles = ['Swift', 'Streamlined', 'Safe', 'video', 'Document', 'Untitled', 'm3u8', 'blob', 'index', 'playlist', 'doulget'];
        if (badTitles.some(bad => finalCustomFilename!.includes(bad))) {
             const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
             console.log(`[Filename Fix] Detected bad title '${finalCustomFilename}', forcing SAFE filename.`);
             finalCustomFilename = `DoulGet_Video_${timestamp}`;
        }

        // 2. Prepare both restricted and unrestricted base names
        if (finalCustomFilename) {
          // Remove double extensions or trailing dots
          finalCustomFilename = finalCustomFilename.replace(/\.mp4$/i, '').replace(/\.+$/, '');
          
          // [v1.8.6] ATTEMPT SERIES DETECTION (SxxExx)
          // [v1.9.24] SKIP if filename already contains SxxExx (extension already provided it)
          if (!/S\d+E\d+/i.test(finalCustomFilename)) {
            const seriesHint = extractSeriesMetadata([
              requestHeaders['Referer'] || '',
              cleanUrl,
              finalCustomFilename
            ]);

            if (seriesHint) {
              console.log(`[Series Fix] Detected metadata: ${seriesHint}`);
              finalCustomFilename = `${finalCustomFilename}_${seriesHint}`;
            }
          } else {
            console.log(`[Series Fix] Skipping enrichment: filename already contains metadata.`);
          }

          // [v1.8.5] UNIQUENESS CHECK: Ensure filename doesn't collide with existing files OR ongoing downloads
          // [v1.2.9] RESUME FIX: Skip if we already have this filename in the tracker and it exists on disk
          let checkName = finalCustomFilename;
          let counter = 1;

          const isTaken = (name: string) => {
            const path = require('path');
            const base = path.join(savePath, name);
            // If the name belongs to CURRENT tracker, it's not "taken" by someone else
            if (tracker?.filename === name) return false;

            return fs.existsSync(base + '.mp4') || 
                   fs.existsSync(base + '.part') || 
                   fs.existsSync(base + '.ytdl') ||
                   fs.existsSync(base + '.mp4.part');
          };

          if (!(tracker?.filename && (fs.existsSync(join(savePath, tracker.filename + '.part')) || fs.existsSync(join(savePath, tracker.filename + '.ytdl'))))) {
            while (isTaken(checkName)) {
              checkName = `${finalCustomFilename}(${counter})`;
              counter++;
            }
            finalCustomFilename = checkName;
          } else {
            finalCustomFilename = tracker.filename;
            console.log(`[yt-dlp] Resuming with existing filename: ${finalCustomFilename}`);
          }
        }
        // 3. AGGRESSIVE SCAN: Look for ANY .part file in the directory that matches our restricted base
        // or contains a significant portion of it.
        /*
        try {
          if (fs.existsSync(savePath)) {
            const files = fs.readdirSync(savePath)

            for (const file of files) {
              if (file.endsWith('.part')) {
                // If we find a file that starts with our restricted base but isn't EXACTLY what we expect
                // (e.g., contains different IDs or extensions), we migrate it to the "clean" name.
                const isMatch = file.startsWith(restrictedBase) ||
                  file.startsWith(unrestrictedBase) ||
                  (restrictedBase.length > 10 && file.includes(restrictedBase.substring(0, 10)))

                if (isMatch) {
                  // Determine the probable extension from the orphaned file
                  const extMatch = file.match(/\.([^.]+)\.part$/)
                  const ext = extMatch ? extMatch[1] : 'mp4'
                  const newPartName = `${restrictedBase}.${ext}.part`

                  if (file !== newPartName) {
                    const oldPath = join(savePath, file)
                    const newPath = join(savePath, newPartName)

                    if (!fs.existsSync(newPath)) {
                      console.log(`[v1.4.9] Aggressive Match! Renaming ${file} -> ${newPartName}`)
                      fs.renameSync(oldPath, newPath)
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('[v1.4.9] Aggressive scan failed:', e)
        }

        // 4. Update the filename in tracker to the new restricted version
        // if (tracker) tracker.filename = `${restrictedBase}.mp4`
        // finalCustomFilename = restrictedBase
        */
      }

      // Arguments de base pour yt-dlp
      const downloadArgs = [
        cleanUrl, // [v1.7.2] Using clean URL
        '-o',
        // USE FLEXIBLE TEMPLATE: Try to get real title, fallback to custom filename if available
        // [v1.7.0] Sanitize finalCustomFilename: Strip ANY existing media extensions to prevent .mp3.webm
        finalCustomFilename
          ? join(savePath, `${finalCustomFilename.replace(/\.(mp3|mp4|webm|m4a|mkv)$/i, '')}.%(ext)s`)
          : join(savePath, '%(title)s.%(ext)s'),
        '--part', // Ensure .part files are used
        '--paths', `temp:${tempDir}`, // [v1.3.6] Force temp files to the same disk
        // '--restrict-filenames', // REMOVED: Allow nice filenames with spaces/UTF-8
        '--newline', // Important for parsing output
        '--no-mtime', // Ne pas restaurer la date de modif (perf Windows)
        '--continue', // CRITIQUE: Force la reprise des fichiers partiellement téléchargés
        '--no-playlist', // CRITIQUE: Télécharger UNIQUEMENT la vidéo spécifiée, pas toute la playlist
        '--http-chunk-size',
        '100M', // [v1.7.2] Huge chunks for multigigabit connections
        '--buffer-size',
        '1M', // [v1.7.2] 1MB Buffer for extreme disk throughput
        '--socket-timeout',
        '60', // [v1.7.2] Longer timeout for heavy loads
        '--retries',
        '5', // [v1.7.2] Robust retries
        '--no-check-certificates', // [v1.7.3] CRITICAL: Bypass SSL verification to prevent hangs
        '--no-cache-dir', // [v1.7.3] Ensure fresh requests
        '--verbose', // [v1.7.6] Diagnostic info for speed bottlenecks
        '--no-keep-fragments', // [v1.7.7] Force cleanup of temporary segments
        '--postprocessor-args', 'Merger+ffmpeg:-c copy -threads 0' // [v1.5.4] ULTRA-FAST merge for all platforms
      ]

      // [v1.9.8] PALKAD OPTIMIZATION: Disable aria2c for lok-lok/palkad/moovbob/hakuna to fix progress/size/403 issues.
      // Native yt-dlp with --concurrent-fragments is fast enough and reports accurate HLS progress.
      const isPalkadGroup = cleanUrl.includes('lok-lok.cc') || cleanUrl.includes('palkad') || cleanUrl.includes('moovbob.fr') || cleanUrl.includes('sibnet.ru') || cleanUrl.includes('hakunaymatata.com');
      
      if (hasAria2 && aria2Path && !isPalkadGroup) {
        downloadArgs.push('--downloader', aria2Path)
        // [v1.7.6] ABSOLUTE TURBO: Added --min-split-size=1M and --summary-interval=1
        // [v1.3.6] IDM Optimization: Use falloc for pre-allocation, increase min-split-size to 1M (Nitro)
        const ariaArgs = useRestrictedThreads 
          ? `aria2c:-x ${restrictedNCount} -s ${restrictedNCount} -j 32 -k 1M --min-split-size=1M --summary-interval=1 --file-allocation=falloc --check-certificate=false --no-conf`
          : 'aria2c:-x 16 -s 16 -j 32 -k 1M --min-split-size=1M --summary-interval=1 --file-allocation=falloc --check-certificate=false --no-conf'
        
        downloadArgs.push('--downloader-args', ariaArgs)
        console.log(`[yt-dlp] Turbo Mode Enabled: Using aria2c (${useRestrictedThreads ? 'Safe Restricted' : 'Absolute Turbo'})`)
      } else if (isPalkadGroup) {
         console.log('[yt-dlp] Palkad/Lok-Lok detected: Using Native Threading (No aria2c) for accurate progress.');
      }

      // AUDIO CONVERSION LOGIC (MP3) - EXCLUSIVE PATH
      // [v1.7.0] Check BOTH argument and tracker for maximum robustness
      if (audioOnly || tracker?.audioOnly) {
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
        downloadArgs.push('--postprocessor-args', 'Merger+ffmpeg:-c copy -threads 0') // [v1.5.4]
        console.log(`[yt - dlp] Using custom format: ${formatId} `)
      }
      // DEFAULT VIDEO LOGIC - v19: Maximum Quality
      else {
        // Detect if it's YouTube for special handling
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')

        if (isYouTube) {
          if (hasFfmpeg) {
            // YouTube: MAX QUALITY with compat-driven selector
            // [v1.7.2] Prefer AVC+M4A for instant merging (no re-encoding)
            downloadArgs.push(
              '-f',
              'bestvideo[vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc]+bestaudio/best[ext=mp4]/best',
              '--merge-output-format',
              'mp4'
              // Note: Global postprocessor-args already set above for v1.5.5
            )
            console.log('[yt-dlp] YouTube: Using ULTRA-FAST compat selector (AVC+M4A)')
          } else {
            // FALLBACK: If FFmpeg is missing, use 'best' which is usually a single-file muxed format
            // Limited to 720p usually, but doesn't require merging.
            downloadArgs.push('-f', 'best')
            console.warn('[yt-dlp] YouTube: FFmpeg missing. Falling back to single-file format (Limited to 720p)')
            if (win) {
              win.webContents.send('notification', {
                title: 'Qualité limitée',
                body: 'FFmpeg absent : qualité limitée à 720p max.'
              })
            }
          }
          downloadArgs.push('--no-cache-dir')
        } else {
          // Other platforms (like m3u8/HLS sites)
          const isStreaming = url.match(/\.(m3u8|mpd)(\?|$)/i)

          if (isStreaming && !hasFfmpeg) {
            // CRITICAL: m3u8 requires FFmpeg. Without it, it just downloads a tiny text file or fails.
            console.error('[yt-dlp] m3u8 detected but FFmpeg is missing! High risk of failure.')
            if (win) {
              win.webContents.send('notification', {
                title: 'FFmpeg requis',
                body: 'FFmpeg est indispensable pour ce site. Tentative de téléchargement en cours...'
              })
            }
            // Still try best, but it will likely produce the tiny file the user complained about
            downloadArgs.push('-f', 'best')
          } else if (hasFfmpeg) {
            downloadArgs.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4')
          } else {
            downloadArgs.push('-f', 'best')
          }

          // [v1.6.1] TikTok Fix: Use specific API hostname to avoid extraction errors
          if (url.includes('tiktok.com')) {
            downloadArgs.push('--extractor-args', 'tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com')
          }

          console.log(`[yt-dlp] Format detection: Streaming=${!!isStreaming}, FFmpeg=${hasFfmpeg}`)
        }

        if (hasFfmpeg && ffmpegPath) {
          downloadArgs.push('--ffmpeg-location', ffmpegPath)
        }
      }
      // [DEBUG] V4: Robust extraction strategy
      console.log(`[yt-dlp] Preparing download for ${url} (Strategy: yt-dlp)`)
      
      // [DEBUG] Removed verbose/force flags for production


      // [V18 FIX] Robust Cookie Authentication for Social Media
      // Problem: --cookies-from-browser chrome fails if Chrome is running (locks database)
      // Solution: Generate a PROPER Netscape cookie file from the Cookie header
      // 
      // v1.2.7: EXCLUDE YOUTUBE - yt-dlp works BETTER without cookies for YouTube
      // Reason: tv_embedded, ios, android clients don't support cookies
      //         web client with cookies causes "SABR streaming" and "n challenge" errors
      const isSocialPlatform =
        url.includes('tiktok.com') ||
        url.includes('instagram.com') ||
        url.includes('facebook.com') ||
        url.includes('twitter.com')

      // YouTube: Never use cookies - works better with anonymous access
      const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')

      if (isSocialPlatform && requestHeaders['Cookie']) {
        try {
          // const urlObj = new URL(url)
          // const domain = new URL(url).hostname;

          // Create proper Netscape cookie file
          const cookieTempPath = join(app.getPath('temp'), `cookies_${Date.now()}.txt`)
          // CRITICAL: Netscape format requires CRLF line endings on Windows
          const CRLF = '\r\n'
          let netscapeContent = `# Netscape HTTP Cookie File${CRLF}`
          netscapeContent += `# This is a generated file! Do not edit.${CRLF}${CRLF}`

          // Parse Cookie header and convert to Netscape format
          const cookies = requestHeaders['Cookie'].split(';').map((c) => c.trim())
          const expiration = Math.floor(Date.now() / 1000) + 86400 // 24h from now

          for (const cookie of cookies) {
            const [name, ...valueParts] = cookie.split('=')
            const value = valueParts.join('=')
            if (name && value) {
              // v1.2.6: Comprehensive YouTube/Google domains for authentication
              const domains = [
                '.youtube.com',
                '.google.com',
                '.googlevideo.com',
                '.youtube-nocookie.com'
              ]

              for (const d of domains) {
                // Format: domain \t flag \t path \t secure \t expiration \t name \t value
                // CRITICAL: Use actual tab character, not spaces
                netscapeContent += `${d}\tTRUE\t/\tFALSE\t${expiration}\t${name}\t${value}${CRLF}`
              }
            }
          }

          await fsPromises.writeFile(cookieTempPath, netscapeContent, 'utf8')
          cookieFile = cookieTempPath
          console.log('[yt-dlp] Generated enhanced multi-domain Netscape cookie file')
          downloadArgs.push('--cookies', cookieFile)
        } catch (err) {
          console.error('[yt-dlp] Failed to generate cookie file:', err)
          // v1.2.6: REMOVED --cookies-from-browser fallback to avoid Windows locking
        }
      } else if (Object.keys(effectiveHeaders).length > 0 && !isSocialPlatform && !isYouTube) {
        // [v1.4.5] LOG: Verify header injection
        console.log('[yt-dlp] Passing session headers directly:', Object.keys(effectiveHeaders).join(', '));
        for (const key in effectiveHeaders) {
          if (key.toLowerCase() === 'user-agent') {
            downloadArgs.push('--user-agent', effectiveHeaders[key])
          } else {
            downloadArgs.push('--add-header', `${key}:${effectiveHeaders[key]}`)
          }
        }
      } else if (isYouTube) {
        console.log('[yt-dlp] YouTube: Skipping cookies (better compatibility with anonymous access)')
      }

      console.log(`[yt-dlp] FULL COMMAND ARGS: `, downloadArgs.join(' '))

      // Emit START event to ensure UI registers the item in the list
      const initialFilename = customFilename || 'Fetching info...'
      win.webContents.send('download-started', {
        url: url,
        audioOnly,
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
      // [v1.7.1] Use cached node dir if available to avoid repeated existsSync scans
      let nodeFoundDir = ''
      if (_cachedNodeDir) {
        nodeFoundDir = dirname(_cachedNodeDir)
      } else {
        for (const dir of possibleNodeDirs) {
          if (existsSync(join(dir, nodeBinary))) {
            nodeFoundDir = dir
            break
          }
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

      // [v1.7.3] PERFORMANCE: Also add ffmpeg and aria2c folders to PATH for internal yt-dlp calls
      if (ffmpegPath) {
        const ffmpegDir = dirname(ffmpegPath)
        if (!env[pathKey]?.includes(ffmpegDir)) {
          env[pathKey] = `${ffmpegDir}${isWindows ? ';' : ':'}${env[pathKey] || ''}`
        }
      }
      if (aria2Path) {
        const aria2Dir = dirname(aria2Path)
        if (!env[pathKey]?.includes(aria2Dir)) {
          env[pathKey] = `${aria2Dir}${isWindows ? ';' : ':'}${env[pathKey] || ''}`
        }
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

      // v23: Ensure portable Node.js is downloaded if missing
      if (!nodeFoundDir) {
        const portableNodePath = await ensureNodeAvailable(win)
        if (portableNodePath && existsSync(portableNodePath)) {
          nodeFoundDir = dirname(portableNodePath)
          console.log(`[yt-dlp] Using downloaded portable Node.js for signature solving: ${nodeFoundDir}`)
          env[pathKey] = `${nodeFoundDir}${isWindows ? ';' : ':'}${env[pathKey]}`
          env['YTDLP_JS_ENGINE'] = 'node'
          // We don't add --js-runtimes here because it might conflict with default yt-dlp behavior if Deno is also present,
          // but we ensured Node is in PATH which is yt-dlp's fallback.
        }
      }

      // v1.2.7: UPDATED Retry Logic - Use clients that ACTUALLY WORK
      // tv_embedded, ios, web all require PO Tokens or authentication as of late 2025
      const performDownload = async () => {
        const attempts = [
          {
            name: 'Strategy 1: Default Behavior (yt-dlp Auto-Select)',
            setup: () => {
              // Remove ANY player_client specification - let yt-dlp decide
              // This was confirmed working in test-ytdlp.bat diagnostic
              const refinedArgs: string[] = []
              for (let j = 0; j < downloadArgs.length; j++) {
                if (downloadArgs[j] === '--extractor-args' && downloadArgs[j + 1]?.includes('youtube:player_client')) {
                  j++
                  continue
                }
                refinedArgs.push(downloadArgs[j])
              }
              return refinedArgs
            }
          },
          {
            name: 'Strategy 2: iOS Client (High Bitrate)',
            setup: () => {
              const refinedArgs: string[] = []
              for (let j = 0; j < downloadArgs.length; j++) {
                if (downloadArgs[j] === '--extractor-args' && downloadArgs[j + 1]?.includes('youtube:player_client')) {
                  j++
                  continue
                }
                refinedArgs.push(downloadArgs[j])
              }
              refinedArgs.push('--extractor-args', 'youtube:player_client=ios')
              return refinedArgs
            }
          },
          {
            name: 'Strategy 3: Web Safari (Modern Fallback)',
            setup: () => {
              const refinedArgs: string[] = []
              for (let j = 0; j < downloadArgs.length; j++) {
                if (downloadArgs[j] === '--extractor-args' && downloadArgs[j + 1]?.includes('youtube:player_client')) {
                  j++
                  continue
                }
                refinedArgs.push(downloadArgs[j])
              }
              refinedArgs.push('--extractor-args', 'youtube:player_client=web_safari')
              return refinedArgs
            }
          },
          {
            name: 'Strategy 4: MediaConnect (Last Resort)',
            setup: () => {
              const refinedArgs: string[] = []
              for (let j = 0; j < downloadArgs.length; j++) {
                if (downloadArgs[j] === '--extractor-args' && downloadArgs[j + 1]?.includes('youtube:player_client')) {
                  j++
                  continue
                }
                refinedArgs.push(downloadArgs[j])
              }
              refinedArgs.push('--extractor-args', 'youtube:player_client=web')
              return refinedArgs
            }
          },
          {
            name: 'Strategy 5: Android Optimized (Deep Bypass)',
            setup: () => {
              const refinedArgs: string[] = []
              for (let j = 0; j < downloadArgs.length; j++) {
                if (downloadArgs[j] === '--extractor-args' && downloadArgs[j + 1]?.includes('youtube:player_client')) {
                  j++
                  continue
                }
                refinedArgs.push(downloadArgs[j])
              }
              // [v1.7.2] PRO TIP: Using 'android' with specific extractor args is currently the fastest way
              refinedArgs.push('--extractor-args', 'youtube:player_client=android,web;player_skip=configs,hls')
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
              const trackerId = getTrackerId(url, audioOnly)
              const trackerRef = activeDownloads.get(trackerId)
              if (trackerRef) trackerRef.process = ytDlpProcess

              let output = ''
              let stdoutBuffer = ''
              let errorOutput = ''
              let filename = customFilename || 'unknown'
              let killTimeout: NodeJS.Timeout | null = null
              let wasKilledByTimeout = false

              const handleData = (data: any) => {
                const chunk = data.toString()
                output += chunk
                stdoutBuffer += chunk

                const trackerId = getTrackerId(url, audioOnly)
                const trackerLog = activeDownloads.get(trackerId)
                if (trackerLog) {
                  if (!trackerLog.logs) trackerLog.logs = []
                  trackerLog.logs.push(chunk)
                  if (trackerLog.logs.length > 500) trackerLog.logs.shift()
                }

                const lines = stdoutBuffer.split(/[\r\n]+/) // [1.7.5] Split by BOTH newline and carriage return for aria2c
                stdoutBuffer = lines.pop() || ''

                for (const line of lines) {
                  const trimmedLine = line.trim()
                  if (!trimmedLine) continue
                  
                  // [v1.7.6] Verbose log relay (if enabled)
                  if (trimmedLine.includes('[debug]')) {
                    console.log(`[yt-dlp-debug] ${trimmedLine}`);
                  }

                  if (trimmedLine.includes('[Merger] Merging formats into') || trimmedLine.includes('[merger] Merging formats into')) {
                    const match = trimmedLine.match(/Merging formats into "(.+)"/)
                    if (match && match[1]) {
                      filename = require('path').basename(match[1])
                      if (trackerRef) {
                        trackerRef.filename = filename
                        trackerRef.statusMessage = 'Merging video and audio streams...'
                      }
                    }
                  } else if (trimmedLine.includes('[ffmpeg] Converting') || trimmedLine.includes('[FFmpeg] Converting')) {
                    if (trackerRef) {
                      trackerRef.statusMessage = 'Converting to final format...'
                    }
                  } else if (trimmedLine.includes('[ExtractAudio]')) {
                    if (trackerRef) {
                      trackerRef.statusMessage = 'Extracting audio...'
                    }
                  } else if (trimmedLine.includes('[FixupM3u8]') || trimmedLine.includes('[FixupM4a]') || trimmedLine.includes('[hlsnative] Finalizing')) {
                    if (trackerRef) {
                      trackerRef.statusMessage = 'Finalisation du fichier (HLS Fixup)...'
                      trackerRef.lastProgress = 99.9
                    }
                  } else if (trimmedLine.includes('[Merger]') || trimmedLine.includes('[VideoConvertor]') || trimmedLine.includes('[ffmpeg] Converting')) {
                    // [v1.8.4] Merger feedback to avoid "blocked at 100%" feeling
                    if (trackerRef) {
                      trackerRef.statusMessage = 'Assemblage final (FFmpeg)...'
                      trackerRef.lastProgress = 99.9 // Keep it just below 100 until fully closed
                    }
                  } else if (trimmedLine.includes('[download] Destination:')) {
                    const match = trimmedLine.match(/Destination: (.+)/)
                    if (match && match[1]) {
                      const fullPath = match[1]
                      const tempFilename = require('path').basename(fullPath)
                      filename = tempFilename
                      
                      // [v1.9.7] STEALTH: Hide the temporary file immediately
                      hideFile(fullPath);

                      if (trackerRef) {
                        trackerRef.filename = filename

                        // [v1.3.0] DETECT STREAM TYPE for cumulative size
                        if (fullPath.match(/\.(f137|f248|f399|mp4|webm|mkv|avi|mov|flv|wmv|v\d+)(\.|$)/i)) {
                          (trackerRef as any)._currentStreamType = 'video'
                        } else if (fullPath.match(/\.(f140|f251|f233|m4a|mp3|ogg|aac|a\d+)(\.|$)/i)) {
                          (trackerRef as any)._currentStreamType = 'audio'
                        }
                      }
                    }
                  } else if (trimmedLine.includes('[download]') && trimmedLine.includes('has already been downloaded')) {
                    const match = trimmedLine.match(/\[download\] (.+) has already been downloaded/)
                    if (match && match[1]) {
                      filename = require('path').basename(match[1])
                      if (trackerRef) trackerRef.filename = filename
                    }
                  } else if (trimmedLine.includes('[download] 100% of')) {
                      // [v1.9.30] DEFER state: 'finished' until process actually exits
                      // This avoids the "hang at 100%" impression during FFmpeg merge/fixup.
                      win.webContents.send('download-progress', {
                        url, 
                        audioOnly,
                        progress: 100, 
                        state: 'downloading', // KEEP downloading state
                        speed: 0, 
                        timeLeft: '00:00',
                        canResume: true, 
                        filename, 
                        strategy: 'yt-dlp',
                        savePath: trackerRef?.savePath, 
                        statusMessage: trackerRef?.statusMessage || 'Finalisation...'
                      })
                  } else if ((trimmedLine.includes('[download]') || trimmedLine.includes('[#')) && trimmedLine.includes('%')) {
                    // [v1.7.3] Detect aria2c progress style: [#ae694f 1.2MiB/10MiB(12%) CN:16 DL:1.2MiB]
                    const isAria2Progress = (trimmedLine.includes('CN:') && trimmedLine.includes('DL:')) || trimmedLine.startsWith('[#');
                    
                    let percentage = 0;
                    let speed = '0B/s';
                    let timeLeft = '--:--';
                    let totalSizeStr = '...';

                    if (isAria2Progress) {
                      const aria2PercentMatch = trimmedLine.match(/\((\d+)%\)/);
                      const aria2SpeedMatch = trimmedLine.match(/DL:([\d\.]+\w+)/);
                      const aria2SizeMatch = trimmedLine.match(/\/([\d\.]+\w+)\(/);
                      
                      percentage = aria2PercentMatch ? parseFloat(aria2PercentMatch[1]) : 0;
                      speed = aria2SpeedMatch ? `${aria2SpeedMatch[1]}/s` : '0B/s';
                      totalSizeStr = aria2SizeMatch ? aria2SizeMatch[1] : '...';
                    } else {
                      const progressMatch = trimmedLine.match(/(\d+\.?\d*)%/)
                      const speedMatch = trimmedLine.match(/at\s+([\d\.]+\w+\/s)/)
                      const etaMatch = trimmedLine.match(/ETA\s+([\d:]+)/)
                      const sizeMatch = trimmedLine.match(/of\s+(~?[\d\.]+\w+)/)
                      
                      percentage = progressMatch ? parseFloat(progressMatch[1]) : 0
                      speed = speedMatch ? speedMatch[1] : '0B/s'
                      timeLeft = etaMatch ? etaMatch[1] : '--:--'
                      totalSizeStr = sizeMatch ? sizeMatch[1].replace('~', '') : '...'
                    }

                    // [v1.4.3] CAPTURE TOTAL BYTES AS NUMBER FOR PERSISTENCE
                    const totalBytesNum = parseSizeToBytes(totalSizeStr);

                    if (trackerRef) {
                      // [v1.3.0] SMOOTH PROGRESS CALCULATION (Weighted)
                      let displayPercentage = percentage
                      let receivedBytesNum = 0
                      const streamType = (trackerRef as any)._currentStreamType

                      if (trackerRef.videoSize && trackerRef.audioSize) {
                        // Both sizes known (usually during audio phase)
                        const totalSum = trackerRef.videoSize + trackerRef.audioSize
                        if (streamType === 'audio') {
                          receivedBytesNum = trackerRef.videoSize + (percentage / 100) * trackerRef.audioSize
                        } else {
                          receivedBytesNum = (percentage / 100) * trackerRef.videoSize
                        }
                        displayPercentage = (receivedBytesNum / totalSum) * 100
                      } else if (trackerRef.videoSize && !(trackerRef as any).isHLS) {
                        // Only video size known (during video phase)
                        // Estimate audio as 10% for smooth bar
                        // [v1.8.4] BYPASS for HLS: Moovbob already bundles A+V
                        const estimatedTotal = trackerRef.videoSize * 1.1
                        receivedBytesNum = (percentage / 100) * trackerRef.videoSize
                        displayPercentage = (receivedBytesNum / estimatedTotal) * 100
                      } else {
                        receivedBytesNum = (percentage / 100) * totalBytesNum
                      }

                      // Ensure monotonic (never decrease)
                      if (trackerRef.lastProgress !== undefined && displayPercentage < trackerRef.lastProgress) {
                        displayPercentage = trackerRef.lastProgress
                      }

                      trackerRef.lastProgress = displayPercentage
                      trackerRef.filename = filename
                      trackerRef.speed = percentage >= 100 ? '0B/s' : speed
                      trackerRef.timeLeft = timeLeft

                      // [v1.3.0] CUMULATIVE SIZE LOGIC
                      if (totalBytesNum > 0) {
                        if (streamType === 'video') {
                          trackerRef.videoSize = totalBytesNum
                        } else if (streamType === 'audio') {
                          trackerRef.audioSize = totalBytesNum
                        }

                        // Calculate total sum
                        const totalSum = (trackerRef.videoSize || 0) + (trackerRef.audioSize || 0)
                        if (totalSum > 0) {
                          trackerRef.totalBytes = totalSum
                        } else {
                          trackerRef.totalBytes = totalBytesNum
                        }
                      }

                      // Format total size for display
                      if (trackerRef.totalBytes && trackerRef.totalBytes > 0) {
                        totalSizeStr = formatBytes(trackerRef.totalBytes)
                      } else if (totalBytesNum > 0) {
                        totalSizeStr = formatBytes(totalBytesNum)
                      }

                      // Update simulated segment progress for visual feedback (IDM style)
                      if (trackerRef.segmentProgress) {
                        for (let s = 0; s < 16; s++) {
                          const variation = (Math.random() * 5) - 2.5
                          trackerRef.segmentProgress[s] = Math.min(100, Math.max(0, displayPercentage + variation))
                        }
                      }

                      const finalReceived = formatBytes(receivedBytesNum)

                      if (displayPercentage >= 100) {
                        if (!win.isDestroyed()) {
                          win.webContents.send('download-progress', {
                            url,
                            audioOnly,
                            progress: 100,
                            state: 'downloading',
                            speed: 0,
                            timeLeft: '00:00',
                            receivedBytes: formatBytes(trackerRef.totalBytes || totalBytesNum),
                            totalBytes: totalSizeStr,
                            filename,
                            strategy: 'yt-dlp',
                            canResume: true,
                            savePath: trackerRef?.savePath,
                            statusMessage: trackerRef?.statusMessage,
                            segmentProgress: trackerRef?.segmentProgress ? [...trackerRef.segmentProgress] : undefined
                          })
                        }
                      } else {
                        if (!win.isDestroyed()) {
                          win.webContents.send('download-progress', {
                            url,
                            audioOnly,
                            progress: displayPercentage,
                            receivedBytes: finalReceived,
                            totalBytes: totalSizeStr,
                            state: 'downloading',
                            speed,
                            timeLeft,
                            filename,
                            strategy: 'yt-dlp',
                            canResume: true,
                            savePath: trackerRef?.savePath,
                            statusMessage: trackerRef?.statusMessage,
                            segmentProgress: trackerRef?.segmentProgress ? [...trackerRef.segmentProgress] : undefined
                          })
                        }
                      }
                    }
                  }
                }
              }

              ytDlpProcess.stdout.on('data', handleData)
              ytDlpProcess.stderr.on('data', (data) => {
                // [v1.7.6] CRITICAL: aria2c often writes progress to stderr when used as downloader
                handleData(data)
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
                  // Last ditch effort to find filename if "Merger" line was missed or output format differed
                  // We check standard file extension if we only have a temp ID-based name?
                  // No, allow whatever we captured.

                  // v1.2.8: Force re-verify "already downloaded" content if filename is wrong
                  if (!customFilename && output.includes('has already been downloaded')) {
                    const m = output.match(/\[download\] (.+) has already been downloaded/)
                    if (m && m[1]) filename = require('path').basename(m[1])
                  } else if (!customFilename && (output.includes('[Merger]') || output.includes('[merger]'))) {
                    const m = output.match(/Merging formats into "(.+)"/)
                    if (m && m[1]) filename = require('path').basename(m[1])
                  }

                  const finalPath = require('path').join(savePath, filename)

                  // Ensure stat check safety - Retry a few times if filesystem is slow to release lock?
                  let fileSize = 0
                  try { fileSize = fs.statSync(finalPath).size } catch (e) {
                    console.error('[yt-dlp] Final file not found (yet?):', finalPath)
                  }

                  // [v1.9.7] STEALTH MODE: Reveal the final file!
                  unhideFile(finalPath);

                  if (!win.isDestroyed()) {
                    win.webContents.send('download-complete', {
                      url, filePath: finalPath, filename, totalBytes: fileSize, state: 'finished'
                    })
                    win.webContents.send('notification', { title: 'Terminé', body: filename })
                  }
                  resolve(true)
                } else {
                  const tracker = activeDownloads.get(url)
                  if (tracker && (tracker.paused || tracker.cancelled)) {
                    reject(new Error('Cancelled'))
                  } else {
                    // Check known errors for logging
                    let errorMessage = `Exit code ${code}`
                    if (errorOutput.includes('Unsupported URL')) {
                      errorMessage = 'URL non supportée (Ce n\'est pas une vidéo)'
                    } else if (errorOutput.includes('Sign in') || errorOutput.includes('403')) {
                      console.log('Retry-able error detected')
                    } else if (errorOutput.includes('Video unavailable')) {
                      errorMessage = 'Vidéo indisponible (Supprimée ou privée)'
                    }

                    reject(new Error(errorMessage))
                  }
                }
              })

              ytDlpProcess.on('error', reject)
            })
            // If resolve(true) reached:
            return // BREAK LOOP
          } catch (err: any) {
            console.error(`Attempt ${i + 1} failed: ${err.message}`)
            if (i === attempts.length - 1) throw err
          }
        }
      }

      await performDownload()
      
      // [v1.7.7] SUCCESS CLEANUP: Remove any stray fragments that merger might have missed
      cleanupDebris(savePath, tracker?.filename || customFilename || 'download')

      // [v1.2.9] CLEANUP: Remove empty temp folder
      try {
        if (existsSync(tempDir)) {
          const files = fs.readdirSync(tempDir);
          if (files.length === 0) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        }
      } catch (e) { }

    } else {
      throw new Error('yt-dlp executable not found.')
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

    // [v1.2.9] CRITICAL FIX: Do NOT swallow error! Re-throw it so caller (queue manager) can handle retry.
    // Also do NOT call handleDownloadEnd(url) here, as it removes the tracker prematurely.
    
    // [v1.7.7] FAILURE CLEANUP: If all retries failed, don't leave mess
    if (savePath) {
        cleanupDebris(savePath, tracker?.filename || customFilename || 'download')
    }

    throw error
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
    const origin = req.headers.origin || ''
    const isExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')

    // CORS headers - Only allow verified origins
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': isExtension ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-DoulGet-Token',
      'Access-Control-Allow-Private-Network': 'true'
    }

    // Security check: Block unauthorized origins
    if (origin && !isExtension) {
      console.warn(`[Security] Forbidden request from: ${origin}`)
      res.writeHead(403, corsHeaders)
      res.end(JSON.stringify({ error: 'Origin not allowed' }))
      return
    }

    // Gérer les requêtes OPTIONS (pre-flight)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
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
          app: 'DoulGet',
          version: '1.2.6',
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
      res.end(JSON.stringify({ status: 'ok', app: 'DoulGet' }))
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

          // [v1.3.6] COMPREHENSIVE PARASITE FILTER — Multi-layer defense
          // Layer 1: Domain blacklist
          const domainBlacklist = [
            'googleads.', 'doubleclick.', 'google-analytics.', 'googletagmanager.',
            'facebook.net/signals', '/sw.js_data', 'analytics', 'telemetry', 'recaptcha',
            'mail.google.com', 'gmail.com', 'inbox.google.com',
            'docs.google.com', 'sheets.google.com', 'slides.google.com',
            'drive.google.com', 'calendar.google.com', 'contacts.google.com',
            'maps.google.com', 'meet.google.com', 'chat.google.com',
            'accounts.google.com', 'myaccount.google.com',
            'translate.google.com', 'play.google.com/log',
            'google.com/search', 'google.com/complete', 'google.com/async',
            'gstatic.com', 'fonts.googleapis.com', 'safebrowsing',
            'update.googleapis.com', 'clients1.google.com', 'clients2.google.com',
            'googleusercontent.com/meips', 'customeriomail.com',
            'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
            'mail.yahoo.com', 'mail.aol.com',
            'web.whatsapp.com', 'web.telegram.org',
            'checkbuild', 'gen_204', 'httpservice', 'ValidationAsyncService'
          ];
          // Layer 2: File extension blacklist (images, text, web assets, subtitles)
          const parasiteExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
            '.txt', '.json', '.html', '.htm', '.css', '.js', '.xml', '.csv', '.woff', '.woff2', '.ttf', '.eot',
            '.srt', '.vtt', '.ass', '.dfxp', '.ttml'];
          // Layer 3: Filename blacklist
          const parasiteFilenames = ['unnamed', 'response.bin', 'f.txt', 'checkbuild', 'sw.js_data'];
          // Layer 4: Referer blacklist (content loaded FROM these sites)
          const refererBlacklist = ['mail.google.com', 'gmail.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com'];

          const urlLowerCheck = downloadUrl.toLowerCase();
          const filenameLowerCheck = filename.toLowerCase();
          const referer = (data.headers && (data.headers.Referer || data.headers.referer)) || '';

          const isBlocked =
            domainBlacklist.some(b => urlLowerCheck.includes(b)) ||
            parasiteExtensions.some(ext => urlLowerCheck.split('?')[0].split('#')[0].endsWith(ext) || filenameLowerCheck.endsWith(ext)) ||
            parasiteFilenames.some(f => filenameLowerCheck.includes(f)) ||
            refererBlacklist.some(r => referer.includes(r));

          if (isBlocked) {
            console.log('🚫 Ignoring parasite download (blocked):', downloadUrl.substring(0, 80), '| filename:', filename);
            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...corsHeaders
            })
            res.end(JSON.stringify({ success: true, ignored: true }))
            return
          }

          console.log('📥 Download request received from extension:')
          console.log('  URL:', downloadUrl)
          console.log('  Filename:', filename)
          console.log('  Origin:', `Tab: ${data.tabId || 'N/A'}, Frame: ${data.frameId || '0'}`)
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
          // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
          // Handled by addToDownloadQueue but we ensure parent exists
          const downloadFolder = appSettings.downloadPath
          console.log('📁 Dossier de téléchargement:', downloadFolder)

          // Ajouter à la queue (sera traité automatiquement selon la limite de téléchargements simultanés)
          addToDownloadQueue(
            downloadUrl,
            mainWindow,
            downloadFolder,
            filename,
            data.type,
            data.mimeType,
            0, // Priorité par défaut
            data.headers || {}, // Pass headers
            !!data.audioOnly
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

    // [v1.7.0] Endpoint pour recevoir un lot (Batch) de téléchargements
    if (url.pathname === '/batch-download' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', async () => {
        try {
          if (!body || body.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: 'Empty request body' }))
            return
          }

          const data = JSON.parse(body)
          const playlistTitle = (data.playlistTitle || 'Batch Download').replace(/[<>:"/\\|?*]/g, ' ').trim()
          const items = data.items || []

          if (items.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: 'No items in batch' }))
            return
          }

          const windows = BrowserWindow.getAllWindows()
          const mainWindow = windows.find((w) => !w.isDestroyed())
          if (!mainWindow) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: 'Main window not found' }))
            return
          }

          // Bring UI to front for feedback
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()

          // [v1.7.0] Create specific subfolder for this batch
          const baseFolder = appSettings.downloadPath
          const batchFolder = join(baseFolder, 'Videos', playlistTitle)
          
          if (!fs.existsSync(batchFolder)) {
            try { fs.mkdirSync(batchFolder, { recursive: true }) } catch (e) { }
          }

          console.log(`📦 Batch Download received: ${playlistTitle} (${items.length} items)`)

          // [v1.6.0] Items now arrive with resolved CDN URLs from extension click-and-capture
          mainWindow.webContents.send('external-batch', {
            playlistTitle,
            items: items.map((item: any, idx: number) => ({
              id: `ext-${idx}-${Date.now()}`,
              url: item.url,
              title: item.filename,
              selected: true
            })),
            headers: data.headers || {}
          })

          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ success: true, count: items.length }))
        } catch (error: any) {
          console.error('DoulBrowser: Erreur dans /batch-download:', error)
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ error: error.message || 'Invalid Batch JSON' }))
        }
      })
      return
    }

    // Endpoint pour obtenir le statut d'un téléchargement
    if (url.pathname === '/download-status' && req.method === 'GET') {
      const downloadUrl = url.searchParams.get('url')
      const audioOnly = url.searchParams.get('audioOnly') === 'true'
      if (downloadUrl) {
        // 1. Check in Active Downloads - [v1.7.0] Composite
        const trackerId = getTrackerId(downloadUrl, audioOnly)
        let tracker = activeDownloads.get(trackerId)

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
        // [v1.3.7] Check in Recently Completed (Sync Fix)
        else if (recentlyCompletedDownloads.has(trackerId)) {
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({
            status: 'completed',
            progress: 100,
            receivedBytes: 0,
            totalBytes: 0,
            speed: 0,
            speedFormatted: 'Completed',
            timeLeft: '0s'
          }))
        }
        // 2. Check in Queue (Fix for 404 errors)
        else {
          const queuedItem = downloadQueue.find(item => item.url === downloadUrl && !!item.audioOnly === audioOnly)
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
            mainWindow.webContents.send('download-pause', data.url, !!data.audioOnly)
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
            mainWindow.webContents.send('download-resume', data.url, undefined, undefined, !!data.audioOnly)
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
            mainWindow.webContents.send('download-cancel', data.url, !!data.audioOnly)
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
    app.setAppUserModelId('com.doulget.app')
  }

  // [v1.6.9] Initialize Licensing
  const initializeLicensing = async () => {
    const mid = await getMachineId()
    appSettings.machineId = mid
    
    // [v1.9.28] Anti-Fraud: Time Checks
    const now = new Date()
    let verifiedDate = now
    let isClockTampered = false

    // 1. Check local time drift
    if (appSettings.lastOpenedDate) {
        const lastOpened = new Date(appSettings.lastOpenedDate)
        if (now < lastOpened) {
            console.error(`[Licensing] CLOCK TAMPERING DETECTED. System time: ${now}, Last opened: ${lastOpened}`)
            isClockTampered = true
        }
    }

    // 2. Online verification (if possible)
    const onlineDate = await getOnlineTime()
    const cloudStatus = await checkLicenseOnline(mid)
    
    if (onlineDate) {
        console.log(`[Licensing] Online time verified: ${onlineDate}`)
        verifiedDate = onlineDate
        // If system time is significantly behind (more than 1 hour), trust online time
        if (Math.abs(now.getTime() - onlineDate.getTime()) > 3600000) {
             console.warn('[Licensing] Local time deviates significantly from online time. Using online time.')
        }
    } else {
        console.warn('[Licensing] Could not verify time online (Offline mode).')
    }

    // 3. Cloud ban check
    if (cloudStatus && cloudStatus.isBlocked) {
        console.error('[Licensing] Machine is BLOCKED in cloud database.')
        appSettings.isActivated = false
        saveSettings({ isActivated: false })
        return // Stop here
    }

    // Check expiration if activated
    if (appSettings.isActivated && appSettings.licenseKey && appSettings.expiryDate) {
      const verification = verifyLicense(appSettings.licenseKey, mid)
      const expiryDate = new Date(appSettings.expiryDate)
      
      // Use cloud expiry if available and more restrictive? (Optional)
      
      if (!verification.valid || verifiedDate > expiryDate || isClockTampered) {
        const reason = isClockTampered ? 'Clock tampering' : (verifiedDate > expiryDate ? 'Expired' : 'Invalid key')
        console.warn(`[Licensing] License deactivated at startup. Reason: ${reason}`)
        appSettings.isActivated = false
        saveSettings({ isActivated: false })
      } else {
        console.log(`[Licensing] License valid until: ${appSettings.expiryDate}`)
      }
    } else if (appSettings.isActivated) {
         appSettings.isActivated = false;
         saveSettings({ isActivated: false });
    }

    // 4. Persistence of Trial (Online)
    // If we have a cloud record, ensure local settings match the cloud truth
    if (cloudStatus) {
        if (cloudStatus.expiry && (!appSettings.isActivated || !appSettings.expiryDate)) {
            console.log(`[Licensing] Syncing local expiry with cloud truth: ${cloudStatus.expiry}`)
            saveSettings({ expiryDate: cloudStatus.expiry })
            appSettings.expiryDate = cloudStatus.expiry
        }
    } else {
        // [v1.9.31] Trial disabled: New machines must purchase a license.
        console.log(`[Licensing] New machine detected: ${mid}. No license found. A subscription is required.`)
    }



    // Update last opened date only if clock isn't tampered
    if (!isClockTampered) {
        saveSettings({ lastOpenedDate: now.toISOString() })
    }

    // [v1.9.30] Start security heartbeat
    startLicenseHeartbeat(mid)
  }



  // Load Settings
  appSettings = loadSettings()
  initializeLicensing()

  // Activer l'extension de capture de téléchargements (style IDM)
  try {
    let extensionPath = join(__dirname, '../../extension_clean')

    // [v1.6.1] Fix for ASAR: check for unpacked version
    if (extensionPath.includes('app.asar')) {
      const unpackedPath = extensionPath.replace('app.asar', 'app.asar.unpacked')
      if (fs.existsSync(unpackedPath)) {
        extensionPath = unpackedPath
      }
    }

    console.log('Loading extension from:', extensionPath)
    if (fs.existsSync(extensionPath)) {
      session.defaultSession.loadExtension(extensionPath, { allowFileAccess: true })
        .then(() => console.log('Extension loaded successfully: DoulGet COMPLETE'))
        .catch((err) => console.error('Failed to load extension:', err))
    } else {
      console.warn('Extension directory not found at:', extensionPath)
    }
  } catch (err) {
    console.error('Error loading extension:', err)
  }
  createWindow()

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
      // Create/Update tracker with audio flag - [v1.7.0] Composite
      const trackerId = getTrackerId(url, true)
      let tracker = activeDownloads.get(trackerId)
      if (!tracker) {
        tracker = {
          item: null,
          url,
          startTime: Date.now(),
          lastBytes: 0,
          lastTime: Date.now(),
          audioOnly: true,
          strategy: 'yt-dlp'
        }
        activeDownloads.set(trackerId, tracker)
      } else {
        tracker.audioOnly = true
      }
    }

    // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
    const subFolder = (!!audioOnly) ? 'Audios' : 'Videos'
    const finalPath = join(appSettings.downloadPath, subFolder)
    if (!fs.existsSync(finalPath)) {
      try { fs.mkdirSync(finalPath, { recursive: true }) } catch (e) { }
    }

    // Delegate to yt-dlp with specific format
    await downloadWithYtDlp(
      url,
      finalPath,
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

  ipcMain.on('download-start', async (event, url: string, savePath?: string, audioOnly: boolean = false) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    try {
      const downloadFolder = savePath || appSettings.downloadPath
      const trackerId = getTrackerId(url, audioOnly)
      console.log(`[Manual Download] Adding to queue: ${trackerId}`)

      const isAudioHeuristic =
        url.toLowerCase().includes('.mp3') ||
        url.toLowerCase().includes('.m4a') ||
        url.toLowerCase().includes('soundcloud.com')

      const finalAudioOnly = audioOnly || isAudioHeuristic
      
      addToDownloadQueue(
        url,
        win,
        downloadFolder, // addToDownloadQueue will now handle the subfolder logic internally
        undefined, // filename
        undefined, // type
        undefined, // mimeType
        1, // Higher priority for manual downloads
        {}, // No special headers for manual input
        finalAudioOnly
      )
    } catch (error: any) {
      win.webContents.send('download-error', {
        url,
        error: error.message || 'Failed to start download'
      })
    }
  })

  ipcMain.on('download-pause', (event, url: string, audioOnly: boolean = false) => {
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = activeDownloads.get(trackerId)
    const win = BrowserWindow.fromWebContents(event.sender)

    // Cas 1 : téléchargement \"classique\" géré par Electron
    if (tracker && tracker.item && !tracker.item.isPaused()) {
      tracker.item.pause()

      // Update count and process queue on pause
      processDownloadQueue()

      // Send the last known progress percentage when pausing
      win?.webContents.send('download-paused', {
        url,
        audioOnly,
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

      // Update count and process queue on pause
      processDownloadQueue()

      win?.webContents.send('download-paused', {
        url,
        progress: tracker.lastProgress !== undefined ? Math.round(tracker.lastProgress) : 0
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
        processDownloadQueue()
      } catch (error) {
        console.error('Error killing yt-dlp process for pause:', error)
      }

      // Send the last known progress percentage when pausing
      win?.webContents.send('download-paused', {
        url,
        audioOnly,
        progress: tracker.lastProgress !== undefined ? tracker.lastProgress : 0
      })
    }
  })

  ipcMain.on('download-resume', (event, url: string, savePath?: string, filename?: string, audioOnly: boolean = false) => {
    const trackerId = getTrackerId(url, audioOnly)
    console.log(`[IPC] download-resume received for: ${trackerId}`)
    let tracker = activeDownloads.get(trackerId)
    const win = BrowserWindow.fromWebContents(event.sender)

    // If tracker is missing (e.g. after error/restart), try to recreate it
    if (!tracker && savePath) {
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

      console.log(`[Resume] Tracker missing for ${url}, recreating (Strategy: ${strategy})...`)
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
        strategy: strategy,
        audioOnly: audioOnly // [v1.7.0] Use passed flag
      }
      activeDownloads.set(trackerId, tracker)
    } else if (tracker) {
      console.log(`[Resume] Found existing tracker for ${trackerId}. Progress: ${tracker.lastProgress}%, Strategy: ${tracker.strategy}`)
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
      win?.webContents.send('download-resumed', { url, audioOnly })
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
      // No activeDownloadCount increment needed (dynamic calc)

      // Envoyer immédiatement le pourcentage actuel pour éviter qu'il revienne à 0
      const currentProgress = tracker.lastProgress || 0
      const currentBytes = tracker.lastBytes || 0

      win?.webContents.send('download-progress', {
        url: url,
        audioOnly,
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

      win?.webContents.send('download-resumed', { url, audioOnly })
        ; (async () => {
          try {
            const { platform } = isSocialMediaURL(url)
            await downloadWithYtDlp(
              url,
              tracker.savePath as string,
              platform || (tracker.isYouTube ? 'YouTube' : ''),
              win!,
              undefined,
              tracker.filename,
              false, // isRetry
              audioOnly // [v1.7.0] Correct format
            )
          } catch (error: any) {
            win?.webContents.send('download-error', {
              url,
              audioOnly,
              error: error.message || 'Failed to resume download'
            })
          }
        })()
      return
    }

    // Cas 3 : téléchargement multi-threaded : reprendre à partir des segments déjà téléchargés
    if (tracker && tracker.savePath && !tracker.item && !tracker.process) {
      tracker.paused = false
      // No activeDownloadCount increment needed (dynamic calc)

      // Envoyer immédiatement le pourcentage actuel pour éviter qu'il revienne à 0
      const currentProgress = tracker.lastProgress || 0
      const currentBytes = tracker.lastBytes || 0

      win?.webContents.send('download-progress', {
        url: url,
        audioOnly,
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

      win?.webContents.send('download-resumed', { url, audioOnly })

        // Relancer le téléchargement multi-threaded
        ; (async () => {
          try {
            if (win) {
              await downloadWithMultiThreading(url, tracker.savePath!, win, audioOnly)
            }
          } catch (error: any) {
            win?.webContents.send('download-error', {
              url,
              audioOnly,
              error: error.message || 'Failed to resume download'
            })
          }
        })()
    }
  })

  ipcMain.on('download-cancel', (_event, url: string, audioOnly: boolean = false) => {
    stopDownload(url, audioOnly)
  })

  ipcMain.on('download-open-folder', async (_event, url: string, savePath?: string, filename?: string, audioOnly: boolean = false) => {
    // Strategy: Use passed arguments if available (from renderer state), otherwise fallback to tracker
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = activeDownloads.get(trackerId)
    const finalSavePath = savePath || tracker?.savePath
    const finalFilename = filename || tracker?.filename

    if (finalSavePath) {
      if (finalFilename) {
        // Best case: Open folder AND select the file
        const fullPath = join(finalSavePath, finalFilename)
        if (fs.existsSync(fullPath)) {
          shell.showItemInFolder(fullPath)
        } else {
          // Fallback: File missing, open folder
          shell.openPath(finalSavePath)
        }
      } else {
        // No filename, just open folder
        shell.openPath(finalSavePath)
      }
    } else {
      // If no save path known, open default downloads folder
      shell.openPath(app.getPath('downloads'))
    }
  })

  ipcMain.handle('download-select-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow as any, {
      properties: ['openDirectory']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle('delete-file', async (_event, pathOrFolder: string, filename?: string) => {
    try {
      console.log(`[Delete Request] Path/Folder: "${pathOrFolder}", Filename: "${filename}"`)
      if (!pathOrFolder) return false

      let targetFileObj: string | null = null

      // Check 1: Is pathOrFolder itself the file?
      try {
        const stat1 = await fs.promises.stat(pathOrFolder)
        if (stat1.isFile()) {
          targetFileObj = pathOrFolder
        }
      } catch (e) {
        /* might not exist or be folder */
      }

      // Check 2: If directly trying as file failed, try join(folder, filename)
      if (!targetFileObj && filename) {
        const joinedPath = join(pathOrFolder, filename)
        try {
          const stat2 = await fs.promises.stat(joinedPath)
          if (stat2.isFile()) {
            targetFileObj = joinedPath
          }
        } catch (e) {
          /* doesn't exist */
        }
      }

      if (targetFileObj) {
        console.log(`[Delete] Moving file to Recycle Bin: "${targetFileObj}"`)
        // [v1.2.9] Use shell.trashItem to support the "Corbeille" feature
        await shell.trashItem(targetFileObj)

        // Cleanup potential partials (these are safe to delete permanently)
        const related = [targetFileObj + '.part', targetFileObj + '.ytdl', targetFileObj + '.aria2']
        for (const r of related) {
          if (fs.existsSync(r)) {
            try {
              await fs.promises.unlink(r)
            } catch {}
          }
        }
        return true
      } else {
        console.error(
          `[Delete] File not found. Checked: "${pathOrFolder}" and join with "${filename}"`
        )
        return false
      }
    } catch (error) {
      console.error(`[Delete] Error deleting file:`, error)
      return false
    }
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

  // [v1.6.9] Licensing IPC Handlers
  ipcMain.handle('get-license-status', async () => {
    return {
      isActivated: appSettings.isActivated,
      expiryDate: appSettings.expiryDate,
      machineId: appSettings.machineId,
      licenseKey: appSettings.licenseKey
    }
  })

  ipcMain.handle('get-machine-id', async () => {
    return await getMachineId()
  })

  ipcMain.handle('activate-license', async (_event, key: string) => {
    const mid = await getMachineId()
    const verification = verifyLicense(key, mid)

    if (verification.valid) {
      // SECURITY: If it was a bulk key (starting with B-), lock it to this machine now
      let finalKey = key;
      if (key.startsWith('B-') || key === 'DadiLicence2026') {
          finalKey = signLicense(mid, verification.expiry as string)
      }

      // [v1.9.34] Sync to Cloud with MANDATORY check & unblock
      const syncSuccess = await updateLicenseOnline(mid, {
          license_key: finalKey,
          expiry_date: verification.expiry as string,
          activated_at: new Date().toISOString(),
          original_key: key,
          is_blocked: false // Always unblock if a valid activation happens
      }, true); // allowInsert = true

      if (!syncSuccess) {
          console.error('[Licensing] Database sync failed during activation.');
          return { success: false, error: 'Erreur de synchronisation Cloud. Veuillez vérifier votre connexion.' }
      }

      const updated = saveSettings({
        isActivated: true,
        licenseKey: finalKey,
        expiryDate: verification.expiry
      })
      if (updated) appSettings = updated
      return { success: true, expiry: verification.expiry }
    } else {
      return { success: false, error: 'Clé invalide ou expirée.' }
    }
  })


  // [v1.9.30] Secure Admin password verification
  ipcMain.handle('verify-admin-password', async (_event, password: string) => {
    return checkAdminPassword(password);
  })



  // [v1.9.21] Secret Admin: Reset/Deactivate license (for admin use only)
  ipcMain.handle('admin-reset-license', async (_event, password: string) => {
    if (!checkAdminPassword(password)) {
      return { success: false, error: 'Mot de passe incorrect.' }
    }
    const updated = saveSettings({
      isActivated: false,
      licenseKey: '',
      expiryDate: null
    })
    if (updated) appSettings = updated
    console.log('[Licensing] License reset by admin.')
    return { success: true }
  })

  // Secure Admin Logic (Only for the user to generate keys)
  ipcMain.handle('admin-generate-key', async (_event, password, machineId, durationDays) => {
    if (!checkAdminPassword(password)) {
      return { success: false, error: 'Mot de passe admin incorrect.' }
    }

    const now = new Date()
    let expiryDate: Date

    if (durationDays === 'permanent') {
      expiryDate = new Date('2099-12-31')
    } else if (typeof durationDays === 'string' && durationDays.startsWith('date:')) {
      expiryDate = new Date(durationDays.split('date:')[1])
    } else {
      expiryDate = new Date(now.getTime() + parseInt(durationDays) * 24 * 60 * 60 * 1000)
    }

    const isoExpiry = expiryDate.toISOString() 
    const key = signLicense(machineId, isoExpiry)

    return { success: true, key, expiry: isoExpiry }
  })

  // Bulk Generator for admin
  ipcMain.handle('admin-bulk-generate', async (_event, password, count, durationDays) => {
    if (!checkAdminPassword(password)) {
      return { success: false, error: 'Mot de passe admin incorrect.' }
    }

    const keys: string[] = []
    const now = new Date()
    let expiryDate: Date

    if (durationDays === 'permanent') {
      expiryDate = new Date('2099-12-31')
    } else if (typeof durationDays === 'string' && durationDays.startsWith('date:')) {
      expiryDate = new Date(durationDays.split('date:')[1])
    } else {
      expiryDate = new Date(now.getTime() + parseInt(durationDays) * 24 * 60 * 60 * 1000)
    }

    const isoExpiry = expiryDate.toISOString()

    for (let i = 0; i < count; i++) {
      // Use 'B-' prefix for Bulk/Generic keys
      const randomId = 'B-' + crypto.randomBytes(4).toString('hex').toUpperCase()
      const key = signLicense(randomId, isoExpiry)
      keys.push(key)
    }

    return { success: true, keys }
  })

  // [v1.9.29] Fetch all licenses / machine registrations from cloud for Admin
  ipcMain.handle('admin-get-all-licenses', async (_event, password) => {
    if (!checkAdminPassword(password)) {
      return { success: false, error: 'Mot de passe admin incorrect.' }
    }
    const data = await supabaseRequest('licences?select=*&order=activated_at.desc', 'GET');
    if (data && Array.isArray(data)) {
        return { success: true, licenses: data };
    }
    return { success: false, error: 'Impossible de récupérer les données cloud.' };
  })

  // [v1.9.32] Remote Block/Unblock for Admin
  ipcMain.handle('admin-update-license-status', async (_event, password, targetMid, isBlocked) => {
    if (!checkAdminPassword(password)) {
        return { success: false, error: 'Mot de passe admin incorrect.' }
    }
    const success = await updateLicenseOnline(targetMid, { is_blocked: isBlocked });
    return { success };
  })

  // [v1.9.34] Heartbeat for online status
  ipcMain.handle('ping-license', async () => {
    const isActivated = appSettings.isActivated
    if (!isActivated) return { success: false }

    const mid = await getMachineId()
    
    // Check cloud status first
    const cloud = await checkLicenseOnline(mid)
    
    // If deleted from cloud (NOT_FOUND) or blocked (isBlocked: true)
    if (cloud.status === 'NOT_FOUND' || (cloud.status === 'FOUND' && cloud.isBlocked)) {
        console.error(`[Licensing] Client ${mid} ${cloud.status === 'NOT_FOUND' ? 'suppressed' : 'blocked'} from Cloud. Deactivating...`)
        
        // Update local settings to DEACTIVATED
        appSettings.isActivated = false
        appSettings.licenseKey = ''
        appSettings.expiryDate = null
        saveSettings({ 
            isActivated: false, 
            licenseKey: '', 
            expiryDate: null 
        })

        // Notify all renderers immediately
        const windows = BrowserWindow.getAllWindows()
        const reason = cloud.status === 'NOT_FOUND' ? "Votre licence a été supprimée par l'administrateur." : "Votre machine a été suspendue (BANNIE)."
        windows.forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('license-deactivated', reason)
            }
        })

        return { success: false, error: 'License deactivated' }
    }

    // Otherwise, just update last seen as usual (allowInsert = false by default)
    await updateLicenseOnline(mid, { last_seen: new Date().toISOString() })
    return { success: true }
  })

  // [v1.9.34] Totally delete a license from cloud
  ipcMain.handle('admin-delete-license-cloud', async (_event, password, targetMid) => {
    if (!checkAdminPassword(password)) {
        return { success: false, error: 'Mot de passe admin incorrect.' }
    }
    const cleanMid = targetMid.trim().toUpperCase();
    const result = await supabaseRequest(`licences?hwid=eq.${encodeURIComponent(cleanMid)}`, 'DELETE');
    return { success: result !== null };
  })

  // [v1.9.33] UPDATE SYSTEM: Check for app updates
  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('check-app-update', async () => {
    // We use a shared 'app_config' table or similar for global settings
    const data = await supabaseRequest('app_config?key=eq.latest_version', 'GET');
    const urlData = await supabaseRequest('app_config?key=eq.update_url', 'GET');
    
    if (data && Array.isArray(data) && data.length > 0) {
        const latestRaw = data[0].value;
        const currentRaw = app.getVersion();
        const updateUrl = (urlData && Array.isArray(urlData) && urlData.length > 0) ? urlData[0].value : 'https://doulget.com';

        // [v1.5.2] Robust version comparison
        const normalize = (v: string) => v.toLowerCase().replace(/^v/, '').trim();
        const latest = normalize(latestRaw);
        const current = normalize(currentRaw);

        // Semver comparison logic: returns true if 'v1' > 'v2'
        const isNewer = (v1: string, v2: string) => {
            const parts1 = v1.split('.').map(Number);
            const parts2 = v2.split('.').map(Number);
            for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                if (p1 > p2) return true;
                if (p1 < p2) return false;
            }
            return false;
        };
        
        return {
            updateAvailable: isNewer(latest, current), 
            latestVersion: latestRaw,
            currentVersion: currentRaw,
            downloadUrl: updateUrl
        };
    }
    return { updateAvailable: false };
  })

  // [v1.6.0] Start downloading the update file to %TEMP%
  ipcMain.handle('start-app-update', async (event, downloadUrl: string) => {
    const tempPath = join(app.getPath('temp'), 'DoulGet_Update.exe');
    
    console.log(`[Update] Starting download from: ${downloadUrl}`);
    console.log(`[Update] Target path: ${tempPath}`);

    try {
        // Remove old update if exists
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        const file = fs.createWriteStream(tempPath);
        const request = https.get(downloadUrl, (response) => {
            if (response.statusCode !== 200) {
                console.error(`[Update] Failed to download: ${response.statusCode}`);
                event.sender.send('update-error', 'Impossible de télécharger la mise à jour.');
                return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                file.write(chunk);
                
                if (totalSize > 0) {
                    const progress = Math.round((downloadedSize / totalSize) * 100);
                    // Throttling: send progress only once per integer %
                    event.sender.send('update-progress', progress);
                }
            });

            response.on('end', () => {
                file.end();
                console.log('[Update] Download complete.');
                event.sender.send('update-ready');
            });
        });

        request.on('error', (err) => {
            console.error('[Update] Request error:', err);
            event.sender.send('update-error', err.message);
        });

        return { success: true };
    } catch (error: any) {
        console.error('[Update] Exception:', error);
        return { success: false, error: error.message };
    }
  })

  // [v1.6.0] Execute the downloaded installer and quit
  ipcMain.handle('install-app-update', async () => {
    const tempPath = join(app.getPath('temp'), 'DoulGet_Update.exe');
    
    if (!fs.existsSync(tempPath)) {
        return { success: false, error: 'Fichier installeur introuvable.' };
    }

    console.log('[Update] Launching installer and quitting...');
    
    // Launch installer detached and quit
    const { spawn } = require('child_process');
    spawn(tempPath, [], {
        detached: true,
        stdio: 'ignore'
    }).unref();

    app.quit();
    return { success: true };
  })

  ipcMain.handle('admin-set-latest-version', async (_event, password, newVersion, downloadUrl) => {
    if (!checkAdminPassword(password)) {
        return { success: false, error: 'Mot de passe admin incorrect.' }
    }
    
    // Update latest_version
    await supabaseRequest('app_config?key=eq.latest_version', 'PATCH', { value: newVersion });
    // Update update_url
    if (downloadUrl) {
        await supabaseRequest('app_config?key=eq.update_url', 'PATCH', { value: downloadUrl });
    }
    
    return { success: true };
  })

  // [v1.6.1] FEEDBACK SYSTEM: Submit a rating + comment
  ipcMain.handle('submit-feedback', async (_event, rating: number, comment: string) => {
    try {
      const mid = await getMachineId();
      const version = app.getVersion();
      const result = await supabaseRequest('feedback', 'POST', {
        hwid: mid,
        rating,
        comment: comment || null,
        app_version: version,
        created_at: new Date().toISOString()
      });
      if (result) {
        console.log('[Feedback] Submitted successfully.');
        return { success: true };
      }
      return { success: false, error: 'Supabase error' };
    } catch (e: any) {
      console.error('[Feedback] Error:', e);
      return { success: false, error: e.message };
    }
  })

  // [v1.6.1] FEEDBACK SYSTEM: Admin get all feedback
  ipcMain.handle('admin-get-feedback', async (_event, password: string) => {
    if (!checkAdminPassword(password)) {
      return { success: false, error: 'Mot de passe admin incorrect.' };
    }
    const data = await supabaseRequest('feedback?select=*&order=created_at.desc', 'GET');
    if (data && Array.isArray(data)) {
      return { success: true, feedback: data };
    }
    return { success: false, error: 'Impossible de récupérer les avis.' };
  })

  // [v1.6.1] FEEDBACK SYSTEM: Check if HWID already submitted feedback
  ipcMain.handle('get-feedback-status', async () => {
    try {
      const mid = await getMachineId();
      const data = await supabaseRequest(`feedback?hwid=eq.${encodeURIComponent(mid)}&select=rating`, 'GET');
      const submitted = data && Array.isArray(data) && data.length > 0;
      return { submitted };
    } catch {
      return { submitted: false };
    }
  })

  // [v1.9.33] Upload local Setup/Extension to Storage
  ipcMain.handle('admin-upload-update-file', async (_event, password, localPath, type: 'setup' | 'extension') => {
    if (!checkAdminPassword(password)) {
        return { success: false, error: 'Mot de passe admin incorrect.' }
    }

    if (!existsSync(localPath)) {
        return { success: false, error: 'Le fichier local n\'existe pas.' }
    }

    const fileName = type === 'setup' ? 'DoulGet_Setup.exe' : 'DoulGet_Extension.zip';
    const res = await supabaseUploadFile(localPath, 'updates', fileName);

    if (res.success && res.url) {
        // Automatically update the app_config
        const configKey = type === 'setup' ? 'update_url' : 'extension_url';
        await supabaseRequest(`app_config?key=eq.${configKey}`, 'PATCH', { value: res.url });
        return { success: true, url: res.url };
    }

    return { success: false, error: res.error || 'Échec de l\'upload vers Supabase Storage.' };
  })

  // [v1.9.33] Select local file via Dialog
  ipcMain.handle('admin-select-update-file', async (_event, type: 'setup' | 'extension') => {
    const filters = type === 'setup' 
        ? [{ name: 'Applications', extensions: ['exe'] }] 
        : [{ name: 'Archives Extension', extensions: ['zip'] }];

    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: filters
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
  })


  // Handler pour accepter un téléchargement détecté
  ipcMain.on('accept-detected-download', async (event, url: string, audioOnly: boolean = false) => {
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
          const baseDownloadPath = savePath.filePaths[0]
          // [v1.2.9] Use subFolder logic now handled partially by prepareDownloadPath or inline here
          const subFolder = audioOnly ? 'Audios' : 'Videos'
          const downloadPath = join(baseDownloadPath, subFolder)
          if (!fs.existsSync(downloadPath)) {
             try { fs.mkdirSync(downloadPath, { recursive: true }) } catch (e) { }
          }

          const trackerId = getTrackerId(url, audioOnly)
          const tracker: DownloadTracker = {
            item: null,
            url: url,
            startTime: Date.now(),
            lastBytes: 0,
            lastTime: Date.now(),
            savePath: downloadPath,
            isYouTube: platform === 'YouTube',
            audioOnly: audioOnly
          }
          activeDownloads.set(trackerId, tracker)
          await downloadWithYtDlp(url, downloadPath, platform, win, undefined, undefined, false, audioOnly)
        } catch (error: any) {
          win.webContents.send('download-error', {
            url,
            error: error.message || 'Failed to download'
          })
          handleDownloadEnd(url)
        }
      } else {
        try {
          const baseDownloadPath = savePath.filePaths[0]
          // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
          const subFolder = audioOnly ? 'Audios' : 'Videos'
          const downloadPath = join(baseDownloadPath, subFolder)
          if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath, { recursive: true })
          }

          const trackerId = getTrackerId(url, audioOnly)
          const tracker: DownloadTracker = {
            item: null,
            url: url,
            startTime: Date.now(),
            lastBytes: 0,
            lastTime: Date.now(),
            savePath: downloadPath,
            audioOnly: audioOnly
          }
          activeDownloads.set(trackerId, tracker)
          await downloadWithMultiThreading(url, downloadPath, win, audioOnly)
        } catch (error: any) {
          win.webContents.send('download-error', {
            url,
            error: error.message || 'Failed to download'
          })
          handleDownloadEnd(url)
        }
      }
    }
  })

  // Handler pour ignorer un téléchargement détecté
  ipcMain.on('dismiss-detected-download', () => {
    // Téléchargement ignoré - callback is intentionally empty
  })

  // [v1.2.9] LOCAL MP3 CONVERTER HANDLERS 🎵
  ipcMain.handle('select-local-video', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Vidéos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv'] }]
    })
    return result.filePaths[0] || null
  })

  ipcMain.handle('local-convert-video-to-mp3', async (_event, inputPath: string) => {
    return new Promise(async (resolve, reject) => {
      try {
        const ffmpegPath = await ensureFfmpegAvailable()
        if (!ffmpegPath) return reject(new Error('FFmpeg not found'))

        const path = require('path')
        const outputDir = path.dirname(inputPath)
        
        // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
        // If the original folder is 'Videos', we move up one level and go to 'Conversions'
        // If not, we just create 'Conversions' inside the current folder.
        let baseDir = outputDir;
        if (path.basename(outputDir) === 'Videos' || path.basename(outputDir) === 'Audios') {
          baseDir = path.dirname(outputDir);
        }
        const conversionDir = path.join(baseDir, 'Conversions');
        if (!fs.existsSync(conversionDir)) {
          fs.mkdirSync(conversionDir, { recursive: true });
        }

        const outputName = path.basename(inputPath, path.extname(inputPath)) + '.mp3'
        const outputPath = path.join(conversionDir, outputName)

        const { spawn } = require('child_process')
        const ffmpeg = spawn(ffmpegPath, [
          '-i', inputPath,
          '-vn',
          '-acodec', 'libmp3lame',
          '-ab', '192k',
          '-ar', '44100',
          '-y',
          outputPath
        ])

        let duration = 0
        ffmpeg.stderr.on('data', (data: Buffer) => {
          const text = data.toString()
          // Extract duration
          const durationMatch = text.match(/Duration: (\d+):(\d+):(\d+)/)
          if (durationMatch) {
            duration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3])
          }
          // Extract time and progress
          const timeMatch = text.match(/time=(\d+):(\d+):(\d+)/)
          if (timeMatch && duration > 0) {
            const currentTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])
            const progress = Math.min(Math.round((currentTime / duration) * 100), 99)
            BrowserWindow.getAllWindows()[0]?.webContents.send('conversion-progress', { progress, filename: outputName })
          }
        })

        ffmpeg.on('close', (code: number) => {
          if (code === 0) {
            resolve({ success: true, path: outputPath })
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`))
          }
        })

        ffmpeg.on('error', (err: any) => reject(err))
      } catch (err) {
        reject(err)
      }
    })
  })

  ipcMain.handle('local-compress-video', async (_event, inputPath: string, quality: 'low' | 'medium' | 'whatsapp' = 'whatsapp') => {
    return new Promise(async (resolve, reject) => {
      try {
        const ffmpegPath = await ensureFfmpegAvailable()
        if (!ffmpegPath) return reject(new Error('FFmpeg not found'))

        const path = require('path')
        const outputDir = path.dirname(inputPath)
        
        // [v1.3.0] AUTOMATIC FOLDER ORGANIZATION 📂
        let baseDir = outputDir;
        if (path.basename(outputDir) === 'Videos' || path.basename(outputDir) === 'Audios' || path.basename(outputDir) === 'Conversions') {
          baseDir = path.dirname(outputDir);
        }
        const compressedDir = path.join(baseDir, 'Conversions', 'Compressed');
        if (!fs.existsSync(compressedDir)) {
          fs.mkdirSync(compressedDir, { recursive: true });
        }

        const extension = path.extname(inputPath)
        const outputName = path.basename(inputPath, extension) + '_compressed' + (quality === 'whatsapp' ? '_wa' : '') + '.mp4'
        const outputPath = path.join(compressedDir, outputName)

        // Compression Settings (H.264)
        let ffmpegArgs = ['-i', inputPath]
        
        if (quality === 'whatsapp') {
          // Optimized for WhatsApp (target 720p, good CRF)
          ffmpegArgs.push(
            '-vcodec', 'libx264',
            '-crf', '28',
            '-preset', 'faster',
            '-vf', "scale='min(1280,iw)':-2", // Max 720p width
            '-acodec', 'aac',
            '-b:a', '128k'
          )
        } else if (quality === 'low') {
          ffmpegArgs.push('-vcodec', 'libx264', '-crf', '32', '-preset', 'veryfast')
        } else {
          ffmpegArgs.push('-vcodec', 'libx264', '-crf', '24', '-preset', 'medium')
        }

        ffmpegArgs.push('-y', outputPath)

        const { spawn } = require('child_process')
        const ffmpeg = spawn(ffmpegPath, ffmpegArgs)

        let duration = 0
        ffmpeg.stderr.on('data', (data: Buffer) => {
          const text = data.toString()
          const durationMatch = text.match(/Duration: (\d+):(\d+):(\d+)/)
          if (durationMatch) {
            duration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3])
          }
          const timeMatch = text.match(/time=(\d+):(\d+):(\d+)/)
          if (timeMatch && duration > 0) {
            const currentTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])
            const progress = Math.min(Math.round((currentTime / duration) * 100), 99)
            BrowserWindow.getAllWindows()[0]?.webContents.send('compression-progress', { progress, filename: outputName })
          }
        })

        ffmpeg.on('close', (code: number) => {
          if (code === 0) {
            resolve({ success: true, path: outputPath, filename: outputName })
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`))
          }
        })

        ffmpeg.on('error', (err: any) => reject(err))
      } catch (err) {
        reject(err)
      }
    })
  })

  // Démarrer le serveur HTTP pour communiquer avec l'extension de navigateur
  startExtensionServer()

  createWindow()
  console.log('[DEBUG] createWindow() executed')

  // Defer yt-dlp update to after window creation to ensure app starts quickly
  setTimeout(async () => {
    console.log('[DEBUG] Starting deferred autoUpdateYtDlp()')
    autoUpdateYtDlp()

    // [v1.7.1] PERFORMANCE: Pre-warm caches so first download starts instantly
    console.log('[PERF] Pre-warming High-Speed binaries caches...')
    const t0 = Date.now()
    await ensureFfmpegAvailable()
    await ensureNodeAvailable()
    await ensureAria2Available() // [v1.7.2] Include aria2c
    console.log(`[PERF] All caches ready in ${Date.now() - t0}ms`)
  }, 5000)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    createWindow()
  })

  // [v1.0.8] IPC Handler to get download logs
  ipcMain.handle('get-playlist-info', async (_event, url: string) => {
    const fetchInfo = (useFlat: boolean) => {
      return new Promise<any>(async (resolve, reject) => {
        try {
          const ytDlpPath = ensureYtDlpAvailable()
          if (!ytDlpPath) return reject(new Error('yt-dlp not found'))

          const args = [
            '--dump-single-json',
            '--no-warnings',
            '--no-check-certificates',
            '--no-playlist', // used when not useFlat but we handle it manually
            url
          ]
          
          if (useFlat) {
            args[args.indexOf('--no-playlist')] = '--flat-playlist'
          }

          const cp = spawn(ytDlpPath, args)
          let stdout = ''
          let stderr = ''

          cp.stdout.on('data', (data) => (stdout += data.toString()))
          cp.stderr.on('data', (data) => (stderr += data.toString()))

          cp.on('close', (code) => {
            if (code === 0) {
              try {
                const data = JSON.parse(stdout)
                
                // If it's a playlist
                if (data._type === 'playlist' || data.entries) {
                  const entries = (data.entries || []).map((entry: any) => ({
                    id: entry.id,
                    url: entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : url),
                    title: entry.title || 'Sans titre',
                    duration: entry.duration
                  }))
                  return resolve({
                    title: data.title || 'Playlist',
                    entries: entries
                  })
                }

                // If it's a single video
                resolve({
                  title: data.title || 'Vidéo',
                  entries: [{
                    id: data.id || 'video',
                    url: url,
                    title: data.title || 'Vidéo seule',
                    duration: data.duration
                  }]
                })
              } catch (e) {
                reject(new Error('Failed to parse info'))
              }
            } else {
              reject(stderr || `Exit ${code}`)
            }
          })
        } catch (err) {
          reject(err)
        }
      })
    }

    try {
      // First attempt: Fast flat-playlist
      return await fetchInfo(true)
    } catch (e: any) {
      console.log('[get-playlist-info] Flat-playlist failed, trying direct extraction:', e)
      // Second attempt: Full extraction (works for single videos or sites without playlist support)
      try {
        return await fetchInfo(false)
      } catch (e2: any) {
        throw new Error(e2.toString())
      }
    }
  })

  ipcMain.on('batch-add-to-queue', async (event, { items, playlistTitle, audioOnly, headers }: { items: any[], playlistTitle?: string, audioOnly: boolean, headers?: Record<string, string> }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const baseDownloadPath = appSettings.downloadPath
    const subFolder = audioOnly ? 'Audios' : 'Videos'
    
    // Create playlist subfolder if title provided
    let finalPath = join(baseDownloadPath, subFolder)
    if (playlistTitle) {
      finalPath = join(finalPath, sanitizeStringForFilename(playlistTitle))
    }

    if (!fs.existsSync(finalPath)) {
      try { fs.mkdirSync(finalPath, { recursive: true }) } catch (e) { }
    }

    // Add each item to queue
    items.forEach((item) => {
      addToDownloadQueue(
        item.url,
        win,
        finalPath,
        item.title,
        undefined, // type
        undefined, // mimeType
        2, // Normal priority for batch
        headers || {}, // [v1.5.1] Forward headers from external batch (Lok-lok fix)
        audioOnly
      )
    })

    win.webContents.send('notification', {
      title: 'Batch Downloader',
      body: `${items.length} vidéos ajoutées à la file d'attente.`
    })
  })

  ipcMain.handle('get-download-logs', (_event, url: string, audioOnly: boolean = false) => {
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = activeDownloads.get(trackerId)
    return tracker?.logs || []
  })

  // [v1.4.1] Restore active downloads from previous session
  setTimeout(() => {
    console.log('[PERSISTENCE] Restoring active downloads from previous session')
    restoreActiveDownloads()
  }, 2000) // Give app time to fully initialize
})

// [v1.4.1] Save active downloads before app quits
function saveActiveDownloads() {
  try {
    const persistencePath = join(app.getPath('userData'), 'active-downloads.json')

    // Serialize only serializable parts of activeDownloads
    const downloadsToSave = Array.from(activeDownloads.entries())
      .filter(([_, tracker]) =>
        // Only save downloads that are actually active (not finished/cancelled)
        // ALLOW undefined lastProgress for downloads that haven't started yet
        (tracker.lastProgress === undefined || tracker.lastProgress < 100) &&
        !tracker.cancelled &&
        tracker.url &&
        tracker.filename
      )
      .map(([id, tracker]) => ({
        url: tracker.url || id.split('|')[0], // [v1.2.9] FIX: Use REAL URL from tracker instead of Map Key
        filename: tracker.filename || 'download',
        savePath: tracker.savePath || appSettings.downloadPath,
        receivedBytes: tracker.lastBytes || 0,
        totalBytes: tracker.totalBytes || 0,
        headers: tracker.headers || {},
        strategy: tracker.strategy || 'direct',
        audioOnly: !!tracker.audioOnly, // [v1.7.0] Persist format
        timestamp: tracker.startTime || Date.now()
      }))

    fs.writeFileSync(persistencePath, JSON.stringify({ downloads: downloadsToSave }, null, 2), 'utf-8')
    console.log(`[PERSISTENCE] Saved ${downloadsToSave.length} active downloads`)

    // CLEANUP: Kill all active processes to ensure clean exit
    activeDownloads.forEach((tracker) => {
      // Kill yt-dlp process
      if (tracker.process) {
        try {
          console.log('[CLEANUP] Killing active yt-dlp process')
          // Force kill on Windows
          if (process.platform === 'win32') {
            require('child_process').exec(`taskkill /pid ${tracker.process.pid} /T /F`)
          } else {
            tracker.process.kill('SIGKILL')
          }
        } catch (e) { console.error('[CLEANUP] Error killing process:', e) }
      }

      // Destroy active HTTP requests
      if (tracker.httpRequests) {
        tracker.httpRequests.forEach(req => {
          try { req.destroy() } catch (e) { }
        })
      }
    })

  } catch (error) {
    console.error('[PERSISTENCE] Error saving active downloads:', error)
  }
}

// [v1.4.1] Restore active downloads from saved state
function restoreActiveDownloads() {
  try {
    const persistencePath = join(app.getPath('userData'), 'active-downloads.json')

    if (!fs.existsSync(persistencePath)) {
      console.log('[PERSISTENCE] No saved downloads found')
      return
    }

    const data = JSON.parse(fs.readFileSync(persistencePath, 'utf-8'))

    if (!data.downloads || data.downloads.length === 0) {
      console.log('[PERSISTENCE] No downloads to restore')
      return
    }

    // Get main window for callbacks
    const win = BrowserWindow.getAllWindows()[0]

    console.log(`[PERSISTENCE] Attempting to restore ${data.downloads.length} downloads`)

    data.downloads.forEach((download: any) => {
      const trackerId = getTrackerId(download.url, !!download.audioOnly)
      
      // [v1.2.9] ANTI-DUPLICATE CHECK: Skip if already in memory
      if (activeDownloads.has(trackerId)) {
        console.log(`[PERSISTENCE] Skipping duplicate: ${download.filename}`)
        return
      }

      // Check if partial file exists
      const possibleFilePaths = [
        join(download.savePath, download.filename),
        join(download.savePath, `${download.filename}.part`),
        join(download.savePath, download.filename + '.tmp')
      ]

      let existingFilePath: string | null = null
      let existingFileSize = 0

      for (const filePath of possibleFilePaths) {
        if (fs.existsSync(filePath)) {
          existingFilePath = filePath
          existingFileSize = fs.statSync(filePath).size
          break
        }
      }

      // SMART RECOVERY: Fuzzy search for the file if exact match failed
      // This handles cases where yt-dlp appended format IDs (f137), sanitized chars differently, or added .part
      if (!existingFilePath) {
        try {
          if (fs.existsSync(download.savePath)) {
            const files = fs.readdirSync(download.savePath);

            // Normalization function: Remove accents, keep only alphanum, lowercase
            const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

            // Create a reliable fingerprint from the SAVED filename
            // We take the first 15 alphanum chars - usually safe from suffix/encoding variations at the end
            const rawName = download.filename.replace(/\.[a-z0-9]+$/, '').replace(/\.part$/, '');
            const normalizedTarget = normalize(rawName);
            const fingerprint = normalizedTarget.substring(0, 15); // First 15 chars are usually stable

            // Find best match: file that contains our fingerprint and ends in .part (or is a temp file)
            const candidate = files.find(f => {
              const normF = normalize(f);
              return normF.includes(fingerprint) && (f.endsWith('.part') || f.includes('.tmp') || f.includes('.f137') || f.includes('.f140'));
            });

            if (candidate) {
              console.log(`[PERSISTENCE] Smart Recovery (Fuzzy): Mismatch found. Saved: "${download.filename}" -> Disk: "${candidate}"`);
              existingFilePath = join(download.savePath, candidate);
              existingFileSize = fs.statSync(existingFilePath).size;

              // CRITICAL FIX: Update filename to match the ACTUAL file on disk
              const newFilename = candidate.replace('.part', '');
              if (newFilename.length > 5) { // Safety check
                download.filename = newFilename;
              }
            }
          }
        } catch (e) { console.error('[PERSISTENCE] Fuzzy search failed', e) }
      }

      // RELAXED PERSISTENCE: Restore tracker even if file is missing (might be named differently by yt-dlp or deleted)
      // This ensures the backend knows about the download and can handle the "Resume" request properly (start over or find file)
      if (true) { // Always restore if it was in the active list
        if (!existingFilePath) {
          console.log(`[PERSISTENCE] Partial file missing for: ${download.filename}. Restoring anyway to allow restart.`)
        } else {
          console.log(`[PERSISTENCE] Restoring download PAUSED: ${download.filename} (${existingFileSize}/${download.totalBytes} bytes)`)
        }

        // Helper to detect if it's YouTube (for robust resume)
        const isYouTube = download.url.includes('youtube.com') || download.url.includes('youtu.be');

        // [v1.4.3] Estimate totalBytes if missing but we have progress and file
        const totalBytes = download.totalBytes || 0;
        const savedProgress = download.receivedBytes && download.totalBytes ? Math.round((download.receivedBytes / download.totalBytes) * 100) : 0;

        // Calculate lastProgress
        let lastProgress = 0;
        if (totalBytes > 0) {
          lastProgress = Math.round((existingFileSize / totalBytes) * 100);
        } else if (savedProgress > 0) {
          lastProgress = savedProgress; // Fallback to saved % if bytes missing
        }

        // Manually re-add to activeDownloads in PAUSED state
        const tracker: DownloadTracker = {
          item: null,
          url: download.url,
          startTime: download.timestamp || Date.now(),
          lastBytes: existingFileSize, // Actual bytes on disk (0 if missing)
          lastTime: Date.now(),
          savePath: download.savePath,
          filename: download.filename.replace(/\.f\d+/g, '').replace(/\.f136/g, '').replace(/\.f248/g, ''), // [v1.5.5] Clean format IDs from filename
          headers: download.headers,
          strategy: download.strategy || (isYouTube ? 'yt-dlp' : 'direct'), // Fallback for legacy
          isYouTube: isYouTube,       // CRITICAL for resume logic
          totalBytes: totalBytes,
          paused: true, // Start paused
          cancelled: false,
          lastProgress: lastProgress, // Use actual calculation
          statusMessage: existingFilePath ? (isFfmpegAvailable() ? 'Waiting for resume...' : 'Waiting for resume (Fixed mode - No FFmpeg)') : 'Interrupted (File missing)',
          audioOnly: !!download.audioOnly // [v1.7.0] Restore from JSON
        }

        const trackerId = getTrackerId(download.url, !!download.audioOnly)
        activeDownloads.set(trackerId, tracker)

        // Notify frontend that download exists but is paused
        if (win && !win.isDestroyed()) {
          win.webContents.send('download-started', {
            url: download.url,
            audioOnly: !!download.audioOnly,
            name: download.filename,
            size: formatBytes(download.totalBytes),
            progress: tracker.lastProgress,
            speed: '-',
            status: 'paused', // Explicitly paused
          })
        }
      }
    })

    // Clean up the persistence file after restore
    if (fs.existsSync(persistencePath)) {
      fs.unlinkSync(persistencePath)
    }
    console.log('[PERSISTENCE] Restore complete (Paused)')
  } catch (error) {
    console.error('[PERSISTENCE] Error restoring active downloads:', error)
  }
}


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
let isReallyQuitting = false
app.on('before-quit', (e) => {
  if (isReallyQuitting) return

  // If the app is activated, try to signal offline
  if (appSettings && appSettings.isActivated) {
    e.preventDefault()
    console.log('[Licensing] App quitting, signaling offline before exit...')
    
    // Perform sync save first
    saveActiveDownloads()

    // Perform async offline signal
    getMachineId().then(mid => {
        // Use a date 20 minutes in the past to ensure immediate offline status in Admin
        const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString()
        return updateLicenseOnline(mid, { last_seen: pastDate })
    }).catch(err => {
        console.error('[Licensing] Failed to signal offline:', err)
    }).finally(() => {
        isReallyQuitting = true
        app.quit()
    })
    
    // Safety timeout (5s) to quit anyway if network is slow
    setTimeout(() => {
        if (!isReallyQuitting) {
            console.log('[Licensing] Offline signal timeout, force quitting.')
            isReallyQuitting = true
            app.quit()
        }
    }, 5000)
  } else {
    // If not activated, just save and quit normally
    saveActiveDownloads()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})


// Helper to parse yt-dlp size strings (e.g. "12.3MiB", "500B", "1GB") into bytes
function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr || sizeStr === '...') return 0;
  try {
    const match = sizeStr.match(/([\d\.]+)\s*([a-zA-Z]+)/);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const units: Record<string, number> = {
      'B': 1,
      'K': 1024, 'KB': 1024, 'KIB': 1024,
      'M': 1024 * 1024, 'MB': 1024 * 1024, 'MIB': 1024 * 1024,
      'G': 1024 * 1024 * 1024, 'GB': 1024 * 1024 * 1024, 'GIB': 1024 * 1024 * 1024,
      'T': 1024 * 1024 * 1024 * 1024, 'TB': 1024 * 1024 * 1024 * 1024, 'TIB': 1024 * 1024 * 1024 * 1024
    };

    const multiplier = units[unit] || units[unit[0]] || 1;
    return Math.round(value * multiplier);
  } catch (e) {
    return 0;
  }
}

// Check if ffmpeg is available in the system PATH
function isFfmpegAvailable(): boolean {
  try {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'where ffmpeg' : 'which ffmpeg';
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Helper for byte formatting 
function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * [v1.3.6] IDM-Style Cleanup: Automatically remove old orphaned temp files/folders
 */
async function cleanupOrphanedTempFiles() {
  console.log('[Cleanup] Searching for orphaned .doulget_tmp folders...')
  const downloadPath = appSettings.downloadPath
  if (!downloadPath || !existsSync(downloadPath)) return

  try {
    const items = await fsPromises.readdir(downloadPath, { withFileTypes: true })
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const item of items) {
      if (item.isDirectory() && item.name === '.doulget_tmp') {
        const fullPath = join(downloadPath, item.name)
        const stats = await fsPromises.stat(fullPath)
        
        // If the folder is older than 24h, it might be a remnant of a crashed session
        if (now - stats.mtimeMs > maxAge) {
          console.log(`[Cleanup] Removing old temp folder: ${fullPath}`)
          await fsPromises.rm(fullPath, { recursive: true, force: true })
        }
      }
    }
  } catch (e) {
    console.warn('[Cleanup] Error during automatic cleanup:', e)
  }
}

// Launch cleanup shortly after startup
setTimeout(cleanupOrphanedTempFiles, 10000);

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

