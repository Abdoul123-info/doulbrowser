// Script pour le popup de l'extension
const DOULBROWSER_PORT = 8765;
const DOULBROWSER_HOST = 'localhost';

const statusDiv = document.getElementById('status');
const openAppButton = document.getElementById('openApp');
const testDownloadButton = document.getElementById('testDownload');
const detectCurrentPageButton = document.getElementById('detectCurrentPage');

// Vérifier la connexion au démarrage
checkConnection();

// Vérifier périodiquement
setInterval(checkConnection, 5000);

function checkConnection() {
  fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/ping`, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-cache'
  })
    .then(response => {
      if (response.ok) {
        return response.json();
      } else {
        throw new Error('Not connected');
      }
    })
    .then(data => {
      statusDiv.textContent = '✓ Connecté à DoulBrowser';
      statusDiv.className = 'status connected';
      openAppButton.style.display = 'none';
      testDownloadButton.style.display = 'block';
      detectCurrentPageButton.style.display = 'block';
      chrome.storage.local.set({ doulbrowserConnected: true });
    })
    .catch(error => {
      statusDiv.textContent = '✗ DoulBrowser n\'est pas en cours d\'exécution';
      statusDiv.className = 'status disconnected';
      openAppButton.style.display = 'block';
      testDownloadButton.style.display = 'none';
      detectCurrentPageButton.style.display = 'none';
      chrome.storage.local.set({ doulbrowserConnected: false });
      console.log('DoulBrowser: Erreur de connexion', error);
    });
}

openAppButton.addEventListener('click', () => {
  // Essayer d'ouvrir l'application (nécessite un protocole personnalisé)
  window.open('doulbrowser://open', '_blank');
});

testDownloadButton.addEventListener('click', () => {
  // Tester avec une URL de test
  const testUrl = 'https://www.sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
  fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-detected`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'download-detected',
      url: testUrl,
      filename: 'test-video.mp4',
      timestamp: Date.now()
    })
  }).then(() => {
    statusDiv.textContent = '✓ Test envoyé avec succès !';
    setTimeout(checkConnection, 2000);
  }).catch(() => {
    statusDiv.textContent = '✗ Erreur lors de l\'envoi du test';
  });
});

detectCurrentPageButton.addEventListener('click', () => {
  // Obtenir l'onglet actuel et déclencher la détection
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const currentUrl = tabs[0].url;
      
      // Si c'est YouTube, extraire l'URL de la vidéo
      if (currentUrl.includes('youtube.com/watch') || currentUrl.includes('youtu.be/')) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'detectVideo' }, (response) => {
          if (response && response.success) {
            statusDiv.textContent = '✓ Vidéo détectée et envoyée !';
            setTimeout(checkConnection, 2000);
          } else {
            statusDiv.textContent = '⚠️ Aucune vidéo détectée sur cette page';
            setTimeout(checkConnection, 2000);
          }
        });
      } else {
        statusDiv.textContent = '⚠️ Cette page ne contient pas de vidéo YouTube';
        setTimeout(checkConnection, 2000);
      }
    }
  });
});

