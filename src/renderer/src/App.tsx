import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { DownloadList } from './components/DownloadList';
import { SettingsModal } from './components/SettingsModal';
import { DownloadNotification } from './components/DownloadNotification';
import { QualitySelector } from './components/QualitySelector';
import { AboutModal } from './components/AboutModal';

function App() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background text-foreground font-sans antialiased selection:bg-blue-500/30">
      <Sidebar
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onAboutClick={() => setIsAboutOpen(true)}
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
      <QualitySelector />
    </div>
  );
}

export default App;
