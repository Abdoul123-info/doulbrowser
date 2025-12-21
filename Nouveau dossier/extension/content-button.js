// Fonction pour créer le bouton de téléchargement (à intégrer dans content.js)
function createDoulBrowserButton(videoUrl, videoTitle, videoId) {
  // Supprimer l'ancien bouton s'il existe
  const existingButton = document.getElementById('doulbrowser-download-container');
  if (existingButton) {
    existingButton.remove();
  }
  
  console.log('DoulBrowser: Création du bouton pour', videoTitle);
  
  const DOULBROWSER_PORT = 8765;
  const DOULBROWSER_HOST = 'localhost';
  
  // Créer le conteneur
  const container = document.createElement('div');
  container.id = 'doulbrowser-download-container';
  container.style.cssText = 'display: block; width: 100%; max-width: 100%; margin-top: 12px;';
  
  // Créer les éléments avec createElement au lieu d'innerHTML pour éviter Trusted Types
  const button = document.createElement('div');
  button.id = 'doulbrowser-download-btn';
  button.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; transition: all 0.2s; margin-top: 8px;';
  
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '7 10 12 15 17 10');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', '12');
  line.setAttribute('y1', '15');
  line.setAttribute('x2', '12');
  line.setAttribute('y2', '3');
  
  svg.appendChild(path1);
  svg.appendChild(polyline);
  svg.appendChild(line);
  
  const span = document.createElement('span');
  span.id = 'doulbrowser-btn-text';
  span.textContent = 'Télécharger avec DoulBrowser';
  
  button.appendChild(svg);
  button.appendChild(span);
  
  // Conteneur de progression
  const progressContainer = document.createElement('div');
  progressContainer.id = 'doulbrowser-progress-container';
  progressContainer.style.cssText = 'display: none; margin-top: 8px; background: #f3f4f6; border-radius: 6px; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
  
  // ... (créer les autres éléments de progression de la même manière)
  
  container.appendChild(button);
  container.appendChild(progressContainer);
  
  // Insérer dans la page
  const metadataContainer = document.querySelector('#info, ytd-watch-metadata, #watch-header, #primary-inner, ytd-watch-flexy');
  if (metadataContainer) {
    const firstChild = metadataContainer.firstElementChild;
    if (firstChild) {
      metadataContainer.insertBefore(container, firstChild);
    } else {
      metadataContainer.appendChild(container);
    }
  } else {
    const primary = document.querySelector('#primary, #content, #primary-inner');
    if (primary) {
      primary.appendChild(container);
    } else {
      document.body.appendChild(container);
    }
  }
  
  // Ajouter l'événement de clic
  button.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'sendDownload',
      url: videoUrl,
      filename: `${videoTitle}.mp4`,
      type: 'youtube'
    });
  });
}







