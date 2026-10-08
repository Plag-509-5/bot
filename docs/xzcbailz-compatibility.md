# Audit de compatibilité — xzcbailz 1.0.6

Vérification du 8 octobre 2026 sur Kaido MD.

## Verdict

**Compatible avec les interfaces du bot après les adaptations de cette branche.**
La dépendance `@whiskeysockets/baileys` pointe maintenant sur
`npm:xzcbailz@1.0.6` (version exacte, lockfile mis à jour).

**Ce n'est pas une garantie que toutes les commandes fonctionnent sur WhatsApp.**
Les tests utilisent le vrai fork, ses encodeurs protobuf, son chiffrement et les
handlers du bot, mais simulent le transport, les réponses serveur, les uploads
HTTP et les services externes. Aucun compte réel n'a été appairé ici : les hôtes
WhatsApp et les API tierces ne sont pas accessibles dans cet environnement.

## Résultats

- **250 tests passent**, sans échec ni test ignoré, sur **Node 22.22.3** et
  **Node 20.19.0**.
- Vérification de syntaxe : **104/104 fichiers JavaScript**.
- Inventaire AST : **13 exports Baileys** et **28 noms de méthodes socket**
  utilisés par le code inspectés. Les helpers facultatifs sont protégés par
  des gardes et des replis ; `downloadMediaMessage` est ajouté par le bot.
- **31 plugins**, **140 noms/alias de plugins**, **138 cases du switch principal**,
  soit **234 noms de commandes/alias distincts** : chargement et routage vérifiés
  avec `.`, `!` et sans préfixe. Cela ne représente pas 234 exécutions en ligne.

| Fonction | Validation locale | Ce qui reste à vérifier en ligne |
| --- | --- | --- |
| Code d'appairage | 8 caractères aléatoires ; construction et déchiffrement de la clé publique d'appairage ; événement `creds.update` ; écriture disque ; erreur sur connexion fermée | Acceptation du code sur le téléphone et établissement de la session |
| Sessions et redémarrage | Buffer/Uint8Array/BSON restaurés ; clés Signal persistées ; reconstruction protobuf des clés app-state ; socket créé depuis l'état restauré | Synchronisation réelle, reprise du ratchet et compatibilité des anciennes sessions enregistrées |
| Réactions newsletter | Vrai post décodé par le fork ; stanza de réaction avec `server_id` ; retrait de réaction ; lots, ordre des emojis, retries et déduplication | Réaction visible sur un vrai post, droits du compte, restrictions et limites WhatsApp |
| Follow / unfollow / métadonnées | Construction et traitement des requêtes mex du fork, réponses serveur simulées | Validité actuelle des requêtes côté WhatsApp et accès à la chaîne |
| `.breact` | Résolution des liens/invitations vers un JID numérique ; validation de l'ID du post | Exécution multi-sessions réelle, sans dépasser les limites du service |
| `.swgc` et alias | Workflow du plugin ; texte/image/vidéo/vocal ; vrai chiffrement média et Signal ; wrapper V2 ; `isGroupStatus` et nœud `meta` ; confirmation uniquement en privé | Apparition dans les statuts de groupe et lecture sur les téléphones destinataires |
| `.post` / `.status` — couche Baileys | Préparation et relais média vers `status@broadcast` | Audience réelle et affichage du statut personnel |
| `.upch` / `.upload` — couche Baileys | Médias préparés pour newsletter, upload en clair et protobuf de relais | Droits de publication et affichage du post dans la chaîne |
| Autres commandes — couche Baileys | Texte, mentions, citations, boutons, contacts, réactions, suppression, édition, transfert, stickers WebP, documents et view-once encodés | Exécution complète des commandes et disponibilité de leurs services externes |

Les tests de médias utilisent un vrai PNG généré par `sharp`, une petite vidéo
H.264 et un vocal Opus synthétiques. Les octets téléversés sont vérifiés par
hachage et déchiffrement ; les légendes, miniatures, durée et waveform sont
contrôlées après un aller-retour protobuf. Le destinataire et la distribution
réelle des clés aux membres du groupe ne sont **pas** simulés intégralement.

## Correctifs nécessaires trouvés pendant l'audit

1. **ID des réactions :** xzcbailz expose `key.server_id`. L'ancien handler
   prenait `newsletterServerId` ou un ID local alphanumérique, impropre à une
   réaction de chaîne. Tous les posts d'un lot sont maintenant traités, pas
   seulement le premier. Un échec de journalisation Mongo ne renvoie plus une
   réaction déjà envoyée.
