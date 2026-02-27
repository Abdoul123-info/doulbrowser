/**
 * DOULGET - SCRIPT DE DÉPLOIEMENT AUTOMATIQUE SUPABASE
 * Ce script configure vos tables SQL et votre Bucket de stockage via l'API REST.
 * Lancé par : node deploy-supabase.js
 */

const https = require('https');
const { URL } = require('url');

// Configuration récupérée de index.ts
const SUPABASE_URL = 'https://gqrwykhhqjimsgiqkgut.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7A_O72E3LnRXGWqMlp-NBA_ytfaH4Jj';

async function request(path, method, body, service = 'rest') {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/${service}/v1/${path}`);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (d) => data += d);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data ? JSON.parse(data) : true);
                } else {
                    console.log(`[Status ${res.statusCode}] ${path}`);
                    resolve(null);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log('🚀 Démarrage de la configuration Supabase pour DoulGet...');

    // 1. Création du Bucket 'updates'
    console.log('📦 Configuration du Stockage (updates bucket)...');
    const bucketRes = await request('bucket', 'POST', {
        id: 'updates',
        name: 'updates',
        public: true
    }, 'storage');
    
    if (bucketRes) {
        console.log('✅ Bucket "updates" prêt (ou déjà existant).');
    }

    // 2. Initialisation de la table app_config
    console.log('⚙️ Configuration de la table app_config...');
    // Note: L'API REST ne permet pas de créer des tables directement via SQL 
    // sans l'extension pg_net ou rpc. On passe par une insertion test pour vérifier l'accès.
    
    const configData = [
        { key: 'latest_version', value: '1.2.8' },
        { key: 'update_url', value: '' },
        { key: 'extension_url', value: '' }
    ];

    for (const item of configData) {
        const res = await request(`app_config?key=eq.${item.key}`, 'PATCH', item);
        if (res === null) {
            // Si PATCH échoue (table inexistante), on tente POST
            await request('app_config', 'POST', item);
        }
    }
    console.log('✅ Configuration app_config terminée.');

    console.log('\n--- TERMINÉ ---');
    console.log('Si vous voyez des erreurs [Status 404], assurez-vous d\'avoir créé');
    console.log('les tables via l\'Editeur SQL de Supabase avec le fichier supabase_setup.sql.');
    console.log('Le script REST ne peut pas créer physiquement les tables pour des raisons de sécurité.');
}

run().catch(console.error);
