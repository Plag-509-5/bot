# 🐉 KAIDO-MD — WhatsApp Multi-Device Bot & Dashboard

> Bot WhatsApp multi-device ultra-rapide, modulaire et puissant avec tableau de bord web intégré, support multi-sessions, gestionnaires de médias, intelligence artificielle et système de plugins avec **rechargement à chaud automatique en temps réel**.

---

## 🚀 Fonctionnalités Principales

- **⚡ Multi-Sessions & Multi-Device :** Connexion de plusieurs numéros WhatsApp simultanément via code de pairing sans scan QR.
- **🔄 Reconnexion Automatique :** Gestion intelligente des déconnexions réseau temporaires sans perte de session.
- **🔥 Hot-Reload Automatique :** Dès que vous ajoutez, modifiez ou supprimez un fichier dans `src/plugins/`, il est rechargé instantanément en mémoire sans redémarrer le bot ni taper de commande !
- **⛩ Thèmes par session :** `.changetheme 1` restaure le style classique et `.changetheme 2` active Onigashima; le choix est conservé dans MongoDB après redémarrage. Toutes les réponses de commandes utilisent automatiquement une citation de contact **Meta AI** comme habillage.
- **🛡️ Sudo par session :** `.sudo <numéro>`, `.delsudo <numéro>` et `.listsudo` délèguent les commandes privilégiées sans affecter les autres sessions.
- **🌐 Tableau de Bord Web Complet :**
  - Gestion des sessions actives et archivées (`/dashboard/sessions.html`).
  - Gestion des newsletters WhatsApp et auto-réactions (`/dashboard/newsletters.html`).
  - Gestion des administrateurs (`/dashboard/admins.html`).
  - Statut en temps réel et métriques système (`/dashboard/active.html`).
- **🛡️ Sécurité & Modération de Groupe :**
  - **Anti-Link :** Suppression automatique des liens externes indésirables.
  - **Anti-Delete :** modes privé/groupe/tout, prise en charge des chats LID, récupération directe des médias et identification du véritable suppresseur avec le nom de la conversation.
  - **Anti-Status Mention :** Avertissement et expulsion en cas de spam de mentions.
  - **Bienvenue / Au revoir :** Messages personnalisés pour les nouveaux membres.
- **📥 Téléchargeurs Multimédia :**
  - YouTube (MP3 & Vidéo MP4 HD)
  - TikTok (Sans filigrane / No Watermark)
  - Instagram (Reels, Vidéos, Carrousels)
  - Facebook (Vidéos HD/SD)
- **🧠 Intelligence Artificielle :** Assistant IA conversationnel intégré (`.ai`, `.gpt`).
- **🛠️ Outils & Utilitaires :**
  - Recherche d’images pertinente avec Pexels (clé facultative) et Openverse en fallback sans clé (`.img`).
  - **Sticker/Emoji to Command (`.setcmd`) :** chaque session possède ses propres alias persistants dans MongoDB; un même sticker ou emoji peut donc lancer des commandes différentes selon la session.
  - **Statuts personnels (`.tostatus`) :** publie texte, photo, vidéo ou audio sur `status@broadcast` avec une audience réglable par session (`.setstatusviewers`) et `.delstatus` pour retirer la dernière publication suivie. L’audio est converti en vidéo verticale stylisée, avec le branding Toumaï.
  - **Statuts de groupe (`.swgc`, alias `.gcstatus`) :** le propriétaire choisit le groupe cible en privé, puis publie texte/image/vidéo/audio via `groupStatusMessageV2` sans confirmation dans le chat du groupe. Les textes ont une palette sombre personnalisée et une police WhatsApp plus élégante; les audios deviennent une vidéo animée avec waveform, police Poppins et signature « MUGIWARA NO PLAG • DEVELOPER DE KAIDO MD ».
  - Création de Stickers statiques et animés (`.s`, `.sticker`).
  - Traducteur multilingue avec détection automatique (`.tr`, `.translate`).
  - Capture d'écran de pages web en direct (`.ssweb`).
  - Téléversement de fichiers vers lien direct avec fallback automatique Uguu/Catbox/0x0.st/TmpFiles (`.tourl`).
  - Générateur de polices stylisées (`.fancy`).
  - Jeux interactifs : Morpion rétro (`.ttt`, `.delttt`).

