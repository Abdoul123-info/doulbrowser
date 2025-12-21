
export interface DownloadContext {
    url: string;
    headers?: Record<string, string>;
    savePath: string;
}

export type DownloadStrategy = 'yt-dlp' | 'direct' | 'browser-extension';

export interface Plugin {
    name: string;

    /**
     * Determines if this plugin can handle the given URL
     */
    canHandle(url: string): boolean;

    /**
     * Returns the preferred download strategy for this URL
     */
    getStrategy(url: string): DownloadStrategy;

    /**
     * Optional: Modifies headers or URL before download starts
     * Useful for TikTok/Instagram signed URLs
     */
    prepare?(context: DownloadContext): Promise<DownloadContext>;
}
