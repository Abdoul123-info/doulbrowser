(function () {
    const BRIDGE_ID = 'DOULGET_GM_BRIDGE';

    // Polyfill definitions in the Main World (accessible to page scripts)
    window.GM_cookie = {
        list: (details, callback) => {
            if (callback) callback([], null);
        },
        set: (details, callback) => {
            if (callback) callback(null);
        }
    };

    window.GM_info = {
        script: {
            name: "DoulGet Assistant (CSP-Safe)",
            version: "1.2.0"
        }
    };

    window.GM_getValue = (name, defaultValue) => {
        try {
            const val = localStorage.getItem('GM_' + name);
            return val !== null ? JSON.parse(val) : defaultValue;
        } catch (e) { return defaultValue; }
    };

    window.GM_setValue = (name, value) => {
        try {
            localStorage.setItem('GM_' + name, JSON.stringify(value));
        } catch (e) { }
    };

    // [v1.6.1] Lok-lok API Response Interception — capture stream URLs from page's own API calls
    // This runs in MAIN world, so we can intercept the page's fetch/XHR with cookies intact
    (function interceptLokLokStreams() {
        if (!location.href.includes('lok-lok.cc') && !location.href.includes('movie-box.co') && !location.href.includes('moviebox')) return;

        const PLAY_API = 'wefeed-h5api-bff/subject/play';

        // Extract stream URL from Lok-lok API response
        function extractStream(json, apiUrl) {
            try {
                const data = json?.data || json;
                let streamUrl = null;

                // Try multiple response formats
                if (data?.streams?.length > 0) streamUrl = data.streams[0].url;
                else if (data?.dash?.length > 0) streamUrl = data.dash[0].url;
                else if (data?.hls?.length > 0) streamUrl = data.hls[0].url;
                else if (data?.playUrl) streamUrl = data.playUrl;
                else if (data?.url) streamUrl = data.url;

                // Deep search for CDN URL in raw JSON
                if (!streamUrl) {
                    const raw = JSON.stringify(json);
                    const cdnMatch = raw.match(/(https?:\/\/[^"]+hakunaymatata\.com[^"]+)/i);
                    if (cdnMatch) streamUrl = cdnMatch[1];
                }

                if (streamUrl) {
                    // Extract episode number from API URL
                    const epMatch = apiUrl.match(/[?&]ep=(\d+)/);
                    const seMatch = apiUrl.match(/[?&]se=(\d+)/);
                    const epNum = epMatch ? parseInt(epMatch[1]) : 0;
                    const seNum = seMatch ? parseInt(seMatch[1]) : 1;

                     console.log(`[DoulGet Bridge] 📡 Intercepted stream: Ep ${epNum} (S${seNum}) → ${streamUrl.substring(0, 60)}...`);
                    window.postMessage({
                        type: 'DOULGET_STREAM_INTERCEPTED',
                        ep: epNum,
                        se: seNum,
                        url: streamUrl
                    }, '*');
                }
            } catch (e) { }
        }

        // Intercept fetch()
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            try {
                const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                if (reqUrl.includes(PLAY_API)) {
                    const clone = response.clone();
                    clone.json().then(json => extractStream(json, reqUrl)).catch(() => { });
                }
            } catch (e) { }
            return response;
        };

        // Intercept XMLHttpRequest
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._doulgetUrl = url;
            return origOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
            if (this._doulgetUrl && this._doulgetUrl.includes(PLAY_API)) {
                this.addEventListener('load', function () {
                    try {
                        extractStream(JSON.parse(this.responseText), this._doulgetUrl);
                    } catch (e) { }
                });
            }
            return origSend.apply(this, args);
        };

        console.log('[DoulGet Bridge] 📡 Lok-lok API interceptor active');
    })();

    console.log('✅ DoulGet GM_ Bridge (Main World) Ready');
})();
