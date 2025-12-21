// Script injecté pour ajouter un bouton de téléchargement directement sur la vidéo (style IDM)
(function() {
  'use strict';
  
  // Éviter les doublons
  if (window.doulbrowserInjectLoaded) {
    return;
  }
  window.doulbrowserInjectLoaded = true;
  
  const DOULBROWSER_PORT = 8765;
  const DOULBROWSER_HOST = 'localhost';
  
  // Créer le bouton de téléchargement en bas de la vidéo
  function createDownloadButton(videoUrl, videoTitle, videoId) {
    // Supprimer l'ancien bouton s'il existe
    const existingButton = document.getElementById('doulbrowser-download-container');
    if (existingButton) {
      existingButton.remove();
    }
    
    console.log('DoulBrowser: Création du bouton pour', videoTitle);
    
    // Ne pas chercher le player container, on va insérer directement dans les métadonnées
    // Cela fonctionne mieux car YouTube charge les métadonnées après le player
    
    // Créer le conteneur du bouton et de la progression
    const container = document.createElement('div');
    container.id = 'doulbrowser-download-container';
    container.innerHTML = `
      <div id="doulbrowser-download-btn" style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 10px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s;
        margin-top: 8px;
      " onmouseover="this.style.opacity='0.9'; this.style.transform='translateY(-1px)'" 
         onmouseout="this.style.opacity='1'; this.style.transform='translateY(0)'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span id="doulbrowser-btn-text">Télécharger avec DoulBrowser</span>
      </div>
      <div id="doulbrowser-progress-container" style="
        display: none;
        margin-top: 8px;
        background: #f3f4f6;
        border-radius: 6px;
        padding: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span id="doulbrowser-progress-text" style="font-size: 12px; color: #374151; font-weight: 500;">Téléchargement en cours...</span>
          <span id="doulbrowser-progress-percent" style="font-size: 12px; color: #667eea; font-weight: 600;">0%</span>
        </div>
        <div style="
          width: 100%;
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          overflow: hidden;
        ">
          <div id="doulbrowser-progress-bar" style="
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            transition: width 0.3s ease;
            border-radius: 3px;
          "></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; color: #6b7280;">
          <span id="doulbrowser-progress-speed">Vitesse: --</span>
          <span id="doulbrowser-progress-time">Temps restant: --</span>
        </div>
        <div style="margin-top: 8px; display: flex; gap: 8px;">
          <button id="doulbrowser-pause-btn" style="
            flex: 1;
            padding: 6px 12px;
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            color: #374151;
          ">Pause</button>
          <button id="doulbrowser-cancel-btn" style="
            flex: 1;
            padding: 6px 12px;
            background: #fee2e2;
            border: 1px solid #fecaca;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            color: #991b1b;
          ">Annuler</button>
        </div>
      </div>
    `;
    
    // Essayer plusieurs emplacements pour insérer le bouton
    // 1. Essayer d'insérer dans le conteneur des métadonnées YouTube (sous la vidéo)
    const metadataContainer = document.querySelector('#info, ytd-watch-metadata, #watch-header, #primary-inner');
    if (metadataContainer) {
      // Insérer au début du conteneur des métadonnées
      const firstChild = metadataContainer.firstElementChild;
      if (firstChild) {
        metadataContainer.insertBefore(container, firstChild);
      } else {
        metadataContainer.appendChild(container);
      }
    } else {
      // 2. Essayer d'insérer dans le conteneur principal
      const primary = document.querySelector('#primary, #content, #primary-inner');
      if (primary) {
        primary.appendChild(container);
      } else {
        // 3. Dernier recours : insérer dans le body
        document.body.appendChild(container);
      }
    }
    
    // Forcer l'affichage avec un style inline pour s'assurer qu'il est visible
    container.style.display = 'block';
    container.style.width = '100%';
    container.style.maxWidth = '100%';
    
    const button = container.querySelector('#doulbrowser-download-btn');
    const progressContainer = container.querySelector('#doulbrowser-progress-container');
    const progressBar = container.querySelector('#doulbrowser-progress-bar');
    const progressPercent = container.querySelector('#doulbrowser-progress-percent');
    const progressText = container.querySelector('#doulbrowser-progress-text');
    const progressSpeed = container.querySelector('#doulbrowser-progress-speed');
    const progressTime = container.querySelector('#doulbrowser-progress-time');
    const pauseBtn = container.querySelector('#doulbrowser-pause-btn');
    const cancelBtn = container.querySelector('#doulbrowser-cancel-btn');
    
    let downloadState = 'idle'; // idle, downloading, paused, completed, cancelled
    let progressInterval = null;
    
    // Fonction pour démarrer le téléchargement
    function startDownload() {
      // Envoyer un message au content script
      window.postMessage({
        type: 'DOULBROWSER_DOWNLOAD',
        url: videoUrl,
        title: videoTitle,
        videoId: videoId
      }, '*');
      
      // Afficher la progression
      button.style.display = 'none';
      progressContainer.style.display = 'block';
      downloadState = 'downloading';
      
      // Démarrer le suivi de progression
      startProgressTracking(videoUrl);
    }
    
    // Fonction pour suivre la progression
    function startProgressTracking(url) {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      
      progressInterval = setInterval(() => {
        fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-status?url=${encodeURIComponent(url)}`)
          .then(response => response.json())
          .then(data => {
            if (data.status === 'downloading') {
              const percent = data.progress || 0;
              const speed = data.speed || '0 B/s';
              const timeLeft = data.timeLeft || '--';
              const received = data.receivedBytes || 0;
              const total = data.totalBytes || 0;
              
              progressBar.style.width = percent + '%';
              progressPercent.textContent = percent.toFixed(1) + '%';
              progressSpeed.textContent = `Vitesse: ${speed}`;
              progressTime.textContent = `Temps restant: ${timeLeft}`;
              
              if (percent >= 100) {
                downloadState = 'completed';
                progressText.textContent = '✓ Téléchargement terminé !';
                progressBar.style.background = '#10b981';
                pauseBtn.style.display = 'none';
                cancelBtn.textContent = 'Fermer';
                clearInterval(progressInterval);
              }
            } else if (data.status === 'paused') {
              downloadState = 'paused';
              progressText.textContent = '⏸ Téléchargement en pause';
              pauseBtn.textContent = 'Reprendre';
            } else if (data.status === 'completed') {
              downloadState = 'completed';
              progressText.textContent = '✓ Téléchargement terminé !';
              progressBar.style.width = '100%';
              progressBar.style.background = '#10b981';
              pauseBtn.style.display = 'none';
              cancelBtn.textContent = 'Fermer';
              clearInterval(progressInterval);
            } else if (data.status === 'cancelled' || data.status === 'error') {
              downloadState = 'cancelled';
              progressText.textContent = '✗ Téléchargement annulé';
              progressBar.style.background = '#ef4444';
              clearInterval(progressInterval);
            }
          })
          .catch(err => {
            // Si l'app n'est pas disponible, arrêter le suivi
            if (err.message && err.message.includes('Failed to fetch')) {
              clearInterval(progressInterval);
              progressText.textContent = '✗ DoulBrowser n\'est pas disponible';
            }
          });
      }, 500); // Vérifier toutes les 500ms
    }
    
    // Événement de clic sur le bouton
    button.addEventListener('click', startDownload);
    
    // Événement pause/reprendre
    pauseBtn.addEventListener('click', () => {
      if (downloadState === 'downloading') {
        window.postMessage({
          type: 'DOULBROWSER_PAUSE',
          url: videoUrl
        }, '*');
      } else if (downloadState === 'paused') {
        window.postMessage({
          type: 'DOULBROWSER_RESUME',
          url: videoUrl
        }, '*');
      }
    });
    
    // Événement annuler
    cancelBtn.addEventListener('click', () => {
      if (downloadState === 'completed') {
        progressContainer.style.display = 'none';
        button.style.display = 'flex';
        downloadState = 'idle';
      } else {
        window.postMessage({
          type: 'DOULBROWSER_CANCEL',
          url: videoUrl
        }, '*');
        progressContainer.style.display = 'none';
        button.style.display = 'flex';
        downloadState = 'idle';
        clearInterval(progressInterval);
      }
    });
  }
  
  // Détecter les vidéos YouTube
  function detectAndShowButton() {
    // Méthode 1: Utiliser ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse) {
      try {
        const videoDetails = window.ytInitialPlayerResponse.videoDetails;
        if (videoDetails && videoDetails.videoId) {
          const videoUrl = `https://www.youtube.com/watch?v=${videoDetails.videoId}`;
          const videoTitle = videoDetails.title || 'YouTube Video';
          createDownloadButton(videoUrl, videoTitle, videoDetails.videoId);
          return;
        }
      } catch (e) {
        console.log('DoulBrowser: Error reading ytInitialPlayerResponse', e);
      }
    }
    
    // Méthode 2: Utiliser l'URL de la page
    if (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be')) {
      const urlParams = new URLSearchParams(window.location.search);
      const videoId = urlParams.get('v') || window.location.pathname.split('/').pop();
      
      if (videoId && videoId.length === 11) {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Obtenir le titre depuis le DOM
        let videoTitle = 'YouTube Video';
        const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title, ytd-watch-metadata h1');
        if (titleElement) {
          videoTitle = titleElement.textContent || titleElement.innerText || 'YouTube Video';
        }
        
        createDownloadButton(videoUrl, videoTitle);
      }
    }
    
    // Méthode 3: Détecter les balises vidéo HTML5
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (video.src && !video.dataset.doulbrowserDetected) {
        video.dataset.doulbrowserDetected = 'true';
        createDownloadButton(video.src, 'Video');
      }
    });
  }
  
  // Fonction pour détecter et afficher avec plusieurs tentatives
  function detectWithRetry() {
    let attempts = 0;
    const maxAttempts = 10;
    
    const tryDetect = () => {
      attempts++;
      detectAndShowButton();
      
      // Vérifier si le bouton a été créé
      if (!document.getElementById('doulbrowser-download-container') && attempts < maxAttempts) {
        setTimeout(tryDetect, 500);
      }
    };
    
    tryDetect();
  }
  
  // Détecter au chargement
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(detectWithRetry, 1000);
    });
  } else {
    setTimeout(detectWithRetry, 1000);
  }
  
  // Détecter lors des changements d'URL (YouTube SPA)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      // Supprimer l'ancien bouton
      const oldContainer = document.getElementById('doulbrowser-download-container');
      if (oldContainer) {
        oldContainer.remove();
      }
      setTimeout(detectWithRetry, 1500);
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });
  
  // Écouter les événements YouTube
  window.addEventListener('yt-navigate-finish', () => {
    const oldContainer = document.getElementById('doulbrowser-download-container');
    if (oldContainer) {
      oldContainer.remove();
    }
    setTimeout(detectWithRetry, 1500);
  });
  
  // Observer les changements du DOM pour détecter quand le player est chargé
  const observer = new MutationObserver(() => {
    // Vérifier si le player existe mais que notre bouton n'existe pas
    const playerExists = document.querySelector('#movie_player, ytd-player');
    const buttonExists = document.getElementById('doulbrowser-download-container');
    
    if (playerExists && !buttonExists) {
      detectAndShowButton();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Détecter aussi quand YouTube charge les données de la vidéo
  if (window.ytInitialData) {
    setTimeout(detectWithRetry, 2000);
  }
})();

