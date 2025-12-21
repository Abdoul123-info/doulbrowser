import { Plugin } from './interface';

export const tube8Plugin: Plugin = {
    name: 'Tube8',

    canHandle: (url: string) => {
        // Match Tube8 CDN URLs or page URLs
        return url.includes('tube8.com') || url.includes('t8cdn.com');
    },

    getStrategy: (url: string) => {
        // If it's a CDN URL, use direct download
        if (url.includes('t8cdn.com')) {
            return 'direct';
        }
        // Page URLs don't work well with yt-dlp (missing slug)
        return 'yt-dlp';
    },

    prepare: async (context) => {
        const url = context.url;

        // If it's an HLS quality folder (ends with /720, /1080, etc.)
        if (url.includes('t8cdn.com/hls/') && url.match(/\/\d+p?$/)) {
            // Try to find the master.m3u8 file
            // Common patterns: /master.m3u8, /index.m3u8, /playlist.m3u8
            const possibleUrls = [
                `${url}/master.m3u8`,
                `${url}/index.m3u8`,
                `${url}/playlist.m3u8`,
                `${url.replace(/\/\d+p?$/, '')}/master.m3u8`
            ];

            console.log('[Tube8 Plugin] HLS quality folder detected, trying variants:', possibleUrls);

            // For now, use the first one (master.m3u8)
            context.url = possibleUrls[0];
            console.log('[Tube8 Plugin] Using URL:', context.url);
        }

        return context;
    }
};
