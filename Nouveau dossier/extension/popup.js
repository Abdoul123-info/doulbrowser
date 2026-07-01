// Script pour le popup de l'extension
const DOULGET_PORT = 8765;
const DOULGET_HOST = 'localhost';

const statusDiv = document.getElementById('status');
const openAppButton = document.getElementById('openApp');
const testDownloadButton = document.getElementById('testDownload');
const detectCurrentPageButton = document.getElementById('detectCurrentPage');
const updateAlert = document.getElementById('updateAlert');
const updateVersionSpan = document.getElementById('updateVersion');

// Vérifier la connexion au démarrage
checkConnection();

// Vérifier périodiquement
setInterval(checkConnection, 5000);

function checkConnection() {
  fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/ping`, {
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
      statusDiv.textContent = chrome.i18n.getMessage('statusConnected');
      statusDiv.className = 'status connected';
      openAppButton.style.display = 'none';
      testDownloadButton.style.display = 'block';
      detectCurrentPageButton.style.display = 'block';
      chrome.storage.local.set({ doulbrowserConnected: true });
    })
    .catch(error => {
      statusDiv.textContent = chrome.i18n.getMessage('statusDisconnected');
      statusDiv.className = 'status disconnected';
      openAppButton.style.display = 'block';
      testDownloadButton.style.display = 'none';
      detectCurrentPageButton.style.display = 'none';
      chrome.storage.local.set({ doulbrowserConnected: false });
      console.log('DoulGet: Erreur de connexion', error);
    });

  // Check update status
  chrome.storage.local.get(['updateAvailable', 'latestVersion', 'updateUrl'], (res) => {
    if (res.updateAvailable) {
      updateAlert.style.display = 'block';
      updateVersionSpan.textContent = `Extension v${res.latestVersion}`;
      
      // [v2.2.1] Default to zip download instead of GitHub if available
      updateAlert.dataset.url = res.updateUrl || 'https://github.com/Abdoul123-info/doulbrowser/releases/latest';
    } else {
      updateAlert.style.display = 'none';
    }
  });
}

updateAlert.addEventListener('click', (e) => {
    e.preventDefault();
    const url = updateAlert.dataset.url;
    if (url) {
        window.open(url, '_blank');
    }
});

openAppButton.addEventListener('click', () => {
  // Essayer d'ouvrir l'application (nécessite un protocole personnalisé)
  window.open('doulget://open', '_blank');
});

testDownloadButton.addEventListener('click', () => {
  // Tester avec une URL de test
  const testUrl = 'https://www.sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
  fetch(`http://${DOULGET_HOST}:${DOULGET_PORT}/download-detected`, {
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
    statusDiv.textContent = chrome.i18n.getMessage('testSuccess');
    setTimeout(checkConnection, 2000);
  }).catch(() => {
    statusDiv.textContent = chrome.i18n.getMessage('testError');
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
            statusDiv.textContent = chrome.i18n.getMessage('videoDetected');
            setTimeout(checkConnection, 2000);
          } else {
            statusDiv.textContent = chrome.i18n.getMessage('noVideoDetected');
            setTimeout(checkConnection, 2000);
          }
        });
      } else {
        statusDiv.textContent = chrome.i18n.getMessage('notYouTube');
        setTimeout(checkConnection, 2000);
      }
    }
  });
});

