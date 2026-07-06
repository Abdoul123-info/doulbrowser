// DoulGet Extension - Background Service Worker
// IDM METHOD: Network Sniffer + URL Cache

const DOULGET_PORT = 8765;
const DOULGET_HOST = 'localhost';

// Cache: Maps video CDN URLs to tab info
const videoUrlCache = new Map(); // { url: { tabId, timestamp, headers } }
const requestHeadersCache = new Map();

// [v1.9.27] NEW: Tab-based Metadata Store (Season/Episode context)
const tabMetadata = new Map(); // { tabId: { metadata: "S02E05", title: "...", timestamp } }

// [v1.9.3] Update Check Configuration
// [v2.0.1] Version lue depuis le manifest — la constante codée en dur (1.9.9)
// faisait afficher un badge "NEW" permanent dès que le manifest la dépassait.
const CURRENT_VERSION = chrome.runtime.getManifest().version;
const SUPABASE_UPDATER = {
    // [v1.9.36] Query for both extension_version and extension_url
    url: 'https://gqrwykhhqjimsgiqkgut.supabase.co/rest/v1/app_config?key=in.(extension_version,extension_url)',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxcnd5a2hocWppbXNnaXFrZ3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNzAsImV4cCI6MjA4NzI4ODI3MH0.OVLEQdhYN6VHi5OQC_51EnDPoPPbnV0HuNHtchPy244'
};

// [v1.3.6] GLOBAL URL BLACKLIST — checked at the SINGLE chokepoint before reaching Electron
const BLOCKED_DOMAINS = [
    'mail.google.com', 'gmail.com', 'inbox.google.com',
    'docs.google.com', 'sheets.google.com', 'slides.google.com',
    'drive.google.com', 'calendar.google.com', 'contacts.google.com',
    'maps.google.com', 'meet.google.com', 'chat.google.com',
    'accounts.google.com', 'myaccount.google.com',
    'translate.google.com', 'play.google.com/log',
    'google.com/search', 'google.com/complete', 'google.com/async',
    'google.com/recaptcha', 'google.com/pagead',
    'gstatic.com', 'fonts.googleapis.com', 'safebrowsing',
    'update.googleapis.com', 'clients1.google.com', 'clients2.google.com',
    'googleusercontent.com/meips', 'customeriomail.com',
    'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
    'mail.yahoo.com', 'mail.aol.com',
    'web.whatsapp.com', 'web.telegram.org', 'discord.com',
    'github.com', 'gitlab.com', 'bitbucket.org',
    'stackoverflow.com',
    'amazon.com', 'ebay.com', 'paypal.com', 'stripe.com',
    'notion.so', 'trello.com', 'slack.com', 'figma.com', 'canva.com',
    'bing.com/search', 'duckduckgo.com',
    'checkbuild', 'gen_204', '/sw.js_data',
    'googleads.', 'google-analytics.', 'googletagmanager.', 'doubleclick.',
    'facebook.net/signals', 'telemetry', 'recaptcha',
    'httpservice', 'ValidationAsyncService', 'play.google.com/log', 'youtube.com/api/stats'
];
// Blocked file extensions (images, text, web assets, subtitles — NOT videos)
const BLOCKED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
    '.txt', '.json', '.html', '.htm', '.css', '.js', '.xml', '.csv', '.woff', '.woff2', '.ttf',
    '.srt', '.vtt', '.ass', '.dfxp', '.ttml'];
// Blocked filenames
const BLOCKED_FILENAMES = ['unnamed', 'response.bin', 'f.txt', 'checkbuild'];

