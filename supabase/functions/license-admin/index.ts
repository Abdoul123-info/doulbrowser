import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import CryptoJS from "https://esm.sh/crypto-js@4.1.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("APP_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("APP_SERVICE_KEY") || ""
const LICENSE_SALT = Deno.env.get("LICENSE_SALT") || ""
const ADMIN_PASSWORD_HASH = Deno.env.get("ADMIN_PASSWORD_HASH") || ""
const MASTER_LICENSE_KEY = (Deno.env.get("MASTER_LICENSE_KEY") || "").trim().toUpperCase()

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

function assertConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LICENSE_SALT || !ADMIN_PASSWORD_HASH) {
    throw new Error("Configuration backend licence incomplète.")
  }
}

function md5(value: string): string {
  return CryptoJS.MD5(value).toString().toUpperCase()
}

function sha256(value: string): string {
  return CryptoJS.SHA256(value).toString().toUpperCase()
}

function checkAdminPassword(password: string): boolean {
  if (!password) return false
  return md5(password) === ADMIN_PASSWORD_HASH.toUpperCase()
}

function signLicense(machineId: string, expiryDate: string): string {
  const cleanMid = machineId.trim().toUpperCase()
  const payload = `${cleanMid}:${expiryDate}:${LICENSE_SALT}`
  const hash = md5(payload).substring(0, 16)
  return `${cleanMid}#${expiryDate}#${hash}`
}

