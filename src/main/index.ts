import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'

import { state } from './globals'
import { safeSend, formatTime } from './utils'
import { loadSettings } from './settings'
import { getMachineId } from './machine'
import { updateLicenseOnline, startLicenseHeartbeat } from './licensing'
import {
  ensureFfmpegAvailable,
  ensureNodeAvailable,
  ensureAria2Available,
  autoUpdateYtDlp
} from './binaries'
import { startExtensionServer } from './extension'
import { registerIpcHandlers } from './ipc'
import { saveActiveDownloads, restoreActiveDownloads, getTrackerId } from './downloader'
import { DownloadTracker } from './types'
import { initializeFileLogger } from './logger'

// SIMPLIFIED FIX: Minimal flags to avoid TikTok detection
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

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    return
  }
  console.log('[DEBUG] createWindow() called')

  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false, // Default to false, show on 'ready-to-show'
    title: 'DoulGet',
    autoHideMenuBar: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Sécurité: same-origin policy réactivée. Tout le réseau (extraction TikTok/
      // YouTube, téléchargements) passe par le process principal via IPC (Node, sans
      // CORS), donc le renderer n'a plus besoin de désactiver webSecurity.
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  mainWindow.webContents.on('did-start-loading', () => {
    console.log('[DEBUG] Page started loading...')
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[DEBUG] Main window finished loading successfully')
    // Afficher si not visible (cas où ready-to-show n'a pas tiré)
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('[DEBUG] Showing window on did-finish-load')
      mainWindow.show()
    }
    clearTimeout(forceShowTimeout)
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[DEBUG] LOAD FAILED: ${validatedURL} | Error: ${errorDescription} (${errorCode})`
      )
      mainWindow?.setTitle(`DoulGet - ERROR: ${errorDescription}`)
    }
  )

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[DEBUG] Renderer CRASHED: ${details.reason} (ExitCode: ${details.exitCode})`)
    if (details.reason !== 'killed') {
      console.log('[DEBUG] Attempting reload after crash...')
      mainWindow?.reload()
    }
  })

  mainWindow.on('ready-to-show', () => {
    console.log('[DEBUG] Window ready-to-show event fired')
    clearTimeout(forceShowTimeout)
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  let forceShowTimeout: ReturnType<typeof setTimeout>

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    mainWindow?.loadURL(devUrl)
    mainWindow?.webContents.openDevTools()
    // FIX: Augmenté à 5s et annulé si ready-to-show ou did-finish-load se déclenche
    forceShowTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        console.log('[DEBUG] Force showing window (ready-to-show timeout)')
        mainWindow.show()
      }
    }, 5000)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    console.log('[DEBUG] Detected Prod Mode - Loading File:', htmlPath)
    mainWindow.loadFile(htmlPath)
    forceShowTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        console.log('[DEBUG] Force showing window (prod timeout)')
        mainWindow.show()
      }
    }, 5000)
  }

  // Activer l'extension de capture de téléchargements (style IDM)
  mainWindow.webContents.session.on('will-download', (_event, item, _webContents) => {
    const url = item.getURL()
    const now = Date.now()

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

    state.activeDownloads.set(trackerId, tracker)

    item.on('updated', (_event, updateState) => {
      const isAudio =
        item.getURL().toLowerCase().endsWith('.mp3') || item.getURL().toLowerCase().endsWith('.m4a')
      const trackerId = getTrackerId(item.getURL(), isAudio)
      const trackerRef = state.activeDownloads.get(trackerId)
      if (!trackerRef) return

      const nowTime = Date.now()
      const receivedBytes = item.getReceivedBytes()
      const totalBytes = item.getTotalBytes()

      if (updateState === 'interrupted') {
        safeSend(mainWindow, 'download-progress', {
          filename: item.getFilename(),
          url: item.getURL(),
          progress: totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0,
          receivedBytes,
          totalBytes,
          state: 'interrupted',
          canResume: item.canResume()
        })
      } else if (updateState === 'progressing') {
        if (item.isPaused()) {
          safeSend(mainWindow, 'download-progress', {
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
          const timeDiff = (nowTime - trackerRef.lastTime) / 1000
          const bytesDiff = receivedBytes - trackerRef.lastBytes
          const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0

          const remainingBytes = totalBytes - receivedBytes
          const timeLeft = speed > 0 ? remainingBytes / speed : Infinity
          const timeLeftStr = timeLeft === Infinity ? '--' : formatTime(timeLeft)

          const progress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0

          trackerRef.lastBytes = receivedBytes
          trackerRef.lastTime = nowTime
          trackerRef.lastProgress = Math.round(progress)

          safeSend(mainWindow, 'download-progress', {
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

    item.once('done', (_event, doneState) => {
      const trackerRef = state.activeDownloads.get(url)
      if (trackerRef) {
        trackerRef.savePath = item.getSavePath()
        if (doneState === 'completed') {
          safeSend(mainWindow, 'download-complete', {
            filename: item.getFilename(),
            url: item.getURL(),
            state: 'finished',
            savePath: item.getSavePath()
          })
        } else {
          safeSend(mainWindow, 'download-complete', {
            filename: item.getFilename(),
            url: item.getURL(),
            state: doneState === 'cancelled' ? 'cancelled' : 'error',
            savePath: item.getSavePath()
          })
        }
        const isAudioFile =
          item.getURL().toLowerCase().endsWith('.mp3') ||
          item.getURL().toLowerCase().endsWith('.m4a')
        const trackerId = getTrackerId(item.getURL(), isAudioFile)
        setTimeout(() => state.activeDownloads.delete(trackerId), 60000)
      }
    })
  })
}

app.whenReady().then(async () => {
  initializeFileLogger()
  state.appSettings = loadSettings()

  app.setLoginItemSettings({
    openAtLogin: state.appSettings.autoStart,
    openAsHidden: false
  })

  startExtensionServer()
  createWindow()
  console.log('[DEBUG] createWindow() executed')

  if (mainWindow) {
    registerIpcHandlers(mainWindow)
  }

  getMachineId()
    .then((mid) => startLicenseHeartbeat(mid))
    .catch(() => {})

  setTimeout(async () => {
    console.log('[DEBUG] Starting deferred autoUpdateYtDlp()')
    autoUpdateYtDlp()

    console.log('[PERF] Pre-warming High-Speed binaries caches...')
    const t0 = Date.now()
    await ensureFfmpegAvailable()
    await ensureNodeAvailable()
    await ensureAria2Available()
    console.log(`[PERF] All caches ready in ${Date.now() - t0}ms`)
  }, 5000)

  app.on('activate', function () {
    createWindow()
  })

  setTimeout(() => {
    if (mainWindow) {
      console.log('[PERSISTENCE] Restoring active downloads from previous session')
      restoreActiveDownloads(mainWindow)
    }
  }, 2000)
})

let isReallyQuitting = false
app.on('before-quit', (e) => {
  if (isReallyQuitting) return
  state.isAppQuitting = true

  if (state.appSettings && state.appSettings.isActivated) {
    e.preventDefault()
    console.log('[Licensing] App quitting, signaling offline before exit...')

    saveActiveDownloads()

    getMachineId()
      .then((mid) => {
        const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString()
        return updateLicenseOnline(mid, { last_seen: pastDate })
      })
      .catch((err) => {
        console.error('[Licensing] Failed to signal offline:', err)
      })
      .finally(() => {
        isReallyQuitting = true
        app.quit()
      })

    setTimeout(() => {
      if (!isReallyQuitting) {
        console.log('[Licensing] Offline signal timeout, force quitting.')
        isReallyQuitting = true
        app.quit()
      }
    }, 5000)
  } else {
    saveActiveDownloads()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
