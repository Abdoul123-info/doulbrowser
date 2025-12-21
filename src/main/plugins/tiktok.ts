import { Plugin, DownloadStrategy, DownloadContext } from './interface';

export class TikTokPlugin implements Plugin {
    name = 'TikTok';

    canHandle(url: string): boolean {
        const lowerUrl = url.toLowerCase();
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            return (
                hostname.includes('tiktok.com') ||
                hostname.includes('tiktokcdn') ||
                hostname.includes('ttwstatic') ||
                lowerUrl.includes('tiktok') // generic fallback
            );
        } catch {
            return false;
        }
    }

    getStrategy(_url: string): DownloadStrategy {
        // For TikTok, we ALWAYS prefer yt-dlp because:
        // 1. Page URLs need extraction
        // 2. CDN URLs need special headers (referer/cookies) which yt-dlp handles nicely if passed,
        //    OR yt-dlp can just download the raw file if headers are provided.
        // In DoulBrowser v2 logic: "TikTok CDN always goes to yt-dlp"
        return 'yt-dlp';
    }

    async prepare(context: DownloadContext): Promise<DownloadContext> {
        // We can ensure headers are present if needed, 
        // or log specific TikTok debug info
        if (context.url.includes('tiktokcdn') && !context.headers?.['Referer']) {
            // Add a fake referer if missing, though typically the extension provides it
            const newHeaders = { ...context.headers, 'Referer': 'https://www.tiktok.com/' };
            return { ...context, headers: newHeaders };
        }
        return context;
    }
}
