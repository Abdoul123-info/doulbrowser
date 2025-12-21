# Guide de Publication sur Chrome Web Store

## 📋 Prérequis

1. **Compte Google** avec paiement unique de $5 USD pour devenir développeur Chrome Web Store
2. **Extension préparée** et testée
3. **Images de promotion** (voir ci-dessous)

## 🎨 Images Requises

Vous devez préparer les images suivantes pour la publication :

### 1. Icônes (déjà présentes)
- ✅ `icons/icon16.png` (16x16 pixels)
- ✅ `icons/icon48.png` (48x48 pixels)
- ✅ `icons/icon128.png` (128x128 pixels)

### 2. Images de Promotion (à créer)
- **Petite icône promotionnelle** : 440x280 pixels (optionnel mais recommandé)
- **Capture d'écran** : 1280x800 pixels ou 640x400 pixels (minimum 1, maximum 5)
- **Bannière de la boutique** : 920x680 pixels (optionnel)

## 📦 Étape 1 : Créer le Package ZIP

1. Créez un dossier temporaire avec uniquement les fichiers nécessaires :
   ```
   extension-package/
   ├── manifest.json
   ├── background.js
   ├── content.js
   ├── popup.html
   ├── popup.js
   └── icons/
       ├── icon16.png
       ├── icon48.png
       └── icon128.png
   ```

2. **IMPORTANT** : Ne pas inclure :
   - ❌ `README.md`
   - ❌ `INSTALL.md`
   - ❌ `copy-icons.ps1`
   - ❌ `inject.js` (si non utilisé)
   - ❌ `content-button.js` (si non utilisé)
   - ❌ Fichiers de développement

3. Compressez le dossier en ZIP (pas le dossier lui-même, mais son contenu)

## 🌐 Étape 2 : Créer un Compte Développeur

1. Allez sur [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Connectez-vous avec votre compte Google
3. Acceptez les conditions d'utilisation
4. Payez les **$5 USD** (paiement unique, valable à vie)
5. Remplissez votre profil développeur

## 📤 Étape 3 : Publier l'Extension

1. **Cliquez sur "Nouvel élément"** dans le tableau de bord
2. **Téléversez le fichier ZIP** de votre extension
3. **Remplissez les informations** :

   ### Informations de base
   - **Nom** : DoulBrowser Download Manager
   - **Catégorie** : Productivité ou Utilitaires
   - **Langue** : Français (et/ou Anglais)
   - **Description courte** : "Gestionnaire de téléchargements pour DoulBrowser"
   - **Description détaillée** : 
     ```
     DoulBrowser Download Manager est une extension qui permet de capturer 
     automatiquement les téléchargements et les envoyer à l'application 
     DoulBrowser pour une gestion avancée.
     
     Fonctionnalités :
     - Détection automatique des liens de téléchargement
     - Bouton de téléchargement sur YouTube
     - Support pour tous les réseaux sociaux (YouTube, Facebook, Instagram, etc.)
     - Communication avec l'application DoulBrowser
     
     Note : Cette extension nécessite l'application DoulBrowser installée 
     sur votre ordinateur pour fonctionner.
     ```

   ### Images
   - Téléversez les icônes (déjà présentes)
   - Ajoutez au moins 1 capture d'écran montrant l'extension en action
   - Optionnel : Bannière promotionnelle

   ### Visibilité
   - **Publique** : Visible par tous (recommandé)
   - **Non répertoriée** : Accessible uniquement par lien
   - **Privée** : Uniquement pour votre organisation

4. **Soumettez pour révision**
   - Le processus de révision prend généralement 1-3 jours ouvrables
   - Vous recevrez un email une fois l'extension approuvée ou si des modifications sont nécessaires

## ⚠️ Points Importants

### Permissions
Votre extension demande plusieurs permissions. Assurez-vous de justifier chacune dans la description :
- `webRequest` : Pour intercepter les téléchargements
- `downloads` : Pour détecter les téléchargements
- `host_permissions` : Pour fonctionner sur tous les sites web

### Politique de Confidentialité
Si votre extension collecte des données, vous devez fournir une URL vers votre politique de confidentialité.

### Limitations
- L'extension nécessite l'application DoulBrowser installée
- Mentionnez cela clairement dans la description
- Considérez ajouter une vérification de connexion dans l'extension

## 🔄 Mises à Jour Futures

Pour mettre à jour l'extension :
1. Modifiez le numéro de version dans `manifest.json`
2. Créez un nouveau ZIP
3. Allez dans votre tableau de bord Chrome Web Store
4. Cliquez sur votre extension
5. Cliquez sur "Nouvelle version"
6. Téléversez le nouveau ZIP

## 📝 Checklist Avant Publication

- [ ] Manifest.json avec toutes les informations
- [ ] Toutes les icônes présentes (16, 48, 128)
- [ ] Extension testée sur plusieurs sites
- [ ] Description claire et complète
- [ ] Au moins 1 capture d'écran
- [ ] Politique de confidentialité (si nécessaire)
- [ ] ZIP créé sans fichiers inutiles
- [ ] Version testée localement

## 🎯 Conseils

1. **Testez bien** avant de publier
2. **Description claire** : Expliquez ce que fait l'extension
3. **Images de qualité** : Les captures d'écran aident les utilisateurs
4. **Support** : Préparez-vous à répondre aux questions des utilisateurs
5. **Mises à jour** : Gardez l'extension à jour avec les changements de Chrome

## 📞 Support

Si vous avez des questions ou des problèmes :
- [Documentation Chrome Web Store](https://developer.chrome.com/docs/webstore/)
- [Forum des développeurs Chrome](https://groups.google.com/a/chromium.org/g/chromium-extensions)





