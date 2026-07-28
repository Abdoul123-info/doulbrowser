import { BrowserWindow } from 'electron'
import * as https from 'https'
import * as fs from 'fs'
import { URL } from 'url'
import { state } from './globals'
import { saveSettings } from './settings'
import { safeSend } from './utils'

// Public project configuration. Secrets now live in Supabase Edge Function env vars.
export const SUPABASE_URL = 'https://gqrwykhhqjimsgiqkgut.supabase.co'
export const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxcnd5a2hocWppbXNnaXFrZ3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNzAsImV4cCI6MjA4NzI4ODI3MH0.OVLEQdhYN6VHi5OQC_51EnDPoPPbnV0HuNHtchPy244'

type LicenseBackendResponse = {
  success?: boolean
  error?: string
  status?: 'FOUND' | 'NOT_FOUND' | 'BLOCKED' | 'EXPIRED'
  valid?: boolean
  key?: string
  // Renvoyee par `ping-license` quand le serveur reconnait la machine : elle permet
  // de restaurer une licence apres reinstallation sans redemander la cle au client.
  licenseKey?: string
  expiry?: string | null
  licenses?: any[]
  feedback?: any[]
  url?: string
  signedUrl?: string
  publicUrl?: string
  path?: string
  token?: string
}

/**
 * Calls the Supabase Edge Function that owns licence/admin secrets.
 */
