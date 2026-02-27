import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { DownloadList } from './components/DownloadList';
import { SettingsModal } from './components/SettingsModal';
import { DownloadNotification } from './components/DownloadNotification';
import { NotificationManager } from './components/NotificationManager';
import { QualitySelector } from './components/QualitySelector';
import { AboutModal } from './components/AboutModal';
import { AdminModal } from './components/AdminModal';
import { LicenseGate } from './components/LicenseGate';

export default function App() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkActivation = async () => {
    try {
      const status = await window.api.getLicenseStatus();
      setIsActivated(status.isActivated);
    } catch (error) {
      console.error('Failed to check license status:', error);
      setIsActivated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkActivation();

    // [v1.9.30] Listen for remote deactivation (Heartbeat or System Admin)
    window.api.onLicenseDeactivated((_event, reason) => {
      alert(reason);
      setIsActivated(false);
    });

    // [v1.9.34] Heartbeat for Online status (every 2 minutes)
    const heartbeat = setInterval(() => {
      window.api.pingLicense();
    }, 2 * 60 * 1000);
    window.api.pingLicense();

    return () => clearInterval(heartbeat);
  }, []);


  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-[#020617] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {isActivated === false ? (
        <LicenseGate
          onActivated={() => setIsActivated(true)}
          onAdminClick={() => setIsAdminOpen(true)}
        />
      ) : (
        <div className="flex h-screen bg-background text-foreground font-sans antialiased selection:bg-blue-500/30">
          <Sidebar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onSettingsClick={() => setIsSettingsOpen(true)}
            onAboutClick={() => setIsAboutOpen(true)}
            onAdminClick={() => setIsAdminOpen(true)}
          />
          <DownloadList filter={activeFilter} />
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />
          <AboutModal
            isOpen={isAboutOpen}
            onClose={() => setIsAboutOpen(false)}
          />
          <DownloadNotification />
          <NotificationManager />
          <QualitySelector />
        </div>
      )}

      {/* AdminModal is always available in the DOM to be opened via hidden triggers */}
      <AdminModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
      />
    </>
  );
}
