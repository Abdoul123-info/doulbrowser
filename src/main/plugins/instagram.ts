import { Plugin } from './interface'

export const instagramPlugin: Plugin = {
  name: 'Instagram',

  // Match Instagram Post and Reel URLs (sent from extension checkPageUrl or user input)
  canHandle: (url: string) => {
    return (
      url.includes('instagram.com/p/') ||
      url.includes('instagram.com/reel/') ||
      url.includes('instagram.com/tv/')
    )
  },

  getStrategy: () => 'yt-dlp', // Force yt-dlp to handle extraction

  prepare: async (context) => {
    // Basic preparation - pass headers if needed, but yt-dlp usually handles authentication via cookies
    // defined in main index.ts logic
    return context
  }
}
