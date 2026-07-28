import { app, BrowserWindow } from 'electron'
import { existsSync, promises as fsPromises } from 'fs'
import * as fs from 'fs'
import { join, dirname, basename, sep } from 'path'
import { spawn, execFileSync } from 'child_process'
import { URL } from 'url'

import { state, RECENTLY_COMPLETED_TTL } from './globals'
import { getBaseDownloadDir } from './settings'
import { pluginManager } from './plugins/manager'
import { 
  safeSend, 
  isSocialMediaURL, 
  getUniqueFilename, 
  formatSpeed, 
  formatSize, 
  sanitizeStringForFilename, 
  calculateETA, 
  hideFile, 
  unhideFile, 
  cleanupDebris,
  parseSizeToBytes,
  formatBytes
} from './utils'
import { 
  ensureYtDlpAvailable, 
  ensureFfmpegAvailable, 
  ensureAria2Available, 
  ensureNodeAvailable,
  sendNotification 
} from './binaries'
import { QueuedDownload, DownloadTracker, DownloadRange } from './types'

export function getTrackerId(url: string, audioOnly: boolean): string {
  return `${url}|${audioOnly ? 'audio' : 'video'}`
}

// [Compat] TikTok sert souvent la vidéo en HEVC/H.265 (tag "hvc1"/"bytevc1" dans
// l'URL CDN). VLC la lit, mais pas le lecteur Windows de base ni beaucoup d'apps.
// Après un téléchargement direct, on sonde le codec avec ffprobe et on convertit
// en H.264 (audio copié tel quel) pour une compatibilité universelle.
async function convertHevcToH264IfNeeded(
  filePath: string,
  url: string,
  win: BrowserWindow | null,
  tracker?: DownloadTracker
): Promise<void> {
  const tmpOut = filePath.replace(/\.(mp4|mov|m4v)$/i, '.h264.mp4')
  try {
    if (!/tiktok|hvc1|bytevc1/i.test(url)) return
    if (!/\.(mp4|mov|m4v)$/i.test(filePath) || !fs.existsSync(filePath)) return
    const ffmpegPath = await ensureFfmpegAvailable(win || undefined)
    if (!ffmpegPath) return
    const ffprobePath = join(
      dirname(ffmpegPath),
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    )

    let codec = ''
    if (fs.existsSync(ffprobePath)) {
      try {
        codec = execFileSync(
          ffprobePath,
          ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', filePath],
          { encoding: 'utf8', timeout: 15000 }
        )
          .trim()
          .toLowerCase()
      } catch {
        return
      }
    } else if (/hvc1|bytevc1/i.test(url)) {
      // Pas de ffprobe disponible : on se fie au tag codec de l'URL CDN.
      codec = 'hevc'
    }
    if (codec !== 'hevc' && codec !== 'h265') return

    console.log(`[Compat] HEVC détecté (${codec}) — conversion H.264 de: ${filePath}`)
    if (tracker) {
      tracker.statusMessage = 'Conversion H.264 (compatibilité)...'
      safeSend(win, 'download-progress', {
        url,
        progress: 100,
        state: 'downloading',
        statusMessage: tracker.statusMessage
      })
    }
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        ffmpegPath,
        ['-y', '-i', filePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'copy', '-movflags', '+faststart', tmpOut],
        { windowsHide: true }
      )
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))))
    })
    if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
      fs.rmSync(filePath)
      fs.renameSync(tmpOut, filePath)
      console.log('[Compat] Conversion H.264 terminée, fichier remplacé.')
    } else if (fs.existsSync(tmpOut)) {
      try { fs.rmSync(tmpOut) } catch {}
    }
  } catch (e) {
    // Best effort : en cas d'échec on garde le fichier HEVC d'origine (lisible sur VLC).
    console.error('[Compat] Conversion H.264 échouée, fichier HEVC conservé:', e)
    try {
      if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut)
    } catch {}
  }
}

// [v1.8.6] Smart Series Metadata Extractor (SxxExx)
export function extractSeriesMetadata(texts: string[]): string | null {
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
export async function getFileInfoWithRedirects(url: string, headers: any, tracker: any): Promise<{ size: number, supportsRange: boolean, filename: string, mimeType: string, finalUrl: string }> {
  const https = require('https')
  const http = require('http')
  const urlObj = new URL(url)
  const isHttps = url.startsWith('https')
  const protocol = isHttps ? https : http

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'HEAD',
    headers: {
      'User-Agent': tracker?.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers
    }
  }

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, async (res: any) => {
      // 1. Handle Redirects (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let newUrl = res.headers.location
        if (newUrl.startsWith('/')) {
          newUrl = new URL(newUrl, url).toString()
        }
        console.log(`[HEAD] Following redirect (${res.statusCode}) to: ${newUrl}`)
        return resolve(getFileInfoWithRedirects(newUrl, headers, tracker))
      }

      // 2. Fallback to GET if HEAD is not allowed, returns HTML, or doesn't advertise Range support on a download link
      const isHtml = res.headers['content-type']?.includes('text/html')
      const acceptsRanges = (res.headers['accept-ranges']?.toLowerCase() === 'bytes')
      const isPotentialDownloadLink = url.toLowerCase().includes('download') || 
                                      url.toLowerCase().includes('file') || 
                                      url.includes('?') || 
                                      res.headers['content-disposition'] ||
                                      parseInt(res.headers['content-length'] || '0') > 10 * 1024 * 1024 // > 10MB
      
      const shouldFallback = res.statusCode === 405 || res.statusCode === 403 || res.statusCode === 501 || 
                             (res.statusCode === 200 && isHtml && isPotentialDownloadLink) ||
                             (res.statusCode === 200 && !acceptsRanges && isPotentialDownloadLink)

      if (shouldFallback) {
        const reason = isHtml ? 'Received HTML' : (!acceptsRanges && res.statusCode === 200 ? 'Range support not advertised' : `Status ${res.statusCode}`)
        console.log(`[HEAD] ${reason}, falling back to partial GET to verify capabilities...`)
        try {
          const getResult = await new Promise<any>((getResolve, getReject) => {
            const getOptions = { ...options, method: 'GET', headers: { ...options.headers, 'Range': 'bytes=0-1024' } }
            const getReq = protocol.request(getOptions, (getRes: any) => {
              if (getRes.statusCode >= 300 && getRes.statusCode < 400 && getRes.headers.location) {
                getReq.destroy()
                getResolve({ isRedirect: true, location: getRes.headers.location })
                return
              }
              getRes.on('data', () => { }) 
              getRes.on('end', () => getResolve(getRes))
            })
            getReq.on('error', getReject)
            getReq.end()
          })

          if (getResult.isRedirect) {
            let newUrl = getResult.location
            if (newUrl.startsWith('/')) newUrl = new URL(newUrl, url).toString()
            return resolve(getFileInfoWithRedirects(newUrl, headers, tracker))
          }

          return resolve(processFileInfoResponse(getResult, url, tracker))
        } catch (e) {
          console.error('[HEAD] GET fallback failed:', e)
        }
      }

      resolve(processFileInfoResponse(res, url, tracker))
    })

    req.on('error', (err) => {
      console.error(`[HEAD] Request error for ${url}:`, err.message)
      reject(err)
    })
    req.setTimeout(10000, () => { 
      req.destroy(); 
      reject(new Error(`Timeout (${url})`)) 
    })
    req.end()
  })
}

/**
 * [v1.9.40] EXTRACTED: Unified response processing for HEAD and partial GET fallback.
 */
function processFileInfoResponse(res: any, url: string, tracker: any): { size: number, supportsRange: boolean, filename: string, mimeType: string, finalUrl: string } {
  let contentLength = parseInt(res.headers['content-length'] || '0', 10)
  const contentRange = res.headers['content-range'] || ''
  
  // [v1.9.41] Fix: If this is a 206 Partial Content, extract TOTAL size from Content-Range (e.g. "bytes 0-1024/7284339328")
  if (contentRange && contentRange.includes('/')) {
    const totalSizeMatch = contentRange.split('/')[1]
    if (totalSizeMatch) {
      const totalSize = parseInt(totalSizeMatch, 10)
      if (!isNaN(totalSize) && totalSize > 0) {
        contentLength = totalSize
        console.log(`[INFO] Extracted total size from Content-Range: ${contentLength} bytes`)
      }
    }
  }

  // [v1.9.40] Robust Range detection: Accept-Ranges header OR Content-Range presence (for 206 responses)
  const acceptsRanges = (res.headers['accept-ranges']?.toLowerCase() === 'bytes') || contentRange.startsWith('bytes')
  
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
    
    if ((!filename || filename === 'download' || isGenericFilename) && !contentDisposition) {
      const urlObj = new URL(url)
      const urlFilename = urlObj.pathname.split('/').pop()
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
    const currentExt = sanitizedFilename.split('.').pop()?.toLowerCase();
    if ((currentExt === 'mp4' || currentExt === 'mp3') && expectedExt !== '.' + currentExt && cleanMime !== 'application/octet-stream') {
       sanitizedFilename = sanitizedFilename.substring(0, sanitizedFilename.lastIndexOf('.')) + expectedExt;
    }
  }

  if (process.platform === 'win32') {
    sanitizedFilename = sanitizedFilename.replace(/[<>:"/\\|?*]/g, '_').replace(/[\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '')
  }

  console.log(`[INFO] Resolved info for ${url.substring(0, 50)}... -> Size: ${contentLength}, Multi-threaded: ${acceptsRanges}, Filename: ${sanitizedFilename}`)

  return { 
    size: res.statusCode === 206 && contentRange ? parseInt(contentRange.split('/').pop() || '0', 10) : contentLength, 
    supportsRange: acceptsRanges, 
    filename: sanitizedFilename || 'download', 
    mimeType: mimeType, 
    finalUrl: url 
  }
}

// [v1.6.5] Helper: Single Stream Download with Redirects
export function downloadSingleStreamWithRedirects(url: string, filePath: string, headers: any, tracker: any, win: BrowserWindow, resolvePromise: Function, rejectPromise: Function) {
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
          safeSend(win, 'download-progress', {
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
      // [v2.4.0] Pass audioOnly so the composite tracker key resolves (was a silent no-op).
      try { handleDownloadEnd(tracker?.originalUrl || url, tracker?.audioOnly) } catch (e) { }
      if (tracker) tracker.status = 'completed'
      safeSend(win, 'download-complete', {
        url: tracker?.originalUrl || url,
        filePath,
        // [v2.4.1] dossier + nom réel + audioOnly pour que "Ouvrir" sélectionne le fichier
        savePath: dirname(filePath),
        filename: basename(filePath),
        audioOnly: !!tracker?.audioOnly,
        state: 'finished'
      })
      resolvePromise()
    })

    res.on('error', (err: any) => {
      fileStream.close()
      fs.unlink(filePath, () => { })
      safeSend(win, 'download-error', { url, error: err.message })
      rejectPromise(err)
    })
  })
  req.on('error', (err) => {
    safeSend(win, 'download-error', { url, error: err.message })
    rejectPromise(err)
  })
  req.end()
}

