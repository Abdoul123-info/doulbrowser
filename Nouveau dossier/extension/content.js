// Content Script pour détecter les liens de téléchargement et vidéos YouTube
(function () {
  'use strict';

  // ============================================
  // GM_ API BRIDGE FOR MAIN WORLD COMPATIBILITY
  // Fixes ReferenceError: GM_cookie in YouTube scripts
  // ============================================

  // 1. Script to be injected into the Main World (Page Context)
  const mainWorldScript = `
    (function() {
      const BRIDGE_ID = 'DOULBROWSER_GM_BRIDGE';
      
      window.GM_cookie = {
        list: (details, callback) => {
          const id = Math.random().toString(36).slice(2);
          window.postMessage({ type: BRIDGE_ID, action: 'GM_cookie_list', details, id }, '*');
          window.addEventListener('message', function handler(e) {
            if (e.data.type === BRIDGE_ID && e.data.responseId === id) {
              window.removeEventListener('message', handler);
              if (callback) callback(e.data.cookies, e.data.error);
            }
          });
        },
        set: (details, callback) => {
          const id = Math.random().toString(36).slice(2);
          window.postMessage({ type: BRIDGE_ID, action: 'GM_cookie_set', details, id }, '*');
          window.addEventListener('message', function handler(e) {
            if (e.data.type === BRIDGE_ID && e.data.responseId === id) {
              window.removeEventListener('message', handler);
              if (callback) callback(e.data.error);
            }
          });
        },
        delete: (details, callback) => {
          const id = Math.random().toString(36).slice(2);
          window.postMessage({ type: BRIDGE_ID, action: 'GM_cookie_delete', details, id }, '*');
          window.addEventListener('message', function handler(e) {
            if (e.data.type === BRIDGE_ID && e.data.responseId === id) {
              window.removeEventListener('message', handler);
              if (callback) callback(e.data.error);
            }
          });
        }
      };

      window.GM_info = { script: { name: "DoulBrowser Assistant", version: "1.1.0" } };
      
      window.GM_getValue = (name, defaultValue) => {
        try {
          const val = localStorage.getItem('GM_' + name);
          return val !== null ? JSON.parse(val) : defaultValue;
        } catch(e) { return defaultValue; }
      };
      
      window.GM_setValue = (name, value) => {
        try { localStorage.setItem('GM_' + name, JSON.stringify(value)); } catch(e) {}
      };
      
      console.log('✅ DoulBrowser GM_ Bridge Injected');
    })();
  `;

  // 2. Inject the script into the Main World
  const script = document.createElement('script');
  script.textContent = mainWorldScript;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // 3. Listen for requests from the Main World and forward to Background
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'DOULBROWSER_GM_BRIDGE' || event.data.responseId) {
      return;
    }

    const { action, details, id } = event.data;
    chrome.runtime.sendMessage({ action, details }, (response) => {
      window.postMessage({
        type: 'DOULBROWSER_GM_BRIDGE',
        responseId: id,
        cookies: response?.cookies,
        error: response?.error,
        details: response?.details
      }, '*');
    });
  });

  // Éviter les conflits avec d'autres extensions
  if (window.doulbrowserContentScriptLoaded) {
    return;
  }
  window.doulbrowserContentScriptLoaded = true;

  const DOULBROWSER_PORT = 8765;
  const DOULBROWSER_HOST = 'localhost';

  // ============================================
  // SYSTÈME DE DÉTECTION AVANCÉ (STYLE IDM)
  // ============================================

  // Cache pour éviter les détections multiples
  const detectedUrls = new Set();
  const detectedMediaElements = new WeakSet();

  // Patterns pour détecter les fichiers téléchargeables (définis en premier)
  const downloadPatterns = [
    // Vidéos
    /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v|3gp|mpg|mpeg)(\?|$)/i,
    // Audio
    /\.(mp3|wav|flac|aac|ogg|m4a|wma|opus|amr|mka)(\?|$)/i,
    // Documents
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv)(\?|$)/i,
    // Archives
    /\.(zip|rar|7z|tar|gz|bz2|cab|iso)(\?|$)/i,
    // Exécutables
    /\.(exe|msi|dmg|deb|rpm|bin|apk|ipa)(\?|$)/i,
    // Autres fichiers
    /\.(torrent|epub|mobi|azw)(\?|$)/i
  ];

  // Fonction pour détecter si une URL est un fichier téléchargeable
  function isDownloadableFile(url) {
    if (!url) return false;
    return downloadPatterns.some(pattern => pattern.test(url)) ||
      url.includes('/download') ||
      url.includes('/attachment');
  }

  // Fonction pour obtenir le type de fichier
  function getFileType(url) {
    if (/\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v|3gp|mpg|mpeg)(\?|$)/i.test(url)) return 'video';
    if (/\.(mp3|wav|flac|aac|ogg|m4a|wma|opus|amr|mka)(\?|$)/i.test(url)) return 'audio';
    if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv)(\?|$)/i.test(url)) return 'document';
    if (/\.(zip|rar|7z|tar|gz|bz2|cab|iso)(\?|$)/i.test(url)) return 'archive';
    return 'file';
  }

  // Intercepter les requêtes fetch pour détecter les fichiers téléchargeables
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    // Détecter les fichiers téléchargeables dans les requêtes
    if (url && isDownloadableFile(url) && !detectedUrls.has(url)) {
      detectedUrls.add(url);
      setTimeout(() => {
        handleDetectedFile(url, getFileNameFromUrl(url), getFileType(url));
      }, 100);
    }

    return originalFetch.apply(this, args);
  };

  // Intercepter les requêtes XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (url && isDownloadableFile(url) && !detectedUrls.has(url)) {
      detectedUrls.add(url);
      setTimeout(() => {
        handleDetectedFile(url, getFileNameFromUrl(url), getFileType(url));
      }, 100);
    }
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  // Fonction pour obtenir le nom de fichier depuis l'URL
  function getFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split('/').pop() || 'download';
      return decodeURIComponent(fileName);
    } catch (e) {
      const parts = url.split('/');
      return parts[parts.length - 1].split('?')[0] || 'download';
    }
  }

  // Fonction pour gérer les fichiers détectés
  function handleDetectedFile(url, fileName, fileType) {
    // Ne pas créer de bouton si c'est une requête interne
    if (url.includes('localhost') || url.includes('127.0.0.1')) return;

    // Créer un bouton de téléchargement
    const videoElement = document.querySelector('video');
    const audioElement = document.querySelector('audio');
    const insertElement = videoElement?.parentElement ||
      audioElement?.parentElement ||
      document.querySelector('main') ||
      document.body;

    createFileDownloadButton(url, fileName, fileType, insertElement);
  }

  // Détecter les balises <video> et <audio> directement dans le DOM
  function detectMediaElements() {
    // Détecter les vidéos
    document.querySelectorAll('video:not([data-doulbrowser-detected])').forEach(video => {
      if (detectedMediaElements.has(video)) return;
      detectedMediaElements.add(video);

      const sources = [];

      // Détecter la source principale
      if (video.src) {
        sources.push(video.src);
      }

      // Détecter les sources dans <source> tags
      video.querySelectorAll('source').forEach(source => {
        if (source.src) {
          sources.push(source.src);
        }
      });

      // Détecter srcObject (MediaStream)
      if (video.srcObject) {
        // Ne pas traiter les MediaStream
        return;
      }

      // Créer un bouton pour chaque source valide
      sources.forEach(src => {
        if (src && !src.startsWith('blob:') && !detectedUrls.has(src)) {
          detectedUrls.add(src);
          const title = video.getAttribute('title') ||
            video.getAttribute('aria-label') ||
            document.title ||
            'Video';

          const insertElement = video.parentElement ||
            document.querySelector('main') ||
            document.body;

          createDownloadButton(src, title, src, insertElement, 'after');
        }
      });

      video.setAttribute('data-doulbrowser-detected', 'true');
    });

    // Détecter les audios
    document.querySelectorAll('audio:not([data-doulbrowser-detected])').forEach(audio => {
      if (detectedMediaElements.has(audio)) return;
      detectedMediaElements.add(audio);

      const sources = [];

      if (audio.src) {
        sources.push(audio.src);
      }

      audio.querySelectorAll('source').forEach(source => {
        if (source.src) {
          sources.push(source.src);
        }
      });

      sources.forEach(src => {
        if (src && !src.startsWith('blob:') && !detectedUrls.has(src)) {
          detectedUrls.add(src);
          const title = audio.getAttribute('title') ||
            audio.getAttribute('aria-label') ||
            document.title ||
            'Audio';

          const insertElement = audio.parentElement ||
            document.querySelector('main') ||
            document.body;

          createFileDownloadButton(src, title, 'audio', insertElement);
        }
      });

      audio.setAttribute('data-doulbrowser-detected', 'true');
    });
  }

  // Injecter un style global pour forcer la visibilité du bouton
  const style = document.createElement('style');
  style.id = 'doulbrowser-styles';
  style.textContent = `
    #doulbrowser-download-container {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      position: relative !important;
      z-index: 999999 !important;
      margin: 16px 0 !important;
      padding: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    #doulbrowser-download-btn {
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      color: white !important;
      padding: 12px 20px !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      margin: 0 !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      width: auto !important;
      max-width: 400px !important;
    }
    #doulbrowser-download-btn:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
    }
  `;
  document.head.appendChild(style);

  // Variable pour éviter les créations multiples
  let buttonCreationInProgress = false;
  let currentVideoId = null;

  // Fonction pour créer le bouton de téléchargement (sans innerHTML pour éviter Trusted Types)
  function createDownloadButton(videoUrl, videoTitle, videoId, insertElement = null, insertMethod = 'append') {
    // Éviter les créations multiples pour la même vidéo
    if (buttonCreationInProgress || currentVideoId === videoId) {
      const existingButton = document.getElementById('doulbrowser-download-container');
      if (existingButton) {
        return; // Le bouton existe déjà, ne pas recréer
      }
    }

    // Vérifier si le bouton existe déjà
    const existingButton = document.getElementById('doulbrowser-download-container');
    if (existingButton && currentVideoId === videoId) {
      return; // Le bouton existe déjà pour cette vidéo
    }

    // Supprimer l'ancien bouton si on change de vidéo
    if (existingButton && currentVideoId !== videoId) {
      existingButton.remove();
    }

    buttonCreationInProgress = true;
    currentVideoId = videoId;

    console.log('DoulBrowser: Création du bouton pour', videoTitle);

    const container = document.createElement('div');
    container.id = 'doulbrowser-download-container';
    container.setAttribute('data-video-id', videoId);
    container.style.cssText = 'display: block !important; width: 100% !important; max-width: 100% !important; margin: 16px 0 !important; padding: 0 !important; position: relative !important; z-index: 999999 !important; visibility: visible !important; opacity: 1 !important;';

    const button = document.createElement('div');
    button.id = 'doulbrowser-download-btn';
    button.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; color: white !important; padding: 12px 20px !important; border-radius: 8px !important; cursor: pointer !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; font-size: 14px !important; font-weight: 600 !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 8px !important; transition: all 0.2s !important; margin: 0 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important; width: auto !important; max-width: 400px !important; visibility: visible !important; opacity: 1 !important;';

    const span = document.createElement('span');
    span.textContent = '⬇ Télécharger avec DoulBrowser';
    span.style.cssText = 'color: white !important;';
    button.appendChild(span);
    container.appendChild(button);

    // Insérer dans la page - essayer plusieurs emplacements pour être sûr qu'il soit visible
    let inserted = false;

    // Si un élément d'insertion est fourni, l'utiliser en premier
    if (insertElement && insertElement.isConnected) {
      try {
        if (insertMethod === 'after' && insertElement.nextSibling) {
          insertElement.parentNode.insertBefore(container, insertElement.nextSibling);
          inserted = true;
          console.log('DoulBrowser: Bouton inséré après l\'élément spécifié');
        } else if (insertMethod === 'before' && insertElement.parentNode) {
          insertElement.parentNode.insertBefore(container, insertElement);
          inserted = true;
          console.log('DoulBrowser: Bouton inséré avant l\'élément spécifié');
        } else if (insertMethod === 'prepend' && insertElement) {
          insertElement.insertBefore(container, insertElement.firstChild);
          inserted = true;
          console.log('DoulBrowser: Bouton inséré au début de l\'élément');
        } else if (insertElement) {
          insertElement.appendChild(container);
          inserted = true;
          console.log('DoulBrowser: Bouton inséré dans l\'élément spécifié');
        }
      } catch (error) {
        console.log('DoulBrowser: Erreur lors de l\'insertion personnalisée:', error);
      }
    }

    // Si l'insertion personnalisée a échoué, utiliser la méthode par défaut
    if (!inserted) {
      // Pour Facebook et TikTok, essayer une insertion spéciale
      const hostname = window.location.hostname.toLowerCase();

      // Insertion spéciale pour TikTok
      if (hostname.includes('tiktok.com') && !inserted) {
        const videoElement = document.querySelector('video');
        if (videoElement) {
          // Essayer plusieurs conteneurs TikTok
          const tiktokContainers = [
            videoElement.closest('[data-e2e="browse-video"]'),
            videoElement.closest('article'),
            videoElement.closest('main'),
            videoElement.closest('div[class*="DivVideoContainer"]'),
            videoElement.closest('div[class*="VideoContainer"]'),
            videoElement.parentElement?.parentElement,
            videoElement.parentElement
          ].filter(el => el && el.isConnected);

          for (const tiktokContainer of tiktokContainers) {
            if (tiktokContainer) {
              try {
                // Insérer après la vidéo ou dans le conteneur
                if (insertMethod === 'after' && videoElement.nextSibling) {
                  tiktokContainer.insertBefore(container, videoElement.nextSibling);
                } else if (tiktokContainer.firstChild) {
                  tiktokContainer.insertBefore(container, tiktokContainer.firstChild);
                } else {
                  tiktokContainer.appendChild(container);
                }
                inserted = true;
                console.log('DoulBrowser: Bouton inséré dans conteneur TikTok');
                break;
              } catch (error) {
                console.error('DoulBrowser: Erreur insertion TikTok', error);
              }
            }
          }

          // Si toujours pas inséré, insérer directement après la vidéo
          if (!inserted && videoElement.parentElement) {
            try {
              videoElement.parentElement.insertBefore(container, videoElement.nextSibling);
              inserted = true;
              console.log('DoulBrowser: Bouton inséré après vidéo TikTok');
            } catch (error) {
              console.error('DoulBrowser: Erreur insertion après vidéo TikTok', error);
            }
          }
        }
      }

      // Insertion spéciale pour Facebook
      if ((hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch')) && !inserted) {
        // Chercher un conteneur vidéo Facebook
        const fbVideoContainer = document.querySelector('[data-pagelet="VideoPage"]') ||
          document.querySelector('div[role="main"] article') ||
          document.querySelector('article[role="article"]') ||
          document.querySelector('div[role="article"]') ||
          document.querySelector('video')?.closest('div[role="article"]');

        if (fbVideoContainer && fbVideoContainer.isConnected) {
          try {
            // Insérer après le conteneur ou au début
            if (insertMethod === 'prepend' && fbVideoContainer.firstChild) {
              fbVideoContainer.insertBefore(container, fbVideoContainer.firstChild);
            } else if (fbVideoContainer.nextSibling) {
              fbVideoContainer.parentNode.insertBefore(container, fbVideoContainer.nextSibling);
            } else {
              fbVideoContainer.appendChild(container);
            }
            inserted = true;
            console.log('DoulBrowser: Bouton inséré dans conteneur Facebook');
          } catch (error) {
            console.error('DoulBrowser: Erreur insertion Facebook', error);
          }
        }
      }

      // 1. Essayer sous le titre de la vidéo (le plus visible)
      // Fonction helper pour insérer de manière sûre
      function safeInsert(parent, element, referenceElement) {
        if (!parent || !element) {
          console.error('DoulBrowser: safeInsert - parent ou element manquant');
          return false;
        }

        // Si l'élément a déjà un parent, le retirer d'abord
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }

        try {
          // Si referenceElement est fourni, essayer d'insérer avant lui
          if (referenceElement && referenceElement.parentNode === parent) {
            // Vérifier que referenceElement est bien un enfant direct
            const children = Array.from(parent.children);
            if (children.includes(referenceElement)) {
              parent.insertBefore(element, referenceElement);
              return true;
            }
          }
          // Sinon, ajouter à la fin (plus sûr)
          parent.appendChild(element);
          return true;
        } catch (error) {
          console.error('DoulBrowser: Erreur d\'insertion', error);
          // En cas d'erreur, essayer appendChild
          try {
            parent.appendChild(element);
            return true;
          } catch (e) {
            console.error('DoulBrowser: Erreur appendChild', e);
            return false;
          }
        }
      }

      // Essayer d'abord ytd-watch-metadata
      const watchMetadata = document.querySelector('ytd-watch-metadata');
      if (watchMetadata && !inserted) {
        try {
          // Chercher le conteneur du titre (premier enfant visible)
          const titleContainer = Array.from(watchMetadata.children).find(child => {
            const rect = child.getBoundingClientRect();
            return rect.height > 0 && rect.width > 0;
          });

          if (titleContainer && titleContainer.nextElementSibling) {
            // Essayer d'insérer après le conteneur du titre
            const nextSibling = titleContainer.nextElementSibling;
            if (Array.from(watchMetadata.children).includes(nextSibling)) {
              watchMetadata.insertBefore(container, nextSibling);
              inserted = true;
              console.log('DoulBrowser: Bouton inséré dans ytd-watch-metadata (après titre)');
            }
          }

          // Si pas encore inséré, utiliser appendChild (plus sûr)
          if (!inserted) {
            watchMetadata.appendChild(container);
            inserted = true;
            console.log('DoulBrowser: Bouton inséré dans ytd-watch-metadata (appendChild)');
          }
        } catch (error) {
          console.error('DoulBrowser: Erreur lors de l\'insertion dans ytd-watch-metadata', error);
          // En cas d'erreur, essayer appendChild
          try {
            watchMetadata.appendChild(container);
            inserted = true;
            console.log('DoulBrowser: Bouton inséré dans ytd-watch-metadata (fallback appendChild)');
          } catch (e) {
            console.error('DoulBrowser: Impossible d\'insérer dans ytd-watch-metadata', e);
          }
        }
      }

      // Si pas inséré, essayer #watch-header-content
      if (!inserted) {
        const watchHeaderContent = document.querySelector('#watch-header-content');
        if (watchHeaderContent) {
          inserted = safeInsert(watchHeaderContent, container, null);
          if (inserted) {
            console.log('DoulBrowser: Bouton inséré dans watch-header-content');
          }
        }
      }

      // Si pas inséré, essayer #info
      if (!inserted) {
        const info = document.querySelector('#info');
        if (info) {
          inserted = safeInsert(info, container, null);
          if (inserted) {
            console.log('DoulBrowser: Bouton inséré dans #info');
          }
        }
      }

      // Si pas inséré, essayer dans le conteneur principal
      if (!inserted) {
        const primary = document.querySelector('#primary, #content, #primary-inner');
        if (primary) {
          // Utiliser appendChild pour être sûr
          inserted = safeInsert(primary, container, null);
          if (inserted) {
            console.log('DoulBrowser: Bouton inséré dans primary');
          }
        }
      }

      // Pour Facebook, essayer des sélecteurs spécifiques
      if (!inserted) {
        const hostname = window.location.hostname.toLowerCase();
        if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch')) {
          // Chercher un conteneur vidéo Facebook
          const fbSelectors = [
            '[data-pagelet="VideoPage"]',
            'div[role="main"] article',
            'article[role="article"]',
            'div[role="article"]',
            'video',
            '[data-testid="post_message"]'
          ];

          for (const selector of fbSelectors) {
            const element = document.querySelector(selector);
            if (element && element.isConnected) {
              try {
                if (element.nextSibling) {
                  element.parentNode.insertBefore(container, element.nextSibling);
                } else {
                  element.appendChild(container);
                }
                inserted = true;
                console.log(`DoulBrowser: Bouton inséré dans ${selector}`);
                break;
              } catch (error) {
                console.error(`DoulBrowser: Erreur insertion ${selector}`, error);
              }
            }
          }
        }
      }

      // Dernier recours : insérer dans le body
      if (!inserted && document.body) {
        // Utiliser appendChild pour être sûr
        inserted = safeInsert(document.body, container, null);
        if (inserted) {
          console.log('DoulBrowser: Bouton inséré dans body');
        }
      }

      if (!inserted) {
        console.error('DoulBrowser: Impossible d\'insérer le bouton');
        buttonCreationInProgress = false;
        return;
      }

      // Forcer la visibilité avec des styles encore plus forts
      setTimeout(() => {
        const btn = document.getElementById('doulbrowser-download-container');
        if (btn) {
          btn.style.setProperty('display', 'block', 'important');
          btn.style.setProperty('visibility', 'visible', 'important');
          btn.style.setProperty('opacity', '1', 'important');
          btn.style.setProperty('position', 'relative', 'important');
          btn.style.setProperty('z-index', '999999', 'important');
          btn.style.setProperty('margin', '16px 0', 'important');
          btn.style.setProperty('padding', '0', 'important');

          const btnInner = document.getElementById('doulbrowser-download-btn');
          if (btnInner) {
            btnInner.style.setProperty('display', 'flex', 'important');
            btnInner.style.setProperty('visibility', 'visible', 'important');
            btnInner.style.setProperty('opacity', '1', 'important');
          }

          // Vérifier si le bouton est visible
          const rect = btn.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0;
          console.log('DoulBrowser: Position du bouton:', {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            visible: isVisible,
            parent: btn.parentElement?.tagName || 'none'
          });

          if (!isVisible) {
            console.warn('DoulBrowser: Bouton inséré mais non visible, tentative de repositionnement...');
            // Essayer de repositionner
            const watchMetadata = document.querySelector('ytd-watch-metadata');
            if (watchMetadata && btn.parentElement !== watchMetadata) {
              watchMetadata.appendChild(btn);
              console.log('DoulBrowser: Bouton repositionné dans ytd-watch-metadata');
            }
          }
        } else {
          console.error('DoulBrowser: Bouton non trouvé après insertion');
        }
      }, 200);

      // Marquer le bouton comme créé pour cette vidéo
      container.setAttribute('data-created', 'true');

      // Créer un conteneur pour afficher la progression
      const progressContainer = document.createElement('div');
      progressContainer.id = 'doulbrowser-progress-container';
      progressContainer.style.cssText = 'display: none; margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.05); border-radius: 8px;';

      const progressBar = document.createElement('div');
      progressBar.id = 'doulbrowser-progress-bar';
      progressBar.style.cssText = 'width: 100%; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin-bottom: 8px;';

      const progressFill = document.createElement('div');
      progressFill.id = 'doulbrowser-progress-fill';
      progressFill.style.cssText = 'width: 0%; height: 100%; background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); transition: width 0.3s;';
      progressBar.appendChild(progressFill);

      const progressText = document.createElement('div');
      progressText.id = 'doulbrowser-progress-text';
      progressText.style.cssText = 'font-size: 12px; color: #666; text-align: center;';
      progressText.textContent = '0% - 0 MB/s';

      progressContainer.appendChild(progressBar);
      progressContainer.appendChild(progressText);
      container.appendChild(progressContainer);

      button.addEventListener('click', async () => {
        // Désactiver le bouton pendant le téléchargement
        button.style.opacity = '0.6';
        button.style.cursor = 'not-allowed';
        span.textContent = '⏳ Démarrage...';

        // Afficher le conteneur de progression
        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0% - Démarrage...';

        try {
          // Envoyer la demande de téléchargement à l'application
          const response = await fetch(`http://localhost:8765/download-detected`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: videoUrl,
              filename: `${videoTitle}.mp4`,
              type: 'youtube',
              mimeType: 'video/youtube'
            })
          });

          if (!response.ok) {
            // Essayer de lire le message d'erreur du serveur
            let errorMessage = 'Impossible de démarrer le téléchargement';
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorMessage;
              console.error('DoulBrowser: Erreur serveur:', errorData);
            } catch (e) {
              console.error('DoulBrowser: Erreur HTTP:', response.status, response.statusText);
            }
            throw new Error(errorMessage);
          }

          // Mettre à jour le bouton
          button.style.background = '#10b981';
          span.textContent = '⬇ Téléchargement en cours...';

          // Polling pour obtenir la progression
          let progressInterval = setInterval(async () => {
            try {
              const statusResponse = await fetch(`http://localhost:8765/download-status?url=${encodeURIComponent(videoUrl)}`);
              if (statusResponse.ok) {
                const status = await statusResponse.json();

                if (status.status === 'completed') {
                  clearInterval(progressInterval);
                  progressFill.style.width = '100%';
                  progressText.textContent = '✓ Téléchargement terminé !';
                  button.style.background = '#10b981';
                  span.textContent = '✓ Terminé !';
                  setTimeout(() => {
                    progressContainer.style.display = 'none';
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                    button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    span.textContent = '⬇ Télécharger avec DoulBrowser';
                  }, 3000);
                } else if (status.status === 'error') {
                  clearInterval(progressInterval);
                  progressText.textContent = '✗ Erreur: ' + (status.error || 'Échec du téléchargement');
                  button.style.background = '#ef4444';
                  span.textContent = '✗ Erreur';
                  setTimeout(() => {
                    progressContainer.style.display = 'none';
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                    button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    span.textContent = '⬇ Télécharger avec DoulBrowser';
                  }, 3000);
                } else if (status.status === 'downloading' || status.status === 'paused') {
                  // Mettre à jour la progression
                  const progress = status.progress || 0;
                  const speed = status.speed || 0; // Vitesse en bytes/seconde
                  let speedText = '0 B/s';

                  if (speed > 0) {
                    if (speed < 1024) {
                      speedText = Math.round(speed) + ' B/s';
                    } else if (speed < 1024 * 1024) {
                      speedText = (speed / 1024).toFixed(2) + ' KB/s';
                    } else {
                      speedText = (speed / (1024 * 1024)).toFixed(2) + ' MB/s';
                    }
                  }

                  progressFill.style.width = progress + '%';
                  progressText.textContent = `${Math.round(progress)}% - ${speedText}`;

                  if (status.status === 'paused') {
                    span.textContent = '⏸ Pause';
                  } else {
                    span.textContent = '⬇ ' + Math.round(progress) + '%';
                  }
                }
              }
            } catch (error) {
              // Ignorer les erreurs de polling
            }
          }, 500); // Vérifier toutes les 500ms

          // Arrêter le polling après 10 minutes (timeout)
          setTimeout(() => {
            clearInterval(progressInterval);
          }, 600000);

        } catch (error) {
          console.error('DoulBrowser: Erreur de téléchargement', error);
          progressContainer.style.display = 'none';
          button.style.opacity = '1';
          button.style.cursor = 'pointer';
          button.style.background = '#ef4444';

          // Afficher le message d'erreur réel
          const errorMessage = error.message || 'Erreur de connexion';
          span.textContent = '✗ ' + (errorMessage.length > 30 ? errorMessage.substring(0, 30) + '...' : errorMessage);

          setTimeout(() => {
            button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            span.textContent = '⬇ Télécharger avec DoulBrowser';
          }, 5000);
        }
      });

      // Vérifier après un court délai si le bouton est visible, sinon le déplacer
      setTimeout(() => {
        const rect = container.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0;

        if (!isVisible) {
          console.log('DoulBrowser: Bouton non visible, tentative de repositionnement...');

          // Essayer d'insérer dans le menu des actions (sous la vidéo)
          const menuContainer = document.querySelector('#menu-container, #actions, ytd-menu-renderer');
          if (menuContainer && menuContainer.parentElement) {
            if (safeInsert(menuContainer.parentElement, container, menuContainer)) {
              console.log('DoulBrowser: Bouton repositionné dans menu-container');
              return;
            }
          }

          // Essayer d'insérer juste après le player
          const player = document.querySelector('#movie_player, ytd-player');
          if (player && player.parentElement) {
            const nextSibling = player.nextElementSibling;
            if (safeInsert(player.parentElement, container, nextSibling)) {
              console.log('DoulBrowser: Bouton repositionné après le player');
              return;
            }
          }

          // Insérer en haut de la page de manière fixe
          container.style.position = 'fixed';
          container.style.top = '80px';
          container.style.right = '20px';
          container.style.zIndex = '999999';
          container.style.width = 'auto';
          if (safeInsert(document.body, container, null)) {
            console.log('DoulBrowser: Bouton repositionné en position fixe');
          }
        }
      }, 500);

      buttonCreationInProgress = false;
    }

    // Détecter les vidéos sur tous les réseaux sociaux
    function detectSocialMediaVideo() {
      const hostname = window.location.hostname.toLowerCase();
      const currentUrl = window.location.href;
      let videoUrl = currentUrl;
      let videoTitle = '';
      let videoId = '';
      let insertSelector = null;
      let insertMethod = 'append';

      // YouTube
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        const urlParams = new URLSearchParams(window.location.search);
        const videoIdParam = urlParams.get('v');

        if (!videoIdParam || videoIdParam.length !== 11) {
          return;
        }

        const watchMetadata = document.querySelector('ytd-watch-metadata');
        if (!watchMetadata || !watchMetadata.isConnected || watchMetadata.children.length === 0) {
          console.log('DoulBrowser: ytd-watch-metadata non trouvé, attente...');
          return;
        }

        videoId = videoIdParam;
        videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        if (window.ytInitialPlayerResponse) {
          try {
            const videoDetails = window.ytInitialPlayerResponse.videoDetails;
            if (videoDetails) {
              videoTitle = videoDetails.title || 'YouTube Video';
            }
          } catch (error) {
            console.log('DoulBrowser: Error reading ytInitialPlayerResponse:', error);
          }
        }

        if (!videoTitle || videoTitle === 'YouTube Video') {
          const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title, ytd-watch-metadata h1');
          if (titleElement) {
            videoTitle = titleElement.textContent?.trim() || 'YouTube Video';
          }
        }

        insertSelector = 'ytd-watch-metadata';
        insertMethod = 'after';
      }
      // Instagram
      else if (hostname.includes('instagram.com')) {
        // Instagram Reels ou vidéos
        if (currentUrl.includes('/reel/') || currentUrl.includes('/p/') || currentUrl.includes('/tv/')) {
          videoId = currentUrl.split('/').filter(p => p).pop()?.split('?')[0] || '';
          videoUrl = currentUrl.split('?')[0];

          // Chercher le titre/description
          const titleEl = document.querySelector('h1, article h1, [role="dialog"] h1, span[dir="auto"]');
          if (titleEl) {
            videoTitle = titleEl.textContent?.trim() || 'Instagram Video';
          } else {
            videoTitle = 'Instagram Video';
          }

          insertSelector = 'article, [role="dialog"] article, main article';
          insertMethod = 'prepend';
        }
      }
      // TikTok
      else if (hostname.includes('tiktok.com')) {
        // TikTok a une structure DOM très dynamique, détecter plusieurs patterns d'URL
        const isVideoPage = currentUrl.includes('/video/') ||
          currentUrl.includes('/@') ||
          currentUrl.match(/\/video\/\d+/) ||
          document.querySelector('video') !== null; // Détecter si une vidéo est présente

        if (isVideoPage || document.querySelector('video')) {
          // Extraire l'ID vidéo de différentes façons
          const videoMatch = currentUrl.match(/\/video\/(\d+)/);
          if (videoMatch) {
            videoId = videoMatch[1];
          } else {
            videoId = currentUrl.split('/video/')[1]?.split('?')[0] ||
              currentUrl.split('/').pop()?.split('?')[0] ||
              Date.now().toString();
          }
          videoUrl = currentUrl.split('?')[0];

          // Chercher le titre dans plusieurs emplacements (TikTok change souvent sa structure)
          let titleEl = null;
          const titleSelectors = [
            '[data-e2e="browse-video-desc"]',
            '[data-e2e="video-title"]',
            'h1[data-e2e="browse-video-title"]',
            'h1',
            '[data-e2e="browse-video-desc-text"]',
            'span[data-e2e="browse-video-desc"]',
            '.video-meta-title',
            'article h1',
            '[data-e2e="browse-video-desc"] span',
            'div[data-e2e="browse-video-desc"]',
            'main h1',
            'main article h1'
          ];

          for (const selector of titleSelectors) {
            try {
              titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent?.trim()) {
                break;
              }
            } catch (e) {
              // Ignorer les erreurs de sélecteur
            }
          }

          videoTitle = titleEl?.textContent?.trim() || 'TikTok Video';

          // Essayer plusieurs sélecteurs pour l'insertion (TikTok change souvent)
          // Prioriser les éléments proches de la vidéo
          const videoElement = document.querySelector('video');
          if (videoElement && videoElement.parentElement) {
            insertElement = videoElement.parentElement;
            insertMethod = 'after';
          } else {
            insertSelector = '[data-e2e="video-player-container"], [data-e2e="browse-video"], main, article, [data-e2e="browse-video-desc"], div[class*="video"]';
            insertMethod = 'after';
          }
        }
      }
      // Twitter/X
      else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
        if (currentUrl.includes('/status/')) {
          videoId = currentUrl.split('/status/')[1]?.split('?')[0] || '';
          videoUrl = currentUrl.split('?')[0];

          const titleEl = document.querySelector('[data-testid="tweetText"], article [lang]');
          if (titleEl) {
            videoTitle = titleEl.textContent?.trim().substring(0, 100) || 'Twitter Video';
          } else {
            videoTitle = 'Twitter Video';
          }

          insertSelector = 'article[data-testid="tweet"], article';
          insertMethod = 'after';
        }
      }
      // Facebook
      else if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch')) {
        // Détecter les vidéos Facebook - vérifier si une vidéo est présente sur la page
        const hasVideo = document.querySelector('video') !== null;
        const isVideoPage = currentUrl.includes('/watch') ||
          currentUrl.includes('/videos/') ||
          currentUrl.includes('/video.php') ||
          currentUrl.match(/\/\d+\/?$/); // URL se terminant par un ID numérique

        if (hasVideo || isVideoPage) {
          // Extraire l'ID vidéo de l'URL
          const videoMatch = currentUrl.match(/\/(?:watch|videos|video\.php)\/?\??(?:v=)?(\d+)/) ||
            currentUrl.match(/\/(\d+)\/?$/);
          videoId = videoMatch ? videoMatch[1] :
            currentUrl.split('/videos/')[1]?.split('?')[0] ||
            currentUrl.split('/watch?v=')[1]?.split('&')[0] ||
            currentUrl.split('/').filter(p => p && !isNaN(p)).pop() ||
            Date.now().toString();
          videoUrl = currentUrl.split('?')[0];

          // Chercher le titre dans plusieurs emplacements possibles (avec délai pour le chargement dynamique)
          let titleEl = null;
          const titleSelectors = [
            '[data-pagelet="VideoPage"] h1',
            '[role="main"] h1',
            'h1[dir="auto"]',
            'span[dir="auto"]:not([aria-hidden])',
            '[data-testid="post_message"] span[dir="auto"]',
            'div[data-ad-preview="message"]',
            'article h1',
            'div[role="article"] h1',
            'span[data-testid="post_message"]'
          ];

          for (const selector of titleSelectors) {
            titleEl = document.querySelector(selector);
            if (titleEl && titleEl.textContent?.trim()) {
              break;
            }
          }

          if (titleEl && titleEl.textContent?.trim()) {
            videoTitle = titleEl.textContent.trim();
          } else {
            videoTitle = 'Facebook Video';
          }

          // Essayer plusieurs sélecteurs pour l'insertion (priorité)
          insertSelector = '[data-pagelet="VideoPage"], div[role="main"] article, article[role="article"], div[role="article"], video, main';
          insertMethod = 'after';
        }
      }
      // Reddit
      else if (hostname.includes('reddit.com') || hostname.includes('redd.it')) {
        if (currentUrl.includes('/r/') && (currentUrl.includes('/comments/') || document.querySelector('video'))) {
          videoId = currentUrl.split('/comments/')[1]?.split('/')[0] || '';
          videoUrl = currentUrl.split('?')[0];

          const titleEl = document.querySelector('h1[data-testid="post-content"] span, h1, [slot="title"]');
          if (titleEl) {
            videoTitle = titleEl.textContent?.trim() || 'Reddit Video';
          } else {
            videoTitle = 'Reddit Video';
          }

          insertSelector = '[data-testid="post-content"], article, [role="article"]';
          insertMethod = 'after';
        }
      }
      // Vimeo
      else if (hostname.includes('vimeo.com')) {
        const vimeoMatch = currentUrl.match(/vimeo\.com\/(\d+)/);
        if (vimeoMatch) {
          videoId = vimeoMatch[1];
          videoUrl = `https://vimeo.com/${videoId}`;

          const titleEl = document.querySelector('h1, [data-title]');
          if (titleEl) {
            videoTitle = titleEl.textContent?.trim() || titleEl.getAttribute('data-title') || 'Vimeo Video';
          } else {
            videoTitle = 'Vimeo Video';
          }

          insertSelector = 'h1, [data-player-container], .player';
          insertMethod = 'after';
        }
      }
      // Dailymotion
      else if (hostname.includes('dailymotion.com')) {
        const dailymotionMatch = currentUrl.match(/dailymotion\.com\/video\/([^/?]+)/);
        if (dailymotionMatch) {
          videoId = dailymotionMatch[1];
          videoUrl = `https://www.dailymotion.com/video/${videoId}`;

          const titleEl = document.querySelector('h1, .video-title, [data-title]');
          if (titleEl) {
            videoTitle = titleEl.textContent?.trim() || 'Dailymotion Video';
          } else {
            videoTitle = 'Dailymotion Video';
          }

          insertSelector = 'h1, .player-container, .video-container';
          insertMethod = 'after';
        }
      }
      // Twitch
      else if (hostname.includes('twitch.tv')) {
        if (currentUrl.includes('/videos/') || currentUrl.includes('/clips/')) {
          videoId = currentUrl.split('/videos/')[1]?.split('?')[0] || currentUrl.split('/clips/')[1]?.split('?')[0] || '';
          videoUrl = currentUrl.split('?')[0];

          const titleEl = document.querySelector('h1, h2, [data-a-target="video-title"]');
          if (titleEl) {
            videoTitle = titleEl.textContent?.trim() || 'Twitch Video';
          } else {
            videoTitle = 'Twitch Video';
          }

          insertSelector = '[data-a-target="player-container"], .player-container, main';
          insertMethod = 'after';
        }
      }

      // Si une vidéo a été détectée, créer le bouton
      // Pour TikTok, créer le bouton même si certaines infos manquent (détection par présence de <video>)
      const isTikTok = hostname.includes('tiktok.com');
      const hasVideo = document.querySelector('video') !== null;

      // Pour TikTok, forcer la détection si une vidéo est présente
      if (isTikTok && hasVideo && !videoUrl) {
        videoUrl = currentUrl;
        if (!videoId) {
          videoId = currentUrl.split('/video/')[1]?.split('?')[0] || Date.now().toString();
        }
        if (!videoTitle) {
          videoTitle = 'TikTok Video';
        }
      }

      if ((videoUrl && videoUrl !== currentUrl) || (videoId && videoTitle) || (isTikTok && hasVideo)) {
        if (!videoTitle) {
          videoTitle = isTikTok ? 'TikTok Video' : 'Social Media Video';
        }
        if (!videoId) {
          videoId = videoUrl || currentUrl || Date.now().toString();
        }
        if (!videoUrl) {
          videoUrl = currentUrl;
        }

        // Trouver l'élément d'insertion
        let insertElement = null;

        // Pour TikTok, prioriser les éléments proches de la vidéo
        if (isTikTok) {
          const videoElement = document.querySelector('video');
          if (videoElement) {
            // Essayer plusieurs parents pour trouver le meilleur emplacement
            insertElement = videoElement.parentElement?.parentElement ||
              videoElement.closest('[data-e2e="browse-video"]') ||
              videoElement.closest('article') ||
              videoElement.closest('main') ||
              videoElement.parentElement;
          }
        }

        if (!insertElement && insertSelector) {
          // Essayer plusieurs sélecteurs (séparés par virgule)
          const selectors = insertSelector.split(',').map(s => s.trim());
          for (const sel of selectors) {
            try {
              insertElement = document.querySelector(sel);
              if (insertElement) break;
            } catch (e) {
              // Ignorer les erreurs de sélecteur invalide
            }
          }
        }

        // Si pas d'élément spécifique, essayer de trouver un conteneur vidéo
        if (!insertElement) {
          const videoElement = document.querySelector('video');
          insertElement = videoElement?.parentElement ||
            videoElement?.closest('main') ||
            videoElement?.closest('article') ||
            document.querySelector('main') ||
            document.querySelector('article') ||
            document.body;
        }

        if (insertElement) {
          createDownloadButton(videoUrl, videoTitle, videoId, insertElement, insertMethod || 'after');
        } else {
          // Fallback: créer le bouton de manière fixe en haut de la page
          createDownloadButton(videoUrl, videoTitle, videoId);
        }
      }
    }

    // Alias pour compatibilité avec le code existant
    function detectYouTubeVideo() {
      detectSocialMediaVideo();
    }

    // Fonction principale de détection (utilisée partout)
    const detectVideo = detectSocialMediaVideo;

    // Fonction pour créer un bouton de téléchargement pour un fichier
    function createFileDownloadButton(fileUrl, fileName, fileType, insertElement = null) {
      // Éviter les doublons
      const existingButton = document.querySelector(`[data-doulbrowser-file="${fileUrl}"]`);
      if (existingButton) return;

      const container = document.createElement('div');
      container.setAttribute('data-doulbrowser-file', fileUrl);
      container.style.cssText = 'display: inline-block !important; margin: 8px !important; z-index: 999999 !important;';

      const button = document.createElement('button');
      button.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; color: white !important; padding: 8px 16px !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; font-size: 12px !important; font-weight: 600 !important; display: flex !important; align-items: center !important; gap: 6px !important;';

      const icon = document.createElement('span');
      icon.textContent = fileType === 'audio' ? '🎵' : fileType === 'document' ? '📄' : fileType === 'video' ? '🎬' : '⬇';
      button.appendChild(icon);

      const text = document.createElement('span');
      text.textContent = `Télécharger ${fileName || 'fichier'}`;
      button.appendChild(text);

      button.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        chrome.runtime.sendMessage({
          action: 'sendDownload',
          url: fileUrl,
          filename: fileName || fileUrl.split('/').pop()?.split('?')[0] || 'download'
        });
      };

      container.appendChild(button);

      if (insertElement && insertElement.parentNode) {
        insertElement.parentNode.insertBefore(container, insertElement.nextSibling);
      } else if (insertElement) {
        insertElement.appendChild(container);
      } else {
        // Trouver un endroit approprié pour insérer
        const parent = document.querySelector('main, article, [role="main"], body');
        if (parent) {
          parent.appendChild(container);
        }
      }
    }

    // Détecter les fichiers audio et documents sur la page
    function detectDownloadableFiles() {
      // Détecter les balises audio
      document.querySelectorAll('audio[src], audio source[src]').forEach(audio => {
        const src = audio.src || audio.getAttribute('src');
        if (src && isDownloadableFile(src)) {
          const fileName = src.split('/').pop()?.split('?')[0] || 'audio';
          createFileDownloadButton(src, fileName, 'audio', audio);
        }
      });

      // Détecter les liens de téléchargement
      document.querySelectorAll('a[href]').forEach(link => {
        const href = link.href || link.getAttribute('href');
        if (href && isDownloadableFile(href) && !link.hasAttribute('data-doulbrowser-detected')) {
          link.setAttribute('data-doulbrowser-detected', 'true');
          const fileName = link.getAttribute('download') ||
            link.textContent?.trim() ||
            href.split('/').pop()?.split('?')[0] ||
            'download';
          const fileType = getFileType(href);
          createFileDownloadButton(href, fileName, fileType, link);
        }
      });

      // Détecter les éléments avec des attributs data-src ou data-url
      document.querySelectorAll('[data-src], [data-url], [data-file]').forEach(el => {
        const fileUrl = el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-file');
        if (fileUrl && isDownloadableFile(fileUrl) && !el.hasAttribute('data-doulbrowser-detected')) {
          el.setAttribute('data-doulbrowser-detected', 'true');
          const fileName = el.getAttribute('data-filename') || fileUrl.split('/').pop()?.split('?')[0] || 'download';
          const fileType = getFileType(fileUrl);
          createFileDownloadButton(fileUrl, fileName, fileType, el);
        }
      });
    }

    // Détecter les clics sur les liens de téléchargement
    document.addEventListener('click', (event) => {
      const target = event.target;
      const link = target.closest('a');

      if (link && link.href) {
        const url = link.href;
        const href = link.getAttribute('href') || '';

        // Vérifier si c'est un lien de téléchargement
        // Ignorer les images sauf si l'attribut download est présent (téléchargement explicite)
        const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)(\?|$)/i.test(url) || /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)(\?|$)/i.test(href);
        if (isImage && !link.hasAttribute('download')) {
          return; // Ignorer les images sauf téléchargement explicite
        }

        const downloadPatterns = [
          // Vidéos
          /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v|3gp|mpg|mpeg)(\?|$)/i,
          // Audio
          /\.(mp3|wav|flac|aac|ogg|m4a|wma|opus|amr|mka)(\?|$)/i,
          // Documents
          /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv)(\?|$)/i,
          // Archives
          /\.(zip|rar|7z|tar|gz|bz2|cab|iso)(\?|$)/i,
          // Exécutables
          /\.(exe|msi|dmg|deb|rpm|bin|apk|ipa)(\?|$)/i,
          // Autres fichiers
          /download/i,
          /attachment/i,
          /\.(torrent|epub|mobi|azw)(\?|$)/i
        ];

        const isDownloadLink = downloadPatterns.some(pattern =>
          pattern.test(url) || pattern.test(href)
        ) || link.hasAttribute('download');

        if (isDownloadLink) {
          // Extraire le nom de fichier
          let filename = link.getAttribute('download') ||
            url.split('/').pop()?.split('?')[0] ||
            'download';
          filename = decodeURIComponent(filename);

          // Envoyer à l'extension
          chrome.runtime.sendMessage({
            action: 'sendDownload',
            url: url,
            filename: filename
          });
        }
      }
    }, true);

    // DÉSACTIVÉ : Détection automatique des vidéos HTML5 désactivée
    // Les téléchargements ne seront déclenchés que par l'utilisateur (clic sur le bouton)
    function detectHTML5Videos() {
      // Fonction désactivée pour éviter les détections automatiques
      return;
    }

    // Fonction pour détecter avec plusieurs tentatives
    function detectWithRetry() {
      // Ne pas créer plusieurs tentatives en parallèle
      if (buttonCreationInProgress) {
        return;
      }

      let attempts = 0;
      const maxAttempts = 5;

      const tryDetect = () => {
        // Vérifier si le bouton existe déjà
        if (document.getElementById('doulbrowser-download-container')) {
          console.log('DoulBrowser: Bouton existe déjà');
          return;
        }

        attempts++;
        detectSocialMediaVideo();

        // Vérifier si le bouton a été créé
        if (!document.getElementById('doulbrowser-download-container') && attempts < maxAttempts) {
          setTimeout(tryDetect, 1000);
        } else if (document.getElementById('doulbrowser-download-container')) {
          console.log('DoulBrowser: Bouton créé avec succès');
        }
      };

      tryDetect();
    }

    // Observer les changements de la page (avec debounce pour éviter les créations multiples)
    let detectionTimeout = null;
    const observer = new MutationObserver((mutations) => {
      // Ne déclencher que si des éléments pertinents changent
      const hasRelevantChange = mutations.some(mutation => {
        const target = mutation.target;
        if (!target || !target.nodeName) return false;

        // Vérifier si c'est un changement dans les éléments pertinents (tous réseaux sociaux)
        return target.id === 'watch-header' ||
          target.id === 'watch-header-content' ||
          target.classList?.contains('ytd-watch-metadata') ||
          target.querySelector?.('ytd-watch-metadata') ||
          target.querySelector?.('#watch-header') ||
          target.tagName === 'ARTICLE' ||
          target.tagName === 'MAIN' ||
          target.querySelector?.('video');
      });

      if (hasRelevantChange) {
        // Debounce pour éviter les déclenchements multiples
        if (detectionTimeout) {
          clearTimeout(detectionTimeout);
        }
        detectionTimeout = setTimeout(() => {
          // Ne détecter que si le bouton n'existe pas déjà
          if (!document.getElementById('doulbrowser-download-container')) {
            detectSocialMediaVideo();
          }
        }, 2000);
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
      });
    } else {
      // Attendre que document.body soit disponible
      const bodyObserver = new MutationObserver(() => {
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
          });
          bodyObserver.disconnect();
        }
      });
      bodyObserver.observe(document.documentElement, {
        childList: true,
        subtree: false
      });
    }

    // Observer pour détecter les nouveaux fichiers téléchargeables et médias
    if (document.body) {
      const fileObserver = new MutationObserver(() => {
        detectDownloadableFiles();
        detectMediaElements(); // Détecter les balises <video> et <audio>
      });

      fileObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'src', 'data-src', 'data-url', 'data-file', 'srcObject']
      });
    }

    // Détecter au chargement initial
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(detectWithRetry, 1000);
        setTimeout(detectDownloadableFiles, 2000);
        // Pour Facebook et TikTok, attendre un peu plus car le DOM est très dynamique
        const hostname = window.location.hostname.toLowerCase();
        if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
          setTimeout(detectSocialMediaVideo, 3000);
          setTimeout(detectSocialMediaVideo, 5000);
        }
        if (hostname.includes('tiktok.com')) {
          setTimeout(detectSocialMediaVideo, 2000);
          setTimeout(detectSocialMediaVideo, 4000);
          setTimeout(detectSocialMediaVideo, 6000);
        }
      });
    } else {
      setTimeout(detectWithRetry, 1000);
      setTimeout(detectDownloadableFiles, 2000);
      // Pour Facebook, attendre un peu plus car le DOM est très dynamique
      if (window.location.hostname.includes('facebook.com') || window.location.hostname.includes('fb.com')) {
        setTimeout(detectSocialMediaVideo, 3000);
        setTimeout(detectSocialMediaVideo, 5000);
      }
    }

    // Détecter aussi lors des changements d'URL (YouTube SPA)
    let lastUrl = location.href;
    let urlCheckInterval = null;

    // Vérifier les changements d'URL périodiquement (plus fiable que MutationObserver)
    function checkUrlChange() {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        // Réinitialiser pour permettre la création d'un nouveau bouton
        currentVideoId = null;
        buttonCreationInProgress = false;

        // Supprimer l'ancien bouton
        const oldContainer = document.getElementById('doulbrowser-download-container');
        if (oldContainer) {
          oldContainer.remove();
        }

        // Attendre un peu avant de détecter la nouvelle vidéo
        setTimeout(() => {
          detectWithRetry();
        }, 2000);
      }
    }

    // Vérifier toutes les secondes
    urlCheckInterval = setInterval(checkUrlChange, 1000);

    // Détection périodique pour toutes les plateformes (style IDM)
    const currentHostname = window.location.hostname.toLowerCase();

    // Détection périodique universelle pour les médias et fichiers
    setInterval(() => {
      detectMediaElements(); // Détecter les balises <video> et <audio>
      detectDownloadableFiles(); // Détecter les liens de téléchargement
    }, 3000); // Vérifier toutes les 3 secondes

    // Pour Facebook et TikTok, détecter périodiquement car le DOM change constamment
    if (currentHostname.includes('facebook.com') || currentHostname.includes('fb.com')) {
      setInterval(() => {
        if (!document.getElementById('doulbrowser-download-container')) {
          detectSocialMediaVideo();
          detectMediaElements();
        }
      }, 5000); // Vérifier toutes les 5 secondes
    }

    if (currentHostname.includes('tiktok.com')) {
      setInterval(() => {
        if (!document.getElementById('doulbrowser-download-container')) {
          detectSocialMediaVideo();
          detectMediaElements();
        }
      }, 4000); // Vérifier toutes les 4 secondes pour TikTok
    }

    // Détection périodique pour toutes les autres plateformes
    const socialMediaDomains = ['youtube.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv'];
    const isSocialMedia = socialMediaDomains.some(domain => currentHostname.includes(domain));

    if (isSocialMedia) {
      setInterval(() => {
        detectSocialMediaVideo();
        detectMediaElements();
      }, 5000); // Vérifier toutes les 5 secondes
    }

    // Écouter les événements de navigation YouTube
    window.addEventListener('yt-navigate-finish', () => {
      currentVideoId = null;
      buttonCreationInProgress = false;

      const oldContainer = document.getElementById('doulbrowser-download-container');
      if (oldContainer) {
        oldContainer.remove();
      }

      setTimeout(() => {
        detectWithRetry();
      }, 2000);
    });

    // Détecter aussi quand YouTube charge les données
    if (window.ytInitialData) {
      setTimeout(detectWithRetry, 2000);
    }

    // Écouter les messages depuis le popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'detectVideo') {
        detectSocialMediaVideo();
        sendResponse({ success: true });
      }
      return true;
    });

    // Écouter les messages depuis le script injecté
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'DOULBROWSER_DOWNLOAD') {
        chrome.runtime.sendMessage({
          action: 'sendDownload',
          url: event.data.url,
          filename: (event.data.title || 'Video') + '.mp4',
          type: 'youtube'
        });
      }

      if (event.data && event.data.type === 'DOULBROWSER_PAUSE') {
        chrome.runtime.sendMessage({
          action: 'pauseDownload',
          url: event.data.url
        });
      }

      if (event.data && event.data.type === 'DOULBROWSER_RESUME') {
        chrome.runtime.sendMessage({
          action: 'resumeDownload',
          url: event.data.url
        });
      }

      if (event.data && event.data.type === 'DOULBROWSER_CANCEL') {
        chrome.runtime.sendMessage({
          action: 'cancelDownload',
          url: event.data.url
        });
      }
    });

  }) ();

