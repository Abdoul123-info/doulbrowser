import { useState, useEffect } from 'react';
import { Package, X, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

export function ExtensionUpdateNotification() {
    const { t } = useTranslation();
    const [updateInfo, setUpdateInfo] = useState<{ available: boolean, version?: string, url?: string, hash?: string, dismissed?: boolean } | null>(null);
    const [status, setStatus] = useState<'idle' | 'installing' | 'success' | 'error'>('idle');

    useEffect(() => {
        const interval = setInterval(async () => {
            if (status !== 'idle') return;
            performCheck();
        }, 10 * 60 * 1000); // Every 10 mins

        // Initial check
        // checkUpdate();

        return () => clearInterval(interval);
    }, []);

    const performCheck = async () => {
         try {
            const localVersion = await window.api.getExtensionVersion();
            // We need to fetch extension_version from Supabase.
            const SUPABASE_REST = 'https://gqrwykhhqjimsgiqkgut.supabase.co/rest/v1/app_config?key=in.(extension_version,extension_url,extension_hash)';
            const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxcnd5a2hocWppbXNnaXFrZ3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNzAsImV4cCI6MjA4NzI4ODI3MH0.OVLEQdhYN6VHi5OQC_51EnDPoPPbnV0HuNHtchPy244';
            
            const response = await fetch(SUPABASE_REST, {
                headers: { 'apikey': API_KEY, 'Authorization': `Bearer ${API_KEY}` }
            });
            const data = await response.json();
            
            if (data && Array.isArray(data)) {
                const vRow = data.find(r => r.key === 'extension_version');
                const uRow = data.find(r => r.key === 'extension_url');
                const hRow = data.find(r => r.key === 'extension_hash');
                
                if (vRow && uRow?.value && hRow?.value && vRow.value !== localVersion && compareVersions(vRow.value, localVersion)) {
                    setUpdateInfo({
                        available: true,
                        version: vRow.value,
                        url: uRow.value,
                        hash: hRow.value
                    });
                }
            }
         } catch (e) {
             console.error('[ExtensionNotify] Check failed', e);
         }
    };

    useEffect(() => {
        performCheck();
    }, []);

    const compareVersions = (v1: string, v2: string) => {
        const p1 = v1.replace(/^v/, '').split('.').map(Number);
        const p2 = v2.replace(/^v/, '').split('.').map(Number);
        for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
            const n1 = p1[i] || 0;
            const n2 = p2[i] || 0;
            if (n1 > n2) return true;
            if (n1 < n2) return false;
        }
        return false;
    };

    const handleInstall = async () => {
        if (!updateInfo?.url || !updateInfo?.hash) return;
        setStatus('installing');
        try {
            const res = await window.api.installExtensionUpdate(updateInfo.url, updateInfo.hash);
            if (res.success) {
                setStatus('success');
                setTimeout(() => setUpdateInfo(null), 5000);
            } else {
                setStatus('error');
            }
        } catch (e) {
            setStatus('error');
        }
    };

    if (!updateInfo?.available || updateInfo?.dismissed) return null;

    return (
        <div className="fixed bottom-6 left-6 z-50 animate-in slide-in-from-left-4 duration-500">
            <div className="w-80 bg-slate-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4">
                    <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-2xl ${status === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                            {status === 'success' ? <CheckCircle className="w-6 h-6" /> : 
                             status === 'error' ? <AlertCircle className="w-6 h-6 text-red-400" /> :
                             <Package className="w-6 h-6" />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-white mb-1">
                                {t.extensionUpdate.title}
                            </h4>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                {status === 'success' ? t.extensionUpdate.success : 
                                 status === 'error' ? t.extensionUpdate.error :
                                 t.extensionUpdate.available.replace('{v}', updateInfo.version || '')}
                            </p>
                        </div>

                        <button 
                            onClick={() => setUpdateInfo(prev => prev ? { ...prev, dismissed: true } : null)}
                            className="text-slate-500 hover:text-white transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="mt-4">
                        {status === 'idle' || status === 'error' ? (
                            <button
                                onClick={handleInstall}
                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-indigo-900/20"
                            >
                                {t.extensionUpdate.installBtn}
                            </button>
                        ) : status === 'installing' ? (
                            <div className="w-full py-2.5 bg-slate-800 text-indigo-400 text-xs font-bold rounded-xl flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                {t.extensionUpdate.installing}
                            </div>
                        ) : (
                            <div className="w-full py-2.5 bg-green-500/10 text-green-400 text-xs font-bold rounded-xl flex items-center justify-center gap-2">
                                {t.extensionUpdate.ready}
                            </div>
                        )}
                    </div>
                </div>
                
                {status === 'installing' && (
                    <div className="h-1 w-full bg-slate-800">
                        <div className="h-full bg-indigo-500 animate-[loading_2s_ease-in-out_infinite]" style={{ width: '40%' }} />
                    </div>
                )}
            </div>
        </div>
    );
}