// Fonction de téléchargement multi-thread (Style IDM)
// pour fichiers directs
export async function downloadWithMultiThreading(url: string, savePath: string, win: BrowserWindow, audioOnly: boolean = false) {
  let fileInfo: any = null;
  try {
    const https = require('https')
    const http = require('http')
    const urlObj = new URL(url)
    const protocol = urlObj.protocol === 'https:' ? https : http
    // Get tracker early to check for resume state
    const trackerId = getTrackerId(url, audioOnly)
    const tracker = state.activeDownloads.get(trackerId)
    
    // [v1.7.3] Dynamic thread count based on URL sensitivity
    // [v2.3.3] Use saved thread count if resuming to keep segments aligned
    let numThreads = (tracker && tracker.numThreads) ? tracker.numThreads : 32 
    
    const hasSignature = /[?&](sign|token|expires?|t)=/i.test(url)
    const isSensitiveDomain = url.includes('hakunaymatata.com') || 
                               url.includes('moovbob.fr') || 
                               url.includes('sibnet.ru') || 
                               url.includes('filecr.com') || 
                               url.includes('s2-download.xyz')
    
    if (!tracker?.numThreads && (hasSignature || isSensitiveDomain)) {
      numThreads = 8 // Reduce to 8 threads for signed or sensitive URLs to avoid ECONNRESET
      console.log(`[MultiThread] Sensitive URL detected, reducing threads to ${numThreads}`)
    }

    // [v1.7.2] PERFORMANCE: Persistent keep-alive agents to avoid TCP+TLS handshake per segment
    const agentOptions = { keepAlive: true, maxSockets: 64, maxFreeSockets: 32, timeout: 30000 }
    const keepAliveAgent = urlObj.protocol === 'https:'
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions)

    const requestHeaders = tracker?.headers || {}

    // [v2.3.3] SAFETY GUARD: If size is 0, we can't do multi-threading safely.
    // Try to re-resolve size once.
    if (tracker && (!tracker.totalBytes || tracker.totalBytes <= 0)) {
       console.warn('[MultiThread] Tracker size is 0. Attempting re-resolution...')
       const refreshedInfo = await getFileInfoWithRedirects(url, requestHeaders, tracker)
       if (refreshedInfo.size > 0) {
         tracker.totalBytes = refreshedInfo.size
       }
    }

    // Étape 1: Obtenir la taille du fichier et vérifier le support Range
    // [v1.9.42] GLOBAL RETRY for File Info (handle DNS/Connection drops)
    // [v2.3.6] Increased to 5 retries for better resilience
    let infoRetries = 0;
    while (infoRetries < 5) {
      try {
        fileInfo = await getFileInfoWithRedirects(url, requestHeaders, tracker);
        break;
      } catch (e: any) {
        infoRetries++;
        if (infoRetries >= 5) throw e;
        console.log(`[MultiThread] Info resolution failed (attempt ${infoRetries}/5): ${e.message}. Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // Check content type to avoid downloading HTML pages
    if (fileInfo.mimeType && (fileInfo.mimeType.includes('text/html') || fileInfo.mimeType.includes('application/json'))) {
      console.warn('[MultiThread] Detected invalid content type:', fileInfo.mimeType)
      const isFileCRLink = url.includes('filecr.com') || fileInfo.finalUrl?.includes('s2-download.xyz')
      const isSoftonic = url.includes('softonic.com') || fileInfo.finalUrl?.includes('softonic.com')
      
      // [v1.9.41] Softonic Fix: If we have a valid size and supportsRange, ignore the text/html warning
      if (fileInfo.size > 0 && fileInfo.supportsRange) {
        console.log('[MultiThread] Valid size/range detected despite HTML mime. Proceeding (Softonic-style fix).')
      } else if (isFileCRLink || isSensitiveDomain || url.includes('iframe') || url.includes('sibnet') || isSoftonic) {
        console.log('[MultiThread] HTML/JSON on sensitive or download domain. This might be a "Wait Page" or "Intermediary Page".')
        console.log('[MultiThread] Attempting yt-dlp fallback as last resort...')
        throw new Error('FALLBACK_TO_YTDLP_WAIT_PAGE') 
      } else {
        throw new Error(`Invalid content type: ${fileInfo.mimeType}. This is a web page, not a direct file. Please ensure you clicked the actual download link.`)
      }
    }

    // [v1.3.6] Local temp directory on the SAME disk
    const tempDir = join(savePath, '.doulget_tmp');
    if (!fs.existsSync(tempDir)) {
      try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) { }
    }

    // [v1.2.9] RESUME LOGIC: If a filename is already associated with this download, use it.
    // [v1.9.41] AUTO-RESUME FIX: Check .doulget_tmp even if tracker is missing/new
    // [v1.9.42] FILENAME PERSISTENCE: Always prefer fileInfo.filename if it's "better" than domain-based name
    let baseFilename = tracker?.filename || fileInfo.filename || 'download.mp4'
    if (baseFilename === 'Generic' || baseFilename.includes('s2-download.xyz') || baseFilename === 's2-download.xyz') {
       baseFilename = fileInfo.filename || 'download.mp4'
    }
    // [FIX] tracker.filename vient du titre de page de l'extension et peut contenir
    // des caractères interdits sur Windows (ex: "|" dans les titres TikTok), ce qui
    // faisait échouer la création du .part avec ENOENT. fileInfo.filename est déjà
    // nettoyé, mais pas le nom fourni par le tracker.
    baseFilename = sanitizeStringForFilename(baseFilename) || 'download.mp4'

    const partPath = join(tempDir, baseFilename + '.part')
    // [v2.3.6] Improved Resume Detection: Also check for .ytdl or .mp4.part in tempDir
    const isResuming = !!(tracker?.filename && (
      fs.existsSync(join(savePath, tracker.filename + '.part')) || 
      fs.existsSync(join(savePath, tracker.filename))
    )) || 
    fs.existsSync(partPath) || 
    fs.existsSync(join(tempDir, baseFilename + '.ytdl')) ||
    fs.existsSync(join(tempDir, baseFilename + '.mp4.part'))

    const uniqueFilename = getUniqueFilename(savePath, baseFilename, isResuming)

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
                const tracker = state.activeDownloads.get(trackerIdInner)
                if (tracker && !tracker.paused && !tracker.cancelled) {
                const progress = totalSize > 0 ? (downloaded / totalSize) * 100 : 0
                const speed = (downloaded - tracker.lastBytes) / ((Date.now() - tracker.lastTime) / 1000)
                tracker.lastProgress = Math.round(progress)
                tracker.lastBytes = downloaded
                tracker.lastTime = Date.now()
                safeSend(win, 'download-progress', {
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
              const tracker = state.activeDownloads.get(trackerIdInner)
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
          const tracker = state.activeDownloads.get(trackerIdInner)
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
              safeSend(win, 'download-progress', {
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
          safeSend(win, 'download-complete', { url, filePath })
        })

        fileStream.on('error', (err: any) => {
          fs.unlink(filePath, () => { })
          safeSend(win, 'download-error', { url, error: err.message })
        })
      })

      req.on('error', (err: any) => {
        safeSend(win, 'download-error', { url, error: err.message })
      })
      req.end()
      return
    } */

    // Étape 2: Diviser le fichier en segments et télécharger en parallèle
    // [v1.2.9] AUTO-DYNAMIC CONNECTIONS ⚡
    // If file is large enough, perform a quick speed test to decide if we use multi-threading
    // [v2.4.1] Test allégé (256KB, 3s max) et sauté pour les domaines de confiance et les
    // reprises: il coûtait jusqu'à 5s avant chaque téléchargement, parfois pour rien.
    const isTrustedHighSpeed =
      url.includes('s2-download.xyz') ||
      url.includes('filecr.com') ||
      url.includes('microsoft.com') ||
      url.includes('virtualbox.org') ||
      url.includes('github.com') ||
      url.includes('google.com')
    const isResumingWithRanges = !!(tracker?.ranges && tracker.ranges.length > 0)
    if (fileInfo.size > 1024 * 1024 && !isTrustedHighSpeed && !isResumingWithRanges) {
      console.log('[MultiThread] Testing connection speed...')
      const testStart = Date.now()
      const testResult = await new Promise<{ speed: number }>((resolve) => {
        let testDownloaded = 0
        const testUrl = new URL(fileInfo.finalUrl || url)
        const testOptions = {
          hostname: testUrl.hostname,
          port: testUrl.port || (testUrl.protocol === 'https:' ? 443 : 80),
          path: testUrl.pathname + testUrl.search,
          method: 'GET',
          headers: {
            Range: 'bytes=0-262143', // [v2.4.1] 256KB suffisent pour la mesure
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
        testReq.setTimeout(3000, () => { testReq.destroy(); resolve({ speed: 0 }) }) // [v2.4.1] 5s -> 3s
        testReq.end()
      })

      // [v2.3.6] Lowered threshold from 150KB/s to 20KB/s to favor multi-threading on stable slow lines
      if (testResult.speed < 20 * 1024) {
        numThreads = 1
        console.log(`[MultiThread] Extremely slow connection detected (${Math.round(testResult.speed / 1024)} KB/s), forced to 1 connection.`)
      } else {
        console.log(`[MultiThread] Healthy connection detected (${Math.round(testResult.speed / 1024)} KB/s), using ${numThreads} connections.`)
      }
    } else if (isTrustedHighSpeed) {
      console.log(`[MultiThread] Trusted high-speed domain (${new URL(url).hostname}), skipping speed test.`)
    }

    // [v2.4.1] Dimensionner les segments à la taille du fichier (~1 connexion par 2 Mo):
    // un petit fichier était découpé en 32 tranches minuscules, dominées par la latence réseau.
    if (!tracker?.numThreads && fileInfo.size > 0) {
      numThreads = Math.max(1, Math.min(numThreads, Math.ceil(fileInfo.size / (2 * 1024 * 1024))))
    }

    // [v1.2.9] IDM Optimization: Use local temp directory (already initialized above)

    const finalPath = join(savePath, uniqueFilename)
    const tempFilePath = join(tempDir, uniqueFilename + '.part')
    const existingTempSize = fs.existsSync(tempFilePath) ? fs.statSync(tempFilePath).size : 0

    // [v2.3.4] Support for Dynamic Range Splitting (Work Stealing)
    // Initialize ranges if missing (new download or resume from 2.3.3)
    if (tracker && (!tracker.ranges || tracker.ranges.length === 0)) {
       const initialThreads = tracker.numThreads || numThreads;
       const segmentSize = Math.ceil(fileInfo.size / initialThreads);
       tracker.ranges = Array.from({ length: initialThreads }, (_, i) => ({
         start: i * segmentSize,
         end: i === initialThreads - 1 ? fileInfo.size - 1 : (i + 1) * segmentSize - 1,
         downloaded: Math.max(
           (tracker.segmentDownloaded && tracker.segmentDownloaded[i]) || 0,
           Math.min(Math.max(existingTempSize - i * segmentSize, 0), segmentSize)
         ),
         active: false
       }));
    }

    // [v1.7.2] PERFORMANCE: Pre-allocate file to allow parallel offset writing
    if (!fs.existsSync(tempFilePath)) {
      fs.writeFileSync(tempFilePath, '')
    }

    // Initialize segment progress tracking
    if (tracker) {
      tracker.numThreads = numThreads // Initial target
      tracker.statusMessage = 'Downloading (Adaptive Mode)...'
      if (existingTempSize > 0) {
        tracker.lastBytes = Math.max(tracker.lastBytes || 0, existingTempSize)
        tracker.lastProgress = Math.min(Math.round((existingTempSize / fileInfo.size) * 100), 100)
      }
    }

    // [v1.9.41] Request Tracking to prevent leaks and unhandled rejections
    let isAborted = false;
    const activeRequests = new Set<any>()
    const abortAllRequests = () => {
      isAborted = true;
      activeRequests.forEach(r => { try { r.destroy(); } catch(e) {} });
      activeRequests.clear();
    }

    // [v2.3.4] DYNAMIC WORKER SYSTEM
    const MAX_WORKERS = 32;
    // [v2.4.1] Les domaines sensibles restent plafonnés même quand le scaler monte en charge
    const maxWorkersForUrl = (hasSignature || isSensitiveDomain) ? 8 : MAX_WORKERS;
    let activeWorkers = 0;
    const trackerIdFinal = getTrackerId(url, audioOnly);
    // [v2.4.1] Échantillon de vitesse agrégé (tous workers confondus) entre deux envois de progression
    let speedSampleBytes = tracker?.ranges ? tracker.ranges.reduce((acc, r) => acc + r.downloaded, 0) : 0;
    let speedSampleTime = Date.now();

    const downloadRange = async (rangeIndex: number, retryIdx: number = 0): Promise<void> => {
      const range = tracker!.ranges![rangeIndex];
      if (isAborted || range.start + range.downloaded > range.end) return;

      let isSettled = false;
      return new Promise<void>((resolve, reject) => {
        const retryDelay = Math.min(2000 * Math.pow(1.5, retryIdx), 10000);
        const segmentUrl = new URL(fileInfo.finalUrl || url);
        
        const options = {
          hostname: segmentUrl.hostname,
          port: segmentUrl.port || (segmentUrl.protocol === 'https:' ? 443 : 80),
          path: segmentUrl.pathname + segmentUrl.search,
          method: 'GET',
          agent: keepAliveAgent,
          headers: {
            Range: `bytes=${range.start + range.downloaded}-${range.end}`,
            'User-Agent': tracker?.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...requestHeaders
          },
          timeout: 60000
        };

        const fileStream = fs.createWriteStream(tempFilePath, { 
          flags: 'r+', 
          start: range.start + range.downloaded,
          highWaterMark: 1024 * 1024
        });

        const req = protocol.request(options, (res: any) => {
          if (res.statusCode !== 206 && !(res.statusCode === 200 && range.start === 0 && range.downloaded === 0)) {
            if (isSettled || isAborted) return;
            isSettled = true;
            req.destroy();
            fileStream.destroy();
            if (!isAborted) reject(new Error(`Server mismatch (HTTP ${res.statusCode} instead of 206)`));
            else resolve();
            return;
          }

          res.on('data', (chunk: Buffer) => {
            const trackerUpdate = state.activeDownloads.get(trackerIdFinal);
            if (!trackerUpdate || isSettled || isAborted || trackerUpdate.paused || trackerUpdate.cancelled) {
              isSettled = true;
              req.destroy();
              if (!fileStream.destroyed) fileStream.destroy();
              resolve();
              return;
            }

            if (!fileStream.destroyed) {
              try { fileStream.write(chunk); } catch (e) { 
                req.destroy(); 
                if (!fileStream.destroyed) fileStream.destroy();
                isSettled = true; reject(e); return;
              }
            }
            
            range.downloaded += chunk.length;
            trackerUpdate!.lastBytes += chunk.length;

            if (!trackerUpdate!.lastProgressSent || (Date.now() - trackerUpdate!.lastProgressSent) >= 150) {
              trackerUpdate!.lastProgressSent = Date.now();
              
              // [v2.3.4] Recalculate global progress from all ranges
              const sumDownloaded = trackerUpdate!.ranges ? trackerUpdate!.ranges.reduce((acc, r) => acc + r.downloaded, 0) : trackerUpdate!.lastBytes;
              trackerUpdate!.lastProgress = Math.min(Math.round((sumDownloaded / fileInfo.size) * 100), 100);
              
              const now = Date.now();
              // [v2.4.1] FIX: vitesse = delta d'octets agrégés depuis le dernier envoi.
              // L'ancien calcul (un seul chunk / intervalle) sous-estimait massivement
              // le débit réel en multi-connexions et faussait l'ETA.
              const elapsed = Math.max((now - speedSampleTime) / 1000, 0.05);
              const speed = Math.max(sumDownloaded - speedSampleBytes, 0) / elapsed;
              speedSampleBytes = sumDownloaded;
              speedSampleTime = now;
              trackerUpdate!.lastTime = now;
              trackerUpdate!.lastSpeed = speed; // [v2.3.4] Store for scaler

              safeSend(win, 'download-progress', {
                filename: fileInfo.filename,
                url: url,
                progress: trackerUpdate!.lastProgress,
                receivedBytes: sumDownloaded,
                totalBytes: fileInfo.size,
                state: 'downloading',
                speed: speed,
                timeLeft: calculateETA(fileInfo.size - sumDownloaded, speed),
                originalUrl: url,
                canResume: true,
                savePath: trackerUpdate!.savePath,
                numThreads: trackerUpdate!.ranges?.length || numThreads,
                statusMessage: trackerUpdate!.statusMessage
              });
            }
          });

          res.on('end', () => {
            fileStream.end(() => { isSettled = true; resolve(); });
          });

          res.on('error', (err: any) => {
            if (isAborted) return;
            req.destroy(); fileStream.destroy();
            if (isSettled) return;
            if (retryIdx < 10) resolve(downloadRange(rangeIndex, retryIdx + 1));
            else { isSettled = true; reject(err); }
          });
        });

        activeRequests.add(req);
        req.on('error', (err: any) => {
          activeRequests.delete(req);
          if (isSettled || isAborted) return;
          fileStream.destroy();
          if (retryIdx < 10) setTimeout(() => resolve(downloadRange(rangeIndex, retryIdx + 1)), retryDelay);
          else { isSettled = true; reject(err); }
        });
        
        req.on('timeout', () => {
          if (isSettled || isAborted) return;
          req.destroy();
          fileStream.destroy();
          if (retryIdx < 10) setTimeout(() => resolve(downloadRange(rangeIndex, retryIdx + 1)), retryDelay);
          else { isSettled = true; reject(new Error(`Timeout range ${rangeIndex}`)); }
        });
        req.end();
      });
    };

    const runWorker = async (startIdx?: number) => {
      if (isAborted) return;
      activeWorkers++;
      try {
        while (!isAborted && tracker && !tracker.paused && !tracker.cancelled) {
          // 1. Check for specific range or any inactive range
          let idx = startIdx !== undefined ? startIdx : tracker.ranges!.findIndex(r => !r.active && r.start + r.downloaded <= r.end);
          startIdx = undefined; // Reuse only once

          // 2. [v2.3.4] WORK STEALING: If no free ranges, split the largest active one
          if (idx === -1) {
             const candidates = tracker.ranges!
               .map((r, i) => ({ r, i, rem: (r.end - (r.start + r.downloaded) + 1) }))
               .filter(c => c.rem > 15 * 1024 * 1024) // Only split if > 15MB left
               .sort((a, b) => b.rem - a.rem);
             
             if (candidates.length > 0) {
                const target = candidates[0].r;
                const mid = target.start + target.downloaded + Math.floor(candidates[0].rem / 2);
                const newRange: DownloadRange = { 
                  start: mid, 
                  end: target.end, 
                  downloaded: 0, 
                  active: false 
                };
                target.end = mid - 1;
                tracker.ranges!.push(newRange);
                idx = tracker.ranges!.length - 1;
                console.log(`[IDM-Mode] Split range ${candidates[0].i}. New child starting at ${mid}`);
             }
          }

          if (idx === -1) break; // Truly no work left
          
          const range = tracker.ranges![idx];
          range.active = true;
          try {
            await downloadRange(idx);
          } catch (e: any) {
            console.error(`[Worker] Error on range ${idx}:`, e.message);
            // Allow loop to find another range or retry this one later
          } finally {
            range.active = false;
          }
        }
      } finally {
        activeWorkers--;
      }
    };

    // [v2.4.1] FIX VITESSE: le scaler était créé APRÈS l'attente des workers, donc il ne
    // tournait qu'une fois le téléchargement déjà fini (la montée 1→32 connexions n'était
    // jamais appliquée) et son interval n'était jamais nettoyé en cas de succès (fuite timer).
    const workerPromises: Promise<void>[] = [];
    const spawnWorker = (startIdx?: number) => { workerPromises.push(runWorker(startIdx)); };

    // Scaler loop to add connections if speed allows (e.g. from 1 to 32)
    const scalingInterval = setInterval(() => {
      if (isAborted || !tracker || tracker.paused || tracker.cancelled) return;
      if (activeWorkers < maxWorkersForUrl) {
        // [v2.3.6] IDM-Style Adaptive Scaling:
        // Spawn more if speed > 200KB/s OR if we have less than 16 connections active
        const avgSpeed = tracker?.lastSpeed || 0;
        if (avgSpeed > 200 * 1024 || activeWorkers < Math.min(16, maxWorkersForUrl)) {
          spawnWorker();
        }
      }
    }, 10000);

    try {
      // Start initial pool of workers
      const initialPool = Math.min(numThreads, maxWorkersForUrl);
      for (let i = 0; i < initialPool; i++) {
        spawnWorker(i < tracker!.ranges!.length ? i : undefined);
      }
      // Attendre TOUS les workers, y compris ceux ajoutés par le scaler en cours de route
      let settled = 0;
      while (settled < workerPromises.length) {
        const pending = workerPromises.slice(settled);
        settled += pending.length;
        await Promise.all(pending);
      }
    } catch (err) {
      abortAllRequests();
      throw err;
    } finally {
      clearInterval(scalingInterval);
    }

    // [v2.3.1] Robust tracker retrieval with composite ID
    const trackerFinal = state.activeDownloads.get(trackerId)
    if (trackerFinal?.cancelled) {
      safeSend(win, 'download-cancelled', { url })
      handleDownloadEnd(url, !!audioOnly) // [v2.4.0] Composite key
      return
    }
    if (trackerFinal?.paused) return

    // Inform user that we are finalizing
    if (trackerFinal) {
      trackerFinal.statusMessage = 'Finalizing: Zero-copy output ready.'
      safeSend(win, 'download-progress', {
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
        safeSend(win, 'download-progress', {
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

    // [Compat] TikTok HEVC -> H.264 pour lisibilité hors VLC
    await convertHevcToH264IfNeeded(finalPath, url, win, trackerFinal)

    safeSend(win, 'download-complete', {
      // [v2.4.1] FIX bouton "Ouvrir": envoyer le vrai nom sur disque et le DOSSIER.
      // Avant, savePath contenait le chemin complet du fichier, et le fallback
      // shell.openPath() LANÇAIT la vidéo au lieu de la sélectionner dans l'Explorateur.
      filename: uniqueFilename,
      url: url,
      audioOnly: !!audioOnly,
      state: 'finished',
      savePath: savePath,
      filePath: finalPath
    })
    sendNotification(
      'Téléchargement terminé',
      `${fileInfo.filename} a été téléchargé avec succès`,
      true
    )
    handleDownloadEnd(url, !!audioOnly) // [v2.4.0] Composite key

    // Optional: Cleanup empty folder
    try {
        const files = fs.readdirSync(tempDir);
        if (files.length === 0) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } catch(e) {}
  } catch (error: any) {
    if (error.message !== 'FALLBACK_TO_YTDLP') {
      console.error('Multi-threaded download error:', error)
    }

    console.log('Falling back to yt-dlp with headers...')
    // [v1.7.3] Robust tracker retrieval including audioOnly state
    const trackerId = getTrackerId(url, !!audioOnly)
    const tracker = state.activeDownloads.get(trackerId)
    
    // [v1.7.3] Smart Retry: If we hit a timeout or reset, and haven't tried with fewer threads yet
    if (error.message.includes('Timeout') || error.message.includes('ECONNRESET')) {
      if (tracker && (tracker.retryCount || 0) < 2) {
        console.log('[MultiThread] Connection issue. Retrying with SAFE thread count...')
        tracker.retryCount = (tracker.retryCount || 0) + 1
      }
    }

    if (tracker) {
      tracker.strategy = 'yt-dlp'
      safeSend(win, 'download-status', { url, status: 'Falling back to safe mode...' })
      
      // [v1.9.42] Ensure we pass a VALID filename to yt-dlp fallback
      const fallbackName = tracker?.filename && tracker.filename !== 'Generic' && !tracker.filename.includes('s2-download.xyz')
        ? tracker.filename 
        : (fileInfo?.filename || 'Generic')

      // Retry with yt-dlp using captured headers and PRESERVE filename/audioOnly
      await downloadWithYtDlp(url, savePath, 'SafeMode', win, undefined, fallbackName, false, !!audioOnly, tracker?.headers)
      return
    }

    // [v1.2.9] Re-throw the error so the queue manager can handle retries.
    // Do NOT call handleDownloadEnd(url) here.
    throw error
  }
}

// Helper to get video info (formats) - V22 Signature Solver Support
export async function fetchVideoInfo(
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

export async function startDownloadFromQueue(queuedItem: QueuedDownload) {
  const { url, savePath, mainWindow } = queuedItem
  const downloadPath = savePath || state.appSettings.downloadPath
  
  const trackerId = getTrackerId(url, !!queuedItem.audioOnly)
  
  // [v1.9.3] Re-use existing tracker if created during restoration to preserve progress/size
  const existingTracker = state.activeDownloads.get(trackerId)
  const initialTracker: DownloadTracker = existingTracker ? {
    ...existingTracker,
    paused: false,
    cancelled: false,
    process: null,
    httpRequests: []
  } : {
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

  state.activeDownloads.set(trackerId, initialTracker)

  try {
    // USE PLUGIN SYSTEM
    const plugin = pluginManager.getPlugin(url)

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

    // [v1.7.3] MOOVBOB / LOK-LOK / SIBNET / NETFILM SPECIAL HANDLING
    // Direct iframes or sensitive domains should prefer yt-dlp for better extraction
    if (
      (url.includes('moovbob.fr') || url.includes('hakunaymatata.com') || url.includes('sibnet.ru') || url.includes('netfilm.world')) &&
      strategy === 'direct' &&
      !(hasSignature && isDirectVideo)
    ) {
      console.log(`[DEBUG] Sensitive domain detected, prioritizing yt-dlp for extraction`)
      strategy = 'yt-dlp'
      platformName = 'SafeMode'
    }

    initialTracker.strategy = strategy as any
    initialTracker.isYouTube = platformName === 'YouTube'
    
    console.log(`[Queue] Finalized strategy for ${url.substring(0, 50)}... -> Strategy: ${strategy}, Platform: ${platformName}`)

    if (strategy === 'yt-dlp') {
      console.log(`[DEBUG] Starting Plugin Download(${platformName}) via yt-dlp...`)
      await downloadWithYtDlp(
        url,
        downloadPath,
        platformName,
        mainWindow,
        undefined,
        initialTracker.filename,
        false,
        queuedItem.audioOnly,
        queuedItem.headers
      )
    } else {
      console.log('[DEBUG] Starting Direct Download (Multi-threading)...')
      await downloadWithMultiThreading(url, downloadPath, mainWindow, queuedItem.audioOnly) // [v1.7.0] Pass flag
    }

    // [v1.3.0] CRITICAL: Handle successful completion to free up queue slot
    // [FIX] Atteindre cette ligne = le téléchargement a RÉUSSI (sinon exception).
    // On force lastProgress à 100 pour que handleDownloadEnd retire bien le tracker :
    // sur le chemin audio yt-dlp/aria2c, le parsing de progression rate parfois le
    // 100%, et le tracker restait "incomplet" -> bloqué à 100% dans l'UI puis
    // re-persisté et relancé (en échec) au redémarrage.
    const doneTracker = state.activeDownloads.get(getTrackerId(url, !!queuedItem.audioOnly))
    if (doneTracker) doneTracker.lastProgress = 100
    handleDownloadEnd(url, !!queuedItem.audioOnly)
  } catch (error: any) {
    console.error('Error starting download from queue:', error)

    // [v1.7.3] Special SILENT FALLBACK to yt-dlp if direct engine trips a sensitive domain
    const isWaitPage = error.message === 'FALLBACK_TO_YTDLP_WAIT_PAGE'
    if (error.message === 'FALLBACK_TO_YTDLP' || isWaitPage) {
      console.log(`[Queue] Silent fallback to yt-dlp triggered for ${url} (WaitPage=${isWaitPage})`)
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
          queuedItem.headers,
          isWaitPage // [v1.9.41] Pass flag to give better error message
        )
        const doneTrackerFb = state.activeDownloads.get(getTrackerId(url, !!queuedItem.audioOnly))
        if (doneTrackerFb) doneTrackerFb.lastProgress = 100
        handleDownloadEnd(url, !!queuedItem.audioOnly)
        return
      } catch (innerError: any) {
        console.error('[Queue] yt-dlp fallback also failed:', innerError)
        error = innerError // Preserve inner error for notification
      }
    }

    // Skip retry for recognized "Wait Page" errors
    if (error.message.includes("page d'attente") || error.message.includes("Wait Page")) {
       console.log('[Queue] Recognized Wait Page error. Skipping retries.')
    } else {
      // Retry logic
      const trackerId = getTrackerId(url, !!queuedItem.audioOnly)
      const tracker = state.activeDownloads.get(trackerId)
      if (tracker && tracker.retryCount !== undefined && tracker.maxRetries !== undefined) {
        if (tracker.retryCount < tracker.maxRetries) {
          const retryDelay = Math.min(1000 * Math.pow(2, tracker.retryCount), 30000)
          tracker.retryCount++

          console.log(
            `Retrying download ${url} (attempt ${tracker.retryCount}/${tracker.maxRetries}) after ${retryDelay} ms`
          )

          setTimeout(() => {
            state.downloadQueue.unshift({
              ...queuedItem,
              retryCount: tracker.retryCount || 0,
              priority: (queuedItem.priority || 0) + 1
            })
            state.activeDownloads.delete(trackerId)
            processDownloadQueue()
          }, retryDelay)

          return
        }
      }
    }

    // Échec définitif
    const errorMessage = error.message || 'Failed to download file'
    
    // [v2.3.6] FAIL-SAFE: Do NOT delete tracker on error. Keep it in list so user can Resume.
    const trackerIdFinalErr = getTrackerId(url, !!queuedItem.audioOnly)
    const trackerErr = state.activeDownloads.get(trackerIdFinalErr)
    if (trackerErr) {
       trackerErr.statusMessage = `Erreur: ${errorMessage}`
       trackerErr.paused = true // Treat as paused/interrupted
       // [v2.4.0] Retries are exhausted here → mark as permanently failed so it is NOT
       // auto-resumed on the next app launch (avoids the infinite failure loop).
       trackerErr.failedPermanent = true
       saveActiveDownloads() // Persist the error state
    }

    safeSend(mainWindow, 'download-error', {
      url,
      audioOnly: !!queuedItem.audioOnly,
      error: errorMessage
    })
    sendNotification('Erreur de téléchargement', `Échec: ${errorMessage}`, false)
    
    // Call handleDownloadEnd but it will now detect it's not finished and keep the tracker
    handleDownloadEnd(url, !!queuedItem.audioOnly)
  }
}

// Fonction pour traiter la file d'attente
export function processDownloadQueue() {
  // Trier la queue par priorité (plus haute priorité en premier)
  state.downloadQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  // Filtrer les téléchargements qui sont en pause ou annulés
  const currentActive = Array.from(state.activeDownloads.values()).filter(
    (t) => !t.paused && !t.cancelled
  ).length

  // [v1.3.0] Sync limit from settings to ensure user changes are respected
  const currentMax = state.appSettings.maxConcurrentDownloads || 3

  console.log(
    `[Queue] Processing. Active: ${currentActive}, Max: ${currentMax}, In Queue: ${state.downloadQueue.length}`
  )

  if (currentActive >= currentMax) {
    console.log('[Queue] Simultaneous download limit reached. Waiting...')
    return
  }

  // Trier par priorité avant de prendre le premier
  state.downloadQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  const itemsToStart = currentMax - currentActive
  console.log(`[Queue] Attempting to start ${Math.min(itemsToStart, state.downloadQueue.length)} downloads.`)

  for (let i = 0; i < itemsToStart && state.downloadQueue.length > 0; i++) {
    const nextItem = state.downloadQueue.shift()
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
export function addToDownloadQueue(
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
    safeSend(mainWindow, 'notification', {
      title: 'Téléchargement impossible',
      body: 'Les liens "blob:" (ChatGPT, etc.) ne peuvent pas être téléchargés directement. Veuillez clic-droit sur le fichier dans votre navigateur et choisir "Enregistrer sous".'
    })
    return
  }

  // [v1.6.9] Enforcement: Block downloads if not activated
  if (!state.appSettings.isActivated) {
    console.warn(`[Queue] Blocked download because app is not activated: ${url}`)
    safeSend(mainWindow, 'notification', {
      title: 'Activation Requise',
      body: 'Veuillez activer votre licence pour débloquer les téléchargements.'
    })
    // Also open the settings modal to guide the user
    safeSend(mainWindow, 'open-settings') 
    return
  }

  // [v1.7.0] Composite check
  const trackerId = getTrackerId(url, audioOnly)

  // [v1.9.4] SMART RESUME: Detect if this is a "re-capture" of an expired/failed download
  const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const newNormalizedName = normalize(filename || '');
  
  if (filename) {
    for (const [id, tracker] of state.activeDownloads.entries()) {
      if (tracker.filename && normalize(tracker.filename) === newNormalizedName && id !== trackerId) {
        // If the existing one is failed/expired, remove it to avoid duplicates
        if (tracker.statusMessage?.includes('expiré') || tracker.statusMessage?.includes('Forbidden') || tracker.statusMessage?.includes('Error')) {
           console.log(`[SmartResume] Found expired duplicate for ${filename}. Cleaning up old tracker: ${id}`);
           state.activeDownloads.delete(id);
           safeSend(mainWindow, 'download-removed', { url: tracker.url, audioOnly: tracker.audioOnly });
        }
      }
    }
  }

  // Vérifier si déjà dans la queue ou actif - [v1.7.0] Composite check
  if (state.downloadQueue.some((item) => getTrackerId(item.url, !!item.audioOnly) === trackerId) || state.activeDownloads.has(trackerId)) {
    console.log('Download already queued or active (Composite):', trackerId)
    return
  }

  // [v1.2.9] AUTOMATIC FOLDER ORGANIZATION 📂
  // Les audios peuvent avoir leur propre dossier (audioPath) ; sinon on retombe
  // sur downloadPath, comme les vidéos.
  const baseDir = savePath || getBaseDownloadDir(!!audioOnly)
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
    maxRetries: state.appSettings.maxRetries,
    mainWindow
  }

  state.downloadQueue.push(queuedItem)

  // NOTIFY FRONTEND - Immediate update
  // Check if filename is known or default
  // const isRetry = false;
  const name = filename || url.split('/').pop()?.split('?')[0] || 'unknown-file'

  safeSend(mainWindow, 'download-started', {
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
export function handleDownloadEnd(url: string, audioOnly?: boolean) {
  // [v1.9.5] CRITICAL SHUTDOWN PROTECTION:
  if (state.isAppQuitting) return

  const trackerId = audioOnly !== undefined ? getTrackerId(url, audioOnly) : url
  const tracker = state.activeDownloads.get(trackerId) || state.activeDownloads.get(url)

  if (tracker) {
    // [v2.3.6] PERSISTENCE IMPROVEMENT:
    // Only delete trackers for completed (100%) or cancelled downloads.
    // If it's a failure (progress < 100), keep it in state.activeDownloads so it persists in the UI and active_downloads.json.
    const isFinished = (tracker.lastProgress !== undefined && tracker.lastProgress >= 100);
    
    if (isFinished || tracker.cancelled) {
      console.log(`[Lifecycle] Removing tracker (Finished/Cancelled): ${trackerId}`)
      
      // Add to recently completed cache before deleting
      state.recentlyCompletedDownloads.set(trackerId, { timestamp: Date.now() })
      setTimeout(() => {
        state.recentlyCompletedDownloads.delete(trackerId)
      }, RECENTLY_COMPLETED_TTL)

      state.activeDownloads.delete(trackerId)
      state.activeDownloads.delete(url)
    } else {
      console.log(`[Lifecycle] Keeping tracker for resume (Incomplete/Failed): ${trackerId}`)
      tracker.paused = true; // Ensure it's not processed by queue until resumed
    }
    
    saveActiveDownloads(); // Save state immediately
  }

  processDownloadQueue()
}

// Fonction pour arrêter un téléchargement
export async function stopDownload(url: string, audioOnly: boolean = false, senderWin?: BrowserWindow) {
  const trackerId = getTrackerId(url, audioOnly)
  const tracker = state.activeDownloads.get(trackerId)
  console.log(`[stopDownload] Cancelling: ${trackerId}, tracker found: ${!!tracker}`)
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
    state.activeDownloads.delete(trackerId)

    // [v2.3.7] Notify frontend — prefer the sender window for accuracy,
    // fallback to any non-destroyed window
    const targetWin = (senderWin && !senderWin.isDestroyed())
      ? senderWin
      : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())

    if (targetWin) {
      safeSend(targetWin, 'download-cancelled', {
        url,
        audioOnly: !!audioOnly
      })
      console.log(`[stopDownload] Sent download-cancelled to window for: ${url}`)
    } else {
      console.warn('[stopDownload] No valid window found to send download-cancelled')
    }

    processDownloadQueue()
  } else {
    console.warn(`[stopDownload] No tracker found for: ${trackerId}`)
  }
}

// Fonction de téléchargement utilisant yt-dlp
export async function downloadWithYtDlp(
  url: string,
  savePath: string,
  _platform: string,
  win: BrowserWindow | null,
  formatId?: string, // Restored original parameter name
  customFilename?: string,
  _isRetry: boolean = false,
  audioOnly: boolean = false,
  headers?: Record<string, string>,
  isWaitPageFallback: boolean = false
) {
  let cookieFile: string | null = null
  let tracker: any = null

  try {
    const trackerId = getTrackerId(url, audioOnly)
    tracker = state.activeDownloads.get(trackerId)
    
    // [v1.4.5] Use headers from parameter if tracker is not yet available (batch fallback)
    // [v1.4.5] Use headers from parameter if tracker is not yet available (batch fallback)
    const effectiveHeaders = { ...(headers || {}), ...(tracker?.headers || {}) }

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
      const aria2Path = await ensureAria2Available(win || undefined)
      const hasAria2 = !!aria2Path

      // Vérifier si ffmpeg est disponible
      const ffmpegPath = await ensureFfmpegAvailable(win || undefined)
      const hasFfmpeg = !!ffmpegPath

      // [v1.4.9] AGGRESSIVE RESUME: Strip technique format IDs and scan for orphaned .part files
      let finalCustomFilename = customFilename

      // [v1.8.3] SENSITIVE DOMAIN DETECTION (Moovbob / Lok-lok / Netfilm)
      const isSensitiveDomain = cleanUrl.includes('moovbob.fr') || 
                               cleanUrl.includes('hakunaymatata.com') || 
                               cleanUrl.includes('sibnet.ru') ||
                               cleanUrl.includes('netfilm.world') ||
                               (headers?.['Referer'] && (headers['Referer'].includes('moovbob.fr') || headers['Referer'].includes('sibnet.ru') || headers['Referer'].includes('netfilm.world')))
      
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
        // finalCustomFilename = finalCustomFilename.replace(/\.f\d+/g, '')

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
              headers?.['Referer'] || '',
              cleanUrl,
              finalCustomFilename
            ]);

            if (seriesHint) {
              console.log(`[Series Fix] Detected metadata: ${seriesHint}`);
              // finalCustomFilename = `${finalCustomFilename}_${seriesHint}`;
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

          if (!(tracker?.filename && (
            fs.existsSync(join(savePath, tracker.filename + '.part')) || 
            fs.existsSync(join(savePath, tracker.filename + '.ytdl')) ||
            fs.existsSync(join(savePath, tracker.filename))
          ))) {
            // [v1.9.4] Before shifting to a new name (1), check if a .part file exists for the base name
            // and if NO OTHER ACTIVE download is using it.
            const basePartExists = fs.existsSync(join(savePath, checkName + '.part')) || 
                                 fs.existsSync(join(savePath, checkName + '.mp4.part')) ||
                                 fs.existsSync(join(savePath, checkName + '.ytdl'));
            const isNameGloballyTaken = Array.from(state.activeDownloads.values()).some(t => t.filename === checkName && !t.paused && t.process);
            
            if (basePartExists && !isNameGloballyTaken) {
               console.log(`[yt-dlp] Base .part file found for ${checkName} and slot is free. Using it for resume.`);
               finalCustomFilename = checkName;
            } else {
              while (isTaken(checkName)) {
                checkName = `${finalCustomFilename}(${counter})`;
                counter++;
              }
              finalCustomFilename = checkName;
            }
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

      const downloadArgs = [
        cleanUrl, // [v1.7.2] Using clean URL
        '--paths', `home:${savePath}`, // [v1.9.8] Set base directory to avoid absolute path warnings
        '--paths', `temp:${tempDir}`, // [v1.3.6] Force temp files to the same disk
        '-o',
        // [v1.9.8] Use relative template because base directory is now set via --paths home
        finalCustomFilename
          ? `${finalCustomFilename.replace(/\.f\d+/g, '').replace(/\.(mp3|mp4|webm|m4a|mkv)$/i, '')}.%(ext)s` // [v2.3.5] Strip legacy .fXXX tags to avoid double extension
          : '%(title)s.%(ext)s',
        '--part', // Ensure .part files are used
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
      const isYouTubeDownload = cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be');
      const isPalkadGroup = cleanUrl.includes('lok-lok.cc') || cleanUrl.includes('movie-box.co') || cleanUrl.includes('moviebox') || cleanUrl.includes('palkad') || cleanUrl.includes('moovbob.fr') || cleanUrl.includes('sibnet.ru') || cleanUrl.includes('hakunaymatata.com') || cleanUrl.includes('netfilm.world');
      
      if (hasAria2 && aria2Path && !isPalkadGroup && !isYouTubeDownload) {
        downloadArgs.push('--downloader', aria2Path)
        // [v1.7.6] ABSOLUTE TURBO: Added --min-split-size=1M and --summary-interval=1
        // [v1.3.6] IDM Optimization: Use falloc for pre-allocation, increase min-split-size to 1M (Nitro)
        const ariaArgs = useRestrictedThreads 
          ? `aria2c:-x ${restrictedNCount} -s ${restrictedNCount} -j 32 -k 1M --min-split-size=1M --summary-interval=1 --file-allocation=falloc --check-certificate=false --no-conf`
          : 'aria2c:-x 16 -s 16 -j 32 -k 1M --min-split-size=1M --summary-interval=1 --file-allocation=falloc --check-certificate=false --no-conf'
        
        downloadArgs.push('--downloader-args', ariaArgs)
        console.log(`[yt-dlp] Turbo Mode Enabled: Using aria2c (${useRestrictedThreads ? 'Safe Restricted' : 'Absolute Turbo'})`)
      } else if (isYouTubeDownload) {
         // [v2.4.1] Fragments HLS/DASH en parallèle (prudent: 4 pour limiter le risque de 403)
         downloadArgs.push('--concurrent-fragments', '4')
         console.log('[yt-dlp] YouTube detected: Using Native Downloader (No aria2c) to avoid rate limits and 403 Forbidden errors.');
      } else {
         // [v2.4.1] FIX: le commentaire ci-dessus promettait --concurrent-fragments mais le
         // flag n'était jamais passé — les fragments HLS se téléchargeaient un par un.
         downloadArgs.push('--concurrent-fragments', '8')
         if (isPalkadGroup) {
           console.log('[yt-dlp] Palkad/Lok-Lok detected: Native downloader with 8 concurrent fragments.');
         } else {
           console.log('[yt-dlp] aria2c unavailable: native downloader with 8 concurrent fragments.');
         }
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
              safeSend(win, 'notification', {
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
              safeSend(win, 'notification', {
                title: 'FFmpeg requis',
                body: 'FFmpeg est indispensable pour ce site. Tentative de téléchargement en cours...'
              })
            }
            // Still try best, but it will likely produce the tiny file the user complained about
            downloadArgs.push('-f', 'best')
          } else if (url.includes('tiktok.com')) {
            // [TikTok] Deux pièges, vérifiés sur des fichiers réellement téléchargés :
            //  1. `bestvideo+bestaudio/best` retenait le format « bytevc1 » (= H.265/HEVC),
            //     que Windows ne lit PAS sans extension payante -> l'utilisateur devait
            //     ouvrir la vidéo avec VLC. On trie donc en préférant H.264 (`-S vcodec:h264`),
            //     lisible partout ; on garde `res` ensuite pour prendre la meilleure
            //     définition PARMI les H.264. Si une vidéo n'existe qu'en H.265, le tri
            //     (et non un filtre) la laisse quand même passer.
            //  2. `bestvideo` pouvait retenir une piste SANS AUDIO -> fichiers muets.
            //     `best*[acodec!=none][vcodec!=none]` exige un format qui contient
            //     réellement les deux pistes.
            downloadArgs.push(
              '-f',
              'best*[acodec!=none][vcodec!=none]/bestvideo+bestaudio/best',
              '-S',
              'vcodec:h264,res',
              '--merge-output-format',
              'mp4'
            )
            console.log('[yt-dlp] TikTok: sélecteur H.264 + audio obligatoire')
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
      const cookieHost = (() => {
        try {
          return new URL(url).hostname.toLowerCase()
        } catch {
          return ''
        }
      })()
      const hostEndsWith = (suffix: string): boolean =>
        cookieHost === suffix || cookieHost.endsWith('.' + suffix)

      const isSocialPlatform =
        hostEndsWith('tiktok.com') ||
        hostEndsWith('instagram.com') ||
        hostEndsWith('facebook.com') ||
        hostEndsWith('twitter.com') ||
        hostEndsWith('x.com')

      // YouTube: Never use cookies - works better with anonymous access
      const isYouTube = hostEndsWith('youtube.com') || hostEndsWith('youtu.be')

      if (isSocialPlatform && effectiveHeaders['Cookie']) {
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
          const cookies = effectiveHeaders['Cookie'].split(';').map((c) => c.trim())
          const expiration = Math.floor(Date.now() / 1000) + 86400 // 24h from now

          // [FIX] Les cookies doivent être écrits sous le domaine de LA plateforme
          // ciblée. Avant, ils étaient toujours étiquetés .youtube.com/.google.com,
          // donc totalement inutilisables pour TikTok/Instagram (yt-dlp les ignorait).
          let cookieDomains = [
            '.youtube.com',
            '.google.com',
            '.googlevideo.com',
            '.youtube-nocookie.com'
          ]
          if (hostEndsWith('tiktok.com')) {
            cookieDomains = ['.tiktok.com', '.tiktokv.com', '.tiktokcdn.com', '.tiktokcdn-us.com']
          } else if (hostEndsWith('instagram.com')) {
            cookieDomains = ['.instagram.com', '.cdninstagram.com', '.fbcdn.net']
          } else if (hostEndsWith('facebook.com') || hostEndsWith('fb.watch')) {
            cookieDomains = ['.facebook.com', '.fbcdn.net']
          } else if (hostEndsWith('twitter.com') || hostEndsWith('x.com')) {
            cookieDomains = ['.twitter.com', '.x.com', '.twimg.com']
          }

          for (const cookie of cookies) {
            const [name, ...valueParts] = cookie.split('=')
            const value = valueParts.join('=')
            if (name && value) {
              for (const d of cookieDomains) {
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
      safeSend(win, 'download-started', {
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
      if (state.cachedNodeDir) {
        nodeFoundDir = dirname(state.cachedNodeDir)
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
          const whichNode = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
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
        const portableNodePath = await ensureNodeAvailable(win || undefined)
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
              const trackerRef = state.activeDownloads.get(trackerId)
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
                const trackerLog = state.activeDownloads.get(trackerId)
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
                      safeSend(win, 'download-progress', {
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
                        if (win && !win.isDestroyed()) {
                          safeSend(win, 'download-progress', {
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
                        if (win && !win.isDestroyed()) {
                          safeSend(win, 'download-progress', {
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

                const trackerLog = state.activeDownloads.get(trackerId)
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

                  // [Audio Fix] If this is an audio-only download (MP3), the output file ends in .mp3,
                  // not .mp4 or .webm which are temporary files before conversion.
                  if (audioOnly || tracker?.audioOnly) {
                    filename = filename.replace(/\.[^.]+$/, '.mp3')
                  }

                  const finalPath = require('path').join(savePath, filename)

                  // Ensure stat check safety - Retry a few times if filesystem is slow to release lock?
                  let fileSize = 0
                  try { fileSize = fs.statSync(finalPath).size } catch (e) {
                    console.error('[yt-dlp] Final file not found (yet?):', finalPath)
                  }

                  // [v1.9.7] STEALTH MODE: Reveal the final file!
                  unhideFile(finalPath);

                  const trackerId = getTrackerId(url, audioOnly)
                  const trackerFinal = state.activeDownloads.get(trackerId)
                  if (trackerFinal) {
                    trackerFinal.lastProgress = 100
                  }

                  if (win && !win.isDestroyed()) {
                    safeSend(win, 'download-complete', {
                      // [v2.4.1] savePath (dossier) + audioOnly pour que l'UI retrouve
                      // l'item et que "Ouvrir" sélectionne le bon fichier
                      url, filePath: finalPath, filename, totalBytes: fileSize, state: 'finished',
                      savePath, audioOnly: !!(audioOnly || tracker?.audioOnly)
                    })
                    safeSend(win, 'notification', { title: 'Terminé', body: filename })
                  }
                  resolve(true)
                } else {
                  const tracker = state.activeDownloads.get(trackerId)
                  if (tracker && (tracker.paused || tracker.cancelled)) {
                    reject(new Error('Cancelled'))
                  } else {
                    // Check known errors for logging
                    let errorMessage = `Exit code ${code}`
                    if (errorOutput.includes('Unsupported URL')) {
                      errorMessage = 'URL non supportée (Ce n\'est pas une vidéo)'
                    } else if (errorOutput.includes('Sign in') || errorOutput.includes('403') || errorOutput.includes('Forbidden')) {
                      errorMessage = 'Lien expiré. Veuillez capturer à nouveau l\'épisode sur le site.'
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

    if (isWaitPageFallback && error.message.includes('Unsupported URL')) {
      error.message = "C'est une page d'attente (Intermediary/Wait Page). Merci de patienter sur le site 10-15 secondes pour que le vrai lien soit généré puis clique sur Télécharger."
    }

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
    
    // [v1.9.7] PROTECTIVE PERSISTENCE: Never auto-cleanup on failure anymore.
    // We want to keep .part files even if the link expired so we can resume later.
    /*
    if (savePath && !error.message.includes('Lien expiré')) {
        cleanupDebris(savePath, tracker?.filename || customFilename || 'download')
    }
    */

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



// [v2.4.0] killProcesses: only kill running processes/HTTP requests when the app is
// actually quitting. Historically this cleanup ran on EVERY handleDownloadEnd() call,
// which killed the yt-dlp processes and HTTP requests of OTHER downloads still running
// in parallel — making simultaneous downloads fail. The kill loop is now gated.
export function saveActiveDownloads(killProcesses: boolean = false) {
  try {
    const persistencePath = join(app.getPath('userData'), 'active-downloads.json')

    const getDiskProgress = (tracker: DownloadTracker): number => {
      if (!tracker.savePath || !tracker.filename) return tracker.lastBytes || 0

      const tempDir = join(tracker.savePath, '.doulget_tmp')
      const possiblePaths = [
        join(tracker.savePath, tracker.filename),
        join(tracker.savePath, `${tracker.filename}.part`),
        join(tempDir, tracker.filename),
        join(tempDir, `${tracker.filename}.part`),
        join(tempDir, `${tracker.filename}.ytdl`)
      ]

      let maxSize = tracker.lastBytes || 0
      for (const p of possiblePaths) {
        try {
          if (fs.existsSync(p)) {
            maxSize = Math.max(maxSize, fs.statSync(p).size)
          }
        } catch {}
      }
      return maxSize
    }

    // [v1.9.5] Persist ACTIVE downloads (Trackers)
    const activeToSave = Array.from(state.activeDownloads.entries())
      .filter(([_, tracker]) =>
        // Only save downloads that aren't finished (100%) and aren't cancelled
        (tracker.lastProgress === undefined || tracker.lastProgress < 100) &&
        !tracker.cancelled &&
        tracker.url 
        // Note: filename check removed/relaxed to ensure all starting downloads are kept
      )
      .map(([id, tracker]) => ({
        url: tracker.url || id.split('|')[0],
        filename: tracker.filename || 'download',
        savePath: tracker.savePath || state.appSettings.downloadPath,
        receivedBytes: getDiskProgress(tracker),
        totalBytes: tracker.totalBytes || 0,
        segmentProgress: tracker.segmentProgress || [],
        segmentDownloaded: tracker.segmentDownloaded || [], // [v2.3.3] Actual bytes per segment
        numThreads: tracker.numThreads || 32, // [v2.3.3] Keep thread count consistent
        ranges: tracker.ranges || [], // [v2.3.4] Dynamic segments
        headers: tracker.headers || {},
        strategy: tracker.strategy || 'direct',
        audioOnly: !!tracker.audioOnly,
        failedPermanent: !!tracker.failedPermanent, // [v2.4.0] Don't auto-retry on restart
        statusMessage: tracker.statusMessage || '',
        timestamp: tracker.startTime || Date.now(),
        isQueued: false
      }))

    // [v1.9.5] Persist QUEUED downloads (Waiting for slot)
    const queuedToSave = state.downloadQueue.map(item => ({
       url: item.url,
       filename: item.filename || 'download',
       savePath: item.savePath || state.appSettings.downloadPath,
       receivedBytes: 0,
       totalBytes: 0,
       headers: item.headers || {},
       strategy: 'direct', // Will be determined on start
       audioOnly: !!item.audioOnly,
       timestamp: Date.now(),
       isQueued: true
    }))

    const allDownloads = [...activeToSave, ...queuedToSave]

    fs.writeFileSync(persistencePath, JSON.stringify({ downloads: allDownloads }, null, 2), 'utf-8')
    console.log(`[PERSISTENCE] Saved ${allDownloads.length} downloads (${activeToSave.length} active, ${queuedToSave.length} queued)`)

    // CLEANUP: Kill all active processes ONLY when the app is exiting.
    // [v2.4.0] Guarded: never kill mid-session, otherwise finishing one download
    // would abort every other download still in progress.
    if (killProcesses || state.isAppQuitting) {
      state.activeDownloads.forEach((tracker) => {
        // Kill yt-dlp process
        if (tracker.process) {
          try {
            console.log('[CLEANUP] Killing active yt-dlp process (app exit)')
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
    }

  } catch (error) {
    console.error('[PERSISTENCE] Error saving active downloads:', error)
  }
}

// [v1.4.1] Restore active downloads from saved state
export function restoreActiveDownloads(win: BrowserWindow) {
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

    // Get main window for callbacks (passed as parameter)
    console.log(`[PERSISTENCE] Attempting to restore ${data.downloads.length} downloads`)
    const recoveredFiles = new Set<string>(); // [v1.9.3] Track files already mapped to avoid duplicates

    data.downloads.forEach((download: any) => {
      const trackerId = getTrackerId(download.url, !!download.audioOnly)
      
      // [v1.2.9] ANTI-DUPLICATE CHECK: Skip if already in memory
      if (state.activeDownloads.has(trackerId)) {
        console.log(`[PERSISTENCE] Skipping duplicate: ${download.filename}`)
        return
      }

      // Check if partial file exists
      const tempDir = join(download.savePath, '.doulget_tmp')
      const possibleFilePaths = [
        join(download.savePath, download.filename),
        join(download.savePath, `${download.filename}.part`),
        join(download.savePath, download.filename + '.tmp'),
        join(tempDir, download.filename),
        join(tempDir, `${download.filename}.part`),
        join(tempDir, download.filename + '.ytdl')
      ]

      let existingFilePath: string | null = null
      let existingFileSize = 0

      for (const filePath of possibleFilePaths) {
        if (fs.existsSync(filePath) && !recoveredFiles.has(filePath)) { // [v1.9.3] Check unique
          existingFilePath = filePath
          existingFileSize = fs.statSync(filePath).size
          break
        }
      }

      // SMART RECOVERY: Fuzzy search for the file if exact match failed
      if (!existingFilePath) {
        try {
          // [v1.9.6] Scan both root and .doulget_tmp
          const searchDirs = [download.savePath, join(download.savePath, '.doulget_tmp')]
          
          for (const sDir of searchDirs) {
            if (!fs.existsSync(sDir)) continue;
            const files = fs.readdirSync(sDir);

            // Normalization function: Remove accents, keep only alphanum, lowercase
            const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

            // Create a reliable fingerprint from the SAVED filename
            const rawName = download.filename.replace(/\.[a-z0-9]+$/, '').replace(/\.part$/, '');
            const normalizedTarget = normalize(rawName);
            
            // [v1.9.3] STRENGTHENED FINGERPRINT: First 15 + Last 5 (often contains Ep number)
            const prefix = normalizedTarget.substring(0, 15);
            const suffix = normalizedTarget.slice(-5);

            // Find best match: file that contains our fingerprint and isn't already taken
            const candidates = files.filter(f => {
              const fullPath = join(download.savePath, f);
              if (recoveredFiles.has(fullPath)) return false;
              
              const normF = normalize(f);
              // Check prefix AND suffix for much higher precision (episodes sharing same prefix)
              const match = normF.startsWith(prefix) || (normF.includes(prefix) && normF.includes(suffix));
              return match && (f.endsWith('.part') || f.includes('.tmp') || f.includes('.f137') || f.includes('.f140') || f.includes('.ytdl'));
            });

            // If multiple candidates, pick the closest in length
            if (candidates.length > 0) {
              candidates.sort((a, b) => Math.abs(a.length - download.filename.length) - Math.abs(b.length - download.filename.length));
              const candidate = candidates[0];
              const fullPath = join(download.savePath, candidate);

              console.log(`[PERSISTENCE] Smart Recovery (Fuzzy): Mismatch found. Saved: "${download.filename}" -> Disk: "${candidate}"`);
              existingFilePath = fullPath;
              existingFileSize = fs.statSync(existingFilePath).size;

              // CRITICAL FIX: Update filename to match the ACTUAL file on disk
              const newFilename = candidate.replace('.part', '').replace('.ytdl', '');
              if (newFilename.length > 5) { // Safety check
                download.filename = newFilename;
              }
              break; // Found in this directory, stop search
            }
          }
        } catch (e) { console.error('[PERSISTENCE] Fuzzy search failed', e) }
      }

      // Register file as recovered to prevent other downloads from stealing it
      if (existingFilePath) {
        recoveredFiles.add(existingFilePath);
      }

      // RELAXED PERSISTENCE: Restore tracker even if file is missing
      if (true) { // Always restore if it was in the active list
        
        // [v1.9.5] If it was previously in queue, just add back to queue
        if (download.isQueued) {
           console.log(`[PERSISTENCE] Restoring to QUEUE: ${download.filename}`)
           state.downloadQueue.push({
             url: download.url,
             savePath: download.savePath,
             filename: download.filename,
             headers: download.headers,
             priority: 0,
             retryCount: 0,
             maxRetries: 3,
             mainWindow: win, // Use global mainWindow
             audioOnly: !!download.audioOnly
           })
           return // Done for this item
        }

        if (!existingFilePath) {
          console.log(`[PERSISTENCE] Partial file missing for: ${download.filename}. Restoring anyway to allow restart.`)
        } else {
          console.log(`[PERSISTENCE] Restoring download PAUSED: ${download.filename} (${existingFileSize}/${download.totalBytes} bytes)`)
        }

        // Helper to detect if it's YouTube (for robust resume)
        const isYouTube = download.url.includes('youtube.com') || download.url.includes('youtu.be');
        const isSignedDirectVideo =
          /[?&](sign|token|expires?|t)=/i.test(download.url) &&
          /\.(mp4|webm|m4v|mkv|avi|mov|flv|wmv)(\?|$)/i.test(download.url);

        // [v2.3.5] FIX: If file on disk is already larger than saved totalBytes, re-sync to avoid 100%+ jumps
        let totalBytes = download.totalBytes || 0;
        if (existingFileSize > totalBytes && totalBytes > 0) {
          console.log(`[PERSISTENCE] Re-syncing totalBytes for ${download.filename}: ${totalBytes} -> ${existingFileSize}`);
          totalBytes = existingFileSize;
        }

        const savedProgress = download.receivedBytes && totalBytes ? Math.round((download.receivedBytes / totalBytes) * 100) : 0;

        // Calculate lastProgress
        let lastProgress = 0;
        if (totalBytes > 0) {
          lastProgress = Math.min(Math.round((existingFileSize / totalBytes) * 100), 100);
        } else if (savedProgress > 0) {
          lastProgress = savedProgress; // Fallback to saved % if bytes missing
        }

        // Manually re-add to state.activeDownloads in PAUSED state
        const tracker: DownloadTracker = {
          item: null,
          url: download.url,
          startTime: download.timestamp || Date.now(),
          lastBytes: existingFileSize, // Actual bytes on disk (0 if missing)
          lastTime: Date.now(),
          savePath: download.savePath,
          filename: download.filename, // [v1.9.3] DO NOT clean format IDs here, it breaks resume for YouTube
          headers: download.headers,
          strategy: isSignedDirectVideo ? 'direct' : (download.strategy || (isYouTube ? 'yt-dlp' : 'direct')), // Fallback for legacy
          isYouTube: isYouTube,       // CRITICAL for resume logic
          totalBytes: totalBytes,
          segmentDownloaded: download.segmentDownloaded || [], // [v2.3.3] Restore progress
          numThreads: download.numThreads || 32,
          ranges: download.ranges || [], // [v2.3.4] Restore dynamic ranges
          paused: false, // [v1.9.3] Start active for auto-resume
          cancelled: false,
          lastProgress: lastProgress, // Use actual calculation
          statusMessage: existingFilePath ? (isYouTube ? 'Resuming YouTube...' : 'Resuming segment...') : 'Interrupted (File missing)',
          audioOnly: !!download.audioOnly // [v1.7.0] Restore from JSON
        }

        const trackerId = getTrackerId(download.url, !!download.audioOnly)
        state.activeDownloads.set(trackerId, tracker)

        // [v2.4.0] PERMANENT FAILURE: keep it visible but do NOT auto-resume, otherwise a
        // dead link (expired session, removed media, etc.) would loop in failure at every
        // launch. The user can retry manually via the UI.
        if (download.failedPermanent) {
          tracker.paused = true
          tracker.failedPermanent = true
          tracker.statusMessage = download.statusMessage || 'Échec précédent — cliquez pour réessayer'
          if (win && !win.isDestroyed()) {
            safeSend(win, 'download-started', {
              url: download.url,
              audioOnly: !!download.audioOnly,
              name: download.filename,
              size: formatBytes(download.totalBytes),
              progress: tracker.lastProgress,
              speed: '',
              // 'interrupted' shows a manual Play/retry button in the UI (unlike 'error',
              // which only offers Delete). canResume:true keeps that button enabled.
              status: 'interrupted',
              canResume: true,
              error: tracker.statusMessage
            })
          }
          return // Skip auto-resume queue push for this item
        }

        // [v1.9.3] AUTO-RESUME: Directly add to queue instead of waiting for manual click
        state.downloadQueue.push({
          url: download.url,
          savePath: download.savePath,
          filename: download.filename,
          headers: download.headers,
          priority: 0,
          retryCount: 0,
          maxRetries: 3,
          mainWindow: win,
          audioOnly: !!download.audioOnly
        })

        // Notify frontend (optional, processDownloadQueue will send 'download-progress' soon)
        if (win && !win.isDestroyed()) {
          safeSend(win, 'download-started', {
            url: download.url,
            audioOnly: !!download.audioOnly,
            name: download.filename,
            size: formatBytes(download.totalBytes),
            progress: tracker.lastProgress,
            speed: 'Queue...',
            status: 'queued', 
          })
        }
      }
    })

    // Notify the queue to start processing these added items
    processDownloadQueue()

    // Clean up the persistence file after restore
    if (fs.existsSync(persistencePath)) {
      fs.unlinkSync(persistencePath)
    }
    console.log('[PERSISTENCE] Restore complete (Paused)')
  } catch (error) {
    console.error('[PERSISTENCE] Error restoring active downloads:', error)
  }
}


export async function cleanupOrphanedTempFiles() {
  console.log('[Cleanup] Searching for orphaned .doulget_tmp folders...')
  const downloadPath = state.appSettings.downloadPath
  if (!downloadPath || !existsSync(downloadPath)) return

  try {
    const items = await fsPromises.readdir(downloadPath, { withFileTypes: true })
    const now = Date.now()
    const maxAge = 30 * 24 * 60 * 60 * 1000 // [v2.3.6] Increased to 30 days to protect long-paused downloads

    for (const item of items) {
      if (item.isDirectory() && item.name === '.doulget_tmp') {
        const fullPath = join(downloadPath, item.name)
        const stats = await fsPromises.stat(fullPath)
        
        // [v2.3.6] SAFETY CHECK: Do not delete if folder contains active download fragments
        let hasActiveFragments = false;
        try {
          const contents = await fsPromises.readdir(fullPath);
          hasActiveFragments = contents.some(f => f.endsWith('.part') || f.endsWith('.ytdl') || f.includes('.part-Frag'));
        } catch (e) { }

        // If the folder is older than 30 days AND has no active fragments, it's safe to remove
        if (now - stats.mtimeMs > maxAge && !hasActiveFragments) {
          console.log(`[Cleanup] Removing old temp folder (empty of active fragments): ${fullPath}`)
          await fsPromises.rm(fullPath, { recursive: true, force: true })
        }
      }
    }
  } catch (e) {
    console.warn('[Cleanup] Error during automatic cleanup:', e)
  }
}
