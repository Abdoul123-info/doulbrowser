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

// `reason` sert uniquement à afficher au client un message qui l'aide, au lieu du
// fourre-tout « Clé invalide ou expirée » : OTHER_DEVICE, EXPIRED, BLOCKED, INVALID.
type Verification = { valid: boolean; expiry: string | null; reason?: string }

function verifyLicense(key: string, machineId: string): Verification {
  if (!key) return { valid: false, expiry: null, reason: "INVALID" }

  const cleanKey = key.trim().toUpperCase()

  if (MASTER_LICENSE_KEY && cleanKey === MASTER_LICENSE_KEY) {
    return { valid: true, expiry: "2099-12-31T00:00:00.000Z" }
  }

  if (cleanKey.includes("#")) {
    const parts = cleanKey.split("#")

    if (parts.length === 4 && parts[0].length === 16) {
      const [raw16, hwid, expiry, hash] = parts
      const expectedHash = md5(raw16 + hwid + expiry + LICENSE_SALT)
      if (hash !== expectedHash) return { valid: false, expiry: null, reason: "INVALID" }
      if (hwid !== machineId) return { valid: false, expiry: null, reason: "OTHER_DEVICE" }
      const expiryDate = new Date(expiry)
      if (Number.isNaN(expiryDate.getTime())) return { valid: false, expiry: null, reason: "INVALID" }
      if (new Date() > expiryDate) return { valid: false, expiry: null, reason: "EXPIRED" }
      return { valid: true, expiry }
    }

    if (parts.length === 3) {
      const [id, expiry, hash] = parts
      const expectedHash = md5(`${id}:${expiry}:${LICENSE_SALT}`).substring(0, 16)
      if (hash !== expectedHash) return { valid: false, expiry: null, reason: "INVALID" }
      if (id !== machineId && !id.startsWith("B-")) return { valid: false, expiry: null, reason: "OTHER_DEVICE" }
      const expiryDate = new Date(expiry)
      if (Number.isNaN(expiryDate.getTime())) return { valid: false, expiry: null, reason: "INVALID" }
      if (new Date() > expiryDate) return { valid: false, expiry: null, reason: "EXPIRED" }
      return { valid: true, expiry }
    }

    return { valid: false, expiry: null, reason: "INVALID" }
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

  return { valid: false, expiry: null, reason: "INVALID" }
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

      // Repli base de données : si la vérification cryptographique échoue, on
      // accepte une clé déjà enregistrée dans `licences` (ex. clé insérée ou
      // importée manuellement) — MAIS jamais pour un autre appareil.
      //
      // Ce repli cherchait la clé sans regarder le hwid : dès qu'un client
      // activait la sienne, elle existait en base et le repli la validait pour
      // n'importe quelle machine. On n'accepte donc que la ligne appartenant DÉJÀ
      // à cette machine (ré-activation après réinstallation) ou une ligne
      // provisoire "B-" pas encore reliée à un appareil.
      if (!verification.valid) {
        const { data: dbRows } = await supabase
          .from("licences")
          .select("hwid,expiry_date,is_blocked,status")
          .eq("license_key", key.toUpperCase())

        const dbLicense = (dbRows || []).find(
          (r) => String(r.hwid || "").toUpperCase() === machineId || String(r.hwid || "").startsWith("B-")
        )

        if (dbLicense) {
          const expiryDate = dbLicense.expiry_date ? new Date(dbLicense.expiry_date) : null
          const notExpired = !expiryDate || (!Number.isNaN(expiryDate.getTime()) && new Date() <= expiryDate)
          if (dbLicense.is_blocked || dbLicense.status === "blocked") {
            verification = { valid: false, expiry: null, reason: "BLOCKED" }
          } else if (!notExpired) {
            verification = { valid: false, expiry: null, reason: "EXPIRED" }
          } else {
            verification = { valid: true, expiry: dbLicense.expiry_date }
          }
        } else if ((dbRows || []).length > 0) {
          // La clé existe bien, mais elle est rattachée à un autre appareil.
          verification = { valid: false, expiry: null, reason: "OTHER_DEVICE" }
        }
      }

      if (!machineId) {
        return json({ success: false, error: "Identifiant d'appareil introuvable. Redémarrez l'application." })
      }

      if (!verification.valid || !verification.expiry) {
        const messages: Record<string, string> = {
          OTHER_DEVICE:
            "Cette clé est déjà utilisée sur un autre appareil. Chaque clé n'active qu'un seul appareil.",
          EXPIRED: "Cette clé a expiré. Contactez le vendeur pour la renouveler.",
          BLOCKED: "Cette clé a été désactivée. Contactez le vendeur."
        }
        return json({
          success: false,
          error:
            messages[verification.reason || ""] ||
            "Clé invalide. Vérifiez que vous l'avez saisie correctement, sans espace."
        })
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

      // Verrou premier usage : une clé n'active qu'UNE machine, quel que soit son
      // format. Ce contrôle ne visait que les clés universelles "B-", ce qui
      // laissait les clés liées à un appareil sans aucun verrou : combiné au repli
      // base de données ci-dessus, une clé déjà activée pouvait l'être une
      // seconde fois sur un autre appareil. La machine d'origine peut réactiver
      // librement ; pour transférer la licence, l'admin supprime l'ancienne ligne.
      // La clé maître est volontairement universelle (dépannage admin) : elle seule
      // échappe au verrou, sinon elle cesserait de fonctionner dès la 2e machine.
      const isMaster = !!MASTER_LICENSE_KEY && key.trim().toUpperCase() === MASTER_LICENSE_KEY

      // Une clé qui CONTIENT l'identifiant de cette machine porte déjà son verrou
      // dans sa signature : inutile de la confronter à la base. Sans cette
      // exception, un client victime d'une clé volée ne pouvait plus réactiver la
      // sienne — la ligne du fraudeur déclenchait le verrou contre lui.
      // Positions de l'identifiant : 1re pour `HWID#expiry#hash`, 2e pour l'ancien
      // format `RAW16#HWID#expiry#hash`.
      const keyParts = key.trim().toUpperCase().split("#")
      const boundToThisMachine = keyParts[0] === machineId || keyParts[1] === machineId

      if (!isMaster && !boundToThisMachine) {
        const { data: used } = await supabase
          .from("licences")
          .select("hwid")
          .ilike("original_key", key)
          .neq("hwid", machineId)
          .limit(1)
        if (used && used.length > 0) {
          return json({
            success: false,
            error: "Cette clé est déjà utilisée sur un autre appareil. Chaque clé n'active qu'un seul appareil."
          })
        }
      }

      // onConflict obligatoire : la PK est `id` (auto), l'unicité machine est
      // portée par `hwid`. Sans lui, toute ré-activation (renouvellement après
      // expiration, réinstallation) violait la contrainte UNIQUE et échouait.
      const { error } = await supabase.from("licences").upsert(
        {
          hwid: machineId,
          license_key: finalKey,
          expiry_date: verification.expiry,
          activated_at: new Date().toISOString(),
          original_key: key,
          is_blocked: false,
          status: "active"
        },
        { onConflict: "hwid" }
      )

      if (error) throw error
      return json({ success: true, key: finalKey, expiry: verification.expiry })
    }

    if (action === "ping-license") {
      const machineId = String(body.machineId || "").trim().toUpperCase()
      if (!machineId) return json({ success: false, status: "NOT_FOUND" })
      const lastSeen = body.lastSeen || new Date().toISOString()
      const nowIso = new Date().toISOString()

      // Ancre d'essai : le serveur retient la date la PLUS ANCIENNE qu'il connaisse
      // pour cet appareil. Envoyer une date plus récente ne rapporte donc rien, et
      // une date plus ancienne ne fait que raccourcir son propre essai : une app
      // modifiée ne peut pas s'octroyer d'essai supplémentaire par ce canal.
      //
      // Jamais bloquant : si `devices` est indisponible, la vérification de licence
      // doit continuer à répondre. On renvoie alors la date du jour, et l'app
      // retombe sur sa date d'installation locale.
      let firstSeen = nowIso
      try {
        const li = String(body.localInstall || "").trim()
        const liMs = li ? new Date(li).getTime() : Number.NaN
        const candidate =
          !Number.isNaN(liMs) && liMs > 0 && liMs <= Date.now()
            ? new Date(liMs).toISOString()
            : nowIso

        await supabase.from("devices").upsert(
          { hwid: machineId, first_seen: candidate, last_seen: nowIso },
          { onConflict: "hwid", ignoreDuplicates: true }
        )

        const { data: dev } = await supabase
          .from("devices")
          .select("first_seen")
          .eq("hwid", machineId)
          .maybeSingle()

        firstSeen = dev?.first_seen || candidate

        if (dev && new Date(candidate) < new Date(dev.first_seen)) {
          await supabase.from("devices")
            .update({ first_seen: candidate, last_seen: nowIso })
            .eq("hwid", machineId)
          firstSeen = candidate
        } else if (dev) {
          await supabase.from("devices").update({ last_seen: nowIso }).eq("hwid", machineId)
        }
      } catch (_) {
        // table indisponible : on garde nowIso
      }

      const { data, error } = await supabase
        .from("licences")
        .select("is_blocked,expiry_date,license_key")
        .eq("hwid", machineId)
        .maybeSingle()
      if (error) throw error
      // `serverNow` : heure de référence. L'essai se calculait sur l'horloge du
      // téléphone, qu'il suffisait de reculer dans les réglages Android pour le
      // relancer indéfiniment. L'application retient désormais la date la plus
      // avancée qu'elle ait vue, et celle du serveur fait autorité.
      if (!data) return json({ success: false, status: "NOT_FOUND", firstSeen, serverNow: nowIso })
      if (data.is_blocked) return json({ success: false, status: "BLOCKED", firstSeen, serverNow: nowIso })
      if (data.expiry_date && new Date(data.expiry_date) < new Date()) {
        return json({ success: false, status: "EXPIRED", firstSeen, serverNow: nowIso })
      }

      await supabase.from("licences").update({ last_seen: lastSeen }).eq("hwid", machineId)
      return json({
        success: true,
        status: "FOUND",
        firstSeen,
        serverNow: nowIso,
        licenseKey: data.license_key,
        expiry: data.expiry_date
      })
    }

    const adminActions = new Set([
      "admin-generate-key",
      "admin-bulk-generate",
      "admin-get-all-licenses",
      "admin-update-license-status",
      "admin-delete-license-cloud",
      "admin-set-latest-version",
      "admin-create-update-upload",
      "admin-get-feedback",
      "admin-set-announce"
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
      // [v2.4.1] Nom FIXE écrasé à chaque publication: le stockage gratuit (500 Mo)
      // saturait car chaque upload créait un nouveau fichier horodaté de ~190 Mo.
      const remotePath = `${baseName}.${extension}`

      // Purge avant upload: l'ancien fichier au nom fixe (sinon l'URL signée est
      // refusée car l'objet existe) + les anciens fichiers horodatés hérités.
      try {
        const { data: files } = await supabase.storage.from("updates").list()
        const toRemove = (files || [])
          .map((f) => f.name)
          .filter((n) => n === remotePath || n.startsWith(`${baseName}_`))
        if (toRemove.length > 0) await supabase.storage.from("updates").remove(toRemove)
      } catch (_e) { /* nettoyage best-effort */ }

      const { data, error } = await supabase.storage.from("updates").createSignedUploadUrl(remotePath)

      if (error) throw error

      // [v2.4.1] ?v= anti-cache CDN: l'URL publique change à chaque publication
      // (le CDN ne doit pas servir l'ancien binaire sous la même URL), le fichier non.
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/updates/${remotePath}?v=${Date.now()}`
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

    // [v2.4.5] Annonce aux utilisateurs mobiles : stockée dans app_config (clé "announce",
    // JSON {id,title,body,url}). Les téléphones la lisent en anon et la notifient une fois
    // (dédupliquée par id). Titre+message vides = effacer l'annonce.
    if (action === "admin-set-announce") {
      const title = String(body.title || "").trim()
      const message = String(body.message || "").trim()
      const url = String(body.url || "").trim()

      // [v2.4.8] Ciblage par plateforme. Chaque plateforme lit SA PROPRE clé :
      //   - PC (AnnounceBanner)      → app_config.announce_pc
      //   - Android (NewsWorker)     → app_config.announce_android
      // Une annonce « PC » n'atterrit donc plus sur les téléphones et inversement.
      // 'all' écrit dans les deux clés. Défaut 'all' pour rétrocompatibilité.
      const target = String(body.target || "all").toLowerCase()
      const keys = target === "pc" ? ["announce_pc"]
        : target === "android" ? ["announce_android"]
        : ["announce_pc", "announce_android"]

      if (!title && !message) {
        // Effacement de la/les plateforme(s) ciblée(s).
        for (const key of keys) {
          const { error } = await supabase.from("app_config").upsert({ key, value: "" })
          if (error) throw error
        }
        return json({ success: true, cleared: true, target })
      }
      if (!title || !message) {
        return json({ success: false, error: "Titre et message requis." }, 400)
      }

      const announce = { id: Date.now().toString(), title, body: message, url }
      const value = JSON.stringify(announce)
      for (const key of keys) {
        const { error } = await supabase.from("app_config").upsert({ key, value })
        if (error) throw error
      }
      return json({ success: true, announce, target })
    }

    return json({ success: false, error: "Action inconnue." }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur backend licence."
    console.error("[license-admin]", message)
    return json({ success: false, error: message }, 400)
  }
})
