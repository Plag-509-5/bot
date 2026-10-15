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
  - **Anti-Status Mention :** désactivé par défaut; lorsqu’il est activé, les avertissements sont présentés dans le style Kaido MD et les sanctions suivent le mode configuré.
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
  - **Statuts personnels (`.tostatus`) :** publie texte, photo, vidéo ou audio sur `status@broadcast`; gère l’audience par session avec `.setstatusviewers`, `.tostatus new group`, `.tostatus add` et `.tostatus export`. `.delstatus` retire la dernière publication suivie. Les statuts audio utilisent un cadre illustré Kaido, une waveform animée et la marque « Kaido-MD — Développeur : PlagTech ».
  - **Statuts de groupe (`.swgc`, alias `.gcstatus`) :** en privé, le propriétaire choisit le groupe cible; dans un groupe ouvert, tous les membres peuvent publier directement sur son statut et reçoivent la confirmation dans ce groupe. Dans un groupe admin-only, le compte du bot doit être administrateur. Les textes ont une palette sombre personnalisée; les audios utilisent le même cadre Kaido, la même waveform et la même marque que `.tostatus`.
  - Création de Stickers statiques et animés (`.s`, `.sticker`).
  - Traducteur multilingue avec détection automatique (`.tr`, `.translate`).
  - Capture d'écran de pages web en direct (`.ssweb`).
  - Téléversement de fichiers vers lien direct avec fallback automatique Uguu/Catbox/0x0.st/TmpFiles (`.tourl`).
  - Générateur de polices stylisées (`.fancy`).
  - Jeu de morpion multijoueur (`.ttt @joueur`, ou `.ttt` en répondant à un message) : les joueurs répondent avec le numéro d’une case (1–9); tours, mentions, victoires, défaites et matchs nuls sont gérés automatiquement. `.delttt` annule la partie.

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
`7.0.0-rc14`), sans alias ni fork. Les plugins `.swgc` / `.gcstatus` et
`.tostatus` utilisent aussi **`@nyxcore/nyxcoresocket`** (`^0.3.2`) pour les
helpers de téléchargement/génération des statuts.

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

# Keepalive WhatsApp par session; valeurs par défaut : 30 s / 90 s.
SESSION_KEEPALIVE_INTERVAL_MS=30000
SESSION_STALE_AFTER_MS=90000

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
ANTIDELETE_STORE_MAX=400
ANTIDELETE_RETENTION_MS=86400000
TOURL_MAX_BYTES=104857600
TOURL_TIMEOUT_MS=60000
CATBOX_USER_HASH=
```

Chaque socket Baileys envoie déjà une **IQ ping-pong toutes les 30 secondes** via sa connexion WhatsApp existante. Le watchdog vérifie le vrai état `isOpen` de chaque session toutes les 30 secondes; si un socket reste fermé 90 secondes, il ne relance que cette session avec l’ordonnanceur de reconnexion existant. Les sockets sains ne sont pas redémarrés toutes les heures : cela provoquerait des interruptions et des reconnexions simultanées sans bénéfice par rapport au keepalive natif.

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
- Images, vidéos, audios, documents, stickers et médias à vue unique sont téléchargés puis renvoyés directement. Le store conserve les métadonnées 24 heures par défaut; il ne collecte rien quand `.ad` est désactivé et qu’aucune commande réaction n’en a besoin, et reste borné à 400 messages par session (maximum configurable plafonné à 500).

`.tourl` essaie les hébergeurs l’un après l’autre. Une erreur Catbox telle que HTTP 412 déclenche automatiquement le fournisseur suivant plutôt que d’interrompre la commande.

### Statut de groupe avec `.swgc` / `.gcstatus`

- **En privé :** le propriétaire envoie `.swgc` au bot, choisit le groupe dans la liste, puis publie avec `.swgc ton texte, violet` ou en répondant à une image, une vidéo ou une note audio. La sélection expire après cinq minutes; les listes, erreurs et confirmations restent dans le chat privé.
- **Depuis un groupe :** tout membre autorisé à écrire dans le groupe envoie `.swgc ton texte, violet` (ou répond à un média avec `.swgc`). Le statut est publié sur le statut de ce même groupe, et les confirmations/erreurs répondent dans le groupe, jamais en privé. Ce mode reste autorisé pour `.swgc` et ses alias même si la session est en `MODE=private`.
- **Groupe fermé (`announce` / admin-only) :** le compte WhatsApp connecté au bot doit être administrateur du groupe pour publier le statut. Si le bot n’est pas admin, WhatsApp bloque le relay; `.swgc` l’indique au lieu de prétendre que la publication a réussi. Les membres qui ne peuvent pas écrire dans le groupe ne peuvent pas y envoyer la commande; un propriétaire peut utiliser le sélecteur privé.
- Pour le fond d’un statut texte, utilisez une couleur (`violet`, `bleu nuit`, `cyan`, `rose`, `or`, `noir`, `blanc`, etc.) ou un hexadécimal (`#6f42c1`). Sans couleur, un fond sombre est tiré de la palette KAIDO.

