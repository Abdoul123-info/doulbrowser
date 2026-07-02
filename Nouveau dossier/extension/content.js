// DoulGet Content Script - IDM Method
// Network Sniffer + Video Element Mapping
// Restored from v1.9.4 with 2026 Lok-lok Fix (v1.9.6)

(function () {
    console.log('🚀 DoulGet UI Manager - IDM Method ACTIVE (v1.9.9)');

    // ============================================
    // GM_ API BRIDGE FOR MAIN WORLD COMPATIBILITY
    // ============================================

    function isContextValid() {
        try {
            return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
        } catch(e) { return false; }
    }

    function dgetMessage(key, fallback = '') {
        try {
            if (typeof chrome !== 'undefined' && chrome.i18n) {
                return chrome.i18n.getMessage(key) || fallback;
            }
        } catch (e) {}
        return fallback;
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.type !== 'DOULGET_GM_BRIDGE' || event.data.responseId) return;
        if (!isContextValid()) return;
        const { action, details, id } = event.data;
        chrome.runtime.sendMessage({ action, details }, (response) => {
            if (chrome.runtime.lastError) return;
            window.postMessage({
                type: 'BRIDGE_RESPONSE',
                id: id,
                ...response
            }, '*');
        });
    });

    const lokLokStreamCache = {};
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.type !== 'DOULGET_STREAM_INTERCEPTED') return;
        const { ep, se, url } = event.data;
        // Store both url and season so filenames can include S01E02 format
        lokLokStreamCache[ep] = { url, se };
        console.log(`[DoulGet] 📡 Stream cached: S${se}E${ep} → ${url.substring(0, 50)}...`);
    });

    const videoUrlMap = new WeakMap(); 

    if (isContextValid() && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'videoCaptured') {
                const allVideos = findAllVideos();
                console.log(`🔍 Found ${allVideos.length} video elements`);
                allVideos.forEach(video => {
                    videoUrlMap.set(video, { cdnUrl: request.url, headers: request.headers, capturedAt: Date.now() });
                    console.log('📹 Mapped video to CDN:', request.url.substring(0, 60));
                });
                
                // Show floating bar if requested directly (e.g. from FileCR sniffer in iframe)
                if (request.showImmediate || request.action === 'requestShowBar') {
                    if (window === window.top) {
                        showFloatingCapture(request.url, request.filename || 'download', request.headers || {});
                    }
                }
                if (allVideos.length === 0 || request.filename) {
                    console.log('📦 Triggering floating capture bar for:', request.filename || request.url);
                    showFloatingCapture(request.url, request.filename, request.headers);
                }
            }
            if (request.action === 'detectVideo') {
                // [TikTok] Sur le feed "Pour toi", location.href vaut tiktok.com/foryou
                // (pas une vidéo). On tente de résoudre la vraie URL de la vidéo active,
                // sinon on garde le comportement historique (location.href).
                const url = getActiveTikTokVideoUrl() || location.href;
                chrome.runtime.sendMessage({ action: 'sendDownload', url: url, filename: document.title || 'video', type: 'video/mp4' }, (res) => {
                    sendResponse({ success: !!(res && res.success) });
                });
                return true;
            }
        });
    }

    function findAllVideos() {
        const videos = new Set();
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

        return Array.from(videos).filter(v => {
            try {
                const rect = v.getBoundingClientRect();
                const style = window.getComputedStyle(v);
                const isVisible = rect.width > 10 && rect.height > 10 && style.display !== 'none' && style.visibility !== 'hidden' && v.isConnected;
                if (!isVisible) return false;
                if (location.href.includes('youtube.com') && rect.top < 1 && rect.width < 50) return false;
                return true;
            } catch (e) { return false; }
        });
    }

    // [TikTok] Retourne l'élément <video> le plus "actif" : en lecture et/ou le plus visible.
    function getMostActiveVideo() {
        try {
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            let best = null, bestScore = -Infinity;
            document.querySelectorAll('video').forEach((v) => {
                const r = v.getBoundingClientRect();
                if (r.width < 50 || r.height < 50) return;
                const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
                if (visible <= 0) return;
                const score = visible + (!v.paused ? 1e6 : 0);
                if (score > bestScore) { bestScore = score; best = v; }
            });
            return best;
        } catch (e) { return null; }
    }

    // [TikTok] Résout l'URL de la vidéo actuellement visible/lue sur le feed.
    // Retourne null si on n'est pas sur TikTok ou si rien n'a pu être résolu
    // (l'appelant retombe alors sur location.href).
    function getActiveTikTokVideoUrl() {
        try {
            if (!location.hostname.includes('tiktok.com')) return null;

            // Déjà sur une page vidéo/photo précise -> l'URL courante est bonne.
            if (/\/(video|photo)\/\d+/.test(location.pathname)) return location.href;

            // 1) Trouver la vidéo la plus "active" : celle qui joue et/ou la plus visible.
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            let best = null, bestScore = -Infinity;
            document.querySelectorAll('video').forEach((v) => {
                const r = v.getBoundingClientRect();
                if (r.width < 50 || r.height < 50) return;
                const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
                if (visible <= 0) return;
                const score = visible + (!v.paused ? 1e6 : 0);
                if (score > bestScore) { bestScore = score; best = v; }
            });
            if (!best) return null;

            // 2) Reconstruire l'URL canonique depuis l'<article> de la vidéo active.
            //    L'ID est dans l'id du lecteur (xgwrapper-0-<id>) et le pseudo dans le
            //    lien /@auteur du même article. Validé sur le DOM réel du feed : il
            //    n'existe AUCUN lien /video/id direct, d'où l'ancienne résolution qui
            //    échouait toujours.
            const art = best.closest('article[data-e2e="recommend-list-item-container"]') || best.closest('article');
            if (!art) return null;
            const wrap = art.querySelector('[id^="xgwrapper-"]');
            const idMatch = wrap && wrap.id.match(/(\d{15,})/);
            const videoId = idMatch ? idMatch[1] : null;
            const authorA = art.querySelector('a[href^="/@"]');
            const authorMatch = authorA && (authorA.getAttribute('href') || '').match(/^\/(@[^/?]+)/);
            const author = authorMatch ? authorMatch[1] : null;
            if (author && videoId) {
                return `https://www.tiktok.com/${author}/video/${videoId}`;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function findAllEpisodes() {
        if (getContentType() !== 'series') return [];
        const episodes = [];
        const currentUrl = location.href;
        
        const selectors = [
            '.episode-item', '.play-list-item', '.ant-tabs-tab', 
            '.ep-item', '.episode-link', '.episode', 
            '[class*="episode"]', '[class*="play-list"]',
            '.playlist-content a', '.series-episodes a',
            '.ant-tabs-tab-btn', '.episode-btn',
            '.pc-resource-box *', '.pc-btn', '.pc-card',
            '.pc-episode', '.vui-episode', '.vui-tab',
            // [v1.9.6] New Lok-lok 2026 selectors
            '.pc-ep', '.pc-ep-active', '.pc-ep-contain *',
            'div[class*="resource-box"] *', 'span[class*="resource"]',
            '.resource-box-content *', '.resource-title',
            '[class*="item"]', '[class*="box"] span'
        ];
        
        const blacklist = new Set([143, 144, 240, 360, 480, 720, 1080, 2160, 1024, 2048, 4096]);
        const excludedAncestors = ['quality', 'resolution', 'player-control', 'settings', 'speed', 'bitrate', 'playback', 'volume', 'progress', 'slider', 'subtitle', 'caption', 'menu-panel', 'tooltip', 'overlay', 'ad-', 'banner', 'movie-box', 'moviebox', 'advert', 'promo', 'detail-info', 'meta-info', 'release-date', 'date-info', 'footer', 'comment', 'review', 'user-info', 'resource-box', 'subtitles-info', 'pc-resource-box'];
        
        console.log('[DoulGet] Scanning for episodes (v1.9.6)...');
        
        const allCandidates = new Set();
        selectors.forEach(sel => {
            try { document.querySelectorAll(sel).forEach(el => allCandidates.add(el)); } catch (e) {}
        });

        allCandidates.forEach(el => {
            let ancestorCheck = el;
            let ancestorClasses = '';
            for (let i = 0; i < 5 && ancestorCheck; i++) {
                ancestorClasses += ' ' + (ancestorCheck.className || '');
                ancestorCheck = ancestorCheck.parentElement;
            }
            const ancestorLower = ancestorClasses.toLowerCase();
            if (excludedAncestors.some(kw => ancestorLower.includes(kw))) return;
            
            const parentText = (el.parentElement?.textContent || '').trim();
            const grandParentText = (el.parentElement?.parentElement?.textContent || '').trim();
            const dateRegex = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}/;
            if (dateRegex.test(parentText) || dateRegex.test(grandParentText)) return;
            if (el.parentElement && dateRegex.test(el.parentElement.innerText)) return;
            
            const isPlayingElement = el.classList.contains('active') || el.classList.contains('playing') || el.classList.contains('current') || el.classList.contains('pc-ep-active') || el.querySelector('img') || el.querySelector('[class*="playing"]');
            let text = el.textContent.trim().replace(/\s+/g, ' ');
            
            if (isPlayingElement && (!text || text.length < 1)) {
                episodes.push({ title: 'Episode (Playing)', url: currentUrl });
                return;
            }
            if (!text) return;
            if (/^\d{3,4}p$/i.test(text)) return;
            if (text.length > 30) return;

            const epMatch = text.match(/(?:Episode|Ep\.?\s?|S\d+E|Épisode|Ép\.?\s?|Part[.\s]?|#)?\s?(\d{1,3})(?!\s?p|fps|kbps)/i);
            if (epMatch || (text.length <= 4 && /^\d+$/.test(text))) {
                const epNumStr = epMatch ? epMatch[1] : text.match(/\d+/)?.[0];
                if (!epNumStr) return;
                const epNum = parseInt(epNumStr);
                if (blacklist.has(epNum)) return;
                if (epNum > 500 && !text.toLowerCase().includes('episode') && !text.toLowerCase().includes('ep')) return;
                if (epNum === 0) return; 
                if (text.toLowerCase().includes('size') || text.toLowerCase().includes('mo') || text.toLowerCase().includes('gb')) return;
                
                const lowerParent = parentText.toLowerCase();
                const lowerGrand = grandParentText.toLowerCase();
                if (lowerParent.includes('subtitle') || lowerGrand.includes('subtitle')) return;
                if (lowerParent.includes('user') || lowerGrand.includes('user')) return;
                if (lowerParent.includes('resource') || lowerGrand.includes('resource')) return;
                if (text.length > 4) return;

                const href = el.href || el.querySelector('a')?.href || (el.tagName === 'A' ? el.href : null);
                let se = '01';
                if (location.href.includes('lok-lok.cc') || location.href.includes('movie-box.co') || location.href.includes('moviebox')) {
                    const sMatch = location.href.match(/[?&]se=(\d+)/) || location.href.match(/[?&]detailSe=(\d+)/);
                    if (sMatch) se = sMatch[1];
                }

                episodes.push({
                    title: `Episode ${epNum}`, 
                    url: (href && href.startsWith('http')) ? href : currentUrl,
                    epNum: epNum,
                    se: parseInt(se)
                });
            }
        });

        const seenTitles = new Set();
        const seenNums = new Set();
        let filtered = episodes.filter(ep => {
            if (ep.title.includes('Playing')) return true;
            if (seenTitles.has(ep.title) || (ep.epNum && seenNums.has(ep.epNum))) return false;
            seenTitles.add(ep.title);
            if (ep.epNum) seenNums.add(ep.epNum);
            return true;
        });

        const playingIdx = filtered.findIndex(e => e.title.includes('Playing'));
        if (playingIdx !== -1) {
            const urlMatch = currentUrl.match(/[?&]ep=(\d+)/) || currentUrl.match(/\/episode-(\d+)/i) || currentUrl.match(/_E(\d+)/i);
            if (urlMatch) {
                const num = parseInt(urlMatch[1]);
                filtered[playingIdx].title = `Episode ${num}`;
                filtered[playingIdx].epNum = num;
            } else if (filtered.length > 1) {
                filtered.splice(playingIdx, 1);
            } else {
                filtered[playingIdx].title = 'Episode 1';
                filtered[playingIdx].epNum = 1;
            }
        }
        filtered.sort((a, b) => (a.epNum || 0) - (b.epNum || 0));
        console.log(`[DoulGet] Found ${filtered.length} episodes:`, filtered.map(e => e.title).join(', '));
        return filtered;
    }

    async function resolveLokLokStream(subjectId, detailPath, se, ep, referer) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'resolveLokLokStream', subjectId, detailPath, se, ep, referer: referer || location.href }, (res) => {
                if (res?.success) resolve(res.url);
                else { console.warn(`[DoulGet] Resolution failed for ep ${ep}:`, res?.error || 'Unknown error'); resolve(null); }
            });
        });
    }

    function findAllDownloadLinks() {
        const links = new Set();
        const extensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'csv', 'exe', 'dmg', 'apk', 'iso', 'msi', 'xz', 'bz2', 'epub', 'azw'];
        const extRegex = new RegExp(`\\.(${extensions.join('|')})(\\W|$)`, 'i');

        function scanNode(node) {
            if (!node) return;
            const elements = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
            elements.forEach(el => {
                try {
                    const href = el.href;
                    if (!href || (!href.startsWith('http') && !href.startsWith('/'))) return;
                    if (el.hasAttribute('download') || extRegex.test(href)) {
                        links.add(el);
                    }
                } catch (e) {}
            });
            if (node.querySelectorAll) {
                node.querySelectorAll('*').forEach(el => { if (el.shadowRoot) scanNode(el.shadowRoot); });
            }
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

    let lastUserSelectedEpisode = null;
    function saveEpisodeChoice(ep) {
        try { sessionStorage.setItem('doul_last_ep', JSON.stringify({ ep: ep, title: document.title, url: window.location.href.split('?')[0] })); } catch(e) {}
    }
    function loadEpisodeChoice() {
        try {
            const stored = sessionStorage.getItem('doul_last_ep');
            if (stored) {
                const cleanUrl = location.href.split('?')[0].split('#')[0];
                const data = JSON.parse(stored);
                if (data.url === cleanUrl || data.title === document.title) return data.ep;
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
                            try { if (window.top !== window.self) window.top.postMessage({ type: 'DOULGET_EPISODE_CLICK', episode: ep, source: 'iframe' }, '*'); } catch(e) {}
                            return;
                        }
                    }
                }
                target = target.parentElement || target.parentNode;
            }
        } catch(err) {}
    }, true);

    window.addEventListener('message', (e) => {
        try { if (e.data && e.data.type === 'DOULGET_EPISODE_CLICK' && e.data.episode) { lastUserSelectedEpisode = e.data.episode; saveEpisodeChoice(e.data.episode); } } catch(err) {}
    });

    try {
        const storedEpisode = loadEpisodeChoice();
        if (storedEpisode) lastUserSelectedEpisode = storedEpisode;
    } catch(e) {}

    function getSeriesMetadataFromDOM() {
        if (getContentType() !== 'series') return null;
        const currentUrl = location.href;
        if (['youtube.com', 'youtu.be', 'facebook.com', 'instagram.com'].some(s => currentUrl.includes(s))) return null;

        const patterns = [/S(\d+)[._-\s]?E(\d+)/i, /Saison[._-\s]?(\d+)[._-\s]?Episode[._-\s]?(\d+)/i, /Season[._-\s]?(\d+)[._-\s]?Episode[._-\s]?(\d+)/i, /(\d+)x(\d+)/i, /Episode[._-\s]?(\d+)/i, /Ep[._-\s]?(\d+)/i];
        const activeSelectors = ['.active', '.selected', '.current', '.active-episode', '.is-active', '[class*="active"]', '[class*="selected"]', '.playing', '.now-playing', '[aria-selected="true"]', '.on', 'li.active a', 'a.active', '.active-ep', '.pc-ep-active'];
        
        let detectedS = null, detectedE = null, candidateE = null;

        const seasonContainerSelectors = ['[class*="season"] .active', '[class*="season"] .selected', '[class*="season"] [class*="active"]', '[class*="saison"] .active', '[class*="saison"] .selected', '[class*="saison"] [class*="active"]', '.season-list .active', '.season-tabs .active', '.season-nav .active', '[class*="season-item"][class*="active"]', '[class*="season"][class*="current"]', '.tab-content.active [class*="season"]', '.nav-item.active [class*="season"]'];
        for (const sel of seasonContainerSelectors) {
            try {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const t = el.textContent.trim();
                    const sMatch = t.match(/(?:Saison|Season|S)[._\-\s]?(\d+)/i) || t.match(/^(\d+)$/);
                    if (sMatch) { detectedS = sMatch[1].padStart(2, '0'); break; }
                }
            } catch(e) {}
            if (detectedS) break;
        }

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

        if (!detectedS) {
            const dropdowns = document.querySelectorAll('select, .dropdown-toggle, .current-season, .season-select, [class*="season"] select, .select-value, .select-trigger, .custom-select');
            for (const dd of dropdowns) {
                let val = dd.tagName === 'SELECT' && dd.selectedIndex >= 0 ? (dd.options[dd.selectedIndex].text || dd.options[dd.selectedIndex].textContent) : (dd.value || dd.textContent.trim());
                const sMatch = val.match(/(?:Saison|Season|S)[._-\s]?(\d+)/i);
                if (sMatch) { detectedS = sMatch[1].padStart(2, '0'); break; }
            }
        }

        if (!detectedS) {
            const urlStr = window.location.href;
            const urlSMatch = urlStr.match(/[/\-_.](?:season|saison|s)[-_.]?(\d+)/i);
            if (urlSMatch) { detectedS = urlSMatch[1].padStart(2, '0'); }
        }

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
            const sVal = parseInt(detectedS || '1');
            const eVal = parseInt(detectedE);
            if (sVal > 100 || eVal > 1000) return null;
            if (!detectedS) {
                const rangeTitle = document.title.match(/(?:S|Saison)\s?(\d+)[-–—]?S?\d+/i);
                if (rangeTitle) detectedS = rangeTitle[1].padStart(2, '0');
            }
            if (!detectedS || detectedS === '00') detectedS = '01';
            if (currentUrl.includes('palkad') && !/Saison|Season/i.test(document.title)) return null;
            return `S${detectedS}E${detectedE}`;
        }
        return null;
    }

    function getContentType() {
        const url = window.location.href.toLowerCase().split('?')[0];
        const bodyText = document.body.innerText.substring(0, 5000); 
        const isLokLok = url.includes('lok-lok.cc') || url.includes('movie-box.co') || url.includes('moviebox');
        const docExtensions = ['.pdf', '.zip', '.rar', '.7z', '.exe', '.msi', '.apk', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
        if (docExtensions.some(ext => url.endsWith(ext))) return 'document';

        const hasSeriesIndicators = document.querySelector('.season-select, .current-season, [class*="play-list"], [class*="episode-list"], .pc-ep-contain') || 
                                    document.querySelectorAll('.pc-btn, .pc-ep, [class*="episode-item"]').length > 2 ||
                                    /Saison|Season|Episode|Ep\s?\d/i.test(document.title) ||
                                    /S\d+E\d+/i.test(document.title) ||
                                    (isLokLok && (bodyText.includes('Season') || bodyText.includes('Saison') || bodyText.includes('Episode') || bodyText.includes('Resource')));
        
        if (hasSeriesIndicators) return 'series';
        if (isLokLok) return 'movie'; 
        if (url.includes('palkad') || url.includes('/film/') || url.includes('/movie/')) return 'movie';
        return 'movie';
    }

    function getSeasonOnly() {
        const currentUrl = location.href;
        try {
            const dd = document.querySelector('.season-select') || document.querySelector('.current-season') || document.querySelector('[class*="season"] .active');
            if (dd) {
                const text = dd.textContent.trim();
                const sMatch = text.match(/(?:Saison|Season|S)[._-\s]?(\d+)/i) || text.match(/^Season\s+(\d+)$/i) || text.match(/^(\d+)$/);
                if (sMatch) return `Season ${parseInt(sMatch[1])}`;
            }
        } catch(e) {}
        const urlSMatch = currentUrl.match(/[?&]se=(\d+)/i) || currentUrl.match(/[/\-_.](?:season|saison|s)[-_.]?(\d+)/i);
        if (urlSMatch) return `Season ${parseInt(urlSMatch[1])}`;
        const titleMatch = document.title.match(/(?:Saison|Season)\s?(\d+)/i);
        if (titleMatch) return `Season ${parseInt(titleMatch[1])}`;
        const metadata = getSeriesMetadataFromDOM();
        if (metadata) {
            const match = metadata.match(/S(\d+)/i);
            if (match) return `Season ${parseInt(match[1])}`;
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
            if (window.location.hostname.includes('vidzy.org') || window.location.hostname.includes('sibnet.ru')) return 'download'; 
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
                    let cleanSlug = slug.replace(/^\d+[-_]/, '').replace(/\.html?$/i, '');
                    cleanSlug = cleanSlug.replace(/[-_][A-Za-z0-9]{8,}$/, '').replace(/[-_]\d{10,}$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
                    if (cleanSlug.length > 3 && !isGeneric(cleanSlug) && !looksLikeHash(cleanSlug)) title = cleanSlug;
                }
            } catch(e) {}
        }
        if (isGeneric(title)) title = (document.title || '').replace(/\s+/g, ' ').trim();

        title = title.replace(/(?:Saison|Season|S)[._-\s]?\d+/gi, ' ')
                     .replace(/(?:Episode|Ep|E)[._-\s]?\d+/gi, ' ')
                     .replace(/\d+x\d+/gi, ' ')
                     .replace(/[-–—|]\s*(Free Movies|Watch|Online|Streaming|HD|VF|VOSTFR|Gratuit).*/gi, '')
                     .replace(/\s+/g, ' ').trim()
                     .replace(/[\s\-–—_|:.,;]+$/, '').trim();

        const metadata = getSeriesMetadataFromDOM();
        if (metadata) {
            title = title.replace(/(?:^|[\s_.\-\[(])S\d+\s*[-–—]\s*S?\d+(?:$|[\s_.\-\])])/gi, ' ').replace(/(?:^|[\s_.\-\[(])Saison\s?\d+\s*[-–—]\s*\d+(?:$|[\s_.\-\])])/gi, ' ').replace(/\s+/g, ' ').trim();
            if (!title.includes(metadata) && !/S\d+E\d+/i.test(title)) title = `${title} ${metadata}`;
        }
        return title || 'download';
    }

    function setupVideoOverlays() {
        const url = location.href;
        const siteBlacklist = ['mail.google.com', 'gmail.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com', 'drive.google.com', 'accounts.google.com', 'myaccount.google.com', 'web.whatsapp.com', 'web.telegram.org', 'notion.so', 'trello.com', 'slack.com', 'figma.com', 'canva.com'];
        if (siteBlacklist.some(site => url.includes(site))) return;

        const videos = findAllVideos();
        const downloadLinks = findAllDownloadLinks();
        videos.forEach(attachButton);
        downloadLinks.forEach(link => {
            try { attachLinkButton(link); } catch (e) {}
        });
    }

    function attachButton(video) {
        const isTopFrame = window === window.top;
        const currentUrl = location.href;
        const videoSrc = video.currentSrc || video.src;
        const isSocialSite = ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com'].some(site => currentUrl.includes(site));
        if (isSocialSite && !isTopFrame) return;

        if (video.hasAttribute('data-doul-attached')) {
            const lastSrc = video.getAttribute('data-doul-last-url');
            const lastHref = video.getAttribute('data-doul-last-href');
            if ((lastSrc && lastSrc !== videoSrc) || (lastHref && lastHref !== currentUrl)) {
                if (video.doulContainer && video.doulContainer.innerText.includes('%')) return; 
                if (video.doulContainer) { video.doulContainer.remove(); video.doulContainer = null; }
                video.removeAttribute('data-doul-attached');
            } else return;
        }
        
        video.setAttribute('data-doul-attached', 'true');
        video.setAttribute('data-doul-last-url', videoSrc);
        video.setAttribute('data-doul-last-href', currentUrl);

        const allVideos = findAllVideos();
        document.querySelectorAll('.doul-download-container').forEach(cont => {
             if (!allVideos.some(v => v.doulContainer === cont)) cont.remove();
        });

        const container = document.createElement('div');
        video.doulContainer = container; 
        container.className = 'doul-download-container';

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
                z-index: 2147483647 !important;
            `;
            btn.onmouseenter = () => btn.style.opacity = '1';
            btn.onmouseleave = () => btn.style.opacity = '0.98';
            btn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                const currentUrl = location.href;
                let downloadUrl = null, cachedHeaders = {};
                // TikTok retiré d'ici : yt-dlp ne peut plus extraire ses pages (blocage
                // anti-bot), donc on passe par le flux CDN signé capturé + en-têtes,
                // téléchargé en direct côté app. Instagram RESTE ici : son CDN diffuse
                // en segments DASH (vidéo/audio séparés, byte-ranges) inutilisables en
                // direct -> l'URL de page via yt-dlp est la seule voie exploitable.
                const usePageUrlSites = ['xnxx.com', 'xvideos.com', 'pornhub.com', 'redtube.com', 'youporn.com', 'spankbang.com', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.com', 'fb.watch', 'instagram.com'];
                if (usePageUrlSites.some(site => currentUrl.includes(site))) {
                    downloadUrl = currentUrl;
                } else {
                    // TikTok feed : TikTok précharge la vidéo SUIVANTE, et chaque capture
                    // réseau est mappée sur TOUS les <video> (videoUrlMap), donc le mapping
                    // pointe souvent sur la vidéo d'après. La seule source fiable pour la
                    // vidéo EN COURS est le src de l'élément <video> actif lui-même.
                    let targetVideo = video;
                    if (currentUrl.includes('tiktok.com')) {
                        targetVideo = getMostActiveVideo() || video;
                        const elemSrc = targetVideo.currentSrc || targetVideo.src || '';
                        if (/^https?:/i.test(elemSrc)) {
                            downloadUrl = elemSrc;
                            const m = videoUrlMap.get(targetVideo);
                            cachedHeaders = (m && m.headers) || {};
                        }
                    }
                    if (!downloadUrl) {
                        const mapped = videoUrlMap.get(targetVideo);
                        if (mapped && mapped.cdnUrl) { downloadUrl = mapped.cdnUrl; cachedHeaders = mapped.headers || {}; }
                    }
                    if (!downloadUrl) {
                        try {
                            const res = await chrome.runtime.sendMessage({ action: 'getCachedVideoUrl' });
                            if (res && res.success && res.url) { downloadUrl = res.url; cachedHeaders = res.headers || {}; }
                        } catch (err) { }
                    }
                    // Repli TikTok : URL de page canonique (/@auteur/video/id) reconstruite
                    // depuis le DOM du feed, au cas où le CDN n'aurait pas été capturé.
                    if (!downloadUrl && currentUrl.includes('tiktok.com')) {
                        const built = getActiveTikTokVideoUrl();
                        if (built) downloadUrl = built;
                    }
                    if (!downloadUrl) {
                        if (['lok-lok.cc', 'hakunaymatata.com', 'moovbob.fr'].some(site => currentUrl.includes(site))) {
                            btn.textContent = dgetMessage('waitingLink', '...');
                            setTimeout(() => { btn.innerHTML = text; }, 3000); return;
                        }
                        downloadUrl = currentUrl;
                    }
                }
                try {
                    let cleanTitle = getCleanTitle();
                    // TikTok : le titre de page du feed est générique ("Regarde des vidéos
                    // tendance...") -> nommer d'après l'auteur + l'id de la vidéo active.
                    if (currentUrl.includes('tiktok.com')) {
                        const built = getActiveTikTokVideoUrl();
                        const mt = built && built.match(/@([^/]+)\/(?:video|photo)\/(\d+)/);
                        if (mt) cleanTitle = `TikTok @${mt[1]} ${mt[2]}`;
                    }
                    const filename = `${cleanTitle}${isAudio ? '.mp3' : '.mp4'}`;
                    btn.textContent = '...';
                    chrome.runtime.sendMessage({ action: 'sendDownload', url: downloadUrl, filename: filename, type: isAudio ? 'audio/mpeg' : 'video/mp4', audioOnly: isAudio, headers: { ...cachedHeaders, 'Referer': location.href } }, (response) => {
                        if (chrome.runtime.lastError || !response?.success) { btn.textContent = '🔄'; return; }
                        btn.textContent = '⏳'; btn.style.pointerEvents = 'none';
                        let lastPercentage = 0;
                        const poll = setInterval(() => {
                            if (!isContextValid()) { clearInterval(poll); return; }
                            chrome.runtime.sendMessage({ action: 'getDownloadStatus', url: downloadUrl, audioOnly: isAudio }, (res) => {
                                if (chrome.runtime.lastError || !res?.success) { if (lastPercentage > 95) complete(); return; }
                                const data = res.data;
                                if (data.status === 'completed') complete();
                                else if (data.status === 'downloading') { lastPercentage = Math.round(data.progress || 0); btn.textContent = `${lastPercentage}%`; }
                                else if (['error', 'cancelled'].includes(data.status)) { clearInterval(poll); btn.innerHTML = text; btn.style.pointerEvents = 'all'; }
                            });
                        }, 1000);
                        function complete() {
                            clearInterval(poll); btn.textContent = '✅'; btn.style.background = '#34C759 !important';
                            setTimeout(() => { btn.innerHTML = text; btn.style.background = (isAudio ? '#6366f1' : '#007AFF') + ' !important'; btn.style.pointerEvents = 'all'; }, 2000);
                        }
                    });
                } catch (e) { btn.textContent = '🔄'; }
            };
            return btn;
        }

        const btnVideo = createActionButton(dgetMessage('videoBtn', '🎬 Vidéo'), false);
        const btnAudio = createActionButton(dgetMessage('audioBtn', '🎵 Audio'), true);
        container.appendChild(btnVideo); container.appendChild(btnAudio);

        let parentContainer = null;
        if (location.href.includes('youtube.com')) parentContainer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        else {
            let candidate = video.parentElement;
            for (let i = 0; i < 10 && candidate && candidate !== document.body; i++) {
                const cRect = candidate.getBoundingClientRect();
                if (cRect.width >= 200 && cRect.height >= 100) { parentContainer = candidate; break; }
                candidate = candidate.parentElement;
            }
        }
        if (!parentContainer) parentContainer = video.parentElement || document.body;
        if (window.getComputedStyle(parentContainer).position === 'static') parentContainer.style.setProperty('position', 'relative', 'important');

        const existing = parentContainer.querySelector('.doul-download-container');
        if (existing) {
             if (video.doulContainer !== existing) {
                 if (video.doulContainer && video.doulContainer.parentNode) video.doulContainer.remove();
                 video.doulContainer = existing;
             }
             return;
        }
        parentContainer.appendChild(container);
        video.addEventListener('loadstart', () => { 
            btnVideo.innerHTML = dgetMessage('videoBtn', '🎬 Vidéo'); 
            btnAudio.innerHTML = dgetMessage('audioBtn', '🎵 Audio'); 
        });
    }

    function attachLinkButton(link) {
        if (link.hasAttribute('data-doul-attached')) return;
        link.setAttribute('data-doul-attached', 'true');
        const btn = document.createElement('button');
        btn.innerHTML = '⬇️';
        btn.style.cssText = 'all:unset;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 5px;background:#007AFF;color:white;border-radius:4px;cursor:pointer;font-size:10px;vertical-align:middle;z-index:100';
        btn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            btn.textContent = '⏳';
            const filename = (link.textContent || 'download').trim().substring(0, 50);
            chrome.runtime.sendMessage({ action: 'sendDownload', url: link.href, filename: filename, headers: { 'Referer': location.href } }, (res) => {
                btn.textContent = res?.success ? '✅' : '❌';
                setTimeout(() => { btn.textContent = '⬇️'; }, 2000);
            });
        };
        link.after(btn);
    }

    let currentFloatingCapture = null;
    function showFloatingCapture(url, filename, headers) {
        if (getContentType() !== 'series' && !filename) return;
        if (!isContextValid()) return;
        if (currentFloatingCapture) currentFloatingCapture.remove();

        const bar = document.createElement('div');
        bar.id = 'doulget-capture-bar';
        const contentType = getContentType();
        const cleanName = filename || url.split('/').pop().split('?')[0] || 'Fichier détecté';
        
        let displayTitle = dgetMessage('captureTitle', 'DoulGet Capture');
        if (contentType === 'series') displayTitle = dgetMessage('seriesDetected', 'Série détectée');

        bar.style.cssText = `
            all: unset !important;
            position: fixed !important;
            top: 15px !important;
            right: 15px !important;
            width: 380px !important;
            max-height: 85vh !important;
            background: #1c1c1e !important;
            border: 2px solid #007AFF !important;
            border-radius: 14px !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6) !important;
            z-index: 2147483647 !important;
            padding: 12px 16px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            color: #ffffff !important;
            pointer-events: auto !important;
            overflow: hidden !important;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; width:100%';
        header.innerHTML = `<span style="font-size:13px; font-weight:700">${displayTitle}</span><button id="doul-close-bar" style="all:unset; cursor:pointer; opacity:0.5">✕</button>`;
        
        const body = document.createElement('div');
        body.style.cssText = 'font-size:12px; opacity:0.9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap';
        body.textContent = cleanName;

        const episodes = findAllEpisodes();
        const epWrapper = document.createElement('div');
        epWrapper.style.display = 'flex';
        epWrapper.style.flexDirection = 'column';

        function renderEpisodeList(list) {
            epWrapper.innerHTML = '';
            if (list.length === 0) return;
            const listToggle = document.createElement('div');
            listToggle.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px';
            listToggle.innerHTML = `<span style="font-size:12px; font-weight:700; color:#007AFF">Épisodes (${list.length})</span><span style="font-size:11px; cursor:pointer" id="doul-toggle-list">Masquer</span>`;
            epWrapper.appendChild(listToggle);

            const epList = document.createElement('div');
            epList.id = 'doulget-ep-list';
            epList.style.cssText = 'display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto; margin-top:8px';
            list.forEach((ep, idx) => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px; background:rgba(255,255,255,0.03); border-radius:8px; cursor:pointer';
                item.innerHTML = `<input type="checkbox" checked class="doul-ep-checkbox" data-index="${idx}"> <span style="font-size:12px">${ep.title}</span>`;
                item.onclick = (e) => { if (e.target.tagName !== 'INPUT') { const cb = item.querySelector('input'); cb.checked = !cb.checked; updateBatchCount(); } };
                item.querySelector('input').onchange = updateBatchCount;
                epList.appendChild(item);
            });
            epWrapper.appendChild(epList);

            const batchBtn = document.createElement('button');
            batchBtn.style.cssText = 'all:unset; background:#4f46e5; color:white; padding:10px; border-radius:10px; text-align:center; font-size:13px; font-weight:700; cursor:pointer; margin-top:10px';
            epWrapper.appendChild(batchBtn);

            listToggle.querySelector('#doul-toggle-list').onclick = () => { epList.style.display = epList.style.display === 'none' ? 'flex' : 'none'; listToggle.querySelector('#doul-toggle-list').textContent = epList.style.display === 'none' ? 'Afficher' : 'Masquer'; };

            async function updateBatchCount() {
                const count = Array.from(epWrapper.querySelectorAll('.doul-ep-checkbox')).filter(cb => cb.checked).length;
                batchBtn.textContent = `Télécharger ${count} épisodes`;
                batchBtn.disabled = count === 0;
            }
            updateBatchCount();

            batchBtn.onclick = async () => {
                const selected = Array.from(epWrapper.querySelectorAll('.doul-ep-checkbox')).filter(cb => cb.checked).map(cb => list[parseInt(cb.getAttribute('data-index'))]);
                if (selected.length === 0) return;
                const baseTitle = getCleanTitle().replace(/S\d+E\d+/i, '').trim();
                const isLokLok = location.href.includes('lok-lok.cc') || location.href.includes('movie-box.co') || location.href.includes('moviebox');
                if (isLokLok) {
                    batchBtn.textContent = 'Capture...';
                    batchBtn.disabled = true;
                    // [v1.9.7] Tell background not to auto-send individual downloads during batch
                    chrome.storage.local.set({ batchMode: true });
                    const items = [];
                    const seMatch = location.href.match(/[?&]se=(\d+)/) || location.href.match(/[?&]detailSe=(\d+)/);
                    const currentSe = seMatch ? parseInt(seMatch[1]) : 1;
                    for (let i = 0; i < selected.length; i++) {
                        const ep = selected[i];
                        batchBtn.textContent = `Capture ${i+1}/${selected.length}`;
                        // [v1.9.9.2] Enhanced episode button finder with broader selectors and diagnostic logging
                        const epSelectors = '.pc-ep, .ep-item, .pc-btn, .pc-ep-active, .pc-ep-contain span, .pc-ep-contain div, [class*="episode"], [class*="ep-"], [class*="play-list"] span, [class*="play-list"] div, .ant-tabs-tab, .ant-tabs-tab-btn, .vui-tab, .vui-episode, [class*="item"] span, [class*="item"] div';
                        const allEpElements = Array.from(document.querySelectorAll(epSelectors));
                        
                        // Also search for any clickable element with just the episode number as text
                        const allClickables = Array.from(document.querySelectorAll('span, div, button, a, li'));
                        
                        const epNumStr = ep.epNum !== undefined ? String(ep.epNum) : null;
                        const epNumPadded = ep.epNum !== undefined ? String(ep.epNum).padStart(2, '0') : null;
                        
                        if (!epNumStr) {
                            console.warn(`[DoulGet Batch] ❌ Episode button not found for Ep ${ep.epNum} (epNum is undefined)`);
                        } else {
                            // Strategy 1: Match from known selectors
                            let epBtns = allEpElements.filter(el => {
                                const t = el.textContent.trim();
                                return t === epNumPadded || t === epNumStr || t === `Episode ${epNumStr}` || t === `Ep ${epNumStr}` || t === `EP${epNumStr}` || t === `Ep.${epNumStr}`;
                            });
                            
                            // Strategy 2: If nothing found, search ALL clickables with just the number
                            if (epBtns.length === 0) {
                                epBtns = allClickables.filter(el => {
                                    const t = el.textContent.trim();
                                    // Must be a leaf element (no children with text) and visible
                                    if (el.children.length > 2) return false;
                                    if (el.offsetHeight < 5 || el.offsetWidth < 5) return false;
                                    // Check ancestor isn't in excluded areas
                                    const parentClass = (el.parentElement?.className || '').toLowerCase();
                                    if (['player', 'quality', 'volume', 'speed', 'subtitle', 'ad-', 'footer', 'comment'].some(k => parentClass.includes(k))) return false;
                                    return t === epNumPadded || t === epNumStr;
                                });
                            }
                            
                            // Strategy 3: Log diagnostic info if still nothing found
                            if (epBtns.length === 0 && i === 0) {
                                // Only log diagnostics for first failure to avoid spam
                                const sampleElements = allClickables
                                    .filter(el => el.offsetHeight > 5 && el.textContent.trim().length <= 4 && /^\d+$/.test(el.textContent.trim()))
                                    .slice(0, 10)
                                    .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.trim(), parentClass: el.parentElement?.className }));
                                console.log('[DoulGet Batch] 🔍 Diagnostic: clickable number elements on page:', JSON.stringify(sampleElements, null, 2));
                                console.log('[DoulGet Batch] 🔍 Known selectors found:', allEpElements.length, 'elements');
                                console.log('[DoulGet Batch] 🔍 Looking for epNum:', epNumStr, 'or', epNumPadded);
                            }

                        if (epBtns.length > 0) {
                            // Clear stale cache BEFORE clicking to avoid race condition
                            delete lokLokStreamCache[ep.epNum];
                            epBtns[0].click();
                            const stream = await new Promise(resolve => {
                                const start = Date.now();
                                const check = setInterval(() => {
                                    // Key is just ep number; cached value is {url, se}
                                    if (lokLokStreamCache[ep.epNum]) { clearInterval(check); resolve(lokLokStreamCache[ep.epNum]); }
                                    if (Date.now() - start > 10000) { clearInterval(check); resolve(null); }
                                }, 200);
                            });
                            if (stream) {
                                const seStr = String(stream.se).padStart(2, '0');
                                const epStr = String(ep.epNum).padStart(2, '0');
                                console.log(`[DoulGet Batch] ✅ S${seStr}E${epStr} captured`);
                                items.push({ url: stream.url, filename: `${baseTitle} - S${seStr}E${epStr}.mp4`, _se: stream.se });
                            } else {
                                console.warn(`[DoulGet Batch] ❌ Failed to capture stream for Ep ${ep.epNum} (Timeout)`);
                            }
                        } else {
                            console.warn(`[DoulGet Batch] ❌ Episode button not found for Ep ${ep.epNum}`);
                        }
                    }
                    await new Promise(r => setTimeout(r, 400));
                }
                    console.log(`[DoulGet Batch] 📦 Prepared ${items.length} items for Lok-lok batch. Sending message...`);
                    // Determine season: prefer se from cache, fallback to currentSe
                    const detectedSe = (items.length > 0 && items[0]._se) ? items[0]._se : currentSe;
                    const playlistTitle = `${baseTitle} - Season ${detectedSe}`;
                    // Strip internal _se field before sending
                    const cleanItems = items.map(function(item) { const obj = {}; obj.url = item.url; obj.filename = item.filename; return obj; });
                    console.log(`[DoulGet Batch] 📂 Playlist title: "${playlistTitle}"`);
                    chrome.storage.local.set({ batchMode: false });
                    chrome.runtime.sendMessage({ action: 'sendBatchDownload', playlistTitle: playlistTitle, items: cleanItems, headers: { 'Referer': location.origin + '/' } }, (res) => { 
                        console.log('[DoulGet Batch] Message response received:', res);
                        bar.remove(); 
                    });
                } else {
                    const items = selected.map(ep => ({ url: ep.url || url, filename: `${baseTitle} - ${ep.title}.mp4` }));
                    chrome.runtime.sendMessage({ action: 'sendBatchDownload', playlistTitle: baseTitle, items: items }, (res) => { bar.remove(); });
                }
            };
        }
        renderEpisodeList(episodes);

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex; gap:8px; margin-top:8px';
        const dlBtn = document.createElement('button');
        dlBtn.textContent = 'Télécharger l\'épisode';
        dlBtn.style.cssText = 'all:unset; flex:1; background:#007AFF; color:white; padding:8px; border-radius:8px; text-align:center; cursor:pointer; font-size:12px; font-weight:700';
        dlBtn.onclick = () => {
            console.log('[DoulGet] 🖱️ Download button clicked for:', cleanName, '| URL:', url.substring(0, 80));
            dlBtn.textContent = 'Envoi...';
            dlBtn.style.opacity = '0.6';
            
            // Check if chrome runtime is still valid
            if (!isContextValid()) {
                console.warn('[DoulGet] ⚠️ Chrome runtime context lost! Using direct fallback...');
                // Direct fallback: send to DoulGet app via fetch
                fetch('http://localhost:8765/download-detected', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'download-detected',
                        url: url,
                        filename: cleanName,
                        mimeType: 'video/mp4',
                        headers: { 'Referer': location.href, 'User-Agent': navigator.userAgent },
                        timestamp: Date.now()
                    })
                }).then(r => r.json()).then(res => {
                    console.log('[DoulGet] ✅ Direct fallback success:', res);
                    bar.remove();
                }).catch(err => {
                    console.error('[DoulGet] ❌ Direct fallback failed:', err);
                    dlBtn.textContent = '❌ Échec - App fermée?';
                    dlBtn.style.background = '#FF3B30';
                    dlBtn.style.opacity = '1';
                });
                return;
            }
            
            try {
                chrome.runtime.sendMessage({ 
                    action: 'sendDownload', 
                    url: url, 
                    filename: cleanName, 
                    headers: { 'Referer': location.href } 
                }, (res) => { 
                    if (chrome.runtime.lastError) {
                        console.error('[DoulGet] ❌ sendMessage error:', chrome.runtime.lastError.message);
                        dlBtn.textContent = '❌ Erreur extension';
                        dlBtn.style.background = '#FF3B30';
                        dlBtn.style.opacity = '1';
                        // Try direct fallback
                        fetch('http://localhost:8765/download-detected', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'download-detected',
                                url: url,
                                filename: cleanName,
                                mimeType: 'video/mp4',
                                headers: { 'Referer': location.href, 'User-Agent': navigator.userAgent },
                                timestamp: Date.now()
                            })
                        }).then(r => r.json()).then(fbRes => {
                            console.log('[DoulGet] ✅ Fallback after error success:', fbRes);
                            bar.remove();
                        }).catch(() => {});
                        return;
                    }
                    console.log('[DoulGet] ✅ sendMessage response:', res);
                    if (res?.success) bar.remove(); 
                    else {
                        dlBtn.textContent = 'Réessayer';
                        dlBtn.style.opacity = '1';
                    }
                });
            } catch(e) {
                console.error('[DoulGet] ❌ Exception during sendMessage:', e);
                dlBtn.textContent = '❌ Erreur';
                dlBtn.style.background = '#FF3B30';
                dlBtn.style.opacity = '1';
            }
        };
        
        const closeBtn = header.querySelector('#doul-close-bar');
        closeBtn.onclick = () => bar.remove();

        bar.appendChild(header); bar.appendChild(body); bar.appendChild(epWrapper); bar.appendChild(dlBtn);
        document.body.appendChild(bar);
        currentFloatingCapture = bar;
        setTimeout(() => { if (bar.parentNode) bar.remove(); }, 20000);
    }

    setupVideoOverlays();
    setInterval(() => { if (isContextValid()) { setupVideoOverlays(); if (window === window.top) { const meta = getSeriesMetadataFromDOM(); if (meta) chrome.runtime.sendMessage({ action: 'reportMetadata', metadata: meta, title: getCleanTitle().replace(meta, '').trim() }); } } }, 3000);

    if (window.location.href.toLowerCase().endsWith('.pdf')) { setTimeout(() => showFloatingCapture(window.location.href, document.title || 'Fichier PDF'), 1500); }

    // [v1.9.9.1] FileCR /file-download/ special handler
    // Broaden detection: FileCR URLs can contain "download", "/dl/", etc.
    const isFileCR = location.href.includes('filecr.com');
    const isFileCRDownloadPage = isFileCR && (location.href.includes('download') || location.href.includes('/dl/'));

    if (isFileCRDownloadPage) {
        let fileCRHandled = false;

        function findFileCRDownloadLink() {
            if (fileCRHandled) return;

            // Try broad selectors for FileCR's dynamic download button/link
            const selectors = [
                'a[href*="/dl/"]',
                'a[href*="download"]',
                '.download-btn',
                '.btn-download',
                'a.btn-download',
                'a.download-btn',
                'a[class*="download"]',
                'a[id*="download"]',
                '.download-area a[href]',
                '.btn-group a[href]',
                '.countdown-complete a[href]',
                '#download-link',
                '#download-btn',
                'a[rel="nofollow"][href]',
                '#dl_button',
                '.dl-link',
                '.final-download'
            ];

            for (const sel of selectors) {
                const links = document.querySelectorAll(sel);
                for (const link of links) {
                    const href = link.href || '';
                    if (!href || href.includes('filecr.com/') && !href.includes('/dl/') && !href.includes('download')) continue;
                    if (link.hasAttribute('data-doul-attached')) continue;
                    if (link.textContent.trim().toLowerCase().includes('ad') || link.textContent.trim().toLowerCase().includes('torrent')) continue;

                    // Found a real download link — show DoulGet capture bar
                    const fname = document.title.replace(' - FileCR', '').trim() || 'download';
                    console.log('[DoulGet FileCR] 🎯 Found download link:', href.substring(0, 80));
                    link.setAttribute('data-doul-attached', 'true');
                    fileCRHandled = true;

                    // Show floating capture bar
                    if (!document.getElementById('doulget-capture-bar')) {
                        if (window === window.top) {
                            showFloatingCapture(href, fname, {});
                        } else {
                            // In iframe: Notify top frame to show capture bar
                            chrome.runtime.sendMessage({ action: 'sendDownload', url: href, filename: fname, silent: true }, () => {
                                chrome.runtime.sendMessage({ action: 'requestShowBar', url: href, filename: fname });
                            });
                        }
                    }
                    break;
                }
                if (fileCRHandled) break;
            }

            // Also check buttons with download text
            if (!fileCRHandled) {
                document.querySelectorAll('button, a').forEach(el => {
                    if (fileCRHandled || el.hasAttribute('data-doul-attached')) return;
                    const text = el.textContent.trim().toLowerCase();
                    if ((text.includes('download') && !text.includes('torrent') && !text.includes('ad')) && el.href && el.href.startsWith('http') && !el.href.includes('filecr.com/file-download')) {
                        const fname = document.title.replace(' - FileCR', '').trim() || 'download';
                        console.log('[DoulGet FileCR] 🎯 Found download button:', el.href.substring(0, 80));
                        el.setAttribute('data-doul-attached', 'true');
                        fileCRHandled = true;
                        if (!document.getElementById('doulget-capture-bar')) {
                            showFloatingCapture(el.href, fname, {});
                        }
                    }
                });
            }
        }

        // Start scanning: poll every 500ms for up to 30s (countdown can take ~10-15s)
        console.log('[DoulGet FileCR] 🔍 Watching for download link...');
        const fileCRInterval = setInterval(() => {
            if (!isContextValid()) { clearInterval(fileCRInterval); return; }
            findFileCRDownloadLink();
            if (fileCRHandled) clearInterval(fileCRInterval);
        }, 500);
        setTimeout(() => clearInterval(fileCRInterval), 30000);
    }

    console.log('✅ DoulGet engine restored (v1.9.9)');
})();