---

## 📁 Structure du Projet

```text
├── index.js                       # Serveur Express
├── package.json                   # Baileys officiel, NYXCORE + scripts
├── .env.example                   # Configuration documentée
├── src/
│   ├── core/pair.js               # Sockets, pairing et API
│   ├── db/mongo-connection.js     # Connexion MongoDB unique + ping
│   ├── auth/
│   │   ├── auth-utils.js          # Validation des creds et numéros
│   │   ├── mongo-auth-state.js    # Auth Baileys 100 % MongoDB
│   │   ├── mongo-auth-backend.js  # Codec BufferJSON + collections auth
│   │   ├── reconnect.js           # Reconnexion avec backoff
│   │   ├── pairing-guard.js       # Verrou d'appairage
│   │   └── session-purge.js       # Purge MongoDB ciblée
│   ├── handlers/ features/ services/ lib/
│   └── plugins/                   # Commandes rechargées à chaud
├── scripts/
│   ├── check-mongodb.js           # `npm run mongo:check`
│   └── check-syntax.js
├── dashboard/
└── test/
```

Il n'existe plus de répertoire `sessions/` utilisé à l'exécution. Les fichiers
temporaires créés pour traiter des médias ne contiennent jamais l'état
d'authentification WhatsApp.

---

## 🔐 Sessions exclusivement dans MongoDB

Les sessions, l’authentification MongoDB et les sockets principaux du bot
utilisent le paquet officiel **`@whiskeysockets/baileys`** (version épinglée
`7.0.0-rc14`), sans alias ni fork. Le plugin `.swgc` / `.gcstatus` utilise aussi
**`@nyxcore/nyxcoresocket`** (`^0.3.2`) pour ses helpers de téléchargement et de
génération des messages de statut.

La méthode `sendGroupStatus()` de NYXCORE n’existe que sur les sockets produits
par sa propre factory. Pour conserver les sessions actives du projet et éviter
d’ouvrir une seconde connexion WhatsApp, le plugin installe un petit adaptateur
`sendGroupStatus()` sur le socket Baileys existant : NYXCORE prépare le message,
puis ce même socket assure le téléversement média et le relay. Le relay officiel
RC14 ne déballait pas `groupStatusMessageV2` avant de calculer `mediatype`; la
trame média partait donc sans son type et WhatsApp pouvait l’ignorer sans que
l’appel de relay échoue. Le correctif ciblé et idempotent s’applique à
l’installation et avant `npm start`; il déplie l’enveloppe avant cette détection,
comme le fait NYXCORE.
Les deux paquets sont donc déclarés volontairement. `package.json` force
`libsignal` sur le commit officiel via `overrides`.

MongoDB est l'unique source de vérité :

| Collection | Contenu |
| --- | --- |
| `sessions` | Une entrée de creds par numéro, encodée avec le `BufferJSON` officiel de Baileys |
| `session_keys` | Une entrée par clé Signal (`pre-key`, `session`, `sender-key`, `app-state-sync-key`, etc.) |
| `numbers` | Les numéros dont l'appairage a réellement abouti et qui doivent être restaurés au démarrage |

Les creds et clés sont écrits en **write-through** : une mutation n'est validée
en mémoire qu'après acquittement de MongoDB. Si la base est indisponible, le bot
refuse de créer un code d'appairage au lieu de basculer silencieusement vers un
fichier local. Au démarrage, seules les sessions listées dans MongoDB sont
restaurées.

Le codec BufferJSON conserve exactement les `Buffer`/`Uint8Array` attendus par
Signal. Les anciens documents contenant directement les champs `creds` et
`value` sont lus puis migrés automatiquement au premier chargement. En revanche,
une ancienne session qui ne possède pas ses clés Signal dans `session_keys` doit
être appairée une nouvelle fois.