function sendToDoulGet(data) {
    // ... (existing code omitted for brevity but preserved in the tool)
    // [v1.3.6] Block non-video URLs at the chokepoint (3-layer check)
    const url = (data.url || '').toLowerCase();
    const fname = (data.filename || '').toLowerCase();
    const urlPath = url.split('?')[0].split('#')[0]; // Remove querystring and hash

    const isDomainBlocked = BLOCKED_DOMAINS.some(b => url.includes(b));
    const isExtBlocked = BLOCKED_EXTENSIONS.some(ext => urlPath.endsWith(ext) || fname.endsWith(ext));
    const isNameBlocked = BLOCKED_FILENAMES.some(f => fname.includes(f));

    if (isDomainBlocked || isExtBlocked || isNameBlocked) {
        console.log('🚫 BLOCKED at gateway:', url.substring(0, 80), '| file:', fname);
        return; // Do NOT send to Electron
    }

    fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/download-detected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(response => {
        if (response.ok) {
            console.log('✅ Sent to DoulGet:', data.url.substring(0, 50) + '...');
        }
    }).catch(err => { console.error('❌ Failed to send to DoulGet app:', err.message || err); });
}

function sendBatchToDoulGet(batchData) {
    console.log('📦 [DoulGet] Attempting to send BATCH to DoulGet:', batchData.playlistTitle, `(${batchData.items.length} items)`);
    console.log('📦 [DoulGet] Batch payload:', JSON.stringify(batchData).substring(0, 500) + '...');
    fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/batch-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchData)
    }).then(response => {
        if (response.ok) {
            console.log('✅ Batch successfully sent to DoulGet');
        }
    }).catch(err => {
        console.error('❌ Failed to send batch:', err);
    });
}

// 1. Capture Headers
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const headers = {};
        if (details.requestHeaders) {
            for (const header of details.requestHeaders) {
                const name = header.name.toLowerCase();
                const allowed = ['cookie', 'referer', 'user-agent', 'origin', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest'];
                if (allowed.some(a => name.includes(a))) {
                    // Capitalize first letters for consistency (Referer, Cookie, etc.)
                    const key = header.name.charAt(0).toUpperCase() + header.name.slice(1);
                    headers[key] = header.value;
                }
            }
        }
        if (Object.keys(headers).length > 0) {
            requestHeadersCache.set(details.requestId, headers);
        }
        setTimeout(() => requestHeadersCache.delete(details.requestId), 30000);
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
);

