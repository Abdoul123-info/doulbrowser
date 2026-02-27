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

    console.log('✅ DoulGet GM_ Bridge (Main World) Ready');
})();