Pour valider la connexion, les droits et les index avant de démarrer :

```bash
npm run mongo:check
```

La commande effectue un vrai `ping` et crée/vérifie les index uniques utilisés
par les sessions sans afficher l'URI ni le mot de passe.

**Diagnostic en direct** : `GET /api/session/health` (dashboard authentifié)
indique `stockageSessions: "mongodb"`, l'état de la connexion, le nombre de clés
Signal, les écritures en attente et l'état de chaque websocket.

---

## 🔁 Appairage et purge fiable

- Un socket en attente de code reste séparé des sockets actifs.
- Un verrou par numéro empêche deux pairings ou deux ratchets concurrents.
- Un appairage abandonné supprime les creds, les clés Signal et le numéro dans
  MongoDB ; aucune trace locale n'est créée.
- La purge attend d'abord les écritures déjà parties avant de supprimer les
  documents, afin qu'une écriture tardive ne ressuscite pas la session.
- Une erreur MongoDB renvoie explicitement `503 mongodb_indisponible` ou
  `mongodb_purge_failed` ; le dashboard ne présente jamais un faux succès.
- `force=1` détruit proprement l'ancienne tentative avant de demander un nouveau
  code.
- Le code n'est demandé qu'après le stanza `pair-device` de WhatsApp et une
  seule fois par socket : une reconnexion interne ne peut donc pas remplacer en
  arrière-plan le code que l'utilisateur est en train de saisir.
- `pair-success` est suivi normalement d'une fermeture **515
  `restartRequired`**. Le bot acquitte d'abord les creds/clefs MongoDB, marque
  `isNewLogin`, puis ouvre immédiatement un nouveau socket interne sans compter
  ce redémarrage comme une panne. Le verrou reste fermé aux requêtes externes
  jusqu'à `connection=open`, afin qu'aucun second code n'écrase le premier. Il ne faut pas attendre
  `connection=open` sur le premier socket : cet événement arrive sur le second.
- Les coupures d'une session valide utilisent le backoff ; un logout/état auth
  définitivement invalide est supprimé, tandis qu'une connexion `440` remplacée
  est arrêtée sans effacer MongoDB.

### Version et identité du client WhatsApp

Baileys `7.0.0-rc14` contient une révision WhatsApp Web figée qui peut devenir
obsolète avant la prochaine publication npm. Avant de créer un socket, le bot
utilise donc `fetchLatestWaWebVersion()` (source directe
`web.whatsapp.com/sw.js`). La valeur live est partagée par toutes les sessions et
mise en cache ; si un refresh réseau échoue, une reconnexion conserve la dernière
bonne révision au lieu de redescendre silencieusement vers le fallback embarqué.

Le navigateur est construit avec `Browsers.ubuntu('Chrome')`. Ce tuple produit
les libellés canoniques `Chrome (Ubuntu)` exigés plus strictement par le flux
pairing-code ; l'ancien troisième champ artisanal `20.0.04` n'est plus utilisé.
`markOnlineOnConnect` ne participe pas au handshake d'appairage (Baileys ne le
consulte qu'après `connection=open`) et reste donc piloté par `AUTO_ONLINE`.

Si l'hébergeur bloque exceptionnellement la lecture de `sw.js`, définir
`WA_WEB_VERSION=2.3000.xxxxxxxxxx` avec une révision actuelle. Laisser la variable
vide est le mode recommandé. `GET /api/session/health` affiche la source/version,
le navigateur et les phases `pairing-ready`, `pairing-code-issued`,
`pair-success`, `connection-closed` et `auth-flushed`, sans exposer le code ni les
clés.

---

## 📋 Copie du code d'appairage

`navigator.clipboard` n'existe **que dans un contexte sécurisé** (HTTPS ou
`localhost`). Servi en HTTP simple — IP:port, domaine sans TLS, iframe de
prévisualisation — `navigator.clipboard` vaut `undefined`, et
`navigator.clipboard.writeText(...)` levait une `TypeError`. Comme `copyCode()`
était `async` et appelée depuis un `onclick` inline, l'erreur devenait un rejet
de promesse non géré : **rien n'était copié et aucun retour visuel
n'apparaissait**.

