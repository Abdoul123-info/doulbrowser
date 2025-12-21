import { X, Download, Link, Youtube } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useTranslation } from '../utils/i18n';

type AddDownloadModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (url: string) => void;
};

function detectSocialPlatform(url: string): { isSocial: boolean; platform: string } {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        
        if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
            return { isSocial: true, platform: 'YouTube' };
        }
        if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch')) {
            return { isSocial: true, platform: 'Facebook' };
        }
        if (hostname.includes('instagram.com')) {
            return { isSocial: true, platform: 'Instagram' };
        }
        if (hostname.includes('tiktok.com') || hostname.includes('vm.tiktok.com')) {
            return { isSocial: true, platform: 'TikTok' };
        }
        if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
            return { isSocial: true, platform: 'Twitter' };
        }
        if (hostname.includes('reddit.com') || hostname.includes('redd.it')) {
            return { isSocial: true, platform: 'Reddit' };
        }
        if (hostname.includes('vimeo.com')) {
            return { isSocial: true, platform: 'Vimeo' };
        }
        if (hostname.includes('dailymotion.com')) {
            return { isSocial: true, platform: 'Dailymotion' };
        }
        if (hostname.includes('twitch.tv')) {
            return { isSocial: true, platform: 'Twitch' };
        }
        
        return { isSocial: false, platform: '' };
    } catch {
        return { isSocial: false, platform: '' };
    }
}

export function AddDownloadModal({ isOpen, onClose, onAdd }: AddDownloadModalProps) {
    const { t } = useTranslation();
    const [url, setUrl] = useState('');
    
    const { isSocial, platform } = useMemo(() => url.trim() ? detectSocialPlatform(url.trim()) : { isSocial: false, platform: '' }, [url]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (url.trim()) {
            onAdd(url.trim());
            setUrl('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        {isSocial ? (
                            <Youtube className="w-5 h-5 text-red-500" />
                        ) : (
                            <Download className="w-5 h-5 text-blue-500" />
                        )}
                        {t.addDownload.title}
                        {isSocial && (
                            <span className="ml-2 px-2 py-0.5 bg-red-500/10 text-red-500 text-xs rounded">
                                {platform}
                            </span>
                        )}
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="url" className="block text-sm font-medium mb-1.5">
                                {t.addDownload.downloadUrl}
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                                    <Link className="w-4 h-4" />
                                </div>
                                <input
                                    type="url"
                                    id="url"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder={isSocial ? t.addDownload.placeholderSocial.replace('{platform}', platform.toLowerCase()) : t.addDownload.placeholder}
                                    className={`w-full pl-9 pr-3 py-2 bg-secondary/80 text-foreground placeholder:text-muted-foreground border rounded-md focus:outline-none focus:ring-2 transition-all ${
                                        isSocial 
                                            ? 'border-red-500/50 focus:ring-red-500/50 focus:border-red-500' 
                                            : 'border-border focus:ring-blue-500/50 focus:border-blue-500'
                                    }`}
                                    style={{ color: 'hsl(var(--foreground))' }}
                                    autoFocus
                                    required
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
                            >
                                {t.addDownload.cancel}
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm transition-colors flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                {t.addDownload.startDownload}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
