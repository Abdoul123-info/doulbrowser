import { Plugin, DownloadStrategy } from './interface'

export class YouTubePlugin implements Plugin {
  name = 'YouTube'

  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname.toLowerCase()
      return (
        hostname.includes('youtube.com') ||
        hostname.includes('youtu.be') ||
        hostname.includes('googlevideo.com') // CDN
      )
    } catch {
      return false
    }
  }

  getStrategy(_url: string): DownloadStrategy {
    // If it's a googlevideo CDN link (direct file), use direct?
    // Actually, usually yt-dlp is best even for CDN to handle throttling,
    // but DoulBrowser logic says "isTikTokCDN" -> yt-dlp.
    // For YouTube, generally yt-dlp is safest for everything.
    return 'yt-dlp'
  }
}