`dashboard/assets/copy-code.js` (servi publiquement sur `/assets/`, partagé par
`/` et `/pair`) essaie trois niveaux :

1. **Clipboard API** — contexte sécurisé ;
2. **`execCommand('copy')`** sur un textarea temporaire hors flux — HTTP simple,
   vieux navigateurs, iframe (avec `setSelectionRange` pour iOS Safari) ;
3. **sélection du texte** + message « Ctrl+C pour copier » — dernier recours.

`copyText()` ne lève jamais d'erreur : elle renvoie toujours
`{ copied, method, error }`, donc l'interface affiche un retour dans tous les
cas. `bindCodeCopy()` ajoute le clic, le clavier (Entrée/Espace) et les attributs
d'accessibilité (`role`, `tabindex`).

`readCode()` lit `data-code` en priorité : le texte affiché peut être
transformé (« Code Copié ! »), l'attribut reste la valeur exacte. `main.html`
n'écrivait plus le code dans un attribut et copiait donc parfois le libellé
`Indisponible` au lieu d'un code.

---

## ⚙️ Installation & Démarrage

### 1. Prérequis
- **Node.js** >= 22.12 (interop CommonJS avec le paquet ESM de Baileys 7)
- **FFmpeg** (pour la conversion audio/vidéo et stickers)
- **MongoDB** (cluster local ou MongoDB Atlas) accessible en permanence

### 2. Cloner le dépôt et installer les dépendances
```bash
git clone https://github.com/Plag-509-5/bot.git
cd bot
npm install
```

### 3. Configuration de l'environnement
Copiez le fichier `.env.example` en `.env` :
```bash
cp .env.example .env
```
Modifiez les variables dans `.env` :
```env
PORT=3000
BOT_NAME=KAIDO-MD
OWNER_NUMBER=50947440869
PREFIX=.
# Obligatoire : accès au dashboard par mot de passe uniquement
ADMIN_PASS=un-mot-de-passe-long-et-aleatoire
# Obligatoire : unique stockage des sessions WhatsApp
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net
MONGO_DB=MUGIWARA_NO_PLAG

# Facultatif : le mode normal récupère et met en cache la version live.
# À renseigner seulement si web.whatsapp.com/sw.js est bloqué.
WA_WEB_VERSION=

# Requis uniquement pour importer un pack avec .tgs
# Créez gratuitement un bot avec @BotFather puis collez son token ici.
TELEGRAM_BOT_TOKEN=

# Facultatif : APIs de téléchargement personnalisées
FACEBOOK_DOWNLOADER_API=https://fdown.isuru.eu.org
COBALT_API_URLS=https://rue-cobalt.xenon.zone,https://cobaltapi.cjs.nz
COBALT_API_KEY=

# Facultatif : photos Pexels prioritaires pour `.img`.
# Sans clé, `.img` utilise automatiquement Openverse.
PEXELS_API_KEY=

# Facultatif : durée/quota antidelete et limites de .tourl
ANTIDELETE_STORE_MAX=1500
ANTIDELETE_RETENTION_MS=86400000
TOURL_MAX_BYTES=104857600
TOURL_TIMEOUT_MS=60000
CATBOX_USER_HASH=
```

> La page publique `t.me/addstickers/...` ne contient plus les fichiers `.tgs`. La commande `.tgs` utilise donc l’API officielle Telegram (`getStickerSet` puis `getFile`), ce qui nécessite `TELEGRAM_BOT_TOKEN`. Le token reste côté serveur et n’est jamais envoyé dans les messages ou les logs d’erreur.

### 4. Tester MongoDB puis lancer le bot
```bash
npm run mongo:check
npm start
```

N'essaie pas d'appairer un numéro tant que `mongo:check` n'affiche pas
`MongoDB accessible`. Il n'existe volontairement aucun mode session locale.

