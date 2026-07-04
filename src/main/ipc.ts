import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import * as fs from 'fs'
import { join, dirname } from 'path'
import * as https from 'https'
import { createHash } from 'crypto'
import { spawn } from 'child_process'

import { state } from './globals'
import { pluginManager } from './plugins/manager'
import { 
  safeSend,
  isSocialMediaURL,
  sanitizeStringForFilename
} from './utils'
import {
  saveSettings,
  getBaseDownloadDir
} from './settings'
import { 
  getMachineId 
} from './machine'
import { 
  licenseBackendRequest,
  supabaseRequest,
  uploadFileToSignedUrl
} from './licensing'
import { 
  ensureYtDlpAvailable, 
  ensureFfmpegAvailable 
} from './binaries'
import { 
  getTrackerId,
  processDownloadQueue,
  addToDownloadQueue,
  stopDownload,
  fetchVideoInfo,
  downloadWithYtDlp,
  downloadWithMultiThreading,
  handleDownloadEnd
} from './downloader'
import { AppSettings, DownloadTracker } from './types'
import { getMainLogFilePath, openMainLogFolder, readRecentMainLogLines } from './logger'

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  const data = fs.readFileSync(filePath)
  hash.update(data)
  return hash.digest('hex')
}

export function registerIpcHandlers(win: BrowserWindow) {
  const mainWindow = win;
  ipcMain.on('ping', () => console.log('pong'))

  // IPC Handler for custom downloads (from Quality Selector)
  ipcMain.on('start-download-custom', async (event, { url, formatId, filename, audioOnly }) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender)
    if (!mainWindow) return

    if (audioOnly) {
      // Create/Update tracker with audio flag - [v1.7.0] Composite
      const trackerId = getTrackerId(url, true)
      let tracker = state.activeDownloads.get(trackerId)
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
        state.activeDownloads.set(trackerId, tracker)
      } else {
        tracker.audioOnly = true
      }
    }

    // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
    const subFolder = (!!audioOnly) ? 'Audios' : 'Videos'
    const finalPath = join(getBaseDownloadDir(!!audioOnly), subFolder)
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
      const downloadFolder = savePath || getBaseDownloadDir(audioOnly)
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
      safeSend(win, 'download-error', {
        url,
        error: error.message || 'Failed to start download'
      })
    }
  })

  ipcMain.on('download-pause', (event, url: string, audioOnly: boolean = false) => {
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = state.activeDownloads.get(trackerId)
    const win = BrowserWindow.fromWebContents(event.sender)

    // Cas 1 : téléchargement \"classique\" géré par Electron
    if (tracker && tracker.item && !tracker.item.isPaused()) {
      tracker.item.pause()

      // Update count and process queue on pause
      processDownloadQueue()

      // Send the last known progress percentage when pausing
      safeSend(win, 'download-paused', {
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

      safeSend(win, 'download-paused', {
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
      safeSend(win, 'download-paused', {
        url,
        audioOnly,
        progress: tracker.lastProgress !== undefined ? tracker.lastProgress : 0
      })
    }
  })

  ipcMain.on('download-resume', (event, url: string, savePath?: string, filename?: string, audioOnly: boolean = false) => {
    const trackerId = getTrackerId(url, audioOnly)
    console.log(`[IPC] download-resume received for: ${trackerId}`)
    let tracker = state.activeDownloads.get(trackerId)
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

      // [v2.3.7] Resolve the actual subfolder where the file lives (Videos/ or Audios/)
      const subFolder = audioOnly ? 'Audios' : 'Videos'
      const sep = require('path').sep
      const finalSavePath = (savePath.endsWith(subFolder) || savePath.includes(sep + subFolder + sep) || savePath.endsWith(sep + subFolder))
        ? savePath
        : join(savePath, subFolder)
      console.log(`[Resume] Resolved savePath: "${savePath}" → finalSavePath: "${finalSavePath}"`)

      // [v1.9.6] DISK CHECK: Try to find existing progress — search in finalSavePath AND root
      let recoveredBytes = 0
      let recoveredSavePath = finalSavePath // default to subfolder
      if (filename) {
        const tempDir1 = join(finalSavePath, '.doulget_tmp')
        const tempDir2 = join(savePath, '.doulget_tmp')
        const possiblePaths = [
          // Subfolder (correct location)
          join(finalSavePath, filename),
          join(finalSavePath, `${filename}.part`),
          join(tempDir1, filename),
          join(tempDir1, `${filename}.part`),
          join(tempDir1, `${filename}.ytdl`),
          // Root folder (legacy/fallback)
          join(savePath, filename),
          join(savePath, `${filename}.part`),
          join(tempDir2, filename),
          join(tempDir2, `${filename}.part`),
          join(tempDir2, `${filename}.ytdl`)
        ]
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            recoveredBytes = fs.statSync(p).size
            // Use the directory of the found file as the correct savePath
            recoveredSavePath = require('path').dirname(p).replace(/[\\/]\.doulget_tmp$/, '')
            console.log(`[Resume] Found partial file: "${p}" (${recoveredBytes} bytes) → savePath: "${recoveredSavePath}"`)
            break
          }
        }
      }

      tracker = {
        item: null,
        url: url,
        startTime: Date.now(),
        lastBytes: recoveredBytes, // [v1.9.6] Load existing progress
        lastTime: Date.now(),
        savePath: recoveredSavePath, // [v2.3.7] Use actual file location
        isYouTube: url.includes('youtube.com') || url.includes('youtu.be'),
        filename: filename,
        paused: true,
        strategy: strategy,
        audioOnly: audioOnly
      }
      state.activeDownloads.set(trackerId, tracker)
    } else if (tracker) {
      console.log(`[Resume] Found existing tracker for ${trackerId}. Progress: ${tracker.lastProgress || 0}%, Strategy: ${tracker.strategy}`)

      // [v2.3.7] DISK CHECK: Search in tracker.savePath AND its Videos/Audios subfolders
      if ((tracker.lastBytes || 0) === 0 && tracker.filename && tracker.savePath) {
        const subFolder = tracker.audioOnly ? 'Audios' : 'Videos'
        const sep2 = require('path').sep
        const altPath = (tracker.savePath.endsWith(subFolder) || tracker.savePath.includes(sep2 + subFolder + sep2) || tracker.savePath.endsWith(sep2 + subFolder))
          ? tracker.savePath
          : join(tracker.savePath, subFolder)

        const tempDir1 = join(tracker.savePath, '.doulget_tmp')
        const tempDir2 = join(altPath, '.doulget_tmp')
        const possiblePaths = [
          join(tracker.savePath, tracker.filename),
          join(tracker.savePath, `${tracker.filename}.part`),
          join(tempDir1, tracker.filename),
          join(tempDir1, `${tracker.filename}.part`),
          join(tempDir1, `${tracker.filename}.ytdl`),
          // Also check the subfolder variant
          join(altPath, tracker.filename),
          join(altPath, `${tracker.filename}.part`),
          join(tempDir2, tracker.filename),
          join(tempDir2, `${tracker.filename}.part`),
          join(tempDir2, `${tracker.filename}.ytdl`)
        ]
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            tracker.lastBytes = fs.statSync(p).size
            // Correct savePath to point to actual file location
            const correctedPath = require('path').dirname(p).replace(/[\\/]\.doulget_tmp$/, '')
            if (correctedPath !== tracker.savePath) {
              console.log(`[Resume] Correcting savePath: "${tracker.savePath}" → "${correctedPath}"`)
              tracker.savePath = correctedPath
            }
            console.log(`[Resume] Corrected tracker progress from disk: ${tracker.lastBytes} bytes`)
            break
          }
        }
      }
    }

    // [v2.4.0] Manual retry clears the permanent-failure flag so the download
    // can run again and (if it succeeds) be treated normally.
    if (tracker) tracker.failedPermanent = false

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
      safeSend(win, 'download-resumed', { url, audioOnly })
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

      safeSend(win, 'download-progress', {
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

      safeSend(win, 'download-resumed', { url, audioOnly })
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
            safeSend(win, 'download-error', {
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

      safeSend(win, 'download-progress', {
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

      safeSend(win, 'download-resumed', { url, audioOnly })

        // Relancer le téléchargement multi-threaded
        ; (async () => {
          try {
            if (win) {
              await downloadWithMultiThreading(url, tracker.savePath!, win, audioOnly)
            }
          } catch (error: any) {
            safeSend(win, 'download-error', {
              url,
              audioOnly,
              error: error.message || 'Failed to resume download'
            })
          }
        })()
    }
  })

  ipcMain.on('download-cancel', (event, url: string, audioOnly: boolean = false) => {
    const cancelWin = BrowserWindow.fromWebContents(event.sender)
    console.log(`[IPC] download-cancel received: ${url}, audioOnly=${audioOnly}`)
    stopDownload(url, audioOnly, cancelWin || undefined)
  })

  ipcMain.on('download-open-folder', async (_event, url: string, savePath?: string, filename?: string, audioOnly: boolean = false) => {
    // Strategy: Use passed arguments if available (from renderer state), otherwise fallback to tracker
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = state.activeDownloads.get(trackerId)
    const finalSavePath = savePath || tracker?.savePath
    const finalFilename = filename || tracker?.filename

    // [v2.4.1] FIX: toujours ouvrir l'Explorateur avec le fichier SÉLECTIONNÉ, sans jamais
    // lancer le média. savePath est parfois le chemin complet du fichier (pas le dossier),
    // et le nom affiché peut différer du nom réel sur disque (.mp3, suffixe " (1)", etc.).
    const isFile = (p?: string) => { try { return !!p && fs.statSync(p).isFile() } catch { return false } }
    const isDir = (p?: string) => { try { return !!p && fs.statSync(p).isDirectory() } catch { return false } }

    // 1) savePath pointe déjà sur le fichier lui-même
    if (isFile(finalSavePath)) {
      shell.showItemInFolder(finalSavePath!)
      return
    }

    const folder = isDir(finalSavePath) ? finalSavePath : (finalSavePath ? dirname(finalSavePath) : undefined)
    if (folder && isDir(folder)) {
      if (finalFilename) {
        // 2) Meilleur cas: dossier + nom exacts -> sélection directe
        const fullPath = join(folder, finalFilename)
        if (isFile(fullPath)) {
          shell.showItemInFolder(fullPath)
          return
        }
        // 3) Le nom réel peut différer: chercher par nom de base (autre extension/suffixe)
        try {
          const base = finalFilename.replace(/\.[^.]+$/, '').trim().toLowerCase()
          if (base.length > 2) {
            const match = fs.readdirSync(folder).find(
              (f) => f.toLowerCase().startsWith(base) && !/\.(part|ytdl|tmp)$/i.test(f)
            )
            if (match) {
              shell.showItemInFolder(join(folder, match))
              return
            }
          }
        } catch (_e) { /* dossier illisible: on ouvre juste le dossier */ }
      }
      // 4) Dernier recours: ouvrir le dossier (jamais openPath sur un fichier)
      shell.openPath(folder)
      return
    }

    // Aucun chemin exploitable: dossier Téléchargements par défaut
    shell.openPath(app.getPath('downloads'))
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

      // [v2.3.7] Check 3: Look in auto-organized subfolders (Videos/ and Audios/)
      // Files are placed in subfolders by the automatic organization logic
      if (!targetFileObj && filename) {
        for (const subFolder of ['Videos', 'Audios']) {
          const subPath = join(pathOrFolder, subFolder, filename)
          try {
            const stat3 = await fs.promises.stat(subPath)
            if (stat3.isFile()) {
              console.log(`[Delete] Found file in subfolder: "${subPath}"`)
              targetFileObj = subPath
              break
            }
          } catch (e) {
            /* doesn't exist in this subfolder */
          }
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
          `[Delete] File not found. Checked: "${pathOrFolder}", join with "${filename}", and subfolders Videos/Audios`
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
    return state.appSettings
  })

  ipcMain.handle('save-settings', (_event, settings: Partial<AppSettings>) => {
    const saved = saveSettings(settings)
    if (saved) {
      state.appSettings = saved

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
      isActivated: state.appSettings.isActivated,
      expiryDate: state.appSettings.expiryDate,
      machineId: state.appSettings.machineId,
      licenseKey: state.appSettings.licenseKey
    }
  })

  ipcMain.handle('get-machine-id', async () => {
    return await getMachineId()
  })

  ipcMain.handle('activate-license', async (_event, key: string) => {
    const mid = await getMachineId()
    const activation = await licenseBackendRequest('activate-license', { key, machineId: mid })

    if (activation.success && activation.expiry) {
      const updated = saveSettings({
        isActivated: true,
        licenseKey: activation.key || key,
        expiryDate: activation.expiry
      })
      if (updated) state.appSettings = updated
      return { success: true, expiry: activation.expiry }
    } else {
      return { success: false, error: 'Clé invalide ou expirée.' }
    }
  })


  // [v1.9.30] Secure Admin password verification
  ipcMain.handle('verify-admin-password', async (_event, password: string) => {
    const result = await licenseBackendRequest('verify-admin-password', { password })
    return !!result.valid
  })



  // [v1.9.21] Secret Admin: Reset/Deactivate license (for admin use only)
  ipcMain.handle('admin-reset-license', async (_event, password: string) => {
    const auth = await licenseBackendRequest('verify-admin-password', { password })
    if (!auth.valid) {
      return { success: false, error: 'Mot de passe incorrect.' }
    }
    const updated = saveSettings({
      isActivated: false,
      licenseKey: '',
      expiryDate: null
    })
    if (updated) state.appSettings = updated
    console.log('[Licensing] License reset by admin.')
    return { success: true }
  })

  // Secure Admin Logic (Only for the user to generate keys)
  ipcMain.handle('admin-generate-key', async (_event, password, machineId, durationDays) => {
    return await licenseBackendRequest('admin-generate-key', { password, machineId, durationDays })
  })

  // Bulk Generator for admin
  ipcMain.handle('admin-bulk-generate', async (_event, password, count, durationDays) => {
    return await licenseBackendRequest('admin-bulk-generate', { password, count, durationDays })
  })

  // [v1.9.29] Fetch all licenses / machine registrations from cloud for Admin
  ipcMain.handle('admin-get-all-licenses', async (_event, password) => {
    return await licenseBackendRequest('admin-get-all-licenses', { password })
  })

  // [v1.9.32] Remote Block/Unblock for Admin
  ipcMain.handle('admin-update-license-status', async (_event, password, targetMid, isBlocked) => {
    return await licenseBackendRequest('admin-update-license-status', {
      password,
      targetMid,
      isBlocked
    })
  })

  // [v1.9.34] Heartbeat for online status
  ipcMain.handle('ping-license', async () => {
    const isActivated = state.appSettings.isActivated
    if (!isActivated) return { success: false }

    const mid = await getMachineId()
    
    // Check cloud status first
    const cloud = await licenseBackendRequest('ping-license', { machineId: mid })
    
    // If deleted from cloud (NOT_FOUND) or blocked (isBlocked: true)
    if (cloud.status === 'NOT_FOUND' || cloud.status === 'BLOCKED' || cloud.status === 'EXPIRED') {
        console.error(`[Licensing] Client ${mid} ${cloud.status === 'NOT_FOUND' ? 'suppressed' : 'blocked'} from Cloud. Deactivating...`)
        
        // Update local settings to DEACTIVATED
        state.appSettings.isActivated = false
        state.appSettings.licenseKey = ''
        state.appSettings.expiryDate = null
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
                safeSend(win, 'license-deactivated', reason)
            }
        })

        return { success: false, error: 'License deactivated' }
    }

    return { success: !!cloud.success }
  })

  // [v1.9.34] Totally delete a license from cloud
  ipcMain.handle('admin-delete-license-cloud', async (_event, password, targetMid) => {
    return await licenseBackendRequest('admin-delete-license-cloud', { password, targetMid })
  })

  // [v1.9.33] UPDATE SYSTEM: Check for app updates
  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('check-app-update', async () => {
    // We use a shared 'app_config' table or similar for global settings
    const data = await supabaseRequest('app_config?key=eq.latest_version', 'GET');
    const urlData = await supabaseRequest('app_config?key=eq.update_url', 'GET');
    const hashData = await supabaseRequest('app_config?key=eq.update_hash', 'GET');
    
    if (data && Array.isArray(data) && data.length > 0) {
        const latestRaw = data[0].value;
        const currentRaw = app.getVersion();
        const updateUrl = (urlData && Array.isArray(urlData) && urlData.length > 0) ? urlData[0].value : '';
        const updateHash = (hashData && Array.isArray(hashData) && hashData.length > 0) ? hashData[0].value : '';

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
            updateAvailable: isNewer(latest, current) && !!updateUrl && !!updateHash, 
            latestVersion: latestRaw,
            currentVersion: currentRaw,
            downloadUrl: updateUrl,
            updateHash
        };
    }
    return { updateAvailable: false };
  })

  // [v1.6.0] Start downloading the update file to %TEMP%
  ipcMain.handle('start-app-update', async (event, downloadUrl: string, expectedHash?: string) => {
    const tempPath = join(app.getPath('temp'), 'DoulGet_Update.exe');
    
    if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
        const error = 'Hash SHA-256 de mise à jour manquant ou invalide.';
        event.sender.send('update-error', error);
        return { success: false, error };
    }

    try {
        const parsedUrl = new URL(downloadUrl);
        if (parsedUrl.protocol !== 'https:') {
            const error = 'URL de mise à jour non sécurisée (HTTPS requis).';
            event.sender.send('update-error', error);
            return { success: false, error };
        }
    } catch {
        const error = 'URL de mise à jour invalide.';
        event.sender.send('update-error', error);
        return { success: false, error };
    }

    console.log(`[Update] Starting download from: ${downloadUrl}`);
    console.log(`[Update] Target path: ${tempPath}`);

    // [v1.8.5] Use a browser-like User-Agent for GitHub/CDN redirects
    const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const downloadFile = (url: string, redirectCount = 0): Promise<{ success: boolean, error?: string }> => {
        if (redirectCount > 5) {
            return Promise.resolve({ success: false, error: 'Trop de redirections' });
        }

        return new Promise((resolve) => {
            try {
                // Remove old update if exists on first call
                if (redirectCount === 0 && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

                // [v1.8.5] Added User-Agent header (required by GitHub)
                const options = {
                    headers: { 'User-Agent': USER_AGENT }
                };

                const request = https.get(url, options, (response) => {
                    // Handle Redirects (301, 302, 307, 308)
                    if ([301, 302, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
                        console.log(`[Update] Redirecting to: ${response.headers.location}`);
                        resolve(downloadFile(response.headers.location, redirectCount + 1));
                        return;
                    }

                    if (response.statusCode !== 200) {
                        console.error(`[Update] Failed to download: ${response.statusCode}`);
                        event.sender.send('update-error', `Erreur serveur: ${response.statusCode}`);
                        resolve({ success: false, error: `HTTP ${response.statusCode}` });
                        return;
                    }

                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedSize = 0;
                    const file = fs.createWriteStream(tempPath);

                    response.on('data', (chunk) => {
                        downloadedSize += chunk.length;
                        file.write(chunk);
                        
                        if (totalSize > 0) {
                            const progress = Math.round((downloadedSize / totalSize) * 100);
                            event.sender.send('update-progress', progress);
                        }
                    });

                    response.on('end', () => {
                        file.end(() => {
                            try {
                                const actualHash = sha256File(tempPath)
                                if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
                                    try { fs.unlinkSync(tempPath) } catch {}
                                    const error = 'Vérification SHA-256 échouée. Mise à jour refusée.'
                                    console.error(`[Update] Hash mismatch. Expected ${expectedHash}, got ${actualHash}`)
                                    event.sender.send('update-error', error)
                                    resolve({ success: false, error })
                                    return
                                }

                                console.log('[Update] Download complete and SHA-256 verified.')
                                fs.writeFileSync(`${tempPath}.sha256`, expectedHash.toLowerCase(), 'utf8')
                                event.sender.send('update-ready')
                                resolve({ success: true })
                            } catch (verifyError: any) {
                                const error = verifyError.message || 'Erreur de vérification de la mise à jour.'
                                event.sender.send('update-error', error)
                                resolve({ success: false, error })
                            }
                        });
                    });

                    response.on('error', (err) => {
                        file.end();
                        console.error('[Update] Stream error:', err);
                        event.sender.send('update-error', err.message);
                        resolve({ success: false, error: err.message });
                    });
                });

                request.on('error', (err) => {
                    console.error('[Update] Request error:', err);
                    event.sender.send('update-error', err.message);
                    resolve({ success: false, error: err.message });
                });
            } catch (error: any) {
                console.error('[Update] Exception:', error);
                resolve({ success: false, error: error.message });
            }
        });
    };

    return await downloadFile(downloadUrl);
  })

  // [v1.6.0] Execute the downloaded installer and quit
  ipcMain.handle('install-app-update', async () => {
    const tempPath = join(app.getPath('temp'), 'DoulGet_Update.exe');
    const hashPath = `${tempPath}.sha256`;
    
    if (!fs.existsSync(tempPath)) {
        return { success: false, error: 'Fichier installeur introuvable.' };
    }

    if (!fs.existsSync(hashPath)) {
        return { success: false, error: 'Preuve SHA-256 introuvable. Retéléchargez la mise à jour.' };
    }

    const expectedHash = fs.readFileSync(hashPath, 'utf8').trim().toLowerCase();
    const actualHash = sha256File(tempPath).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
        try { fs.unlinkSync(tempPath) } catch {}
        try { fs.unlinkSync(hashPath) } catch {}
        return { success: false, error: 'Vérification SHA-256 échouée. Installation annulée.' };
    }

    console.log('[Update] Launching installer and quitting...');
    
    // [v1.8.2] Use shell.openPath instead of spawn for better Windows permission handling
    shell.openPath(tempPath).then(() => {
        // Short delay to ensure shell process starts before quitting
        setTimeout(() => app.quit(), 500);
    }).catch(err => {
        console.error('[Update] Failed to open installer:', err);
    });

    return { success: true };
  })

  ipcMain.handle('admin-set-latest-version', async (_event, password, newVersion, downloadUrl, extensionVersion, extensionUrl, updateHash, extensionHash) => {
    return await licenseBackendRequest('admin-set-latest-version', {
      password,
      newVersion,
      downloadUrl,
      extensionVersion,
      extensionUrl,
      updateHash,
      extensionHash
    })
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
    return await licenseBackendRequest('admin-get-feedback', { password })
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
    const auth = await licenseBackendRequest('verify-admin-password', { password })
    if (!auth.valid) {
        return { success: false, error: 'Mot de passe admin incorrect.' }
    }

    if (!existsSync(localPath)) {
        return { success: false, error: 'Le fichier local n\'existe pas.' }
    }

    const fileHash = sha256File(localPath);
    const uploadTicket = await licenseBackendRequest('admin-create-update-upload', { password, type });
    if (!uploadTicket.success || !uploadTicket.signedUrl || !uploadTicket.publicUrl) {
        return { success: false, error: uploadTicket.error || 'Impossible de preparer l\'upload signe.' }
    }

    const res = await uploadFileToSignedUrl(localPath, uploadTicket.signedUrl, uploadTicket.publicUrl);

    if (res.success && res.url) {
        await licenseBackendRequest('admin-set-latest-version', {
          password,
          ...(type === 'setup'
            ? { downloadUrl: res.url, updateHash: fileHash }
            : { extensionUrl: res.url, extensionHash: fileHash })
        });
        return { success: true, url: res.url, hash: fileHash };
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
          state.activeDownloads.set(trackerId, tracker)
          await downloadWithYtDlp(url, downloadPath, platform, win, undefined, undefined, false, audioOnly)
        } catch (error: any) {
          safeSend(win, 'download-error', {
            url,
            error: error.message || 'Failed to download'
          })
          handleDownloadEnd(url, audioOnly) // [v2.4.0] Composite key
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
          state.activeDownloads.set(trackerId, tracker)
          await downloadWithMultiThreading(url, downloadPath, win, audioOnly)
        } catch (error: any) {
          safeSend(win, 'download-error', {
            url,
            error: error.message || 'Failed to download'
          })
          handleDownloadEnd(url, audioOnly) // [v2.4.0] Composite key
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
            safeSend(BrowserWindow.getAllWindows()[0], 'conversion-progress', { progress, filename: outputName })
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
            safeSend(BrowserWindow.getAllWindows()[0], 'compression-progress', { progress, filename: outputName })
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

    const baseDownloadPath = getBaseDownloadDir(audioOnly)
    const subFolder = audioOnly ? 'Audios' : 'Videos'

    // [v2.3.7] FIX DOUBLE SUBFOLDER: addToDownloadQueue already appends Videos/ or Audios/.
    // We pass savePath WITHOUT subFolder so it becomes: baseDir/PlaylistTitle
    // addToDownloadQueue then produces: baseDir/Videos/PlaylistTitle  ✅
    let batchSavePath = baseDownloadPath
    if (playlistTitle) {
      const sanitizedTitle = sanitizeStringForFilename(playlistTitle)
      // Pre-create the full target folder
      const fullBatchPath = join(baseDownloadPath, subFolder, sanitizedTitle)
      if (!fs.existsSync(fullBatchPath)) {
        try { fs.mkdirSync(fullBatchPath, { recursive: true }) } catch (e) { }
      }
      batchSavePath = join(baseDownloadPath, sanitizedTitle)
    }

    // Add each item to queue
    items.forEach((item) => {
      addToDownloadQueue(
        item.url,
        win,
        batchSavePath,
        item.title,
        undefined,
        undefined,
        2,
        headers || {},
        audioOnly
      )
    })

    safeSend(win, 'notification', {
      title: 'Batch Downloader',
      body: `${items.length} vidéos ajoutées à la file d'attente.`
    })
  })


  ipcMain.handle('get-download-logs', (_event, url: string, audioOnly: boolean = false) => {
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = state.activeDownloads.get(trackerId)
    return tracker?.logs?.length ? tracker.logs : readRecentMainLogLines(400)
  })

  ipcMain.handle('get-app-log-path', () => getMainLogFilePath())

  ipcMain.handle('read-app-log', (_event, maxLines: number = 1200) => {
    return readRecentMainLogLines(maxLines)
  })

  ipcMain.handle('open-app-log-folder', async () => {
    await openMainLogFolder()
    return true
  })

  // Helper function to resolve the extension source folder
  function getExtensionSourcePath(): string {
    let path = join(app.getAppPath(), 'Extension_DoulGet')
    if (fs.existsSync(path)) return path
    
    path = join(app.getAppPath(), '..', 'app.asar.unpacked', 'Extension_DoulGet')
    if (fs.existsSync(path)) return path
    
    path = join(app.getAppPath(), '..', 'Extension_DoulGet')
    if (fs.existsSync(path)) return path

    return ''
  }

  // [v1.9.9] Get local extension version from manifest.json
  ipcMain.handle('get-extension-version', async () => {
    try {
      const srcPath = getExtensionSourcePath()
      if (srcPath) {
        const manifestPath = join(srcPath, 'manifest.json')
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
          return manifest.version || '1.9.9'
        }
      }
    } catch (e) {
      console.error('Error getting extension version:', e)
    }
    return '1.9.9'
  })

  // [v1.9.9] Register and prepare Chrome Extension files
  ipcMain.handle('register-extension-in-browsers', async () => {
    try {
      const srcPath = getExtensionSourcePath()
      if (!srcPath) {
        return { success: false, error: 'Dossier source de l\'extension introuvable.' }
      }
      
      const destPath = join(app.getPath('appData'), 'doul-get', 'DoulGet_Extension')
      
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true })
      }
      fs.mkdirSync(destPath, { recursive: true })
      fs.cpSync(srcPath, destPath, { recursive: true, force: true })
      
      console.log(`[Extension] Extension files prepared at: ${destPath}`)
      
      try {
        const desktopPath = join(app.getPath('desktop'), 'DoulGet_Extension_Path.txt')
        fs.writeFileSync(desktopPath, destPath, 'utf8')
      } catch (e) {
        console.error('[Extension] Failed to write path to desktop helper file:', e)
      }
      
      try {
        spawn('cmd.exe', ['/c', 'start chrome chrome://extensions/'], { detached: true, stdio: 'ignore' })
      } catch (e) {
        console.error('[Extension] Failed to launch chrome:', e)
      }
      
      return { success: true, extensionPath: destPath }
    } catch (error: any) {
      console.error('[Extension] Error preparing extension:', error)
      return { success: false, error: error.message || 'Error preparing extension files.' }
    }
  })

  // [v1.9.9] Download and install extension update from Supabase URL
  ipcMain.handle('install-extension-update', async (_event, downloadUrl: string, expectedHash?: string) => {
    try {
      if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
        return { success: false, error: 'Hash SHA-256 extension manquant ou invalide.' }
      }

      const parsedUrl = new URL(downloadUrl)
      if (parsedUrl.protocol !== 'https:') {
        return { success: false, error: 'URL extension non sécurisée (HTTPS requis).' }
      }

      console.log('[Extension] Downloading update from:', downloadUrl)
      const tempZipPath = join(app.getPath('temp'), `doulget-extension-${Date.now()}.zip`)
      
      await new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(tempZipPath)
        https.get(downloadUrl, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: status ${response.statusCode}`))
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
        }).on('error', (err) => {
          try { fs.unlinkSync(tempZipPath) } catch (e) {}
          reject(err)
        })
      })

      const actualHash = sha256File(tempZipPath)
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        try { fs.unlinkSync(tempZipPath) } catch (e) {}
        console.error(`[Extension] Hash mismatch. Expected ${expectedHash}, got ${actualHash}`)
        return { success: false, error: 'Vérification SHA-256 extension échouée. Installation refusée.' }
      }
      
      console.log('[Extension] Extracting updated files...')
      const destPath = join(app.getPath('appData'), 'doul-get', 'DoulGet_Extension')
      const AdmZip = require('adm-zip')
      const zip = new AdmZip(tempZipPath)
      zip.extractAllTo(destPath, true)
      
      try { fs.unlinkSync(tempZipPath) } catch (e) {}
      
      console.log('[Extension] Extension update successfully installed at:', destPath)
      return { success: true }
    } catch (error: any) {
      console.error('[Extension] Failed to install update:', error)
      return { success: false, error: error.message || 'Failed to install extension update.' }
    }
  })

}
