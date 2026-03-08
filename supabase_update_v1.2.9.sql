-- ==========================================
-- DoulGet - Script de mise à jour Supabase (v1.2.9)
-- ==========================================
-- Ce script prépare votre base de données pour la nouvelle version 
-- et corrige les bugs de suppression de licences.

-- 1. Mise à jour de la version pour les notifications client
UPDATE app_config 
SET value = '1.2.9' 
WHERE key = 'latest_version';

-- 2. Mise à jour de l'URL de téléchargement pour le bouton "MAJ DISPONIBLE"
UPDATE app_config 
SET value = 'https://github.com/Abdoul123-info/doulbrowser/releases/download/v1.2.9/doul-get-1.2.9-setup.exe' 
WHERE key = 'update_url';
