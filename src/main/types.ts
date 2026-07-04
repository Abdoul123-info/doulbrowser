import type { DownloadItem, BrowserWindow } from 'electron'

export interface DownloadRange {
  start: number
  end: number
  downloaded: number // Bytes downloaded in THIS range
  active?: boolean   // If a worker is currently processing this range
}

export interface DownloadTracker {
  item: DownloadItem | null
  url: string
  originalUrl?: string
  startTime: number
  lastBytes: number
  lastTime: number
  savePath?: string
  isYouTube?: boolean
  headers?: Record<string, string> // Store headers
  process?: any
  cancelled?: boolean
  paused?: boolean
  // [v2.4.0] Marks a download that exhausted its retries and failed permanently.
  // Such downloads are NOT auto-resumed on app restart (they'd only loop in failure);
  // they stay visible so the user can retry manually. Cleared on manual resume.
  failedPermanent?: boolean
  lastProgress?: number // Store last known progress percentage
  httpRequests?: Array<{ destroy: () => void }> // Store HTTP requests to cancel them
  priority?: number // Higher number = higher priority
  retryCount?: number // Number of retry attempts
  maxRetries?: number // Maximum retry attempts
  audioOnly: boolean // Core property for identification
  filename?: string // Explicit filename if provided
  strategy?: 'yt-dlp' | 'direct' | 'electron'
  logs?: string[] // Technical logs for debugging
  speed?: any
  timeLeft?: string
  lastSpeed?: number
  segmentProgress?: number[] // Progress for each thread in multi-threaded downloads
  statusMessage?: string // Informative message for post-processing feedback (merging, etc.)
  lastProgressSent?: number // Timestamp of last progress event sent
  totalBytes?: number // Total file size for resume capability
  videoSize?: number // Part of cumulative size fix
  audioSize?: number // Part of cumulative size fix
  numThreads?: number // Consistent thread count for resume
  segmentDownloaded?: number[] // Actual bytes per segment for resume
  ranges?: DownloadRange[] // Detailed range map for dynamic slicing
}

export interface QueuedDownload {
  url: string
  savePath?: string
  filename?: string
  type?: string
  mimeType?: string
  headers?: Record<string, string> // Store headers
  priority: number
  retryCount: number
  maxRetries: number
  mainWindow: BrowserWindow
  audioOnly: boolean // Required for composite uniqueness
}

export interface AppSettings {
  downloadPath: string
  // Dossier dédié aux fichiers audio (vide = utilise downloadPath comme les vidéos)
  audioPath: string
  maxConcurrentDownloads: number
  maxRetries: number
  autoStart: boolean
  notifications: boolean
  soundNotifications: boolean
  language: string
  // Licensing fields
  licenseKey: string
  isActivated: boolean
  machineId: string
  expiryDate: string | null
  // Anti-fraud fields
  lastOpenedDate: string | null
}
