-- SCRIPT DE MISE À JOUR SUPABASE POUR DOULGET v1.2.8+
-- Copiez et collez ce script dans l'éditeur SQL de votre Dashboard Supabase

-- 1. Table de configuration de l'application
CREATE TABLE IF NOT EXISTS public.app_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insertion des clés par défaut si elles n'existent pas
INSERT INTO public.app_config (key, value)
VALUES 
    ('latest_version', '1.2.8'),
    ('update_url', ''),
    ('extension_url', '')
ON CONFLICT (key) DO NOTHING;

-- 2. Table des Licences et HWID
CREATE TABLE IF NOT EXISTS public.licences (
    hwid TEXT PRIMARY KEY,
    license_key TEXT,
    original_key TEXT,
    email TEXT,
    status TEXT DEFAULT 'active',
    activated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    expiry_date TIMESTAMP WITH TIME ZONE,
    is_blocked BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Activation de RLS (Sécurité)
-- Note: Pour une configuration simple, on autorise l'accès via la clé API
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licences ENABLE ROW LEVEL SECURITY;

-- Création des politiques d'accès public (lecture seule pour tous)
CREATE POLICY "Lecture publique de la configuration" ON public.app_config FOR SELECT USING (true);
CREATE POLICY "Lecture publique des licences" ON public.licences FOR SELECT USING (true);

-- Autoriser tout (Lecture/Écriture) pour le service_role ou si vous utilisez la clé anon simple (selon votre config index.ts)
-- ATTENTION: Dans une version production, restreignez davantage
CREATE POLICY "Full access with anon key" ON public.app_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access with anon key licences" ON public.licences FOR ALL USING (true) WITH CHECK (true);

-- 4. Configuration du Stockage (Storage)
-- Ce bloc crée le bucket 'updates' si vous avez les permissions
-- Sinon, créez-le manuellement dans l'interface Storage de Supabase et mettez-le en PUBLIC.

INSERT INTO storage.buckets (id, name, public) 
VALUES ('updates', 'updates', true)
ON CONFLICT (id) DO NOTHING;

-- Autoriser l'upload public pour le bucket updates (utile pour votre admin panel)
CREATE POLICY "Upload public updates" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'updates');
CREATE POLICY "Update public updates" ON storage.objects FOR UPDATE USING (bucket_id = 'updates');
CREATE POLICY "Select public updates" ON storage.objects FOR SELECT USING (bucket_id = 'updates');
