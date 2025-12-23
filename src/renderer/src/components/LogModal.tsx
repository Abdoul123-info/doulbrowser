import { X, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';

interface LogModalProps {
    isOpen: boolean;
    onClose: () => void;
    url: string;
    filename: string;
}

export function LogModal({ isOpen, onClose, url, filename }: LogModalProps) {
    const [logs, setLogs] = useState<string[]>([]);
    const [isCopying, setIsCopying] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        if (!url) return;
        try {
            const data = await window.api.getDownloadLogs(url);
            setLogs(data);
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchLogs();
            const interval = setInterval(fetchLogs, 2000);
            return () => clearInterval(interval);
        }
        return undefined;
    }, [isOpen, url]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    const handleCopy = () => {
        navigator.clipboard.writeText(logs.join(''));
        setIsCopying(true);
        setTimeout(() => setIsCopying(false), 2000);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-border flex justify-between items-center bg-secondary/30">
                    <div className="flex flex-col">
                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                            Technical Logs
                        </h3>
                        <span className="text-xs text-muted-foreground truncate max-w-[400px]">
                            {filename}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchLogs}
                            className="p-2 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                            title="Refresh"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleCopy}
                            className="p-2 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-foreground relative"
                            title="Copy to clipboard"
                        >
                            <Copy className="w-4 h-4" />
                            {isCopying && (
                                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] py-1 px-2 rounded whitespace-nowrap">
                                    Copied!
                                </span>
                            )}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-muted-foreground hover:text-red-500"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div
                    ref={scrollRef}
                    className="flex-1 p-4 overflow-auto font-mono text-xs bg-black text-green-400 selection:bg-green-500/30"
                >
                    {logs.length > 0 ? (
                        <pre className="whitespace-pre-wrap">
                            {logs.map((log, i) => (
                                <div key={i} className={log.includes('[ERROR]') ? 'text-red-400' : ''}>
                                    {log}
                                </div>
                            ))}
                        </pre>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4 opacity-50">
                            <div className="w-12 h-12 rounded-full border-2 border-dashed border-current animate-spin-slow" />
                            Waiting for log entries...
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-border bg-secondary/10 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
