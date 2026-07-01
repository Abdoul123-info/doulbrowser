import { join } from 'path'
import * as path from 'path'
import * as fs from 'fs'
import { exec } from 'child_process'
import { URL } from 'url'

// [v1.9.9] GLOBAL IPC PROTECTION HELPER: Prevent 'Object has been destroyed' errors
export function safeSend(win: any, channel: string, ...args: any[]) {
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(channel, ...args)
    } catch (e: any) {
      console.warn(`[IPC] Failed to send to ${channel}:`, e.message)
    }
  }
}

export function formatTime(seconds: number): string {
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
export function isSocialMediaURL(url: string): { isSocial: boolean; platform: string } {
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

// [v1.6.3] Helper to generate unique filename (e.g. file(1).mp4)
// [v2.0.0] Improved to avoid renames during resume
export function getUniqueFilename(directory: string, filename: string, isResume: boolean = false): string {
  const tempDir = join(directory, '.doulget_tmp')

  // [v1.9.41] UNIQUENESS + RESUME FIX:
  // Deciding if a file is "taken" also involves checking for existing .part files in temp folder
  const isTaken = (name: string) => {
    const fullPath = join(directory, name)
    const partInRoot = fullPath + '.part'
    const partInTemp = join(tempDir, name + '.part')
    return fs.existsSync(fullPath) || fs.existsSync(partInRoot) || fs.existsSync(partInTemp)
  }

  // If we are resuming and the exact filename already exists OR its .part file exists, keep it!
  if (isResume || !isTaken(filename)) return filename

  const ext = path.extname(filename)
  const name = path.basename(filename, ext)
  let counter = 1
  let newFilename = `${name}(${counter})${ext}`

  while (isTaken(newFilename)) {
    counter++
    newFilename = `${name}(${counter})${ext}`
  }
  return newFilename
}

// [v1.6.5] Utility Helpers
export function formatSpeed(speed: number): string {
  if (!speed) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let unitIndex = 0
  while (speed >= 1024 && unitIndex < units.length - 1) {
    speed /= 1024
    unitIndex++
  }
  return `${speed.toFixed(2)} ${units[unitIndex]}`
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// [v1.8.9] Utility to sanitize strings for filenames (ASCII only to avoid Windows encoding issues)
export function sanitizeStringForFilename(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')                     // Split accented characters into base + accent
    .replace(/[\u0300-\u036f]/g, '')     // Remove accents
    .replace(/[^\x00-\x7F]/g, ' ')       // Remove any remaining non-ASCII
    .replace(/[<>:"\/\\|?*]/g, ' ')      // Remove Windows illegal characters
    .replace(/\s+/g, ' ')                // Collapse multiple spaces
    .trim();
}

export function calculateETA(remainingBytes: number, speed: number): string {
  if (speed <= 0) return '--'
  const seconds = remainingBytes / speed
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

// [v1.9.7] STEALTH MODE: Hide/Show file attributes on Windows
export function hideFile(filePath: string) {
  if (process.platform === 'win32') {
    exec(`attrib +h "${filePath}"`, (err) => {
      if (err) console.error(`[Stealth] Failed to hide ${filePath}:`, err);
    });
  }
}

export function unhideFile(filePath: string) {
  if (process.platform === 'win32') {
    exec(`attrib -h "${filePath}"`, (err) => {
      if (err) console.error(`[Stealth] Failed to unhide ${filePath}:`, err);
      else console.log(`[Stealth] Revealed ${filePath}`);
    });
  }
}

// [v1.7.7] Debris Cleanup Utility: Removes .part, .part-Frag, .ytdl files
export function cleanupDebris(directory: string, baseName: string) {
  try {
    if (!fs.existsSync(directory)) return
    const files = fs.readdirSync(directory)
    // Clean base name to match more effectively
    const cleanBase = baseName.replace(/\.(mp4|mp3|webm|m4a|mkv)$/i, '').trim()
    const baseFirstPart = cleanBase.substring(0, 15); // Match first 15 chars for safety
    
    for (const file of files) {
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
    console.error('[Cleanup] Error during debris cleanup:', e);
  }
}

// Helper to parse yt-dlp size strings (e.g. "12.3MiB", "500B", "1GB") into bytes
export function parseSizeToBytes(sizeStr: string): number {
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

// Helper for byte formatting 
export function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
