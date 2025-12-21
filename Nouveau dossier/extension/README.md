# Extension DoulBrowser pour Navigateurs

Cette extension permet de détecter automatiquement les téléchargements dans votre navigateur et de les envoyer à l'application DoulBrowser.

## Installation

### Chrome/Edge/Brave
1. Ouvrez Chrome/Edge/Brave
2. Allez dans `chrome://extensions/` (ou `edge://extensions/` pour Edge)
3. Activez le "Mode développeur" en haut à droite
4. Cliquez sur "Charger l'extension non empaquetée"
5. Sélectionnez le dossier `extension` de ce projet

### Firefox
1. Ouvrez Firefox
2. Allez dans `about:debugging`
3. Cliquez sur "Ce Firefox"
4. Cliquez sur "Charger un module complémentaire temporaire"
5. Sélectionnez le fichier `manifest.json` dans le dossier `extension`

## Utilisation

1. Assurez-vous que l'application DoulBrowser est en cours d'exécution
2. L'extension détecte automatiquement les téléchargements lorsque vous naviguez
3. Une notification apparaît dans DoulBrowser pour chaque téléchargement détecté
4. Cliquez sur "Télécharger" dans la notification pour démarrer le téléchargement

## Fonctionnalités

- Détection automatique des fichiers téléchargeables
- Support de tous les types de fichiers (vidéos, audio, documents, archives, etc.)
- Communication en temps réel avec DoulBrowser
- Indicateur de connexion dans le popup de l'extension

## Dépannage

Si l'extension ne fonctionne pas :
1. Vérifiez que DoulBrowser est en cours d'exécution
2. Cliquez sur l'icône de l'extension pour voir le statut de connexion
3. Redémarrez DoulBrowser si nécessaire