function computeExpiry(durationDays: string | number): string {
  if (durationDays === "permanent") {
    return new Date("2099-12-31T00:00:00.000Z").toISOString()
  }

  if (typeof durationDays === "string" && durationDays.startsWith("date:")) {
    const expiry = new Date(durationDays.slice("date:".length))
    if (Number.isNaN(expiry.getTime())) throw new Error("Date d'expiration invalide.")
    return expiry.toISOString()
  }

  const days = Number.parseInt(String(durationDays), 10)
  if (!Number.isFinite(days) || days <= 0) throw new Error("Durée invalide.")
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function verifyLicense(key: string, machineId: string): { valid: boolean; expiry: string | null } {
  if (!key) return { valid: false, expiry: null }

  const cleanKey = key.trim().toUpperCase()

  if (MASTER_LICENSE_KEY && cleanKey === MASTER_LICENSE_KEY) {
    return { valid: true, expiry: "2099-12-31T00:00:00.000Z" }
  }

  if (cleanKey.includes("#")) {
    const parts = cleanKey.split("#")

    if (parts.length === 4 && parts[0].length === 16) {
      const [raw16, hwid, expiry, hash] = parts
      const expectedHash = md5(raw16 + hwid + expiry + LICENSE_SALT)
      const expiryDate = new Date(expiry)
      if (hash === expectedHash && hwid === machineId && !Number.isNaN(expiryDate.getTime()) && new Date() <= expiryDate) {
        return { valid: true, expiry }
      }
      return { valid: false, expiry: null }
    }

    if (parts.length === 3) {
      const [id, expiry, hash] = parts
      const expectedHash = md5(`${id}:${expiry}:${LICENSE_SALT}`).substring(0, 16)
      const expiryDate = new Date(expiry)
      if (hash === expectedHash && (id === machineId || id.startsWith("B-")) && !Number.isNaN(expiryDate.getTime()) && new Date() <= expiryDate) {
        return { valid: true, expiry }
      }
    }
    return { valid: false, expiry: null }
  }

  const rawKey = cleanKey.replace(/-/g, "")
  if (rawKey.length === 16) {
    const durationHex = rawKey.substring(0, 4)
    const saltHex = rawKey.substring(4, 8)
    const hashHex = rawKey.substring(8, 16)
    const expectedHash = sha256(`${durationHex}${saltHex}${LICENSE_SALT}`).substring(0, 8)

    if (hashHex === expectedHash) {
      const durationDays = Number.parseInt(durationHex, 16)
      const expiry =
        durationDays >= 9999
          ? new Date("2099-12-31T00:00:00.000Z")
          : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      return { valid: true, expiry: expiry.toISOString() }
    }
  }

  return { valid: false, expiry: null }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ success: false, error: "Méthode non autorisée." }, 405)

  try {
    assertConfigured()
    const body = await req.json()
    const action = String(body.action || "")
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    if (action === "verify-admin-password") {
      return json({ success: true, valid: checkAdminPassword(String(body.password || "")) })
    }

    if (action === "activate-license") {
      const machineId = String(body.machineId || "").trim().toUpperCase()
      const key = String(body.key || "").trim()
      let verification = verifyLicense(key, machineId)

      // Fallback base de données : si la vérification cryptographique échoue,
      // on accepte tout de même une clé qui existe déjà comme enregistrement
      // actif dans la table `licences` (ex. clé insérée/importée manuellement).
      if (!verification.valid) {
        const { data: dbLicense } = await supabase
          .from("licences")
          .select("expiry_date,is_blocked,status")
          .eq("license_key", key.toUpperCase())
          .maybeSingle()

        if (dbLicense && !dbLicense.is_blocked && dbLicense.status !== "blocked") {
          const expiryDate = dbLicense.expiry_date ? new Date(dbLicense.expiry_date) : null
          const notExpired = !expiryDate || (!Number.isNaN(expiryDate.getTime()) && new Date() <= expiryDate)
          if (notExpired) {
            verification = { valid: true, expiry: dbLicense.expiry_date }
          }
        }
      }

      if (!machineId || !verification.valid || !verification.expiry) {
        return json({ success: false, error: "Clé invalide ou expirée." })
      }

      const finalKey =
        key.toUpperCase().startsWith("B-") || (MASTER_LICENSE_KEY && key.trim().toUpperCase() === MASTER_LICENSE_KEY)
          ? signLicense(machineId, verification.expiry)
          : key

      // Nettoyage anti-doublon : les clés `B-` (vente auto ou génération en masse)
      // sont provisoirement enregistrées avec hwid = préfixe "B-XXXX". À
      // l'activation, on relie la licence au vrai HWID, donc on supprime la ligne
      // provisoire pour éviter d'accumuler des doublons orphelins dans la table.
      const provisionalId = key.trim().toUpperCase().split("#")[0]
      if (provisionalId.startsWith("B-") && provisionalId !== machineId) {
        await supabase.from("licences").delete().eq("hwid", provisionalId)
      }

      const { error } = await supabase.from("licences").upsert({
        hwid: machineId,
        license_key: finalKey,
        expiry_date: verification.expiry,
        activated_at: new Date().toISOString(),
        original_key: key,
        is_blocked: false,
        status: "active"
      })

      if (error) throw error
      return json({ success: true, key: finalKey, expiry: verification.expiry })
    }

    if (action === "ping-license") {
      const machineId = String(body.machineId || "").trim().toUpperCase()
      const lastSeen = body.lastSeen || new Date().toISOString()
      const { data, error } = await supabase.from("licences").select("is_blocked,expiry_date").eq("hwid", machineId).maybeSingle()
      if (error) throw error
      if (!data) return json({ success: false, status: "NOT_FOUND" })
      if (data.is_blocked) return json({ success: false, status: "BLOCKED" })
      if (data.expiry_date && new Date(data.expiry_date) < new Date()) return json({ success: false, status: "EXPIRED" })

      await supabase.from("licences").update({ last_seen: lastSeen }).eq("hwid", machineId)
      return json({ success: true, status: "FOUND" })
    }

    const adminActions = new Set([
      "admin-generate-key",
      "admin-bulk-generate",
      "admin-get-all-licenses",
      "admin-update-license-status",
      "admin-delete-license-cloud",
      "admin-set-latest-version",
      "admin-create-update-upload",
      "admin-get-feedback"
    ])

    if (adminActions.has(action) && !checkAdminPassword(String(body.password || ""))) {
      return json({ success: false, error: "Mot de passe admin incorrect." }, 401)
    }

    if (action === "admin-generate-key") {
      const machineId = String(body.machineId || "").trim().toUpperCase()
      const expiry = computeExpiry(body.durationDays)

      // HWID optionnel : sans machineId, on génère une clé universelle "B-XXXX"
      // (utilisable sur n'importe quelle machine, verrouillée au 1er usage lors
      // de l'activation), comme le fait le générateur en masse.
      if (!machineId) {
        const bytes = crypto.getRandomValues(new Uint8Array(4))
        const id = "B-" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
        return json({ success: true, key: signLicense(id, expiry), expiry })
      }

      return json({ success: true, key: signLicense(machineId, expiry), expiry })
    }

    if (action === "admin-bulk-generate") {
      const count = Math.min(Math.max(Number.parseInt(String(body.count || 1), 10), 1), 500)
      const expiry = computeExpiry(body.durationDays)
      const keys = Array.from({ length: count }, () => {
        const bytes = crypto.getRandomValues(new Uint8Array(4))
        const id = "B-" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
        return signLicense(id, expiry)
      })
      return json({ success: true, keys, expiry })
    }

    if (action === "admin-get-all-licenses") {
      const { data, error } = await supabase.from("licences").select("*").order("activated_at", { ascending: false })
      if (error) throw error
      return json({ success: true, licenses: data || [] })
    }

    if (action === "admin-update-license-status") {
      const targetMid = String(body.targetMid || "").trim().toUpperCase()
      const { error } = await supabase.from("licences").update({ is_blocked: !!body.isBlocked }).eq("hwid", targetMid)
      if (error) throw error
      return json({ success: true })
    }

    if (action === "admin-delete-license-cloud") {
      const targetMid = String(body.targetMid || "").trim().toUpperCase()
      const { error } = await supabase.from("licences").delete().eq("hwid", targetMid)
      if (error) throw error
      return json({ success: true })
    }

    if (action === "admin-set-latest-version") {
      if (body.newVersion) {
        await supabase.from("app_config").upsert({ key: "latest_version", value: String(body.newVersion) })
      }
      if (body.downloadUrl) {
        await supabase.from("app_config").upsert({ key: "update_url", value: String(body.downloadUrl) })
      }
      if (body.updateHash) {
        await supabase.from("app_config").upsert({ key: "update_hash", value: String(body.updateHash).toLowerCase() })
      }
      if (body.extensionVersion) {
        await supabase.from("app_config").upsert({ key: "extension_version", value: String(body.extensionVersion) })
      }
      if (body.extensionUrl) {
        await supabase.from("app_config").upsert({ key: "extension_url", value: String(body.extensionUrl) })
      }
      if (body.extensionHash) {
        await supabase.from("app_config").upsert({ key: "extension_hash", value: String(body.extensionHash).toLowerCase() })
      }
      return json({ success: true })
    }

    if (action === "admin-create-update-upload") {
      const type = String(body.type || "")
      if (type !== "setup" && type !== "extension") {
        return json({ success: false, error: "Type de fichier invalide." }, 400)
      }

      const extension = type === "setup" ? "exe" : "zip"
      const baseName = type === "setup" ? "DoulGet_Setup" : "DoulGet_Extension"
      const remotePath = `${baseName}_${Date.now()}.${extension}`
      const { data, error } = await supabase.storage.from("updates").createSignedUploadUrl(remotePath)

      if (error) throw error

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/updates/${remotePath}`
      return json({
        success: true,
        signedUrl: data.signedUrl,
        path: data.path,
        token: data.token,
        publicUrl
      })
    }

    if (action === "admin-get-feedback") {
      const { data, error } = await supabase.from("feedback").select("*").order("created_at", { ascending: false })
      if (error) throw error
      return json({ success: true, feedback: data || [] })
    }

    return json({ success: false, error: "Action inconnue." }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur backend licence."
    console.error("[license-admin]", message)
    return json({ success: false, error: message }, 400)
  }
})
