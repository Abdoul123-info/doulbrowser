(function () {
    const BRIDGE_ID = 'DOULBROWSER_GM_BRIDGE';

    // Polyfill definitions in the Main World (accessible to page scripts)
    window.GM_cookie = {
        list: (details, callback) => {
            const id = Math.random().toString(36).slice(2);
            window.postMessage({ type: BRIDGE_ID, action: 'GM_cookie_list', details, id }, '*');
            window.addEventListener('message', function handler(e) {
                if (e.data.type === BRIDGE_ID && e.data.responseId === id) {
                    window.removeEventListener('message', handler);
                    if (callback) callback(e.data.cookies, e.data.error);
                }
            });
        },
        set: (details, callback) => {
            const id = Math.random().toString(36).slice(2);
            window.postMessage({ type: BRIDGE_ID, action: 'GM_cookie_set', details, id }, '*');
            window.addEventListener('message', function handler(e) {
                if (e.data.type === BRIDGE_ID && e.data.responseId === id) {
                    window.removeEventListener('message', handler);
                    if (callback) callback(e.data.error);
                }
            });
        },
        delete: (details, callback) => {
            const id = Math.random().toString(36).slice(2);
            window.postMessage({ type: BRIDGE_ID, action: 'GM_cookie_delete', details, id }, '*');
            window.addEventListener('message', function handler(e) {
                if (e.data.type === BRIDGE_ID && e.data.responseId === id) {
                    window.removeEventListener('message', handler);
                    if (callback) callback(e.data.error);
                }
            });
        }
    };

    window.GM_info = {
        script: {
            name: "DoulBrowser Assistant (CSP-Safe)",
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

    console.log('✅ DoulBrowser GM_ Bridge (Main World) Ready');
})();
