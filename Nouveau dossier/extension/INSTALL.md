# Guide d'installation de l'extension DoulBrowser

## Installation dans Chrome/Edge/Brave

1. **Ouvrez la page des extensions**
   - Chrome : Tapez `chrome://extensions/` dans la barre d'adresse
   - Edge : Tapez `edge://extensions/` dans la barre d'adresse
   - Brave : Tapez `brave://extensions/` dans la barre d'adresse

2. **Activez le mode développeur**
   - Cliquez sur le bouton "Mode développeur" en haut à droite (toggle)

3. **Chargez l'extension**
   - Cliquez sur "Charger l'extension non empaquetée"
   - Naviguez vers le dossier `extension` de ce projet
   - Sélectionnez le dossier et cliquez sur "Sélectionner le dossier"

4. **Vérifiez l'installation**
   - L'extension devrait apparaître dans la liste
   - L'icône DoulBrowser devrait apparaître dans la barre d'outils

## Installation dans Firefox

1. **Ouvrez la page de débogage**
   - Tapez `about:debugging` dans la barre d'adresse

2. **Chargez l'extension**
   - Cliquez sur "Ce Firefox" dans le menu de gauche
   - Cliquez sur "Charger un module complémentaire temporaire"
   - Naviguez vers le dossier `extension` et sélectionnez le fichier `manifest.json`

## Vérification

1. **Démarrez DoulBrowser**
   - Assurez-vous que l'application DoulBrowser est en cours d'exécution

2. **Vérifiez la connexion**
   - Cliquez sur l'icône de l'extension dans la barre d'outils
   - Le statut devrait afficher "✓ Connecté à DoulBrowser"

3. **Testez la détection**
   - Allez sur YouTube et ouvrez une vidéo
   - L'extension devrait détecter automatiquement la vidéo
   - Une notification devrait apparaître dans DoulBrowser

## Dépannage

### L'extension ne se connecte pas à DoulBrowser

1. Vérifiez que DoulBrowser est en cours d'exécution
2. Vérifiez que le port 8765 n'est pas bloqué par un pare-feu
3. Redémarrez DoulBrowser
4. Rechargez l'extension (cliquez sur l'icône de rechargement dans `chrome://extensions/`)

### L'extension ne détecte pas les vidéos YouTube

1. Rechargez la page YouTube
2. Cliquez sur l'icône de l'extension
3. Cliquez sur "Détecter la page actuelle"
4. Vérifiez que vous êtes sur une page de vidéo YouTube (URL contient `/watch?v=`)

### Erreurs dans la console

- Les erreurs "Mapify" proviennent d'une autre extension, pas de DoulBrowser
- Les erreurs FetchError peuvent indiquer que DoulBrowser n'est pas démarré

## Support

Si vous rencontrez des problèmes, vérifiez :
1. Que DoulBrowser est bien démarré
2. Que le port 8765 est accessible
3. Que l'extension est bien chargée et activée
4. Les logs de la console du navigateur (F12)







