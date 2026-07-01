import { BrowserWindow } from 'electron'
import { createServer } from 'http'
import { URL } from 'url'
import { join } from 'path'
import * as fs from 'fs'
import { state } from './globals'
import { safeSend } from './utils'
import { addToDownloadQueue, getTrackerId } from './downloader'

export const EXTENSION_PORT = 8765

// Serveur HTTP pour recevoir les téléchargements détectés par l'extension
export function startExtensionServer() {
  state.extensionServer = createServer((req, res) => {
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

          const downloadFolder = state.appSettings.downloadPath
          console.log('📁 Dossier de téléchargement:', downloadFolder)

          // Ajouter à la queue
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

          const baseFolder = state.appSettings.downloadPath
          const batchFolder = join(baseFolder, 'Videos', playlistTitle)
          
          if (!fs.existsSync(batchFolder)) {
            try { fs.mkdirSync(batchFolder, { recursive: true }) } catch (e) { }
          }

          console.log(`📦 Batch Download received: ${playlistTitle} (${items.length} items)`)

          // [v1.6.0] Items now arrive with resolved CDN URLs from extension click-and-capture
          safeSend(mainWindow, 'external-batch', {
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
        // 1. Check in Active Downloads
        const trackerId = getTrackerId(downloadUrl, audioOnly)
        let tracker = state.activeDownloads.get(trackerId)

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
        // Check in Recently Completed
        else if (state.recentlyCompletedDownloads.has(trackerId)) {
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
        // Check in Queue
        else {
          const queuedItem = state.downloadQueue.find(item => item.url === downloadUrl && !!item.audioOnly === audioOnly)
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
            safeSend(mainWindow, 'download-pause', data.url, !!data.audioOnly)
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
            safeSend(mainWindow, 'download-resume', data.url, undefined, undefined, !!data.audioOnly)
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
            safeSend(mainWindow, 'download-cancel', data.url, !!data.audioOnly)
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

    // 404 pour les autres routes
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('')
  })

  state.extensionServer.listen(EXTENSION_PORT, 'localhost', () => {
    console.log(`\u2705 Extension server listening on http://localhost:${EXTENSION_PORT}`)
    console.log('\ud83d\udd0d Server is ready to receive downloads from browser extension')
  })

  state.extensionServer.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${EXTENSION_PORT} already in use, extension server may already be running`)
    } else {
      console.error('Extension server error:', error)
    }
  })
}
