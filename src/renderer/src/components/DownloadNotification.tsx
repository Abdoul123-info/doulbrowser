import { Download, X, CheckCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';

interface DetectedDownload {
    url: string;
    filename: string;
    mimeType: string;
    size: number;
}

export function DownloadNotification() {
    const { t } = useTranslation();
    const [detectedDownloads, setDetectedDownloads] = useState<DetectedDownload[]>([]);

    useEffect(() => {
        const handleDownloadDetected = (_event: any, data: DetectedDownload) => {
            // Vérifier si ce téléchargement n'est pas déjà dans la liste
            setDetectedDownloads(prev => {
                const exists = prev.find(d => d.url === data.url);
                if (exists) {
                    // Mettre à jour les informations si déjà présent
                    return prev.map(d => d.url === data.url ? { ...d, ...data } : d);
                }
                // Ajouter le nouveau téléchargement détecté
                return [...prev, data];
            });
        };

        window.api.onDownloadDetected(handleDownloadDetected);

        return () => {
            window.api.removeDownloadListeners();
        };
    }, []);

    const handleAccept = (download: DetectedDownload) => {
        window.api.acceptDetectedDownload(download.url);
        setDetectedDownloads(prev => prev.filter(d => d.url !== download.url));
    };

    const handleDismiss = (download: DetectedDownload) => {
        window.api.dismissDetectedDownload(download.url);
        setDetectedDownloads(prev => prev.filter(d => d.url !== download.url));
    };

    if (detectedDownloads.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
            {detectedDownloads.map((download) => (
                <div
                    key={download.url}
                    className="bg-card border border-border rounded-lg shadow-lg p-4 animate-in slide-in-from-right duration-300"
                >
                    <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <Download className="w-5 h-5 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-foreground mb-1">
                                {t.downloadNotification?.title || 'Téléchargement détecté'}
                            </h4>
                            <p className="text-xs text-muted-foreground truncate mb-2" title={download.filename}>
                                {download.filename}
                            </p>
                            {download.size > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {formatBytes(download.size)}
                                </p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleAccept(download)}
                                className="p-1.5 hover:bg-green-500/10 rounded-md text-green-500 hover:text-green-600 transition-colors"
                                title={t.downloadNotification?.accept || 'Télécharger'}
                            >
                                <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDismiss(download)}
                                className="p-1.5 hover:bg-red-500/10 rounded-md text-muted-foreground hover:text-red-500 transition-colors"
                                title={t.downloadNotification?.dismiss || 'Ignorer'}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}