Les audios sont convertis en MP4 vertical animé sur le cadre illustré Kaido (Kaido à gauche, dragon à droite), avec waveform cyan, progression violette, curseur or, chronomètre, police Poppins SemiBold et signature « Kaido-MD — Développeur : PlagTech ». `.tostatus` et `.swgc` partagent ce visuel et cette marque. Le plugin utilise `@nyxcore/nyxcoresocket` pour télécharger/générer le contenu et le publie dans `groupStatusMessageV2` par le socket Baileys de la session, sans connexion WhatsApp supplémentaire. La caption déjà présente sur une image ou une vidéo citée est conservée.

Le MP4 de `.swgc` et `.tostatus` est généré sur le disque persistant du bot dans `./tmp/audio-status` par défaut, pas dans `/tmp` (souvent limité ou monté en mémoire). Il n’a pas de plafond artificiel de taille de sortie et est envoyé en flux; son répertoire temporaire est supprimé après le relay, y compris en cas d’échec. Configure `AUDIO_STATUS_TEMP_DIR` si le volume de données du VPS se trouve ailleurs. Les files et le nombre de conversions FFmpeg simultanées restent bornés pour protéger les autres sessions.

Le résolveur essaie `FFMPEG_PATH` s’il est défini, puis `ffmpeg-static` et enfin `ffmpeg` système. Si aucun binaire n’inclut `drawtext`, installez FFmpeg avec `libfreetype` ou configurez `FFMPEG_PATH` vers un binaire compatible.

### Statut personnel avec `.tostatus`

Le propriétaire du bot ou de la session publie dans son statut WhatsApp personnel en utilisant **le socket Baileys/NYXCORE déjà connecté** : aucune deuxième connexion n’est ouverte.

```text
.tostatus Bonjour tout le monde
```

Pour un média, réponds à une photo, une vidéo ou un audio avec `.tostatus`; la caption du média est conservée et peut être remplacée par du texte ajouté à la commande. Les audios et notes vocales sont convertis en MP4 vertical animé, avec la carte visuelle « LE SEIGNEUR DES APPAREILS — PÈRE FONDATEUR DE TOUMAÏ MD ».

Pour préserver la réactivité **de toutes les sessions**, les publications média partagent une file globale (2 actives, 4 en attente par défaut); image et vidéo reçues sont envoyées en flux bornés au lieu d’être copiées intégralement en RAM. L’audio est téléchargé vers un fichier temporaire, converti en MP4 puis envoyé en flux **sans plafond artificiel sur la taille du MP4 généré**. Les limites d’entrée audio/durée restent configurables avec `TOSTATUS_MAX_AUDIO_BYTES` et `TOSTATUS_MAX_AUDIO_SECONDS`; `TOSTATUS_MAX_MEDIA_BYTES` borne les médias reçus et le chemin de compatibilité Buffer. FFmpeg est limité à une conversion simultanée, un thread de rendu et 15 images/s pour ce statut. Le fichier et les flux sont nettoyés même si le relay échoue. Le dossier temporaire peut être choisi avec `AUDIO_STATUS_TEMP_DIR`. Les protections RAM/CPU et les files peuvent être ajustées avec `TOSTATUS_MEDIA_MAX_CONCURRENT`, `TOSTATUS_MEDIA_MAX_QUEUE`, `TOSTATUS_MAX_MEDIA_BYTES`, `TOSTATUS_MAX_AUDIO_BYTES`, `TOSTATUS_MAX_AUDIO_SECONDS`, `AUDIO_STATUS_MAX_INPUT_BYTES`, `AUDIO_STATUS_MAX_CONCURRENT` et `AUDIO_STATUS_MAX_QUEUE` (valeurs par défaut dans `.env.example`).

L’audience est enregistrée **par session** dans MongoDB :

```text
.setstatusviewers 509XXXXXXXX, 509YYYYYYYY
.tostatus new group
.tostatus add
.tostatus export
.statusviewers
.setstatusviewers clear
.delstatus
```