// 2. NETWORK SNIFFER - Detect Video URLs AND HLS Manifests
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (details.method !== 'GET' || (details.statusCode !== 200 && details.statusCode !== 206)) return;

        const headers = details.responseHeaders;
        const typeHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
        const lengthHeader = headers.find(h => h.name.toLowerCase() === 'content-length');

        if (!typeHeader) return;

        const contentType = typeHeader.value.toLowerCase();
        const url = details.url;

        // [v1.3.6] Extended blacklist for non-video sites, analytics, ads, scripts
        const blacklist = [
            'googleads.', 'google-analytics.', 'googletagmanager.', 'doubleclick.', 
            'google.com/pagead', 'google.com/ads', 'facebook.net/signals', 
            'analytics', 'telemetry', 'recaptcha', '/sw.js_data', 
            '/api/timedtext', 'google.com/complete', 'google.com/async', 
            'google.com/search', 'gen_204', 'play.google.com/log',
            'suggestqueries', 'complete/search',
            'mail.google.com', 'gmail.com', 'docs.google.com', 'sheets.google.com',
            'drive.google.com', 'calendar.google.com', 'maps.google.com',
            'meet.google.com', 'chat.google.com', 'accounts.google.com',
            'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com',
            'web.whatsapp.com', 'web.telegram.org', 'discord.com',
            'github.com', 'stackoverflow.com', 'translate.google.com',
            'checkbuild', 'gstatic.com', 'fonts.googleapis.com',
            'safebrowsing', 'update.googleapis.com',
            'httpservice', 'ValidationAsyncService', 'play.google.com/log', 'youtube.com/api/stats'
        ];
        if (blacklist.some(b => url.includes(b))) return;

        // Check if it's a video OR HLS manifest OR PDF
        const isVideo = contentType.includes('video/') ||
            contentType.includes('application/x-mpegURL') ||  // HLS manifest (.m3u8)
            contentType.includes('application/vnd.apple.mpegurl') ||  // HLS manifest
            contentType.includes('application/mp4') ||
            contentType.includes('application/pdf') || // [v1.3.8] PDF Support
            (contentType.includes('application/octet-stream') && 
             (url.match(/\.(mp4|webm|mkv|avi|mov|flv|wmv|m3u8|ts|pdf)(\?|$)/i) || url.includes('/video/')));

        if (!isVideo) return;


        // [v1.9.29] HLS Optimization: STRICT segment filtering
        const isM3U8 = url.includes('.m3u8') ||
            contentType.includes('mpegURL') ||
            contentType.includes('mpegurl') ||
            url.includes('master.m3') || // Vidzy master.m3u8 log shows master.m3
            url.includes('index.m3') ||
            url.includes('playlist.m3');
        
        // Strict segment blacklist
        const isSegment = url.includes('.ts') || 
                          url.includes('/seg-') || 
                          url.includes('/segment-') || 
                          url.includes('.vtt') || 
                          url.includes('/frag-') ||
                          url.includes('index-v'); // Vidzy index-v1-a1.m3u8 is often a variant, we want master

        if (isSegment && !isM3U8) {
            return; 
        }

        if (!isVideo && !isM3U8) return;

        // Size check (min 10KB to avoid thumbnails) - SKIP for m3u8
        if (!isM3U8) {
            let size = 0;
            if (lengthHeader) size = parseInt(lengthHeader.value);
            if (size > 0 && size < 10 * 1024) return;
        }

        // Store in cache with headers
        const capturedHeaders = requestHeadersCache.get(details.requestId) || {};
        videoUrlCache.set(url, {
            tabId: details.tabId,
            timestamp: Date.now(),
            headers: capturedHeaders,
            size: lengthHeader ? parseInt(lengthHeader.value) : 0
        });

        console.log('📹 Video CDN Captured:', url.substring(0, 80));

        // Send to content script to map to video element
        // [v1.9.7] Skip if batch mode is active (content script handles streams directly)
        chrome.storage.local.get(['batchMode', 'batchModeAt'], (data) => {
            // [v2.4.1] Sécurité: un batchMode resté bloqué à true (crash pendant une capture
            // batch) expire après 15 min pour ne pas couper la détection vidéo indéfiniment.
            const batchFresh = data.batchMode && (!data.batchModeAt || (Date.now() - data.batchModeAt) < 15 * 60 * 1000);
            if (batchFresh) {
                console.log('[Batch Mode] Suppressing videoCaptured for:', url.substring(0, 50));
                return;
            }
            if (details.tabId >= 0) {
                chrome.tabs.sendMessage(details.tabId, {
                    action: 'videoCaptured',
                    url: url,
                    headers: capturedHeaders
                }).catch(() => { });
            }
        });

        // Cleanup old entries (>5 minutes)
        setTimeout(() => videoUrlCache.delete(url), 5 * 60 * 1000);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// 2b. FILE DOWNLOAD SNIFFER - Detect any file served with Content-Disposition: attachment
