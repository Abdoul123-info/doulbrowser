import { X, Award, Code2, Download, Users, Monitor, RefreshCw } from 'lucide-react';
import { useTranslation } from '../utils/i18n';
import { useState, useEffect } from 'react';

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
    const { t } = useTranslation();
    const [version, setVersion] = useState('...');
    const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'success' | 'error'>('idle');
    const [extensionPath, setExtensionPath] = useState('');
    const [browserOpened, setBrowserOpened] = useState(true);

    useEffect(() => {
        if (isOpen) {
            window.api.getAppVersion().then(v => setVersion(v));
            setInstallStatus('idle');
            setExtensionPath('');
        }
    }, [isOpen]);

    const handleInstallExtension = async () => {
        setInstallStatus('installing');
        try {
            const res = await window.api.registerExtensionInBrowsers();
            if (res.success) {
                setExtensionPath(res.extensionPath || '');
                setBrowserOpened(res.browserOpened !== false);
                setInstallStatus('success');
            } else {
                setInstallStatus('error');
            }
        } catch (e) {
            console.error('[About] Registration failed:', e);
            setInstallStatus('error');
        }
    };

    if (!isOpen) return null;

    const features = [
        t.about.feature1, t.about.feature2, t.about.feature3,
        t.about.feature4, t.about.feature5, t.about.feature6,
        t.about.feature7, t.about.feature8, t.about.feature9,
        t.about.feature10, t.about.feature11, t.about.feature12,
    ];

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1a1a1a] rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden border border-white/10">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Download className="w-8 h-8 text-white" />
                        <div>
                            <h2 className="text-2xl font-bold text-white">DoulGet</h2>
                            <p className="text-blue-100 text-sm">Version {version}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <X className="w-6 h-6 text-white" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)] custom-scrollbar">
                    {/* Description */}
                    <div className="mb-6">
                        <p className="text-gray-300 text-lg leading-relaxed">
                            {t.about.description}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        {/* Extension Installation Section */}
                        <div className="bg-indigo-600/10 rounded-lg p-6 border border-indigo-500/20">
                            <div className="flex items-center gap-2 mb-4">
                                <Monitor className="w-5 h-5 text-indigo-400" />
                                <h3 className="text-xl font-semibold text-white">{t.autoInstall.title}</h3>
                            </div>
                            <p className="text-gray-400 text-sm mb-4 leading-relaxed">
                                {t.autoInstall.description}
                            </p>
                            
                            {installStatus === 'idle' || installStatus === 'error' ? (
                                <button
                                    onClick={handleInstallExtension}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-all shadow-lg shadow-indigo-900/40 text-sm"
                                >
                                    {t.autoInstall.button}
                                </button>
                            ) : installStatus === 'installing' ? (
                                <div className="w-full py-3 bg-white/5 text-indigo-400 font-bold rounded-lg flex items-center justify-center gap-2 text-sm">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    {t.autoInstall.installing}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="w-full py-2 bg-green-500/10 text-green-400 font-bold rounded-lg text-center text-sm border border-green-500/20">
                                        ✅ Extension préparée !
                                    </div>
                                    <p className="text-[11px] text-gray-300 font-semibold">Suivez ces étapes dans Chrome :</p>
                                    <ol className="text-[11px] text-gray-300 space-y-1 list-decimal list-inside">
                                        <li>{browserOpened
                                            ? <>Votre navigateur s'est ouvert sur <span className="text-blue-400">chrome://extensions/</span></>
                                            : <>Ouvrez <span className="text-blue-400">chrome://extensions/</span> dans votre navigateur</>}</li>
                                        <li>Activez le <strong className="text-white">Mode développeur</strong> (haut à droite)</li>
                                        <li>Cliquez <strong className="text-white">"Charger l'extension non empaquetée"</strong></li>
                                        <li>Sélectionnez ce dossier :</li>
                                    </ol>
                                    <p className="text-[10px] text-amber-300/90 italic">⟳ Si l'extension est déjà installée, cliquez plutôt sur le bouton Actualiser de la carte DoulGet dans chrome://extensions/.</p>
                                    {extensionPath && (
                                        <div className="bg-black/40 rounded p-2 text-[10px] text-blue-300 font-mono break-all border border-blue-500/20 select-all cursor-text">
                                            {extensionPath}
                                        </div>
                                    )}
                                    <p className="text-[10px] text-gray-500 italic">💡 Un fichier texte avec ce chemin a aussi été créé sur votre Bureau.</p>
                                </div>
                            )}

                            {installStatus === 'error' && (
                                <p className="text-red-400 text-[10px] mt-2 text-center">
                                    {t.autoInstall.error}
                                </p>
                            )}
                        </div>

                        {/* Developer Info */}
                        <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                            <div className="flex items-center gap-2 mb-4">
                                <Users className="w-5 h-5 text-blue-400" />
                                <h3 className="text-xl font-semibold text-white">{t.about.developer}</h3>
                            </div>
                            <div className="flex items-start gap-3">
                                <Award className="w-5 h-5 text-purple-400 mt-1" />
                                <div>
                                    <p className="text-white font-medium">Oumarou Abdoul Jabbar</p>
                                    <p className="text-gray-400 text-sm">{t.about.role}</p>
                                    <p className="text-gray-400 text-sm">Niamey, Niger</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Features */}
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Code2 className="w-5 h-5 text-green-400" />
                            <h3 className="text-xl font-semibold text-white">{t.about.features}</h3>
                        </div>
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {features.map((feature, index) => (
                                <li key={index} className="flex items-start gap-2 text-gray-300">
                                    <span className="text-green-400 mt-1">✓</span>
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Copyright */}
                    <div className="text-center pt-6 border-t border-white/10">
                        <p className="text-gray-400 text-sm">{t.about.copyright}</p>
                        <p className="text-gray-500 text-xs mt-1">{t.about.licenseLabel} MIT</p>
                    </div>
                </div>
            </div>

            <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
        </div>
    );
}
