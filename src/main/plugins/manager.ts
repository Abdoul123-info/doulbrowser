import { Plugin } from './interface'
import { TikTokPlugin } from './tiktok'
import { YouTubePlugin } from './youtube'
import { instagramPlugin } from './instagram'

export class PluginManager {
  private plugins: Plugin[] = []

  constructor() {
    this.registerPlugin(new TikTokPlugin())
    this.registerPlugin(new YouTubePlugin())
    this.registerPlugin(instagramPlugin)
  }

  registerPlugin(plugin: Plugin): void {
    this.plugins.push(plugin)
    console.log(`[PluginManager] Registered: ${plugin.name}`)
  }

  getPlugin(url: string): Plugin | null {
    return this.plugins.find((p) => p.canHandle(url)) || null
  }
}

export const pluginManager = new PluginManager()