- `.tostatus new group` affiche les groupes communs avec le nombre de membres. Réponds avec un numéro : les numéros résolus du groupe s’ajoutent à l’audience déjà enregistrée, sans remplacer les groupes ou imports précédents. Les doublons sont ignorés. Les participants Baileys identifiés par LID sont convertis en numéro via le mapping disponible; les LID non résolus ne sont pas enregistrés et sont signalés.
- `.tostatus add`, en répondant à un message avec une liste de numéros, un fichier `.txt` ou une vCard / `.vcf`, ajoute les numéros détectés à la même audience. Le texte peut aussi être passé après `add`. Les fichiers importés sont limités à 1 Mio.
- `.tostatus export` envoie un fichier `.txt` avec les numéros de l’audience triés numériquement, un par ligne.
- Une liste personnalisée ne distribue le statut qu’aux numéros indiqués, plus le compte qui le publie.
- Sans liste personnalisée, le bot utilise son carnet de contacts lorsqu’il en a un; sinon, il prend les participants des groupes auxquels la session est inscrite. `.statusviewers` affiche l’état actuel.
- Au relay, Baileys convertit l’audience en PN ou en LID selon l’identité de la session, déduplique les JID et garde un mode d’adressage cohérent. Si un destinataire ne peut pas être résolu, la publication entière est annulée et les entrées à corriger sont signalées; les ack d’erreur WhatsApp reçus pendant le contrôle (dont 479) ne sont pas annoncés comme des réussites.
- `.delstatus` retire le statut le plus récent publié par `.tostatus` pendant que son journal temporaire est disponible, en réutilisant les JID et le mode d’adressage de la publication. Le journal est gardé en mémoire pendant 24 heures; il ne permet donc pas de retrouver les statuts publiés avant le démarrage courant ou par une autre application.
- NYXCORE construit le `WAMessage`, puis `relayMessage` du socket Baileys déjà connecté le publie à `status@broadcast` avec son `statusJidList`; le relay vérifie d’abord que la session WhatsApp est prête. Le contenu et les confirmations privées ne sont pas renvoyés dans le chat du groupe. Une commande lancée depuis un groupe reçoit sa réponse en message privé.
- `.save`, en répondant à un statut ou à un média éphémère, transfère le contenu dans le chat « Vous » du compte WhatsApp connecté.

### Transfert automatique des réponses aux statuts avec `.send`

Le propriétaire ou un opérateur de session peut activer le système, puis ajouter un ou plusieurs mots-clés. Les mots-clés s’ajoutent à la liste existante et sont enregistrés par session dans MongoDB.

```text
.send on
.send set voye
.send set envoie
.send status
.send off
```

Quand une personne répond au statut personnel du compte du bot avec l’un des mots-clés, le bot transfère ce statut original dans le chat privé de cette personne. Le système ne traite pas les réponses aux statuts d’autres comptes. `.send off` désactive le transfert sans supprimer les mots-clés; `.send remove <mot>` en retire un et `.send clear` efface la liste.

### Mise à jour depuis GitHub avec `.update`

```text
.update check
.update repos
.update repo Plag-509-5/bot
.update branches
.update branch main
.update status
.update apply
.update reset
```

`.update check` compare le commit installé au dépôt et à la branche sélectionnés, affiche les fichiers concernés et les branches disponibles sans modifier le clone. `.update` (application par défaut) et `.update apply` appliquent automatiquement le fast-forward en ne remplaçant que les fichiers touchés par les commits GitHub. Seuls le propriétaire du bot et le propriétaire de la session peuvent lancer ces commandes.

Configure `BOT_UPDATE_GITHUB_TOKEN` dans `.env` pour que le bot liste les dépôts accessibles (`.update repos`) et lise les dépôts privés. Utilise un token à privilèges minimaux, limité aux dépôts nécessaires et avec les permissions GitHub de métadonnées et de contenu en lecture. Le token n’est ni enregistré dans MongoDB ni affiché par le bot; ne l’envoie jamais dans WhatsApp. Les branches et dépôts publics peuvent être consultés sans token, sous réserve des limites d’API GitHub.

`.update repo <owner/repo>` vérifie l’accès au dépôt et sélectionne sa branche par défaut. `.update branches` liste ses branches; `.update branch <nom>` en choisit une. La sélection est partagée par le bot et persistée dans MongoDB. En l’absence de sélection enregistrée, `BOT_UPDATE_REPO` et `BOT_UPDATE_BRANCH` dans `.env` servent de valeurs par défaut; sans dépôt configuré, le remote Git `origin` est utilisé et la branche par défaut est `main`. `.update reset` efface la sélection persistée.

Le bot doit être installé depuis un **clone Git** dont `origin` pointe vers GitHub. L’application calcule le diff entre le commit installé et la cible, puis restaure uniquement les chemins ajoutés, modifiés, supprimés ou renommés dans ce diff avant d’avancer le pointeur Git en fast-forward. Un changement local sur un fichier également modifié par GitHub est remplacé; les changements locaux hors du diff et les fichiers non suivis tels que `.env` sont conservés. La commande affiche ces cas et ne fait jamais de `reset --hard`. Elle s’arrête si les historiques n’ont pas de base commune ou si les branches ont divergé.

Le détecteur Git autorise la découverte du dépôt à travers les frontières de systèmes de fichiers. Si le code est déployé ailleurs que dans le clone contenant `.git`, configure `BOT_REPO_PATH` avec le chemin absolu de la racine du clone (par exemple `/home/kaido`).

Après la mise à jour, redémarre le bot pour charger complètement les nouveaux modules. Si `package.json` ou le lockfile a changé, exécute aussi `npm install` avant le redémarrage. Le plugin ne redémarre pas le processus automatiquement.

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
