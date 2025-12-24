// DoulBrowser Content Script - IDM Method
// Network Sniffer + Video Element Mapping

(function () {
    console.log('🚀 DoulBrowser UI Manager - IDM Method ACTIVE');

    // ============================================
    // GM_ API BRIDGE FOR MAIN WORLD COMPATIBILITY
    // Fixes ReferenceError: GM_cookie in YouTube scripts
    // ============================================

    // 1. Bridge script is now injected via manifest.json (Main World)
    console.log('🚀 DoulBrowser GM_ Bridge ACTIVE (via Manifest)');

    // 2. Listen for requests from the Main World and forward to Background
    window.addEventListener('message', (event) => {
        // Only accept messages from the same window
        if (event.source !== window || !event.data || event.data.type !== 'DOULBROWSER_GM_BRIDGE' || event.data.responseId) {
            return;
        }

        const { action, details, id } = event.data;

        // Forward to background script
        chrome.runtime.sendMessage({ action, details }, (response) => {
            // Send back to the Main World
            window.postMessage({
                type: 'DOULBROWSER_GM_BRIDGE',
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
        }

        if (request.action === 'detectVideo') {
            const url = location.href;
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

    // AGGRESSIVE VIDEO FINDER - scans everywhere
    function findAllVideos() {
        const videos = new Set();

        // 1. Main document
        document.querySelectorAll('video').forEach(v => videos.add(v));

        // 2. All Shadow DOM (deep scan)
        document.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                el.shadowRoot.querySelectorAll('video').forEach(v => videos.add(v));
            }
        });

        // 3. All iframes (same origin only)
        try {
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) {
                        iframeDoc.querySelectorAll('video').forEach(v => videos.add(v));
                    }
                } catch (e) {
                    // Cross-origin iframe, ignore
                }
            });
        } catch (e) { }

        return Array.from(videos);
    }

    // FIND ALL DOWNLOAD LINKS - Documents like PDFs, Word, ZIP, etc.
    function findAllDownloadLinks() {
        const links = new Set();
        const downloadExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'csv', 'exe', 'dmg', 'apk', 'iso'];

        // 1. Links with download attribute
        document.querySelectorAll('a[download]').forEach(link => {
            if (link.href && link.href.startsWith('http')) {
                links.add(link);
            }
        });

        // 2. Links pointing to downloadable files
        document.querySelectorAll('a[href]').forEach(link => {
            try {
                const url = new URL(link.href, location.href);
                const pathname = url.pathname.toLowerCase();

                // Check if URL ends with a download extension
                if (downloadExtensions.some(ext => pathname.endsWith(`.${ext}`))) {
                    links.add(link);
                }
            } catch (e) {
                // Invalid URL, skip
            }
        });

        return Array.from(links);
    }

    // VIDEO OVERLAY BUTTON
    function setupVideoOverlays() {
        const url = location.href;

        // Allow YouTube now (will use page URL)
        // if (url.includes('youtube.com') || url.includes('youtu.be')) return;

        const videos = findAllVideos();
        const downloadLinks = findAllDownloadLinks();
        console.log(`🎬 Setting up overlays for ${videos.length} videos and ${downloadLinks.length} download links`);

        videos.forEach(attachButton);
        downloadLinks.forEach(attachLinkButton);
    }

    function attachButton(video) {
        if (video.hasAttribute('data-doul-attached')) return;
        video.setAttribute('data-doul-attached', 'true');

        const btn = document.createElement('button');
        btn.innerHTML = '⬇️ DoulDownload';
        btn.className = 'doul-download-btn';

        // Use FIXED positioning on body (like IDM) - ALWAYS above EVERYTHING
        btn.style.cssText = `
            position: fixed !important;
            z-index: 2147483647 !important;
            background: #007AFF !important;
            color: white !important;
            border: none !important;
            padding: 8px 12px !important;
            border-radius: 6px !important;
            cursor: pointer !important;
            font-size: 13px !important;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
            font-weight: 600 !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
            opacity: 0.95 !important;
            transition: all 0.2s ease !important;
            pointer-events: all !important;
            display: block !important;
            width: auto !important;
            height: auto !important;
        `;

        // Update button position based on video position
        function updateButtonPosition() {
            try {
                const rect = video.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    btn.style.top = `${rect.top + 10}px`;
                    btn.style.left = `${rect.left + 10}px`;
                    btn.style.display = 'block';
                } else {
                    btn.style.display = 'none';
                }
            } catch (e) {
                btn.style.display = 'none';
            }
        }

        btn.onmouseenter = () => {
            btn.style.opacity = '1';
            btn.style.transform = 'scale(1.05)';
            btn.style.boxShadow = '0 4px 12px rgba(0, 122, 255, 0.5) !important';
        };
        btn.onmouseleave = () => {
            btn.style.opacity = '0.95';
            btn.style.transform = 'scale(1)';
            btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4) !important';
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const currentUrl = location.href;
            let downloadUrl = null;
            let cachedHeaders = {};

            // Sites where network sniffer doesn't work well (captures ads/thumbnails/fragments)
            // OR sites that use DASH/HLS where CDN URLs are fragmented
            const usePageUrlSites = [
                'xnxx.com',
                'xvideos.com',
                'pornhub.com',
                'redtube.com',
                'youporn.com',
                'spankbang.com',
                'youtube.com',
                'youtu.be',
                'facebook.com',  // DASH fragments with bytestart/byteend
                'fb.com',
                'fb.watch',
                'tiktok.com',    // DASH fragments
                'instagram.com'  // DASH fragments
            ];

            const shouldUsePageUrl = usePageUrlSites.some(site => currentUrl.includes(site));

            if (!shouldUsePageUrl) {
                // Try to get cached URL from background
                try {
                    const response = await chrome.runtime.sendMessage({ action: 'getCachedVideoUrl' });
                    if (response && response.success && response.url) {
                        downloadUrl = response.url;
                        cachedHeaders = response.headers || {};
                        console.log('✅ Using cached CDN URL:', downloadUrl.substring(0, 60));
                    }
                } catch (err) {
                    console.log('⚠️ Failed to get cached URL:', err);
                }
            } else {
                console.log('🚫 Site blacklist/YouTube detected, using page URL');
            }

            // Fallback: Use page URL
            if (!downloadUrl) {
                downloadUrl = currentUrl;
                console.log('✅ Using page URL as fallback:', downloadUrl);
            }

            // SMART PERMALINK EXTRACTION (TikTok / Instagram Feed)
            // If on feed (no specific ID in URL), find the link associated with this video element
            const isGenericFeedUrl = (
                (currentUrl.includes('tiktok.com') && !currentUrl.includes('/video/')) ||
                (currentUrl.includes('instagram.com') && !currentUrl.includes('/p/') && !currentUrl.includes('/reel/'))
            );

            if (isGenericFeedUrl) {
                console.log('🔍 Generic feed detected, searching for permalink...');
                try {
                    // Look for parent anchor tag or nearby sibling
                    let targetElement = video;
                    let foundLink = null;

                    // 1. Check parents up to 5 levels
                    let parent = video.parentElement;
                    for (let i = 0; i < 7; i++) {
                        if (!parent) break;

                        // Check for direct anchor
                        if (parent.tagName === 'A') {
                            const href = parent.getAttribute('href');
                            if (href && (href.includes('/video/') || href.includes('/reel/') || href.includes('/p/'))) {
                                foundLink = href;
                                break;
                            }
                        }

                        // Check for anchor inside this parent
                        const anchors = parent.querySelectorAll('a');
                        for (const anchor of anchors) {
                            const href = anchor.getAttribute('href');
                            if (href && (href.includes('/video/') || href.includes('/reel/') || href.includes('/p/'))) {
                                foundLink = href;
                                break;
                            }
                        }
                        if (foundLink) break;

                        parent = parent.parentElement;
                    }

                    if (foundLink) {
                        // Fix relative URLs
                        if (foundLink.startsWith('/')) {
                            foundLink = window.location.origin + foundLink;
                        }
                        downloadUrl = foundLink;
                        console.log('✅ SMART PERMALINK FOUND:', downloadUrl);
                    } else {
                        console.warn('❌ Could not find permalink for this video');
                        btn.textContent = '❌ Open Video';
                        btn.style.background = '#FF3B30 !important';
                        btn.title = "Click video to open detail page first";
                        setTimeout(() => {
                            btn.textContent = '⬇️ DoulDownload';
                            btn.style.background = '#007AFF !important';
                            btn.title = "";
                        }, 4000);
                        return;
                    }
                } catch (e) {
                    console.error('Permalink extraction error:', e);
                }
            }

            const filename = `Video_${document.title.replace(/[^\w]/g, '_').substring(0, 30)}_${Date.now()}.mp4`;

            btn.textContent = 'Starting...';

            try {
                chrome.runtime.sendMessage({
                    action: 'sendDownload',
                    url: downloadUrl,
                    filename: filename,
                    type: 'video/mp4',
                    category: 'video',
                    headers: cachedHeaders
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Extension error:', chrome.runtime.lastError.message);
                        btn.textContent = '🔄 Reload Page';
                        btn.style.background = '#FF9500 !important';
                        btn.title = "Extension was reloaded. Please refresh this page (F5)";
                        return;
                    }

                    if (response && response.success) {
                        btn.textContent = '⏳ Preparing...';
                        btn.style.background = '#007AFF !important';
                        btn.style.pointerEvents = 'none';

                        // Poll for progress updates
                        const pollUrl = downloadUrl;
                        let pollAttempts = 0;
                        const pollInterval = setInterval(async () => {
                            pollAttempts++;
                            try {
                                const statusRes = await fetch(`http://localhost:8765/download-status?url=${encodeURIComponent(pollUrl)}`);
                                if (statusRes.ok) {
                                    const data = await statusRes.json();

                                    if (data.status === 'completed') {
                                        clearInterval(pollInterval);
                                        btn.textContent = '✅ Finished!';
                                        btn.style.background = '#34C759 !important';
                                        btn.style.pointerEvents = 'all';
                                        setTimeout(() => {
                                            btn.textContent = '⬇️ DoulDownload';
                                            btn.style.background = '#007AFF !important';
                                        }, 3000);
                                    } else if (data.status === 'downloading') {
                                        btn.textContent = `⏳ ${Math.round(data.progress)}%`;
                                    } else if (data.status === 'error' || data.status === 'cancelled') {
                                        clearInterval(pollInterval);
                                        btn.textContent = data.status === 'cancelled' ? '⚠️ Cancelled' : '❌ Error';
                                        btn.style.background = (data.status === 'cancelled' ? '#FF9500' : '#FF3B30') + ' !important';
                                        btn.style.pointerEvents = 'all';
                                        setTimeout(() => {
                                            btn.textContent = '⬇️ DoulDownload';
                                            btn.style.background = '#007AFF !important';
                                        }, 3000);
                                    }
                                }
                            } catch (e) {
                                // If app is closed or connection lost
                                if (pollAttempts > 10) {
                                    clearInterval(pollInterval);
                                    btn.textContent = '⬇️ DoulDownload';
                                    btn.style.pointerEvents = 'all';
                                }
                            }
                        }, 1000);
                    } else {
                        btn.textContent = '❌ Error';
                        btn.style.background = '#FF3B30 !important';
                        setTimeout(() => {
                            btn.textContent = '⬇️ DoulDownload';
                            btn.style.background = '#007AFF !important';
                        }, 3000);
                    }
                });
            } catch (error) {
                console.error('Extension context error:', error);
                btn.textContent = '🔄 Reload Page';
                btn.style.background = '#FF9500 !important';
                btn.title = "Extension was reloaded. Please refresh this page (F5)";
            }
        };

        // Attach to body (not video parent) - CRITICAL for z-index to work
        document.body.appendChild(btn);

        // Update position initially and on scroll/resize
        updateButtonPosition();
        window.addEventListener('scroll', updateButtonPosition, { passive: true });
        window.addEventListener('resize', updateButtonPosition, { passive: true });

        // Update position every 500ms in case video moves
        setInterval(updateButtonPosition, 500);

        console.log('✅ Button attached to video (fixed position on body)');
    }

    // ATTACH DOWNLOAD BUTTON TO DOCUMENT LINKS
    function attachLinkButton(link) {
        if (link.hasAttribute('data-doul-attached')) return;
        link.setAttribute('data-doul-attached', 'true');

        const btn = document.createElement('span');
        btn.innerHTML = ' ⬇️';
        btn.className = 'doul-download-link-btn';
        btn.title = 'Download with DoulBrowser';

        btn.style.cssText = `
            display: inline-block !important;
            margin-left: 5px !important;
            cursor: pointer !important;
            font-size: 16px !important;
            vertical-align: middle !important;
            opacity: 0.7 !important;
            transition: all 0.2s ease !important;
        `;

        btn.onmouseenter = () => {
            btn.style.opacity = '1';
            btn.style.transform = 'scale(1.2)';
        };
        btn.onmouseleave = () => {
            btn.style.opacity = '0.7';
            btn.style.transform = 'scale(1)';
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const downloadUrl = link.href;
            const filename = link.download || link.textContent.trim() || downloadUrl.split('/').pop();

            console.log('📄 Document download requested:', downloadUrl);

            // Send to DoulBrowser
            try {
                await fetch('http://localhost:8765/download-detected', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: downloadUrl,
                        filename: filename,
                        headers: {
                            'User-Agent': navigator.userAgent,
                            'Referer': location.href
                        }
                    })
                });

                btn.innerHTML = ' ✅';
                btn.style.color = '#28a745';
                console.log('✅ Download request sent to DoulBrowser');

                setTimeout(() => {
                    btn.innerHTML = ' ⬇️';
                    btn.style.color = '';
                }, 2000);
            } catch (error) {
                console.error('❌ Failed to send download request:', error);
                btn.innerHTML = ' ❌';
                btn.style.color = '#dc3545';

                setTimeout(() => {
                    btn.innerHTML = ' ⬇️';
                    btn.style.color = '';
                }, 2000);
            }
        };

        // Insert button after the link
        link.parentNode.insertBefore(btn, link.nextSibling);
        console.log('✅ Download button attached to link:', link.href.substring(0, 60));
    }

    // Run overlay check periodically
    setupVideoOverlays(); // Initial run
    setInterval(setupVideoOverlays, 2000); // Check every 2 seconds

    console.log('✅ DoulBrowser overlay system initialized');
})();
