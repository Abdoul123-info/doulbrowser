# DoulGet Licence/Admin Backend

La logique sensible de licence/admin doit vivre dans `license-admin`, pas dans l'application Electron.

## Fonction a deployer

```bash
supabase functions deploy license-admin
```

La génération de clés se fait exclusivement via le panneau admin (`admin-generate-key` / `admin-bulk-generate`). L'ancienne fonction `generate-license` (webhook de vente auto) a été supprimée.

## Secrets requis

```bash
supabase secrets set LICENSE_SALT="..."
supabase secrets set ADMIN_PASSWORD_HASH="..."
supabase secrets set MASTER_LICENSE_KEY="..."
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."
```

`ADMIN_PASSWORD_HASH` est le MD5 uppercase du mot de passe admin. Exemple avec Node:

```bash
node -e "console.log(require('crypto').createHash('md5').update('VOTRE_MOT_DE_PASSE').digest('hex').toUpperCase())"
```

## SQL de durcissement

Appliquer `supabase_secure_license_admin.sql` dans l'editeur SQL Supabase apres le deploiement.

Ce script retire les politiques publiques dangereuses sur `licences` et reserve l'administration a la fonction Edge via `service_role`.

## Uploads de mises a jour

L'app Electron ne doit pas ecrire directement dans Storage avec la cle publique.

Flux attendu:

1. L'admin choisit un fichier dans l'app.
2. L'app appelle `license-admin` avec `admin-create-update-upload`.
3. La fonction verifie le mot de passe admin et genere une URL d'upload signee.
4. L'app envoie le fichier vers cette URL signee.
5. L'app appelle `admin-set-latest-version` pour publier l'URL publique.

Apres application de `supabase_secure_license_admin.sql`, les policies publiques `INSERT/UPDATE` sur `storage.objects` sont retirees.
