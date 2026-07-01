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
    about: string;
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
    viewLogs: string;
    restore: string;
    restoreSelected: string;
  };
  // AddDownloadModal
    addDownload: {
      title: string;
      downloadUrl: string;
      cancel: string;
      startDownload: string;
      downloadVideo: string;
      downloadAudio: string;
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
  // Sidebar extras
  sidebarExtra: {
    converter: string;
    compressor: string;
    batch: string;
    feedback: string;
    updateAvailable: string;
    updateDownloading: string;
    updateReady: string;
    updateError: string;
    navGroup: string;
    toolsGroup: string;
  };
  // Feedback Modal
  feedback: {
    title: string;
    subtitle: string;
    commentLabel: string;
    commentPlaceholder: string;
    sendError: string;
    later: string;
    send: string;
    thankYou: string;
    thankYouSub: string;
    bad: string;
    okay: string;
    good: string;
    veryGood: string;
    excellent: string;
  };
  // License Gate
  license: {
    title: string;
    subtitle: string;
    placeholder: string;
    activate: string;
    activating: string;
    machineId: string;
    copy: string;
    copied: string;
  };
  // Admin Modal
  admin: {
    title: string;
    accessRestricted: string;
    password: string;
    unlock: string;
    wrongPassword: string;
    tabGeneration: string;
    tabCloud: string;
    tabUpdates: string;
    tabFeedback: string;
    duration: string;
    month1: string;
    year1: string;
    lifetime: string;
    customDate: string;
    singleKey: string;
    hwidClient: string;
    generate: string;
    bulkGeneration: string;
    count: string;
    generateKeys: string;
    maintenance: string;
    maintenanceDesc: string;
    resetPc: string;
    results: string;
    copyClip: string;
    exportTxt: string;
    subscribers: string;
    online: string;
    banned: string;
    refresh: string;
    searchPlaceholder: string;
    hwid: string;
    originalKey: string;
    activation: string;
    statusLabel: string;
    actionLabel: string;
    noUsers: string;
    activatedOn: string;
    statusActive: string;
    statusBan: string;
    statusTrial: string;
    publishVersion: string;
    versionNumber: string;
    directLink: string;
    publishUpdate: string;
    uploading: string;
    publishNote: string;
    setupExe: string;
    extensionZip: string;
    clickOrDrag: string;
    totalFeedback: string;
    avgRating: string;
    noFeedback: string;
    logout: string;
    bulkNote: string;
    confirmReset: string;
    confirmDelete: string;
  };
  // MP3 Converter
  converter: {
    title: string;
    subtitle: string;
    selectVideo: string;
    videoSelected: string;
    chooseVideo: string;
    startBtn: string;
    converting: string;
    convertingSub: string;
    success: string;
    successSub: string;
    anotherBtn: string;
    error: string;
    retryBtn: string;
    failed: string;
  };
  // Video Compressor
  compressor: {
    title: string;
    subtitle: string;
    selectVideo: string;
    videoSelected: string;
    chooseVideo: string;
    qualityLabel: string;
    qLow: string;
    qLowDesc: string;
    qMed: string;
    qMedDesc: string;
    qWhatsapp: string;
    qWhatsappDesc: string;
    startBtn: string;
    compressing: string;
    compressingSub: string;
    success: string;
    successSub: string;
    saveLocation: string;
    anotherBtn: string;
    error: string;
    retryBtn: string;
    failed: string;
  };
  // Batch Download
  batch: {
    title: string;
    subtitle: string;
    inputLabel: string;
    inputPlaceholder: string;
    fetch: string;
    fetching: string;
    fetchingSub: string;
    fetchBtn: string;
    selectedCount: string;
    selectAll: string;
    deselectAll: string;
    videoMode: string;
    audioMode: string;
    startBtn: string;
    successTitle: string;
    successSub: string;
    addingTitle: string;
    addingSub: string;
    errorFetch: string;
    items: string;
  };
  // About Modal
  about: {
    description: string;
    developer: string;
    role: string;
    features: string;
    copyright: string;
    licenseLabel: string;
    feature1: string;
    feature2: string;
    feature3: string;
    feature4: string;
    feature5: string;
    feature6: string;
    feature7: string;
    feature8: string;
    feature9: string;
    feature10: string;
    feature11: string;
    feature12: string;
  };
  extensionUpdate: {
    title: string;
    available: string;
    installBtn: string;
    installing: string;
    ready: string;
    error: string;
    success: string;
  };
  autoInstall: {
    title: string;
    description: string;
    button: string;
    installing: string;
    success: string;
    error: string;
    chromeNote: string;
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
      about: 'À propos',
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
      viewLogs: 'Voir les logs',
      restore: 'Restaurer',
      restoreSelected: 'Restaurer la sélection',
    },
    addDownload: {
      title: 'Ajouter un nouveau téléchargement',
      downloadUrl: 'URL de téléchargement',
      cancel: 'Annuler',
      startDownload: 'Démarrer le téléchargement',
      downloadVideo: 'Télécharger Vidéo',
      downloadAudio: 'Télécharger Audio (MP3)',
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
    sidebarExtra: {
      converter: 'Convertisseur MP3',
      compressor: 'Compresseur Vidéo',
      batch: 'Téléchargement Groupé',
      feedback: 'Donner votre avis',
      updateAvailable: 'MAJ DISPONIBLE · Cliquez pour installer',
      updateDownloading: 'Téléchargement de la mise à jour...',
      updateReady: '✅ Prêt ! Installer & Redémarrer',
      updateError: '⚠️ Erreur de téléchargement. Réessayez.',
      navGroup: 'Navigation',
      toolsGroup: 'Outils & Services',
    },
    feedback: {
      title: 'Votre avis nous aide !',
      subtitle: 'Comment trouvez-vous DoulGet ?',
      commentLabel: 'Commentaire (facultatif)',
      commentPlaceholder: 'Partagez votre expérience, suggestions, ou problèmes rencontrés...',
      sendError: '⚠️ Erreur lors de l\'envoi. Vérifiez votre connexion.',
      later: 'Plus tard',
      send: 'Envoyer',
      thankYou: 'Merci pour votre avis !',
      thankYouSub: 'Votre retour nous aide à améliorer DoulGet.',
      bad: 'Mauvais',
      okay: 'Passable',
      good: 'Bien',
      veryGood: 'Très bien',
      excellent: 'Excellent !',
    },
    license: {
      title: 'Activation Requise',
      subtitle: 'Veuillez entrer votre clé de licence pour activer DoulGet.',
      placeholder: 'Entrez votre clé de licence',
      activate: 'ACTIVER',
      activating: 'Activation...',
      machineId: 'ID Machine',
      copy: 'Copier',
      copied: 'Copié !',
    },
    admin: {
      title: 'Administration Licence (SECRET)',
      accessRestricted: 'Accès restreint. Veuillez entrer le Mot de Passe Maître.',
      password: 'Mot de passe',
      unlock: 'DÉVERROUILLER',
      wrongPassword: 'Mot de passe incorrect.',
      tabGeneration: 'Génération',
      tabCloud: 'Gestion Cloud',
      tabUpdates: 'Mise à Jour',
      tabFeedback: 'Avis',
      duration: 'Durée de validité',
      month1: '1 Mois (Abonnement Standard)',
      year1: '1 An (Pack Premium)',
      lifetime: 'À Vie (Pack Illimité)',
      customDate: 'Date Personnalisée...',
      singleKey: 'Clé Unique',
      hwidClient: 'HWID Client (optionnel)',
      generate: 'GÉNÉRER',
      bulkGeneration: 'Génération en Masse',
      count: 'Nombre :',
      generateKeys: 'GÉNÉRER {count} CLÉS',
      maintenance: 'Maintenance locale',
      maintenanceDesc: 'Réinitialiser l\'activation de cet ordinateur',
      resetPc: 'RÉINITIALISER CE PC',
      results: 'Résultats',
      copyClip: 'Copier',
      exportTxt: 'Exporter .txt',
      subscribers: 'Abonnés',
      online: 'En Ligne',
      banned: 'Bannis',
      refresh: 'RAFRAÎCHIR',
      searchPlaceholder: 'Rechercher par HWID ou par clé d\'origine...',
      hwid: 'HWID',
      originalKey: 'Clé Origine',
      activation: 'Activation',
      statusLabel: 'Status',
      actionLabel: 'Action',
      noUsers: 'Aucun utilisateur enregistré.',
      activatedOn: 'Activé le',
      statusActive: 'ACTIF',
      statusBan: 'BAN',
      statusTrial: 'ESSAI',
      publishVersion: 'Publier une nouvelle version',
      versionNumber: 'Numéro de Version (ex: 1.2.9)',
      directLink: 'Lien Direct ou Public URL',
      publishUpdate: 'DIFFUSER LA MISE À JOUR',
      uploading: 'UPLOAD EN COURS...',
      publishNote: 'Note: Cette action affichera une notification immédiate à tous les clients utilisant une version différente.',
      setupExe: 'Setup (.exe)',
      extensionZip: 'Extension (.zip)',
      clickOrDrag: 'Cliquez ou glissez ici',
      totalFeedback: 'Avis Total',
      avgRating: 'Note Moyenne',
      noFeedback: 'Aucun avis pour le moment.',
      logout: 'Se déconnecter',
      bulkNote: 'Les clés générées en masse sont liées à un ID générique et se lieront à l\'utilisateur lors de l\'activation.',
      confirmReset: 'Voulez-vous vraiment réinitialiser la licence de CE PC ?',
      confirmDelete: '⚠️ ATTENTION : Voulez-vous supprimer TOTALEMENT cette machine de votre base de données ?',
    },
    converter: {
      title: 'Convertisseur MP3',
      subtitle: 'Extraction audio haute qualité (Offline)',
      selectVideo: 'Sélectionner une vidéo',
      videoSelected: 'Vidéo sélectionnée',
      chooseVideo: 'Choisir une vidéo',
      startBtn: 'Lancer la conversion',
      converting: 'Conversion en cours...',
      convertingSub: 'Extraction de la piste audio libmp3lame 192kbps',
      success: 'Conversion terminée !',
      successSub: 'Votre fichier MP3 est prêt au même endroit.',
      anotherBtn: 'Convertir une autre vidéo',
      error: 'Erreur',
      retryBtn: 'Réessayer',
      failed: 'La conversion a échoué.',
    },
    compressor: {
      title: 'Compresseur Vidéo',
      subtitle: 'Réduire le poids pour le partage',
      selectVideo: 'Sélectionner une vidéo',
      videoSelected: 'Vidéo sélectionnée',
      chooseVideo: 'Choisir une vidéo',
      qualityLabel: 'Qualité de compression',
      qLow: 'Basse',
      qLowDesc: 'Max Gain',
      qMed: 'Moyenne',
      qMedDesc: 'Équilibré',
      qWhatsapp: 'WhatsApp',
      qWhatsappDesc: 'Cible 720p',
      startBtn: 'Lancer la compression',
      compressing: 'Compression en cours...',
      compressingSub: 'Optimisation des flux H.264 & AAC',
      success: 'Prêt pour le partage ! ❤️',
      successSub: 'La vidéo a été optimisée avec succès.',
      saveLocation: 'Enregistré dans Conversions/Compressed',
      anotherBtn: 'Compresser une autre vidéo',
      error: 'Erreur',
      retryBtn: 'Réessayer',
      failed: 'La compression a échoué.',
    },
    batch: {
      title: 'Téléchargement Groupé',
      subtitle: 'Téléchargement groupé & Playlists',
      inputLabel: 'Lien de la Playlist ou Vidéo',
      inputPlaceholder: 'Collez ici le lien YouTube (Playlist, Chaîne, Vidéo...)',
      fetch: 'Charger',
      fetching: 'Analyse en cours...',
      fetchingSub: 'Récupération des informations...',
      fetchBtn: 'Analyser la liste',
      selectedCount: '{selected} sur {total} sélectionnés',
      selectAll: 'Tout sélectionner',
      deselectAll: 'Tout désélectionner',
      videoMode: 'VIDÉO',
      audioMode: 'AUDIO',
      startBtn: 'Lancer le téléchargement ({count})',
      successTitle: 'Tout est prêt !',
      successSub: 'Vos téléchargements ont été ajoutés.',
      addingTitle: 'Planification rapide...',
      addingSub: 'Préparation des files d\'attente individuelles.',
      errorFetch: 'Impossible de lire la playlist. Vérifiez le lien.',
      items: 'éléments',
    },
    about: {
      description: 'Gestionnaire de téléchargements avancé avec accélération multi-threading',
      developer: 'Développeur',
      role: 'Concepteur et Développeur',
      features: 'Fonctionnalités',
      copyright: 'Copyright © 2024-2025 Oumarou Abdoul Jabbar',
      licenseLabel: 'Licence',
      feature1: 'Téléchargements accélérés avec multi-threading',
      feature2: 'Support des plateformes de streaming (YouTube, TikTok, Facebook, Instagram)',
      feature3: 'Interception automatique des téléchargements (comme IDM)',
      feature4: 'Gestionnaire de files d\'attente intelligent',
      feature5: 'Reprise des téléchargements interrompus',
      feature6: 'Extension Chrome intégrée',
      feature7: 'Convertisseur MP3 intégré',
      feature8: 'Compresseur Vidéo intégré',
      feature9: 'Téléchargement groupé / Playlist',
      feature10: 'Mise à jour automatique',
      feature11: 'Système d\'avis et commentaires',
      feature12: 'Support multilingue (Français / Anglais)',
    },
    extensionUpdate: {
      title: 'Mise à jour Extension',
      available: 'Une nouvelle version de l\'extension (v{v}) est disponible.',
      installBtn: 'Installer maintenant',
      installing: 'Installation en cours...',
      ready: '✅ Mise à jour installée avec succès !',
      error: '❌ Échec de l\'installation. Réessayez.',
      success: 'L\'extension a été mise à jour.',
    },
    autoInstall: {
      title: 'Installation Navigateurs',
      description: 'DoulGet peut configurer automatiquement l\'extension dans vos navigateurs.',
      button: 'INSTALLER L\'EXTENSION',
      installing: 'Configuration du registre...',
      success: '✅ Extension enregistrée !',
      error: '❌ Échec de l\'enregistrement.',
      chromeNote: 'Note: Redémarrez Chrome pour voir le message d\'activation.',
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
      about: 'About',
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
      viewLogs: 'View Logs',
      restore: 'Restore',
      restoreSelected: 'Restore Selected',
    },
    addDownload: {
      title: 'Add New Download',
      downloadUrl: 'Download URL',
      cancel: 'Cancel',
      startDownload: 'Start Download',
      downloadVideo: 'Download Video',
      downloadAudio: 'Download Audio (MP3)',
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
    sidebarExtra: {
      converter: 'MP3 Converter',
      compressor: 'Video Compressor',
      batch: 'Batch Download',
      feedback: 'Give Feedback',
      updateAvailable: 'UPDATE AVAILABLE · Click to install',
      updateDownloading: 'Downloading update...',
      updateReady: '✅ Ready! Install & Restart',
      updateError: '⚠️ Download error. Try again.',
      navGroup: 'Navigation',
      toolsGroup: 'Tools & Services',
    },
    feedback: {
      title: 'Your feedback helps us!',
      subtitle: 'How do you find DoulGet?',
      commentLabel: 'Comment (optional)',
      commentPlaceholder: 'Share your experience, suggestions, or issues...',
      sendError: '⚠️ Error sending. Check your connection.',
      later: 'Later',
      send: 'Send',
      thankYou: 'Thank you for your feedback!',
      thankYouSub: 'Your feedback helps us improve DoulGet.',
      bad: 'Bad',
      okay: 'Okay',
      good: 'Good',
      veryGood: 'Very Good',
      excellent: 'Excellent!',
    },
    license: {
      title: 'Activation Required',
      subtitle: 'Please enter your license key to activate DoulGet.',
      placeholder: 'Enter your license key',
      activate: 'ACTIVATE',
      activating: 'Activating...',
      machineId: 'Machine ID',
      copy: 'Copy',
      copied: 'Copied!',
    },
    admin: {
      title: 'License Administration (SECRET)',
      accessRestricted: 'Restricted access. Please enter the Master Password.',
      password: 'Password',
      unlock: 'UNLOCK',
      wrongPassword: 'Incorrect password.',
      tabGeneration: 'Generation',
      tabCloud: 'Cloud Management',
      tabUpdates: 'Updates',
      tabFeedback: 'Reviews',
      duration: 'Validity Period',
      month1: '1 Month (Standard)',
      year1: '1 Year (Premium)',
      lifetime: 'Lifetime (Unlimited)',
      customDate: 'Custom Date...',
      singleKey: 'Single Key',
      hwidClient: 'Client HWID (optional)',
      generate: 'GENERATE',
      bulkGeneration: 'Bulk Generation',
      count: 'Count:',
      generateKeys: 'GENERATE {count} KEYS',
      maintenance: 'Local Maintenance',
      maintenanceDesc: 'Reset the activation of this computer',
      resetPc: 'RESET THIS PC',
      results: 'Results',
      copyClip: 'Copy',
      exportTxt: 'Export .txt',
      subscribers: 'Subscribers',
      online: 'Online',
      banned: 'Banned',
      refresh: 'REFRESH',
      searchPlaceholder: 'Search by HWID or original key...',
      hwid: 'HWID',
      originalKey: 'Original Key',
      activation: 'Activation',
      statusLabel: 'Status',
      actionLabel: 'Action',
      noUsers: 'No registered users.',
      activatedOn: 'Activated on',
      statusActive: 'ACTIVE',
      statusBan: 'BAN',
      statusTrial: 'TRIAL',
      publishVersion: 'Publish a new version',
      versionNumber: 'Version Number (e.g: 1.2.9)',
      directLink: 'Direct or Public URL',
      publishUpdate: 'PUBLISH UPDATE',
      uploading: 'UPLOADING...',
      publishNote: 'Note: This will show an immediate notification to all clients using a different version.',
      setupExe: 'Setup (.exe)',
      extensionZip: 'Extension (.zip)',
      clickOrDrag: 'Click or drag here',
      totalFeedback: 'Total Reviews',
      avgRating: 'Average Rating',
      noFeedback: 'No reviews yet.',
      logout: 'Log out',
      bulkNote: 'Bulk generated keys are linked to a generic ID and will bind to the user upon activation.',
      confirmReset: 'Do you really want to reset the license of THIS PC?',
      confirmDelete: '⚠️ WARNING: Do you want to COMPLETELY delete this machine from your database?',
    },
    converter: {
      title: 'MP3 Converter',
      subtitle: 'High quality audio extraction (Offline)',
      selectVideo: 'Select a video',
      videoSelected: 'Video selected',
      chooseVideo: 'Choose a video',
      startBtn: 'Start Conversion',
      converting: 'Converting...',
      convertingSub: 'Extracting audio track libmp3lame 192kbps',
      success: 'Conversion complete!',
      successSub: 'Your MP3 file is ready in the same folder.',
      anotherBtn: 'Convert another video',
      error: 'Error',
      retryBtn: 'Retry',
      failed: 'Conversion failed.',
    },
    compressor: {
      title: 'Video Compressor',
      subtitle: 'Reduce size for sharing',
      selectVideo: 'Select a video',
      videoSelected: 'Video selected',
      chooseVideo: 'Choose a video',
      qualityLabel: 'Compression quality',
      qLow: 'Low',
      qLowDesc: 'Max Gain',
      qMed: 'Medium',
      qMedDesc: 'Balanced',
      qWhatsapp: 'WhatsApp',
      qWhatsappDesc: 'Target 720p',
      startBtn: 'Start Compression',
      compressing: 'Compressing...',
      compressingSub: 'Optimizing H.264 & AAC streams',
      success: 'Ready for sharing! ❤️',
      successSub: 'The video has been successfully optimized.',
      saveLocation: 'Saved in Conversions/Compressed',
      anotherBtn: 'Compress another video',
      error: 'Error',
      retryBtn: 'Retry',
      failed: 'Compression failed.',
    },
    batch: {
      title: 'Batch Download',
      subtitle: 'Batch Download & Playlists',
      inputLabel: 'Playlist or Video Link',
      inputPlaceholder: 'Paste YouTube link here (Playlist, Channel, Video...)',
      fetch: 'Load',
      fetching: 'Fetching...',
      fetchingSub: 'Fetching information...',
      fetchBtn: 'Analyze list',
      selectedCount: '{selected} of {total} selected',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      videoMode: 'VIDEO',
      audioMode: 'AUDIO',
      startBtn: 'Start Download ({count})',
      successTitle: 'All ready!',
      successSub: 'Your downloads have been added.',
      addingTitle: 'Fast scheduling...',
      addingSub: 'Preparing individual queues.',
      errorFetch: 'Failed to fetch playlist. Check the link.',
      items: 'items',
    },
    about: {
      description: 'Advanced download manager with multi-threading acceleration',
      developer: 'Developer',
      role: 'Designer and Developer',
      features: 'Features',
      copyright: 'Copyright © 2024-2025 Oumarou Abdoul Jabbar',
      licenseLabel: 'License',
      feature1: 'Accelerated downloads with multi-threading',
      feature2: 'Streaming platform support (YouTube, TikTok, Facebook, Instagram)',
      feature3: 'Automatic download interception (like IDM)',
      feature4: 'Smart download queue manager',
      feature5: 'Resume interrupted downloads',
      feature6: 'Built-in Chrome Extension',
      feature7: 'Built-in MP3 Converter',
      feature8: 'Built-in Video Compressor',
      feature9: 'Batch Download / Playlist',
      feature10: 'Automatic updates',
      feature11: 'Feedback and review system',
      feature12: 'Multilingual support (French / English)',
    },
    extensionUpdate: {
      title: 'Extension Update',
      available: 'A new version of the extension (v{v}) is available.',
      installBtn: 'Install now',
      installing: 'Installing...',
      ready: '✅ Update installed successfully!',
      error: '❌ Installation failed. Try again.',
      success: 'Extension has been updated.',
    },
    autoInstall: {
      title: 'Browser Installation',
      description: 'DoulGet can automatically configure the extension in your browsers.',
      button: 'INSTALL EXTENSION',
      installing: 'Setting up registry...',
      success: '✅ Extension registered!',
      error: '❌ Registration failed.',
      chromeNote: 'Note: Restart Chrome to see the activation message.',
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

