# Guide d'Automatisation des Ventes DoulGet
(Chariow / Système.io + Supabase)

Ce guide explique comment configurer l'envoi automatique des clés de licence après un achat.

## 1. Préparation sur Supabase

Vous devez déployer la fonction logicielle que j'ai créée pour vous.

### Étapes :
1. Connectez-vous à votre [Dashboard Supabase](https://supabase.com/dashboard).
2. Allez dans l'onglet **Edge Functions** (icône en forme d'éclair dans la barre latérale gauche).
3. Cliquez sur **Create a new function** et nommez-la `generate-license`.
4. Copiez et collez le code du fichier : `supabase/functions/generate-license/index.ts`.
6. Déployez la fonction. Supabase vous fournira une **URL de fonction** (ex: `https://xxxx.supabase.co/functions/v1/generate-license`).

---

### ⚠️ IMPORTANT : Mise à jour de la Table `licences`
Pour que le script puisse enregistrer l'email de vos clients, vous devez ajouter une colonne à votre table.
1. Allez dans le **SQL Editor** de votre projet Supabase.
2. Cliquez sur **New Query** et collez ceci :
```sql
ALTER TABLE licences 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
```
3. Cliquez sur **Run**.

---

## Configuration Multi-Tarifs (Abonnements)

Pour gérer automatiquement les différentes durées (1 mois, 1 an, Vie), vous devez simplement modifier l'URL du Webhook dans Chariow pour chaque produit.

### 1. Créer vos produits dans Chariow
Créez 3 produits distincts dans votre boutique Chariow :
- **Abonnement 1 Mois** (2,99$)
- **Abonnement 1 An** (14,99$)
- **Accès à Vie** (29,99$)

### 2. Configurer les Webhooks spécifiques
Dans les paramètres de **chaque produit**, ajoutez un Webhook vers votre adresse Supabase en ajoutant le paramètre `?duration=` à la fin :

- **Pour l'abonnement 1 mois** :
  `https://xxxx.supabase.co/functions/v1/generate-license?duration=month`
- **Pour l'abonnement 1 an** :
  `https://xxxx.supabase.co/functions/v1/generate-license?duration=year`
- **Pour l'accès à vie** :
  `https://xxxx.supabase.co/functions/v1/generate-license?duration=lifetime`

### 3. Comment ça marche ?
Le script lit l'URL. S'il voit `duration=month`, il ajoute 30 jours à la date actuelle. S'il voit `lifetime`, il ajoute 99 ans.

---

## Accès au Logiciel
Le logiciel nécessite désormais une **clé de licence valide** dès la première ouverture. Il n'y a plus de période d'essai automatique. Les utilisateurs doivent acheter un abonnement (1 mois, 1 an ou Vie) pour accéder aux fonctionnalités de DoulGet.

---

## 2. Configuration sur Chariow

Une fois que votre fonction Supabase est en ligne :

1. Allez sur votre compte **Chariow**.
2. Sélectionnez votre produit (DoulGet).
3. Allez dans l'onglet **Webhooks** ou **Intégrations**.
4. Ajoutez un nouveau Webhook :
   - **URL** : Collez l'URL de votre fonction Supabase.
   - **Événement** : Sélectionnez "Achat Réussi" (Sale/Order completed).
5. Dans la section **Email de livraison** de Chariow :
   - Vous pouvez utiliser des variables comme `{license_key}` si Chariow supporte la lecture de la réponse du Webhook.
   - Sinon, le script enregistre l'email du client dans Supabase, vous pourrez donc lui renvoyer manuellement ou via une automatisation email.

---

## 3. Configuration sur Système.io

Si vous vendez directement sur Système.io sans passer par Chariow :

1. Allez dans votre **Tunnel de vente**.
2. Allez dans les **Règles d'automatisation** de votre page de paiement.
3. Ajoutez une action : **Envoyer un Webhook**.
4. Collez l'URL de votre fonction Supabase.
5. Système.io enverra les données du client (nom, email) à la fonction qui générera la clé.

---

## 4. Test du système

Pour tester sans faire un vrai achat :
1. Utilisez un outil comme **Postman**.
2. Envoyez une requête **POST** à votre URL Supabase avec ce corps JSON :
   ```json
   {
     "customer_email": "test@gmail.com",
     "product_name": "DoulGet Pro"
   }
   ```
3. Vérifiez dans votre table `licences` sur Supabase si une nouvelle ligne avec un HWID commençant par `B-` est apparue.

---

## Pourquoi ce système est sûr ?
Même si un pirate découvre l'URL de votre fonction, il ne pourra pas activer le logiciel indéfiniment car :
1. Chaque clé générée consomme un emplacement dans votre base de données.
2. La clé se "verrouille" sur le premier PC qui l'utilise.
3. Vous pouvez bloquer n'importe quelle clé suspecte d'un clic sur Supabase.
