import { X, Mail, Globe, Github, Award, Code2, Download, Users } from 'lucide-react';
import aboutData from '../about.json';

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1a1a1a] rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden border border-white/10">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Download className="w-8 h-8 text-white" />
                        <div>
                            <h2 className="text-2xl font-bold text-white">{aboutData.application.name}</h2>
                            <p className="text-blue-100 text-sm">Version {aboutData.application.version}</p>
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
                            {aboutData.application.description}
                        </p>
                    </div>

                    {/* Developer Info */}
                    <div className="bg-white/5 rounded-lg p-6 mb-6 border border-white/10">
                        <div className="flex items-center gap-2 mb-4">
                            <Users className="w-5 h-5 text-blue-400" />
                            <h3 className="text-xl font-semibold text-white">Développeur</h3>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-start gap-3">
                                <Award className="w-5 h-5 text-purple-400 mt-1" />
                                <div>
                                    <p className="text-white font-medium">{aboutData.developer.name}</p>
                                    <p className="text-gray-400 text-sm">{aboutData.developer.role}</p>
                                    <p className="text-gray-400 text-sm">{aboutData.developer.city}, {aboutData.developer.country}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Mail className="w-5 h-5 text-blue-400" />
                                <a
                                    href={`mailto:${aboutData.developer.email}`}
                                    className="text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    {aboutData.developer.email}
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* Features */}
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Code2 className="w-5 h-5 text-green-400" />
                            <h3 className="text-xl font-semibold text-white">Fonctionnalités</h3>
                        </div>
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {aboutData.features.map((feature, index) => (
                                <li key={index} className="flex items-start gap-2 text-gray-300">
                                    <span className="text-green-400 mt-1">✓</span>
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Technologies */}
                    <div className="bg-white/5 rounded-lg p-6 mb-6 border border-white/10">
                        <div className="flex items-center gap-2 mb-4">
                            <Code2 className="w-5 h-5 text-orange-400" />
                            <h3 className="text-xl font-semibold text-white">Technologies</h3>
                        </div>
                        <div className="space-y-2">
                            <p className="text-gray-300"><span className="text-white font-medium">Framework:</span> {aboutData.technologies.framework}</p>
                            <p className="text-gray-300"><span className="text-white font-medium">Moteur:</span> {aboutData.technologies.downloadEngine}</p>
                            <p className="text-gray-300"><span className="text-white font-medium">Plateformes:</span> {aboutData.technologies.platforms.join(', ')}</p>
                        </div>
                    </div>

                    {/* Credits */}
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Github className="w-5 h-5 text-purple-400" />
                            <h3 className="text-xl font-semibold text-white">Open Source</h3>
                        </div>
                        <div className="space-y-3">
                            {aboutData.credits.thirdParty.map((lib, index) => (
                                <div key={index} className="bg-white/5 rounded-lg p-4 border border-white/10">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h4 className="text-white font-medium">{lib.name}</h4>
                                            <p className="text-gray-400 text-sm">{lib.description}</p>
                                            <p className="text-gray-500 text-xs mt-1">Licence: {lib.license}</p>
                                        </div>
                                        <a
                                            href={lib.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-400 hover:text-blue-300 transition-colors"
                                        >
                                            <Globe className="w-5 h-5" />
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Copyright */}
                    <div className="text-center pt-6 border-t border-white/10">
                        <p className="text-gray-400 text-sm">{aboutData.legal.copyright}</p>
                        <p className="text-gray-500 text-xs mt-1">Licence {aboutData.legal.license}</p>
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
