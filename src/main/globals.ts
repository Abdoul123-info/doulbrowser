import type { AppSettings, DownloadTracker, QueuedDownload } from './types'

export const RECENTLY_COMPLETED_TTL = 60000 // 60 seconds

export interface GlobalState {
  appSettings: AppSettings
  activeDownloads: Map<string, DownloadTracker>
  downloadQueue: QueuedDownload[]
  recentlyCompletedDownloads: Map<string, { timestamp: number }>
  isAppQuitting: boolean
  cachedFfmpegPath: string | null | undefined
  cachedNodeDir: string | null | undefined
  cachedAria2Path: string | null | undefined
  extensionServer: any
}

export const state: GlobalState = {
  appSettings: {
    downloadPath: '',
    audioPath: '',
    maxConcurrentDownloads: 3,
    maxRetries: 3,
    autoStart: false,
    notifications: true,
    soundNotifications: false,
    language: 'fr',
    licenseKey: '',
    isActivated: false,
    machineId: '',
    expiryDate: null,
    lastOpenedDate: null
  },
  activeDownloads: new Map<string, DownloadTracker>(),
  downloadQueue: [],
  recentlyCompletedDownloads: new Map<string, { timestamp: number }>(),
  isAppQuitting: false,
  cachedFfmpegPath: undefined,
  cachedNodeDir: undefined,
  cachedAria2Path: undefined,
  extensionServer: null
}
