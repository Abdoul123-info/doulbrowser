// Système de traduction simple
export type Language = 'fr' | 'en';

export interface Translations {
  // Sidebar
  sidebar: {
    allDownloads: string;
    downloading: string;
    finished: string;
    queued: string;
    trash: string;
    settings: string;
  };
  // Settings
  settings: {
    title: string;
    help: string;
    language: string;
    languageLabel: string;
    selectLanguage: string;
    close: string;
    downloadFolder: string;
    downloadFolderDescription: string;
    browse: string;
    maxConcurrentDownloads: string;
    maxConcurrentDownloadsLabel: string;
    maxConcurrentDownloadsDescription: string;
    maxRetries: string;
    maxRetriesLabel: string;
    maxRetriesDescription: string;
    notifications: string;
    enableNotifications: string;
    enableSoundNotifications: string;
    notificationsDescription: string;
    autoStart: string;
    enableAutoStart: string;
    autoStartDescription: string;
    cancel: string;
    save: string;
    saving: string;
    loadingSettings: string;
    languageNote: string;
  };
  // Help
  help: {
    title: string;
    description: string;
    howToUse: string;
    step1: string;
    step2: string;
    step3: string;
    supportedPlatforms: string;
    platforms: string;
  };
  // Common
  common: {
    cancel: string;
    save: string;
  };
  // DownloadList
  downloadList: {
    allDownloads: string;
    trash: string;
    downloads: string;
    addUrl: string;
    fileName: string;
    size: string;
    progress: string;
    speed: string;
    status: string;
    actions: string;
    noDownloads: string;
    deleteConfirm: string;
    cancelConfirm: string;
    alreadyInProgress: string;
    waiting: string;
    selected: string;
    resumeSelected: string;
    stopSelected: string;
    deleteSelected: string;
    resumeAll: string;
    stopAll: string;
  };
  // AddDownloadModal
  addDownload: {
    title: string;
    downloadUrl: string;
    cancel: string;
    startDownload: string;
    placeholder: string;
    placeholderSocial: string;
  };
  // Status
  status: {
    downloading: string;
    paused: string;
    finished: string;
    error: string;
    queued: string;
    cancelled: string;
    interrupted: string;
  };
  // Download Notification
  downloadNotification: {
    title: string;
    accept: string;
    dismiss: string;
  };
  // Quality Selector
  qualitySelector: {
    title: string;
    loading: string;
    error: string;
    resolution: string;
    size: string;
    action: string;
    audioOnly: string;
    audioDesc: string;
    download: string;
    unknown: string;
  };
}

