import { app, BrowserWindow, Notification } from 'electron'
import { existsSync, createWriteStream, chmodSync, unlinkSync, unlink } from 'fs'
import * as fs from 'fs'
import { join } from 'path'
import { spawn, execSync } from 'child_process'
import * as https from 'https'
import * as http from 'http'
import { state } from './globals'
import { safeSend } from './utils'

// Fonction pour envoyer des notifications système
export function sendNotification(title: string, body: string, sound: boolean = false) {
  if (!state.appSettings.notifications) return

  // Vérifier si les notifications sont supportées
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: !sound || !state.appSettings.soundNotifications
    })
    notification.show()
  }
}

// UTILITY: Ensure yt-dlp is available (check bundled or user data)
export function ensureYtDlpAvailable(): string | null {
  const userDataPath = app.getPath('userData')
  const platform = process.platform
  const binaryName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'

  const userDataBinary = join(userDataPath, binaryName)
  const tempBinary = userDataBinary + '.tmp'

  // Apply pending update if exists and is valid
  if (existsSync(tempBinary)) {
    try {
      const tempStats = fs.statSync(tempBinary)
      if (tempStats.isFile() && tempStats.size > 1000000) {
        console.log('[yt-dlp] Found pending update on startup. Replacing old binary...')
        if (existsSync(userDataBinary)) {
          fs.unlinkSync(userDataBinary)
        }
        fs.renameSync(tempBinary, userDataBinary)
        console.log('[yt-dlp] Binary replaced with update successfully.')
      } else {
        console.warn(`[yt-dlp] Pending update at ${tempBinary} is invalid/too small. Deleting.`)
        fs.unlinkSync(tempBinary)
      }
    } catch (e: any) {
      console.error('[yt-dlp] Failed to apply pending update on startup:', e.message)
    }
  }

  // Check in user data directory first
  if (existsSync(userDataBinary)) {
    try {
      const stats = fs.statSync(userDataBinary)
      if (stats.isFile() && stats.size > 1000000) {
        return userDataBinary
      } else {
        console.warn(`[yt-dlp] Local binary at ${userDataBinary} is too small (${stats.size} bytes). Deleting.`)
        fs.unlinkSync(userDataBinary)
      }
    } catch (e) {
      console.error('[yt-dlp] Failed to check local binary:', e)
    }
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

// AUTO-UPDATE YT-DLP
// Function to check and update yt-dlp automatically
export async function autoUpdateYtDlp(): Promise<void> {
  try {
    console.log('[yt-dlp] Checking for updates...')

    const userDataPath = app.getPath('userData')

    // Platform-aware binary detection
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
        const file = createWriteStream(dest)
        https
          .get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
              file.close()
              if (existsSync(dest)) unlinkSync(dest)
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
              if (existsSync(dest)) unlinkSync(dest)
              reject(new Error(`Failed to download: ${response.statusCode}`))
              return
            }
            response.pipe(file)
            file.on('finish', () => {
              file.close()
              // Make executable on Unix systems
              if (!isWindows) {
                try {
                  chmodSync(dest, 0o755)
                } catch (e) {
                  console.warn('[yt-dlp] Could not set executable permission:', e)
                }
              }
              resolve()
            })
            file.on('error', (err) => {
              file.close()
              if (existsSync(dest)) unlinkSync(dest)
              reject(err)
            })
          })
          .on('error', (err) => {
            file.close()
            if (existsSync(dest)) unlinkSync(dest)
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

    // [v2.3.7] SAFETY: Don't replace the binary if downloads are actively using yt-dlp
    const hasActiveYtDlpDownloads = Array.from(state.activeDownloads.values()).some(
      (t) => t.process && !t.cancelled && !t.paused
    )
    if (hasActiveYtDlpDownloads) {
      console.warn('[yt-dlp] Active downloads detected. Deferring update to next restart.')
      return
    }

    const tempPath = targetPath + '.tmp'
    console.log('[yt-dlp] Downloading update...')
    await downloadFile(downloadUrl, tempPath)

    // [v2.3.7] SAFE UPDATE: Verify .tmp is valid BEFORE touching the old binary
    if (!existsSync(tempPath)) {
      console.warn('[yt-dlp] Download produced no .tmp file, aborting update.')
      return
    }
    const tmpStats = fs.statSync(tempPath)
    if (!tmpStats.isFile() || tmpStats.size < 1000000) {
      console.warn(`[yt-dlp] Downloaded .tmp is invalid (${tmpStats.size} bytes). Deleting and aborting.`)
      try { unlinkSync(tempPath) } catch (_e) {}
      return
    }

    // Try to replace old binary — use rename-over pattern for atomicity
    if (existsSync(targetPath)) {
      try {
        unlinkSync(targetPath)
      } catch (err: any) {
        if (err.code === 'EPERM' || err.code === 'EBUSY') {
          console.warn('[yt-dlp] Binary is locked, will attempt replacement on next start')
          return
        }
        throw err
      }
    }

    try {
      if (existsSync(tempPath)) {
        fs.renameSync(tempPath, targetPath)
      } else {
        console.warn('[yt-dlp] .tmp file disappeared before rename — race condition avoided.')
        return
      }
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

/**
 * [v1.9.28] Fetch real world time from an online API to prevent local clock fraud.
 */
export async function getOnlineTime(): Promise<Date | null> {
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
export async function ensureFfmpegAvailable(win?: BrowserWindow): Promise<string | null> {
  // Return cached result immediately if already resolved
  if (state.cachedFfmpegPath !== undefined) return state.cachedFfmpegPath

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
    state.cachedFfmpegPath = sysFfmpeg
    return state.cachedFfmpegPath
  }

  // 2. Check/Download in UserData
  let missing = false
  for (const bin of binaries) {
     const targetPath = join(userDataPath, bin.name)
     if (!existsSync(targetPath)) {
        missing = true
        break
     } else {
        try {
          const stats = fs.statSync(targetPath)
          if (!stats.isFile() || stats.size < 1000000) {
            console.warn(`[FFmpeg] Binary ${bin.name} is corrupted or too small. Deleting.`)
            fs.unlinkSync(targetPath)
            missing = true
            break
          }
        } catch (e) {
          missing = true
          break
        }
     }
  }

  if (!missing) {
     state.cachedFfmpegPath = join(userDataPath, binaries[0].name)
     return state.cachedFfmpegPath
  }

  // 3. Download missing binaries
  console.log(`[FFmpeg] Downloading binaries for ${platform}...`)
  try {
    const downloadFile = (url: string, dest: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const httpModule = url.startsWith('https') ? https : http
        const file = createWriteStream(dest)
        httpModule.get(url, (response: any) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            file.close()  // Close unused stream before following redirect
            const redirectUrl = response.headers.location!
            downloadFile(redirectUrl, dest).then(resolve).catch(reject)
            return
          }
          if (response.statusCode !== 200) {
            file.close(); unlink(dest, () => {}); 
            reject(new Error(`HTTP ${response.statusCode}`))
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close()
            if (!isWindows) { try { chmodSync(dest, 0o755) } catch(e){} }
            resolve()
          })
          file.on('error', (err: any) => { file.close(); unlink(dest, () => {}); reject(err) })
        }).on('error', (err: any) => { file.close(); unlink(dest, () => {}); reject(err) })
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
      safeSend(win, 'notification', {
        title: 'Composants Vidéo Prêts',
        body: 'FFmpeg et FFprobe installés pour une qualité maximale.'
      })
    }
    state.cachedFfmpegPath = join(userDataPath, binaries[0].name)
    return state.cachedFfmpegPath

  } catch (error) {
    console.error('[FFmpeg] Auto-download failed:', error)
    if (win) {
       safeSend(win, 'notification', {
        title: 'Erreur Composants',
        body: 'Échec du téléchargement de FFmpeg/FFprobe.'
      })
    }
    state.cachedFfmpegPath = null
    return null
  }
}

// [v1.7.2] High-Speed Engine: Ensure aria2c is available
export async function ensureAria2Available(_win?: BrowserWindow): Promise<string | null> {
  if (state.cachedAria2Path !== undefined) return state.cachedAria2Path

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
    state.cachedAria2Path = sysAria2
    return state.cachedAria2Path
  }

  // 2. Check local
  if (existsSync(targetPath)) {
    try {
      const stats = fs.statSync(targetPath)
      if (stats.isFile() && stats.size > 1000000) {
        state.cachedAria2Path = targetPath
        return state.cachedAria2Path
      } else {
        console.warn(`[aria2c] Binary too small. Deleting.`)
        fs.unlinkSync(targetPath)
      }
    } catch (e) {}
  }

  // 3. Download Logic
  console.log(`[aria2c] Not found. Downloading specialized high-speed engine...`)
  try {
    // We keep fallback exactly as original
    const downloadUrlOriginal = isWindows 
      ? 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
      : process.platform === 'darwin'
      ? 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-osx-darwin.tar.bz2'
      : 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-linux-gnu-64bit-build1.tar.bz2'

    const tempZip = join(userDataPath, 'aria2_temp.zip')
    
    const downloadFile = (url: string, dest: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const httpModule = url.startsWith('https') ? https : http
        httpModule.get(url, (response: any) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            downloadFile(response.headers.location!, dest).then(resolve).catch(reject)
            return
          }
          const file = createWriteStream(dest)
          response.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      })
    }

    await downloadFile(downloadUrlOriginal, tempZip)

    if (isWindows) {
      // Use PowerShell to unzip only the executable
      const psCmd = `powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${userDataPath}' -Force; Get-ChildItem -Path '${userDataPath}' -Filter 'aria2c.exe' -Recurse | Move-Item -Destination '${targetPath}' -Force"`
      execSync(psCmd)
    } else {
      // Use tar for extraction
      execSync(`tar -xf "${tempZip}" -C "${userDataPath}" --strip-components 2 "*/aria2c"`)
    }
    
    if (existsSync(tempZip)) unlinkSync(tempZip)

    if (existsSync(targetPath)) {
      if (!isWindows) chmodSync(targetPath, 0o755)
      console.log('[aria2c] Turbo engine ready at:', targetPath)
      state.cachedAria2Path = targetPath
      return targetPath
    }
    return null
  } catch (err) {
    console.error('[aria2c] Download failed:', err)
    state.cachedAria2Path = null
    return null
  }
}

