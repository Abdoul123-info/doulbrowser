import { useState, useEffect } from 'react';
import { X, Download, FileVideo, Music } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

// IPC types matching backend response (optimized - no thumbnail)
interface VideoInfo {
    title: string;
    videoFormats: VideoFormat[];
    audioFormats: AudioFormat[];
}

interface VideoFormat {
    id: string;
    ext: string;
    resolution?: string;
    height?: number;
    filesize?: number;
    note?: string;
    vcodec?: string;
    acodec?: string;
}

interface AudioFormat {
    id: string;
    ext: string;
    filesize?: number;
    abr?: number;
    note?: string;
}



export function QualitySelector() {
    useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
    const [url, setUrl] = useState<string>('');

    useEffect(() => {
        // Listen for show-quality-selector event from main process
        const handleShow = (_event: any, data: { url: string; loading: boolean }) => {
            setIsOpen(true);
            setUrl(data.url);
            setLoading(data.loading);
            setError(null);
            setVideoInfo(null);
        };

        const handleUpdate = (_event: any, data: { info?: VideoInfo; error?: string; loading: boolean }) => {
            setLoading(data.loading);
            if (data.error) {
                setError(data.error);
            }
            if (data.info) {
                setVideoInfo(data.info);
            }
        };

        // @ts-ignore (Assuming window.electron is available via preload)
        window.electron?.ipcRenderer.on('show-quality-selector', handleShow);
        // @ts-ignore
        window.electron?.ipcRenderer.on('update-quality-selector', handleUpdate);

        return () => {
            // @ts-ignore
            window.electron?.ipcRenderer.removeAllListeners('show-quality-selector');
            // @ts-ignore
            window.electron?.ipcRenderer.removeAllListeners('update-quality-selector');
        };
    }, []);

    const handleClose = () => {
        setIsOpen(false);
        setVideoInfo(null);
        setError(null);
    };

    const handleDownload = (formatId: string, ext: string, resolution?: string) => {
        if (!videoInfo) return;

        // Add resolution to filename to prevent overwriting
        const baseFilename = videoInfo.title.replace(/[^\\w\\s-]/g, '');
        const filenameWithRes = resolution ? `${baseFilename}_${resolution}` : baseFilename;

        // Send start-download-custom event
        // @ts-ignore
        window.electron?.ipcRenderer.send('start-download-custom', {
            url: url,
            formatId: formatId,
            filename: `${filenameWithRes}.${ext}`
        });

        handleClose();
    };

    const formatSize = (bytes?: number) => {
        if (!bytes || bytes === 0) return '~ Variable';
        const mb = bytes / (1024 * 1024);
        if (mb > 1024) return `~ ${(mb / 1024).toFixed(1)} GB`;
        return `~ ${mb.toFixed(1)} MB`;
    };

    if (!isOpen) return null;

    // Use videoFormats directly from backend (already filtered and sorted)
    const videoFormats = videoInfo?.videoFormats || [];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30">
                    <h3 className="font-semibold flex items-center gap-2">
                        <Download className="w-5 h-5 text-primary" />
                        Download Options
                    </h3>
                    <button onClick={handleClose} className="p-1 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-0 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            <p className="text-muted-foreground text-sm">Fetching video information...</p>
                        </div>
                    ) : error ? (
                        <div className="p-6 text-center text-red-500">
                            <p className="font-medium">Failed to load video info</p>
                            <p className="text-sm mt-1 text-muted-foreground">{error}</p>
                        </div>
                    ) : videoInfo && (
                        <div className="flex flex-col">
                            {/* Format List - Direct display without preview */}
                            <div className="divide-y divide-border">
                                <div className="p-3 bg-muted/10 text-xs font-medium text-muted-foreground uppercase tracking-wider flex justify-between px-6">
                                    <span>Resolution</span>
                                    <span>Est. Size</span>
                                    <span>Action</span>
                                </div>

                                {videoFormats.map(format => (
                                    <div key={format.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                                <FileVideo className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">{format.height}p</div>
                                                <div className="text-xs text-muted-foreground">{format.ext.toUpperCase()}</div>
                                            </div>
                                        </div>
                                        <div className="text-sm text-muted-foreground font-medium">
                                            {formatSize(format.filesize)}
                                        </div>
                                        <button
                                            onClick={() => handleDownload(format.id, 'mp4', `${format.height}p`)}
                                            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            Download
                                        </button>
                                    </div>
                                ))}

                                {/* Audio Only Option */}
                                <div className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors bg-blue-500/5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                                            <Music className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-semibold">Audio Only</div>
                                            <div className="text-xs text-muted-foreground">MP3 (Best Quality)</div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-muted-foreground font-medium">
                                        ~ 4-10 MB
                                    </div>
                                    <button
                                        onClick={() => {
                                            // @ts-ignore
                                            window.electron?.ipcRenderer.send('start-download-custom', {
                                                url: url,
                                                formatId: null, // Signals backend to use audio logic
                                                filename: `${videoInfo.title.replace(/[^\w\s-]/g, '')}.mp3`,
                                                audioOnly: true // Explicit flag
                                            });

                                            handleClose();
                                        }}
                                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                        Download
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
