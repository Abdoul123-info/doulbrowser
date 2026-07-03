import { Plugin, DownloadStrategy, DownloadContext } from './interface'

export class TikTokPlugin implements Plugin {
  name = 'TikTok'

  canHandle(url: string): boolean {
    const lowerUrl = url.toLowerCase()
    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname.toLowerCase()

      return (
        hostname.includes('tiktok.com') ||
        hostname.includes('tiktokcdn') ||
        hostname.includes('ttwstatic') ||
        lowerUrl.includes('tiktok') // generic fallback
      )
    } catch {
      return false
    }
  }

  getStrategy(url: string): DownloadStrategy {
    // yt-dlp ne peut plus extraire les PAGES TikTok (blocage anti-bot côté serveur :
    // "Unable to extract webpage video data"). Le seul chemin fiable est l'URL CDN
    // signée capturée par l'extension, téléchargée en DIRECT avec les en-têtes du
    // navigateur (Cookie/Referer/UA) — exactement comme le lecteur web.
    //
    //  - URL de page (www.tiktok.com/@x/video/id, /foryou, liens courts) -> yt-dlp
    //    (tentative d'extraction ; utile hors feed si le blocage ne s'applique pas).
    //  - URL CDN/media (v16-webapp-prime.tiktok.com/video/tos/..., *.tiktokcdn*) -> direct.
    try {
      const u = new URL(url)
      const host = u.hostname.toLowerCase()
      const isMainSiteHost = /(^|\.)tiktok\.com$/.test(host)
      const isMediaPath = /\/(obj|aweme|tos)\//.test(u.pathname.toLowerCase())
      // Page = domaine principal du site (y compris liens courts vm/vt/t) ET chemin non-media.
      if (isMainSiteHost && !isMediaPath) return 'yt-dlp'
      // Tout le reste (sous-domaines CDN, tiktokcdn, chemins media) = fichier direct.
      return 'direct'
    } catch {
      return 'yt-dlp'
    }
  }

  async prepare(context: DownloadContext): Promise<DownloadContext> {
    // Garantir un Referer TikTok sur les URLs CDN/media signées (certains CDN
    // renvoient 403 sans Referer). L'extension en fournit un en général, mais on
    // assure un repli. Couvre webapp-prime, tiktokcdn et les chemins /video/tos/.
    const isMedia = /tiktokcdn|webapp-prime|\/video\/tos\//.test(context.url)
    const hasReferer = !!(context.headers?.['Referer'] || context.headers?.['referer'])
    if (isMedia && !hasReferer) {
      return { ...context, headers: { ...context.headers, Referer: 'https://www.tiktok.com/' } }
    }
    return context
  }
}