export async function licenseBackendRequest(
  action: string,
  body: Record<string, unknown> = {}
): Promise<LicenseBackendResponse> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { success: false, error: 'Configuration Supabase manquante.' }
  }

  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/functions/v1/license-admin`)
    const payload = JSON.stringify({ action, ...body })
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 15000
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {}
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return resolve({
              success: false,
              error: parsed.error || `Erreur backend licence (${res.statusCode})`
            })
          }
          resolve(parsed)
        } catch {
          resolve({ success: false, error: 'Réponse backend licence invalide.' })
        }
      })
    })

    req.on('error', (err) => resolve({ success: false, error: `Erreur réseau: ${err.message}` }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: 'Timeout backend licence.' })
    })
    req.write(payload)
    req.end()
  })
}

/**
 * Minimal REST client kept for public/non-sensitive reads such as update checks.
 */
export async function supabaseRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null

  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { Prefer: 'return=minimal' } : {})
      },
      timeout: 10000
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`[Supabase Error] ${method} ${path} -> Status ${res.statusCode}`)
          return resolve(null)
        }

        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * [v2.4.9] Comme supabaseRequest mais expose le STATUT HTTP au lieu de tout écraser
 * en `null`. Indispensable pour distinguer un 409 (doublon — ex. contrainte unique
 * `feedback_hwid_unique`) d'une vraie panne réseau. ⚠ La RLS de `feedback` interdit
 * la lecture (SELECT) au rôle anon : impossible de détecter un doublon par un GET
 * préalable (il renvoie toujours 0 ligne) — seul le code du POST fait foi.
 * `status: 0` = pas de réponse (réseau coupé, timeout, config manquante).
 */
export async function supabaseRequestRaw(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: any
): Promise<{ status: number; data: any }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { status: 0, data: null }

  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { Prefer: 'return=minimal' } : {})
      },
      timeout: 10000
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        let parsed: any = null
        try { parsed = data ? JSON.parse(data) : null } catch { parsed = null }
        resolve({ status: res.statusCode || 0, data: parsed })
      })
    })

    req.on('error', () => resolve({ status: 0, data: null }))
    // L'option `timeout` émet l'événement mais N'ABORTE PAS la requête seule :
    // sans ce handler, un réseau qui traîne resterait bloqué (bug de supabaseRequest).
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }) })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

export async function uploadFileToSignedUrl(
  localPath: string,
  signedUrl: string,
  publicUrl: string,
  uploadToken?: string,
  // [v2.4.2] Callback de progression: (octets envoyés, taille totale, terminé=confirmé serveur)
  onProgress?: (uploaded: number, total: number, done?: boolean) => void
): Promise<{ success: boolean; url?: string; error?: string; code?: number }> {
  if (!signedUrl) return { success: false, error: 'URL upload signée manquante.' }

  try {
    // [v2.4.2] On streame le fichier au lieu de tout charger en RAM (setup ~186 Mo)
    const totalSize = fs.statSync(localPath).size
    // [v2.4.1] Les URLs signées relatives (storage-js v1) omettent /storage/v1
    let normalizedUrl = signedUrl
    if (!normalizedUrl.startsWith('http')) {
      const rel = normalizedUrl.startsWith('/') ? normalizedUrl : `/${normalizedUrl}`
      normalizedUrl = rel.includes('/storage/v1/')
        ? `${SUPABASE_URL}${rel}`
        : `${SUPABASE_URL}/storage/v1${rel}`
    }
    const url = new URL(normalizedUrl)
    // [v2.4.1] Secours: si le jeton d'upload n'est pas déjà dans l'URL, l'ajouter
    if (uploadToken && !url.searchParams.get('token')) {
      url.searchParams.set('token', uploadToken)
    }

    const attemptUpload = (
      method: 'PUT' | 'POST'
    ): Promise<{ success: boolean; url?: string; error?: string; code?: number }> =>
      new Promise((resolve) => {
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          // [v2.4.1] FIX 400 "headers must have required property 'authorization'":
          // l'API Storage exige apikey + Authorization même pour un upload signé
          // (le jeton de l'URL autorise l'écriture; ces en-têtes passent le middleware).
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': totalSize
        }
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            // [v2.4.2] 100% réservé à la confirmation serveur (done=true)
            if (onProgress) onProgress(totalSize, totalSize, true)
            resolve({ success: true, url: publicUrl })
          } else {
            resolve({
              success: false,
              error: `Erreur upload signé ${res.statusCode}: ${data.substring(0, 100)}`,
              code: res.statusCode
            })
          }
        })
      })

      req.on('error', (e) => resolve({ success: false, error: `Erreur réseau: ${e.message}` }))
      // [v2.4.2] Connexion morte: on coupe après 90 s sans activité socket
      // (l'erreur remonte via req.on('error') -> plus de barre figée sans fin)
      req.setTimeout(90000, () => req.destroy(new Error('aucune activité réseau depuis 90 s')))

      // [v2.4.2] Envoi manuel chunk par chunk: un octet n'est compté qu'une fois
      // vidé vers le réseau (callback de write). Avant, pipe() comptait la LECTURE
      // DISQUE (~177 Mo/s affichés): tout le fichier partait en RAM et la barre
      // montrait 99% pendant que le vrai envoi rampait en arrière-plan.
      let flushed = 0
      const fileStream = fs.createReadStream(localPath, { highWaterMark: 256 * 1024 })
      fileStream.on('data', (chunk) => {
        const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        const ok = req.write(chunk, () => {
          flushed += size
          if (onProgress) onProgress(flushed, totalSize, false)
        })
        if (!ok) {
          fileStream.pause()
          req.once('drain', () => fileStream.resume())
        }
      })
      fileStream.on('end', () => req.end())
      fileStream.on('error', (e) => {
        req.destroy()
        resolve({ success: false, error: `Erreur lecture fichier: ${e.message}` })
      })
    })

    // [v2.4.2] On envoie le corps UNE seule fois: la méthode acceptée d'abord.
    // Symptôme observé: PUT renvoyait 405 (méthode refusée) puis POST réussissait,
    // d'où un double upload de 186 Mo. On tente donc POST en premier; si jamais ce
    // backend exige PUT (400/405), on bascule en secours. Une seule des deux
    // téléverse réellement le corps qui réussit.
    const firstResult = await attemptUpload('POST')
    if (firstResult.success || (firstResult.code !== 400 && firstResult.code !== 405)) {
      return firstResult
    }

    return await attemptUpload('PUT')
  } catch (e: any) {
    return { success: false, error: `Erreur fichier local: ${e.message}` }
  }
}

export async function updateLicenseOnline(
  machineId: string,
  data: { last_seen?: string },
  _allowInsert = false
): Promise<boolean> {
  const result = await licenseBackendRequest('ping-license', {
    machineId,
    lastSeen: data.last_seen || new Date().toISOString()
  })
  return !!result.success
}

export function startLicenseHeartbeat(machineId: string) {
  setInterval(async () => {
    if (!state.appSettings.isActivated) return

    const cloud = await licenseBackendRequest('ping-license', { machineId })

    if (cloud.status === 'NOT_FOUND' || cloud.status === 'BLOCKED' || cloud.status === 'EXPIRED') {
      state.appSettings.isActivated = false
      state.appSettings.licenseKey = ''
      state.appSettings.expiryDate = null
      saveSettings({ isActivated: false, licenseKey: '', expiryDate: null })

      const reason =
        cloud.status === 'NOT_FOUND'
          ? "Votre licence a été supprimée par l'administrateur."
          : cloud.status === 'EXPIRED'
            ? 'Votre licence a expiré.'
            : 'Votre machine a été bloquée à distance.'

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) safeSend(win, 'license-deactivated', reason)
      })
    }
  }, 3600000)
}