// This handles download sites that use HTTP redirects (Clubic, Softpedia, Fosshub, etc.)
const recentFileDownloads = new Set(); // Dedup cache
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (details.method !== 'GET' || (details.statusCode !== 200 && details.statusCode !== 206)) return;
        if (details.tabId < 0) return; // Ignore service workers

        const headers = details.responseHeaders || [];
        const url = details.url;

        // [v1.9.35] Blacklist for file sniffer as well
        const blacklist = [
            'googleads.', 'analytics.', 'doubleclick.', '/sw.js_data', 
            '/api/timedtext', 'recaptcha', 'google.com/complete', 
            'google.com/search', 'google.com/async', 'suggestqueries',
            'complete/search', 'httpservice', 'ValidationAsyncService'
        ];
        if (blacklist.some(b => url.includes(b))) return;

        const dispositionHeader = headers.find(h => h.name.toLowerCase() === 'content-disposition');
        const typeHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
        const lengthHeader = headers.find(h => h.name.toLowerCase() === 'content-length');

        const contentType = typeHeader ? typeHeader.value.toLowerCase() : '';
        const disposition = dispositionHeader ? (dispositionHeader.value || '').toLowerCase() : '';

        // [v1.3.8-redirects] Broaden detection: 
        // 1. Content-Disposition: attachment
        // 2. Specific file MIME types (zip, exe, pdf, etc.)
        // 3. Known file extensions in URL
        const isFileMime = contentType.includes('application/pdf') || 
                           contentType.includes('application/zip') || 
                           contentType.includes('application/x-zip-compressed') ||
                           contentType.includes('application/x-msdownload') || 
                           contentType.includes('application/octet-stream') ||
                           contentType.includes('application/vnd.android.package-archive');

        const isKnownExt = url.match(/\.(pdf|zip|rar|7z|exe|msi|apk|dmg|tar|gz)(\?|$)/i);

        if (!disposition.includes('attachment') && !isFileMime && !isKnownExt) return;

        // Size check: min 50KB for files (avoid icons, small assets)
        const size = lengthHeader ? parseInt(lengthHeader.value) : 0;
        if (size > 0 && size < 50 * 1024 && !isKnownExt) return;

        // [v1.3.8] Deduplication: ignore if we've seen this URL or if a manual download is active
        if (recentFileDownloads.has(url)) return;
        
        // Manual vs Sniffer Deduplication:
        // If a request for this URL started manually in the last 5 seconds, ignore sniffer
        const urlToCheck = url.toLowerCase();
        for (const [reqKey, time] of recentRequests.entries()) {
            if (Date.now() - time < 5000 && reqKey.toLowerCase().includes(urlToCheck.split('?')[0])) {
                console.log('🛡️ Sniffer blocked: Manual download already handling this URL');
                return;
            }
        }
        
        recentFileDownloads.add(url);
        setTimeout(() => recentFileDownloads.delete(url), 5000);

        // Extract filename from Content-Disposition header
        let filename = '';
        const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|"?)([^;"]+)/i);
        if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1].replace(/"/g, '').trim());
        }
        if (!filename) {
            // Fallback: extract from URL
            try {
                const urlPath = new URL(url).pathname;
                filename = urlPath.split('/').pop() || 'download';
            } catch(e) { filename = 'download'; }
        }

        // Detect MIME type from URL extension
        const lowerUrl = url.toLowerCase();
        const lowerFilename = filename.toLowerCase();
        let mimeType = 'application/octet-stream';
        [lowerUrl, lowerFilename].forEach(s => {
            if (s.includes('.zip') || s.includes('.rar') || s.includes('.7z') || s.includes('.tar') || s.includes('.gz')) mimeType = 'application/zip';
            else if (s.includes('.exe') || s.includes('.msi')) mimeType = 'application/x-msdownload';
            else if (s.includes('.pdf')) mimeType = 'application/pdf';
            else if (s.includes('.apk')) mimeType = 'application/vnd.android.package-archive';
            else if (s.includes('.dmg')) mimeType = 'application/octet-stream';
        });

        const capturedHeaders = requestHeadersCache.get(details.requestId) || {};
        console.log(`🔍 File Download Detected (Manual click required): ${filename} - ${url.substring(0, 80)}`);

        // [v1.3.8] MANUAL ONLY: Do NOT automatically send to Electron.
        // Instead, store in cache so the content script or popup can offer it to the user.
        videoUrlCache.set(url, {
            tabId: details.tabId,
            timestamp: Date.now(),
            headers: capturedHeaders,
            filename: filename,
            isAttachment: true
        });

        // Notify content script so it can show the button if not already there
        if (details.tabId >= 0) {
            chrome.tabs.sendMessage(details.tabId, {
                action: 'videoCaptured', // Use same event to trigger button display
                url: url,
                filename: filename,
                headers: capturedHeaders
            }).catch(() => { });
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// 3. Handle Download Request from Content Script
// Deduplication cache for outgoing requests
const recentRequests = new Map(); // { key: timestamp }

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        if (request.action === 'sendDownload') {
            // [v1.1.3] Deduplication: Ignore identical requests within 1.5s
            const requestKey = `${request.url}|${!!request.audioOnly}`;
            const lastTime = recentRequests.get(requestKey) || 0;
            if (Date.now() - lastTime < 1500) {
                console.log('🚫 Duplicate request ignored (Debounce):', requestKey);
                sendResponse({ success: true, ignored: true });
                return true;
            }
            recentRequests.set(requestKey, Date.now());

            // [v1.3.6] BLOCK non-video URLs from reaching yt-dlp
            const urlBlacklist = [
                'mail.google.com', 'gmail.com', 'docs.google.com', 'sheets.google.com',
                'drive.google.com', 'calendar.google.com', 'maps.google.com',
                'meet.google.com', 'chat.google.com', 'accounts.google.com',
                'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
                'mail.yahoo.com', 'web.whatsapp.com', 'web.telegram.org',
                'discord.com/channels', 'github.com', 'stackoverflow.com',
                'google.com/search', 'google.com/complete', 'google.com/async',
                'bing.com/search', 'duckduckgo.com',
                'checkbuild', 'gen_204', '/sw.js_data', 'pagead',
                'googleads.', 'google-analytics.', 'googletagmanager.',
                'translate.google.com', 'play.google.com/log',
                'httpservice', 'ValidationAsyncService'
            ];
            if (urlBlacklist.some(b => request.url.includes(b))) {
                console.log('🚫 Blocked non-video URL:', request.url.substring(0, 80));
                sendResponse({ success: false, error: 'Non-video URL blocked' });
                return true;
            }
            // Cleanup old cache entries
            if (recentRequests.size > 100) {
                const now = Date.now();
                for (const [key, time] of recentRequests.entries()) {
                    if (now - time > 10000) recentRequests.delete(key);
                }
            }

            const processDownload = (cookiesHeader = '') => {
                const headers = request.headers || {};
                if (cookiesHeader) {
                    headers['Cookie'] = cookiesHeader;
                }
                if (!headers['User-Agent'] && navigator.userAgent) {
                    headers['User-Agent'] = navigator.userAgent;
                }

                let finalFilename = request.filename || 'download';
                
                // [v1.x] Blacklist of generic button texts that should never be used as filenames
                const genericNames = [
                    'télécharger', 'telecharger', 'téléchargement', 'telecharger maintenant',
                    'télécharger maintenant', 'download now', 'download', 'télécharger le fichier',
                    'lien direct', 'direct download', 'get it now', 'click here', 'ici'
                ];
                const isGenericName = !finalFilename.includes('.') &&
                    genericNames.some(g => finalFilename.toLowerCase().includes(g));

                // [v1.x] If name is generic OR has no extension, extract from URL
                if (isGenericName || !finalFilename.includes('.') || finalFilename.split('.').pop().length > 5) {
                    try {
                        const urlPath = new URL(request.url).pathname;
                        const urlFilename = urlPath.split('/').pop().split('?')[0];
                        const knownExts = ['zip','rar','7z','tar','gz','exe','msi','dmg','apk','pdf','doc','docx','xls','xlsx','iso','epub','mp4','mp3','mkv','avi'];
                        const urlExt = urlFilename.split('.').pop();
                        if (urlFilename && knownExts.includes((urlExt || '').toLowerCase())) {
                            finalFilename = decodeURIComponent(urlFilename);
                        } else if (isGenericName) {
                            // Still generic and URL doesn't help — use URL hostname + ext from URL
                            const hostname = new URL(request.url).hostname.replace('www.', '');
                            finalFilename = hostname + (urlExt && knownExts.includes(urlExt.toLowerCase()) ? '.' + urlExt : '');
                        }
                    } catch(e) {}
                }

                // [v1.9.13] IFRAME TITLE FIX (Palkad/Lok-Lok):
                if (sender.tab && sender.tab.title) {
                    const baseName = finalFilename.split('.')[0] || '';
                    const isHash = !/[\s\-_]/.test(baseName) && /\d/.test(baseName) && baseName.length < 25;
                    const isGeneric = finalFilename.startsWith('Video_') || 
                                      finalFilename.toLowerCase().includes('moovbob') || 
                                      finalFilename === 'download.mp4' ||
                                      finalFilename === 'download.mp3' ||
                                      isHash;
                    
                    if (isGeneric) {
                        let tabTitle = sender.tab.title;
                        console.log('[Background] Generic filename detected. Fallback to Tab Title:', tabTitle);
                        
                        // [v1.3.6] Shield social media sites from episode metadata injection
                        const socialSites = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com', 'dailymotion.com', 'vimeo.com'];
                        const tabUrl = (sender.tab.url || '').toLowerCase();
                        const isSocial = socialSites.some(s => tabTitle.toLowerCase().includes(s.split('.')[0]) || tabUrl.includes(s));
                        const meta = tabMetadata.get(sender.tab.id);
                        if (meta && !isSocial && !tabTitle.includes(meta.metadata) && (Date.now() - meta.timestamp < 300000)) {
                             console.log('[Background] Merging cached metadata to tab title:', meta.metadata);
                             // Clean tab title of common junk but keep core series name
                             tabTitle = tabTitle.replace(/Season\s?\d+|Saison\s?\d+|Episode\s?\d+|Ep\s?\d+|S\d+E\d+/gi, '').replace(/\s+/g, ' ').trim();
                             tabTitle = `${tabTitle} - ${meta.metadata}`;
                        }

                        tabTitle = tabTitle
                            .replace(/\s[-|]\s?Palkad.*/i, '')
                            .replace(/\s[-|]\s?Lok-Lok.*/i, '')
                            .replace(/\s[-|]\s?Moovbob.*/i, '')
                            .replace(/^Voir film\s?/i, '')
                            .replace(/streaming/i, '')
                            .replace(/free movies/i, '')
                            .replace(/watch online/i, '')
                            .trim();

                        if (tabTitle.length > 2) {
                            tabTitle = tabTitle.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
                            
                            // [v1.9.35] FIX: urlLower was used before declaration. Defined it here.
                            const currentUrlLower = (request.url || '').toLowerCase();
                            const isDefinitelyVideo = currentUrlLower.match(/\.(mp4|webm|mkv|avi|mov|flv|wmv)(\?|$)/i) || request.url.includes('/video/');
                            let ext = '';
                            if (finalFilename.includes('.mp3')) ext = '.mp3';
                            else if (finalFilename.includes('.mp4') || isDefinitelyVideo) ext = '.mp4';
                            
                            finalFilename = ext ? `${tabTitle}${ext}` : tabTitle;
                            console.log('[Background] Applied New Filename detected as video:', finalFilename);
                        }
                    }
                }


                // [v1.x] Detect MIME type properly — don't default to video/mp4 for archives
                let detectedMime = request.type || 'application/octet-stream';
                const urlLower = (request.url || '').toLowerCase();
                if (!detectedMime || detectedMime === 'video/mp4') {
                    if (urlLower.includes('.zip') || urlLower.includes('.rar') || urlLower.includes('.7z') || urlLower.includes('.tar') || urlLower.includes('.gz')) detectedMime = 'application/zip';
                    else if (urlLower.includes('.exe') || urlLower.includes('.msi')) detectedMime = 'application/x-msdownload';
                    else if (urlLower.includes('.pdf')) detectedMime = 'application/pdf';
                    else if (urlLower.includes('.apk')) detectedMime = 'application/vnd.android.package-archive';
                    else if (urlLower.includes('.mp4') || urlLower.includes('.mkv') || urlLower.includes('.avi')) detectedMime = 'video/mp4';
                }

                sendToDoulGet({
                    type: 'download-detected',
                    url: request.url,
                    filename: finalFilename,
                    mimeType: detectedMime,
                    headers: headers,
                    audioOnly: !!request.audioOnly,
                    timestamp: Date.now(),
                    tabId: sender.tab ? sender.tab.id : null,
                    frameId: sender.frameId
                });
                sendResponse({ success: true });
            };

            // [FIX Instagram/Facebook] processDownload() était appelé sans jamais
            // récupérer les cookies : yt-dlp recevait l'URL de page sans session et
            // Instagram répondait "empty media response". On joint les cookies du
            // domaine (chrome.cookies) pour les plateformes qui exigent une session.
            const cookieSites = ['instagram.com', 'facebook.com', 'fb.watch', 'fb.com', 'tiktok.com', 'twitter.com', 'x.com'];
            let needsCookies = false;
            try {
                const host = new URL(request.url || '').hostname;
                needsCookies = cookieSites.some(s => host === s || host.endsWith('.' + s));
            } catch (e) { needsCookies = false; }
            const hasCookieAlready = !!(request.headers && request.headers['Cookie']);
            if (needsCookies && !hasCookieAlready && chrome.cookies && chrome.cookies.getAll) {
                try {
                    chrome.cookies.getAll({ url: request.url }, (cookies) => {
                        try {
                            const header = (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
                            processDownload(header);
                        } catch (e) { processDownload(); }
                    });
                } catch (e) { processDownload(); }
            } else {
                processDownload();
            }
            return true;
        }

        if (request.action === 'requestShowBar' && sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: 'requestShowBar',
                url: request.url,
                filename: request.filename
            }).catch(() => {});
            return true;
        }

        if (request.action === 'sendBatchDownload') {
            console.log('📥 [Background] Received sendBatchDownload message from content script:', request.playlistTitle);
            sendBatchToDoulGet({
                playlistTitle: request.playlistTitle || 'Batch Download',
                items: request.items || [],
                headers: request.headers || {}, // [v1.4.5] Fix 403: Forward headers to desktop app
                timestamp: Date.now(),
                tabId: sender.tab ? sender.tab.id : null
            });
            sendResponse({ success: true });
            return true;
        }

        // [v1.9.27] Cache metadata reported by content scripts (Top Frame)
        if (request.action === 'reportMetadata' && sender.tab) {
            tabMetadata.set(sender.tab.id, {
                metadata: request.metadata, // "S02E05"
                title: request.title,
                timestamp: Date.now()
            });
            return true;
        }

        // Get cached video URL for a specific page
        if (request.action === 'getCachedVideoUrl') {
            const tabId = sender.tab?.id;
            if (!tabId) {
                sendResponse({ success: false });
                return true;
            }

            let mostRecent = null;
            let mostRecentTime = 0;

            for (const [url, data] of videoUrlCache.entries()) {
                if (data.tabId === tabId && data.timestamp > mostRecentTime) {
                    mostRecent = { url, ...data };
                    mostRecentTime = data.timestamp;
                }
            }

            if (mostRecent) {
                sendResponse({
                    success: true,
                    url: mostRecent.url,
                    headers: mostRecent.headers
                });
            } else {
                sendResponse({ success: false });
            }
            return true;
        }

        // GM_cookie HANDLERS - disabled in v1.9.1
        if (request.action === 'GM_cookie_list' || request.action === 'GM_cookie_set' || request.action === 'GM_cookie_delete') {
            sendResponse({ error: 'Cookies API not supported in this environment' });
            return true;
        }

        // Connection check
        if (request.action === 'checkConnection') {
            fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/ping`)
                .then(() => sendResponse({ connected: true }))
                .catch(() => sendResponse({ connected: false }));
            return true;
        }

        if (request.action === 'pauseDownload') {
            fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/download-pause`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: request.url, audioOnly: !!request.audioOnly })
            }).then(() => sendResponse({ success: true }))
              .catch(() => sendResponse({ success: false }));
            return true;
        }

        if (request.action === 'resumeDownload') {
            fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/download-resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: request.url, audioOnly: !!request.audioOnly })
            }).then(() => sendResponse({ success: true }))
              .catch(() => sendResponse({ success: false }));
            return true;
        }

        if (request.action === 'cancelDownload') {
            fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/download-cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: request.url, audioOnly: !!request.audioOnly })
            }).then(() => sendResponse({ success: true }))
              .catch(() => sendResponse({ success: false }));
            return true;
        }

        if (request.action === 'getDownloadStatus') {
            fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/download-status?url=${encodeURIComponent(request.url)}&audioOnly=${!!request.audioOnly}`)
                .then(res => res.json())
                .then(data => sendResponse({ success: true, data: data }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;
        }

        if (request.action === 'resolveLokLokStream') {
            const { subjectId, detailPath, se, ep, referer } = request;
            const origin = referer ? new URL(referer).origin : 'https://lok-lok.cc';
            const api = `${origin}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;
            
            // [v1.4.5] Robust resolution with timeout to prevent message channel closure
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            fetch(api, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Referer': origin + '/',
                    'Origin': origin
                }
            })
            .then(res => res.json())
            .then(data => {
                clearTimeout(timeoutId);
                if (data.streams && data.streams.length > 0) {
                    // [v1.9.0] Filter out subtitles (.srt, .vtt) from stream resolution
                    const videoStreams = data.streams.filter(s => {
                        const lowUrl = (s.url || '').toLowerCase();
                        return !lowUrl.includes('.srt') && !lowUrl.includes('.vtt');
                    });
                    
                    if (videoStreams.length > 0) {
                        sendResponse({ success: true, url: videoStreams[0].url });
                    } else {
                        // Fallback to first if all filtered (unlikely)
                        sendResponse({ success: true, url: data.streams[0].url });
                    }
                } else {
                    sendResponse({ success: false, error: 'No streams found' });
                }
            })
            .catch(err => {
                clearTimeout(timeoutId);
                sendResponse({ success: false, error: err.message });
            });
            return true;
        }

        // Default: unrecognized action
        sendResponse({ success: false, error: 'Unrecognized action' });
    } catch (err) {
        console.error('onMessage error:', err);
        try { sendResponse({ success: false, error: err.message }); } catch(e) {}
    }
    return true;
});