2. **Liens `.breact` :** `0029...` est un code d'invitation, pas le JID de la
   chaîne. Il est résolu avec `newsletterMetadata('invite', ...)` au lieu de
   fabriquer `0029...@newsletter`.
3. **État WebSocket :** le client du fork expose `ws.isOpen` et/ou
   `ws.socket.readyState`, pas nécessairement `ws.readyState`. Le garde d'envoi,
   le watchdog et le diagnostic de santé lisent maintenant le même état réel.
4. **Clés binaires après redémarrage :** la lecture JSON native restaurait des
   objets `{ type: 'Buffer', data: [...] }`, pas des buffers utilisables par
   la cryptographie. La sérialisation/restauration est corrigée, avec lecture
   des anciens formats et des BSON Binary ; les clés app-state sont reconstruites
   avec le protobuf du fork. Ce bug du bot existait indépendamment de Wileys.
5. **Métadonnées `.swgc` :** les miniatures, dimensions, durées et waveform
   reçues sont conservées. Les anciennes URL, clés et hashes ne sont jamais
   réutilisés : les médias sont rechiffrés.
6. **Alias emoji :** `🌹`, `😍` et `❤️` manquaient dans le registre sans préfixe.
7. **Tests d'upload :** Wileys passe un flux chiffré à `upload` ; xzcbailz passe
   un chemin de fichier. Chaque fork est cohérent avec son propre uploader :
   l'ancien mock Wileys n'était pas un test valide du contrat xzcbailz.

Différence observée dans le code publié : Wileys 0.7.8 utilise `YUPRADEV` comme
code d'appairage par défaut, xzcbailz en génère un aléatoire. **Cette différence
ne prouve pas à elle seule que Wileys était la cause du refus d'appairage** :
un code personnalisé de huit caractères peut être légitime.

## Installation et reproduction

Le bot est CommonJS, le fork est ESM : **Node 20.19+ dans la série 20, ou
Node 22.12+** est requis ; **Node 22 LTS récent est recommandé**.
`require()` échoue avec `ERR_REQUIRE_ESM` sur Node 20.18.0. L'import a également
été testé sur Node 22.12.0 (avertissement expérimental d'interop sur cette version).

```sh
npm ci
npm run test:syntax
npm run test:baileys   # tests ciblés du fork, médias, newsletters et garde d'envoi
npm test              # suite complète
```

`legacy-peer-deps=true` reste nécessaire : les commandes utilisent Jimp 0.22,
le peer Jimp du fork attend 1.6. `sharp` 0.34.1 est installé directement et son
chemin de génération des miniatures a été testé.

Dans le sandbox seulement, l'installation reproductible a été vérifiée avec
`npm ci --ignore-scripts` : les téléchargements de FFmpeg/Puppeteer vers des
hôtes non autorisés sont bloqués. Le contrôle Node du fork a été exécuté
séparément. **Ne pas confondre cela avec une validation de ces binaires** :
les conversions FFmpeg et les stickers animés `.tgs` demandent un environnement
avec les outils/binaries nécessaires. Les API IA, YouTube, Telegram, upload et
autres téléchargeurs ne peuvent pas être garanties par un changement de Baileys.

## Essai WhatsApp à faire avant migration de toutes les sessions

Sur une seule session de test, avec les comptes/groupes/chaînes que tu gères :

- [ ] Générer un code, le saisir sur le téléphone, attendre `connection: open`.
- [ ] Envoyer `.ping`, `.menu` puis un texte, image, vidéo, vocal et sticker.
- [ ] Redémarrer le bot et vérifier que la session se reconnecte sans nouveau code.
- [ ] Configurer `.cfn`, publier deux posts dans la chaîne et vérifier les deux
      réactions, puis `.breact` avec un lien de post et avec un JID numérique.
- [ ] En privé, `.swgc`, sélection du groupe, puis texte et réponses à une image,
      vidéo et vocal. Vérifier les statuts sur un **autre téléphone**, leur lecture
      et l'absence de confirmation dans la conversation du groupe.
- [ ] Vérifier `.post`/`.status`, `.upch`/`.upload`, puis les commandes de groupe
      avec les droits d'administration appropriés.
- [ ] Tester séparément chaque service externe utilisé en production.

Conserver une sauvegarde privée des sessions avant le déploiement ; ne jamais
committer ni transmettre les fichiers de credentials ou les clés Signal.