Le serveur démarrera sur `http://localhost:3000` :
- **Page de pairing :** `http://localhost:3000/pair`
- **Dashboard :** `http://localhost:3000/dashboard`

Le dashboard demande uniquement `ADMIN_PASS` — aucun nom d’utilisateur. Les pages et les API de gestion sont protégées par un cookie signé, `HttpOnly` et `SameSite=Strict`. Si `ADMIN_PASS` est absent, l’accès administratif est refusé plutôt que d’utiliser un mot de passe par défaut.

Les admins saisis dans le dashboard sont normalisés en `numéro@s.whatsapp.net`; le bot reconnaît aussi les anciens formats MongoDB et les identités WhatsApp LID lorsque le numéro alternatif est disponible. Une chaîne ajoutée depuis le dashboard est enregistrée avec les mêmes emojis que `.cfn`, puis suivie immédiatement par toutes les sessions actives.

### AntiDelete

- `.ad p` surveille uniquement les discussions privées, y compris celles identifiées par un JID `@lid`.
- `.ad g` surveille uniquement les groupes; `.ad all` active les deux modes et `.ad off` désactive la fonction.
- L’alerte indique la personne qui a réellement envoyé la révocation, l’auteur original s’il est différent, puis le nom du contact ou du groupe.
- Images, vidéos, audios, documents, stickers et médias à vue unique sont téléchargés puis renvoyés directement. Le store conserve les métadonnées 24 heures par défaut au lieu d’être vidé toutes les 20 minutes.

`.tourl` essaie les hébergeurs l’un après l’autre. Une erreur Catbox telle que HTTP 412 déclenche automatiquement le fournisseur suivant plutôt que d’interrompre la commande.

### Statut de groupe privé avec `.swgc` / `.gcstatus`

1. Le propriétaire du bot envoie `.swgc` (ou `.gcstatus`) au bot en conversation privée.
2. Il répond avec le numéro du groupe affiché; le choix expire après cinq minutes.
3. Il publie avec `.swgc ton texte, violet` (ou `.gcstatus`) ou répond à une image, vidéo ou note audio avec la commande.
4. Pour le fond d’un statut texte, utilisez une couleur (`violet`, `bleu nuit`, `cyan`, `rose`, `or`, `noir`, `blanc`, etc.) ou un hexadécimal (`#6f42c1`). Sans couleur, un fond sombre est tiré de la palette KAIDO.

Les audios sont convertis en MP4 vertical animé: waveform cyan, progression violette, curseur or, chronomètre et signature « MUGIWARA NO PLAG — DEVELOPER DE KAIDO MD », composée avec Poppins SemiBold. Le plugin utilise `@nyxcore/nyxcoresocket` pour télécharger/générer le contenu et le publie dans `groupStatusMessageV2` par le socket Baileys de la session, sans connexion WhatsApp supplémentaire. La caption déjà présente sur une image ou une vidéo citée est conservée. Les listes, erreurs et confirmations restent dans la conversation privée.

Le résolveur essaie `FFMPEG_PATH` s’il est défini, puis `ffmpeg-static` et enfin `ffmpeg` système. Si aucun binaire n’inclut `drawtext`, installez FFmpeg avec `libfreetype` ou configurez `FFMPEG_PATH` vers un binaire compatible.

### Statut personnel avec `.tostatus`

Le propriétaire du bot ou de la session publie dans son statut WhatsApp personnel en utilisant **le socket Baileys/NYXCORE déjà connecté** : aucune deuxième connexion n’est ouverte.

```text
.tostatus Bonjour tout le monde
```

Pour un média, réponds à une photo, une vidéo ou un audio avec `.tostatus`; la caption du média est conservée et peut être remplacée par du texte ajouté à la commande. Les audios et notes vocales sont convertis en MP4 vertical animé, avec la carte visuelle « LE SEIGNEUR DES APPAREILS — PÈRE FONDATEUR DE TOUMAÏ MD ».

L’audience est enregistrée **par session** dans MongoDB :

```text
.setstatusviewers 509XXXXXXXX, 509YYYYYYYY
.statusviewers
.setstatusviewers clear
.delstatus
```