// [v1.9.27] Cleanup metadata when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (typeof tabMetadata !== 'undefined') tabMetadata.delete(tabId);
});

// 4. DOWNLOAD INTERCEPTION - Disabled in v1.9.1 (Unstable in Electron environment)
console.log('🚀 DoulGet Background Worker Active (v1.9.3)');

// 5. UPDATE SYSTEM (v1.9.3)
async function checkExtensionUpdate() {
    // [v2.0.1] Installée depuis un store (Chrome Web Store / Edge Add-ons):
    // update_url est défini et le store gère les mises à jour lui-même.
    if (chrome.runtime.getManifest().update_url) return;
    try {
        const response = await fetch(SUPABASE_UPDATER.url, {
            headers: {
                'apikey': SUPABASE_UPDATER.key,
                'Authorization': `Bearer ${SUPABASE_UPDATER.key}`
            }
        });
        const data = await response.json();
        
        if (data && Array.isArray(data) && data.length > 0) {
            const versionRow = data.find(r => r.key === 'extension_version');
            const urlRow = data.find(r => r.key === 'extension_url');

            const latestVersion = versionRow ? versionRow.value : CURRENT_VERSION;
            const extensionUrl = urlRow ? urlRow.value : '';

            const isNewer = compareVersions(latestVersion, CURRENT_VERSION);
            
            if (isNewer) {
                console.log(`[ExtensionUpdate] New version available: ${latestVersion} (Local: ${CURRENT_VERSION})`);
                chrome.action.setBadgeText({ text: 'NEW' });
                chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
                chrome.storage.local.set({ 
                    updateAvailable: true, 
                    latestVersion: latestVersion,
                    updateUrl: extensionUrl, // [v1.9.4] The .zip direct link
                    lastCheck: Date.now()
                });
            } else {
                console.log('[ExtensionUpdate] Current version is up to date.');
                chrome.action.setBadgeText({ text: '' });
                chrome.storage.local.set({ updateAvailable: false });
            }
        }
    } catch (err) {
        console.error('Update check failed:', err);
    }
}

function compareVersions(v1, v2) {
    const p1 = v1.replace(/^v/, '').split('.').map(Number);
    const p2 = v2.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return true;
        if (n1 < n2) return false;
    }
    return false;
}

// Initial check and periodic polling (every 6 hours)
checkExtensionUpdate();
chrome.alarms.create('checkUpdate', { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkUpdate') checkExtensionUpdate();
});
