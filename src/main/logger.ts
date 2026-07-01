import { app, shell } from 'electron'
import { existsSync, mkdirSync, statSync, renameSync, appendFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { inspect } from 'util'

// ── FIX: Force UTF-8 encoding on Windows stdout/stderr to avoid emoji corruption ──
if (process.stdout && 'setEncoding' in process.stdout) {
  (process.stdout as NodeJS.WriteStream).setEncoding?.('utf8')
}
if (process.stderr && 'setEncoding' in process.stderr) {
  (process.stderr as NodeJS.WriteStream).setEncoding?.('utf8')
}

const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_RECENT_LINES = 1200

let initialized = false
let logFilePath = ''
let isWriting = false

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

const originalConsole: Record<ConsoleMethod, (...args: any[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
}

function timestamp(): string {
  return new Date().toISOString()
}

export function redactSensitive(value: string): string {
  return value
    .replace(/([?&](?:sign|signature|token|access_token|refresh_token|apikey|key|password|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:password|secret|token|apikey|authorization)\s*[:=]\s*)["']?[^"',\s}]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
}

function formatArg(arg: any): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
  }

  if (typeof arg === 'string') return arg

  return inspect(arg, {
    depth: 5,
    breakLength: 160,
    maxArrayLength: 80,
    maxStringLength: 2000
  })
}

function rotateIfNeeded(): void {
  if (!logFilePath || !existsSync(logFilePath)) return

  try {
    if (statSync(logFilePath).size < MAX_LOG_BYTES) return

    const rotatedPath = `${logFilePath}.1`
    if (existsSync(rotatedPath)) {
      renameSync(rotatedPath, `${rotatedPath}.old`)
    }
    renameSync(logFilePath, rotatedPath)
  } catch (error) {
    originalConsole.warn('[Logger] Failed to rotate log file:', error)
  }
}

function writeLine(level: ConsoleMethod, args: any[]): void {
  if (!logFilePath || isWriting) return

  try {
    isWriting = true
    rotateIfNeeded()
    const message = redactSensitive(args.map(formatArg).join(' '))
    appendFileSync(logFilePath, `[${timestamp()}] [${level.toUpperCase()}] ${message}\n`, 'utf8')
  } catch (error) {
    originalConsole.warn('[Logger] Failed to write log file:', error)
  } finally {
    isWriting = false
  }
}

export function initializeFileLogger(): string {
  if (initialized) return logFilePath

  const logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  logFilePath = join(logDir, 'main.log')

  ;(['log', 'info', 'warn', 'error', 'debug'] as ConsoleMethod[]).forEach((level) => {
    console[level] = (...args: any[]) => {
      originalConsole[level](...args)
      writeLine(level, args)
    }
  })

  process.on('uncaughtException', (error) => {
    const msg = error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error)
    writeLine('error', [`[Process] uncaughtException → ${msg}`])
    originalConsole.error('[FATAL] uncaughtException:', error)
  })

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error
      ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
      : String(reason)
    writeLine('error', [`[Process] unhandledRejection → ${msg}`])
    originalConsole.error('[FATAL] unhandledRejection:', reason)
  })

  initialized = true
  console.info('[Logger] File logger initialized:', logFilePath)
  return logFilePath
}

export function getMainLogFilePath(): string {
  return logFilePath || join(app.getPath('userData'), 'logs', 'main.log')
}

export function readRecentMainLogLines(maxLines = MAX_RECENT_LINES): string[] {
  const path = getMainLogFilePath()
  if (!existsSync(path)) return []

  const content = readFileSync(path, 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  return lines.slice(-Math.max(1, maxLines))
}

export async function openMainLogFolder(): Promise<void> {
  const path = getMainLogFilePath()
  await shell.showItemInFolder(path)
}