const translations: Record<Language, Translations> = {
  fr: {
    sidebar: {
      allDownloads: 'Tous les téléchargements',
      downloading: 'En cours',
      finished: 'Terminés',
      queued: 'En attente',
      trash: 'Corbeille',
      settings: 'Paramètres',
    },
    settings: {
      title: 'Paramètres',
      help: 'Aide',
      language: 'Langue',
      languageLabel: 'Sélectionner la langue',
      selectLanguage: 'Sélectionner la langue',
      close: 'Fermer',
      downloadFolder: 'Dossier de téléchargement',
      downloadFolderDescription: 'Dossier où seront sauvegardés les fichiers téléchargés',
      browse: 'Parcourir',
      maxConcurrentDownloads: 'Téléchargements simultanés',
      maxConcurrentDownloadsLabel: 'Nombre maximum de téléchargements simultanés',
      maxConcurrentDownloadsDescription: 'Limite le nombre de téléchargements qui peuvent s\'exécuter en même temps (1-10)',
      maxRetries: 'Tentatives de retry',
      maxRetriesLabel: 'Nombre maximum de tentatives en cas d\'échec',
      maxRetriesDescription: 'Nombre de fois que l\'application réessayera un téléchargement en cas d\'échec (0-10)',
      notifications: 'Notifications',
      enableNotifications: 'Activer les notifications système',
      enableSoundNotifications: 'Activer les sons de notification',
      notificationsDescription: 'Recevez des notifications lorsque les téléchargements se terminent ou échouent',
      autoStart: 'Auto-démarrage',
      enableAutoStart: 'Démarrer automatiquement au démarrage du système',
      autoStartDescription: 'L\'application démarrera automatiquement lorsque vous allumez votre ordinateur',
      cancel: 'Annuler',
      save: 'Enregistrer',
      saving: 'Sauvegarde...',
      loadingSettings: 'Chargement des paramètres...',
      languageNote: 'La langue sera appliquée après le rechargement de la page',
    },
    help: {
      title: 'Aide',
      description: 'Bienvenue dans le gestionnaire de téléchargements',
      howToUse: 'Comment utiliser',
      step1: '1. Cliquez sur "Ajouter une URL" pour ajouter un nouveau téléchargement',
      step2: '2. Collez l\'URL du fichier ou de la vidéo à télécharger',
      step3: '3. Sélectionnez le dossier de destination et le téléchargement commencera',
      supportedPlatforms: 'Plateformes supportées',
      platforms: 'YouTube, Facebook, Instagram, TikTok, Twitter, Reddit, Vimeo, Dailymotion, Twitch et tous les fichiers directs',
    },
    common: {
      cancel: 'Annuler',
      save: 'Enregistrer',
    },
    downloadList: {
      allDownloads: 'Tous les téléchargements',
      trash: 'Corbeille',
      downloads: 'Téléchargements',
      addUrl: 'Ajouter une URL',
      fileName: 'Nom du fichier',
      size: 'Taille',
      progress: 'Progression',
      speed: 'Vitesse',
      status: 'Statut',
      actions: 'Actions',
      noDownloads: 'Aucun téléchargement trouvé dans cette catégorie.',
      deleteConfirm: 'Êtes-vous sûr de vouloir supprimer ce téléchargement de la liste ?',
      cancelConfirm: 'Êtes-vous sûr de vouloir annuler ce téléchargement ?',
      alreadyInProgress: 'Ce téléchargement est déjà en cours',
      waiting: 'En attente...',
      selected: 'sélectionnés',
      resumeSelected: 'Reprendre',
      stopSelected: 'Arrêter',
      deleteSelected: 'Supprimer',
      resumeAll: 'Tout Reprendre',
      stopAll: 'Tout Arrêter',
    },
    addDownload: {
      title: 'Ajouter un nouveau téléchargement',
      downloadUrl: 'URL de téléchargement',
      cancel: 'Annuler',
      startDownload: 'Démarrer le téléchargement',
      placeholder: 'https://exemple.com/fichier.zip',
      placeholderSocial: 'https://{platform}.com/...',
    },
    status: {
      downloading: 'en cours',
      paused: 'en pause',
      finished: 'terminé',
      error: 'erreur',
      queued: 'en attente',
      cancelled: 'annulé',
      interrupted: 'interrompu',
    },
    downloadNotification: {
      title: 'Téléchargement détecté',
      accept: 'Télécharger',
      dismiss: 'Ignorer',
    },
    qualitySelector: {
      title: 'Options de téléchargement',
      loading: 'Récupération des informations...',
      error: 'Erreur lors du chargement des informations',
      resolution: 'Résolution',
      size: 'Taille',
      action: 'Action',
      audioOnly: 'Audio Seulement',
      audioDesc: 'MP3 (Meilleure Qualité)',
      download: 'Télécharger',
      unknown: 'Taille inconnue',
    },
  },
  en: {
    sidebar: {
      allDownloads: 'All Downloads',
      downloading: 'Downloading',
      finished: 'Finished',
      queued: 'Queued',
      trash: 'Trash',
      settings: 'Settings',
    },
    settings: {
      title: 'Settings',
      help: 'Help',
      language: 'Language',
      languageLabel: 'Select Language',
      selectLanguage: 'Select Language',
      close: 'Close',
      downloadFolder: 'Download Folder',
      downloadFolderDescription: 'Folder where downloaded files will be saved',
      browse: 'Browse',
      maxConcurrentDownloads: 'Simultaneous Downloads',
      maxConcurrentDownloadsLabel: 'Maximum number of simultaneous downloads',
      maxConcurrentDownloadsDescription: 'Limits the number of downloads that can run at the same time (1-10)',
      maxRetries: 'Retry Attempts',
      maxRetriesLabel: 'Maximum number of attempts in case of failure',
      maxRetriesDescription: 'Number of times the application will retry a download in case of failure (0-10)',
      notifications: 'Notifications',
      enableNotifications: 'Enable system notifications',
      enableSoundNotifications: 'Enable notification sounds',
      notificationsDescription: 'Receive notifications when downloads complete or fail',
      autoStart: 'Auto-start',
      enableAutoStart: 'Start automatically at system startup',
      autoStartDescription: 'The application will start automatically when you turn on your computer',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving...',
      loadingSettings: 'Loading settings...',
      languageNote: 'Language will be applied after page reload',
    },
    help: {
      title: 'Help',
      description: 'Welcome to the download manager',
      howToUse: 'How to use',
      step1: '1. Click "Add URL" to add a new download',
      step2: '2. Paste the URL of the file or video to download',
      step3: '3. Select the destination folder and the download will start',
      supportedPlatforms: 'Supported Platforms',
      platforms: 'YouTube, Facebook, Instagram, TikTok, Twitter, Reddit, Vimeo, Dailymotion, Twitch and all direct files',
    },
    common: {
      cancel: 'Cancel',
      save: 'Save',
    },
    downloadList: {
      allDownloads: 'All Downloads',
      trash: 'Trash',
      downloads: 'Downloads',
      addUrl: 'Add URL',
      fileName: 'File Name',
      size: 'Size',
      progress: 'Progress',
      speed: 'Speed',
      status: 'Status',
      actions: 'Actions',
      noDownloads: 'No downloads found in this category.',
      deleteConfirm: 'Are you sure you want to delete this download from the list?',
      cancelConfirm: 'Are you sure you want to cancel this download?',
      alreadyInProgress: 'This download is already in progress',
      waiting: 'Waiting...',
      selected: 'selected',
      resumeSelected: 'Resume',
      stopSelected: 'Stop',
      deleteSelected: 'Delete',
      resumeAll: 'Resume All',
      stopAll: 'Stop All',
    },
    addDownload: {
      title: 'Add New Download',
      downloadUrl: 'Download URL',
      cancel: 'Cancel',
      startDownload: 'Start Download',
      placeholder: 'https://example.com/file.zip',
      placeholderSocial: 'https://{platform}.com/...',
    },
    status: {
      downloading: 'downloading',
      paused: 'paused',
      finished: 'finished',
      error: 'error',
      queued: 'queued',
      cancelled: 'cancelled',
      interrupted: 'interrupted',
    },
    downloadNotification: {
      title: 'Download detected',
      accept: 'Download',
      dismiss: 'Dismiss',
    },
    qualitySelector: {
      title: 'Download Options',
      loading: 'Fetching video information...',
      error: 'Failed to load video info',
      resolution: 'Resolution',
      size: 'Size',
      action: 'Action',
      audioOnly: 'Audio Only',
      audioDesc: 'MP3 (Best Quality)',
      download: 'Download',
      unknown: 'Unknown size',
    },
  },
};

const STORAGE_KEY = 'app-language';

export function getLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') {
      return stored;
    }
  } catch (error) {
    console.error('Error loading language from storage:', error);
  }
  // Par défaut, détecter la langue du système
  const systemLang = navigator.language.toLowerCase();
  return systemLang.startsWith('fr') ? 'fr' : 'en';
}

export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    // Recharger la page pour appliquer la nouvelle langue
    window.location.reload();
  } catch (error) {
    console.error('Error saving language to storage:', error);
  }
}

export function getTranslations(lang?: Language): Translations {
  const currentLang = lang || getLanguage();
  return translations[currentLang];
}

// Hook pour utiliser les traductions dans les composants React
export function useTranslation() {
  const lang = getLanguage();
  const t = getTranslations(lang);

  return {
    t,
    lang,
    setLanguage: (newLang: Language) => setLanguage(newLang),
  };
}

