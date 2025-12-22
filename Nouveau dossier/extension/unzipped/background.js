// Service Worker pour l'extension DoulBrowser
const DOULBROWSER_PORT = 8765; // Port par défaut pour communiquer avec l'app
const DOULBROWSER_HOST = 'localhost';

// DÉSACTIVÉ : Détection automatique désactivée pour éviter les téléchargements multiples
// Les téléchargements ne seront détectés que via :
// 1. Clic sur le bouton DoulBrowser dans le content script
// 2. Clic sur un lien de téléchargement dans le content script

// Les listeners suivants sont commentés pour éviter les détections automatiques :
/*
chrome.webRequest.onBeforeRequest.addListener(...)
chrome.webRequest.onHeadersReceived.addListener(...)
chrome.downloads.onCreated.addListener(...)
*/

// Fonction pour envoyer les données à l'application DoulBrowser
function sendToDoulBrowser(data) {
  // Vérifier si l'application est en cours d'exécution
  fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-detected`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  }).then(response => {
    if (!response.ok) {
      console.log('DoulBrowser: Erreur de réponse', response.status);
    }
  }).catch(error => {
    // L'application n'est pas en cours d'exécution ou le port est différent
    // Ne pas afficher d'erreur si c'est juste que l'app n'est pas démarrée
    if (error.name !== 'TypeError' && error.message && !error.message.includes('Failed to fetch')) {
      console.log('DoulBrowser: Erreur de communication', error.message);
    }
  });
}

// Vérifier la connexion à l'application au démarrage
chrome.runtime.onStartup.addListener(() => {
  checkDoulBrowserConnection();
});

chrome.runtime.onInstalled.addListener(() => {
  checkDoulBrowserConnection();
});

function checkDoulBrowserConnection() {
  fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/ping`)
    .then(() => {
      chrome.storage.local.set({ doulbrowserConnected: true });
    })
    .catch(() => {
      chrome.storage.local.set({ doulbrowserConnected: false });
    });
}

// Le content script s'injecte automatiquement via manifest.json, pas besoin d'injection dynamique

// Écouter les messages depuis le popup et content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkConnection') {
    fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/ping`)
      .then(() => {
        sendResponse({ connected: true });
      })
      .catch(() => {
        sendResponse({ connected: false });
      });
    return true; // Indique qu'on répondra de manière asynchrone
  }
  
  if (request.action === 'sendDownload') {
    sendToDoulBrowser({
      type: 'download-detected',
      url: request.url,
      filename: request.filename || 'download',
      mimeType: request.type === 'youtube' ? 'video/youtube' : '',
      timestamp: Date.now()
    });
    sendResponse({ success: true });
  }
  
  if (request.action === 'pauseDownload') {
    fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-pause`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: request.url })
    }).then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true;
  }
  
  if (request.action === 'resumeDownload') {
    fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: request.url })
    }).then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true;
  }
  
  if (request.action === 'cancelDownload') {
    fetch(`http://${DOULBROWSER_HOST}:${DOULBROWSER_PORT}/download-cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: request.url })
    }).then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true;
  }
  
});

