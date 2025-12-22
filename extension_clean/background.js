// DoulBrowser Extension - Background Service Worker
// IDM METHOD: Network Sniffer + URL Cache

const DOULBROWSER_PORT = 8765;
const DOULBROWSER_HOST = 'localhost';

// Cache: Maps video CDN URLs to tab info
const videoUrlCache = new Map(); // { url: { tabId, timestamp, headers } }
const requestHeadersCache = new Map();

function sendToDoulBrowser(data) {
    fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-detected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(response => {
        if (response.ok) {
            console.log('✅ Sent to DoulBrowser:', data.url.substring(0, 50) + '...');
        }
    }).catch(() => { });
}

// 1. Capture Headers
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const headers = {};
        if (details.requestHeaders) {
            for (const header of details.requestHeaders) {
                const name = header.name.toLowerCase();
                if (name === 'cookie' || name === 'referer' || name === 'user-agent') {
                    headers[header.name] = header.value;
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

        // Check if it's a video OR HLS manifest (.m3u8)
        const isVideo = contentType.includes('video/') ||
            contentType.includes('application/x-mpegURL') ||  // HLS manifest (.m3u8)
            contentType.includes('application/vnd.apple.mpegurl') ||  // HLS manifest
            contentType.includes('application/mp4') ||
            contentType.includes('application/octet-stream');

        if (!isVideo) return;

        const url = details.url;

        // For .m3u8 files, skip size check (they're small playlists)
        const isM3U8 = url.includes('.m3u8') ||
            contentType.includes('mpegURL') ||
            contentType.includes('mpegurl');

        // Size check (min 100KB to avoid thumbnails) - SKIP for m3u8
        if (!isM3U8) {
            let size = 0;
            if (lengthHeader) size = parseInt(lengthHeader.value);
            if (size > 0 && size < 100 * 1024) return;
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
        if (details.tabId >= 0) {
            chrome.tabs.sendMessage(details.tabId, {
                action: 'videoCaptured',
                url: url,
                headers: capturedHeaders
            }).catch(() => { });
        }

        // Cleanup old entries (>5 minutes)
        setTimeout(() => videoUrlCache.delete(url), 5 * 60 * 1000);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// 3. Handle Download Request from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sendDownload') {
        const processDownload = (cookiesHeader = '') => {
            const headers = request.headers || {};
            if (cookiesHeader) {
                headers['Cookie'] = cookiesHeader;
            }
            if (!headers['User-Agent'] && navigator.userAgent) {
                headers['User-Agent'] = navigator.userAgent;
            }

            sendToDoulBrowser({
                type: 'download-detected',
                url: request.url,
                filename: request.filename || 'download.mp4',
                mimeType: request.type || 'video/mp4',
                headers: headers,
                timestamp: Date.now()
            });
            sendResponse({ success: true });
        };

        // Try to fetch cookies for the URL
        if (typeof chrome !== 'undefined' && chrome.cookies && request.url && (request.url.startsWith('http') || request.url.startsWith('https'))) {
            try {
                const urlObj = new URL(request.url);
                chrome.cookies.getAll({ domain: urlObj.hostname }, (cookies) => {
                    if (cookies && cookies.length > 0) {
                        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                        console.log(`🍪 Cookies attached for ${urlObj.hostname}`);
                        processDownload(cookieString);
                    } else {
                        chrome.cookies.getAll({ url: request.url }, (cookiesUrl) => {
                            if (cookiesUrl && cookiesUrl.length > 0) {
                                const cookieString = cookiesUrl.map(c => `${c.name}=${c.value}`).join('; ');
                                processDownload(cookieString);
                            } else {
                                processDownload();
                            }
                        });
                    }
                });
                return true; // Keep message channel open for async response
            } catch (e) {
                console.error('Cookie fetch error:', e);
                processDownload();
            }
        } else {
            console.log('⚠️ Cookies API not available or URL not supported');
            processDownload();
        }
        return true;
    }

    // NEW: Get cached video URL for a specific page
    if (request.action === 'getCachedVideoUrl') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ success: false });
            return;
        }

        // Find most recent video URL for this tab
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

    // ============================================
    // GM_cookie HANDLERS
    // ============================================

    // GM_cookie.list
    if (request.action === 'GM_cookie_list') {
        chrome.cookies.getAll(request.details || {}, (cookies) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ cookies: cookies });
            }
        });
        return true;
    }

    // GM_cookie.set
    if (request.action === 'GM_cookie_set') {
        chrome.cookies.set(request.details || {}, (cookie) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ cookie: cookie });
            }
        });
        return true;
    }

    // GM_cookie.delete
    if (request.action === 'GM_cookie_delete') {
        chrome.cookies.remove(request.details || {}, (details) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ details: details });
            }
        });
        return true;
    }
});

// 4. DOWNLOAD INTERCEPTION - Like IDM (Automatic)
// Intercept ALL downloads and redirect to DoulBrowser
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener((downloadItem) => {
        console.log('📥 Download intercepted:', downloadItem.url);

        // Cancel the browser's native download
        chrome.downloads.cancel(downloadItem.id, () => {
            // Remove from download shelf
            chrome.downloads.erase({ id: downloadItem.id }, () => {
                console.log('🗑️ Browser download cancelled and erased');
            });
        });

        // Get the filename from the download item or URL
        const filename = downloadItem.filename ||
            downloadItem.url.split('/').pop().split('?')[0] ||
            `download_${Date.now()}`;

        // Try to get current tab info for headers
        if (chrome.tabs && chrome.tabs.query) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                const headers = {
                    'User-Agent': navigator.userAgent,
                    'Referer': activeTab ? activeTab.url : downloadItem.referrer || downloadItem.url
                };

                // Try to get cookies for the domain
                if (chrome.cookies && downloadItem.url && downloadItem.url.startsWith('http')) {
                    try {
                        const urlObj = new URL(downloadItem.url);
                        chrome.cookies.getAll({ domain: urlObj.hostname }, (cookies) => {
                            if (cookies && cookies.length > 0) {
                                const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                                headers['Cookie'] = cookieString;
                                console.log(`🍪 Cookies attached for ${urlObj.hostname}`);
                            }

                            // Send to DoulBrowser
                            sendToDoulBrowser({
                                type: 'download-detected',
                                url: downloadItem.url,
                                filename: filename,
                                mimeType: downloadItem.mime || 'application/octet-stream',
                                headers: headers,
                                fileSize: downloadItem.fileSize || 0,
                                timestamp: Date.now()
                            });
                        });
                    } catch (e) {
                        console.error('Error processing download:', e);
                        // Send anyway without cookies
                        sendToDoulBrowser({
                            type: 'download-detected',
                            url: downloadItem.url,
                            filename: filename,
                            mimeType: downloadItem.mime || 'application/octet-stream',
                            headers: headers,
                            fileSize: downloadItem.fileSize || 0,
                            timestamp: Date.now()
                        });
                    }
                } else {
                    // Send without cookies
                    sendToDoulBrowser({
                        type: 'download-detected',
                        url: downloadItem.url,
                        filename: filename,
                        mimeType: downloadItem.mime || 'application/octet-stream',
                        headers: headers,
                        fileSize: downloadItem.fileSize || 0,
                        timestamp: Date.now()
                    });
                }
            });
        }
    });
} else {
    console.log('⚠️ chrome.downloads API not available (Normal in Electron extension environment)');
}

console.log('🚀 DoulBrowser Background Worker - IDM Method Active');