// Helper to ensure Node.js is available for YouTube "n" challenge solving
export async function ensureNodeAvailable(_win?: BrowserWindow): Promise<string | null> {
  // Return cached result immediately if already resolved
  if (state.cachedNodeDir !== undefined) return state.cachedNodeDir

  const userDataPath = app.getPath('userData')
  const nodeBinary = process.platform === 'win32' ? 'node.exe' : 'node'
  const targetPath = join(userDataPath, nodeBinary)

  try {
    if (existsSync(targetPath)) {
      const stats = fs.statSync(targetPath)
      if (stats.isFile() && stats.size > 1000000) {
        state.cachedNodeDir = targetPath
        return targetPath
      } else {
        console.warn(`[Node.js] Binary too small. Deleting.`)
        fs.unlinkSync(targetPath)
      }
    }
  } catch (e) { }

  if (process.platform === 'darwin') {
    console.log('[Node.js] Not found. Downloading portable Node.js v18 for signature solving...')
    const downloadUrl = 'https://nodejs.org/dist/v18.20.0/node-v18.20.0-darwin-x64.tar.gz'
    const tempTarPath = targetPath + '.tar.gz'

    try {
      const download = async (url: string, dest: string): Promise<any> => {
        return new Promise((resolve, reject) => {
          const file = createWriteStream(dest)
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
            unlink(dest, () => { })
            reject(err)
          })
        })
      }

      await download(downloadUrl, tempTarPath)
      console.log('[Node.js] Downloaded tar.gz (v18), extracting...')

      execSync(`tar -xzf "${tempTarPath}" -C "${userDataPath}" --strip-components 2 "node-v18.20.0-darwin-x64/bin/node"`)
      unlinkSync(tempTarPath)

      if (existsSync(targetPath)) {
        chmodSync(targetPath, 0o755)
        console.log('[Node.js] Portable Node.js v18 installed at:', targetPath)
        state.cachedNodeDir = targetPath
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
          const file = createWriteStream(dest)
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
            unlink(dest, () => { })
            reject(err)
          })
        })
      }

      await download(downloadUrl, targetPath)
      if (existsSync(targetPath)) {
        console.log('[Node.js] Portable Node.js v18 (Windows) installed at:', targetPath)
        state.cachedNodeDir = targetPath
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
      const download = async (url: string, dest: string): Promise<any> => {
        return new Promise((resolve, reject) => {
          const file = createWriteStream(dest)
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
            unlink(dest, () => { })
            reject(err)
          })
        })
      }

      await download(downloadUrl, tempTarPath)
      console.log('[Node.js] Downloaded tar.xz (v18), extracting...')

      execSync(`tar -xJf "${tempTarPath}" -C "${userDataPath}" --strip-components 2 "node-v18.20.0-linux-x64/bin/node"`)
      unlinkSync(tempTarPath)

      if (existsSync(targetPath)) {
        chmodSync(targetPath, 0o755)
        console.log('[Node.js] Portable Node.js v18 (Linux) installed at:', targetPath)
        state.cachedNodeDir = targetPath
        return targetPath
      }
    } catch (error) {
      console.error('[Node.js] Linux download/extraction failed:', error)
    }
  }

  return null
}
