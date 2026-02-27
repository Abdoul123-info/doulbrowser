// DoulGet Content Script - IDM Method
// Network Sniffer + Video Element Mapping

(function () {
    console.log('🚀 DoulGet UI Manager - IDM Method ACTIVE');

    // ============================================
    // GM_ API BRIDGE FOR MAIN WORLD COMPATIBILITY
    // Fixes ReferenceError: GM_cookie in YouTube scripts
    // ============================================

    // 1. Bridge script is now injected via manifest.json (Main World)
    console.log('🚀 DoulGet GM_ Bridge ACTIVE (via Manifest)');

    function isContextValid() {
        return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    }

    // 2. Listen for requests from the Main World and forward to Background
    window.addEventListener('message', (event) => {
        // Only accept messages from the same window
        if (event.source !== window || !event.data || event.data.type !== 'DOULGET_GM_BRIDGE' || event.data.responseId) {
            return;
        }

        if (!isContextValid()) return;

        const { action, details, id } = event.data;

        // Forward to background script
        chrome.runtime.sendMessage({ action, details }, (response) => {
            // Send back to the Main World
            window.postMessage({
                type: 'DOULGET_GM_BRIDGE',
                responseId: id,
                cookies: response?.cookies,
                error: response?.error,
                details: response?.details,
                cookie: response?.cookie // for GM_cookie_set
            }, '*');
        });
    });

    // Map video elements to their CDN URLs
    const videoUrlMap = new WeakMap(); // video element -> CDN URL

    // Listen for captured video URLs from background
    if (isContextValid()) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'videoCaptured') {
            // Find video element currently playing this URL - more aggressive scan
            const allVideos = findAllVideos();
            console.log(`🔍 Found ${allVideos.length} video elements`);

            allVideos.forEach(video => {
                // Map ANY video to captured CDN (HLS videos use blob URLs)
                videoUrlMap.set(video, {
                    cdnUrl: request.url,
                    headers: request.headers,
                    capturedAt: Date.now()
                });
                console.log('📹 Mapped video to CDN:', request.url.substring(0, 60));
            });

            // [v1.3.8] NEW: Show floating capture bar if no video elements are active
            // and it's a direct file capture (attachment)
            if (allVideos.length === 0 || request.filename) {
                console.log('📦 Triggering floating capture bar for:', request.filename || request.url);
                showFloatingCapture(request.url, request.filename, request.headers);
            }
        }

        if (request.action === 'detectVideo') {
            const url = location.href;
            if (!isContextValid()) return;
            chrome.runtime.sendMessage({
                action: 'sendDownload',
                url: url,
                filename: document.title || 'video',
                type: 'video/mp4'
            }, (response) => {
                sendResponse({ success: !!(response && response.success) });
            });
            return true;
        }
    });
    } // Added this closing brace for the `if (isContextValid())` block

    // [v1.3.1] ROBUST VIDEO FINDER
    function findAllVideos() {
        const videos = new Set();
        
        // 1. All video elements (main, shadow, iframes)
        document.querySelectorAll('video').forEach(v => videos.add(v));
        document.querySelectorAll('*').forEach(el => { if (el.shadowRoot) el.shadowRoot.querySelectorAll('video').forEach(v => videos.add(v)); });
        try {
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) iframeDoc.querySelectorAll('video').forEach(v => videos.add(v));
                } catch (e) {}
            });
        } catch (e) {}

        // [v1.3.1] Filter strategy: 
        // - Reject hidden/disconnected videos.
        // - On YouTube, the "main" video usually has a certain size and is within a player.
        return Array.from(videos).filter(v => {
            try {
                const rect = v.getBoundingClientRect();
                const style = window.getComputedStyle(v);
                const isVisible = rect.width > 10 && rect.height > 10 && style.display !== 'none' && style.visibility !== 'hidden' && v.isConnected;
                if (!isVisible) return false;

                // Extra check for YouTube: sometimes there are 0x0 or hidden cloned videos at (0,0)
                if (location.href.includes('youtube.com') && rect.top < 1 && rect.width < 50) return false;
                
                return true;
            } catch (e) { return false; }
        });
    }

    // FIND ALL DOWNLOAD LINKS - Documents like PDFs, Word, ZIP, etc.
    function findAllDownloadLinks() {
        const links = new Set();
        const extensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'csv', 'exe', 'dmg', 'apk', 'iso', 'msi', 'xz', 'bz2', 'epub', 'azw'];
        const extRegex = new RegExp(`\\.(${extensions.join('|')})(\\W|$)`, 'i');
        const downloadKeywords = ['download', 'télécharger', 'téléchargement', 'fichier', 'mirror', 'lien direct'];

        function scanNode(node) {
            if (!node) return;

            // 1. Scan <a> elements only (buttons without extension URLs are unreliable)
            const elements = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
            elements.forEach(el => {
                try {
                    const href = el.href;
                    if (!href || (!href.startsWith('http') && !href.startsWith('/'))) return;

                    const isDownloadAttr = el.hasAttribute('download');
                    
                    // STRICT: Only match if the URL itself contains a known file extension.
                    // This prevents false positives like /download-manager/ or /how-to-download/
                    const hasExt = extRegex.test(href);
                    
                    if (isDownloadAttr || hasExt) {
                        links.add(el);
                    }
                } catch (e) {}
            });

            // 2. Scan Shadow DOM
            if (node.querySelectorAll) {
                node.querySelectorAll('*').forEach(el => {
                    if (el.shadowRoot) scanNode(el.shadowRoot);
                });
            }

            // 3. Scan same-origin iframes
            if (node === document) {
                document.querySelectorAll('iframe').forEach(iframe => {
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        if (iframeDoc) scanNode(iframeDoc);
                    } catch (e) {}
                });
            }
        }

        scanNode(document);
        return Array.from(links);
    }

    // [v1.9.23] User Interaction Tracker
    let lastUserSelectedEpisode = null;

    function saveEpisodeChoice(ep) {
        try {
            const data = { ep: ep, title: document.title, url: window.location.href.split('?')[0] };
            sessionStorage.setItem('doul_last_ep', JSON.stringify(data));
        } catch(e) {}
    }

    function loadEpisodeChoice() {
        try {
            const stored = sessionStorage.getItem('doul_last_ep');
            if (stored) {
                const cleanUrl = location.href.split('?')[0].split('#')[0];
                const data = JSON.parse(stored);
                if (data.url === cleanUrl || data.title === document.title) {
                    return data.ep;
                }
            }
        } catch(e) {}
        return null;
    }

    document.addEventListener('click', (e) => {
        try {
            const path = e.composedPath ? e.composedPath() : [e.target];
            let target = path[0];
            for (let i = 0; i < 4; i++) {
                if (!target || !target.getAttribute) break;
                const sources = [target.textContent, target.innerText, target.getAttribute('alt'), target.getAttribute('title'), target.getAttribute('aria-label'), target.getAttribute('data-episode'), target.value];
                for (const rawText of sources) {
                    if (!rawText || typeof rawText !== 'string') continue;
                    const numMatch = rawText.match(/\b(\d{1,4})\b/);
                    if (numMatch) {
                        const val = parseInt(numMatch[1]);
                        if (val < 1900 && rawText.length < 50) {
                            const ep = numMatch[1].padStart(2, '0');
                            lastUserSelectedEpisode = ep;
                            saveEpisodeChoice(ep);
                            try {
                                if (window.top !== window.self) {
                                    window.top.postMessage({ type: 'DOULGET_EPISODE_CLICK', episode: ep, source: 'iframe' }, '*');
                                }
                            } catch(e) {}
                            return;
                        }
                    }
                }
                target = target.parentElement || target.parentNode;
            }
        } catch(err) {}
    }, true);

    window.addEventListener('message', (e) => {
        try {
            if (e.data && e.data.type === 'DOULGET_EPISODE_CLICK' && e.data.episode) {
                lastUserSelectedEpisode = e.data.episode;
                saveEpisodeChoice(e.data.episode);
            }
        } catch(err) {}
    });

    try {
        const storedEpisode = loadEpisodeChoice();
        if (storedEpisode) lastUserSelectedEpisode = storedEpisode;
    } catch(e) {}

    // [v1.9.27] INTERNAL HELPERS (Metadata Extraction)
    // Moved to main closure scope so they are accessible by BOTH buttons and background sync
    function getSeriesMetadataFromDOM() {
        const currentUrl = location.href;
        if (currentUrl.includes('youtube.com') || currentUrl.includes('youtu.be') || currentUrl.includes('facebook.com') || currentUrl.includes('instagram.com')) return null;

        const patterns = [/S(\d+)[._-\s]?E(\d+)/i, /Saison[._-\s]?(\d+)[._-\s]?Episode[._-\s]?(\d+)/i, /Season[._-\s]?(\d+)[._-\s]?Episode[._-\s]?(\d+)/i, /(\d+)x(\d+)/i, /Episode[._-\s]?(\d+)/i, /Ep[._-\s]?(\d+)/i];
        const activeSelectors = ['.active', '.selected', '.current', '.active-episode', '.is-active', '[class*="active"]', '[class*="selected"]', '.playing', '.now-playing', '[aria-selected="true"]', '.on', 'li.active a', 'a.active', '.active-ep'];
        
        let detectedS = null, detectedE = null, candidateE = null;

        // STRATEGY 1: Look for season containers and find active child within them
        const seasonContainerSelectors = [
            '[class*="season"] .active', '[class*="season"] .selected', '[class*="season"] [class*="active"]',
            '[class*="saison"] .active', '[class*="saison"] .selected', '[class*="saison"] [class*="active"]',
            '.season-list .active', '.season-tabs .active', '.season-nav .active',
            '[class*="season-item"][class*="active"]', '[class*="season"][class*="current"]',
            '.tab-content.active [class*="season"]', '.nav-item.active [class*="season"]'
        ];
        for (const sel of seasonContainerSelectors) {
            try {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const t = el.textContent.trim();
                    const sMatch = t.match(/(?:Saison|Season|S)[._\-\s]?(\d+)/i) || t.match(/^(\d+)$/);
                    if (sMatch) { 
                        detectedS = sMatch[1].padStart(2, '0'); 
                        break; 
                    }
                }
            } catch(e) {}
            if (detectedS) break;
        }

        // STRATEGY 2: Classic active selector scan
        if (!detectedS) {
            for (const sel of activeSelectors) {
                const tabs = document.querySelectorAll(sel);
                for (const tab of tabs) {
                    const t = tab.textContent.trim();
                    if (/Episode|Ep\s?\d/i.test(t)) continue;
                    const rangeMatch = t.match(/(?:Saison|Season|S)[._-\s]?(\d+)[-](?:Saison|Season|S)?\d+/i);
                    if (rangeMatch) { detectedS = rangeMatch[1].padStart(2, '0'); break; }
                    const sMatch = t.match(/(?:Saison|Season|S)[._-\s]?(\d+)/i);
                    if (sMatch && !t.includes('Episode')) { detectedS = sMatch[1].padStart(2, '0'); break; }
                }
                if (detectedS) break;
            }
        }

        // STRATEGY 3: Dropdown / select scan
        if (!detectedS) {
            const dropdowns = document.querySelectorAll('select, .dropdown-toggle, .current-season, .season-select, [class*="season"] select, .select-value, .select-trigger, .custom-select');
            for (const dd of dropdowns) {
                let val = dd.tagName === 'SELECT' && dd.selectedIndex >= 0 ? (dd.options[dd.selectedIndex].text || dd.options[dd.selectedIndex].textContent) : (dd.value || dd.textContent.trim());
                const sMatch = val.match(/(?:Saison|Season|S)[._-\s]?(\d+)/i);
                if (sMatch) { detectedS = sMatch[1].padStart(2, '0'); break; }
            }
        }

        // STRATEGY 4: URL path-based detection
        if (!detectedS) {
            const urlStr = window.location.href;
            const urlSMatch = urlStr.match(/[/\-_.](?:season|saison|s)[-_.]?(\d+)/i);
            if (urlSMatch) { detectedS = urlSMatch[1].padStart(2, '0'); }
        }

        // STRATEGY 5: Page title / heading / breadcrumb fallback
        if (!detectedS || detectedS === '00') {
            const titleSources = [document.title, document.querySelector('h1')?.textContent || '', document.querySelector('.breadcrumb')?.textContent || '', document.querySelector('[class*="season"]')?.textContent || ''].join(' ');
            const titleSMatch = titleSources.match(/(?:Saison|Season)\s?(\d+)/i);
            if (titleSMatch && titleSMatch[1] !== '0') { detectedS = titleSMatch[1].padStart(2, '0'); }
        }

        for (const sel of activeSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (!el || !el.textContent) continue;
                const t = el.textContent.trim();
                for (const p of patterns) {
                    const m = t.match(p);
                    if (m) {
                        if (m[2]) { detectedS = m[1].padStart(2, '0'); detectedE = m[2].padStart(2, '0'); }
                        else { detectedE = m[1].padStart(2, '0'); }
                        break;
                    }
                }
                if (detectedE) break;
                const looseEx = t.match(/\b(\d{1,3})\b/);
                if (looseEx && t.length < 15) {
                    const val = parseInt(looseEx[1]);
                    if (val < 1900) candidateE = looseEx[1].padStart(2, '0');
                }
            }
            if (detectedE) break;
        }

        if (!detectedE && candidateE) {
            const context = detectedS || /Saison|Season|S\d+/i.test(document.title);
            if (context) { detectedE = candidateE; if (!detectedS) detectedS = '01'; }
        }

        if (!detectedE && lastUserSelectedEpisode) detectedE = lastUserSelectedEpisode;

        if (detectedE === '00') detectedE = null; 

        if (detectedE) {
            // [v1.9.32] Range validation to avoid resolution (1920x1080) or other numbers
            const sVal = parseInt(detectedS || '1');
            const eVal = parseInt(detectedE);
            if (sVal > 100 || eVal > 1000) return null;

            if (!detectedS) {
                const rangeTitle = document.title.match(/(?:S|Saison)\s?(\d+)[-–—]?S?\d+/i);
                if (rangeTitle) detectedS = rangeTitle[1].padStart(2, '0');
            }
            if (!detectedS || detectedS === '00') detectedS = '01';
            
            // [v1.9.32] Domain-based override for known film sites
            if (currentUrl.includes('palkad') && !/Saison|Season/i.test(document.title)) {
                return null; // Skip metadata on Palkad if it's not explicitly labeled as series
            }

            return `S${detectedS}E${detectedE}`;
        }
        return null;
    }

    function getCleanTitle() {
        const genericNames = ['free movies', 'watch online', 'streaming', 'lok-lok', 'loklok', 'hakunaymatata', 'moovbob', 'film streaming', 'regarder', 'gratuit', 'vostfr', 'vf'];
        const isInIframe = (window !== window.top);
        
        const isGeneric = (t) => {
            if (!t || t.length < 3) return true;
            const lower = t.toLowerCase();
            return genericNames.some(g => lower.includes(g)) && t.length < 40;
        };

        const looksLikeHash = (s) => {
            if (!s || s.length < 3) return true;
            if (!/[\s\-_]/.test(s) && /\d/.test(s) && s.length < 30) return true;
            if (/^[A-Za-z0-9]+$/.test(s) && s.length < 20 && !/[\s\-_]/.test(s)) return true;
            if (/^(iframe|embed|player|watch|video|play)$/i.test(s)) return true;
            return false;
        };

        if (isInIframe) {
            const iframeOgTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
            if (iframeOgTitle && !isGeneric(iframeOgTitle) && !looksLikeHash(iframeOgTitle)) return iframeOgTitle;
            
            // [v1.9.28] Explicitly detect video hosts that need tab title fallback
            if (window.location.hostname.includes('vidzy.org') || window.location.hostname.includes('sibnet.ru')) {
                return 'download'; 
            }
            return 'download'; 
        }

        const isSocial = ['youtube.com', 'youtu.be', 'facebook.com', 'instagram.com'].some(s => window.location.hostname.includes(s));
        let title = '';

        if (isSocial) {
            title = document.querySelector('h1')?.textContent?.trim() || document.title.replace(/ - YouTube$/, '').trim();
        } else {
            title = document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
            if (isGeneric(title)) title = document.querySelector('h1')?.textContent?.trim() || '';
        }

        if (isGeneric(title)) {
            // [v1.9.28] French-Stream specific selectors
            const titleSelectors = ['.pc-detail-title', '.pc-video-title', '.video-title', '.movie-title', '.title-name', '.detail-title', '.pc-detail-title', '[class*="title"]'];
            for (const sel of titleSelectors) {
                try {
                    const el = document.querySelector(sel);
                    if (el) {
                        const t = el.textContent.trim();
                        if (t.length > 2 && t.length < 120 && !isGeneric(t)) { title = t; break; }
                    }
                } catch(e) {}
            }
        }

        if (isGeneric(title)) {
            try {
                const pathParts = window.location.pathname.split('/').filter(p => p.length > 3);
                const slug = pathParts[pathParts.length - 1] || '';
                if (slug.length > 5 && !looksLikeHash(slug)) {
                    // [v1.9.28] Handle numeric prefixes (e.g. 15124786-pavane.html)
                    let cleanSlug = slug.replace(/^\d+[-_]/, '').replace(/\.html?$/i, '');
                    cleanSlug = cleanSlug.replace(/[-_][A-Za-z0-9]{8,}$/, '').replace(/[-_]\d{10,}$/, '');
                    cleanSlug = cleanSlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
                    if (cleanSlug.length > 3 && !isGeneric(cleanSlug) && !looksLikeHash(cleanSlug)) title = cleanSlug;
                }
            } catch(e) {}
        }

        if (isGeneric(title)) title = (document.title || '').replace(/\s+/g, ' ').trim();

        title = title.replace(/(?:Saison|Season|S)[._-\s]?\d+/gi, ' ')
                     .replace(/(?:Episode|Ep|E)[._-\s]?\d+/gi, ' ')
                     .replace(/\d+x\d+/gi, ' ')
                     .replace(/[-–—|]\s*(Free Movies|Watch|Online|Streaming|HD|VF|VOSTFR|Gratuit).*/gi, '')
                     .replace(/\s+/g, ' ')
                     .trim()
                     .replace(/[\s\-–—_|:.,;]+$/, '').trim();

        const metadata = getSeriesMetadataFromDOM();
        if (metadata) {
            title = title.replace(/(?:^|[\s_.\-\[(])S\d+\s*[-–—]\s*S?\d+(?:$|[\s_.\-\])])/gi, ' ')
                         .replace(/(?:^|[\s_.\-\[(])Saison\s?\d+\s*[-–—]\s*\d+(?:$|[\s_.\-\])])/gi, ' ')
                         .replace(/\s+/g, ' ').trim();
            if (!title.includes(metadata) && !/S\d+E\d+/i.test(title)) title = `${title} ${metadata}`;
        }
        return title || 'download';
    }

    // VIDEO OVERLAY BUTTON
    function setupVideoOverlays() {
        const url = location.href;

        // [v1.3.8] SITE BLACKLIST - Productivity sites where we avoid video overlays
        const siteBlacklist = [
            'mail.google.com', 'gmail.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com',
            'docs.google.com', 'sheets.google.com', 'slides.google.com', 'drive.google.com',
            'accounts.google.com', 'myaccount.google.com', 'web.whatsapp.com', 'web.telegram.org',
            'notion.so', 'trello.com', 'slack.com', 'figma.com', 'canva.com'
        ];
        if (siteBlacklist.some(site => url.includes(site))) {
            return; // Skip entirely on non-video sites
        }

        const videos = findAllVideos();
        const downloadLinks = findAllDownloadLinks();
        console.log(`🎬 Setting up overlays for ${videos.length} videos and ${downloadLinks.length} download links`);

        videos.forEach(attachButton);
        
        // [v1.2.3] Wrap in try-catch to prevent iframe/cross-origin errors from stopping the loop
        downloadLinks.forEach(link => {
            try {
                attachLinkButton(link);
            } catch (e) {
                console.warn('[DoulGet] Failed to attach button to link:', link.href, e);
            }
        });
    }

    function attachButton(video) {
        // [v1.1.3] Prevent multiple buttons on sites with many iframes (YouTube)
        const isTopFrame = window === window.top;
        const currentUrl = location.href;
        const videoSrc = video.currentSrc || video.src;

        const isSocialSite = ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com'].some(site => currentUrl.includes(site));

        // On social sites, only attach to top frame to avoid duplicates from tracking iframes
        if (isSocialSite && !isTopFrame) return;

        // [v1.9.31] SPA FIX: Check if URL or video source changed
        if (video.hasAttribute('data-doul-attached')) {
            const lastSrc = video.getAttribute('data-doul-last-url');
            const lastHref = video.getAttribute('data-doul-last-href');
            if ((lastSrc && lastSrc !== videoSrc) || (lastHref && lastHref !== currentUrl)) {
                // [v1.3.7] NEVER remove if a download is currently active in this container
                const isDownloading = video.doulContainer && video.doulContainer.innerText.includes('%');
                if (isDownloading) return; 

                console.log('[DoulGet] Navigation detected (SPA), refreshing buttons...');
                if (video.doulContainer) {
                    video.doulContainer.remove();
                    video.doulContainer = null;
                }
                video.removeAttribute('data-doul-attached');
            } else {
                return; // Already attached and same state
            }
        }
        
        video.setAttribute('data-doul-attached', 'true');
        video.setAttribute('data-doul-last-url', videoSrc);
        video.setAttribute('data-doul-last-href', currentUrl);

        // [v1.3.9] AGGRESSIVE CLEANUP: Remove ANY existing containers in the document that aren't linked to an active video
        // This stops "ghost" buttons from persisting after SPA navigation
        const allVideos = findAllVideos();
        document.querySelectorAll('.doul-download-container').forEach(cont => {
             const isUsed = allVideos.some(v => v.doulContainer === cont);
             if (!isUsed) cont.remove();
        });

        const container = document.createElement('div');
        video.doulContainer = container; 
        container.className = 'doul-download-container';

        // [v1.3.9] SITE DETECTION: Social and Adult sites often have top titles or overlays
        const overlaidSites = ['facebook.com', 'fb.com', 'fb.watch', 'tiktok.com', 'instagram.com', 'xvideos.com', 'xnxx.com', 'pornhub.com', 'youporn.com'];
        const isOverlaid = overlaidSites.some(s => location.href.includes(s));
        
        const posTop = isOverlaid ? 'auto' : '10px';
        const posBottom = isOverlaid ? '120px' : 'auto';

        container.style.cssText = `
            all: unset !important;
            position: absolute !important;
            top: ${posTop} !important;
            bottom: ${posBottom} !important;
            left: 10px !important;
            z-index: 2147483647 !important;
            display: inline-flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            align-items: center !important;
            justify-content: flex-start !important;
            gap: 10px !important;
            padding: 8px !important;
            border-radius: 12px !important;
            background: rgba(15, 23, 42, 0.7) !important;
            backdrop-filter: blur(10px) !important;
            -webkit-backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
            width: auto !important;
            height: auto !important;
            white-space: nowrap !important;
            pointer-events: auto !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            transform: none !important;
            -webkit-transform: none !important;
            rotate: none !important;
            scale: none !important;
            direction: ltr !important;
            writing-mode: horizontal-tb !important;
            unicode-bidi: isolate !important;
            isolation: isolate !important;
            visibility: visible !important;
            opacity: 0.95 !important;
`;

        function createActionButton(text, isAudio) {
            const btn = document.createElement('button');
            btn.innerHTML = text;
            btn.style.cssText = `
                all: unset !important;
                background: ${isAudio ? '#6366f1' : '#007AFF'} !important;
                color: #ffffff !important;
                border: none !important;
                padding: 6px 12px !important;
                border-radius: 6px !important;
                cursor: pointer !important;
                font-size: 12px !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-weight: 600 !important;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;
                opacity: 0.98 !important;
                transition: all 0.2s ease !important;
                white-space: nowrap !important;
                display: inline-flex !important;
                flex-shrink: 0 !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 5px !important;
                transform: none !important;
                -webkit-transform: none !important;
                rotate: none !important;
                scale: none !important;
                direction: ltr !important;
                writing-mode: horizontal-tb !important;
                unicode-bidi: isolate !important;
                pointer-events: auto !important;
                visibility: visible !important;
                isolation: isolate !important;
                z-index: 2147483647 !important;
            `;

            btn.onmouseenter = () => {
                btn.style.opacity = '1';
                btn.style.setProperty('transform', 'rotate(0deg) translateY(-1px)', 'important');
                btn.style.boxShadow = `0 4px 12px ${isAudio ? 'rgba(99, 102, 241, 0.4)' : 'rgba(0, 122, 255, 0.4)'} !important`;
            };
            btn.onmouseleave = () => {
                btn.style.opacity = '0.95';
                btn.style.setProperty('transform', 'rotate(0deg) translateY(0)', 'important');
                btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3) !important';
            };

            // Internal helpers
            // [v1.9.27] Functions moved to main scope for periodic background sync

            // [v1.9.27] Using module-scope getCleanTitle()

            btn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                const currentUrl = location.href;
                let downloadUrl = null, cachedHeaders = {};

                // [v1.3.6] Sites where yt-dlp handles extraction via page URL
                // CDN URLs from these sites are DASH segments, NOT full videos
                const usePageUrlSites = ['xnxx.com', 'xvideos.com', 'pornhub.com', 'redtube.com', 'youporn.com', 'spankbang.com', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.com', 'fb.watch', 'tiktok.com', 'instagram.com'];
                const isPageUrlSite = usePageUrlSites.some(site => currentUrl.includes(site));
                
                if (isPageUrlSite) {
                    // [v1.3.6] For these sites, ALWAYS use page URL (yt-dlp will extract the proper video)
                    // NEVER use CDN segments from the network sniffer
                    downloadUrl = currentUrl;
                    console.log('[DoulGet] 📹 Using PAGE URL for yt-dlp extraction:', downloadUrl);
                } else {
                    // For other sites: try CDN mapping first, then background cache
                    // PRIORITY 1: Local Video Mapping
                    const mapped = videoUrlMap.get(video);
                    if (mapped && mapped.cdnUrl) {
                        downloadUrl = mapped.cdnUrl;
                        cachedHeaders = mapped.headers || {};
                        console.log('[DoulGet] 📹 Using local mapped CDN URL:', downloadUrl);
                        if (!cachedHeaders.Referer) cachedHeaders.Referer = location.href;
                    }
                    
                    // PRIORITY 2: Background Cache
                    if (!downloadUrl) {
                        try {
                            const res = await chrome.runtime.sendMessage({ action: 'getCachedVideoUrl' });
                            if (res && res.success && res.url) { 
                                downloadUrl = res.url; 
                                cachedHeaders = res.headers || {}; 
                                console.log('[DoulGet] 📹 Using background cached URL:', downloadUrl);
                            }
                        } catch (err) { }
                    }

                    // PRIORITY 3: Waiting sites or page URL fallback
                    if (!downloadUrl) {
                        if (['lok-lok.cc', 'hakunaymatata.com', 'moovbob.fr'].some(site => currentUrl.includes(site))) {
                            btn.textContent = '🔍 Waiting for link...';
                            setTimeout(() => { btn.innerHTML = text; }, 3000); return;
                        }
                        downloadUrl = currentUrl;
                    }
                }

                // [v1.3.6] Try to find the direct video permalink on social feeds
                if (['tiktok.com', 'instagram.com', 'facebook.com', 'fb.com'].some(site => currentUrl.includes(site))) {
                    if (!currentUrl.includes('/video/') && !currentUrl.includes('/p/') && !currentUrl.includes('/reel/') && !currentUrl.includes('/watch/') && !currentUrl.includes('/videos/')) {
                        let p = video.parentElement, found = null;
                        for (let i = 0; i < 10; i++) {
                            if (!p) break;
                            const a = p.querySelector('a[href*="/video/"], a[href*="/reel/"], a[href*="/p/"], a[href*="/watch/"], a[href*="/videos/"]');
                            if (a) { found = a.getAttribute('href'); break; }
                            p = p.parentElement;
                        }
                        if (found) downloadUrl = found.startsWith('/') ? window.location.origin + found : found;
                    }
                }

                try {
                    const cleanTitle = getCleanTitle();
                    const filename = `${cleanTitle}${isAudio ? '.mp3' : '.mp4'}`;
                    btn.textContent = '...';
                    if (!isContextValid()) { btn.textContent = '🔄 Refresh'; return; }

                    chrome.runtime.sendMessage({ action: 'sendDownload', url: downloadUrl, filename: filename, type: isAudio ? 'audio/mpeg' : 'video/mp4', audioOnly: isAudio, headers: cachedHeaders }, (response) => {
                        if (chrome.runtime.lastError || !response?.success) { btn.textContent = '🔄 Refresh'; return; }
                        btn.textContent = '⏳'; btn.style.pointerEvents = 'none';
                        let lastPercentage = 0;
                        let errorCount = 0;
                        let pollCount = 0;
                        const maxPolls = 7200; // 2 hours max polling

                        const poll = setInterval(() => {
                            try {
                                if (!isContextValid() || pollCount++ > maxPolls) { 
                                    clearInterval(poll); 
                                    btn.innerHTML = text; 
                                    btn.style.pointerEvents = 'all'; 
                                    return; 
                                }

                                chrome.runtime.sendMessage({ action: 'getDownloadStatus', url: downloadUrl, audioOnly: isAudio }, (res) => {
                                    try {
                                        if (chrome.runtime.lastError) { 
                                            if (errorCount++ > 5) { clearInterval(poll); btn.innerHTML = text; btn.style.pointerEvents = 'all'; }
                                            return; 
                                        }
                                        
                                        errorCount = 0; // Reset on success

                                        if (!res?.success) {
                                            // [v1.3.7] SYNC FIX: If download is not found but we were near the end, it's likely finished
                                            if (lastPercentage > 95) {
                                                clearInterval(poll);
                                                btn.textContent = '✅';
                                                btn.style.background = '#34C759 !important';
                                                setTimeout(() => { 
                                                    btn.innerHTML = text; 
                                                    btn.style.background = (isAudio ? '#6366f1' : '#007AFF') + ' !important'; 
                                                    btn.style.pointerEvents = 'all'; 
                                                }, 2000);
                                            }
                                            return;
                                        }

                                        const data = res.data;
                                        if (data.status === 'completed') {
                                            clearInterval(poll); btn.textContent = '✅'; btn.style.background = '#34C759 !important';
                                            setTimeout(() => { btn.innerHTML = text; btn.style.background = (isAudio ? '#6366f1' : '#007AFF') + ' !important'; btn.style.pointerEvents = 'all'; }, 2000);
                                        } else if (data.status === 'downloading' || data.status === 'waiting' || data.status === 'paused') {
                                            lastPercentage = Math.round(data.progress);
                                            btn.textContent = data.status === 'paused' ? '⏸' : `${lastPercentage}%`;
                                        } else if (['error', 'cancelled'].includes(data.status)) { 
                                            clearInterval(poll); 
                                            btn.textContent = data.status === 'cancelled' ? '🚫' : '❌'; 
                                            setTimeout(() => { btn.innerHTML = text; btn.style.pointerEvents = 'all'; }, 2000); 
                                        }
                                    } catch(e) { clearInterval(poll); }
                                });
                            } catch(e) { clearInterval(poll); btn.innerHTML = text; btn.style.pointerEvents = 'all'; }
                        }, 1000);
                        btn.doulPollInterval = poll;
                    });
                } catch (e) { btn.textContent = '🔄 Refresh'; }
            };

            return btn;
        }

        const btnVideo = createActionButton('🎬 Vidéo', false), btnAudio = createActionButton('🎵 Audio', true);
        container.appendChild(btnVideo); container.appendChild(btnAudio);

        // [v1.3.4] INJECT INTO PLAYER CONTAINER (universal approach)
        // Find the best parent container for the buttons
        let parentContainer = null;
        const url = location.href;
        
        if (url.includes('youtube.com')) {
            parentContainer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player') || document.querySelector('#player-container-inner');
        } else {
            // Universal approach: walk up the DOM tree to find a suitable sized container
            let candidate = video.parentElement;
            for (let i = 0; i < 10 && candidate && candidate !== document.body; i++) {
                const cRect = candidate.getBoundingClientRect();
                if (cRect.width >= 200 && cRect.height >= 100) {
                    parentContainer = candidate;
                    break;
                }
                candidate = candidate.parentElement;
            }
        }
        
        // Fallback: use the video's parent element
        if (!parentContainer) {
            parentContainer = video.parentElement || document.body;
        }
        
        // Ensure parent has position:relative so absolute positioning works
        const parentStyle = window.getComputedStyle(parentContainer);
        if (parentStyle.position === 'static') {
            parentContainer.style.setProperty('position', 'relative', 'important');
        }
        
        // [v1.3.10] Idempotency: don't double-inject in the SAME player container
        const existing = parentContainer.querySelector('.doul-download-container');
        if (existing) {
             if (video.doulContainer !== existing) {
                 // Use the existing one instead of adding another.
                 if (video.doulContainer && video.doulContainer.parentNode) {
                     video.doulContainer.remove();
                 }
                 video.doulContainer = existing;
                 video.setAttribute('data-doul-attached', 'true');
             }
             return;
        }

        parentContainer.appendChild(container);

        // [v1.3.3] No need for complex position calculation - absolute top:10 left:10 does the job
        function updateButtonPosition() {
            try {
                const rect = video.getBoundingClientRect();
                if (rect.width > 20 && rect.height > 20) {
                    container.style.display = 'inline-flex';
                } else {
                    container.style.display = 'none';
                }
            } catch (e) { container.style.display = 'none'; }
        }

        function resetStates() {
            [btnVideo, btnAudio].forEach(b => { if (b.doulPollInterval) clearInterval(b.doulPollInterval); b.doulPollInterval = null; b.style.pointerEvents = 'all'; });
            btnVideo.innerHTML = '🎬 Vidéo'; btnAudio.innerHTML = '🎵 Audio';
            btnVideo.style.background = '#007AFF !important'; btnAudio.style.background = '#6366f1 !important';
        }

        video.addEventListener('loadstart', resetStates); video.addEventListener('emptied', resetStates);
        updateButtonPosition();
        const posInt = setInterval(() => { if (!isContextValid()) { clearInterval(posInt); return; } updateButtonPosition(); updateLinkPositions(); }, 500);
    }

    // [v1.2.2] New helper to update link button positions
    function updateLinkPositions() {
        document.querySelectorAll('.doul-download-link-btn').forEach(btn => {
            try {
                const link = btn.doulTargetLink;
                if (link && link.isConnected) {
                    const rect = link.getBoundingClientRect();
                    // [v1.2.3] More robust visibility check
                    const isVisible = rect.width > 0 && rect.height > 0 && 
                                    rect.top < window.innerHeight && rect.bottom > 0 &&
                                    rect.left < window.innerWidth && rect.right > 0;

                    if (isVisible) {
                        btn.style.setProperty('top', `${rect.top + window.scrollY + (rect.height / 2) - 10}px`, 'important');
                        btn.style.setProperty('left', `${rect.right + window.scrollX + 8}px`, 'important');
                        btn.style.setProperty('display', 'inline-flex', 'important');
                    } else {
                        btn.style.setProperty('display', 'none', 'important');
                    }
                } else {
                    btn.remove();
                }
            } catch (e) {
                btn.style.display = 'none';
            }
        });
    }

    // ATTACH DOWNLOAD BUTTON TO DOCUMENT LINKS
    function attachLinkButton(link) {
        if (link.hasAttribute('data-doul-attached')) return;
        link.setAttribute('data-doul-attached', 'true');

        const btn = document.createElement('a');
        btn.className = 'doul-download-link-btn';
        btn.doulTargetLink = link; // [v1.2.2] Link back to original anchor
        btn.title = 'Télécharger avec DoulGet';
        btn.href = '#';
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            DoulGet
        `;

        btn.style.cssText = `
            all: unset !important;
            position: absolute !important;
            z-index: 2147483647 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 2px 10px !important;
            border-radius: 20px !important;
            background: linear-gradient(135deg, #007AFF, #5B4BF5) !important;
            color: #ffffff !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            text-decoration: none !important;
            cursor: pointer !important;
            vertical-align: middle !important;
            border: none !important;
            box-shadow: 0 2px 6px rgba(0,122,255,0.35) !important;
            transition: opacity 0.2s ease, background 0.2s ease !important;
            opacity: 0.98 !important;
            letter-spacing: 0.2px !important;
            white-space: nowrap !important;
            line-height: normal !important;
            transform: none !important;
            -webkit-transform: none !important;
            rotate: none !important;
            scale: none !important;
            transform-origin: center center !important;
            direction: ltr !important;
            writing-mode: horizontal-tb !important;
            unicode-bidi: isolate !important;
            filter: none !important;
            visibility: visible !important;
            pointer-events: auto !important;
            -webkit-user-select: none !important;
            user-select: none !important;
            isolation: isolate !important;
        `;

        btn.onmouseenter = () => {
            btn.style.setProperty('transform', 'rotate(0deg) scale(1.08) translateY(-1px)', 'important');
            btn.style.boxShadow = '0 4px 12px rgba(0,122,255,0.5) !important';
        };
        btn.onmouseleave = () => {
            btn.style.opacity = '0.92';
            btn.style.setProperty('transform', 'rotate(0deg) scale(1) translateY(0)', 'important');
            btn.style.boxShadow = '0 2px 6px rgba(0,122,255,0.35) !important';
        };

        btn.onclick = async (e) => {
            console.log('🖱️ DoulGet Link Button Clicked:', link.href);
            e.preventDefault();
            e.stopPropagation();

            const downloadUrl = link.href || link.getAttribute('data-doul-href');
            if (!downloadUrl) return;

            let filename = link.download || link.getAttribute('download') || link.textContent.trim();
            if (!filename || filename.length > 50) filename = downloadUrl.split('/').pop().split('?')[0];
            if (!filename || filename.length < 3) filename = 'download';

            console.log('📄 Document download requested:', downloadUrl);

            // Send to DoulGet via Background (to avoid Mixed Content HTTPS -> HTTP errors)
            let type = 'application/octet-stream';
            const lowerUrl = downloadUrl.toLowerCase();
            if (lowerUrl.includes('.pdf')) type = 'application/pdf';
            else if (lowerUrl.includes('.zip')) type = 'application/zip';
            else if (lowerUrl.includes('.rar')) type = 'application/x-rar-compressed';
            else if (lowerUrl.includes('.7z')) type = 'application/x-7z-compressed';
            else if (lowerUrl.includes('.exe') || lowerUrl.includes('.msi')) type = 'application/x-msdownload';
            
            if (!isContextValid()) {
                btn.innerHTML = ' ❌';
                return;
            }

            chrome.runtime.sendMessage({ 
                action: 'sendDownload', 
                url: downloadUrl, 
                filename: filename, 
                type: type, 
                headers: {
                    'User-Agent': navigator.userAgent,
                    'Referer': location.href
                }
            }, (response) => {
                if (chrome.runtime.lastError || !response?.success) {
                    console.error('❌ Failed to send download request:', chrome.runtime.lastError);
                    btn.innerHTML = '❌ Erreur';
                    btn.style.background = 'linear-gradient(135deg, #dc3545, #c82333) !important';
                } else {
                    btn.innerHTML = '✅ Ajouté!';
                    btn.style.background = 'linear-gradient(135deg, #28a745, #1e7e34) !important';
                    console.log('✅ Download request sent to DoulGet via Background');
                }

                setTimeout(() => {
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        DoulGet
                    `;
                    btn.style.background = 'linear-gradient(135deg, #007AFF, #5B4BF5) !important';
                }, 2000);
            });
        };

        // [v1.2.2] Move button to document body to avoid parent CSS transforms (mirroring/rotation)
        document.body.appendChild(btn);
        updateLinkPositions();
        console.log('✅ Download button attached to link:', link.href.substring(0, 60));
    }

    // [v1.3.8] FLOATING CAPTURE NOTIFICATION (For ZIP, PDF, etc.)
    let currentFloatingCapture = null;
    function showFloatingCapture(url, filename, headers) {
        console.log('[DoulGet] Displaying capture bar...');
        if (!isContextValid()) return;
        if (currentFloatingCapture) currentFloatingCapture.remove();

        const bar = document.createElement('div');
        bar.id = 'doulget-capture-bar';
        const cleanName = filename || url.split('/').pop().split('?')[0] || 'Fichier détecté';
        
        bar.style.cssText = `
            all: unset !important;
            position: fixed !important;
            top: 15px !important;
            right: 15px !important;
            width: 380px !important;
            background: #1c1c1e !important;
            border: 2px solid #007AFF !important;
            border-radius: 14px !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6) !important;
            z-index: 2147483647 !important;
            padding: 12px 16px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
            color: #ffffff !important;
            animation: doulSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
            pointer-events: auto !important;
            visibility: visible !important;
        `;

        // Add keyframes if not present
        if (!document.getElementById('doulget-animations')) {
            const style = document.createElement('style');
            style.id = 'doulget-animations';
            style.textContent = `
                @keyframes doulSlideIn {
                    from { opacity: 0; transform: translateX(30px) scale(0.95); }
                    to { opacity: 1; transform: translateX(0) scale(1); }
                }
                @keyframes doulSlideOut {
                    from { opacity: 1; transform: translateX(0) scale(1); }
                    to { opacity: 0; transform: translateX(30px) scale(0.95); }
                }
            `;
            document.head.appendChild(style);
        }

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; width:100%';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px">
                <div style="width:32px; height:32px; background:linear-gradient(135deg, #007AFF, #5B4BF5); border-radius:8px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,122,255,0.4)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </div>
                <span style="font-size:13px; font-weight:700; letter-spacing:0.3px">DoulGet Capture</span>
            </div>
            <button id="doul-close-bar" style="all:unset; cursor:pointer; opacity:0.5; padding:4px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        const body = document.createElement('div');
        body.style.cssText = 'font-size:12px; opacity:0.9; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%';
        body.textContent = cleanName;

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex; gap:8px; margin-top:4px';

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'Télécharger';
        downloadBtn.style.cssText = `
            all: unset !important;
            flex: 1 !important;
            background: #007AFF !important;
            color: white !important;
            padding: 8px !important;
            border-radius: 8px !important;
            text-align: center !important;
            font-size: 13px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            transition: background 0.2s !important;
        `;
        downloadBtn.onclick = () => {
            downloadBtn.textContent = 'Envoi...';
            downloadBtn.style.background = '#1e7e34';
            chrome.runtime.sendMessage({
                action: 'sendDownload',
                url: url,
                filename: cleanName,
                headers: headers
            }, (res) => {
                if (res?.success) {
                    downloadBtn.textContent = '✅ Ajouté !';
                    setTimeout(dismiss, 1500);
                } else {
                    downloadBtn.textContent = '❌ Erreur';
                }
            });
        };

        const ignoreBtn = document.createElement('button');
        ignoreBtn.textContent = 'Ignorer';
        ignoreBtn.style.cssText = `
            all: unset !important;
            padding: 8px 16px !important;
            border-radius: 8px !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            background: rgba(255,255,255,0.05) !important;
            transition: background 0.2s !important;
        `;
        ignoreBtn.onclick = dismiss;

        function dismiss() {
            bar.style.animation = 'doulSlideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards !important';
            setTimeout(() => {
                if (bar.parentNode) bar.remove();
                if (currentFloatingCapture === bar) currentFloatingCapture = null;
            }, 300);
        }

        footer.appendChild(ignoreBtn);
        footer.appendChild(downloadBtn);
        bar.appendChild(header);
        bar.appendChild(body);
        bar.appendChild(footer);

        // [v1.3.8-fix] Ensure close button listener is attached after elements are in DOM
        const closeBtn = bar.querySelector('#doul-close-bar');
        if (closeBtn) closeBtn.onclick = dismiss;
        
        document.body.appendChild(bar);
        currentFloatingCapture = bar;

        // Auto-dismiss after 15 seconds
        setTimeout(() => {
            if (currentFloatingCapture === bar) dismiss();
        }, 15000);
    }

    // Run overlay check periodically
    setupVideoOverlays(); // Initial run
    const overlayInterval = setInterval(() => {
        if (!isContextValid()) {
            clearInterval(overlayInterval);
            return;
        }
        setupVideoOverlays();

        // [v1.9.27] Periodic Metadata Reporting (Top Frame Only)
        if (window === window.top) {
            const metadata = getSeriesMetadataFromDOM();
            if (metadata) {
                chrome.runtime.sendMessage({ 
                    action: 'reportMetadata', 
                    metadata: metadata,
                    title: getCleanTitle().replace(metadata, '').trim()
                });
            }
        }
    }, 2000); // Check every 2 seconds

    // [v1.3.8-pdf] Auto-detect if current page is a PDF (already opened)
    if (window.location.href.toLowerCase().split('?')[0].endsWith('.pdf')) {
        console.log('[DoulGet] PDF Viewer detected, triggering capture bar...');
        setTimeout(() => {
            showFloatingCapture(window.location.href, document.title || 'Fichier PDF');
        }, 1500); // Small delay to let UI settle
    }
    
    console.log('✅ DoulGet overlay system initialized (v1.3.8)');
})();
