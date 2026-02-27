/**
 * SCRIPT DE DIAGNOSTIC SUPABASE
 */
const https = require('https');
const { URL } = require('url');

const SUPABASE_URL = 'https://gqrwykhhqjimsgiqkgut.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7A_O72E3LnRXGWqMlp-NBA_ytfaH4Jj';

async function testRequest(path) {
    console.log(`🔍 Test de la requête : ${path}...`);
    return new Promise((resolve) => {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (d) => data += d);
            res.on('end', () => {
                console.log(`📡 Statut HTTP : ${res.statusCode}`);
                try {
                    const json = JSON.parse(data);
                    console.log('📦 Réponse JSON :', JSON.stringify(json, null, 2).substring(0, 500));
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    console.log('❌ Erreur de parsing JSON ou réponse vide.');
                    console.log('📄 Données brutes :', data);
                    resolve({ status: res.statusCode, data: null });
                }
            });
        });

        req.on('error', (e) => {
            console.error('❌ Erreur réseau :', e.message);
            resolve(null);
        });
        req.end();
    });
}

async function run() {
    console.log('--- DIAGNOSTIC DOULGET CLOUD ---');
    
    // 1. Test app_config
    await testRequest('app_config?select=*&limit=1');
    
    console.log('\n-------------------\n');
    
    // 2. Test licences
    await testRequest('licences?select=*&limit=1');
    
    console.log('\n--- FIN DU DIAGNOSTIC ---');
}

run().catch(console.error);