- Une liste personnalisée ne distribue le statut qu’aux numéros indiqués, plus le compte qui le publie.
- Sans liste personnalisée, le bot utilise son carnet de contacts lorsqu’il en a un; sinon, il prend les participants des groupes auxquels la session est inscrite. `.statusviewers` affiche l’état actuel.
- `.delstatus` retire le statut le plus récent publié par `.tostatus` pendant que son journal temporaire est disponible. Le journal est gardé en mémoire pendant 24 heures; il ne permet donc pas de retrouver les statuts publiés avant le démarrage courant ou par une autre application.
- Les publications sont envoyées à `status@broadcast` avec `statusJidList`; le contenu et les confirmations privées ne sont pas renvoyés dans le chat du groupe. Une commande lancée depuis un groupe reçoit sa réponse en message privé.

---

## 📴 Présence et mode sans préfixe

Chaque session peut être configurée directement dans WhatsApp par le propriétaire :

```text
.config alwaysonline on
.config alwaysonline off
.config setprefix !
.config setprefix off
.mode public
.mode private
.changetheme 1
.changetheme 2
.sudo 509XXXXXXXX
.delsudo 509XXXXXXXX
```

- `alwaysonline on` garde la présence du compte disponible.
- `alwaysonline off` applique la présence `unavailable`. Un message ordinaire est ignoré sans appel à `readMessages`; une commande reconnue est marquée comme lue, réveille temporairement le bot, puis celui-ci repasse hors ligne.
- `setprefix off` enregistre un préfixe vide. Dans ce mode, le bot examine uniquement le premier mot : `menu` est exécuté, tandis que `bonjour menu` ou un mot inconnu sont ignorés silencieusement.
- Pour réactiver le point depuis le mode sans préfixe : `config setprefix .`.
- `.mode public|private` est enregistré par numéro de session et restauré après redémarrage.
- `.changetheme 1` utilise les réponses classiques; `.changetheme 2` applique Onigashima. Le menu et `.ping` suivent immédiatement le choix de chaque session.
- `.sudo`, `.delsudo` et `.listsudo` gèrent une liste persistante d’opérateurs propre à chaque session.
- `.config show` affiche les valeurs actives de la session, y compris le mode, le thème et le nombre de sudo.

> **Limite WhatsApp :** un seul coche signifie que le message n’a pas encore été livré au compte/appareil connecté. Le bot doit recevoir le message pour savoir si son premier mot est une commande; il ne peut donc pas garantir un seul coche tout en effectuant cette détection. En mode OFF, il évite l’accusé de **lecture** des textes ordinaires, mais WhatsApp peut tout de même afficher deux coches grises de livraison. Les coches bleues dépendent aussi des réglages de confidentialité WhatsApp.

---

## 🔌 Ajouter un Plugin (Rechargement 100% Automatique)

Pour ajouter une nouvelle commande, créez simplement un fichier `.js` dans `src/plugins/` (ou un sous-dossier) :

```javascript
// src/plugins/general/bonjour.js
module.exports = {
  name: 'bonjour',
  alias: ['salut', 'hello'],
  category: 'general',
  description: 'Répond avec un message de bienvenue',
  usage: '.bonjour',
  isGroup: false,      // true si réservé aux groupes
  isAdmin: false,      // true si réservé aux admins du groupe
  isOwner: false,      // true si réservé au propriétaire
  async execute({ socket, msg, from, senderNumber, args, prefix }) {
    await socket.sendMessage(from, {
      text: `👋 Bonjour @${senderNumber} ! Comment puis-je vous aider aujourd'hui ?`,
      mentions: [msg.key.participant || from]
    }, { quoted: msg });
  }
};
```

Dès l'enregistrement du fichier, le bot **détecte automatiquement la modification et applique les changements instantanément sans avoir besoin de taper `.reload` ni de redémarrer le serveur !**

---

## 📜 Licence & Crédits
- **Auteur :** Mugiwara no plag & Tech Mondial Dev Team
- **Licence :** MIT
