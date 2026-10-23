const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { configureWhatsAppMediaTempDir } = require('../services/media-temp-dir');
const mediaTemp = configureWhatsAppMediaTempDir();
if (mediaTemp.configured) console.log(`[MEDIA TEMP] Baileys media files: ${mediaTemp.directory}`);
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const yts = require('yt-search');
const Jimp = require('jimp');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { loadPlugins, executePlugin, getPlugins, getPluginsByCategory, getAllPluginsList } = require('./pluginLoader');
const {
  resolveSessionPrefix,
  parseCommandInput,
  shouldRouteToChatbot,
  extractMainCommandNames
} = require('../services/command-routing');
const {
  configEnabled,
  handleIgnoredMessage,
  wakeForCommand,
  applyAlwaysOnlineSetting,
  setupReplyPresenceWrapper
} = require('../services/presence-mode');
const { respond: respondToAi, formatAiError } = require('../services/ai-chatbot');
const { animeQuiz, formatQuizVerdict } = require('../services/anime-quiz');
const { setupMetaAiFakeQuote } = require('../services/meta-ai-fake-quote');
const { getChatbotInput } = require('../services/chatbot-message');
const {
  canonicalAdmin,
  collectMessageIdentifiers,
  addIdentifierCandidates,
  ownerNumbers,
  resolveAccess
} = require('../services/access-control');
const { resolveAntiStatusMode, formatKaidoStatusMention } = require('../services/status-mention-guard');
const {
  DEFAULT_NEWSLETTER_EMOJIS,
  normaliseNewsletterJid,
  normaliseEmojiList,
  resolveNewsletterEmojis,
  parseNewsletterMessageReference,
  extractNewsletterServerId,
  reactToNewsletterMessage,
  reactAcrossNewsletterSockets,
  syncNewsletterSockets
} = require('../services/newsletter-config');
const {
  modeAllowsChat,
  normaliseAntideleteMode,
  shouldCacheIncomingMessage,
  unwrapMessage: unwrapAntideleteMessage,
  resolveOriginalAuthor,
  resolveRevoker,
  resolveConversationName,
  uniqueMentions,
  buildAntideleteHeader,
  sendRecoveredMessage
} = require('../services/antidelete');
loadPlugins();
const { findStickerCommand, initStickerDb } = require('../features/sticker_cmd');
const {
  findReactionCommand,
  hasReactionCommands: sessionHasReactionCommands,
  initReactionDb
} = require('../features/reaction_cmd');
const { sms, downloadMediaMessage } = require('../lib/msg')
const { startTicTacToe, startSoloTicTacToe, handleTicTacToeMove, deleteGame } = require('../features/tictactoe');
const { resolveGroupCreationParticipant } = require('../services/group-creation');
const { buildChannelInfoInteractiveMessage } = require('../services/channel-info-message');
const { applyPairingCors } = require('../services/pairing-cors');
const {
  configureTranslationStorage,
  setupTranslationWrapper,
  saveSessionLanguage,
  getSessionLanguage,
  SKIP_FORMATTING_OPTION
} = require('../features/translation');
const githubUpdater = require('../services/github-updater');
const githubUpdateSettings = require('../services/github-update-settings');
const { createGitHubAutoUpdater } = require('../services/github-auto-updater');
const { configureGitHubUpdateSettings } = githubUpdateSettings;
const { createStickerFromMedia, sendSticker } = require('../lib/s-utils');
const { ytmp3, ytmp4 } = require('../lib/youtube');
const { getGroupAdminsInfo } = require('../lib/normalize');
const {
  areSameIdentity,
  findGroupParticipant,
  getBotJid,
  getGroupAdminJids,
  getGroupAdminNumbers,
  getParticipantId,
  getParticipantMentionJid,
  getPhoneNumberJid,
  isAdminParticipant,
  isBotAdmin: isBotGroupAdmin,
  isBotIdentity,
  isGroupAdmin,
  isGroupSuperAdmin,
  isSuperAdminParticipant
} = require('../services/group-admins');
const { uploadFile: uploadCloudku } = require("cloudku-uploader");
const FormData = require("form-data");
const {
  resolveGroupSelection,
  actorIdFromMessage,
  isPublicGroupStatusCommand
} = require('../services/group-status-selector');
const {
  completeStatusAudienceGroupSelection,
  STATUS_AUDIENCE_SELECTION_PURPOSE
} = require('../plugins/owner/tostatus');
const { handleAntiLink } = require('../handlers/antilink');
const { toggleAntiLink, isAntiLinkEnabled } = require('../handlers/antilink');
const statusLog = require('../services/status-log');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const {
  toggleWelcome,
  toggleGoodbye,
  isWelcomeEnabled,
  isGoodbyeEnabled,
  setWelcomeTemplate,
  setGoodbyeTemplate,
  handleParticipantUpdate
} = require('../handlers/welcome_goodbye');
const {
  default: makeWASocket,
  initAuthCreds,
  delay,
  getContentType,
  Browsers,
  fetchLatestWaWebVersion,
  downloadContentFromMessage,
  decryptPollVote,
  getKeyAuthor
} = require('@whiskeysockets/baileys');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
// -------- Sessions MongoDB uniquement --------
// Aucun dossier d'authentification local : creds et toutes les clés Signal sont
// persistés dans MongoDB avec le codec BufferJSON officiel.
const { createMongoAuthState, MongoAuthCorruptedError } = require('../auth/mongo-auth-state');
const { createMongoAuthBackend } = require('../auth/mongo-auth-backend');
const { createMongoConnection } = require('../db/mongo-connection');
const { createReconnectScheduler } = require('../auth/reconnect');
const { createPairingGuard } = require('../auth/pairing-guard');
const {
  createPairingLifecycle,
  waitForPairingReady
} = require('../auth/pairing-lifecycle');
const { issuePairingCode } = require('../auth/pairing-code');
const {
  createPairingCodeUrlCandidates,
  isPairingNetworkError,
  fetchPairingCodeWithFallback
} = require('../services/pairing-code-url');
const { resolvePairingNumber } = require('../services/pairing-code-input');
const { resolveReactionTargetMessage } = require('../services/reaction-target-message');
const { createBoundedCache, isBoundedCache } = require('../services/bounded-cache');
const { extractViewOnceMedia } = require('../services/view-once-media');
const { createSessionPurger } = require('../auth/session-purge');
const {
  createBaileysVersionResolver,
  formatWaVersion
} = require('../services/baileys-version');
const { installSafeSend, getSendStats } = require('../lib/safe-send');
const { createStatusReplyForwarder } = require('../services/status-reply-forwarder');
const {
  createMessageDispatcher,
  DEFAULT_MESSAGE_PROCESSING_CONCURRENCY,
  DEFAULT_MESSAGE_QUEUE_LIMIT
} = require('../services/message-batch');
const { createMediaAlbumStore, snapshotMessageEnvelope } = require('../services/media-album-store');
const { createReactionTargetCache } = require('../services/reaction-target-cache');
const {
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_HEALTH_CHECK_INTERVAL_MS,
  SESSION_STALE_AFTER_MS,
  getSocketOpenState,
  forceCloseSessionSocket,
  createSessionHealthWatcher
} = require('../services/session-health-watcher');

function resolveGroupActionTargets(metadata, identities) {
  const candidates = Array.isArray(identities) ? identities : [identities];
  const seen = new Set();
  const targets = [];

  for (const identity of candidates) {
    const participant = findGroupParticipant(metadata, identity);
    if (!participant) continue;
    const jid = getParticipantId(participant);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    targets.push({
      participant,
      jid,
      mentionJid: getParticipantMentionJid(participant) || jid
    });
  }

  return targets;
}

// Au début de ton fichier, après les imports
if (!global.scheduledRestart) {
    global.scheduledRestart = null;
}
// Variable globale pour stocker la dernière traduction
let lastTranslationText = "";

// Optionnel: Sauvegarder l'état au redémarrage
process.on('exit', () => {
    if (global.scheduledRestart?.timer) {
        console.log('⏰ Schedule restart arrêté (process exit)');
    }
});
// ---------------- CONFIG ----------------

// main.js (ou handlers.js)
const BOT_NAME_FANCY = 'Kaido MD x TECH MONDIAL';


  // en haut de mongo_utils.js (ou ton helper)
const DEFAULT_SESSION_CONFIG = {
  AUTO_VIEW_STATUS: true,
  AUTO_LIKE_STATUS: true,
  AUTO_RECORDING: false,
  AUTO_LIKE_EMOJI: ['🐉','🔥','💀','👑','💪','😎','🇭🇹','⚡','🩸','❤️'],
  PREFIX: '.',
  AUTO_ONLINE: false,
  ANTI_TAG_MODE: 'off',
  antistatusmention: false,
  antistatusmention_threshold: 2,
  MODE: 'public',
  SUDO_USERS: [],
  CHATBOT_ENABLED: false,
  STATUS_REPLY_FORWARD_ENABLED: false,
  STATUS_REPLY_KEYWORDS: []
};

// En mode prefixless, seuls les noms réellement connus doivent réveiller le bot.
// Le switch principal contient un sous-switch pour `.config`; ses options ne sont
// donc pas des commandes autonomes et sont retirées du registre historique.
const CONFIG_ONLY_SUBCOMMANDS = new Set([
  'alwaysonline', 'autoonline', 'online',
  'autoview', 'autolike', 'autorec', 'setemoji', 'setlikeemoji',
  'setprefix', 'show', 'get'
]);
const LEGACY_COMMANDS = (() => {
  try {
    const source = fs.readFileSync(__filename, 'utf8');
    return extractMainCommandNames(source, CONFIG_ONLY_SUBCOMMANDS);
  } catch (error) {
    console.warn('[COMMAND REGISTRY] Impossible de lire les commandes historiques:', error.message);
    return new Set();
  }
})();

function isKnownCommandName(command) {
  const name = String(command || '').toLowerCase();
  return getPlugins().has(name) || LEGACY_COMMANDS.has(name);
}

const SESSION_CONFIG_CACHE_TTL_MS = 60_000;
const SESSION_CONFIG_REFRESH_RETRY_MS = 5_000;
const sessionConfigCache = new Map();
const sessionConfigLoads = new Map();
const sessionConfigRefreshAfter = new Map();
const sessionConfigRevision = new Map();
const ADMIN_CACHE_TTL_MS = 60_000;
let adminCache = { value: [], expiresAt: 0, loaded: false };
let adminLoad = null;
let adminRevision = 0;
let adminRefreshAfter = 0;

const config = {
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/DLK3kh1Ze2qHUfNKCZ3iXN?mode=gi_t',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/l1lzbx.png',
  NEWSLETTER_JID: '120363421675697127@newsletter',
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER || '50947440869',
  PREMIUM:'50947371381@s.whatsapp.net',
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6FwIK89inhtCZOlp12',
  BOT_NAME: 'Kaido-MD',
  BOT_VERSION: '1.1.0',
  OWNER_NAME: 'Mugiwara no plag',
  IMAGE_PATH: 'https://files.catbox.moe/l1lzbx.png',
  BOT_FOOTER: '> 𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐏𝐋4𝐆 x *TECH MONDIAL* 👑',
  BUTTON_IMAGES: { ALIVE: 'https://files.catbox.moe/l1lzbx.png' }
};

function primaryOwnerNumber() {
  return ownerNumbers(config.OWNER_NUMBER)[0] || '';
}

// ---------------- MONGO SETUP ----------------

// MONGO_URI est obligatoire. Aucun identifiant par défaut et aucun stockage
// local de secours ne sont autorisés pour les sessions WhatsApp.
const mongoConnection = createMongoConnection();
let mongoDB;
let mongoCollectionsPromise = null;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  mongoDB = await mongoConnection.connect();
  if (!mongoCollectionsPromise) {
    mongoCollectionsPromise = (async () => {
      sessionsCol = mongoDB.collection('sessions');
      numbersCol = mongoDB.collection('numbers');
      adminsCol = mongoDB.collection('admins');
      newsletterCol = mongoDB.collection('newsletter_list');
      configsCol = mongoDB.collection('configs');
      newsletterReactsCol = mongoDB.collection('newsletter_reacts');

      await Promise.all([
        sessionsCol.createIndex({ number: 1 }, { unique: true }),
        numbersCol.createIndex({ number: 1 }, { unique: true }),
        newsletterCol.createIndex({ jid: 1 }, { unique: true }),
        newsletterReactsCol.createIndex({ jid: 1 }, { unique: true }),
        configsCol.createIndex({ number: 1 }, { unique: true })
      ]);
      await Promise.all([
        initStickerDb(mongoDB),
        initReactionDb(mongoDB)
      ]);
      console.log('✅ MongoDB connecté — collections et index prêts');
    })().catch((error) => {
      mongoCollectionsPromise = null;
      throw error;
    });
  }
  await mongoCollectionsPromise;
  return mongoDB;
}

// ---------------- Persistance des sessions (creds + clés Signal) ----------------

const authBackend = createMongoAuthBackend({
  initMongo,
  getDb: () => mongoDB
});
configureTranslationStorage({
  initMongo,
  getDb: () => mongoDB
});
configureGitHubUpdateSettings({
  initMongo,
  getDb: () => mongoDB
});
const githubAutoUpdater = createGitHubAutoUpdater({
  env: process.env,
  updater: githubUpdater,
  settings: githubUpdateSettings,
  // Le handler SIGTERM vide les creds Baileys/MongoDB avant que le superviseur
  // de l’hébergeur ne relance le processus avec les nouveaux fichiers.
  restart: () => process.kill(process.pid, 'SIGTERM')
});

// État d'authentification actif par numéro (cache mémoire d'exécution seulement).
const authStates = new Map();

// Une session ratée est effacée exclusivement de MongoDB.
const sessionPurger = createSessionPurger({
  authBackend,
  removeNumber: (n) => removeNumberFromMongo(n)
});

// ---------------- Mongo helpers ----------------

async function addNumberToMongo(number) {
  await initMongo();
  const sanitized = number.replace(/[^0-9]/g, '');
  await numbersCol.updateOne(
    { number: sanitized },
    { $set: { number: sanitized, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log(`Added number ${sanitized} to Mongo numbers`);
}

async function removeNumberFromMongo(number) {
  await initMongo();
  const sanitized = number.replace(/[^0-9]/g, '');
  await numbersCol.deleteOne({ number: sanitized });
  console.log(`Removed number ${sanitized} from Mongo numbers`);
}

async function getAllNumbersFromMongo() {
  await initMongo();
  const [numberDocs, sessionDocs] = await Promise.all([
    numbersCol.find({}, { projection: { number: 1 } }).toArray(),
    sessionsCol.find({}, { projection: { number: 1, registered: 1, creds: 1, data: 1 } }).toArray()
  ]);
  const numbers = new Set(numberDocs.map((doc) => doc.number));

  // Filet anti-crash : si le processus s'est arrêté juste après que Baileys a
  // enregistré les creds mais avant l'upsert dans `numbers`, la session reste
  // restaurable depuis son document auth MongoDB.
  for (const doc of sessionDocs) {
    let registered = doc.registered === true || doc.creds?.registered === true;
    if (!registered && typeof doc.data === 'string') {
      try { registered = JSON.parse(doc.data).registered === true; } catch (_) {}
    }
    if (registered && doc.number) numbers.add(doc.number);
  }
  return Array.from(numbers);
}

async function queryAdminsFromMongo() {
  const revision = adminRevision;
  await initMongo();
  const docs = await adminsCol.find({}).toArray();
  const admins = [];
  const seen = new Set();
  for (const doc of docs) {
    const identity = canonicalAdmin(doc);
    const value = identity.jid || identity.raw;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    admins.push(value);
  }
  if (revision === adminRevision) {
    adminCache = { value: admins, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS, loaded: true };
    adminRefreshAfter = 0;
  }
  return admins;
}

function startAdminRefresh() {
  if (adminLoad) return adminLoad;
  adminLoad = queryAdminsFromMongo()
    .catch(error => {
      adminRefreshAfter = Date.now() + SESSION_CONFIG_REFRESH_RETRY_MS;
      console.error('loadAdminsFromMongo', error);
      return adminCache.value;
    })
    .finally(() => { adminLoad = null; });
  return adminLoad;
}

async function loadAdminsFromMongo(forceRefresh = false) {
  if (!forceRefresh && adminCache.expiresAt > Date.now()) return [...adminCache.value];
  if (!forceRefresh && adminCache.loaded) {
    if (!adminLoad && adminRefreshAfter <= Date.now()) void startAdminRefresh();
    return [...adminCache.value];
  }
  return [...await startAdminRefresh()];
}

// Récupérer le statut d'un groupe (welcome ou goodbye)
async function getGroupFeatureStatus(groupId, feature) {
  try {
    await initMongo();
    const col = mongoDB.collection('group_features');
    const doc = await col.findOne({ groupId: groupId });
    if (!doc) return 'off'; // par défaut désactivé
    return doc[feature] || 'off';
  } catch (e) {
    console.error(`Erreur getGroupFeatureStatus pour ${feature}:`, e);
    return 'off';
  }
}

// Sauvegarder le statut d'un groupe
async function setGroupFeatureStatus(groupId, feature, status) {
  try {
    await initMongo();
    const col = mongoDB.collection('group_features');
    await col.updateOne(
      { groupId: groupId },
      { $set: { groupId: groupId, [feature]: status, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.error(`Erreur setGroupFeatureStatus pour ${feature}:`, e);
  }
}
async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    const identity = canonicalAdmin(jidOrNumber);
    if (!identity.number) throw new Error('Numéro ou JID administrateur invalide');
    const jid = identity.jid || identity.raw;
    const filters = [{ jid }, { jid: identity.raw }];
    if (identity.number) filters.push({ number: identity.number });
    await adminsCol.updateOne(
      { $or: filters },
      { $set: { jid, number: identity.number || null, updatedAt: new Date() } },
      { upsert: true }
    );
    adminRevision += 1;
    adminRefreshAfter = 0;
    adminCache = { value: [], expiresAt: 0, loaded: false };
    console.log(`Added admin ${jid}`);
    return jid;
  } catch (e) {
    console.error('addAdminToMongo', e);
    throw e;
  }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    const identity = canonicalAdmin(jidOrNumber);
    const docs = await adminsCol.find({}).toArray();
    const matchingIds = docs
      .filter(doc => {
        const existing = canonicalAdmin(doc);
        return (identity.number && existing.number === identity.number) ||
          (identity.raw && existing.raw === identity.raw) ||
          (identity.jid && existing.jid === identity.jid);
      })
      .map(doc => doc._id)
      .filter(Boolean);
    if (matchingIds.length) await adminsCol.deleteMany({ _id: { $in: matchingIds } });
    adminRevision += 1;
    adminRefreshAfter = 0;
    adminCache = { value: [], expiresAt: 0, loaded: false };
    console.log(`Removed admin ${identity.jid || identity.raw}`);
    return true;
  } catch (e) {
    console.error('removeAdminFromMongo', e);
    throw e;
  }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    await initMongo();
    const normalizedJid = normaliseNewsletterJid(jid);
    if (!normalizedJid) throw new Error('JID de chaîne invalide');
    const normalizedEmojis = normaliseEmojiList(emojis);
    const doc = { jid: normalizedJid, emojis: normalizedEmojis, updatedAt: new Date() };

    // Les deux collections historiques restent synchronisées afin que le
    // dashboard et `.cfn` alimentent exactement le même moteur de réactions.
    await Promise.all([
      newsletterCol.updateOne({ jid: normalizedJid }, { $set: doc, $setOnInsert: { addedAt: new Date() } }, { upsert: true }),
      newsletterReactsCol.updateOne({ jid: normalizedJid }, { $set: doc, $setOnInsert: { addedAt: new Date() } }, { upsert: true })
    ]);
    console.log(`Added newsletter ${normalizedJid} -> emojis: ${normalizedEmojis.join(',')}`);
    return { jid: normalizedJid, emojis: normalizedEmojis };
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    await initMongo();
    const normalizedJid = normaliseNewsletterJid(jid);
    if (!normalizedJid) throw new Error('JID de chaîne invalide');
    await Promise.all([
      newsletterCol.deleteOne({ jid: normalizedJid }),
      newsletterReactsCol.deleteOne({ jid: normalizedJid })
    ]);
    console.log(`Removed newsletter ${normalizedJid}`);
    return normalizedJid;
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs
      .map(doc => ({
        jid: normaliseNewsletterJid(doc.jid),
        emojis: normaliseEmojiList(doc.emojis)
      }))
      .filter(doc => doc.jid);
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    if (!mongoDB) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    await col.insertOne(doc);
    console.log(`Saved reaction ${emoji} for ${jid}#${messageId}`);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    if (!sanitized) throw new Error('Numéro de session invalide');
    await configsCol.updateOne(
      { number: sanitized },
      { $set: { number: sanitized, config: conf, updatedAt: new Date() } },
      { upsert: true }
    );
    sessionConfigRevision.set(sanitized, (sessionConfigRevision.get(sanitized) || 0) + 1);
    sessionConfigRefreshAfter.delete(sanitized);
    sessionConfigCache.set(sanitized, {
      value: { ...DEFAULT_SESSION_CONFIG, ...(conf || {}) },
      expiresAt: Date.now() + SESSION_CONFIG_CACHE_TTL_MS
    });
    return true;
  } catch (e) {
    console.error('setUserConfigInMongo', e);
    return false;
  }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await configsCol.findOne({ number: sanitized });
    return doc ? doc.config : null;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

function refreshSessionConfig(sanitized) {
  const current = sessionConfigLoads.get(sanitized);
  if (current) return current;

  const revision = sessionConfigRevision.get(sanitized) || 0;
  const load = (async () => {
    try {
      await initMongo();
      const doc = await configsCol.findOne({ number: sanitized });
      const merged = { ...DEFAULT_SESSION_CONFIG, ...(doc?.config || {}) };
      if ((sessionConfigRevision.get(sanitized) || 0) === revision) {
        sessionConfigCache.set(sanitized, {
          value: merged,
          expiresAt: Date.now() + SESSION_CONFIG_CACHE_TTL_MS
        });
      }
      sessionConfigRefreshAfter.delete(sanitized);
      return merged;
    } catch (error) {
      sessionConfigRefreshAfter.set(sanitized, Date.now() + SESSION_CONFIG_REFRESH_RETRY_MS);
      throw error;
    }
  })().finally(() => {
    if (sessionConfigLoads.get(sanitized) === load) sessionConfigLoads.delete(sanitized);
  });
  sessionConfigLoads.set(sanitized, load);
  return load;
}

async function loadSessionConfigMerged(number, forceRefresh = false) {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  if (!sanitized) return { ...DEFAULT_SESSION_CONFIG };

  const cached = sessionConfigCache.get(sanitized);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return { ...cached.value };

  // Cache périmé disponible : ne jamais suspendre le traitement d'un message
  // sur Mongo. Le rafraîchissement unique se fait en arrière-plan; une panne DB
  // conserve la dernière configuration connue et temporise les nouvelles
  // tentatives pour éviter une rafale de requêtes lors d'une déconnexion.
  if (!forceRefresh && cached) {
    if ((sessionConfigRefreshAfter.get(sanitized) || 0) <= Date.now()) {
      void refreshSessionConfig(sanitized).catch(error => {
        console.warn(`[CONFIG ${sanitized}] rafraîchissement en arrière-plan impossible :`, error?.message || error);
      });
    }
    return { ...cached.value };
  }

  try {
    return { ...await refreshSessionConfig(sanitized) };
  } catch (error) {
    if (cached) return { ...cached.value };
    throw error;
  }
}

// Helpers Mongo pour persister le schedule
async function getRestartSchedule() {
  await initMongo();
  const col = mongoDB.collection('restart_schedule');
  const doc = await col.findOne({ key: 'schedule' });
  return doc ? doc : null;
}

async function setRestartSchedule(minutes) {
  await initMongo();
  const col = mongoDB.collection('restart_schedule');
  await col.updateOne(
    { key: 'schedule' },
    { $set: { minutes, active: true, updatedAt: Date.now() } },
    { upsert: true }
  );
}

async function stopRestartSchedule() {
  await initMongo();
  const col = mongoDB.collection('restart_schedule');
  await col.updateOne(
    { key: 'schedule' },
    { $set: { active: false, updatedAt: Date.now() } },
    { upsert: true }
  );
}

async function restoreRestartSchedule() {
  const doc = await getRestartSchedule();
  if (doc && doc.active && doc.minutes > 0) {
    global.restartTimer = setInterval(() => {
      console.log(`🔄 Restart automatique (${doc.minutes} minutes)`);
      process.exit(0);
    }, doc.minutes * 60 * 1000);
    global.restartInterval = doc.minutes;
    console.log(`✅ Schedule restart restauré: toutes les ${doc.minutes} minutes`);
  }
}

/**
 * Crée les index recommandés pour la collection status_infractions.
 * Appelle cette fonction au démarrage de l'app.
 */
async function ensureStatusInfractionsIndex() {
  try {
    await initMongo();
    const col = mongoDB.collection('status_infractions');
    // index composé pour recherches rapides et upserts uniques
    await col.createIndex({ sessionId: 1, groupId: 1, participant: 1 }, { unique: true });
    // index sur lastAt pour purge/maintenance
    await col.createIndex({ lastAt: 1 });
  } catch (e) {
    console.warn('ensureStatusInfractionsIndex error', e);
  }
}

/**
 * Récupère le document d'infraction pour une session/groupe/participant.
 * Retourne null si absent ou en cas d'erreur.
 */
async function getStatusInfractionDoc(sessionId, groupId, participant) {
  try {
    await initMongo();
    const col = mongoDB.collection('status_infractions');
    const s = String(sessionId || '');
    const g = String(groupId || '');
    const p = String(participant || '');
    if (!s || !g || !p) return null;
    return await col.findOne({ sessionId: s, groupId: g, participant: p });
  } catch (e) {
    console.error('getStatusInfractionDoc', e);
    return null;
  }
}

/**
 * Incrémente le compteur d'infractions et renvoie la valeur après incrément.
 * Si l'opération échoue, renvoie 1 par défaut.
 */
async function incrStatusInfraction(sessionId, groupId, participant) {
  try {
    await initMongo();
    const col = mongoDB.collection('status_infractions');
    const now = Date.now();
    const s = String(sessionId || '');
    const g = String(groupId || '');
    const p = String(participant || '');
    if (!s || !g || !p) return 1;

    const res = await col.findOneAndUpdate(
      { sessionId: s, groupId: g, participant: p },
      { $inc: { count: 1 }, $set: { lastAt: now } },
      { upsert: true, returnDocument: 'after' } // driver mongodb v4+
    );

    const value = res && res.value ? res.value : null;
    if (value && typeof value.count === 'number') return value.count;

    // fallback : lire explicitement
    const doc = await col.findOne({ sessionId: s, groupId: g, participant: p });
    return doc && typeof doc.count === 'number' ? doc.count : 1;
  } catch (e) {
    console.error('incrStatusInfraction', e);
    return 1;
  }
}

/**
 * Réinitialise (supprime) le document d'infraction pour la clé donnée.
 * Retourne true si OK, false sinon.
 */
async function resetStatusInfraction(sessionId, groupId, participant) {
  try {
    await initMongo();
    const col = mongoDB.collection('status_infractions');
    const s = String(sessionId || '');
    const g = String(groupId || '');
    const p = String(participant || '');
    if (!s || !g || !p) return false;
    await col.deleteOne({ sessionId: s, groupId: g, participant: p });
    return true;
  } catch (e) {
    console.error('resetStatusInfraction', e);
    return false;
  }
}

/**
 * Définit explicitement le compteur d'infractions (upsert).
 * Retourne true si OK, false sinon.
 */
async function setStatusInfractionCount(sessionId, groupId, participant, count) {
  try {
    await initMongo();
    const col = mongoDB.collection('status_infractions');
    const s = String(sessionId || '');
    const g = String(groupId || '');
    const p = String(participant || '');
    const c = Number.isFinite(Number(count)) ? Number(count) : 0;
    if (!s || !g || !p) return false;
    await col.updateOne(
      { sessionId: s, groupId: g, participant: p },
      { $set: { count: c, lastAt: Date.now() } },
      { upsert: true }
    );
    return true;
  } catch (e) {
    console.error('setStatusInfractionCount', e);
    return false;
  }
}
// -------------- newsletter react-config helpers --------------

async function addNewsletterReactConfig(jid, emojis = []) {
  return addNewsletterToMongo(jid, emojis);
}

async function removeNewsletterReactConfig(jid) {
  return removeNewsletterFromMongo(jid);
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs
      .map(doc => ({ jid: normaliseNewsletterJid(doc.jid), emojis: normaliseEmojiList(doc.emojis) }))
      .filter(doc => doc.jid);
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function getReactConfigForJid(jid) {
  try {
    await initMongo();
    const normalizedJid = normaliseNewsletterJid(jid);
    if (!normalizedJid) return null;
    const doc = await newsletterCol.findOne({ jid: normalizedJid }) ||
      await newsletterReactsCol.findOne({ jid: normalizedJid });
    return doc ? normaliseEmojiList(doc.emojis) : null;
  } catch (e) { console.error('getReactConfigForJid', e); return null; }
}

// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getHaitiTimestamp() { 
  return moment().tz('America/Port-au-Prince').format('dddd D MMMM YYYY, HH:mm:ss');
}

// Résultat : "lundi 27 janvier 2025, 15:30:45"
const activeSockets = new Map();
// Sockets en cours d'appairage, en attente de la saisie du code sur le
// téléphone. Séparés d'`activeSockets` : un socket d'appairage n'est PAS une
// session connectée, et le confondre faisait croire au bot que le numéro était
// déjà pris — d'où le « code indisponible » au deuxième essai.
const pairingSockets = new Map();
// Dernier état de cycle de vie par numéro, exposé par /api/session/health sans
// jamais inclure le code d'appairage ni les clés.
const connectionLifecycles = new Map();
const socketRuntimeMetadata = new Map();
// Les fermetures déclenchées par une purge/logout explicite ne doivent pas
// réveiller l'ordonnanceur de reconnexion via leur propre événement `close`.
const intentionalSocketClosures = new WeakSet();
// Verrou d'appairage à libération explicite (voir src/auth/pairing-guard.js).
const pairingGuard = createPairingGuard({
  lockTtlMs: Math.max(30000, Number(process.env.PAIRING_LOCK_TTL_MS) || 3 * 60 * 1000)
});
const lastConnectionActivity = new Map();
const messageProcessingStats = new Map();
const messageDispatchers = new Map();
const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelayMonitor.enable();

function readEventLoopDelayStats() {
  const milliseconds = value => Number.isFinite(value) ? Number((value / 1e6).toFixed(2)) : null;
  const snapshot = {
    p50Ms: milliseconds(eventLoopDelayMonitor.percentile(50)),
    p95Ms: milliseconds(eventLoopDelayMonitor.percentile(95)),
    p99Ms: milliseconds(eventLoopDelayMonitor.percentile(99)),
    maxMs: milliseconds(eventLoopDelayMonitor.max)
  };
  eventLoopDelayMonitor.reset();
  return snapshot;
}

function getMessageProcessingStats(number) {
  const key = String(number || '').replace(/[^0-9]/g, '');
  if (!key) return null;
  let stats = messageProcessingStats.get(key);
  if (!stats) {
    stats = {
      received: 0,
      receivedByType: { notify: 0, append: 0, other: 0 },
      lastReceivedType: null,
      historyIgnored: 0,
      processed: 0,
      errors: 0,
      lastReceivedAt: null,
      lastProcessedAt: null,
      // Âge approximatif de l’horodatage WhatsApp au moment du `messages.upsert`;
      // à comparer entre sessions, en tenant compte d’un éventuel décalage d’horloge.
      lastNotifyTimestampAgeMs: null,
      maxNotifyTimestampAgeMs: 0,
      lastError: null,
      lastErrorAt: null,
      lastQueueDelayMs: null,
      lastProcessingDurationMs: null,
      maxQueueDelayMs: 0
    };
    messageProcessingStats.set(key, stats);
  }
  return stats;
}

const socketCreationTime = new Map();

const PAIRING_READY_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.PAIRING_READY_TIMEOUT_MS) || 45000
);
const WA_VERSION_FETCH_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.WA_VERSION_FETCH_TIMEOUT_MS) || 12000
);
// La route /code peut attendre le handshake Baileys, la version live et MongoDB.
// Le client de la commande .code doit laisser finir cette même requête locale.
const PAIRING_CODE_HTTP_TIMEOUT_MS = Math.max(
  60000,
  Number(process.env.PAIRING_CODE_HTTP_TIMEOUT_MS) || 120000
);
// Tuple canonique : le flux pairing-code valide plus strictement les libellés
// navigateur/OS que le QR. `Ubuntu + Chrome` est reconnu par Baileys/WhatsApp.
const WA_BROWSER = Object.freeze(Browsers.ubuntu('Chrome'));
const baileysVersionResolver = createBaileysVersionResolver({
  fetchLatestWaWebVersion,
  fetchOptions: () => ({ signal: AbortSignal.timeout(WA_VERSION_FETCH_TIMEOUT_MS) })
});

const SESSION_RECONNECT_BASE_MS = Math.max(2000, Number(process.env.SESSION_RECONNECT_BASE_MS) || 5000);
const SESSION_RECONNECT_MAX_MS = Math.max(30000, Number(process.env.SESSION_RECONNECT_MAX_MS) || 120000);

const otpStore = new Map();
// ============================================================
// ANTIDELETE STORE — Store en mémoire par session
// ============================================================
const messageStores = new Map(); // sessionNumber → Map<msgId, msgObject>
const messageStoreTimes = new WeakMap(); // msgObject → storedAt (sans deuxième Map de clés par session)
// Cache borné de cibles média pour les commandes par réaction, même si .setcmd
// est créé après l'arrivée du média ou si l'antidelete est désactivé.
const reactionTargetCache = createReactionTargetCache();

const configuredStoreLimit = Number(process.env.ANTIDELETE_STORE_MAX);
const STORE_MAX_PER_SESSION = Number.isInteger(configuredStoreLimit) && configuredStoreLimit > 0
  ? Math.max(50, Math.min(500, configuredStoreLimit))
  : 400;
const configuredRetentionMs = Number(process.env.ANTIDELETE_RETENTION_MS);
const STORE_RETENTION_MS = Number.isFinite(configuredRetentionMs) && configuredRetentionMs > 0
  ? Math.max(20 * 60 * 1000, configuredRetentionMs)
  : 24 * 60 * 60 * 1000;
const STORE_CLEAN_INTERVAL = 20 * 60 * 1000;

function getSessionStore(sessionNumber) {
  if (!messageStores.has(sessionNumber)) messageStores.set(sessionNumber, new Map());
  return messageStores.get(sessionNumber);
}

function deleteStoredMessage(sessionNumber, msgId) {
  messageStores.get(sessionNumber)?.delete(msgId);
}

function deleteSessionStore(sessionNumber) {
  messageStores.delete(sessionNumber);
}

function storeMessage(sessionNumber, msg) {
  if (!msg?.key?.id || !msg?.message) return;
  // Un protocole REVOKE décrit une suppression : ce n'est pas le message
  // original et il ne doit jamais remplacer une entrée du store.
  if (unwrapAntideleteMessage(msg.message).message?.protocolMessage?.type === 0) return;

  const store = getSessionStore(sessionNumber);

  // Quota borné pour libérer les plus anciens messages si le cache est actif.
  while (store.size >= STORE_MAX_PER_SESSION) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }

  // Le routeur déplie parfois `msg.message` en place après le stockage. Une
  // enveloppe séparée conserve les wrappers ephemeral/view-once pour les alias
  // de réaction qui relisent le message cité plus tard.
  const storedMessage = snapshotMessageEnvelope(msg);
  // Réinsérer actualise aussi l'ordre LRU de la Map.
  store.delete(msg.key.id);
  store.set(msg.key.id, storedMessage);
  messageStoreTimes.set(storedMessage, Date.now());
}

function getStoredMessage(sessionNumber, msgId) {
  return messageStores.get(sessionNumber)?.get(msgId) || null;
}

// Nettoyage par TTL : le WeakMap évite une seconde Map de timestamps et ses
// clés dupliquées. Les objets Baileys ne contiennent pas les blobs media.
const antideleteCleaner = setInterval(() => {
  const expiresBefore = Date.now() - STORE_RETENTION_MS;
  for (const [sessionNumber, store] of messageStores.entries()) {
    let removed = 0;
    for (const [msgId, message] of store.entries()) {
      const storedAt = messageStoreTimes.get(message) || 0;
      if (storedAt > expiresBefore) continue;
      store.delete(msgId);
      removed += 1;
    }
    if (removed) console.log(`[ANTIDELETE] ${removed} ancien(s) message(s) nettoyé(s) pour ${sessionNumber}`);
    if (!store.size) messageStores.delete(sessionNumber);
  }
}, STORE_CLEAN_INTERVAL);
antideleteCleaner.unref?.();

const MOVIE_SUBTITLE_CACHE_MAX = 100;
const MOVIE_SUBTITLE_MAX_CHARS = 8192;

function getMovieSubtitleCache() {
  if (!isBoundedCache(global.movieSubCache)) {
    global.movieSubCache = createBoundedCache({ maxEntries: MOVIE_SUBTITLE_CACHE_MAX, maxAgeMs: 6 * 60 * 60 * 1000 });
  }
  return global.movieSubCache;
}

function cacheMovieSubtitles(subjectId, subtitles) {
  if (subjectId === null || subjectId === undefined || subjectId === '') return;
  const value = typeof subtitles === 'string' ? subtitles.slice(0, MOVIE_SUBTITLE_MAX_CHARS) : 'None';
  getMovieSubtitleCache().set(String(subjectId).slice(0, 200), value || 'None');
}

function getCachedMovieSubtitles(subjectId) {
  if (subjectId === null || subjectId === undefined || subjectId === '') return undefined;
  return getMovieSubtitleCache().get(String(subjectId).slice(0, 200));
}

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `📞 Number: ${number}\n🩵 Statut: ${groupStatus}\n🕒 Connecté a: ${getHaitiTimestamp()}`, botName);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      if (String(image).startsWith('http')) {
        await socket.sendMessage(to, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(to, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  try {
    const ownerJid = `${primaryOwnerNumber()}@s.whatsapp.net`;
    const activeCount = activeSockets.size;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;

    const groupStatus = groupResult.status === 'success' 
      ? `✅ Rejoint (ID: ${groupResult.gid})` 
      : `❌ Échec: ${groupResult.error}`;
    
    // Message très simple et clair
    const caption = `👑 NOTIFICATION PROPRIÉTAIRE 👑

🤖 Bot: ${botName}
📱 Numéro: ${number}
🩵 Statut: ${groupStatus}
🕒 Connecté: ${getHaitiTimestamp()}
👥 Sessions: ${activeCount}

📍 Fuseau: Haïti
📊 Performance: ${activeCount > 5 ? "Élevée" : "Normale"}

━━━━━━━━━━━━━━━━━━

⚠️ Notification automatique
${new Date().toLocaleString('fr-FR', { 
  timeZone: 'America/Port-au-Prince',
  dateStyle: 'medium',
  timeStyle: 'short'
})}`;

    if (String(image).startsWith('http')) {
      await socket.sendMessage(ownerJid, { 
        image: { url: image }, 
        caption: caption
      });
    } else {
      try {
        const buf = fs.readFileSync(image);
        await socket.sendMessage(ownerJid, { 
          image: buf, 
          caption: caption
        });
      } catch (e) {
        await socket.sendMessage(ownerJid, { 
          image: { url: config.RCD_IMAGE_PATH }, 
          caption: caption
        });
      }
    }
    
    console.log(`✅ Notification propriétaire envoyée (${activeCount} sessions)`);
    
  } catch (err) { 
    console.error('❌ Échec notification propriétaire:', err.message || err); 
  }
}
async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages = [] }) => {
    const newsletterMessages = messages.filter(message =>
      message?.key && normaliseNewsletterJid(message.key.remoteJid)
    );
    if (!newsletterMessages.length) return;

    try {
      const followedDocs = await listNewslettersFromMongo();
      const reactConfigs = await listNewsletterReactsFromMongo();
      const reactMap = new Map();
      for (const item of reactConfigs) {
        const itemJid = normaliseNewsletterJid(item.jid);
        if (itemJid) reactMap.set(itemJid, normaliseEmojiList(item.emojis));
      }

      for (const message of newsletterMessages) {
        const normalizedJid = normaliseNewsletterJid(message.key.remoteJid);
        const followed = followedDocs.find(item => item.jid === normalizedJid);
        if (!followed && !reactMap.has(normalizedJid)) continue;

        // NYXCORE place le server_id requis par newsletterReactMessage dans
        // message.key.server_id (pas dans key.id, qui est le stanza id).
        const serverId = extractNewsletterServerId(message);
        if (!serverId) {
          console.warn(`[NEWSLETTER REACTION] server_id absent pour ${normalizedJid}; publication ignorée.`);
          continue;
        }

        const emojis = resolveNewsletterEmojis(
          followed?.emojis,
          reactMap.get(normalizedJid),
          DEFAULT_NEWSLETTER_EMOJIS
        );
        const idx = rrPointers.get(normalizedJid) || 0;
        const emoji = emojis[idx % emojis.length];
        rrPointers.set(normalizedJid, (idx + 1) % emojis.length);

        let succeeded = false;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await reactToNewsletterMessage(socket, normalizedJid, serverId, emoji);
            console.log(`Reacted to ${normalizedJid} ${serverId} with ${emoji}`);
            await saveNewsletterReaction(normalizedJid, serverId, emoji, sessionNumber || null);
            succeeded = true;
            break;
          } catch (error) {
            console.warn(`Newsletter reaction attempt failed (${attempt}/3):`, error?.message || error);
            if (attempt < 3) await delay(1200);
          }
        }
        if (!succeeded) {
          console.error(`[NEWSLETTER REACTION] Échec après 3 tentatives pour ${normalizedJid}#${serverId}.`);
        }
      }
    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}

// Assure-toi d'avoir importé ton helper en haut du fichier
// const { handleParticipantUpdate } = require('../handlers/welcome_goodbye');

/**
 * Enregistre les listeners liés aux participants de groupe.
 * Appelle cette fonction une seule fois après l'initialisation du socket.
 * @param {import('@whiskeysockets/baileys').AnySocket} socket
 */
async function registerGroupParticipantListener(socket) {
  // on attache l'événement une seule fois
  socket.ev.on('group-participants.update', async (update) => {
    try {
      if (!update) return;

      // Compatibilité selon versions : id ou groupId
      const from = update.id || update?.groupId || null;
      if (!from) {
        console.warn('GROUP PARTICIPANTS UPDATE: missing group id', update);
        return;
      }

      // Normaliser participants (Baileys peut renvoyer participants ou participant)
      const participants = Array.isArray(update.participants)
        ? update.participants
        : (update.participant ? [update.participant] : []);

      if (!participants.length) return;

      // Log utile pour debug
      console.log('GROUP PARTICIPANTS UPDATE -> group:', from, 'action:', update.action, 'participants:', participants);

      // Appel du handler centralisé (welcome_goodbye.js)
      await handleParticipantUpdate(socket, from, update);

    } catch (e) {
      console.error('GROUP PARTICIPANTS UPDATE ERROR', e);
    }
  });
}
// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket, sanitizedNumber) {
  const statusReplyForwarder = createStatusReplyForwarder({
    socket,
    loadSessionConfig: () => loadSessionConfigMerged(sanitizedNumber)
  });
  socket.ev.on('messages.upsert', event => {
    void statusReplyForwarder.handleUpsert(event)
      .catch(error => console.error('[STATUS REPLY FORWARDER ERROR]', error?.message || error));
  });

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

    // UTILISER sanitizedNumber (déjà nettoyé) ; fallback minimal si absent
    const sessionId = (sanitizedNumber && String(sanitizedNumber).replace(/[^0-9]/g,''))
      || (socket?.authState?.creds?.me?.id || socket?.user?.id || message.key.participant || message.key.remoteJid || '')
           .split('@')[0].replace(/[^0-9]/g,'');

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug('[HANDLER] status event participant:', message.key.participant, 'session:', sessionId);
    }

    if (!sessionId) {
      console.warn('[HANDLER] No sessionId available for status handler; skipping session-specific config');
      return;
    }

    const cfg = await loadSessionConfigMerged(sessionId);

    try {
      await applyAlwaysOnlineSetting(socket, false, message.key.remoteJid);
      if (configEnabled(cfg.AUTO_RECORDING, false)) {
        await socket.sendPresenceUpdate('recording', message.key.remoteJid);
      }

      if (cfg.AUTO_VIEW_STATUS) {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try { await socket.readMessages([message.key]); break; }
          catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries === 0) throw error; }
        }
      }

      if (cfg.AUTO_LIKE_STATUS) {
        const emojis = Array.isArray(cfg.AUTO_LIKE_EMOJI) && cfg.AUTO_LIKE_EMOJI.length ? cfg.AUTO_LIKE_EMOJI : config.AUTO_LIKE_EMOJI;
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(
              message.key.remoteJid,
              { react: { text: randomEmoji, key: message.key } },
              { statusJidList: [message.key.participant] }
            );
            break;
          } catch (error) {
            retries--;
            await delay(1000 * (config.MAX_RETRIES - retries));
            if (retries === 0) throw error;
          }
        }
      }

    } catch (error) {
      console.error('Status handler error:', error);
    }
  });
}
// downloader robuste
async function robustDownload(messageObj, downloader) {
  // messageObj peut être quoted, quoted.viewOnceMessage, imageMessage, etc.
  if (!messageObj) throw new Error('No message object provided to downloader');

  // extraire inner message si viewOnce
  const innerFromViewOnce = messageObj.viewOnceMessage?.message || messageObj;
  // trouver le type présent
  const qTypes = ['imageMessage','videoMessage','documentMessage','stickerMessage','audioMessage'];
  let inner = null;
  for (const t of qTypes) {
    if (innerFromViewOnce[t]) { inner = innerFromViewOnce[t]; break; }
  }
  // si aucun type trouvé, peut-être que messageObj est déjà le content
  if (!inner) {
    // essayer d'utiliser messageObj.imageMessage etc.
    for (const t of qTypes) {
      if (messageObj[t]) { inner = messageObj[t]; break; }
    }
  }
  if (!inner) inner = innerFromViewOnce;

  // déterminer le type pour downloadContentFromMessage
  let type = 'image';
  if (inner.videoMessage) type = 'video';
  else if (inner.documentMessage) type = 'document';
  else if (inner.audioMessage) type = 'audio';
  else if (inner.stickerMessage) type = 'sticker';
  else if (inner.imageMessage) type = 'image';

  // downloader peut être une fonction qui renvoie Buffer ou un stream async iterable
  if (typeof downloader !== 'function') throw new Error('Downloader function required');

  const streamOrBuffer = await downloader(inner, type);
  if (!streamOrBuffer) throw new Error('Downloader returned empty');

  if (Buffer.isBuffer(streamOrBuffer)) return streamOrBuffer;

  // sinon concaténer le stream async iterable
  const chunks = [];
  for await (const chunk of streamOrBuffer) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer || buffer.length === 0) throw new Error('Buffer vide après téléchargement');
  return buffer;
}
async function handleMessageRevocation(socket, number) {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  const ownerJid = `${sanitized}@s.whatsapp.net`;
  const pendingDeletes = new Map();
  const inFlight = new Set();
  const processed = new Map();

  const eventId = key => `${key?.remoteJid || ''}:${key?.id || ''}`;
  const alreadyProcessed = id => {
    const timestamp = processed.get(id);
    if (!timestamp) return false;
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      processed.delete(id);
      return false;
    }
    return true;
  };
  const markProcessed = id => {
    processed.set(id, Date.now());
    while (processed.size > 1000) processed.delete(processed.keys().next().value);
  };

  const run = async (revokedKey, revokeMessage = null) => {
    if (!revokedKey?.id) return;
    const id = eventId(revokedKey);
    if (alreadyProcessed(id) || inFlight.has(id)) return;
    inFlight.add(id);
    try {
      const result = await processRevoke({
        sanitized,
        ownerJid,
        socket,
        revokedKey,
        revokeMessage
      });
      if (result !== 'not_found' && result !== 'error') markProcessed(id);
    } finally {
      inFlight.delete(id);
    }
  };

  // messages.delete ne fournit généralement pas l'identité de la personne qui
  // a supprimé. On attend brièvement le protocolMessage REVOKE, plus complet.
  socket.ev.on('messages.delete', ({ keys }) => {
    for (const key of keys || []) {
      if (!key?.id) continue;
      const id = eventId(key);
      if (pendingDeletes.has(id) || alreadyProcessed(id)) continue;
      const timer = setTimeout(() => {
        pendingDeletes.delete(id);
        run(key).catch(error => console.error('[AD messages.delete]', error));
      }, 1000);
      timer.unref?.();
      pendingDeletes.set(id, timer);
    }
  });

  // Le message protocolaire permet de distinguer la clé du message original
  // (protocolMessage.key) de la personne ayant réellement révoqué (m.key).
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const revokeMessage of messages || []) {
      try {
        const protocol = unwrapAntideleteMessage(revokeMessage?.message).message?.protocolMessage;
        if (protocol?.type !== 0 || !protocol.key?.id) continue;
        const revokedKey = {
          ...protocol.key,
          remoteJid: protocol.key.remoteJid || revokeMessage.key?.remoteJid
        };
        const id = eventId(revokedKey);
        const pending = pendingDeletes.get(id);
        if (pending) {
          clearTimeout(pending);
          pendingDeletes.delete(id);
        }
        await run(revokedKey, revokeMessage);
      } catch (error) {
        console.error('[AD messages.upsert REVOKE]', error);
      }
    }
  });
}

async function processRevoke({ sanitized, ownerJid, socket, revokedKey, revokeMessage }) {
  const msgId = revokedKey?.id;
  const chatId = revokedKey?.remoteJid || revokeMessage?.key?.remoteJid;
  if (!msgId || !chatId) return 'invalid';

  try {
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    if (!modeAllowsChat(cfg.antidelete, chatId)) return 'ignored';

    const deletedMsg = getStoredMessage(sanitized, msgId);
    if (!deletedMsg) {
      console.warn(`[ANTIDELETE] ${msgId} non trouvé dans le store (session ${sanitized})`);
      return 'not_found';
    }

    const authorJid = resolveOriginalAuthor(deletedMsg, chatId, ownerJid);
    const revokerJid = resolveRevoker(revokeMessage, chatId, ownerJid, authorJid);
    const conversationName = await resolveConversationName(socket, chatId, deletedMsg, revokeMessage);
    const { isViewOnce } = unwrapAntideleteMessage(deletedMsg.message);
    const mentions = uniqueMentions(revokerJid, authorJid);
    const header = buildAntideleteHeader({
      revokerJid,
      authorJid,
      conversationName,
      timestamp: getHaitiTimestamp(),
      isViewOnce
    });

    await sendRecoveredMessage({
      socket,
      ownerJid,
      storedMessage: deletedMsg,
      header,
      mentions,
      downloadContent: downloadContentFromMessage
    });

    deleteStoredMessage(sanitized, msgId);
    return 'recovered';
  } catch (error) {
    // Conserver l'entrée pour permettre une nouvelle tentative si le réseau ou
    // le téléchargement du média a échoué temporairement.
    console.error('[ANTIDELETE FATAL ERROR]', error);
    return 'error';
  }
}

function generateTS() { return Math.floor(Date.now() / 1000); }
function generateTT(ts) { return CryptoJS.MD5(String(ts) + 'X-Fc-Pp-Ty-eZ').toString(); }

async function reelsvideo(url) {
  const ts = generateTS();
  const tt = generateTT(ts);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'hx-request': 'true',
    'hx-current-url': 'https://reelsvideo.io/',
    'hx-target': 'target',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://reelsvideo.io',
    'Referer': 'https://reelsvideo.io/'
  };

  const body = new URLSearchParams();
  body.append('id', url);
  body.append('locale', 'en');
  body.append('cf-turnstile-response', '');
  body.append('tt', tt);
  body.append('ts', ts);

  // NOTE: utiliser l'endpoint générique ; certains sites exigent l'URL exacte.
  const res = await axios.post('https://reelsvideo.io/reel/', body, { headers });

  const $ = cheerio.load(res.data);

  const username = $('.bg-white span.text-400-16-18').first().text().trim() || null;
  const thumb = $('div[data-bg]').first().attr('data-bg') || null;

  const videos = [];
  $('a.type_videos').each((i, el) => {
    const href = $(el).attr('href');
    if (href) videos.push(href);
  });

  const images = [];
  $('a.type_images').each((i, el) => {
    const href = $(el).attr('href');
    if (href) images.push(href);
  });

  const mp3 = [];
  $('a.type_audio').each((i, el) => {
    const href = $(el).attr('href');
    const id = $(el).attr('data-id');
    if (href && id) mp3.push({ id, url: href });
  });

  let type = 'unknown';
  if (videos.length && images.length) type = 'carousel';
  else if (videos.length) type = 'video';
  else if (images.length) type = 'photo';

  return { type, username, thumb, videos, images, mp3 };
}



function handleGroupStatusMention(socket, sessionId) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    try {
      if (!messages || !messages.length) return;
      const m = messages[0];
      if (!m || !m.message || !m.key) return;

      const remote = m.key.remoteJid || '';
      // Vérifier que c'est bien un groupe
      if (!remote.endsWith('@g.us')) return;

      // Charger la config de la session
      const cfg = await loadUserConfigFromMongo(sessionId) || {};
      if (!cfg.antistatusmention) return; // mode désactivé

      // Détecter le type du message
      const keys = Object.keys(m.message);
      const type = keys.length ? keys[0] : 'unknown';

      // Si c'est une mention de statut de groupe
      if (type === 'groupStatusMentionMessage') {
        const groupId = remote;
        const participant = m.key.participant || m.key.from || null;
        const participantNum = participant ? participant.split('@')[0] : 'inconnu';

        // Supprimer le message
        try {
          await socket.sendMessage(groupId, { delete: m.key });
        } catch (e) {
          console.warn('[ANTISTATUS] suppression échouée', e?.message || e);
        }

        // Avertir publiquement l’expéditeur
        try {
          await socket.sendMessage(groupId, {
            text: formatKaidoStatusMention('Mention de statut détectée', [
              `Membre : @${participantNum}`,
              'Les mentions de statut sont désactivées dans ce groupe.',
              'Une récidive peut entraîner une exclusion.'
            ]),
            mentions: participant ? [participant] : []
          });
        } catch (e) {
          console.warn('[ANTISTATUS] avertissement échoué', e?.message || e);
        }

        // Incrémenter le compteur d’infractions en Mongo
        let count = 1;
        try {
          count = await incrStatusInfraction(sessionId, groupId, participant);
        } catch (e) {
          console.error('[ANTISTATUS] erreur incrStatusInfraction', e);
        }

        // Seuil configurable (par défaut 2)
        const THRESHOLD = (cfg.antistatusmention_threshold && Number(cfg.antistatusmention_threshold)) || 2;

        // Si récidive >= seuil => expulsion
        if (count >= THRESHOLD) {
          try { await resetStatusInfraction(sessionId, groupId, participant); } catch(e){}

          let groupMeta = null;
          try {
            groupMeta = await socket.groupMetadata(groupId);
          } catch (e) {
            console.warn('[ANTISTATUS] impossible de récupérer groupMetadata', e?.message || e);
          }

          const offender = findGroupParticipant(groupMeta, [participant, m.key?.participantAlt]);
          if (!offender) {
            await socket.sendMessage(groupId, {
              text: formatKaidoStatusMention('Vérification impossible', [
                `Membre : @${participantNum}`,
                'Kaido MD n’a pas pu vérifier son rôle; aucune exclusion effectuée.'
              ]),
              mentions: [participant]
            });
            return;
          }
          const offenderJid = getParticipantId(offender);
          const offenderMentionJid = getParticipantMentionJid(offender) || offenderJid;
          if (!offenderJid) return;

          // Vérifier par PN/LID/identifiants alternatifs, pas uniquement p.id.
          if (isGroupAdmin(groupMeta, offender)) {
            await socket.sendMessage(groupId, {
              text: formatKaidoStatusMention('Administrateur exempté', [
                `Administrateur : @${offenderMentionJid.split('@')[0]}`,
                'Aucune exclusion ne sera effectuée pour ce rôle.'
              ]),
              mentions: [offenderMentionJid]
            });
            return;
          }

          // Vérifier le vrai compte du bot, y compris son JID LID éventuel.
          if (!isBotGroupAdmin(groupMeta, socket)) {
            await socket.sendMessage(groupId, {
              text: formatKaidoStatusMention('Exclusion non effectuée', [
                `Membre : @${offenderMentionJid.split('@')[0]}`,
                'Kaido MD doit être administrateur pour appliquer cette sanction.'
              ]),
              mentions: [offenderMentionJid]
            });
            return;
          }

          // Expulser l'identifiant réellement présent dans le groupe.
          try {
            await socket.groupParticipantsUpdate(groupId, [offenderJid], 'remove');
            await socket.sendMessage(groupId, {
              text: formatKaidoStatusMention('Membre exclu après récidive', [
                `Membre : @${offenderMentionJid.split('@')[0]}`,
                'La récidive aux mentions de statut a entraîné une exclusion.'
              ]),
              mentions: [offenderMentionJid]
            });
          } catch (e) {
            console.error('[ANTISTATUS] erreur expulsion', e);
            await socket.sendMessage(groupId, {
              text: formatKaidoStatusMention('Expulsion impossible', [
                `Membre : @${participantNum}`,
                'Kaido MD n’a pas pu appliquer l’exclusion; contacte un administrateur.'
              ]),
              mentions: [participant]
            });
          }
        }
      }
    } catch (err) {
      console.error('[ANTISTATUS HANDLER ERROR]', err);
    }
  });
}
// ---------------- command handlers ----------------
async function handleAutoChatbotMessage({ socket, msg, remoteJid, sessionConfig, sessionNumber, input }) {
  if (!input || !configEnabled(sessionConfig?.CHATBOT_ENABLED, false) || msg?.key?.fromMe) return false;

  if (sessionConfig?.MODE === 'private') {
    const senderJid = msg.key.participant || remoteJid;
    const senderNumber = String(senderJid || '').split('@')[0].split(':')[0];
    const identifiers = collectMessageIdentifiers(msg, senderJid, senderNumber);
    const access = resolveAccess({
      identifiers,
      ownerValue: config.OWNER_NUMBER,
      adminEntries: await loadAdminsFromMongo(),
      sudoEntries: sessionConfig.SUDO_USERS || [],
      sessionNumber
    });
    if (!access.isPrivileged) {
      await handleIgnoredMessage(socket, msg, sessionConfig);
      return true;
    }
  }

  let presenceStarted = false;
  try {
    const responseLanguage = await getSessionLanguage(sessionNumber);
    const result = await respondToAi({
      sessionNumber,
      chatJid: remoteJid,
      senderName: remoteJid.endsWith('@g.us') ? (msg.pushName || '') : '',
      text: input,
      language: responseLanguage,
      isActive: async () => configEnabled((await loadSessionConfigMerged(sessionNumber)).CHATBOT_ENABLED, false),
      onStart: async () => {
        presenceStarted = true;
        await wakeForCommand(socket, msg, sessionConfig);
        if (!configEnabled(sessionConfig.AUTO_RECORDING, false) && typeof socket.sendPresenceUpdate === 'function') {
          await socket.sendPresenceUpdate('composing', remoteJid).catch(() => {});
        }
      }
    });
    if (result.cancelled) return true;
    await socket.sendMessage(remoteJid, {
      text: `🐉 *Kaido*\n\n${result.text}\n\n> Kaido-MD — PlagTech`
    }, { quoted: msg, [SKIP_FORMATTING_OPTION]: true });
  } catch (error) {
    console.warn('[AI CHATBOT] Réponse indisponible :', error?.code || error?.name || 'erreur');
    try {
      await socket.sendMessage(remoteJid, { text: `❌ ${formatAiError(error)}` }, { quoted: msg });
    } catch (sendError) {
      console.warn('[AI CHATBOT] Envoi de l’erreur impossible :', sendError?.message || sendError);
    }
  } finally {
    if (presenceStarted && typeof socket.sendPresenceUpdate === 'function') {
      await socket.sendPresenceUpdate('paused', remoteJid).catch(() => {});
    }
  }
  return true;
}

function setupCommandHandlers(socket, number) {
  const sanitizedNumber = String(number || socket.user?.id?.split(':')[0] || '').replace(/[^0-9]/g, '');
  const dispatcher = createMessageDispatcher({
    concurrency: process.env.MESSAGE_PROCESSING_CONCURRENCY || DEFAULT_MESSAGE_PROCESSING_CONCURRENCY,
    maxPending: process.env.MESSAGE_QUEUE_LIMIT || DEFAULT_MESSAGE_QUEUE_LIMIT
  });
  const mediaAlbumStore = createMediaAlbumStore();
  if (sanitizedNumber) messageDispatchers.set(sanitizedNumber, dispatcher);

  socket.ev.on('messages.upsert', ({ messages = [], type = 'unknown' } = {}) => {
    if (!Array.isArray(messages) || !messages.length) return;
    // Baileys associe chaque média d’un album au key du message album via
    // messageContextInfo.messageAssociation.parentMessageKey. On garde ce petit
    // index en mémoire par socket pour que .spack puisse récupérer ses photos.
    for (const incoming of messages) {
      mediaAlbumStore.record(incoming?.key?.remoteJid, incoming);
      // Cache aussi les médias reçus en `append` (rattrapage Baileys) : la cible
      // peut déjà exister dans l'historique quand la réaction arrive. Le cache
      // est borné et cet indexage n'exécute jamais les anciens messages.
      reactionTargetCache.record(sanitizedNumber, incoming);
    }
    const batchStats = getMessageProcessingStats(number || socket.user?.id?.split(':')[0]);
    if (batchStats) {
      const receivedType = type === 'notify' ? 'notify' : type === 'append' ? 'append' : 'other';
      batchStats.received += messages.length;
      batchStats.receivedByType[receivedType] += messages.length;
      batchStats.lastReceivedType = receivedType;
      const upsertAt = Date.now();
      batchStats.lastReceivedAt = upsertAt;
      if (type === 'notify') {
        for (const incoming of messages) {
          const rawTimestamp = incoming?.messageTimestamp;
          const timestampSeconds = Number(typeof rawTimestamp?.toNumber === 'function'
            ? rawTimestamp.toNumber()
            : rawTimestamp);
          if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) continue;
          const timestampAgeMs = Math.max(0, upsertAt - timestampSeconds * 1000);
          batchStats.lastNotifyTimestampAgeMs = timestampAgeMs;
          batchStats.maxNotifyTimestampAgeMs = Math.max(batchStats.maxNotifyTimestampAgeMs || 0, timestampAgeMs);
        }
      }
      if (type === 'append') batchStats.historyIgnored += messages.length;
    }
    // `append` contient le rattrapage d'historique; l'exécuter comme du trafic
    // live retarde les notifications entrantes et peut rejouer d'anciennes
    // commandes après chaque reconnexion. Baileys signale les nouveaux messages
    // par `notify`; on garde les compteurs d'historique pour le diagnostic.
    if (type === 'append') return;
    void dispatcher.processBatch(messages, async msg => {
      if (!msg?.message || !msg?.key?.remoteJid) return;

    const remoteJid = msg.key.remoteJid;
    if (remoteJid === 'status@broadcast' || remoteJid === config.NEWSLETTER_JID) return;

    const sessionId = number || (socket.user?.id?.split(':')[0] + '@s.whatsapp.net') || socket.user?.id;
    const sanitizedBot = String(number || socket.user?.id?.split(':')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await loadSessionConfigMerged(sessionId);
    const hasReactionCommandMappings = sessionHasReactionCommands(sanitizedBot);

    // Le store n'est utile que pour l'anti-delete activé ou les commandes par
    // réaction. Auparavant chaque session y gardait tous les messages même si
    // la fonctionnalité était désactivée.
    if (normaliseAntideleteMode(cfg.antidelete) === 'off' && !hasReactionCommandMappings) {
      deleteSessionStore(sanitizedBot);
    } else {
      for (const incoming of [msg]) {
        if (!incoming?.key?.id || !incoming?.message) continue;
        if (unwrapAntideleteMessage(incoming.message).message?.reactionMessage) continue;
        if (shouldCacheIncomingMessage({
          antideleteMode: cfg.antidelete,
          hasReactionCommands: hasReactionCommandMappings,
          chatId: incoming.key.remoteJid
        })) {
          // Inclut aussi les messages envoyés depuis le compte lié : key.fromMe
          // permet d'identifier correctement auteur et suppresseur.
          storeMessage(sanitizedBot, incoming);
        }
      }
    }

    // 2. Déterminer le type de message pour extraire le body
    let type = getContentType(msg.message);

    // Déballer les messages éphémères puis recalculer le type interne afin que
    // les commandes continuent de passer avant le chatbot.
    if (type === 'ephemeralMessage') {
      msg.message = msg.message.ephemeralMessage.message;
      type = getContentType(msg.message);
    }

    // Les votes Baileys sont chiffrés; le secret et l’identifiant du sondage
    // sont conservés dans le quiz actif, sans ouvrir de connexion WhatsApp tierce.
    const pollUpdate = msg.message?.pollUpdateMessage;
    if (pollUpdate) {
      const sessionId = String(number || socket.user?.id?.split(':')[0] || '').replace(/[^0-9]/g, '');
      const creationKey = pollUpdate.pollCreationMessageKey;
      const state = animeQuiz.getState(sessionId, remoteJid);
      const pollMessage = state?.question?.pollMessage;
      const matchesPoll = state?.question?.poll
        && pollMessage?.key?.id
        && pollMessage.key.id === creationKey?.id
        && pollMessage.key.remoteJid === remoteJid;
      if (!matchesPoll || typeof decryptPollVote !== 'function' || typeof getKeyAuthor !== 'function') return;
      const pollContent = unwrapAntideleteMessage(pollMessage.message).message || {};
      const pollSecret = pollContent.messageContextInfo?.messageSecret;
      const vote = pollUpdate.vote;
      if (!pollSecret || !vote?.encPayload || !vote?.encIv) return;
      try {
        const myJid = jidNormalizedUser(socket.user?.id || '');
        const decryptedVote = decryptPollVote(vote, {
          pollEncKey: pollSecret,
          pollCreatorJid: getKeyAuthor(creationKey, myJid),
          pollMsgId: creationKey.id,
          voterJid: getKeyAuthor(msg.key, myJid)
        });
        animeQuiz.submitPollVote(sessionId, remoteJid, getKeyAuthor(msg.key, myJid), decryptedVote.selectedOptions || []);
      } catch (error) {
        console.warn('[ANIME QUIZ] Déchiffrement du vote impossible :', error?.message || error);
      }
      return;
    }

    // ── INTERCEPTION DES RÉACTIONS EMOJIS ASSOCIÉES À DES COMMANDES (.setcmd <cmd>, <emoji>) ──
    const reactionMsg = (type === 'reactionMessage') ? msg.message.reactionMessage : msg.message?.reactionMessage;
    if (reactionMsg && reactionMsg.text) {
      const emojiReact = reactionMsg.text;
      const matchedReactCmd = findReactionCommand(emojiReact, sanitizedBot);
      if (matchedReactCmd && matchedReactCmd.command) {
        const targetKey = reactionMsg.key;
        const targetMsgId = targetKey?.id;
        const targetChat = targetKey?.remoteJid || remoteJid;
        const storedTarget = getStoredMessage(sanitizedBot, targetMsgId);
        const reactionCachedTarget = reactionTargetCache.get(sanitizedBot, targetMsgId);
        const targetMsg = await resolveReactionTargetMessage({
          cachedMessage: storedTarget || reactionCachedTarget,
          socket,
          targetKey: { ...targetKey, remoteJid: targetChat }
        });
        if (!targetMsg) {
          console.warn(
            `[REACTION-CMD] Cible ${targetMsgId || '(sans id)'} introuvable pour ${number}; `
            + `antidelete=${Boolean(storedTarget)}, cacheMedia=${Boolean(reactionCachedTarget)}, `
            + `tailleCacheMedia=${reactionTargetCache.size(sanitizedBot)}.`
          );
          await socket.sendMessage(targetChat, {
            text: '❌ Je ne retrouve pas le message visé par cette réaction. Réagis à nouveau après que le bot a reçu le média.'
          }, { quoted: msg }).catch(() => {});
          return;
        }

        const reactorJid = msg.key.fromMe 
          ? (socket.user?.id ? (socket.user.id.split(':')[0] + '@s.whatsapp.net') : msg.key.remoteJid)
          : (msg.key.participant || msg.key.remoteJid);
        const reactorNumber = (reactorJid || '').split('@')[0].split(':')[0];

        // Vérifier le mode privé et les droits avec la même source que les commandes texte.
        const sessionCfg = cfg;
        const reactorIdentifiers = collectMessageIdentifiers(msg, reactorJid, reactorNumber);
        const reactorAccess = resolveAccess({
          identifiers: reactorIdentifiers,
          ownerValue: config.OWNER_NUMBER,
          adminEntries: await loadAdminsFromMongo(),
          sudoEntries: sessionCfg.SUDO_USERS || [],
          sessionNumber: sanitizedBot
        });
        const isReactorOwner = reactorAccess.isConfiguredOwner;
        if (sessionCfg && sessionCfg.MODE === 'private' && !reactorAccess.isPrivileged) {
          return;
        }

        await wakeForCommand(socket, msg, sessionCfg);
        const cmdPrefix = resolveSessionPrefix(sessionCfg, config.PREFIX || '.');
        const fullCmdStr = matchedReactCmd.command;
        const fullBody = `${cmdPrefix}${fullCmdStr}`;
        const cmdName = fullCmdStr.split(' ')[0].toLowerCase();
        const cmdArgs = fullCmdStr.split(' ').slice(1);

        const quotedPayload = targetMsg?.message || null;
        const quotedParticipant = targetMsg?.key?.participant
          || targetMsg?.key?.participantAlt
          || targetKey?.participant
          || targetKey?.participantAlt
          || (!String(targetChat).endsWith('@g.us') ? targetChat : null);

        const syntheticMsg = {
          key: {
            remoteJid: targetChat,
            fromMe: msg.key.fromMe,
            id: msg.key.id || `REACT_CMD_${Date.now()}`,
            participant: reactorJid
          },
          message: {
            extendedTextMessage: {
              text: fullBody,
              contextInfo: {
                stanzaId: targetMsgId,
                participant: quotedParticipant,
                quotedMessage: quotedPayload
              }
            }
          },
          quoted: targetMsg ? {
            msg: targetMsg.message,
            sender: quotedParticipant,
            id: targetMsgId
          } : null
        };

        console.log(`🎯 [REACTION-CMD] Emoji "${emojiReact}" intercepté ➔ Exécution de : "${fullBody}" sur le message ${targetMsgId}`);

        const isHandled = await executePlugin(cmdName, {
          socket,
          downloadContentFromMessage,
          msg: syntheticMsg,
          from: targetChat,
          sender: reactorJid,
          senderNumber: reactorNumber,
          pushName: msg.pushName || '',
          sessionNumber: String(number || sanitizedBot).replace(/[^0-9]/g, ''),
          legacyCommands: [...LEGACY_COMMANDS],
          args: cmdArgs,
          body: fullBody,
          isOwner: isReactorOwner,
          isSessionOwner: reactorAccess.isSessionOwner,
          isMongoAdmin: reactorAccess.isMongoAdmin,
          isSudo: reactorAccess.isSudo,
          isPrivileged: reactorAccess.isPrivileged,
          access: reactorAccess,
          config,
          sessionCfg,
          prefix: cmdPrefix,
          command: cmdName,
          quoted: quotedPayload,
          quotedMsg: quotedPayload,
          quotedSender: quotedParticipant,
          isReactionCommand: true,
          getAlbumImages: (chatJid, parentMessageId, quotedMessage) =>
            mediaAlbumStore.getImages(chatJid, parentMessageId, quotedMessage),
          activeSockets,
          loadUserConfigFromMongo,
          setUserConfigInMongo,
          getPluginsByCategory,
          getAllPluginsList
        });

        if (isHandled) return;
      }
    }
    
    // 3. Extraire le texte du message
    let body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage?.text
      : (type === 'imageMessage') ? msg.message.imageMessage?.caption
      : (type === 'videoMessage') ? msg.message.videoMessage?.caption
      : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
      : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
      : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') 
      : (type === 'interactiveResponseMessage') ? (() => {
      try {
        // quick_reply carousel → paramsJson contient { id: ".dlapk nom lien" }
        const raw = msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.id) return parsed.id;        // ← ".dlapk nom lien"
        }
      } catch(_) {}
      // fallback : body text brut (autres types interactifs)
      return msg.message.interactiveResponseMessage?.body?.text || '';
    })()
  : '';

    // Détection de Sticker Command (Sticker associé à une commande)
    const stickerMsgObj = (type === 'stickerMessage') ? msg.message.stickerMessage : msg.message?.stickerMessage;
    if (stickerMsgObj) {
      const stickerSessionId = String(number || socket.user?.id?.split(':')[0] || '').replace(/[^0-9]/g, '');
      const matchedCmd = findStickerCommand(stickerMsgObj, stickerSessionId);
      if (matchedCmd && matchedCmd.command) {
        const stickerCfg = cfg;
        const cmdPrefix = resolveSessionPrefix(stickerCfg, config.PREFIX || '.');
        body = `${cmdPrefix}${matchedCmd.command}`;
        console.log(`🎯 [STICKER-CMD] Sticker identifié ! Déclenchement automatique de : "${body}"`);

        // Propager le contextInfo (reply / quotedMessage / participant / mentionedJid)
        const ctxInfo = stickerMsgObj.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        if (ctxInfo) {
          if (!msg.message.extendedTextMessage) {
            msg.message.extendedTextMessage = {
              text: body,
              contextInfo: ctxInfo
            };
          } else {
            msg.message.extendedTextMessage.contextInfo = {
              ...ctxInfo,
              ...msg.message.extendedTextMessage.contextInfo
            };
          }
        }
      }
    }
    
    // Normaliser le body
    const normalizedBody = (typeof body === 'string') ? body.trim() : '';
    
    // La configuration de session a été chargée une fois au début de l’upsert.

    // Les réponses numériques des sélecteurs `.swgc`, `.style` et
    // `.tostatus new group` sont distinguées avant le routeur de commandes.
    if (!remoteJid.endsWith('@g.us') && /^\d+$/.test(normalizedBody)) {
      const selectionActor = actorIdFromMessage(socket, msg, remoteJid);
      const selection = resolveGroupSelection(sessionId, selectionActor, normalizedBody);
      if (selection.status !== 'none') {
        const isStatusAudienceSelection = selection.purpose === STATUS_AUDIENCE_SELECTION_PURPOSE;
        const isStyledAudioSelection = selection.purpose === 'style';
        const selectionCommand = isStatusAudienceSelection
          ? 'tostatus'
          : isStyledAudioSelection ? 'style' : 'swgc';
        const selectedPrefix = resolveSessionPrefix(cfg, config.PREFIX || '.');
        await wakeForCommand(socket, msg, cfg);

        if (selection.status === 'selected' && isStatusAudienceSelection) {
          try {
            const result = await completeStatusAudienceGroupSelection({
              socket,
              sessionNumber: sessionId,
              sessionCfg: cfg,
              setUserConfigInMongo
            }, selection.group);
            const unresolved = result.unresolvedParticipants
              ? `\n⚠️ ${result.unresolvedParticipants} membre(s) sans numéro résolvable ont été ignorés (dont les LID sans correspondance).`
              : '';
            await socket.sendMessage(remoteJid, {
              text: `✅ Groupe ajouté au public du statut : *${result.groupSubject || selection.group.subject}*.\n` +
                `${result.added} numéro(s) ajouté(s), ${result.alreadyPresent} déjà présent(s), ${result.total} au total.${unresolved}\n` +
                `Pour ajouter un autre groupe : ${selectedPrefix}tostatus new group.`
            }, { quoted: msg });
          } catch (error) {
            await socket.sendMessage(remoteJid, {
              text: `❌ Ajout du groupe impossible : ${error?.message || error}`
            }, { quoted: msg });
          }
        } else if (selection.status === 'selected' && isStyledAudioSelection) {
          await socket.sendMessage(remoteJid, {
            text: `✅ Groupe ciblé pour les audios stylisés : *${selection.group.subject}*\n\n` +
              `Réponds à un audio avec ${selectedPrefix}style pour publier sa vidéo Kaido sur le statut de ce groupe.`
          }, { quoted: msg });
        } else if (selection.status === 'selected') {
          await socket.sendMessage(remoteJid, {
            text: `✅ Groupe ciblé : *${selection.group.subject}*\n\n` +
              `Tu peux utiliser ${selectedPrefix}swgc <texte>[, couleur] ` +
              `(alias ${selectedPrefix}gcstatus) ou répondre à une image, vidéo ou un audio brut.\n` +
              'Couleurs : violet, bleu nuit, cyan, rose, or ou #rrggbb.'
          }, { quoted: msg });
        } else if (selection.status === 'invalid') {
          await socket.sendMessage(remoteJid, {
            text: `❌ Choix invalide. Réponds avec un numéro entre ${selection.min} et ${selection.max}.`
          }, { quoted: msg });
        } else if (selection.status === 'expired') {
          const retry = isStatusAudienceSelection
            ? `${selectedPrefix}tostatus new group`
            : isStyledAudioSelection ? `${selectedPrefix}style` : `${selectedPrefix}swgc`;
          await socket.sendMessage(remoteJid, {
            text: `⌛ La sélection a expiré. Relance ${retry}.`
          }, { quoted: msg });
        }
        return;
      }
    }
    
    // --- Traitement antilink (déjà existant) ---
    if (remoteJid && remoteJid.endsWith('@g.us')) {
      try {
        const handled = await handleAntiLink(socket, msg, remoteJid, normalizedBody);
        if (handled) return; // message supprimé/traité -> stop further processing
      } catch (e) {
        console.error('ANTILINK HANDLER ERROR', e);
      }
    }
    
    // --- DÉBUT ANTI-TAG (pour les mentions de statut de groupe) ---
    if (msg.message?.groupStatusMentionMessage) {
      try {
        const jid = remoteJid;
        // Ne pas traiter si ce n'est pas un groupe ou si c'est un message du bot
        if (!jid.endsWith('@g.us') || msg.key.fromMe) return;

        const mode = resolveAntiStatusMode(cfg.ANTI_TAG_MODE);
        if (mode === 'off') return;

        // Groupe exempté (personnalisable)
        const exemptGroup = "120363156185607326@g.us"; // Remplace par ton groupe si besoin
        if (jid === exemptGroup) return;

        // Récupérer les métadonnées du groupe pour vérifier les admins
        const groupMetadata = await socket.groupMetadata(jid).catch(() => null);
        if (!groupMetadata) return;

        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderParticipant = findGroupParticipant(groupMetadata, [senderJid, msg.key?.participantAlt]);
        if (!senderParticipant) return;
        const senderActionJid = getParticipantId(senderParticipant);
        const senderMentionJid = getParticipantMentionJid(senderParticipant) || senderActionJid;
        if (!senderActionJid) return;

        // Vérifier les identifiants PN/LID de l'expéditeur et du bot.
        const isSenderAdmin = isGroupAdmin(groupMetadata, senderParticipant);
        const isBotAdmin = isBotGroupAdmin(groupMetadata, socket);

        // Si l'utilisateur est admin : simple avertissement, pas de sanction
        if (isSenderAdmin) {
          await socket.sendMessage(jid, {
            text: formatKaidoStatusMention('Mention de statut détectée', [
              `Administrateur : @${senderMentionJid.split('@')[0]}`,
              'Les administrateurs sont exemptés de sanction.',
              'Merci de limiter les mentions au nécessaire.'
            ]),
            mentions: [senderMentionJid]
          });
          return;
        }

        // Si le bot n'est pas admin : on prévient mais on ne peut pas supprimer
        if (!isBotAdmin) {
          await socket.sendMessage(jid, {
            text: formatKaidoStatusMention('Mention de statut détectée', [
              `Membre : @${senderMentionJid.split('@')[0]}`,
              'Kaido MD ne peut pas la supprimer sans droits d’administrateur.',
              'Un administrateur peut accorder ces droits au bot.'
            ]),
            mentions: [senderMentionJid]
          });
          return;
        }

        // Supprimer le message de mention de statut
        await socket.sendMessage(jid, {
          delete: {
            remoteJid: jid,
            fromMe: false,
            id: msg.key.id,
            participant: senderJid
          }
        });

        // Action selon le mode
        if (mode === 'delete') {
          await socket.sendMessage(jid, {
            text: formatKaidoStatusMention('Mention de statut supprimée', [
              `Membre : @${senderMentionJid.split('@')[0]}`,
              'Merci de respecter les règles de ce groupe.',
              'Une récidive peut entraîner une exclusion.'
            ]),
            mentions: [senderMentionJid]
          });
        } else if (mode === 'remove') {
          try {
            await socket.groupParticipantsUpdate(jid, [senderActionJid], 'remove');
            await socket.sendMessage(jid, {
              text: formatKaidoStatusMention('Membre exclu après récidive', [
                `Membre : @${senderMentionJid.split('@')[0]}`,
                'La mention a été supprimée et la récidive a entraîné une exclusion.'
              ]),
              mentions: [senderMentionJid]
            });
          } catch (kickErr) {
            await socket.sendMessage(jid, {
              text: formatKaidoStatusMention('Expulsion impossible', [
                `Membre : @${senderMentionJid.split('@')[0]}`,
                'Kaido MD ne dispose pas des droits nécessaires pour cette action.'
              ]),
              mentions: [senderMentionJid]
            });
          }
        }
      } catch (antitagErr) {
        console.error('[ANTITAG ERROR]', antitagErr);
      }
    }
    // --- FIN ANTI-TAG ---

    // En mode chatbot, les messages média sont décrits sans téléverser leurs
    // octets; hors mode chatbot ils restent ignorés comme auparavant.
    const autoChatbotInput = configEnabled(cfg.CHATBOT_ENABLED, false) && !msg.key.fromMe
      ? getChatbotInput(msg, body)
      : null;
    if ((!body || typeof body !== 'string') && !autoChatbotInput) {
      await handleIgnoredMessage(socket, msg, cfg);
      return;
    }

    const tttFrom = remoteJid;
    const normalizedBotJid = socket.user?.id
      ? (jidNormalizedUser(socket.user.id) || socket.user.id)
      : '';
    const tttSender = msg.key.fromMe
      ? normalizedBotJid
      : (msg.key.participant || remoteJid);

    const isTttMove = await handleTicTacToeMove(socket, msg, tttFrom, tttSender, body);
    if (isTttMove) {
      await wakeForCommand(socket, msg, cfg);
      return;
    }

    // 4. Résoudre le préfixe de cette session. Une chaîne vide signifie
    // "prefixless" et impose une validation du premier mot dans le registre.
    const prefix = resolveSessionPrefix(cfg, config.PREFIX || '.');
    const parsedCommand = parseCommandInput(body, prefix, isKnownCommandName);
    const isRegisteredCommand = Boolean(parsedCommand && isKnownCommandName(parsedCommand.command));
    const activeQuiz = animeQuiz.getState(sanitizedBot, remoteJid);
    const looksLikePrefixedCommand = Boolean(prefix && String(body || '').trim().startsWith(prefix));
    if (!msg.key.fromMe && !parsedCommand && !looksLikePrefixedCommand
      && activeQuiz?.question && !activeQuiz.question.poll && !activeQuiz.question.resolved) {
      const quizSender = msg.key.participant || remoteJid;
      const answerResult = animeQuiz.submitTextAnswer(sanitizedBot, remoteJid, quizSender, body);
      if (answerResult.handled) {
        await wakeForCommand(socket, msg, cfg);
        if (answerResult.correct) {
          const verdictMessage = formatQuizVerdict(answerResult.verdict);
          await socket.sendMessage(remoteJid, {
            text: verdictMessage.text,
            mentions: verdictMessage.mentions
          }, { quoted: msg });
        } else if (answerResult.notify) {
          await socket.sendMessage(remoteJid, {
            text: `❌ Pas tout à fait, @${String(quizSender).split('@')[0]}. Réessaie si le temps n’est pas écoulé !`,
            mentions: [quizSender]
          }, { quoted: msg });
        }
        return;
      }
    }
    const shouldUseChatbot = shouldRouteToChatbot({
      enabled: configEnabled(cfg.CHATBOT_ENABLED, false),
      fromMe: msg.key.fromMe,
      parsedCommand,
      isKnownCommand: isKnownCommandName
    });
    if (shouldUseChatbot) {
      const handledByChatbot = await handleAutoChatbotMessage({
        socket,
        msg,
        remoteJid,
        sessionConfig: cfg,
        sessionNumber: sanitizedBot,
        input: autoChatbotInput || getChatbotInput(msg, body)
      });
      if (handledByChatbot) return;
    }
    if (!isRegisteredCommand) {
      await handleIgnoredMessage(socket, msg, cfg);
      return;
    }
    const { command, args } = parsedCommand;
    // 5. Récupérer les informations d'expéditeur
    const from = remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe
      ? normalizedBotJid
      : (msg.key.participant || remoteJid);
    const senderNumber = (nowsender || '').split('@')[0].split(':')[0];
    const sessionCfg = cfg;

    // WhatsApp utilise parfois un LID dans les groupes. participantAlt fournit
    // généralement le numéro; sinon on complète depuis les métadonnées du groupe.
    const senderIdentifiers = collectMessageIdentifiers(msg, nowsender, senderNumber);
    if (from.endsWith('@g.us') && String(nowsender).includes('@lid')) {
      try {
        const metadata = await socket.groupMetadata(from);
        const participant = (metadata?.participants || []).find(item => {
          const values = [item.id, item.jid, item.lid, item.phoneNumber, item.pn]
            .filter(Boolean)
            .map(value => String(value).toLowerCase());
          return values.some(value => senderIdentifiers.has(value));
        });
        if (participant) addIdentifierCandidates(senderIdentifiers, participant);
      } catch (error) {
        console.warn('[ACCESS] Résolution LID impossible:', error?.message || error);
      }
    }

    const mongoAdmins = await loadAdminsFromMongo();
    const access = resolveAccess({
      identifiers: senderIdentifiers,
      ownerValue: config.OWNER_NUMBER,
      adminEntries: mongoAdmins,
      sudoEntries: sessionCfg.SUDO_USERS || [],
      sessionNumber: sanitizedBot
    });
    const isOwner = access.isConfiguredOwner;
    const { isSessionOwner, isMongoAdmin, isSudo, isPrivileged } = access;

    // En mode privé, les propriétaires et admins Mongo restent autorisés.
    // L’usage de `.swgc` et du mode audio `.style` dans un groupe reste ouvert
    // à tous les membres, comme le prévoit le mode groupe de ces commandes.
    const publicGroupStatusCommand = isPublicGroupStatusCommand(from, command);
    if (sessionCfg && sessionCfg.MODE === 'private' && !isPrivileged && !publicGroupStatusCommand) {
      await handleIgnoredMessage(socket, msg, sessionCfg);
      return;
    }

    // Marquer la commande comme lue sans afficher la présence; seuls les
    // envois de réponse repassent temporairement le socket en ligne.
    await wakeForCommand(socket, msg, sessionCfg);
    // Évite les écritures de logs synchrones et l’exposition du contenu privé
    // à chaque commande; le détail n’est activé qu’en mode debug.
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug('[COMMAND]', command, remoteJid.endsWith('@g.us') ? 'group' : 'private');
    }
    
    // 6. Maintenant, traiter les commandes
    // helper: download quoted media into buffer
    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    if (!command) return;

    // ── Exécution des plugins modulaires ──
    try {
      const isHandled = await executePlugin(command, {
        socket,
        downloadContentFromMessage,
        msg,
        from,
        sender: nowsender,
        senderNumber,
        pushName: msg.pushName || '',
        sessionNumber: sanitizedBot,
        legacyCommands: [...LEGACY_COMMANDS],
        args,
        body,
        isOwner,
        isSessionOwner,
        isMongoAdmin,
        isSudo,
        isPrivileged,
        access,
        config,
        sessionCfg,
        prefix,
        command,
        activeSockets,
        loadUserConfigFromMongo,
        setUserConfigInMongo,
        getPluginsByCategory,
        getAllPluginsList,
        getAlbumImages: (chatJid, parentMessageId, quotedMessage) =>
          mediaAlbumStore.getImages(chatJid, parentMessageId, quotedMessage)
      });
      if (isHandled) return;
    } catch (pluginErr) {
      console.error(`[PLUGIN EXEC ERROR: ${command}]`, pluginErr);
    }

    try {
      switch (command) {
      case 'post':
case 'status': {
  try {
    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

    // 1. Vérifier si on répond à un message (quoted)
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg) {
      return await socket.sendMessage(from, { 
        text: '❌ *Erreur :* Vous devez répondre à un média (Image, Vidéo, Audio) ou à un texte avec cette commande pour le poster sur votre statut.' 
      }, { quoted: msg });
    }

    // Détecter le type de contenu auquel on répond
    const isImage = quotedMsg.imageMessage || quotedMsg.viewOnceMessage?.message?.imageMessage || quotedMsg.viewOnceMessageV2?.message?.imageMessage;
    const isVideo = quotedMsg.videoMessage || quotedMsg.viewOnceMessage?.message?.videoMessage || quotedMsg.viewOnceMessageV2?.message?.videoMessage;
    const isAudio = quotedMsg.audioMessage; 
    const isText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text;

    // Identifiant cible officiel pour publier sur le statut du numéro du bot
    const statusJid = 'status@broadcast';

    // 2. Traitement si c'est une IMAGE ou une VIDÉO
    if (isImage || isVideo) {
      await socket.sendMessage(from, { text: '⏳ *Téléchargement et publication du média sur votre statut...*' }, { quoted: msg });
      
      const fakeQuoted = { key: msg.key, message: quotedMsg };
      const buffer = await downloadMediaMessage(fakeQuoted, 'buffer', {}, { 
        logger: pino({ level: 'silent' }),
        reconnector: socket
      });

      if (!buffer) return await socket.sendMessage(from, { text: '❌ Échec du téléchargement du média.' }, { quoted: msg });

      const caption = args.join(' ') || quotedMsg.imageMessage?.caption || quotedMsg.videoMessage?.caption || '';

      if (isImage) {
        await socket.sendMessage(statusJid, { image: buffer, caption: caption });
      } else {
        await socket.sendMessage(statusJid, { video: buffer, caption: caption });
      }

      await socket.sendMessage(from, { text: '✅ *Média posté avec succès sur votre statut !*' }, { quoted: msg });

    // 3. Traitement si c'est un message AUDIO (Téléchargement via Stream sécurisé)
    } else if (isAudio) {
      await socket.sendMessage(from, { text: '⏳ *Téléchargement et conversion de l\'audio en statut vocal...*' }, { quoted: msg });

      // Utilisation de la méthode swgc : Téléchargement par morceaux (chunks) via le flux Baileys
      const stream = await downloadContentFromMessage(quotedMsg.audioMessage, 'audio');
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (!buffer || buffer.length === 0) {
        return await socket.sendMessage(from, { text: '❌ Échec de la récupération du flux audio.' }, { quoted: msg });
      }

      // Envoi de l'audio formaté en note vocale (PTT) directement sur le statut du bot
      await socket.sendMessage(statusJid, { 
        audio: buffer, 
        mimetype: quotedMsg.audioMessage.mimetype || 'audio/mp4',
        ptt: true // Force l'affichage en note vocale interactive
      }, {
        backgroundColor: '#1A1A24' // Couleur de fond du statut vocal
      });

      await socket.sendMessage(from, { text: '✅ *Audio converti et posté sous forme de note vocale sur votre statut !*' }, { quoted: msg });

    // 4. Traitement si c'est un TEXTE SIMPLE
    } else if (isText) {
      const textToPost = args.join(' ') || quotedMsg.conversation || quotedMsg.extendedTextMessage?.text;
      
      await socket.sendMessage(statusJid, { 
        text: textToPost,
        backgroundColor: '#111111', 
        font: 3                     
      });

      await socket.sendMessage(from, { text: '✅ *Texte posté avec succès sur votre statut !*' }, { quoted: msg });

    } else {
      await socket.sendMessage(from, { text: '❌ Type de média non supporté.' }, { quoted: msg });
    }

  } catch (err) {
    console.error('ERROR IN POST COMMAND:', err);
    await socket.sendMessage(from, { text: `❌ Une erreur est survenue : ${err.message}` }, { quoted: msg });
  }
  break;
}
    
      case 'mode': {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = primaryOwnerNumber();

  // Vérification de sécurité (seul le owner ou la session modifie)
  if (!(isOwner || isSessionOwner)) {
    return await socket.sendMessage(from, { text: '❌ Seul le propriétaire peut changer le mode du bot.' }, { quoted: msg });
  }

  const newMode = args[0]?.toLowerCase();
  if (!newMode || (newMode !== 'public' && newMode !== 'private')) {
    return await socket.sendMessage(from, { text: `🎵 *Configuration du Mode*\n\nUsage: *${sessionCfg.PREFIX}mode public* ou *private*\nStatut actuel: *${sessionCfg.MODE}*` }, { quoted: msg });
  }

  let cfg = await loadUserConfigFromMongo(sanitized) || {};
  cfg.MODE = newMode;
  await setUserConfigInMongo(sanitized, cfg);

  await socket.sendMessage(from, { text: `✅ *Mode mis à jour avec succès !*\nLe bot est désormais en mode : *${newMode}*` }, { quoted: msg });
  break;
}
      
      case 'ttt':
case 'tictactoe': {
  try {
    if (String(args[0] || '').toLowerCase() === 'solo') {
      if (!isSessionOwner) {
        await socket.sendMessage(from, {
          text: '⛔ Le mode solo est réservé au propriétaire de cette session.'
        }, { quoted: msg });
        break;
      }
      await startSoloTicTacToe(socket, msg, from, nowsender);
      break;
    }

    let opponentJid = msg.message?.extendedTextMessage?.contextInfo?.participant
      || msg.message?.extendedTextMessage?.contextInfo?.participantAlt;
    if (!opponentJid) {
      opponentJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || msg.message?.extendedTextMessage?.contextInfo?.mentionedJidAlt?.[0];
    }
    await startTicTacToe(socket, msg, from, nowsender, opponentJid);
  } catch (e) {
    console.error('[TTT COMMAND ERROR]', e);
    await socket.sendMessage(from, { text: `❌ Impossible de lancer la partie : ${e?.message || 'erreur inconnue'}` }, { quoted: msg }).catch(() => {});
  }
  break;
}

case 'delttt':
case 'removettt': {
  const deleted = deleteGame(socket, from);
  if (deleted) {
    await socket.sendMessage(from, { text: `🛑 *La partie de Morpion rétro a été annulée avec succès.*` }, { quoted: msg });
  } else {
    await socket.sendMessage(from, { text: `❌ Aucune partie active trouvée dans ce salon.` }, { quoted: msg });
  }
  break;
}

      case 'setlang': {
  try {
    const newLang = args[0]?.toLowerCase()?.trim();
    if (!newLang || !['fr', 'en', 'es', 'ht'].includes(newLang)) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃ 🌐 *KAIDO MULTILANG* ┃\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Langue manquante ou non prise en charge.\n\n` +
              `📌 *Catalogues locaux disponibles :*\n` +
              `• ${prefix}setlang fr _(Français)_\n` +
              `• ${prefix}setlang en _(English)_\n` +
              `• ${prefix}setlang es _(Español)_\n` +
              `• ${prefix}setlang ht _(Kreyòl ayisyen)_`
      }, { quoted: msg });
      break;
    }

    const sessionId = number || socket.user?.id?.split(':')[0];
    
    // Appel direct de la fonction importée depuis translation.js
    await saveSessionLanguage(sessionId, newLang);

    await socket.sendMessage(from, { react: { text: '🌐', key: msg.key } });
    await socket.sendMessage(sender, { 
      text: `✅ *Configuration réussie !*\n\nLes réponses statiques utilisent désormais le catalogue local *${newLang.toUpperCase()}*. L’IA et les quiz répondront dans cette langue.`
    }, { quoted: msg });

  } catch (e) {
    console.error('[SETLANG ERROR]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors du changement de langue : ${e.message}` }, { quoted: msg });
  }
  break;
}
 
              case 'fullpp': {
  const { plag, jid, msg, quotedMsg, cfg, reply, isOwner } = ctx;
  if (!isOwner) return reply(`❌ ${F.bold('Réservé au propriétaire.')}`);

  const target = quotedMsg?.message ? quotedMsg : msg;
  let content = target.message || target;
  if (content?.ephemeralMessage) content = content.ephemeralMessage.message;
  if (content?.viewOnceMessage) content = content.viewOnceMessage.message;
  if (content?.viewOnceMessageV2) content = content.viewOnceMessageV2.message;

  const isImage = content && (content.imageMessage || content.documentMessage?.mimetype?.startsWith('image/'));
  const payload = content?.imageMessage || content?.documentMessage;
  if (!isImage || !payload) {
    return reply(`❗ Réponds à une image avec la commande \`${cfg.PREFIX}fullpp\``);
  }

  try {
    await plag.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
    const buffer = await downloadBuffer(plag, target);
    if (!buffer) throw new Error("Le téléchargement du média a échoué.");

    // 🔹 Fonction intégrée directement ici
    const prepareProfilePicture = async (buffer) => {
      const image = await jimp.read(buffer);
      const width = image.getWidth();
      const height = image.getHeight();
      const size = Math.max(width, height);

      // Créer un fond carré (blanc)
      const background = new jimp(size, size, '#FFFFFF');
      background.composite(image, (size - width) / 2, (size - height) / 2);

      // Redimensionner à 720x720
      const final = background.resize(720, 720).normalize().quality(100);

      return {
        img: await final.getBufferAsync(jimp.MIME_JPEG),
        preview: await final.getBufferAsync(jimp.MIME_JPEG),
      };
    };

    const { img } = await prepareProfilePicture(buffer);
    const botJid = plag.user.id.split(':')[0] + '@s.whatsapp.net';

    if (typeof plag.updateProfilePicture === 'function') {
      await plag.updateProfilePicture(botJid, img);
    } else {
      await plag.query({
        tag: 'iq',
        attrs: { to: botJid, type: 'set', xmlns: 'w:profile:picture', id: Date.now().toString() },
        content: [{ tag: 'picture', attrs: { type: 'image' }, content: img }]
      });
    }

    await reply('✅ Photo de profil du bot mise à jour avec succès.');
  } catch (e) {
    console.error('[ERROR fullpp]', e);
    await reply(`❌ Impossible de changer la photo de profil.\n\n📄 *Log Error:*\n\`\`\`${e.message || e}\`\`\``);
  } finally {
    await plag.sendMessage(jid, { react: { text: '', key: msg.key } });
  }
  break;
}
              // ============================================================
// BRATVIDEO — Sticker animé Brat
// ============================================================
case 'bratvid':
case 'bratvideo': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎬 *KAIDO STICKER TEXTE ANIMÉ*\n` +
              `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun texte fourni !\n\n` +
              `*Usage :* ${prefix}bratvideo <texte>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}bratvideo KAIDO MD\n` +
              `  ${prefix}bratvideo plag\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const text = args.join(' ').trim();

    await socket.sendMessage(from, { react: { text: '⚡', key: msg.key } });

    const mediaUrl = `https://brat.caliphdev.com/api/brat/animate?text=${encodeURIComponent(text)}`;

    // ── Télécharger le gif/webp animé ──
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 20000
    });
    const buffer = Buffer.from(response.data);

    if (!buffer || buffer.length === 0) {
      throw new Error('Téléchargement du média échoué.');
    }

    // ── Ajouter les métadonnées EXIF (packname + auteur) ──
    const webp   = require('node-webpmux');
    const crypto = require('crypto');

    async function addExif(webpSticker, packName, authorName) {
      const img           = new webp.Image();
      const stickerPackId = crypto.randomBytes(32).toString('hex');
      const json          = {
        'sticker-pack-id': stickerPackId,
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': ['🎬']
      };
      const exifAttr   = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ]);
      const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
      const exif       = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);
      await img.load(webpSticker);
      img.exif = exif;
      return await img.save(null);
    }

    let stickerBuffer;
    try {
      stickerBuffer = await addExif(buffer, text, 'KAIDO-MD');
    } catch(_) {
      // Si addExif échoue (pas un webp valide) → envoyer le buffer brut
      stickerBuffer = buffer;
    }

    // ── Envoyer comme sticker ──
    await socket.sendMessage(sender, {
      sticker: stickerBuffer
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[BRATVIDEO ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Échec génération brat video.\n_${e.message || e}_\n\n💡 Réessaie dans quelques secondes.`
    }, { quoted: msg });
  }
  break;
}
      
      // ============================================================
// SONG — Recherche + téléchargement audio YouTube
// ============================================================
case 'song': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎵 *KAIDO MUSIC*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun titre fourni !\n\n` +
              `*Usage :* ${prefix}song <titre>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}song Not Like Us\n` +
              `  ${prefix}song Drake God's Plan\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ').trim();

    if (query.length > 100) {
      await socket.sendMessage(sender, {
        text: `❌ Titre trop long ! Maximum 100 caractères.`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🎵 *KAIDO MUSIC*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔍 Recherche : *${query}*\n` +
            `⏳ Extraction audio en cours...`
    }, { quoted: msg });

    // ── Recherche YouTube ──
    const yts    = require('yt-search');
    const search = await yts(`${query} official`);
    const video  = search.videos[0];

    if (!video) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `😕 Aucun résultat pour *${query}*.\n\nEssaie un autre titre.`
      }, { quoted: msg });
      break;
    }

    // ── Appel API FAA ──
    const { data: apiData } = await axios.get(
      'https://api-faa.my.id/faa/ytplayvid',
      { params: { q: video.url }, timeout: 30000 }
    );

    let result = null;
    if (apiData?.result) {
      result = Array.isArray(apiData.result) ? apiData.result[0] : apiData.result;
    } else if (Array.isArray(apiData) && apiData.length) {
      result = apiData[0];
    }

    if (!result) throw new Error('Réponse API invalide.');

    const videoUrl = result.video     || result.url_video || result.download || result.mp4 || result.url || null;
    const title    = result.title     || result.judul     || video.title;
    const thumb    = result.thumbnail || result.gambar    || video.thumbnail || null;
    const artist   = result.channel   || result.artist    || video.author?.name || 'Artiste inconnu';
    const duration = result.duration  || result.durasi    || video.timestamp    || '?';

    if (!videoUrl) throw new Error('Aucun lien vidéo retourné par l\'API.');

    // ── Téléchargement vidéo ──
    const tempVid = path.join(os.tmpdir(), `kaido_song_v_${Date.now()}.mp4`);
    const tempAud = path.join(os.tmpdir(), `kaido_song_a_${Date.now()}.mp3`);

    const writer = fs.createWriteStream(tempVid);
    const stream = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
      timeout: 120000
    });
    stream.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // ── Extraction MP3 via ffmpeg ──
    await execPromise(`ffmpeg -y -i "${tempVid}" -vn -acodec libmp3lame -q:a 2 "${tempAud}"`);

    if (!fs.existsSync(tempAud) || fs.statSync(tempAud).size < 5000) {
      throw new Error('Extraction audio échouée.');
    }

    // ── Envoi audio avec vignette ──
    await socket.sendMessage(sender, {
      audio: fs.readFileSync(tempAud),
      mimetype: 'audio/mpeg',
      fileName: `${title.slice(0, 100)}.mp3`,
      contextInfo: {
        externalAdReply: {
          title,
          body: `🎤 ${artist}  |  ⏱ ${duration}`,
          thumbnailUrl: thumb,
          sourceUrl: video.url,
          mediaType: 1,
          renderLargerThumbnail: false
        }
      }
    }, { quoted: msg });

    // ── Confirmation ──
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🎵 *KAIDO MUSIC*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `📌 *${title}*\n` +
            `🎤 *Artiste :* ${artist}\n` +
            `⏱ *Durée   :* ${duration}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[SONG ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Échec extraction audio.\n_${e.message || e}_\n\n💡 Réessaie avec un autre titre.`
    }, { quoted: msg });
  } finally {
    setTimeout(() => {
      ['kaido_song_v_', 'kaido_song_a_'].forEach(pref => {
        try {
          fs.readdirSync(os.tmpdir())
            .filter(f => f.startsWith(pref))
            .forEach(f => {
              try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch(_) {}
            });
        } catch(_) {}
      });
    }, 15000);
  }
  break;
}

      // ============================================================
// TOURL — Convertit un média en lien direct (multi-hébergeurs)
// ============================================================
case 'tourl':
case 'tolink':
case 'upload': {
  try {
    // ── Récupérer le média cité ou le message lui-même ──
    const quotedCtx  = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg  = quotedCtx?.quotedMessage;

    const mediaTypes = [
      'imageMessage', 'videoMessage', 'audioMessage',
      'documentMessage', 'stickerMessage'
    ];

    let mediaMsg  = null;
    let mediaType = null;

    if (quotedMsg) {
      for (const t of mediaTypes) {
        if (quotedMsg[t]) { mediaMsg = quotedMsg[t]; mediaType = t; break; }
      }
    }
    if (!mediaMsg) {
      for (const t of mediaTypes) {
        if (msg.message?.[t]) { mediaMsg = msg.message[t]; mediaType = t; break; }
      }
    }

    if (!mediaMsg || !mediaType) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🔗 *KAIDO TOURL*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun média détecté !\n\n` +
              `💡 *Comment utiliser :*\n` +
              `  • Réponds à une image/vidéo/audio\n` +
              `    avec *${prefix}tourl*\n` +
              `  • Envoie un fichier avec la commande\n\n` +
              `📎 *Formats supportés :*\n` +
              `  Image, Vidéo, Audio, Document, Sticker\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '📤', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🔗 *KAIDO TOURL*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `⏳ Téléchargement du média...\n` +
            `📤 Upload en cours...`
    }, { quoted: msg });

    // ── Téléchargement ──
    const dlType = mediaType.replace('Message', '');
    const stream = await downloadContentFromMessage(mediaMsg, dlType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) throw new Error('Téléchargement du média échoué.');

    // ── Détection type fichier ──
    const { fromBuffer } = require('file-type');
    const fileInfo = await fromBuffer(buffer);
    const mime     = fileInfo?.mime || mediaMsg.mimetype || 'application/octet-stream';
    const ext      = fileInfo?.ext  || mime.split('/')[1]?.split(';')[0] || 'bin';
    const sizeMB   = (buffer.length / (1024 * 1024)).toFixed(2);
    const fileName = `kaido_${Date.now()}.${ext}`;
    const tempPath = path.join(os.tmpdir(), fileName);

    fs.writeFileSync(tempPath, buffer);

    // ── Upload sur plusieurs hébergeurs en parallèle ──

    // 1. CatBox
    async function uploadCatBox() {
      const form = new FormData();
      form.append('fileToUpload', fs.createReadStream(tempPath), fileName);
      form.append('reqtype', 'fileupload');
      form.append('userhash', '');
      const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data || !data.startsWith('https')) throw new Error('CatBox: réponse invalide');
      return data.trim();
    }

    // 2. Tmpfiles.org
    async function uploadTmpFiles() {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempPath), fileName);
      const { data } = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data?.data?.url) throw new Error('TmpFiles: réponse invalide');
      return data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    }

    // 3. 0x0.st
    async function upload0x0() {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempPath), fileName);
      const { data } = await axios.post('https://0x0.st', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data || !data.startsWith('https')) throw new Error('0x0: réponse invalide');
      return data.trim();
    }

    // 4. Uguu.se
    async function uploadUguu() {
      const form = new FormData();
      form.append('files[]', fs.createReadStream(tempPath), fileName);
      const { data } = await axios.post('https://uguu.se/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data?.files?.[0]?.url) throw new Error('Uguu: réponse invalide');
      return data.files[0].url;
    }

    // ── Lancer tous les uploads en parallèle ──
    const results = await Promise.allSettled([
      uploadCatBox(),
      uploadTmpFiles(),
      upload0x0(),
      uploadUguu()
    ]);

    // Nettoyage fichier temp
    setTimeout(() => {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch(_) {}
    }, 5000);

    const catbox   = results[0].status === 'fulfilled' ? results[0].value : null;
    const tmpfiles = results[1].status === 'fulfilled' ? results[1].value : null;
    const ox0      = results[2].status === 'fulfilled' ? results[2].value : null;
    const uguu     = results[3].status === 'fulfilled' ? results[3].value : null;

    // Au moins un doit avoir réussi
    if (!catbox && !tmpfiles && !ox0 && !uguu) {
      throw new Error('Tous les hébergeurs ont échoué. Réessaie dans quelques secondes.');
    }

    // ── Réponse stylée ──
    let txt = `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🔗 *KAIDO TOURL*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `✅ *Upload terminé !*\n\n` +
              `📎 *Type :* ${mime}\n` +
              `📦 *Taille :* ${sizeMB} MB\n` +
              `━━━━━━━━━━━━━━━━━━\n\n` +
              `🔗 *Liens directs :*\n\n`;

    if (catbox)   txt += `🟠 *CatBox :*\n${catbox}\n\n`;
    if (tmpfiles) txt += `🟣 *TmpFiles :*\n${tmpfiles}\n\n`;
    if (ox0)      txt += `⚫ *0x0.st :*\n${ox0}\n\n`;
    if (uguu)     txt += `🔵 *Uguu.se :*\n${uguu}\n\n`;

    txt += `━━━━━━━━━━━━━━━━━━\n> ${config.BOT_FOOTER}`;

    await socket.sendMessage(sender, { text: txt }, { quoted: msg });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[TOURL ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🔗 *KAIDO TOURL*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `❌ Échec de l'upload.\n\n` +
            `_${e.message || e}_\n\n` +
            `💡 Réessaie dans quelques secondes.\n\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });
  }
  break;
}
      // ============================================================
// MODAPK — Téléchargement APK via Aptoide Scraper
// ============================================================
// ============================================================
// MODAPK — Téléchargement APK direct via API Aptoide
// ============================================================
case 'modapk': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *KAIDO MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun nom d'application fourni !\n\n` +
              `*Usage :* ${prefix}modapk <nom app>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}modapk Spotify\n` +
              `  ${prefix}modapk Minecraft\n` +
              `  ${prefix}modapk Instagram\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ').trim();

    await socket.sendMessage(from, { react: { text: '🔍', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  📦 *KAIDO MOD APK*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔍 Recherche : *${query}*\n` +
            `⏳ Connexion à Aptoide...`
    }, { quoted: msg });

    // ── Recherche via API Aptoide directe ──
    const { data: searchData } = await axios.get(
      `https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`,
      { timeout: 15000 }
    );

    if (!searchData?.datalist?.list?.length) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *KAIDO MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `😕 Aucune application trouvée pour\n*${query}*\n\n` +
              `💡 Vérifie l'orthographe et réessaie.\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const app = searchData.datalist.list[0];

    const name    = app.name                || query;
    const dlLink  = app.file?.path          || null;
    const sizeMB  = app.file?.filesize
      ? parseFloat((app.file.filesize / (1024 * 1024)).toFixed(1))
      : null;
    const sizeStr = sizeMB ? `${sizeMB} MB` : 'Inconnue';
    const version = app.file?.vername       || null;
    const rating  = app.stats?.rating?.avg  || null;
    const pkg     = app.package_name        || null;
    const icon    = app.icon                || null;
    const dev     = app.store?.name         || null;

    if (!dlLink) {
      throw new Error('Lien de téléchargement introuvable pour cette application.');
    }

    // ── Vérification taille ──
    if (sizeMB && sizeMB > 200) {
      await socket.sendMessage(from, { react: { text: '⛔', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *KAIDO MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `⛔ *Fichier trop volumineux !*\n\n` +
              `📦 App     : *${name}*\n` +
              `📊 Taille  : *${sizeStr}*\n\n` +
              `💡 WhatsApp limite les fichiers à 200 MB.\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    // ── Confirmation avant envoi ──
    await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

    // Envoyer l'icône + infos en aperçu
    if (icon) {
      await socket.sendMessage(sender, {
        image: { url: icon },
        caption: `╭━━━━━━━━━━━━━━━━━━╮\n` +
                 `┃  📦 *KAIDO MOD APK*\n` +
                 `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                 `✅ *Application trouvée !*\n\n` +
                 `📦 *${name}*\n` +
                 (pkg     ? `🔖 Package : ${pkg}\n`      : '') +
                 (version ? `🏷️ Version : ${version}\n`  : '') +
                 (dev     ? `🏢 Store   : ${dev}\n`      : '') +
                 `📊 Taille  : ${sizeStr}\n` +
                 (rating  ? `⭐ Note    : ${rating}/5\n` : '') +
                 `\n📲 Envoi APK en cours...`
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *KAIDO MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `✅ *Application trouvée !*\n\n` +
              `📦 *${name}*\n` +
              (version ? `🏷️ Version : ${version}\n`  : '') +
              `📊 Taille  : ${sizeStr}\n` +
              `\n📲 Envoi APK en cours...`
      }, { quoted: msg });
    }

    // ── Envoi APK ──
    const fileName = `${name.replace(/[^a-zA-Z0-9]/g, '_')}_KaidoMD.apk`;

    await socket.sendMessage(sender, {
      document: { url: dlLink },
      mimetype: 'application/vnd.android.package-archive',
      fileName,
      caption: `╭━━━━━━━━━━━━━━━━━━╮\n` +
               `┃  📦 *KAIDO MOD APK*\n` +
               `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
               `📦 *${name}*\n` +
               (version ? `🏷️ Version : ${version}\n`  : '') +
               `📊 Taille  : ${sizeStr}\n` +
               (rating  ? `⭐ Note    : ${rating}/5\n` : '') +
               `\n━━━━━━━━━━━━━━━━━━\n` +
               `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[MODAPK ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  📦 *KAIDO MOD APK*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `❌ Échec du téléchargement.\n\n` +
            `_${e.message || 'Erreur inconnue.'}_\n\n` +
            `💡 Vérifie le nom de l'application.\n\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });
  }
  break;
}
      // ============================================================
// SHAZAM — Identification musicale via ACRCloud
// ============================================================
case 'shazam':
case 'quemusica':
case 'whatmusic':
case 'findmusic': {
  try {
    const acrcloud = require('acrcloud');
    const acr = new acrcloud({
      host: 'identify-eu-west-1.acrcloud.com',
      access_key: 'c33c767d683f78bd17d4bd4991955d81',
      access_secret: 'bvgaIAEtADBTbLwiPGYlxupWqkNGIjT7J9Ag2vIu'
    });

    // ── Récupérer le message cité ou le message lui-même ──
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;

    // Déterminer la source média
    const mediaTypes = ['audioMessage', 'videoMessage'];
    let mediaMsg = null;
    let mediaType = null;

    // Chercher dans le message cité d'abord
    if (quoted) {
      for (const t of mediaTypes) {
        if (quoted[t]) { mediaMsg = quoted[t]; mediaType = t; break; }
      }
    }
    // Sinon dans le message lui-même
    if (!mediaMsg) {
      for (const t of mediaTypes) {
        if (msg.message?.[t]) { mediaMsg = msg.message[t]; mediaType = t; break; }
      }
    }

    if (!mediaMsg || !mediaType) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎵 *KAIDO SHAZAM*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun audio/vidéo détecté !\n\n` +
              `💡 *Comment utiliser :*\n` +
              `  • Réponds à un audio/vidéo avec\n` +
              `    *${prefix}shazam*\n` +
              `  • Envoie un audio avec la commande\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🎵 *KAIDO SHAZAM*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔍 Identification en cours...\n` +
            `⏳ Analyse de l'audio...`
    }, { quoted: msg });

    // ── Téléchargement du média ──
    const mime = mediaMsg.mimetype || '';
    const ext  = mime.split('/')[1]?.split(';')[0] || (mediaType === 'audioMessage' ? 'mp3' : 'mp4');
    const tempPath = path.join(os.tmpdir(), `shazam_${Date.now()}.${ext}`);

    // Construire la key correcte pour le téléchargement
    const downloadKey = quoted
      ? { ...quotedCtx, id: quotedCtx?.stanzaId, remoteJid: quotedCtx?.participant || from }
      : msg.key;

    const stream = await downloadContentFromMessage(mediaMsg, mediaType.replace('Message', ''));
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) throw new Error('Téléchargement audio échoué.');

    fs.writeFileSync(tempPath, buffer);

    // ── Identification ACRCloud ──
    const result = await acr.identify(fs.readFileSync(tempPath));

    // Nettoyage immédiat
    try { fs.unlinkSync(tempPath); } catch(_) {}

    const { code, msg: statusMsg } = result.status;

    if (code !== 0) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎵 *KAIDO SHAZAM*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `😕 *Musique non reconnue*\n\n` +
              `_${statusMsg || 'Aucune correspondance trouvée.'}_\n\n` +
              `💡 Essaie avec un extrait plus long.\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const music        = result.metadata.music[0];
    const title        = music.title        || 'Inconnu';
    const artists      = music.artists?.map(a => a.name).join(', ') || 'Inconnu';
    const album        = music.album?.name  || 'Inconnu';
    const genres       = music.genres?.map(g => g.name).join(', ') || 'Inconnu';
    const releaseDate  = music.release_date || 'Inconnu';
    const label        = music.label        || null;
    const duration     = music.duration_ms
      ? `${Math.floor(music.duration_ms / 60000)}:${String(Math.floor((music.duration_ms % 60000) / 1000)).padStart(2, '0')}`
      : null;

    // Liens streaming si disponibles
    const spotify  = music.external_metadata?.spotify?.track?.id
      ? `https://open.spotify.com/track/${music.external_metadata.spotify.track.id}`
      : null;
    const youtube  = music.external_metadata?.youtube?.vid
      ? `https://youtu.be/${music.external_metadata.youtube.vid}`
      : null;

    let txt = `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎵 *KAIDO SHAZAM*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `📌 *Titre :* ${title}\n` +
              `🎤 *Artiste :* ${artists}\n` +
              `💿 *Album :* ${album}\n` +
              `🎼 *Genre :* ${genres}\n` +
              `📅 *Sortie :* ${releaseDate}\n`;

    if (duration) txt += `⏱ *Durée :* ${duration}\n`;
    if (label)    txt += `🏷️ *Label :* ${label}\n`;

    txt += `\n━━━━━━━━━━━━━━━━━━`;

    if (spotify || youtube) {
      txt += `\n🔗 *Liens :*`;
      if (spotify) txt += `\n  🟢 Spotify → ${spotify}`;
      if (youtube) txt += `\n  🔴 YouTube → ${youtube}`;
      txt += `\n━━━━━━━━━━━━━━━━━━`;
    }

    txt += `\n> ${config.BOT_FOOTER}`;

    await socket.sendMessage(sender, { text: txt }, { quoted: msg });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[SHAZAM ERROR]', e);
    // Nettoyage sécurisé si crash avant unlinkSync
    try {
      const tmp = os.tmpdir();
      fs.readdirSync(tmp)
        .filter(f => f.startsWith('shazam_'))
        .forEach(f => { try { fs.unlinkSync(path.join(tmp, f)); } catch(_){} });
    } catch(_) {}
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Erreur Shazam.\n_${e.message || e}_\n\n💡 Réessaie avec un autre audio.`
    }, { quoted: msg });
  }
  break;
}
      
      
case 'fancy':
case 'fancytext':
case 'style': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  ✨ *KAIDO FANCY TEXT*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun texte fourni !\n\n` +
              `*Usage :*\n` +
              `  ${prefix}fancy <texte>\n` +
              `  ${prefix}fancy <texte> <numéro>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}fancy Kaido MD\n` +
              `  ${prefix}fancy Kaido MD 3\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const lastArg = args[args.length - 1];
    const styleNum = /^\d+$/.test(lastArg) ? parseInt(lastArg) : null;
    const inputText = styleNum !== null
      ? args.slice(0, -1).join(' ').trim()
      : args.join(' ').trim();

    if (!inputText) {
      await socket.sendMessage(sender, {
        text: `❌ Texte manquant.\n*Usage :* ${prefix}fancy <texte> [numéro]`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '✨', key: msg.key } });

    const res = await fetch(
      `http://qaz.wtf/u/convert.cgi?text=${encodeURIComponent(inputText)}`,
      { timeout: 15000 }
    );
    if (!res.ok) throw new Error(`Erreur serveur : ${res.status}`);
    const html = await res.text();

    function decodeHtmlEntities(str) {
      return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
    }

    const styles = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
      const nameMatch = row.match(/class=["']aname["'][^>]*>([\s\S]*?)<\/(?:td|span|div)>/i);
      if (!nameMatch) continue;
      const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
      if (!name) continue;

      const tdMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length < 2) continue;

      const content = decodeHtmlEntities(
        tdMatches[1][1].replace(/<[^>]+>/g, '').trim()
      );
      if (!content) continue;

      styles.push(content); // on stocke uniquement le contenu, pas le nom
    }

    if (!styles.length) throw new Error('Aucun style généré.');

    // ── Mode style unique ──
    if (styleNum !== null) {
      const idx = styleNum - 1;
      if (idx < 0 || idx >= styles.length) {
        await socket.sendMessage(sender, {
          text: `❌ Numéro invalide ! Choisis entre *1* et *${styles.length}*.\n\n` +
                `*Exemple :* ${prefix}fancy ${inputText} 5`
        }, { quoted: msg });
        break;
      }

      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  ✨ *KAIDO FANCY TEXT*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `${styles[idx]}\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });

      await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
      break;
    }

    // ── Mode tous les styles — un seul message ──
    const lines = styles.map((s, i) => `*${i + 1}.* ${s}`).join('\n');

    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  ✨ *KAIDO FANCY TEXT*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔤 *${inputText}* — ${styles.length} styles\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `${lines}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💡 ${prefix}fancy ${inputText} <numéro>\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[FANCY ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Erreur fancy text.\n_${e.message || e}_`
    }, { quoted: msg });
  }
  break;
}
// ============================================================
// APK — Recherche avec carrousel interactif (Baileys officiel)
// ============================================================
case 'apk':
case 'app':
case 'playstore':
case 'mod': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🛒 *KAIDO APK STORE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun nom d'application fourni !\n\n` +
              `*Usage :* ${prefix}apk <nom app>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}apk WhatsApp\n` +
              `  ${prefix}apk Minecraft\n` +
              `  ${prefix}apk TikTok\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ').trim();

    await socket.sendMessage(from, { react: { text: '🔎', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🛒 *KAIDO APK STORE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔎 Recherche : *${query}*\n` +
            `⏳ Connexion aux serveurs APK...`
    }, { quoted: msg });

    const {
      prepareWAMessageMedia,
      generateWAMessageFromContent,
      proto
    } = require('@whiskeysockets/baileys');

    // ── Appel API Aptoide ──
    const { data } = await axios.get(
      `https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=5`,
      { timeout: 15000 }
    );

    if (!data?.datalist?.list?.length) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `😕 Aucune application trouvée pour *${query}*.\n\n💡 Vérifie l'orthographe et réessaie.`
      }, { quoted: msg });
      break;
    }

    const FALLBACK_ICON = 'https://i.ibb.co/99KrSHn2/c4cd381ffed6.jpg';
    const cards = [];

    for (const app of data.datalist.list) {
      const title   = (app.name || 'Application').slice(0, 40);
      const dev     = app.store?.name || 'Global Store';
      const version = app.file?.vername || '1.0';
      const sizeMB  = app.file?.filesize
        ? (app.file.filesize / (1024 * 1024)).toFixed(1)
        : '?';
      const dlLink  = app.file?.path;
      const rating  = app.stats?.rating?.avg || 'N/A';
      const iconUrl = app.icon || FALLBACK_ICON;

      if (!dlLink) continue;

      // ── Téléchargement icône avec fallback ──
      let imgBuffer;
      try {
        const r = await axios.get(iconUrl, { responseType: 'arraybuffer', timeout: 6000 });
        imgBuffer = Buffer.from(r.data);
      } catch {
        const r = await axios.get(FALLBACK_ICON, { responseType: 'arraybuffer', timeout: 6000 });
        imgBuffer = Buffer.from(r.data);
      }

      // ── Upload image via Baileys ──
      const media = await prepareWAMessageMedia(
        { image: imgBuffer },
        { upload: socket.waUploadToServer }
      );

      const btnId = `${prefix}dlapk ${title.replace(/\s+/g, '_')} ${dlLink}`;

      // ── Card = plain object, PAS de proto.create() ──
      cards.push({
        body: { text: `🏢 *Store :* ${dev}\n🏷️ *Version :* ${version}\n📦 *Taille :* ${sizeMB} MB\n⭐ *Note :* ${rating}/5` },
        header: {
          title: `📦 ${title}`,
          hasMediaAttachment: true,
          imageMessage: media.imageMessage
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: `📥 Télécharger (${sizeMB} MB)`,
                id: btnId
              })
            }
          ]
        }
      });
    }

    if (!cards.length) {
      throw new Error('Aucun lien de téléchargement disponible pour ces applications.');
    }

    // ── Construction carrousel avec proto.create() uniquement sur les niveaux existants ──
    const interactiveMsg = proto.Message.InteractiveMessage.create({
      body: proto.Message.InteractiveMessage.Body.create({
        text: `🛒 *KAIDO APK STORE*\n━━━━━━━━━━━━━━━━━━\n🔎 Résultats : *${query}*\n👆 Swipe pour choisir ➡️`
      }),
      footer: proto.Message.InteractiveMessage.Footer.create({
        text: `> ${config.BOT_FOOTER}`
      }),
      carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
        cards,           // ← plain objects ici
        messageVersion: 1
      })
    });

    const waMsg = generateWAMessageFromContent(
      from,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            interactiveMessage: interactiveMsg
          }
        }
      },
      { quoted: msg, userJid: socket.user.id }
    );

    await socket.relayMessage(from, waMsg.message, { messageId: waMsg.key.id });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[APK ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Erreur APK Store.\n_${e.message || e}_\n\n💡 Réessaie dans quelques secondes.`
    }, { quoted: msg });
  }
  break;
}      
      
      
// === COMMANDE RECHERCHE DE FILMS ===
case 'sm':
case 'movie':
case 'silent': {
    try {
        const query = args.join(" ");
        if (!query) {
            await socket.sendMessage(sender, { 
                text: `🎥 *Usage:* ${prefix}${command} <nom du film>\n*Exemple:* ${prefix}${command} Batman` 
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(jid, { react: { text: '🔎', key: msg.key } });
        await socket.sendMessage(sender, { 
            text: `🔎 *Recherche de films pour :* "${query}"...\n_Génération des cartes de sélection..._` 
        }, { quoted: msg });

        const axios = require('axios');
        
        const { data } = await axios.get(`https://darkvibe314-silent-movies-api.hf.space/api/search`, {
            params: { query: query },
            timeout: 30000
        });

        if (!data.results || data.results.length === 0) {
            await socket.sendMessage(sender, { 
                text: "🩸 *Aucun film trouvé !* Essaie un autre terme de recherche." 
            }, { quoted: msg });
            break;
        }

        const results = data.results.slice(0, 5); // 5 max pour le carousel WA
        const cards = [];

        for (let i = 0; i < results.length; i++) {
            const movie = results[i];
            const title = (movie.title || "Inconnu").slice(0, 50);
            const isSeries = movie.subjectType === 2; 

            // Cache LRU borné : les recherches ponctuelles ne font plus grossir le heap sans limite.
            cacheMovieSubtitles(movie.subjectId, typeof movie.subtitles === 'string' ? movie.subtitles : 'None');
            
            const subText = movie.subtitles ? movie.subtitles.split(',').slice(0, 3).join(', ') + "..." : 'Aucun';
            const desc = `⭐ IMDb: ${movie.imdbRatingValue || 'N/A'}\n` +
                        `🎭 Genre: ${movie.genre || 'N/A'}\n` +
                        `📅 Année: ${movie.releaseDate?.split('-')[0] || 'Inconnue'}\n` +
                        `📌 Type: ${isSeries ? 'Série 📺' : 'Film 🎬'}\n` +
                        `💬 Sous-titres: ${subText}`;
            
            const coverUrl = movie.cover?.url || 'https://i.ibb.co/99KrSHn2/c4cd381ffed6.jpg';

            // Préparer le média pour l'image
            const { generateWAMessageContent, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
            
            const media = await generateWAMessageContent({
                image: { url: coverUrl }
            }, { upload: socket.waUploadToServer });

            let actionButtons = [];
            
            if (isSeries) {
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "📺 Télécharger (Défaut)", id: `.dlmovie ${movie.subjectId} 1 1` }) 
                });
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "📝 Choisir sous-titres", id: `.smsubs ${movie.subjectId} 1 1` }) 
                });
                actionButtons.push({ 
                    name: "cta_copy", 
                    buttonParamsJson: JSON.stringify({ 
                        display_text: "📋 Copier ID", 
                        id: "copy_id", 
                        copy_code: `.dlmovie ${movie.subjectId} <saison> <épisode> <Langue>` 
                    }) 
                });
            } else {
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "🎬 Télécharger (Défaut)", id: `.dlmovie ${movie.subjectId} null null` }) 
                });
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "📝 Choisir sous-titres", id: `.smsubs ${movie.subjectId} null null` }) 
                });
            }

            cards.push({
                body: { text: desc },
                header: { 
                    title: `🎬 ${title}`, 
                    hasMediaAttachment: true, 
                    imageMessage: media.imageMessage 
                },
                nativeFlowMessage: { buttons: actionButtons }
            });
        }

        // Créer le message interactif avec carousel
        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        
        const interactiveMessage = {
            body: { text: `🎥 *Résultats pour :* ${query}\n\nGlisse pour choisir ! ➡️` },
            carouselMessage: { cards: cards, messageVersion: 1 }
        };

        const msgContent = generateWAMessageFromContent(jid, {
            viewOnceMessage: { 
                message: { 
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, 
                    interactiveMessage: interactiveMessage 
                } 
            }
        }, { quoted: msg, userJid: sender });

        await socket.relayMessage(jid, msgContent.message, { messageId: msgContent.key.id });
        await socket.sendMessage(jid, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error("[MOVIE SEARCH ERROR]", e.message);
        await socket.sendMessage(sender, { 
            text: `🩸 Erreur de recherche: ${e.response?.data?.detail || e.message}` 
        }, { quoted: msg });
        await socket.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// === COMMANDE SOUS-TITRES ===
case 'smsubs': {
    try {
        const movieId = args[0];
        const season = args[1] === 'null' ? null : args[1];
        const episode = args[2] === 'null' ? null : args[2];
        
        if (!movieId) {
            await socket.sendMessage(sender, { 
                text: "🩸 *Usage:* `.smsubs <movie_id> [saison] [épisode]`" 
            }, { quoted: msg });
            break;
        }
        
        const cachedSubs = getCachedMovieSubtitles(movieId);
        if (!cachedSubs || cachedSubs === 'None') {
            await socket.sendMessage(sender, { 
                text: "🩸 Aucun sous-titre disponible pour ce média." 
            }, { quoted: msg });
            break;
        }

        const subList = cachedSubs.split(',').map(s => s.trim());
        
        const rows = subList.map(sub => ({
            header: "",
            title: `📝 ${sub}`,
            description: `Télécharger avec sous-titres ${sub}`,
            id: `.dlmovie ${movieId} ${season || 'null'} ${episode || 'null'} ${sub}`
        }));

        const sections = [{ title: "Langues disponibles", rows: rows }];

        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        
        const interactiveMsg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: {
                        body: { text: "🗣️ *Choisis la langue des sous-titres*\n\nSélectionne une langue ci-dessous pour commencer le téléchargement :" },
                        footer: { text: "© Kaido MD" },
                        header: { title: "📝 Sous-titres", subtitle: "", hasMediaAttachment: false },
                        nativeFlowMessage: {
                            buttons: [{ 
                                name: "single_select", 
                                buttonParamsJson: JSON.stringify({ title: "🌐 Choisir la langue", sections: sections }) 
                            }]
                        }
                    }
                }
            }
        }, { quoted: msg, userJid: sender });

        await socket.relayMessage(jid, interactiveMsg.message, { messageId: interactiveMsg.key.id });

    } catch (e) {
        console.error("[SMSUBS ERROR]", e.message);
        await socket.sendMessage(sender, { 
            text: `🩸 Erreur: ${e.message}` 
        }, { quoted: msg });
    }
    break;
}

// === COMMANDE TÉLÉCHARGEMENT FILM ===
case 'dlmovie':
case 'downloadmovie': {
    try {
        const movieId = args[0];
        const season = (args[1] && args[1] !== 'null') ? args[1] : null; 
        const episode = (args[2] && args[2] !== 'null') ? args[2] : null; 
        const subLang = args.slice(3).join(" ");

        if (!movieId) {
            await socket.sendMessage(sender, { 
                text: "🩸 *Usage:* `.dlmovie <movie_id> [saison] [épisode] [langue]`" 
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
        
        const subMsg = subLang ? `\n🗣️ *Sous-titres:* ${subLang}` : "";
        await socket.sendMessage(sender, { 
            text: `⏳ *Récupération des liens de téléchargement...*${subMsg}\n_Analyse de la taille du fichier..._` 
        }, { quoted: msg });

        const axios = require('axios');
        const fs = require('fs');
        const path = require('path');
        const FormData = require('form-data');

        let tempVidPath = null;

        const requestParams = { movie_id: movieId };
        if (season && episode) {
            requestParams.season = season;
            requestParams.episode = episode;
        }
        if (subLang) {
            requestParams.sub_lang = subLang;
        }

        const { data } = await axios.get(`https://darkvibe314-silent-movies-api.hf.space/api/download`, {
            params: requestParams,
            timeout: 30000
        });

        if (!data.download_url) throw new Error("URL vidéo introuvable.");

        const sizeMB = data.size_bytes ? parseFloat((parseInt(data.size_bytes) / (1024 * 1024)).toFixed(2)) : 0;
        let fileName = (season && episode) ? `Silent_Series_${movieId}_S${season}E${episode}.mp4` : `Silent_Movie_${movieId}.mp4`;

        if (sizeMB > 100) {
            await socket.sendMessage(sender, { 
                text: `📦 *Fichier supérieur à 100MB !* (${sizeMB} MB)\n_Téléchargement et upload vers GoFile pour contourner la limite WhatsApp. Cela prendra quelques minutes..._` 
            }, { quoted: msg });
            
            // Créer le dossier temp s'il n'existe pas
            const tempDir = './temp';
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            tempVidPath = path.join(tempDir, fileName);
            const writer = fs.createWriteStream(tempVidPath);
            
            const response = await axios({ 
                url: data.download_url, 
                method: 'GET', 
                responseType: 'stream',
                timeout: 300000 // 5 minutes pour le téléchargement
            });
            
            response.data.pipe(writer);
            
            await new Promise((resolve, reject) => { 
                writer.on('finish', resolve); 
                writer.on('error', reject); 
            });

            // Upload vers GoFile
            const { data: serverData } = await axios.get('https://api.gofile.io/servers');
            const server = serverData.data.servers[0].name;

            const form = new FormData();
            form.append('file', fs.createReadStream(tempVidPath));

            const { data: uploadData } = await axios.post(`https://${server}.gofile.io/contents/uploadfile`, form, {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 300000
            });

            if (!uploadData || uploadData.status !== 'ok') throw new Error("Upload GoFile échoué.");

            await socket.sendMessage(jid, {
                text: `🎬 *${fileName}*\n\n📦 *Taille:* ${sizeMB} MB\n🔗 *Lien GoFile:* ${uploadData.data.downloadPage}\n\n> _Fichier trop volumineux pour WhatsApp, uploadé sécurisé sur GoFile !_`,
                contextInfo: { forwardingScore: 999, isForwarded: true }
            }, { quoted: msg });

            // Nettoyer
            if (fs.existsSync(tempVidPath)) fs.unlinkSync(tempVidPath);

        } else {
            await socket.sendMessage(sender, { 
                text: `🎬 *Média trouvé !* (${sizeMB} MB)\n_Envoi direct vers WhatsApp..._` 
            }, { quoted: msg });
            
            await socket.sendMessage(jid, {
                document: { url: data.download_url },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption: `🎬 *Téléchargé via Kaido MD*\n📦 Taille: ${sizeMB} MB\n\n> _Astuce: Utilise VLC pour charger le fichier de sous-titres ci-dessous !_`,
                contextInfo: { forwardingScore: 999, isForwarded: true }
            }, { quoted: msg });
        }

        // Envoyer les sous-titres si disponibles
        if (data.subtitle_url) {
            try {
                let subName = (season && episode) 
                    ? `Sous-titres_${subLang || 'Default'}_S${season}E${episode}.srt` 
                    : `Sous-titres_${subLang || 'Default'}.srt`;
                
                const subRes = await axios.get(data.subtitle_url, { 
                    responseType: 'arraybuffer',
                    timeout: 30000 
                });
                
                await socket.sendMessage(jid, {
                    document: Buffer.from(subRes.data),
                    mimetype: 'application/x-subrip',
                    fileName: subName,
                    caption: `📝 *Sous-titres ${subLang || 'Anglais'}*\n_Charge ce fichier dans ton lecteur vidéo._`
                }, { quoted: msg });
            } catch (subErr) {
                console.error("[SUBTITLE FETCH ERROR]", subErr.message);
            }
        }

        await socket.sendMessage(jid, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error("[DLMOVIE ERROR]", e.message);
        
        // Nettoyer le fichier temporaire en cas d'erreur
        if (tempVidPath && fs.existsSync(tempVidPath)) {
            try { fs.unlinkSync(tempVidPath); } catch {}
        }
        
        const errorMsg = e.response?.data?.detail || e.message;
        await socket.sendMessage(jid, { react: { text: '❌', key: msg.key } });
        await socket.sendMessage(sender, { 
            text: `🩸 Erreur de téléchargement: ${errorMsg}` 
        }, { quoted: msg });
    }
    break;
}
      
// ============================================================
// TRANSLATE — Traduction via Google Translate
// ============================================================
case 'translate':
case 'tl':
// ============================================================
// TRANSLATE — Traduction via Google Translate
// ============================================================
case 'translate':
case 'tl':
case 'trt':
case 'tr': {
  try {
    const { translate } = require('@vitalets/google-translate-api');

    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedCtx?.quotedMessage;

    // ── Texte du message cité ──
    const quotedText = quotedMsg?.conversation
      || quotedMsg?.extendedTextMessage?.text
      || quotedMsg?.imageMessage?.caption
      || quotedMsg?.videoMessage?.caption
      || null;

    const isReply = !!quotedText;

    let lang = 'en';
    let text = '';

    if (isReply) {
      // ── Mode reply : .trt es → lang = es, text = message cité ──
      // Si args[0] est un code langue → l'utiliser
      // Si pas d'args → traduire en anglais par défaut
      lang = (args[0] && args[0].length === 2) ? args[0] : 'en';
      text = quotedText;
    } else {
      // ── Mode direct : .trt es Hello World ──
      if (!args.length) {
        await socket.sendMessage(sender, {
          text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
                `┃  🌐 *KAIDO TRANSLATE*\n` +
                `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                `❌ Aucun texte à traduire !\n\n` +
                `*Usage :*\n` +
                `  ${prefix}tr <langue> <texte>\n` +
                `  ${prefix}tr <texte> _(→ anglais)_\n\n` +
                `*En réponse à un message :*\n` +
                `  ${prefix}tr es _(traduit en espagnol)_\n` +
                `  ${prefix}tr _(traduit en anglais)_\n\n` +
                `*Exemples :*\n` +
                `  ${prefix}tr fr Hello World\n` +
                `  ${prefix}tr es Bonjour tout le monde\n\n` +
                `📋 *Langues :* https://cloud.google.com/translate/docs/languages\n\n` +
                `> ${config.BOT_FOOTER}`
        }, { quoted: msg });
        break;
      }

      // Premier arg = code langue (2 chars) ou tout est le texte
      if (args[0].length === 2) {
        lang = args[0];
        text = args.slice(1).join(' ').trim();
      } else {
        lang = 'en';
        text = args.join(' ').trim();
      }

      if (!text) {
        await socket.sendMessage(sender, {
          text: `❌ Texte manquant.\n*Usage :* ${prefix}tr <langue> <texte>`
        }, { quoted: msg });
        break;
      }
    }

    await socket.sendMessage(from, { react: { text: '🌐', key: msg.key } });

    // ── Traduction ──
    const result = await translate(text, { to: lang, autoCorrect: true });

    if (!result?.text) throw new Error('Traduction échouée.');

    const fromLang = result?.raw?.src
      || result?.from?.language?.iso
      || '?';

    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🌐 *KAIDO TRANSLATE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔤 *Original* _(${fromLang})_ :\n${text}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `✅ *Traduction* _(${lang})_ :\n${result.text}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[TRANSLATE ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🌐 *KAIDO TRANSLATE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `❌ Échec de la traduction.\n\n` +
            `_${e.message || e}_\n\n` +
            `💡 Vérifie le code langue :\n` +
            `https://cloud.google.com/translate/docs/languages\n\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });
  }
  break;
}

case 'antitag': {
          try {
            // Optionnel : restreindre au propriétaire
            if (!isOwner) {
              await socket.sendMessage(sender, { 
                text: '❌ Seul le propriétaire peut utiliser cette commande.' 
              }, { quoted: msg });
              break;
            }

            const validModes = ['off', 'delete', 'remove'];
            const newMode = args[0]?.toLowerCase();

            if (!newMode || !validModes.includes(newMode)) {
              await socket.sendMessage(sender, {
                text: `❌ Mode invalide. Utilise : ${validModes.join(' | ')}`
              }, { quoted: msg });
              break;
            }

            // Récupérer le numéro de la session (le bot) pour la config
            const botNumberForConfig = socket.user?.id?.split(':')[0] + '@s.whatsapp.net' || socket.user?.id;
            if (!botNumberForConfig) throw new Error('Impossible de récupérer le numéro du bot');

            // Charger la config actuelle du bot
            const currentConfig = await loadUserConfigFromMongo(botNumberForConfig) || {};

            // Mettre à jour avec le nouveau mode
            currentConfig.ANTI_TAG_MODE = newMode;

            // Sauvegarder en base
            await setUserConfigInMongo(botNumberForConfig, currentConfig);

            await socket.sendMessage(sender, {
              text: `✅ Anti-tag réglé sur : *${newMode}*`
            }, { quoted: msg });

          } catch (e) {
            console.error('[ANTITAG CMD ERROR]', e);
            await socket.sendMessage(sender, { text: `❌ Erreur: ${e.message}` }, { quoted: msg });
          }
          break;
        }        
          
case 'delsession': {
  try {
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = primaryOwnerNumber();

    // Vérification : seul le Owner global peut utiliser cette commande
    if (!isOwner) {
      await socket.sendMessage(sender, {
        text: '❌ Seul le propriétaire global du bot peut utiliser cette commande.'
      }, { quoted: msg });
      break;
    }

    // Vérifier argument
    const target = (args[0] || '').replace(/[^0-9]/g, '');
    if (!target) {
      await socket.sendMessage(sender, {
        text: '⚙️ *DELETE SESSION*\n\nUsage: .delsession [numéro]\nEx: .delsession 50938918145'
      }, { quoted: msg });
      break;
    }

    // Appeler l’API /api/session/delete
    const fetch = require('node-fetch');
    const resp = await fetch('http://localhost:2036/api/session/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': 'adminplag' // mot de passe global
      },
      body: JSON.stringify({ number: target })
    });

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      const text = await resp.text();
      await socket.sendMessage(sender, {
        text: `❌ Réponse non JSON du serveur : ${text}`
      }, { quoted: msg });
      break;
    }

    if (data.ok) {
      await socket.sendMessage(sender, {
        text: `✅ Session ${target} supprimée via API.`
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, {
        text: `❌ Échec : ${data.error || 'Réponse inattendue'}`
      }, { quoted: msg });
    }

  } catch (err) {
    console.error('[DELSESSION ERROR]', err);
    await socket.sendMessage(sender, {
      text: `❌ Erreur lors de la suppression : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}

 case 'detect': {
  try {
    // Récupérer la source du message (supporte conversation simple et extendedTextMessage)
    const raw = msg.message || {};
    const quoted = raw.extendedTextMessage?.contextInfo?.quotedMessage
      || raw.extendedTextMessage?.contextInfo?.stanzaId && raw.extendedTextMessage?.contextInfo?.quotedMessage
      || raw.imageMessage?.contextInfo?.quotedMessage
      || raw.videoMessage?.contextInfo?.quotedMessage
      || raw.audioMessage?.contextInfo?.quotedMessage
      || null;

    // Si la commande n'est pas utilisée en réponse, on informe l'utilisateur
    if (!quoted) {
      await socket.sendMessage(sender, {
        text: 'ℹ️ Utilisation : répondez à un message puis envoyez la commande .detect pour voir sa structure.'
      }, { quoted: msg });
      break;
    }

    // Helper : extraire le type principal du message cité
    function detectMessageType(q) {
      if (!q) return 'unknown';
      const keys = Object.keys(q);
      // Priorité sur les types connus
      const types = ['conversation','extendedTextMessage','imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage','contactMessage','locationMessage','productMessage','buttonsResponseMessage','listResponseMessage','templateMessage'];
      for (const t of types) if (q[t]) return t;
      // fallback : premier key non metadata
      return keys.length ? keys[0] : 'unknown';
    }

    // Helper : construire un objet résumé sans données binaires lourdes
    function summarizeMessage(q) {
      const type = detectMessageType(q);
      const summary = { type, rawKeys: Object.keys(q) };

      // texte
      if (q.conversation) summary.text = q.conversation;
      if (q.extendedTextMessage) {
        summary.extendedText = q.extendedTextMessage.text || null;
        summary.extendedContext = q.extendedTextMessage.contextInfo ? {
          stanzaId: q.extendedTextMessage.contextInfo.stanzaId || null,
          participant: q.extendedTextMessage.contextInfo.participant || null,
          quotedMessageKeys: q.extendedTextMessage.contextInfo.quotedMessage ? Object.keys(q.extendedTextMessage.contextInfo.quotedMessage) : null
        } : null;
      }

      // image
      if (q.imageMessage) {
        summary.image = {
          mimetype: q.imageMessage.mimetype || null,
          caption: q.imageMessage.caption || null,
          fileSha256: q.imageMessage.fileSha256 ? Buffer.from(q.imageMessage.fileSha256).toString('hex') : null,
          fileLength: q.imageMessage.fileLength || null,
          url: q.imageMessage.url || null
        };
      }

      // video
      if (q.videoMessage) {
        summary.video = {
          mimetype: q.videoMessage.mimetype || null,
          caption: q.videoMessage.caption || null,
          seconds: q.videoMessage.seconds || null,
          fileLength: q.videoMessage.fileLength || null,
          url: q.videoMessage.url || null
        };
      }

      // audio
      if (q.audioMessage) {
        summary.audio = {
          mimetype: q.audioMessage.mimetype || null,
          seconds: q.audioMessage.seconds || null,
          ptt: !!q.audioMessage.ptt,
          fileLength: q.audioMessage.fileLength || null,
          url: q.audioMessage.url || null
        };
      }

      // document
      if (q.documentMessage) {
        summary.document = {
          fileName: q.documentMessage.fileName || null,
          mimetype: q.documentMessage.mimetype || null,
          fileLength: q.documentMessage.fileLength || null,
          url: q.documentMessage.url || null
        };
      }

      // sticker
      if (q.stickerMessage) {
        summary.sticker = {
          isAnimated: !!q.stickerMessage.isAnimated,
          isVideo: !!q.stickerMessage.isVideo,
          fileSha256: q.stickerMessage.fileSha256 ? Buffer.from(q.stickerMessage.fileSha256).toString('hex') : null
        };
      }

      // contact / location / product
      if (q.contactMessage) summary.contact = { displayName: q.contactMessage.displayName || null, vcard: !!q.contactMessage.vcard };
      if (q.locationMessage) summary.location = { degreesLatitude: q.locationMessage.degreesLatitude || null, degreesLongitude: q.locationMessage.degreesLongitude || null, name: q.locationMessage.name || null };
      if (q.productMessage) summary.product = { productId: q.productMessage.product?.id || null, title: q.productMessage.product?.title || null };

      // metadata utile
      if (q.contextInfo) {
        summary.contextInfo = {
          mentionedJid: q.contextInfo.mentionedJid || null,
          externalAdReply: q.contextInfo.externalAdReply ? {
            title: q.contextInfo.externalAdReply.title || null,
            mediaType: q.contextInfo.externalAdReply.mediaType || null,
            mediaUrl: q.contextInfo.externalAdReply.mediaUrl || null
          } : null
        };
      }

      return summary;
    }

    // Construire le rapport
    const report = {
      inspectedAt: new Date().toISOString(),
      chat: msg.key?.remoteJid || 'unknown',
      isGroup: (msg.key?.remoteJid || '').endsWith('@g.us'),
      quotedMessageKey: {
        id: raw.extendedTextMessage?.contextInfo?.stanzaId || raw.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id || null,
        participant: raw.extendedTextMessage?.contextInfo?.participant || raw.extendedTextMessage?.contextInfo?.quotedMessage?.key?.participant || null
      },
      summary: summarizeMessage(quoted)
    };

    // Envoyer le rapport formaté (limiter la taille)
    const pretty = JSON.stringify(report, null, 2);
    const MAX_LEN = 1500;
    if (pretty.length <= MAX_LEN) {
      await socket.sendMessage(sender, { text: `🔍 Résultat de l'inspection :\n\n${pretty}` }, { quoted: msg });
    } else {
      // découper en plusieurs messages si trop long
      const chunks = [];
      for (let i = 0; i < pretty.length; i += MAX_LEN) chunks.push(pretty.slice(i, i + MAX_LEN));
      await socket.sendMessage(sender, { text: '🔍 Rapport trop long, envoi en plusieurs parties...' }, { quoted: msg });
      for (const c of chunks) {
        await socket.sendMessage(sender, { text: '```json\n' + c + '\n```' }, { quoted: msg });
      }
    }

  } catch (err) {
    console.error('[DETECT CASE ERROR]', err);
    try {
      await socket.sendMessage(sender, { text: `❌ Erreur lors de l'inspection : ${err.message || err}` }, { quoted: msg });
    } catch (e) { /* ignore */ }
  }
  break;
}         
// ============ COMMANDES DE GROUPE ========

case 'config': {
  try {
    const sub = (args[0] || '').toLowerCase();
    const param = args.slice(1).join(' ').trim();
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = primaryOwnerNumber();

    // permission : seul le propriétaire de la session ou le bot owner peut modifier
    if (!(isOwner || isSessionOwner)) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CONFIG_DENY1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change session config.' }, { quoted: shonux });
      break;
    }

    // charger config existante (ou objet vide)
    let cfg = await loadUserConfigFromMongo(sanitized) || {};

    switch (sub) {
      case 'autoview': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          cfg.AUTO_VIEW_STATUS = val === 'on';
          await setUserConfigInMongo(sanitized, cfg);
          await socket.sendMessage(sender, { text: `✅ AUTO_VIEW_STATUS set to ${cfg.AUTO_VIEW_STATUS ? 'ON' : 'OFF'}` }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: 'Usage: .config autoview on|off' }, { quoted: msg });
        }
        break;
      }

      case 'autolike': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          cfg.AUTO_LIKE_STATUS = val === 'on';
          await setUserConfigInMongo(sanitized, cfg);
          await socket.sendMessage(sender, { text: `✅ AUTO_LIKE_STATUS set to ${cfg.AUTO_LIKE_STATUS ? 'ON' : 'OFF'}` }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: 'Usage: .config autolike on|off' }, { quoted: msg });
        }
        break;
      }

      case 'autorec': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          cfg.AUTO_RECORDING = val === 'on';
          await setUserConfigInMongo(sanitized, cfg);
          await socket.sendMessage(sender, { text: `✅ AUTO_RECORDING set to ${cfg.AUTO_RECORDING ? 'ON' : 'OFF'}` }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: 'Usage: .config autorec on|off' }, { quoted: msg });
        }
        break;
      }

      case 'alwaysonline':
      case 'autoonline':
      case 'online': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          // L’état inactif reste hors ligne; seule chaque réponse du bot annonce
          // temporairement sa disponibilité. `on` est gardé comme alias historique.
          cfg.AUTO_ONLINE = false;
          await setUserConfigInMongo(sanitized, cfg);
          await applyAlwaysOnlineSetting(socket, false, sender);
          await socket.sendMessage(sender, {
            text: val === 'off'
              ? '✅ Kaido restera hors ligne lorsqu’il ne répond pas.'
              : 'ℹ️ La présence en ligne permanente est désactivée; Kaido ne sera visible que pendant ses réponses.'
          }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: `${prefix}config alwaysonline off` }, { quoted: msg });
        }
        break;
      }

      case 'setemoji': {
        if (!param) {
          await socket.sendMessage(sender, { text: 'Usage: .config setemoji <emoji1> <emoji2> ...' }, { quoted: msg });
          break;
        }
        // split par espaces, garder les emojis non vides
        const emojis = param.split(/\s+/).filter(Boolean);
        if (!emojis.length) {
          await socket.sendMessage(sender, { text: 'Aucun emoji valide fourni.' }, { quoted: msg });
          break;
        }
        cfg.AUTO_LIKE_EMOJI = emojis;
        await setUserConfigInMongo(sanitized, cfg);
        await socket.sendMessage(sender, { text: `✅ AUTO_LIKE_EMOJI updated: ${emojis.join(' ')}` }, { quoted: msg });
        break;
      }

      case 'setprefix': {
        const requestedPrefix = args[1];
        if (requestedPrefix === undefined) {
          await socket.sendMessage(sender, { text: `${prefix}config setprefix <préfixe|off>` }, { quoted: msg });
          break;
        }
        const newPrefix = /^(?:off|none|false)$/i.test(requestedPrefix) ? '' : requestedPrefix;
        cfg.PREFIX = newPrefix;
        await setUserConfigInMongo(sanitized, cfg);
        await socket.sendMessage(sender, {
          text: newPrefix
            ? `✅ PREFIX set to: ${newPrefix}`
            : '✅ Mode prefixless activé. Utilise `config setprefix .` pour réactiver le point.'
        }, { quoted: msg });
        break;
      }

      case 'show':
      case 'get': {
        // fusionner avec defaults si tu utilises loadSessionConfigMerged ailleurs ; ici on montre ce qui est en DB
        const merged = { 
          AUTO_VIEW_STATUS: typeof cfg.AUTO_VIEW_STATUS === 'undefined' ? true : cfg.AUTO_VIEW_STATUS,
          AUTO_LIKE_STATUS: typeof cfg.AUTO_LIKE_STATUS === 'undefined' ? true : cfg.AUTO_LIKE_STATUS,
          AUTO_RECORDING: typeof cfg.AUTO_RECORDING === 'undefined' ? false : cfg.AUTO_RECORDING,
          AUTO_ONLINE: false,
          AUTO_LIKE_EMOJI: Array.isArray(cfg.AUTO_LIKE_EMOJI) && cfg.AUTO_LIKE_EMOJI.length ? cfg.AUTO_LIKE_EMOJI : ['🐉','🔥','💀','👑','💪','😎','🇭🇹','⚡','🩸','❤️'],
          PREFIX: Object.prototype.hasOwnProperty.call(cfg, 'PREFIX') ? cfg.PREFIX : '.',
          antidelete: cfg.antidelete === true
        };
        const text = [
          `🔧 Session config for ${sanitized}:`,
          `AUTO_VIEW_STATUS: ${merged.AUTO_VIEW_STATUS}`,
          `AUTO_LIKE_STATUS: ${merged.AUTO_LIKE_STATUS}`,
          `AUTO_RECORDING: ${merged.AUTO_RECORDING}`,
          `AUTO_ONLINE: OFF — Kaido est visible uniquement pendant ses réponses`,
          `AUTO_LIKE_EMOJI: ${merged.AUTO_LIKE_EMOJI.join(' ')}`,
          `PREFIX: ${merged.PREFIX || 'off (prefixless)'}`,
          `ANTIDELETE: ${merged.antidelete ? 'ON' : 'OFF'}`
        ].join('\n');
        await socket.sendMessage(sender, { text }, { quoted: msg });
        break;
      }

      default: {
        // aide rapide
        const help = [
          'Config commands:',
          '.config autoview on|off',
          '.config autolike on|off',
          '.config autorec on|off',
          '.config alwaysonline on|off (off conservé pour compatibilité)',
          '.config setlikeemoji <emoji1> <emoji2> ...',
          '.config setprefix <prefix|off>',
          '.config show'
        ].join('\n');
        await socket.sendMessage(sender, { text: help }, { quoted: msg });
        break;
      }
    }
  } catch (err) {
    console.error('config case error', err);
    await socket.sendMessage(sender, { text: `❌ Error updating config: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
// CASE: welcome
// CASE: welcome
case 'welcome': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: '❗ Cette commande fonctionne uniquement dans un groupe.' }, { quoted: msg });
      break;
    }

    const sub = (args[0] || '').toLowerCase();
    
    if (sub === 'on') {
      await updateGroupSetting(from, 'welcomeEnabled', true);
      await socket.sendMessage(from, { text: '✅ Mode Welcome activé.' }, { quoted: msg });
    } else if (sub === 'off') {
      await updateGroupSetting(from, 'welcomeEnabled', false);
      await socket.sendMessage(from, { text: '❌ Mode Welcome désactivé.' }, { quoted: msg });
    } else if (sub === 'status') {
      const settings = await getGroupSettings(from);
      const state = settings.welcomeEnabled ? 'activé ✅' : 'désactivé ❌';
      await socket.sendMessage(from, { text: `ℹ️ Le mode Welcome est actuellement ${state}.` }, { quoted: msg });
    } else if (sub === 'set') {
      const template = args.slice(1).join(' ').trim();
      if (!template) {
        await socket.sendMessage(from, { text: `❗ Fournis le message après ${prefix}welcome set\nEx: ${prefix}welcome set Bienvenue {user} dans {group} !` }, { quoted: msg });
        break;
      }
      await updateGroupSetting(from, 'welcomeTemplate', template);
      await socket.sendMessage(from, { text: '✅ Message de bienvenue personnalisé enregistré.' }, { quoted: msg });
    } else if (sub === 'reset') {
      await updateGroupSetting(from, 'welcomeTemplate', null);
      await socket.sendMessage(from, { text: '♻️ Message de bienvenue réinitialisé au thème Kaido par défaut.' }, { quoted: msg });
    } else {
      await socket.sendMessage(from, {
        text:
`Usage Welcome:
${prefix}welcome on — activer
${prefix}welcome off — désactiver
${prefix}welcome status — état actuel
${prefix}welcome set <message> — définir message (placeholders: {user}, {userName}, {group})
${prefix}welcome reset — remettre le message par défaut`
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('WELCOME CASE ERROR', err);
    await socket.sendMessage(from, { text: '❌ Erreur lors de la gestion du mode Welcome.' }, { quoted: msg });
  }
  break;
}


// CASE: goodbye
case 'goodbye': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: '❗ Cette commande fonctionne uniquement dans un groupe.' }, { quoted: msg });
      break;
    }

    const sub = (args[0] || '').toLowerCase();
    
    if (sub === 'on') {
      await updateGroupSetting(from, 'goodbyeEnabled', true);
      await socket.sendMessage(from, { text: '✅ Mode Goodbye activé.' }, { quoted: msg });
    } else if (sub === 'off') {
      await updateGroupSetting(from, 'goodbyeEnabled', false);
      await socket.sendMessage(from, { text: '❌ Mode Goodbye désactivé.' }, { quoted: msg });
    } else if (sub === 'status') {
      const settings = await getGroupSettings(from);
      const state = settings.goodbyeEnabled ? 'activé ✅' : 'désactivé ❌';
      await socket.sendMessage(from, { text: `ℹ️ Le mode Goodbye est actuellement ${state}.` }, { quoted: msg });
    } else if (sub === 'set') {
      const template = args.slice(1).join(' ').trim();
      if (!template) {
        await socket.sendMessage(from, { text: `❗ Fournis le message après ${prefix}goodbye set\nEx: ${prefix}goodbye set Au revoir {user}, bon vent !` }, { quoted: msg });
        break;
      }
      await updateGroupSetting(from, 'goodbyeTemplate', template);
      await socket.sendMessage(from, { text: '✅ Message d\'au revoir personnalisé enregistré.' }, { quoted: msg });
    } else if (sub === 'reset') {
      await updateGroupSetting(from, 'goodbyeTemplate', null);
      await socket.sendMessage(from, { text: '♻️ Message d\'au revoir réinitialisé au thème Kaido par défaut.' }, { quoted: msg });
    } else {
      await socket.sendMessage(from, {
        text:
`Usage Goodbye:
${prefix}goodbye on — activer
${prefix}goodbye off — désactiver
${prefix}goodbye status — état actuel
${prefix}goodbye set <message> — définir message (placeholders: {user}, {userName}, {group})
${prefix}goodbye reset — remettre le message par défaut`
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('GOODBYE CASE ERROR', err);
    await socket.sendMessage(from, { text: '❌ Erreur lors de la gestion du mode Goodbye.' }, { quoted: msg });
  }
  break;
}

// ============================================================
// TAKE — Renommer un sticker (titre + auteur KAIDO-MD)
// ============================================================
case 'take':
case 'wm': {
  try {
    const webp   = require('node-webpmux');
    const crypto = require('crypto');

    // ── Vérifier qu'il y a un sticker cité ──
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedCtx?.quotedMessage;

    const stickerMsg = quotedMsg?.stickerMessage
      || msg.message?.stickerMessage
      || null;

    if (!stickerMsg) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎨 *KAIDO TAKE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Réponds à un sticker !\n\n` +
              `*Usage :*\n` +
              `  ${prefix}take → titre = ton nom\n` +
              `  ${prefix}take <titre> → titre perso\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const packname = args.join(' ').trim() || nowsender.split('@')[0];
    const author   = 'KAIDO-MD';

    await socket.sendMessage(from, { react: { text: '🎨', key: msg.key } });

    // ── Télécharger le sticker ──
    const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const stickerBuffer = Buffer.concat(chunks);

    if (!stickerBuffer || stickerBuffer.length === 0) {
      throw new Error('Téléchargement du sticker échoué.');
    }

    // ── addExif ──
    async function addExif(webpSticker, packName, authorName, categories = [''], extra = {}) {
      const img           = new webp.Image();
      const stickerPackId = crypto.randomBytes(32).toString('hex');
      const json          = {
        'sticker-pack-id': stickerPackId,
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': categories,
        ...extra
      };
      const exifAttr   = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ]);
      const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
      const exif       = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);
      await img.load(webpSticker);
      img.exif = exif;
      return await img.save(null);
    }

    const result = await addExif(stickerBuffer, packname, author);
    if (!result) throw new Error('Échec de l\'application des métadonnées.');

    await socket.sendMessage(sender, { sticker: result }, { quoted: msg });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[TAKE ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Échec du renommage.\n_${e.message || e}_`
    }, { quoted: msg });
  }
  break;
}
case 'antilink': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: '❗ Cette commande fonctionne uniquement dans un groupe.' }, { quoted: msg });
      break;
    }

    const arg = args[0]?.toLowerCase();
    if (arg === 'on') {
      toggleAntiLink(from, true);
      await socket.sendMessage(from, { text: '✅ Mode Anti-Link activé.' }, { quoted: msg });
    } else if (arg === 'off') {
      toggleAntiLink(from, false);
      await socket.sendMessage(from, { text: '❌ Mode Anti-Link désactivé.' }, { quoted: msg });
    } else {
      const state = isAntiLinkEnabled(from) ? 'activé ✅' : 'désactivé ❌';
      await socket.sendMessage(from, { text: `ℹ️ Le mode Anti-Link est actuellement ${state}.\nUtilise: ${prefix}${command} on/off` }, { quoted: msg });
    }
  } catch (err) {
    console.error("ANTILINK CASE ERROR", err);
    await socket.sendMessage(from, { text: '❌ Erreur lors de la gestion du mode Anti-Link.' }, { quoted: msg });
  }
  break;
}


// ---------------- CASE ssweb (robuste) ----------------
case 'ssweb': {
  try {
    // body et args doivent être disponibles depuis messages.upsert
    const textToParse = (typeof body === 'string' && body.trim()) ? body.trim() : (msg.body || msg.text || '');
    const raw = textToParse.replace(new RegExp(`^\\${prefix}${command}\\s*`, 'i'), '').trim();
    // supporte : .ssweb <url> ou .ssweb <url> <width>x<height>
    const parts = raw.split(/\s+/).filter(Boolean);
    const urlCandidate = parts[0] || (args && args.length ? args[0] : '');
    const sizeArg = parts[1] || (args && args.length > 1 ? args[1] : '');

    if (!urlCandidate) {
      await socket.sendMessage(from, { text: `❌ Fournis une URL.\nExemple: ${prefix}${command} https://www.google.com` }, { quoted: msg });
      break;
    }

    // Normaliser l'URL
    let url = urlCandidate.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    // Parse taille si fournie (ex: 1920x1080)
    let width = 1280, height = 720;
    if (sizeArg && /^\d+x\d+$/i.test(sizeArg)) {
      const [w, h] = sizeArg.split('x').map(n => parseInt(n, 10));
      if (Number.isFinite(w) && Number.isFinite(h)) {
        width = Math.min(Math.max(w, 200), 3840); // bornes raisonnables
        height = Math.min(Math.max(h, 200), 2160);
      }
    }

    // Réaction "en cours"
    try { await socket.sendMessage(from, { react: { text: "⏳", key: msg.key } }); } catch (e) {}

    // Appel API avec timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const apiUrl = `https://www.movanest.xyz/v2/ssweb?url=${encodeURIComponent(url)}&width=${width}&height=${height}&full_page=true`;
    const apiRes = await fetch(apiUrl, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);

    if (!apiRes.ok) {
      const txt = await apiRes.text().catch(() => '');
      console.error('SSWEB HTTP ERROR', apiRes.status, txt);
      await socket.sendMessage(from, { text: "❌ Erreur réseau lors de l'appel à l'API." }, { quoted: msg });
      break;
    }

    const apiData = await apiRes.json().catch(() => null);
    const imageUrl = apiData?.result || apiData?.url || apiData?.data || null;

    if (!imageUrl || typeof imageUrl !== 'string') {
      console.error('SSWEB BAD RESPONSE', apiData);
      await socket.sendMessage(from, { text: "❌ Impossible de générer la capture d'écran (réponse inattendue)." }, { quoted: msg });
      break;
    }

    // Télécharger l'image retournée par l'API (buffer)
    try {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 20000);
      const imgRes = await fetch(imageUrl, { method: 'GET', signal: controller2.signal });
      clearTimeout(timeout2);

      if (!imgRes.ok) {
        console.error('SSWEB IMAGE HTTP ERROR', imgRes.status);
        // fallback : envoyer l'URL si l'envoi en buffer échoue
        await socket.sendMessage(from, { text: `✅ Capture prête mais impossible de télécharger l'image. Voici le lien :\n${imageUrl}` }, { quoted: msg });
        break;
      }

      const contentType = imgRes.headers.get('content-type') || '';
      if (!/^image\//i.test(contentType)) {
        console.error('SSWEB IMAGE NOT IMAGE', contentType);
        await socket.sendMessage(from, { text: `❌ L'API n'a pas renvoyé une image valide.` }, { quoted: msg });
        break;
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Envoi de l'image en buffer
      await socket.sendMessage(from, { image: buffer, caption: `✅ Capture de ${url}` }, { quoted: msg });

    } catch (e) {
      console.error('SSWEB DOWNLOAD IMAGE ERROR', e);
      // fallback : envoyer l'URL si téléchargement échoue
      await socket.sendMessage(from, { text: `✅ Capture prête mais impossible de télécharger l'image. Voici le lien :\n${imageUrl}` }, { quoted: msg });
    }

    // Réaction "ok"
    try { await socket.sendMessage(from, { react: { text: "☑️", key: msg.key } }); } catch (e) {}

  } catch (err) {
    console.error("SSWEB ERROR:", err);
    try { await socket.sendMessage(from, { react: { text: "❌", key: msg.key } }); } catch (e) {}
    await socket.sendMessage(from, { text: "❌ Erreur lors de la génération de la capture d'écran." }, { quoted: msg });
  }
  break;
}
   
 case 'checkban': {
  try {
    const target = (args[0] || '').replace(/[^0-9]/g, '');
    if (!target) {
      return await socket.sendMessage(sender, {
        text: '❌ Utilisation : .checkban 509xxxxxxx'
      }, { quoted: msg });
    }

    // Vérifier si le numéro est fonctionnel sur WhatsApp
    let result;
    try {
      result = await socket.onWhatsApp(target + '@s.whatsapp.net');
    } catch (e) {
      console.error('[CHECKBAN ERROR]', e);
      result = null;
    }

    // vCard factice pour quoted meta
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_CHECKBAN"
      },
      message: {
        contactMessage: {
          displayName: 'KAIDO-MD',
          vcard: `BEGIN:VCARD
VERSION:3.0
N:KAIDO-MD;;;;
FN:KAIDO-MD
ORG:KAIDO-MD
TEL;type=CELL;type=VOICE;waid=${target}:${target}
END:VCARD`
        }
      }
    };

    // Construire la réponse
    let reply;
    if (result && result.length > 0 && result[0]?.exists) {
      reply = `✅ Numéro *${target}* actif sur WhatsApp.\nRien à signaler.\n\n_© KAIDO-MD_`;
    } else {
      reply = `☠️ Numéro *${target}* banni ou inexistant.\nCe num est dead mon gars.\n\n_© KAIDO-MD_`;
    }

    await socket.sendMessage(sender, { text: reply }, { quoted: shonux });

  } catch (err) {
    console.error('[CHECKBAN CASE ERROR]', err);
    await socket.sendMessage(sender, {
      text: `❌ Erreur lors de la vérification : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}
 
 
case 'antistatusmention': {
  try {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = primaryOwnerNumber();

    if (!from.endsWith('@g.us')) {
      return await socket.sendMessage(sender, {
        text: '❌ Cette commande doit être utilisée dans un groupe.'
      }, { quoted: msg });
    }

    if (!(isOwner || isSessionOwner)) {
      return await socket.sendMessage(sender, {
        text: '❌ Seul le propriétaire de la session ou du bot peut changer ce mode.'
      }, { quoted: msg });
    }

    // Charger la config actuelle
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    if (typeof cfg.antistatusmention === 'undefined') cfg.antistatusmention = false;
    if (typeof cfg.antistatusmention_threshold === 'undefined') cfg.antistatusmention_threshold = 2;

    // Construire le texte d’état
    const statusText = cfg.antistatusmention
      ? `✅ AntiStatusMention activé\n⚠️ Seuil: ${cfg.antistatusmention_threshold}`
      : `⛔ AntiStatusMention désactivé\n⚠️ Seuil: ${cfg.antistatusmention_threshold}`;

    // Construire le bouton ON/OFF
    const buttons = [
      {
        buttonId: cfg.antistatusmention ? 'antistatusmention_off' : 'antistatusmention_on',
        buttonText: { displayText: cfg.antistatusmention ? 'OFF' : 'ON' },
        type: 1
      }
    ];

    await socket.sendMessage(sender, {
      text: `⚙️ Paramètre AntiStatusMention\n\n${statusText}\n\nClique sur le bouton pour changer.`,
      buttons: buttons,
      headerType: 1
    }, { quoted: msg });

  } catch (err) {
    console.error('[ANTISTATUS SWITCH ERROR]', err);
    await socket.sendMessage(sender, {
      text: `❌ Erreur lors du changement de mode : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}

// Gestion des boutons
case 'antistatusmention_on': {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  let cfg = await loadUserConfigFromMongo(sanitized) || {};
  cfg.antistatusmention = true;
  await setUserConfigInMongo(sanitized, cfg);
  await socket.sendMessage(from, { text: '✅ AntiStatusMention activé.' }, { quoted: msg });
  break;
}

case 'antistatusmention_off': {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  let cfg = await loadUserConfigFromMongo(sanitized) || {};
  cfg.antistatusmention = false;
  await setUserConfigInMongo(sanitized, cfg);
  await socket.sendMessage(from, { text: '⛔ AntiStatusMention désactivé.' }, { quoted: msg });
  break;
}

// ---------------- CASE tagall ----------------
case 'tagall': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata, participants } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key?.participant || msg.key?.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser tagall.' }, { quoted: msg });
      break;
    }

    // Construire la liste des mentions avec le JID PN lorsqu'il est connu.
    const mentions = participants.map(p => p.jid).filter(Boolean);
    if (!mentions.length) {
      await socket.sendMessage(from, { text: '❌ Aucun membre détecté.' }, { quoted: msg });
      break;
    }

    // Nettoyer les JID pour afficher uniquement le numéro pur
    const lines = mentions.map((jid, i) => {
      const num = jid.split('@')[0].split(':')[0];
      return `${i + 1}. @${num}`;
    });

    // Texte final avec watermark
    const text = `📢 *TAGALL*\n\n${lines.join('\n')}\n\n> 𝐓𝐀𝐆𝐆𝐄𝐃 𝐁𝐘 𝐊𝐀𝐈𝐃𝐎-𝐌𝐃 🐉`;

    await socket.sendMessage(from, { text, mentions }, { quoted: msg });

    // Supprimer la commande envoyée par l’utilisateur pour ne garder que le rendu stylisé
    try {
      await socket.sendMessage(from, { delete: msg.key });
    } catch (e) {
      console.error('DELETE TAGALL COMMAND ERROR', e);
    }
  } catch (e) {
    console.error('TAGALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE setgpp ----------------
case 'setgpp': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;

    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent changer la photo du groupe.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être admin pour changer la photo du groupe.' }, { quoted: msg });
      break;
    }

    // Récupérer le message cité ou courant
    const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
    const quoted = msg.quoted || (ctx?.quotedMessage ? { message: ctx.quotedMessage } : null);
    const target = quoted?.message ? quoted.message : msg.message;
    const contentType = getContentType(target);

    if (!contentType || !/image|document/.test(contentType)) {
      await socket.sendMessage(from, { text: '❗ Réponds à une image (ou envoie l\'image) avec .setgpp pour définir la photo du groupe.' }, { quoted: msg });
      break;
    }

    // Téléchargement robuste du buffer
    let buffer = null;
    try {
      if (typeof socket.downloadMediaMessage === 'function') {
        buffer = await socket.downloadMediaMessage(quoted || msg);
      }
      if (!buffer && typeof downloadContentFromMessage === 'function') {
        const type = contentType.includes('image') ? 'image' : 'document';
        const stream = await downloadContentFromMessage(target[contentType], type);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      }
    } catch (e) { buffer = null; }

    if (!buffer) {
      await socket.sendMessage(from, { text: '❌ Impossible de télécharger l\'image. Essaie de renvoyer l\'image et réessaye.' }, { quoted: msg });
      break;
    }

    // Mise à jour de la photo de groupe (selon version Baileys)
    let updated = false;
    try {
      if (typeof socket.updateProfilePicture === 'function') {
        await socket.updateProfilePicture(from, buffer);
        updated = true;
      }
    } catch (e) { updated = false; }

    if (!updated && typeof socket.groupUpdateProfilePicture === 'function') {
      try {
        await socket.groupUpdateProfilePicture(from, buffer);
        updated = true;
      } catch (e) { updated = false; }
    }

    if (!updated) {
      await socket.sendMessage(from, { text: '❌ Impossible de mettre à jour la photo du groupe : méthode non supportée par cette version de la librairie.' }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { text: '✅ Photo de groupe mise à jour avec succès.' }, { quoted: msg });
  } catch (e) {
    console.error('SETGPP ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}


case 'hidetag':
case 'h': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata, participants } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key?.participant || msg.key?.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser hidetag.' }, { quoted: msg });
      break;
    }

    // Récupérer le texte (sans la commande elle-même)
    const text = args.join(' ').trim();
    if (!text) {
      await socket.sendMessage(from, { text: 'Usage: .h <message> (ex: .h salut ou .h 😂)' }, { quoted: msg });
      break;
    }

    // Construire la liste des mentions (JID complets)
    const mentions = participants.map(p => p.jid).filter(Boolean);
    if (!mentions.length) {
      await socket.sendMessage(from, { text: '❌ Aucun membre détecté à mentionner.' }, { quoted: msg });
      break;
    }

    // Message final avec watermark
    const payloadText = `${text}\n\n> 𝐓𝐀𝐆𝐆𝐄𝐃 𝐁𝐘 𝐊𝐀𝐈𝐃𝐎-𝐌𝐃 🐉`;

    await socket.sendMessage(from, { text: payloadText, mentions }, { quoted: msg });

    // Supprimer la commande envoyée par l'utilisateur (si supporté par ta version de Baileys)
    try {
      await socket.sendMessage(from, { delete: msg.key });
    } catch (e) {
      console.error('DELETE HIDETAG COMMAND ERROR', e);
    }
  } catch (e) {
    console.error('HIDETAG ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'listadmin': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata, participants, groupAdminsJid, botJid } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    let text = `👑 Admins (JID) — ${metadata?.subject || 'groupe'}\n\n`;
    if (!groupAdminsJid.length) text += 'Aucun admin détecté.';
    else groupAdminsJid.forEach((a, i) => text += `${i+1}. ${a}\n`);
    text += `\n🤖 Bot JID: ${botJid || 'non détecté'}`;
    await socket.sendMessage(from, { text }, { quoted: msg });
  } catch (e) {
    console.error('LISTADMIN ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE kick ----------------
case 'kick': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être admin pour retirer des membres.' }, { quoted: msg });
      break;
    }

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) {
      await socket.sendMessage(from, { text: 'Usage: .kick @membre' }, { quoted: msg });
      break;
    }

    // Résoudre les alias PN/LID vers le JID réel du participant, puis protéger admins et bot.
    const toRemove = resolveGroupActionTargets(metadata, mentions)
      .filter(({ participant }) => !isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));
    if (!toRemove.length) {
      await socket.sendMessage(from, { text: '❌ Aucune cible valide (cible absente, admin ou bot).' }, { quoted: msg });
      break;
    }

    await socket.groupParticipantsUpdate(from, toRemove.map(target => target.jid), 'remove');
    await socket.sendMessage(from, {
      text: `✅ Retiré(s): ${toRemove.map(target => target.mentionJid.split('@')[0]).join(', ')}`,
      mentions: toRemove.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('KICK ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE add ----------------
case 'add': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent ajouter des membres.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être administrateur pour ajouter des membres.' }, { quoted: msg });
      break;
    }
    const number = args[0];
    if (!number) return await socket.sendMessage(from, { text: 'Usage: .add <num sans +>' }, { quoted: msg });
    const clean = number.replace(/\D/g, '');
    const jidToAdd = `${clean}@s.whatsapp.net`;
    await socket.groupParticipantsUpdate(from, [jidToAdd], 'add');
    await socket.sendMessage(from, { text: `✅ Ajouté: ${jidToAdd}` }, { quoted: msg });
  } catch (e) {
    console.error('ADD ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE promote ----------------
case 'promote': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent promouvoir.' }, { quoted: msg });
    if (!isGroupSuperAdmin(metadata, socket)) return await socket.sendMessage(from, { text: '❌ Le bot doit être super-admin pour promouvoir.' }, { quoted: msg });

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return await socket.sendMessage(from, { text: 'Usage: .promote @membre' }, { quoted: msg });

    const toPromote = resolveGroupActionTargets(metadata, mentions)
      .filter(({ participant }) => !isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));
    if (!toPromote.length) return await socket.sendMessage(from, { text: '❌ Aucune cible valide à promouvoir.' }, { quoted: msg });

    await socket.groupParticipantsUpdate(from, toPromote.map(target => target.jid), 'promote');
    await socket.sendMessage(from, {
      text: `✅ Promu(s): ${toPromote.map(target => target.mentionJid.split('@')[0]).join(', ')}`,
      mentions: toPromote.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('PROMOTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE demote ----------------
case 'demote': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent rétrograder.' }, { quoted: msg });
    if (!isGroupSuperAdmin(metadata, socket)) return await socket.sendMessage(from, { text: '❌ Le bot doit être super-admin pour rétrograder.' }, { quoted: msg });

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return await socket.sendMessage(from, { text: 'Usage: .demote @membre' }, { quoted: msg });

    const toDemote = resolveGroupActionTargets(metadata, mentions)
      .filter(({ participant }) => isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));
    if (!toDemote.length) return await socket.sendMessage(from, { text: '❌ Aucune cible admin valide à rétrograder.' }, { quoted: msg });

    await socket.groupParticipantsUpdate(from, toDemote.map(target => target.jid), 'demote');
    await socket.sendMessage(from, {
      text: `✅ Rétrogradé(s): ${toDemote.map(target => target.mentionJid.split('@')[0]).join(', ')}`,
      mentions: toDemote.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('DEMOTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE kickall ----------------
case 'kickall': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { metadata, participants } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser kickall.' }, { quoted: msg });
    if (!isBotGroupAdmin(metadata, socket)) return await socket.sendMessage(from, { text: '❌ Le bot doit être admin.' }, { quoted: msg });

    // Ne retirer ni les administrateurs (PN/LID) ni le compte du bot.
    const toRemove = resolveGroupActionTargets(metadata, participants)
      .filter(({ participant }) => !isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));
    if (!toRemove.length) return await socket.sendMessage(from, { text: '❌ Aucun membre non-admin à retirer.' }, { quoted: msg });

    await socket.groupParticipantsUpdate(from, toRemove.map(target => target.jid), 'remove');
    await socket.sendMessage(from, {
      text: `✅ Retirés: ${toRemove.length} membres`,
      mentions: toRemove.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('KICKALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE tagall ----------------
case 'tagall': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { metadata, participants } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent tagall.' }, { quoted: msg });

    const mentions = participants.map(p => p.jid).filter(Boolean);
    const text = `🔔 Mention de tous les membres (${mentions.length})`;
    await socket.sendMessage(from, { text, mentions }, { quoted: msg });
  } catch (e) {
    console.error('TAGALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'acceptall': {
  if (!from.endsWith('@g.us')) break;
  try {
    // Vérifier que l’expéditeur est admin
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent accepter les demandes.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être administrateur pour accepter les demandes.' }, { quoted: msg });
      break;
    }

    // Récupérer les demandes en attente
    const requests = await socket.groupRequestParticipantsList(from);
    if (!requests || requests.length === 0) {
      await socket.sendMessage(from, { text: 'ℹ️ Aucune demande en attente.' }, { quoted: msg });
      break;
    }

    // Accepter toutes les demandes
    for (const req of requests) {
      await socket.groupRequestParticipantsUpdate(from, [req.jid], 'approve');
    }

    await socket.sendMessage(from, { text: `✅ ${requests.length} demandes acceptées.` }, { quoted: msg });
  } catch (e) {
    console.error('ACCEPTALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'revokeall': {
  if (!from.endsWith('@g.us')) break;
  try {
    // Vérifier que l’expéditeur est admin
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent rejeter les demandes.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être administrateur pour rejeter les demandes.' }, { quoted: msg });
      break;
    }

    // Récupérer les demandes en attente
    const requests = await socket.groupRequestParticipantsList(from);
    if (!requests || requests.length === 0) {
      await socket.sendMessage(from, { text: 'ℹ️ Aucune demande en attente.' }, { quoted: msg });
      break;
    }

    // Rejeter toutes les demandes
    for (const req of requests) {
      await socket.groupRequestParticipantsUpdate(from, [req.jid], 'reject');
    }

    await socket.sendMessage(from, { text: `🚫 ${requests.length} demandes rejetées.` }, { quoted: msg });
  } catch (e) {
    console.error('REVOKEALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE mute / unmute ----------------
case 'mute': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent activer mute.' }, { quoted: msg });
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      return await socket.sendMessage(from, { text: '❌ Le bot doit être admin pour fermer le groupe.' }, { quoted: msg });
    }

    if (typeof socket.groupSettingUpdate === 'function') {
      await socket.groupSettingUpdate(from, 'announcement'); // admin-only

      // Récupérer tous les participants
      const metadata = await socket.groupMetadata(from);
      const participants = metadata.participants.map(p => p.id);

      await socket.sendMessage(from, { 
        text: '🔇 Groupe en mode admin-only.',
        mentions: participants
      }, { quoted: msg });
    } else {
      await socket.sendMessage(from, { text: '❌ Méthode groupSettingUpdate non disponible.' }, { quoted: msg });
    }
  } catch (e) {
    console.error('MUTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'unmute': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { metadata } = await require('../lib/normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!isGroupAdmin(metadata, [senderJid, msg.key?.participantAlt])) {
      return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent désactiver mute.' }, { quoted: msg });
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      return await socket.sendMessage(from, { text: '❌ Le bot doit être admin pour rouvrir le groupe.' }, { quoted: msg });
    }

    if (typeof socket.groupSettingUpdate === 'function') {
      await socket.groupSettingUpdate(from, 'not_announcement'); // everyone can send

      // Récupérer tous les participants
      const metadata = await socket.groupMetadata(from);
      const participants = metadata.participants.map(p => p.id);

      await socket.sendMessage(from, { 
        text: '🔊 Groupe rouvert, tout le monde peut parler.',
        mentions: participants
      }, { quoted: msg });
    } else {
      await socket.sendMessage(from, { text: '❌ Méthode groupSettingUpdate non disponible.' }, { quoted: msg });
    }
  } catch (e) {
    console.error('UNMUTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE leave ----------------
case 'leave': {
  // Ne traiter que les commandes envoyées dans un groupe
  if (!from.endsWith('@g.us')) break;

  // Préparer la fausse vCard (quoted meta) avec le nom du bot
  try {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'KAIDO-MD';

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_LEAVE"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:KAIDO-MD
TEL;type=CELL;type=VOICE;waid=${primaryOwnerNumber()}:${config.OWNER_NUMBER}
END:VCARD`
        }
      }
    };

    // Déterminer l'émetteur (JID et numéro)
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    const senderNum = (String(senderJid || '').split('@')[0] || '').replace(/[^0-9]/g, '');
    const ownerNum = primaryOwnerNumber();

    // Autorisation : seul le propriétaire de la session ou le bot owner peut forcer le bot à quitter
    if (!(isOwner || isSessionOwner)) {
      // Message en français indiquant la restriction
      await socket.sendMessage(from, {
        text: '❌ Seul le propriétaire de cette session ou le propriétaire du bot peut demander au bot de quitter le groupe.'
      }, { quoted: shonux });
      break;
    }

    // Tentative de départ du groupe
    try {
      await socket.groupLeave(from);
      // Confirmation publique dans le groupe (optionnel : on peut aussi envoyer en privé au propriétaire)
      await socket.sendMessage(from, {
        text: `✅ Le bot ${botName} a quitté le groupe sur demande de ${senderNum}.`
      }, { quoted: shonux });
      if (process.env.LOG_LEVEL === 'debug') console.info(`[LEAVE] session ${sanitized} left group ${from} by ${senderNum}`);
    } catch (leaveErr) {
      console.error('[LEAVE] Erreur lors de la tentative de quitter le groupe', leaveErr);
      await socket.sendMessage(from, {
        text: `❌ Impossible de quitter le groupe : ${leaveErr?.message || leaveErr}`
      }, { quoted: shonux });
    }

  } catch (e) {
    console.error('LEAVE ERROR', e);
    // En cas d'erreur inattendue, on répond avec la vCard si possible
    try {
      const fallbackShonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_LEAVE_FALLBACK" },
        message: { contactMessage: { displayName: 'KAIDO-MD', vcard: `BEGIN:VCARD\nVERSION:3.0\nN:KAIDO-MD;;;;\nFN:KAIDO-MD\nEND:VCARD` } }
      };
      await socket.sendMessage(from, { text: `❌ Erreur lors de l'exécution de la commande leave : ${e?.message || e}` }, { quoted: fallbackShonux });
    } catch (ignore) { /* ignore */ }
  }
  break;
}
// ---------------- CASE TESTGRP ----------------
case 'testgrp': {
  // Cette commande affiche comment le bot reçoit les infos du groupe et des participants
  // Utilise : .testgrp (dans un groupe) ou en MP pour tester un groupe (si from est un groupe)
  try {
    // Vérifier contexte
    if (!from) break;

    // Si pas dans un groupe, on informe et on propose d'utiliser .testgrp en groupe
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: "❗ Cette commande doit idéalement être utilisée dans un groupe pour inspecter les metadata du groupe." }, { quoted: msg });
      break;
    }

    // Récupérer les admins et le compte du bot avec les alias PN/LID réels.
    const metadata = await socket.groupMetadata(from);
    const participants = metadata?.participants || [];
    const groupAdminsJid = getGroupAdminJids(metadata);
    const groupAdminsNum = getGroupAdminNumbers(metadata);
    const botJid = getBotJid(metadata, socket) || null;
    const botNum = getPhoneNumberJid(socket.user || {}).split('@')[0] || '';
    const botIsAdmin = isBotGroupAdmin(metadata, socket);

    // Construire un résumé lisible
    let text = `🔎 *TESTGRP — Diagnostic du groupe*\n\n`;
    text += `• *Groupe* : ${metadata?.subject || '—'}\n`;
    text += `• *GID* : ${from}\n`;
    text += `• *Description* : ${metadata?.desc || '—'}\n`;
    text += `• *Créateur* : ${metadata?.owner || '—'}\n`;
    text += `• *Taille* : ${participants.length} membres\n\n`;

    text += `👥 *Admins (JID complet)* :\n`;
    if (groupAdminsJid.length) groupAdminsJid.forEach((a, i) => { text += `${i+1}. ${a}\n`; });
    else text += `Aucun admin détecté\n`;
    text += `\n🔢 *Admins (numéros nettoyés)* :\n`;
    if (groupAdminsNum.length) text += groupAdminsNum.join(', ') + '\n'; else text += '—\n';

    text += `\n🤖 *Bot JID* : ${botJid || 'non détecté'}\n`;
    text += `🤖 *Bot numéro* : ${botNum || '—'}\n`;
    text += `🤖 *Bot admin ?* : ${botIsAdmin ? '✅ Oui' : '❌ Non'}\n\n`;

    // Exemple de mapping participants -> rôle et format brut (limité à 50 pour éviter message trop long)
    text += `📋 *Aperçu participants (max 50)* :\n`;
    const sample = participants.slice(0, 50);
    sample.forEach((p, i) => {
      const id = p.id || '—';
      const num = id.split('@')[0].split(':')[0];
      const admin = isAdminParticipant(p) ? p.admin : '—';
      const isSuper = typeof admin === 'string' && admin.toLowerCase() === 'superadmin' ? ' (superadmin)' : '';
      text += `${i+1}. ${num} — admin: ${admin}${isSuper}\n`;
    });
    if (participants.length > 50) text += `... et ${participants.length - 50} autres\n`;

    // Envoyer résumé lisible
    await socket.sendMessage(from, { text }, { quoted: msg });

    // Envoyer dump JSON (pour debug détaillé) en fichier ou en message (ici on envoie en message texte si pas trop grand)
    const dump = {
      metadata,
      participantsCount: participants.length,
      groupAdminsJid,
      groupAdminsNum,
      botJid,
      botNum,
      rawSocketUser: socket.user || null
    };
    const dumpStr = JSON.stringify(dump, null, 2);

    if (dumpStr.length < 15000) {
      // envoie le JSON directement (pratique pour debug)
      await socket.sendMessage(from, { text: `\`\`\`json\n${dumpStr}\n\`\`\`` }, { quoted: msg });
    } else {
      // si trop long, log côté serveur et prévenir l'utilisateur
      console.log('[TESTGRP DUMP]', dump);
      await socket.sendMessage(from, { text: 'ℹ️ Dump trop volumineux pour l\'envoyer ici — vérifie les logs serveur.' }, { quoted: msg });
    }

  } catch (e) {
    console.error('[TESTGRP ERROR]', e);
    await socket.sendMessage(from, { text: `❌ Erreur lors du diagnostic : ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'admininfo': {
  // Affiche la liste des admins (numéros) et le JID/numéro du bot, en réutilisant la logique de kickall
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }

  try {
    const metadata = await socket.groupMetadata(from);
    const participants = metadata.participants || [];
    const groupName = metadata.subject || "Sans nom";

    // Utiliser les alias PN/LID des participants pour le diagnostic.
    const botJid = getBotJid(metadata, socket) || 'non détecté';
    const botNumber = getPhoneNumberJid(socket.user || {}).split('@')[0] || '—';
    const groupAdmins = getGroupAdminJids(metadata);

    // Construire la liste lisible des admins (numéros)
    let adminListText = `👥 *ADMINS DU GROUPE* — ${groupName}\n\n`;
    if (!groupAdmins.length) {
      adminListText += 'Aucun admin détecté.\n';
    } else {
      groupAdmins.forEach((admin, i) => {
        const num = admin.split('@')[0];
        adminListText += `${(i + 1).toString().padStart(2, '0')}. @${num}\n`;
      });
    }

    // Vérifier le compte du bot par ses identifiants PN/LID.
    const botIsAdmin = isBotGroupAdmin(metadata, socket);

    // Ajouter info bot
    adminListText += `\n🤖 *Bot JID* : ${botJid}\n`;
    adminListText += `🤖 *Bot numéro* : ${botNumber}\n`;
    adminListText += `🤖 *Bot admin ?* : ${botIsAdmin ? '✅ Oui' : '❌ Non'}`;

    const mentions = [...groupAdmins];

    await socket.sendMessage(from, {
      text: adminListText,
      mentions
    }, { quoted: msg });

  } catch (e) {
    console.error('[ERROR admininfo]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de la récupération des infos admin.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}
// ---------- MUTE ----------


// ---------- TAGALL ----------
case 'tagall': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }

  try {
    const metadata = await socket.groupMetadata(from);
    const participants = metadata.participants || [];
    const groupName = metadata.subject || "Sans nom";

    // Vérifier l'auteur par son JID principal ou son alias.
    if (!isGroupAdmin(metadata, [sender, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser tagall.' }, { quoted: msg });
      break;
    }

    // Construire le message et la liste de mentions (exclure le bot si tu veux)
    const members = participants.map(getParticipantId).filter(id => id && !isBotIdentity(socket, id));
    if (!members.length) {
      await socket.sendMessage(from, { text: '❌ Aucun membre à mentionner.' }, { quoted: msg });
      break;
    }

    // Construire un texte paginé si trop long
    const lines = members.map((m, i) => `${(i + 1).toString().padStart(2, '0')}. @${m.split('@')[0]}`);
    const caption = `📣 *TAG ALL* — ${groupName}\n\n${lines.join('\n')}\n\nTotal: ${members.length}`;

    await socket.sendMessage(from, { text: caption, mentions: members }, { quoted: msg });
  } catch (e) {
    console.error('[ERROR tagall]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors du tagall.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------- KICK (mention) ----------
// main.js (ou ton handler)

// Exemple d'utilisation dans une case add/kick/mute...
case 'kick': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }

  try {
    const { metadata } = await getGroupAdminsInfo(socket, from);
    const senderIds = [nowsender, msg.key?.participant, msg.key?.participantAlt].filter(Boolean);
    if (!isGroupAdmin(metadata, senderIds)) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Je dois être admin pour retirer des membres.' }, { quoted: msg });
      break;
    }

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return await socket.sendMessage(from, { text: 'Usage: .kick @membre' }, { quoted: msg });

    const toRemove = resolveGroupActionTargets(metadata, mentions)
      .filter(({ participant }) => !isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));

    if (!toRemove.length) {
      await socket.sendMessage(from, { text: '❌ Impossible de retirer : cible absente, admin ou bot.' }, { quoted: msg });
      break;
    }

    await socket.groupParticipantsUpdate(from, toRemove.map(target => target.jid), 'remove');
    await socket.sendMessage(from, {
      text: `✅ Utilisateur(s) retiré(s): ${toRemove.map(target => '@' + target.mentionJid.split('@')[0]).join(', ')}`,
      mentions: toRemove.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('[ERROR kick]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors du kick.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------- PROMOTE ----------
case 'promote': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }

  try {
    const metadata = await socket.groupMetadata(from);
    const participants = metadata.participants || [];
    const actor = nowsender || msg.key?.participant || msg.key?.remoteJid;

    if (!isGroupAdmin(metadata, [actor, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: msg });
      break;
    }
    if (!isGroupSuperAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être super-admin pour promouvoir des membres.' }, { quoted: msg });
      break;
    }

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) {
      await socket.sendMessage(from, { text: 'Usage: .promote @membre' }, { quoted: msg });
      break;
    }

    // Ne pas promouvoir le bot ni les admins déjà promus.
    const toPromote = resolveGroupActionTargets(metadata, mentions)
      .filter(({ participant }) => !isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));
    if (!toPromote.length) {
      await socket.sendMessage(from, { text: '❌ Aucune cible valide à promouvoir.' }, { quoted: msg });
      break;
    }

    await socket.groupParticipantsUpdate(from, toPromote.map(target => target.jid), 'promote');
    await socket.sendMessage(from, {
      text: `✅ Promu(s): ${toPromote.map(target => '@' + target.mentionJid.split('@')[0]).join(', ')}`,
      mentions: toPromote.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('[ERROR promote]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de la promotion.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------- DEMOTE ----------
case 'demote': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }

  try {
    const metadata = await socket.groupMetadata(from);
    const actor = nowsender || msg.key?.participant || msg.key?.remoteJid;

    if (!isGroupAdmin(metadata, [actor, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: msg });
      break;
    }
    if (!isGroupSuperAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être super-admin pour rétrograder des membres.' }, { quoted: msg });
      break;
    }

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) {
      await socket.sendMessage(from, { text: 'Usage: .demote @membre' }, { quoted: msg });
      break;
    }

    // Ne pas démoter le bot et ne cibler que les admins.
    const toDemote = resolveGroupActionTargets(metadata, mentions)
      .filter(({ participant }) => isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant));
    if (!toDemote.length) {
      await socket.sendMessage(from, { text: '❌ Aucune cible admin valide à rétrograder.' }, { quoted: msg });
      break;
    }

    await socket.groupParticipantsUpdate(from, toDemote.map(target => target.jid), 'demote');
    await socket.sendMessage(from, {
      text: `✅ Rétrogradé(s): ${toDemote.map(target => '@' + target.mentionJid.split('@')[0]).join(', ')}`,
      mentions: toDemote.map(target => target.mentionJid)
    }, { quoted: msg });
  } catch (e) {
    console.error('[ERROR demote]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de la rétrogradation.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}
/* setconfig <KEY> <VALUE> */
/* setconfig */
case 'setconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    // permission : seul le propriétaire de la session (number) ou le bot owner peut modifier
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = primaryOwnerNumber();
    if (!(isOwner || isSessionOwner)) {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_DENIED" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session configuration.' }, { quoted: meta });
      break;
    }

    const key = (args[0] || '').trim();
    const rawValue = args.slice(1).join(' ').trim();

    if (!key || rawValue === '') {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_HELP" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      return await socket.sendMessage(sender, { text: '❗ Usage: .setconfig <KEY> <VALUE>\nEx: .setconfig AUTO_VIEW_STATUS false\nPour voir les clés disponibles: .showconfig' }, { quoted: meta });
    }

    if (typeof ALLOWED_KEYS !== 'undefined' && Array.isArray(ALLOWED_KEYS) && !ALLOWED_KEYS.includes(key)) {
      return await socket.sendMessage(sender, { text: `❌ Clé non autorisée. Clés autorisées: ${ALLOWED_KEYS.join(', ')}` }, { quoted: msg });
    }

    const parsed = (typeof parseValueByType === 'function') ? parseValueByType(rawValue) : rawValue;

    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    cfg = Object.assign({}, DEFAULT_SESSION_CONFIG || {}, cfg);
    cfg[key] = parsed;

    cfg._meta = cfg._meta || {};
    cfg._meta.updatedAt = new Date();
    cfg._meta.updatedBy = senderNum;
    cfg._meta.raw = rawValue;

    await setUserConfigInMongo(sanitized, cfg);

    const metaOk = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_OK" },
      message: { contactMessage: { displayName: cfg.botName || BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: `✅ Configuration mise à jour pour ${sanitized}\n• ${key} = ${formatValueForDisplay ? formatValueForDisplay(parsed) : String(parsed)}` }, { quoted: metaOk });

  } catch (e) {
    console.error('setconfig error', e);
    const metaErr = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_ERR" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set config: ${e.message || e}` }, { quoted: metaErr });
  }
  break;
}

/* getconfig */
case 'getconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const key = (args[0] || '').trim();
    if (!key) {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GETCONFIG_HELP" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      return await socket.sendMessage(sender, { text: '❗ Usage: .getconfig <KEY>\nEx: .getconfig AUTO_VIEW_STATUS\nPour voir toutes les clés: .showconfig' }, { quoted: meta });
    }

    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const value = (cfg.hasOwnProperty(key)) ? cfg[key] : (DEFAULT_SESSION_CONFIG && DEFAULT_SESSION_CONFIG[key] !== undefined ? DEFAULT_SESSION_CONFIG[key] : undefined);

    const meta = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GETCONFIG" },
      message: { contactMessage: { displayName: botName } }
    };

    if (typeof value === 'undefined') {
      await socket.sendMessage(sender, { text: `ℹ️ Clé introuvable: ${key}` }, { quoted: meta });
    } else {
      await socket.sendMessage(sender, { text: `🔎 ${key} = ${formatValueForDisplay ? formatValueForDisplay(value) : String(value)}` }, { quoted: meta });
    }

  } catch (e) {
    console.error('getconfig error', e);
    const metaErr = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GETCONFIG_ERR" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: metaErr });
  }
  break;
}
/* resetconfig */
case 'resetconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = primaryOwnerNumber();
    if (!(isOwner || isSessionOwner)) {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_RESET_DENIED" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can reset this session configuration.' }, { quoted: meta });
      break;
    }

    const cfg = Object.assign({}, DEFAULT_SESSION_CONFIG || {});
    cfg._meta = { updatedAt: new Date(), updatedBy: senderNum, raw: 'reset' };

    await setUserConfigInMongo(sanitized, cfg);

    const metaOk = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_RESET_OK" },
      message: { contactMessage: { displayName: cfg.botName || BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: `✅ Configuration de session ${sanitized} réinitialisée aux valeurs par défaut.` }, { quoted: metaOk });

  } catch (e) {
    console.error('resetconfig error', e);
    const metaErr = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_RESET_ERR" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to reset config.' }, { quoted: metaErr });
  }
  break;
}

/* showconfig */
case 'showconfig2': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfgRaw = await loadUserConfigFromMongo(sanitized) || {};
    const cfg = Object.assign({}, DEFAULT_SESSION_CONFIG || {}, cfgRaw);
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_SHOWCONFIG"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // Construire le texte de sortie
    const lines = [];
    lines.push(`📋 Configuration de session — ${sanitized}`);
    lines.push('');
    lines.push(`• Bot name: ${botName}`);
    lines.push(`• Logo: ${cfg.logo || config.RCD_IMAGE_PATH || 'aucun'}`);
    // Afficher les clés par défaut dans un ordre lisible
    for (const k of Object.keys(DEFAULT_SESSION_CONFIG || {})) {
      if (k === 'botName') continue; // déjà affiché
      const val = cfg.hasOwnProperty(k) ? cfg[k] : DEFAULT_SESSION_CONFIG[k];
      lines.push(`• ${k}: ${formatValueForDisplay ? formatValueForDisplay(val) : String(val)}`);
    }
    // Clés personnalisées
    const extraKeys = Object.keys(cfg).filter(k => !DEFAULT_SESSION_CONFIG.hasOwnProperty(k) && k !== '_meta');
    if (extraKeys.length) {
      lines.push('');
      lines.push('🔧 Clés personnalisées:');
      for (const k of extraKeys) {
        lines.push(`• ${k}: ${formatValueForDisplay ? formatValueForDisplay(cfg[k]) : String(cfg[k])}`);
      }
    }
    // Meta info
    if (cfg._meta) {
      lines.push('');
      lines.push(`Dernière mise à jour: ${cfg._meta.updatedAt || ''}`);
      lines.push(`Par: ${cfg._meta.updatedBy || ''}`);
    }

    await socket.sendMessage(sender, { text: lines.join('\n') }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonuxErr = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_SHOWCONFIG_ERR"
      },
      message: {
        contactMessage: {
          displayName: BOT_NAME_FANCY,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonuxErr });
  }
  break;
}


case 'sticker': case 's': {
  try {
    // parser args pour "auteur | titre"
    const raw = (args && args.join(' ')) || '';
    let author = '';
    let title = '';
    if (raw.includes('|')) {
      const parts = raw.split('|').map(p => p.trim());
      author = parts[0] || '';
      title = parts.slice(1).join(' | ') || '';
    } else if (raw.trim()) {
      title = raw.trim();
    }

    // Détection du message cité (même logique que dans tovn)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    // Si pas de quoted, on tente de voir si le message courant contient un média
    const selfMedia = msg.message && (
      msg.message.imageMessage ||
      msg.message.videoMessage ||
      msg.message.documentMessage ||
      msg.message.stickerMessage
    ) ? msg.message : null;

    if (!quoted && !selfMedia) {
      await socket.sendMessage(sender, {
        text: '❗ Réponds à une image, GIF ou vidéo, ou envoie-en une avec la commande .sticker 𝐄𝐗𝐄𝐌𝐏𝐋𝐄 : .s mugiwara | it\'s me the best dev'
      }, { quoted: msg });
      break;
    }

    // Préparer un objet media compatible avec createStickerFromMedia: { buffer, mime, fileName? }
    let media = null;

    // Si quoted existe, déterminer le type (imageMessage, videoMessage, documentMessage, stickerMessage, etc.)
    if (quoted) {
      // quoted peut contenir imageMessage, videoMessage, documentMessage, stickerMessage, etc.
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage','extendedTextMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) {
        await socket.sendMessage(sender, { text: '❌ Média cité non supporté.' }, { quoted: msg });
        break;
      }

      // Déterminer le message content (ex: quoted.imageMessage)
      const quotedContent = quoted[qType];

      // Télécharger via downloadContentFromMessage (Baileys)
      const messageType = qType.replace(/Message$/i, '').toLowerCase(); // 'image', 'video', 'document', 'sticker', ...
      const stream = await downloadContentFromMessage(quotedContent, messageType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      media = {
        buffer,
        mime: quotedContent.mimetype || quotedContent.mimetype || '',
        caption: quotedContent.caption || quotedContent.fileName || '',
        fileName: quotedContent.fileName || ''
      };
    } else if (selfMedia) {
      // Si le message courant contient le média (non cité)
      const m = selfMedia.imageMessage || selfMedia.videoMessage || selfMedia.documentMessage || selfMedia.stickerMessage;
      const qType = selfMedia.imageMessage ? 'image' : selfMedia.videoMessage ? 'video' : selfMedia.documentMessage ? 'document' : 'sticker';
      const stream = await downloadContentFromMessage(m, qType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      media = {
        buffer,
        mime: m.mimetype || '',
        caption: m.caption || m.fileName || '',
        fileName: m.fileName || ''
      };
    }

    if (!media || !media.buffer) {
      await socket.sendMessage(sender, { text: '❌ Impossible de télécharger le média cité.' }, { quoted: msg });
      break;
    }

    // Crée le sticker (statique ou animé selon le média)
    const { buffer: stickerBuffer } = await createStickerFromMedia(media, author, title);

    // Envoie le sticker
    await sendSticker(socket, sender, stickerBuffer, msg);

  } catch (err) {
    console.error('[STICKER ERROR]', err);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de la création du sticker.\n${err.message || err}` }, { quoted: msg });
  }
  break;
}


case 'setppfull':
case 'setpp': {
  try {
    // Résolution sécurisée du préfixe (variable peut être absente selon le contexte)
    const prefix = (typeof usedPrefix !== 'undefined' && usedPrefix)
                || (typeof prefix_used !== 'undefined' && prefix_used)
                || (typeof client?.prefix !== 'undefined' && client.prefix)
                || '.';

    // ── 1. Source média ────────────────────────────────────────────────────────
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const directMsg = msg.message?.imageMessage || msg.message?.documentMessage
                       ? msg.message : null;
    const target = quotedMsg || directMsg;

    if (!target) {
      await socket.sendMessage(
        sender,
        { text: `❗ Réponds à une image avec ${prefix}setpp` },
        { quoted: msg }
      );
      break;
    }

    // ── 2. Télécharger le média ────────────────────────────────────────────────
    const downloader = async (src, type) => {
      if (typeof downloadMediaMessage === 'function') {
        try { return await downloadMediaMessage(src, type); } catch (_) {}
      }
      const { downloadContentFromMessage } = require('@rexxhayanasi/elaina-bail');
      const stream = await downloadContentFromMessage(src, type);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    };

    const buffer = await robustDownload(target, downloader);
    if (!buffer?.length) throw new Error('Buffer vide — média invalide.');
    console.log('[SETPP] Buffer:', buffer.length, 'bytes');

    // ── 3. Résoudre le JID du bot ──────────────────────────────────────────────
    const botJid =
      socket?.user?.id                 ||
      socket?.userJid                  ||
      socket?.authState?.creds?.me?.id ||
      null;

    if (!botJid) throw new Error('JID du bot introuvable.');

    // ── 4. Mise à jour — elaina-bail fullpp en priorité ────────────────────────
    let updated = false;

    if (typeof socket.updateProfilePictureFull === 'function') {
      try {
        await socket.updateProfilePictureFull(botJid, buffer);
        updated = true;
        console.log('[SETPP] updateProfilePictureFull ✓');
      } catch (e) {
        console.warn('[SETPP] updateProfilePictureFull failed:', e?.message);
      }
    }

    if (!updated && typeof socket.updateProfilePicture === 'function') {
      try {
        await socket.updateProfilePicture(botJid, buffer, { fullPicture: true });
        updated = true;
        console.log('[SETPP] updateProfilePicture {fullPicture:true} ✓');
      } catch (e) {
        console.warn('[SETPP] updateProfilePicture+fullPicture failed:', e?.message);
        await socket.updateProfilePicture(botJid, buffer);
        updated = true;
        console.log('[SETPP] updateProfilePicture (standard) ✓');
      }
    }

    if (!updated) {
      if (typeof socket.query !== 'function') {
        throw new Error('Aucune méthode disponible pour mettre à jour la photo.');
      }
      await socket.query({
        tag: 'iq',
        attrs: { to: botJid, type: 'set', xmlns: 'w:profile:picture' },
        content: [{
          tag: 'picture',
          attrs: { type: 'image' },
          content: [
            { tag: 'image',   attrs: {}, content: buffer },
            { tag: 'preview', attrs: {}, content: buffer }
          ]
        }]
      });
      updated = true;
      console.log('[SETPP] IQ raw ✓');
    }

    await socket.sendMessage(
      sender,
      { text: '✅ Photo de profil mise à jour (full size) !' },
      { quoted: msg }
    );

  } catch (err) {
    console.error('[SETPP ERROR]', err);
    await socket.sendMessage(
      sender,
      { text: `❌ Échec du changement de photo.\n› ${err?.message ?? String(err)}` },
      { quoted: msg }
    );
  }
  break;
}
case 'sr': {
  if (!isOwner) {
    await socket.sendMessage(sender, { text: '❌ Owner only.' }, { quoted: msg });
    break;
  }

  const arg = (args[0] || '').toLowerCase();
  const minutes = parseInt(arg);

  if (!arg) {
    await socket.sendMessage(sender, {
      text: `⚙️ *SCHEDULE RESTART*\n\n` +
            `Usage: .sr [minutes]\n` +
            `Ex: .sr 60 → restart toutes les heures\n\n` +
            `Options:\n` +
            `.sr stop → arrêter\n` +
            `.sr now → restart maintenant\n` +
            `.sr status → voir état`
    }, { quoted: msg });
    break;
  }

  if (arg === 'stop') {
    if (global.restartTimer) {
      clearInterval(global.restartTimer);
      global.restartTimer = null;
    }
    await stopRestartSchedule();
    await socket.sendMessage(sender, { text: '✅ Schedule restart arrêté' }, { quoted: msg });
    break;
  }

  if (arg === 'now') {
    await socket.sendMessage(sender, { text: '🔄 Restarting...' }, { quoted: msg });
    setTimeout(() => process.exit(0), 2000);
    break;
  }

  if (arg === 'status') {
    const doc = await getRestartSchedule();
    if (doc && doc.active) {
      await socket.sendMessage(sender, {
        text: `✅ Schedule actif\nIntervalle: ${doc.minutes} minutes`
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, { text: '❌ Aucun schedule actif' }, { quoted: msg });
    }
    break;
  }

  if (isNaN(minutes) || minutes < 1) {
    await socket.sendMessage(sender, { text: '❌ Spécifiez un nombre de minutes valide' }, { quoted: msg });
    break;
  }

  // Arrêter le précédent timer
  if (global.restartTimer) clearInterval(global.restartTimer);

  // Programmer le restart
  global.restartTimer = setInterval(() => {
    console.log(`🔄 Restart automatique (${minutes} minutes)`);
    process.exit(0);
  }, minutes * 60 * 1000);

  global.restartInterval = minutes;
  await setRestartSchedule(minutes);

  await socket.sendMessage(sender, {
    text: `✅ Restart programmé toutes les ${minutes} minutes`
  }, { quoted: msg });

  break;
}




  
 case 'antidelete':
case 'ad': {
  try {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum  = primaryOwnerNumber();

    if (!(isOwner || isSessionOwner)) {
      await socket.sendMessage(sender, {
        text: `❌ Seul le propriétaire de la session peut modifier ce paramètre.`
      }, { quoted: msg });
      break;
    }

    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    const sub = (args[0] || '').toLowerCase();

    // ── Sous-commandes ──
    if (sub === 'status') {
      const mode = normaliseAntideleteMode(cfg.antidelete);
      const storeSize = messageStores.get(sanitized)?.size || 0;
      const modeLabel = mode === 'all' ? '🌐 Tout (groupes + privé)'
                      : mode === 'g'   ? '👥 Groupes seulement'
                      : mode === 'p'   ? '💬 Privé seulement'
                      : '⛔ Désactivé';
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🗑️ *ANTIDELETE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `📊 *État :* ${modeLabel}\n` +
              `💾 *Store :* ${storeSize}/${STORE_MAX_PER_SESSION} messages\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    if (sub === 'off') {
      cfg.antidelete = 'off';
      // Les anciennes entrées restent utiles si des réactions déclenchent des
      // commandes; sinon on libère immédiatement le cache de cette session.
      if (!sessionHasReactionCommands(sanitized)) deleteSessionStore(sanitized);
    } else if (sub === 'g') {
      cfg.antidelete = 'g';   // groupes seulement
    } else if (sub === 'p') {
      cfg.antidelete = 'p';   // privé seulement
    } else if (sub === 'all') {
      cfg.antidelete = 'all'; // tout
    } else {
      // Pas d'arg ou arg inconnu → afficher le menu
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🗑️ *ANTIDELETE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `*Commandes disponibles :*\n\n` +
              `  ${prefix}ad all → 🌐 Tout écouter\n` +
              `  ${prefix}ad g   → 👥 Groupes seulement\n` +
              `  ${prefix}ad p   → 💬 Privé seulement\n` +
              `  ${prefix}ad off → ⛔ Désactiver\n` +
              `  ${prefix}ad status → 📊 État actuel\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    await setUserConfigInMongo(sanitized, cfg);

    const labels = {
      'all': '🌐 *Tout activé* — groupes + privé',
      'g'  : '👥 *Groupes seulement* activé',
      'p'  : '💬 *Privé seulement* activé',
      'off': '⛔ *Désactivé* — store vidé'
    };

    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🗑️ *ANTIDELETE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `✅ ${labels[cfg.antidelete]}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

  } catch (e) {
    console.error('[ANTIDELETE ERROR]', e);
    await socket.sendMessage(sender, {
      text: `❌ Erreur : ${e.message || e}`
    }, { quoted: msg });
  }
  break;
}
              

case 'promote':
case 'admin': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(sender, { 
        text: '❌ Cette commande fonctionne uniquement dans les groupes.' 
      }, { quoted: msg });
      break;
    }

    // Vérifier si l'expéditeur est superadmin
    const groupMetadata = await socket.groupMetadata(from);
    if (!isGroupSuperAdmin(groupMetadata, [nowsender, msg.key?.participantAlt])) {
      await socket.sendMessage(sender, { 
        text: '❌ Seuls les super-administrateurs peuvent promouvoir des membres.' 
      }, { quoted: msg });
      break;
    }
    if (!isGroupSuperAdmin(groupMetadata, socket)) {
      await socket.sendMessage(sender, { text: '❌ Le bot doit être super-administrateur pour promouvoir un membre.' }, { quoted: msg });
      break;
    }

    // Identifier la cible depuis le participant cité ou les mentions PN/LID.
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
    const quotedMsg = contextInfo.quotedMessage;
    const asFirst = value => Array.isArray(value) ? value[0] : value;
    let targetIdentifiers = quotedMsg
      ? [contextInfo.participant, contextInfo.participantAlt]
      : [asFirst(contextInfo.mentionedJid), asFirst(contextInfo.mentionedJidAlt)];

    if (!targetIdentifiers.some(Boolean) && args[0]) {
      const input = args[0].replace(/[^0-9a-z@._:-]/gi, '');
      if (input) targetIdentifiers = [input.includes('@') ? input : `${input}@s.whatsapp.net`];
    }
    if (!targetIdentifiers.some(Boolean)) {
      await socket.sendMessage(sender, {
        text: '❌ Usage : !promote <numéro/@mention>\nOu répondez à un message de la personne'
      }, { quoted: msg });
      break;
    }

    const target = findGroupParticipant(groupMetadata, targetIdentifiers);
    if (!target) {
      await socket.sendMessage(sender, {
        text: '❌ Cette personne n\'est pas dans le groupe.'
      }, { quoted: msg });
      break;
    }
    const targetJid = getParticipantId(target);
    const targetMentionJid = getParticipantMentionJid(target) || targetJid;
    if (!targetJid || isBotIdentity(socket, target)) {
      await socket.sendMessage(sender, { text: '❌ Impossible de promouvoir le bot.' }, { quoted: msg });
      break;
    }
    if (isGroupAdmin(groupMetadata, target)) {
      await socket.sendMessage(sender, { text: '❌ Cette personne est déjà administratrice.' }, { quoted: msg });
      break;
    }

    // Promouvoir en admin
    await socket.groupParticipantsUpdate(from, [targetJid], 'promote');
    
    await socket.sendMessage(sender, { 
      text: `👑 ${target.notify || targetMentionJid.split('@')[0]} a été promu(e) administrateur.`,
      mentions: [targetMentionJid]
    }, { quoted: msg });

  } catch (error) {
    console.error('❌ Erreur promote:', error);
    
    let errorMsg = '❌ Impossible de promouvoir le membre. ';
    if (error.message?.includes('not-authorized')) {
      errorMsg += 'Le bot doit être super-admin.';
    } else if (error.message?.includes('not-a-participant')) {
      errorMsg += 'Cette personne n\'est pas dans le groupe.';
    } else {
      errorMsg += error.message || 'Erreur inconnue';
    }
    
    await socket.sendMessage(sender, { text: errorMsg }, { quoted: msg });
  }
  break;
}

case 'demote':
case 'unadmin': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(sender, { 
        text: '❌ Cette commande fonctionne uniquement dans les groupes.' 
      }, { quoted: msg });
      break;
    }

    // Vérifier si l'expéditeur est superadmin
    const groupMetadata = await socket.groupMetadata(from);
    if (!isGroupSuperAdmin(groupMetadata, [nowsender, msg.key?.participantAlt])) {
      await socket.sendMessage(sender, { 
        text: '❌ Seuls les super-administrateurs peuvent rétrograder des administrateurs.' 
      }, { quoted: msg });
      break;
    }
    if (!isGroupSuperAdmin(groupMetadata, socket)) {
      await socket.sendMessage(sender, { text: '❌ Le bot doit être super-administrateur pour rétrograder un membre.' }, { quoted: msg });
      break;
    }

    // Identifier la cible depuis le participant cité ou les mentions PN/LID.
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
    const quotedMsg = contextInfo.quotedMessage;
    const asFirst = value => Array.isArray(value) ? value[0] : value;
    let targetIdentifiers = quotedMsg
      ? [contextInfo.participant, contextInfo.participantAlt]
      : [asFirst(contextInfo.mentionedJid), asFirst(contextInfo.mentionedJidAlt)];

    if (!targetIdentifiers.some(Boolean) && args[0]) {
      const input = args[0].replace(/[^0-9a-z@._:-]/gi, '');
      if (input) targetIdentifiers = [input.includes('@') ? input : `${input}@s.whatsapp.net`];
    }
    if (!targetIdentifiers.some(Boolean)) {
      await socket.sendMessage(sender, {
        text: '❌ Usage : !demote <numéro/@mention>\nOu répondez à un message de la personne'
      }, { quoted: msg });
      break;
    }

    const target = findGroupParticipant(groupMetadata, targetIdentifiers);
    if (!target) {
      await socket.sendMessage(sender, {
        text: '❌ Cette personne n\'est pas dans le groupe.'
      }, { quoted: msg });
      break;
    }
    const targetJid = getParticipantId(target);
    const targetMentionJid = getParticipantMentionJid(target) || targetJid;
    if (!targetJid || isBotIdentity(socket, target)) {
      await socket.sendMessage(sender, { text: '❌ Impossible de rétrograder le bot.' }, { quoted: msg });
      break;
    }
    if (!isAdminParticipant(target)) {
      await socket.sendMessage(sender, {
        text: '❌ Cette personne n\'est pas administrateur.'
      }, { quoted: msg });
      break;
    }

    const superAdmins = (groupMetadata.participants || []).filter(isSuperAdminParticipant);
    if (isSuperAdminParticipant(target) && superAdmins.length === 1) {
      await socket.sendMessage(sender, {
        text: '❌ Impossible de rétrograder l\'unique super-administrateur du groupe.'
      }, { quoted: msg });
      break;
    }
    if (areSameIdentity(target, [nowsender, msg.key?.participantAlt]) && superAdmins.length === 1) {
      await socket.sendMessage(sender, {
        text: '❌ Vous ne pouvez pas vous retirer en tant que seul super-admin.'
      }, { quoted: msg });
      break;
    }

    // Rétrograder
    await socket.groupParticipantsUpdate(from, [targetJid], 'demote');
    
    await socket.sendMessage(sender, { 
      text: `📉 ${target.notify || targetMentionJid.split('@')[0]} n\'est plus administrateur.`,
      mentions: [targetMentionJid]
    }, { quoted: msg });

  } catch (error) {
    console.error('❌ Erreur demote:', error);
    
    let errorMsg = '❌ Impossible de rétrograder le membre. ';
    if (error.message?.includes('not-authorized')) {
      errorMsg += 'Le bot doit être super-admin.';
    } else if (error.message?.includes('not-a-participant')) {
      errorMsg += 'Cette personne n\'est pas dans le groupe.';
    } else {
      errorMsg += error.message || 'Erreur inconnue';
    }
    
    await socket.sendMessage(sender, { text: errorMsg }, { quoted: msg });
  }
  break;
}


            
            // ============ UPLOAD TO CHANNEL ============
            case 'upch': {
    const fs = require('fs');
    const path = require('path');
    
    // Chemin pour sauvegarder le JID du channel
    const cjidPath = path.join(__dirname, '..', '..', 'config', 'data', 'cjid.json');
    
    // Fonctions utilitaires
    function getChannelJid() {
        if (fs.existsSync(cjidPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(cjidPath, 'utf-8'));
                return data.jid || null;
            } catch (e) { 
                console.error("[UPCH] Erreur lecture cjid:", e);
                return null; 
            }
        }
        return null;
    }
    
    function saveChannelJid(jid) {
        try {
            if (!fs.existsSync(path.dirname(cjidPath))) {
                fs.mkdirSync(path.dirname(cjidPath), { recursive: true });
            }
            fs.writeFileSync(cjidPath, JSON.stringify({ jid }, null, 2));
            return true;
        } catch (e) {
            console.error("[UPCH] Erreur sauvegarde cjid:", e);
            return false;
        }
    }
    
    // 1. Gestion du JID du channel
    const textInput = args.join(' ');
    
    if (textInput && textInput.includes('@newsletter')) {
        const newJid = textInput.trim();
        if (saveChannelJid(newJid)) {
            await socket.sendMessage(sender, { 
                text: `✅ *Channel Config*\n\nNouveau JID enregistré:\n${newJid}` 
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { 
                text: `❌ Échec de l'enregistrement du JID` 
            }, { quoted: msg });
        }
        break;
    }
    
    // 2. Vérifier si un JID existe
    let channelJid = getChannelJid();
    if (!channelJid) {
        await socket.sendMessage(sender, { 
            text: `📢 *Upload Channel*\n\n❌ Aucun JID de channel enregistré.\n\n📌 *Usage:*\n!${command} <jid_channel>\n\n*Exemple:*\n!${command} 120363025@newsletter` 
        }, { quoted: msg });
        break;
    }
    
    // 3. Vérifier le contenu à envoyer
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const contentText = textInput;
    
    if (!quoted && !contentText) {
        await socket.sendMessage(sender, { 
            text: `❌ Envoie un texte ou réponds à un média.` 
        }, { quoted: msg });
        break;
    }
    
    await socket.sendMessage(sender, { 
        react: { text: "📤", key: msg.key } 
    });

    try {
        if (quoted) {
            // Fonction pour télécharger avec la bonne méthode
            async function downloadMedia(mediaMessage) {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                
                let stream;
                if (mediaMessage.imageMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.imageMessage, 'image');
                } else if (mediaMessage.videoMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.videoMessage, 'video');
                } else if (mediaMessage.audioMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.audioMessage, 'audio');
                } else if (mediaMessage.stickerMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.stickerMessage, 'sticker');
                } else if (mediaMessage.documentMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.documentMessage, 'document');
                } else {
                    throw new Error("Type de média non supporté");
                }
                
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                return Buffer.concat(chunks);
            }
            
            // Télécharger le média
            const mediaBuffer = await downloadMedia(quoted);
            
            if (!mediaBuffer || mediaBuffer.length === 0) {
                throw new Error("Échec du téléchargement");
            }
            
            // Déterminer le type et envoyer
            if (quoted.imageMessage) {
                await socket.sendMessage(channelJid, { 
                    image: mediaBuffer, 
                    caption: contentText || "" 
                });
                
            } else if (quoted.videoMessage) {
                await socket.sendMessage(channelJid, { 
                    video: mediaBuffer, 
                    caption: contentText || "" 
                });
                
            } else if (quoted.audioMessage) {
                // Envoyer audio tel quel (pas de conversion)
                await socket.sendMessage(channelJid, { 
                    audio: mediaBuffer,
                    mimetype: quoted.audioMessage.mimetype || 'audio/mp4',
                    ptt: quoted.audioMessage.ptt || false,
                    caption: contentText || ""
                });
                
            } else if (quoted.stickerMessage) {
                await socket.sendMessage(channelJid, { 
                    sticker: mediaBuffer 
                });
                
            } else if (quoted.documentMessage) {
                await socket.sendMessage(channelJid, { 
                    document: mediaBuffer,
                    fileName: quoted.documentMessage.fileName || "Document",
                    mimetype: quoted.documentMessage.mimetype || 'application/octet-stream'
                });
                
            } else {
                await socket.sendMessage(sender, { 
                    text: `❌ Type de média non supporté` 
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: "❓", key: msg.key } });
                break;
            }
            
        } else if (contentText) {
            // Envoyer du texte simple
            await socket.sendMessage(channelJid, { 
                text: contentText 
            });
        }
        
        // Attendre un peu et confirmer
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await socket.sendMessage(sender, { 
            react: { text: "✅", key: msg.key } 
        });
        
        await socket.sendMessage(sender, { 
            text: `✅ *Channel Upload*\n\nContenu publié avec succès sur le channel !` 
        }, { quoted: msg });

    } catch (e) {
        console.error("[UPCH ERROR]:", e);
        await socket.sendMessage(sender, { 
            react: { text: "❌", key: msg.key } 
        });
        
        // Essayer une méthode alternative
        try {
            if (quoted) {
                // Forward simple comme fallback
                await socket.sendMessage(channelJid, {
                    forward: {
                        key: {
                            remoteJid: from,
                            fromMe: false,
                            id: msg.key.id
                        },
                        message: quoted
                    }
                });
                
                await socket.sendMessage(sender, { 
                    react: { text: "↩️", key: msg.key } 
                });
                
                await socket.sendMessage(sender, { 
                    text: `⚠️ Publié via forward (méthode alternative)` 
                }, { quoted: msg });
            }
        } catch (fallbackError) {
            console.error("[UPCH FALLBACK ERROR]:", fallbackError);
            await socket.sendMessage(sender, { 
                text: `❌ Erreur: ${e.message}` 
            }, { quoted: msg });
        }
    }
    break;
}
            // ============ TO URL ============
            // ---------- CASE tourl / tolink (corrigé et robuste) ----------
// ---------- CASE tourl / tolink (version complète, 3 sources, téléchargement robuste) ----------
// ================= CASE TOURL =================
case 'tourl':
case 'tolink': {
  // Vérifier si on a un média cité
  const q = msg.quoted ? msg.quoted : msg;
  const mime = q.mimetype || "";
  if (!mime || !/image|video/.test(mime)) {
    await socket.sendMessage(from, { text: "❌ Veuillez répondre à une image ou une vidéo." }, { quoted: msg });
    break;
  }

  await socket.sendMessage(from, { react: { text: "📥", key: msg.key } });

  try {
    const buffer = await socket.downloadMediaMessage(q);
    if (!buffer) {
      await socket.sendMessage(from, { text: "❌ Impossible de télécharger le média." }, { quoted: msg });
      break;
    }
    if (buffer.length > 20 * 1024 * 1024) {
      await socket.sendMessage(from, { text: "❌ Fichier trop grand ! Max 20 MB." }, { quoted: msg });
      break;
    }

    const { ext } = await fileType.fromBuffer(buffer) || { ext: "bin" };
    const filename = `upload-${Date.now()}.${ext}`;

    // Upload sur plusieurs services
    const results = await Promise.allSettled([
      uploadCloudku(buffer, filename),
      uploadToZen(buffer, filename),
      uploadToTop4Top(buffer, ext),
      uploadTo0x0(buffer, ext)
    ]);

    let text = "";
    if (results[0].status === "fulfilled" && results[0].value?.status === "success") text += `*Cloudku :* ${results[0].value.data.url}\n`;
    if (results[1].status === "fulfilled") text += `*ZenZxz :* ${results[1].value}\n`;
    if (results[2].status === "fulfilled") text += `*Top4Top :* ${results[2].value}\n`;
    if (results[3].status === "fulfilled") text += `*0x0.st :* ${results[3].value}\n`;

    if (!text) {
      await socket.sendMessage(from, { text: "❌ Échec du téléversement sur tous les services." }, { quoted: msg });
      break;
    }

    const caption = `
✦━━━━━━━━━━━━━━━━━━━━✦
📤 *T O U R L* 📤
✦━━━━━━━━━━━━━━━━━━━━✦

📁 *Type:* ${mime}
📦 *Size:* ${formatBytes(buffer.length)}

${text}

✦━━━━━━━━━━━━━━━━━━━━✦
✨ Mugiwara no plag – LUFFY‑XMD ✦
`;

    await socket.sendMessage(from, {
      text: caption,
      contextInfo: {
        externalAdReply: {
          title: "📤 Tourl Generator",
          body: "Convertir vos fichiers en lien direct",
          thumbnailUrl: "https://uploader.zenzxz.dpdns.org/uploads/1763300804728.jpeg",
          sourceUrl: results[0]?.value?.data?.url || results[1]?.value || results[2]?.value || results[3]?.value,
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: "✅", key: msg.key } });

  } catch (e) {
    console.error("[TOURL ERROR]:", e);
    await socket.sendMessage(from, { react: { text: "❌", key: msg.key } });
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message}` }, { quoted: msg });
  }
  break;
}
            
            // ============ FORWARD/RETURN VOICE ============
case 'rvo':
case 'readviewonce':
case 'vv': {
  try {
    // Récupération du message cité (même logique que tovn)
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = quotedCtx?.quotedMessage;
    if (!quoted) {
      await socket.sendMessage(sender, {
        text: '❗ Réponds à un message view-once (image/vidéo/sticker) avec la commande .readviewonce'
      }, { quoted: msg });
      break;
    }

    // Les aliases de réaction et les différents clients WhatsApp peuvent ajouter
    // plusieurs enveloppes autour du média (ephemeral, V2/V2Extension, document).
    const extracted = extractViewOnceMedia(quoted);
    if (!extracted || !extracted.isViewOnce) {
      await socket.sendMessage(sender, {
        text: '❌ Le message cité ne contient pas de média view-once supporté.'
      }, { quoted: msg });
      break;
    }

    const { field: qType, content } = extracted;
    const messageType = qType.replace(/Message$/i, '').toLowerCase(); // 'image', 'video', 'sticker', 'document', 'audio'

    // Télécharger le flux via downloadContentFromMessage
    // downloadContentFromMessage attend l'objet message node (ex: content) et le type 'image'|'video'...
    const stream = await downloadContentFromMessage(content, messageType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vide après téléchargement');
    }

    // Indiquer qu'on traite la requête
    try { await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } }); } catch(e){}

    // Préparer options communes
    const mimetype = content.mimetype || (qType === 'videoMessage' ? 'video/mp4' : (qType === 'imageMessage' ? 'image/jpeg' : undefined));
    const fileName = content.fileName || (qType === 'videoMessage' ? 'video.mp4' : (qType === 'documentMessage' ? 'file' : undefined));

    // Envoyer selon le type
    if (qType === 'imageMessage') {
      await socket.sendMessage(sender, {
        image: buffer,
        caption: '📷 ViewOnce déballé',
        mimetype
      }, { quoted: msg });
    } else if (qType === 'videoMessage') {
      // Certains clients iOS envoient des vidéos avec gifPlayback true ; on renvoie en vidéo standard
      await socket.sendMessage(sender, {
        video: buffer,
        caption: '🎥 ViewOnce déballé',
        mimetype: mimetype || 'video/mp4',
        fileName: fileName || 'video.mp4'
      }, { quoted: msg });
    } else if (qType === 'stickerMessage') {
      // Sticker : s'assurer que c'est bien un webp ; Baileys accepte Buffer
      await socket.sendMessage(sender, {
        sticker: buffer,
        mimetype: content.mimetype || 'image/webp'
      }, { quoted: msg });
    } else if (qType === 'documentMessage') {
      await socket.sendMessage(sender, {
        document: buffer,
        mimetype: content.mimetype || 'application/octet-stream',
        fileName: fileName || 'file',
        caption: '📎 ViewOnce déballé'
      }, { quoted: msg });
    } else if (qType === 'audioMessage') {
      await socket.sendMessage(sender, {
        audio: buffer,
        mimetype: content.mimetype || 'audio/mpeg',
        ptt: false
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, {
        text: '❌ Type de média non supporté pour le déballage.'
      }, { quoted: msg });
    }

    // réaction finale
    try { await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch(e){}

  } catch (err) {
    console.error('[READVIEWONCE ERROR]', err);
    try { await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, {
      text: `❌ Impossible de déballer le view-once : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}
            // ============ COMMANDE INCONNUE ============

// --- utilitaire minimal pour settings de groupe (si besoin) ---


// --- HANDLERS : add, kick, mute, unmute ---
// Variables attendues dans le scope : socket, from (chatId), sender, msg, args

case 'add': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }
  try {
    const { metadata } = await getGroupAdminsInfo(socket, from);
    const actor = nowsender || msg.key?.participant || msg.key?.remoteJid;
    if (!isGroupAdmin(metadata, [actor, msg.key?.participantAlt])) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: msg });
      break;
    }
    if (!isBotGroupAdmin(metadata, socket)) {
      await socket.sendMessage(from, { text: '❌ Je dois être admin pour ajouter des membres.' }, { quoted: msg });
      break;
    }

    const number = args[0];
    if (!number) return await socket.sendMessage(from, { text: 'Usage: .add <numéro sans + ou @>' }, { quoted: msg });

    const jidToAdd = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    try {
      await socket.groupParticipantsUpdate(from, [jidToAdd], 'add');
      await socket.sendMessage(from, { text: `✅ Ajouté: ${jidToAdd}` }, { quoted: msg });
    } catch (e) {
      console.error('[ERROR add]', e);
      await socket.sendMessage(from, { text: '❌ Impossible d\'ajouter ce numéro. Vérifie le format ou les permissions.' }, { quoted: msg });
    }
  } catch (e) {
    console.error('[ERROR add outer]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de l'ajout.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}



// ============ FIN DES COMMANDES DE GROUPE ============
          

          


case 'firstadmin': {
  try {
    // L'ancien mot de passe statique a été supprimé. Seul un propriétaire
    // reconnu peut initialiser le premier admin.
    if (!(isOwner || isSessionOwner)) {
      await socket.sendMessage(sender, {
        text: '❌ Seul le propriétaire du bot ou de la session peut initialiser un administrateur.'
      }, { quoted: msg });
      break;
    }

    const firstAdminArgs = body.trim().split(/\s+/);
    if (firstAdminArgs.length < 3) {
      await socket.sendMessage(sender, {
        text: `🔐 *INITIALISATION ADMIN* 🔐\n\n❌ Format : ${prefix}firstadmin <numéro> <nom>\n💡 Exemple : ${prefix}firstadmin 50912345678 Super Admin`
      }, { quoted: msg });
      break;
    }

    const numero = firstAdminArgs[1];
    const nom = firstAdminArgs.slice(2).join(' ');

    // Vérifier si des admins existent déjà
    const existingAdmins = await loadAdminsFromMongo();
    if (existingAdmins.length > 0) {
      await socket.sendMessage(sender, {
        text: `⚠️ Des administrateurs existent déjà.\nUtilisez ${prefix}addadmin pour en ajouter d'autres.`
      }, { quoted: msg });
      break;
    }

    const numeroNettoye = numero.replace(/[^0-9]/g, '');
    const jid = await addAdminToMongo(numeroNettoye);
    await adminsCol.updateOne(
      { jid },
      {
        $set: {
          name: nom,
          addedAt: new Date(),
          addedBy: nowsender,
          isSuperAdmin: true
        }
      }
    );
    
    console.log(`🎉 Premier admin initialisé : ${nom} (${jid})`);
    
    await socket.sendMessage(sender, { 
      text: `🎊 **ADMIN INITIALISÉ AVEC SUCCÈS** 🎊

✅ Premier administrateur créé !

👑 Nom : ${nom}
📱 Numéro : ${numeroNettoye}
🔗 JID : ${jid}
🔐 Niveau : Super Admin
📅 Date : ${getHaitiTimestamp()}

━━━━━━━━━━━━━━━━━━

⚠️ **Actions requises :**
1. Utilisez !listadmin pour vérifier
2. Utilisez !addadmin pour ajouter d'autres admins
3. Modifiez le mot de passe d'initialisation dans le code

━━━━━━━━━━━━━━━━━━

🎯 Vous avez maintenant accès à toutes les commandes admin :
• !addadmin - Ajouter un admin
• !listadmin - Lister les admins
• !breact - Commander tous les bots
• Et toutes les autres commandes protégées`
    }, { quoted: msg });
    
  } catch (error) {
    console.error('❌ Erreur firstadmin:', error);
    await socket.sendMessage(sender, { 
      text: `❌ Erreur : ${error.message}` 
    }, { quoted: msg });
  }
  break;
}


case 'breact': {
  try {
    if (!isPrivileged) {
      await socket.sendMessage(sender, {
        text: "❌ Accès refusé. Cette commande est réservée aux administrateurs."
      }, { quoted: msg });
      break;
    }

    const q = body.split(' ').slice(1).join(' ').trim();
    if (!q.includes(',')) {
      await socket.sendMessage(sender, {
        text: "❌ Format : !breact <channelJid/messageId>,<emoji>\nExemple : !breact 0029Vb761O39mrGTZvQ8UQ02/175,👍"
      }, { quoted: msg });
      break;
    }

    const [rawReference, ...emojiParts] = q.split(',');
    const reference = parseNewsletterMessageReference(rawReference.trim());
    const reactEmoji = emojiParts.join(',').trim();
    const channelJid = reference?.jid || '';
    const messageId = reference?.serverId || '';
    if (!channelJid || !messageId || !reactEmoji) {
      await socket.sendMessage(sender, {
        text: "❌ Format invalide. Utilise !breact 0029Vb761O39mrGTZvQ8UQ02/175,👍 ou un lien whatsapp.com/channel/<id>/<server_id>."
      }, { quoted: msg });
      break;
    }

    // Réagir avec les sockets déjà actifs; la session qui reçoit la commande
    // est ajoutée si elle n'est pas encore inscrite dans la Map. Aucun fetch
    // Mongo ni abonnement newsletter n'est requis avant le premier envoi.
    const sessions = [...activeSockets.entries()]
      .filter(([, botSocket]) => botSocket)
      .map(([session, botSocket]) => ({ session, socket: botSocket }));
    if (!sessions.some(entry => entry.socket === socket)) {
      sessions.push({ session: number || socket.user?.id || 'session-courante', socket });
    }

    if (!sessions.length) {
      await socket.sendMessage(sender, { text: "❌ Aucun bot actuellement connecté." }, { quoted: msg });
      break;
    }

    const reactionRun = reactAcrossNewsletterSockets(
      sessions,
      channelJid,
      messageId,
      reactEmoji,
      async session => {
        const sessionNumber = String(session || '').split(':')[0].replace(/\D/g, '');
        if (sessionNumber) await saveNewsletterReaction(channelJid, messageId, reactEmoji, sessionNumber);
      }
    ).then(async results => {
      const succeeded = results.filter(result => result.ok).length;
      const failed = results.filter(result => !result.ok).length;
      const persistenceWarnings = results.filter(result => result.ok && result.persistenceError);
      let report = `📊 RAPPORT B.REACT\n\n✅ Réactions envoyées : ${succeeded}\n❌ Échecs : ${failed}\n🤖 Sessions essayées : ${results.length}\n\n📢 Canal : ${channelJid.split('@')[0]}\n📝 Publication : ${messageId}\n😊 Emoji : ${reactEmoji}`;
      const failedSessions = results.filter(result => !result.ok);
      if (failedSessions.length) {
        report += `\n\nÉchecs :\n${failedSessions.slice(0, 10).map(item => `• ${item.session} : ${item.error}`).join('\n')}`;
      }
      if (persistenceWarnings.length) {
        report += `\n⚠️ ${persistenceWarnings.length} réaction(s) envoyée(s), mais non enregistrée(s) dans MongoDB.`;
      }
      await socket.sendMessage(sender, { text: report });
    }).catch(async error => {
      console.error('[BREACT REPORT ERROR]', error);
      await socket.sendMessage(sender, { text: `⚠️ Les réactions ont commencé, mais le rapport a échoué : ${error?.message || error}` }).catch(() => {});
    });

    // Lancer en arrière-plan sans attendre le nombre de bots ni un délai de follow.
    void reactionRun;
    await socket.sendMessage(sender, {
      text: `🚀 Réaction lancée immédiatement.\n📢 Canal : ${channelJid.split('@')[0]}\n📝 Publication : ${messageId}\n😊 Emoji : ${reactEmoji}\n🤖 Sessions actives : ${sessions.length}\n\nAucun abonnement préalable n'est nécessaire.`
    }, { quoted: msg });
  } catch (error) {
    console.error('❌ Erreur commande breact:', error);
    try {
      await socket.sendMessage(sender, { text: `❌ Erreur interne : ${error.message || error}` }, { quoted: msg });
    } catch (_) {}
  }
  break;
}


case 'getpp': {
    try {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || BOT_NAME_FANCY;
        const logo = cfg.logo || config.RCD_IMAGE_PATH;

        const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❌ Veuillez saisir un numéro.\n\nUtilisation : .getpp <numéro>" });

        // 🔹 Format number into JID
        let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

        // 🔹 Try to get profile picture
        let ppUrl;
        try {
            ppUrl = await socket.profilePictureUrl(jid, "image");
        } catch {
            ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default dp
        }

        // 🔹 BotName meta mention
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETDP" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
        };

        // 🔹 Send DP with botName meta mention
        await socket.sendMessage(sender, { 
    image: { url: ppUrl }, 
    caption: `🖼 *Photo de profil de* +${q}\nRécupérée par : KAIDO-MD`,
    footer: `📌 KAIDO-MD PHOTO DE PROFIL`,
    headerType: 4
}, { quoted: metaQuote });
    } catch (e) {
        console.log("❌ getdp error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile picture." });
    }
    break;
}

                
case 'code': {
  // `from` is the remote chat JID (group or private), so the API result is
  // returned to the exact conversation in which `.code` was issued.
  const codeChat = from || msg.key?.remoteJid;
  const q = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || '';
  
  const args = q.trim().split(/\s+/);
  args.shift(); // enlever la commande
  const requestedNumber = args.join(' ').trim();
  const pairingTarget = await resolvePairingNumber({
    explicitNumber: requestedNumber,
    msg,
    from,
    senderJid: nowsender,
    socket
  });
  const cleanNumber = pairingTarget.number;

  if (!cleanNumber) {
    const details = pairingTarget.error || 'Indique un numéro de téléphone valide.';
    return await socket.sendMessage(codeChat, {
      text: `*📌 𝗖𝗢𝗗𝗘 𝗗𝗘 𝗖𝗢𝗡𝗡𝗘𝗫𝗜𝗢𝗡 𝗞𝗔𝗜𝗗𝗢*\n\n` +
            `${details}\n\n` +
            `*Usage:* .code [numéro]\n` +
            `Réponds à un message de la personne, ou utilise .code sans numéro pour ton propre compte.\n` +
            `*Exemple:* .code 50947441234 (sans +)`
    }, { quoted: msg });
  }

  if (cleanNumber.length < 9 || cleanNumber.length > 15) {
    return await socket.sendMessage(codeChat, {
      text: `*❌ 𝙵𝚘𝚛𝚖𝚊𝚝 𝚒𝚗𝚌𝚘𝚛𝚛𝚎𝚌𝚝  *\n\n` +
            `ʟᴇ Nᴜᴍᴇʀᴏ ᴅᴏɪᴛ ᴄᴏɴᴛᴇɴɪʀ ᴇɴᴛʀᴇ 9 ᴇᴛ 15 ᴄʜɪғғʀᴇs.\n` +
            `ᗴ᙭ᗴᗰᑭᒪᗴ: 50947441234`
    }, { quoted: msg });
  }

  let localFallbackAttempted = false;
  let pairingApiNetworkFailure = false;
  try {
    await socket.sendMessage(codeChat, { react: { text: "⏳", key: msg.key } });

    // Chaque invocation demande un code frais. On tente d'abord l'hôte public
    // configuré, puis localhost:PORT si l'adresse publique ne répond pas depuis
    // le processus lui-même (cas fréquent avec une IP sans hairpin NAT).
    const pairingUrls = createPairingCodeUrlCandidates(
      cleanNumber,
      process.env,
      undefined,
      { forceFresh: true }
    );
    let pairingResponse;
    try {
      pairingResponse = await fetchPairingCodeWithFallback(
        pairingUrls,
        fetch,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (WhatsAppBot)',
            'Accept': 'application/json'
          },
          timeout: PAIRING_CODE_HTTP_TIMEOUT_MS
        },
        () => {
          localFallbackAttempted = true;
          console.warn('[CODE] Hôte pairing inaccessible; nouvel essai sur localhost et le PORT courant.');
        }
      );
    } catch (error) {
      pairingApiNetworkFailure = isPairingNetworkError(error);
      throw error;
    }
    localFallbackAttempted = localFallbackAttempted || pairingResponse.usedFallback;
    const response = pairingResponse.response;

    const bodyText = await response.text();
    let result;
    try {
      result = JSON.parse(bodyText);
    } catch {
      const codeMatch = bodyText.match(/"code"\s*:\s*"([^"]+)"/) || bodyText.match(/'code'\s*:\s*'([^']+)'/);
      if (codeMatch) result = { code: codeMatch[1] };
      else if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      else throw new Error("Réponse invalide du serveur");
    }

    if (!response.ok) {
      throw new Error(result?.message || result?.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    if (!result || !result.code) {
      throw new Error(result?.message || result?.error || "Aucun code reçu du serveur");
    }

    const code = result.code.trim();

    // Texte simple pour rester compatible avec tous les clients WhatsApp.
    // Le payload interactif instable n'est pas nécessaire pour copier le code.
    await socket.sendMessage(codeChat, {
      text: `*✅ CODE DE CONNEXION TROUVÉ*\n\n` +
            `*📱 Numéro:* ${cleanNumber}\n` +
            `*🔑 Code:* \`${code}\`\n\n` +
            `*📋 INSTRUCTIONS:*\n` +
            `1. Ouvre WhatsApp → Paramètres → Appareils liés\n` +
            `2. Connecter un appareil → Lier avec un code\n` +
            `3. Saisis le code ci-dessus\n\n` +
            `⚠️ Le code expire dans 20 secondes`
    }, { quoted: msg, __kaidoSkipLocalFormatting: true });

    await socket.sendMessage(codeChat, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    const errorText = String(err?.message || err);
    const isTimeout = pairingApiNetworkFailure && (
      err?.type === 'request-timeout'
      || err?.code === 'ETIMEDOUT'
      || err?.code === 'ESOCKETTIMEDOUT'
      || /network timeout|timed? ?out|timeout/i.test(errorText)
    );
    const isNetworkFailure = pairingApiNetworkFailure;
    console.error("❌ Erreur commande code:", errorText);
    await socket.sendMessage(codeChat, { react: { text: "❌", key: msg.key } });
    const userMessage = isNetworkFailure
      ? isTimeout
        ? `❌ Délai dépassé en attendant le serveur de pairing. Une demande de code frais (force=1) a été tentée${localFallbackAttempted ? ' via l’hôte configuré puis localhost' : ''}. Vérifie l’hôte et le PORT, puis réessaie si aucun code n’est arrivé.`
        : `❌ Le serveur de pairing est inaccessible${localFallbackAttempted ? ' via l’hôte configuré et localhost' : ''}. Vérifie l’hôte et le PORT.${errorText ? ` (${errorText})` : ''}`
      : `❌ Erreur: ${errorText}`;
    await socket.sendMessage(codeChat, { text: userMessage }, { quoted: msg });
  }
  break;
}
  
case 'deleteme': {
  // 'number' is the session number passed to setupCommandHandlers (sanitized in caller)
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  // determine who sent the command
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = primaryOwnerNumber();

  // Permission: only the session owner or the bot OWNER can delete this session
  if (!(isOwner || isSessionOwner)) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or the bot owner can delete this session.' }, { quoted: msg });
    break;
  }

  try {
    // On prévient l'utilisateur AVANT le démontage : une fois le socket déconnecté
    // (logout), plus aucune confirmation ne peut partir.
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION DELETED', '✅ Your session has been successfully deleted from MongoDB.', BOT_NAME_FANCY)
    }, { quoted: msg });

    // Démontage complet : runtime, socket, dossier persistant, creds + clés Mongo.
    await deleteSessionAndCleanup(sanitized, socket, { notifyOwner: false });

    console.log(`Session ${sanitized} deleted by ${senderNum}`);
  } catch (err) {
    console.error('deleteme command error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
case 'deletemenumber': {
  // args is available in the handler (body split). Expect args[0] = target number
  const targetRaw = (args && args[0]) ? args[0].trim() : '';
  if (!targetRaw) {
    await socket.sendMessage(sender, { text: '❗ Usage: .deletemenumber <number>\nExample: .deletemenumber 9478#######' }, { quoted: msg });
    break;
  }

  const target = targetRaw.replace(/[^0-9]/g, '');
  // Corrigé : l'ancien motif était écrit /^\\d{6,}$/ (double antislash), donc il
  // n'acceptait jamais un numéro — .deletemenumber renvoyait toujours « Invalid
  // number provided. ».
  if (!/^\d{6,}$/.test(target)) {
    await socket.sendMessage(sender, { text: '❗ Invalid number provided.' }, { quoted: msg });
    break;
  }

  // Permission check: only OWNER or configured admins can run this
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = primaryOwnerNumber();

  if (!isPrivileged) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only bot owner or admins can delete other sessions.' }, { quoted: msg });
    break;
  }

  try {
    // notify start
    await socket.sendMessage(sender, { text: `🗑️ Deleting session for ${target} — attempting now...` }, { quoted: msg });

    // Démontage complet (socket, dossier persistant, creds + clés MongoDB).
    const runningSocket = activeSockets.get(target) || null;
    await deleteSessionAndCleanup(target, runningSocket, { notifyOwner: false });

    // Confirm to caller & notify owner
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION REMOVED', `✅ Session for number *${target}* has been deleted from MongoDB and runtime.`, BOT_NAME_FANCY)
    }, { quoted: msg });

    // optional: inform owner
    try {
      const ownerJid = `${ownerNum}@s.whatsapp.net`;
      await socket.sendMessage(ownerJid, {
        text: `👑 Notice: Session removed by ${senderNum}\n→ Number: ${target}\n→ Time: ${getHaitiTimestamp()}`
      });
    } catch (e) { /* ignore notification errors */ }

    console.log(`deletemenumber: removed ${target} (requested by ${senderNum})`);
  } catch (err) {
    console.error('deletemenumber error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session for ${target}: ${err.message || err}` }, { quoted: msg });
  }

  break;
}





case 'cfn': {
  const botName = sessionCfg.botName || BOT_NAME_FANCY;

  // Récupérer les arguments après la commande
  const full = args.join(" ").trim();
  if (!full) {
    await socket.sendMessage(sender, { 
      text: `❗ Fournis une entrée : .cfn <jid@newsletter> | emoji1,emoji2\nExemple: .cfn 0029Vb761O39mrGTZvQ8UQ02@newsletter | 🔥,❤️`
    }, { quoted: msg });
    break;
  }

  // Vérifier permissions avec les identités owner/admin Mongo normalisées.
  const senderIdSimple = (senderNumber || '').toString();
  if (!isPrivileged) {
    await socket.sendMessage(sender, { text: '❌ Permission refusée. Seul le propriétaire ou les admins configurés peuvent ajouter des chaînes.' }, { quoted: msg });
    break;
  }

  // Découper JID et emojis
  let jidPart = full;
  let emojisPart = '';
  if (full.includes('|')) {
    const split = full.split('|');
    jidPart = split[0].trim();
    emojisPart = split.slice(1).join('|').trim();
  } else {
    const parts = full.split(/\s+/);
    if (parts.length > 1 && parts[0].includes('@newsletter')) {
      jidPart = parts.shift().trim();
      emojisPart = parts.join(' ').trim();
    } else {
      jidPart = full.trim();
    }
  }

  const jid = normaliseNewsletterJid(jidPart);
  if (!jid) {
    await socket.sendMessage(sender, { text: '❗ JID invalide. Exemple: 120363402094635383@newsletter' }, { quoted: msg });
    break;
  }

  const emojis = normaliseEmojiList(emojisPart);

  try {
    await addNewsletterToMongo(jid, emojis);

    // Suivre d'abord avec la session qui a reçu la commande. Les autres
    // sessions sont synchronisées ensuite, mais une session hors ligne ne doit
    // plus transformer une sauvegarde réussie en faux échec global.
    const currentResults = await syncNewsletterSockets(new Map(), jid, 'follow', [socket]);
    const otherSockets = new Map(
      [...activeSockets.entries()].filter(([, activeSocket]) => activeSocket && activeSocket !== socket)
    );
    const otherResults = await syncNewsletterSockets(otherSockets, jid, 'follow');
    const syncResults = [...currentResults, ...otherResults];

    const emojiText = emojis.length ? emojis.join(' ') : `(défaut : ${DEFAULT_NEWSLETTER_EMOJIS.join(' ')})`;
    const syncedSessions = new Set(syncResults.filter(result => result.ok).map(result => result.session)).size;
    const currentFollowed = currentResults.some(result => result.ok);
    const warning = currentFollowed
      ? ''
      : `\n⚠️ Sauvegarde effectuée, mais le suivi immédiat a échoué : ${currentResults[0]?.error || 'API newsletter indisponible'}`;
    const mention = nowsender ? [nowsender] : [];

    // Une réponse texte standard évite le crash Baileys provoqué par certains
    // anciens payloads image/boutons dont un JID interne était undefined.
    await socket.sendMessage(from, {
      text: `✅ *Chaîne sauvegardée !*\n\n` +
        `JID : ${jid}\n` +
        `Emojis : ${emojiText}\n` +
        `Sessions synchronisées : ${syncedSessions}\n` +
        `Ajouté par : @${senderIdSimple}\n` +
        `Bot : ${botName}${warning}`,
      mentions: mention
    }, { quoted: msg });

  } catch (e) {
    console.error('cfn error', e);
    await socket.sendMessage(from, { text: `❌ Échec de l’ajout/suivi de la chaîne : ${e.message || e}` }, { quoted: msg });
  }
  break;
}
case 'chr': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

  const q = body.split(' ').slice(1).join(' ').trim();
  if (!q.includes(',')) return await socket.sendMessage(sender, { 
    text: "❌ Usage : chr <channelJid/messageId>,<emoji>\nExemple : chr 0029Vb761O39mrGTZvQ8UQ02/175,👍" 
  }, { quoted: msg });

  const parts = q.split(',');
  let channelRef = parts[0].trim();
  const reactEmoji = parts[1].trim();

  const reference = parseNewsletterMessageReference(channelRef);
  const channelJid = reference?.jid || '';
  const messageId = reference?.serverId || '';

  // Validation finale
  if (!channelJid || !messageId || !reactEmoji) {
    return await socket.sendMessage(sender, { 
      text: '❌ Format invalide. Utilisez :\n' +
            '1. `chr 0029Vb761O39mrGTZvQ8UQ02/175,👍`\n' +
            '2. `chr https://whatsapp.com/channel/0029Vb761O39mrGTZvQ8UQ02/175,👍`' 
    }, { quoted: msg });
  }

  try {
    await reactToNewsletterMessage(socket, channelJid, messageId, reactEmoji, {
      ensureFollow: true,
      followDelayMs: 1500
    });
    await saveNewsletterReaction(channelJid, messageId.toString(), reactEmoji, sanitized);

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHR" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload;
    if (String(logo).startsWith('http')) {
      imagePayload = { url: logo };
    } else {
      try {
        imagePayload = fs.readFileSync(logo);
      } catch (e) {
        imagePayload = { url: config.RCD_IMAGE_PATH };
      }
    }

    // Message de confirmation stylisé
    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Réaction envoyée avec succès !

📢 Canal : ${channelJid}
📝 Message ID : ${messageId}
😊 Émoji : ${reactEmoji}
👤 Par : @${senderIdSimple}

━━━━━━━━━━━━━━━━━━

🕒 ${getHaitiTimestamp()}
📍 Fuseau : Haïti`,
      footer: `📌 ${botName} • REACTION`,
      mentions: [nowsender],
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('chr command error', e);
    await socket.sendMessage(sender, { 
      text: `❌ Échec de la réaction : ${e.message || e}\n\nVérifiez que :\n1. Le bot suit ce canal\n2. Le message existe\n3. Le JID et Message ID sont corrects` 
    }, { quoted: msg });
  }
  break;
}

case 't':
case '🌹':
case '😍':
case '❤️': {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted) {
        break; // rien à faire si aucun média cité
    }

    try {
        const userJid = jidNormalizedUser(socket.user.id);
        
        // Forwarder directement le message cité
        await socket.sendMessage(userJid, {
            forward: {
                key: {
                    remoteJid: from,
                    fromMe: false,
                    id: msg.key.id
                },
                message: quoted
            }
        });

    } catch (e) {
        console.error("[SAVE ERROR]:", e);
        // pas de réaction ni de message d'erreur envoyé
    }
    break;
}

case 'save': {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted) {
        await socket.sendMessage(sender, { 
            text: `💾 *Save*\n\n❌ Réponds à un média avec !${command}` 
        }, { quoted: msg });
        break;
    }

    await socket.sendMessage(sender, { 
        react: { text: "⏳", key: msg.key } 
    });

    try {
        const userJid = jidNormalizedUser(socket.user.id);
        
        // Forwarder directement le message cité
        await socket.sendMessage(userJid, {
            forward: {
                key: {
                    remoteJid: from,
                    fromMe: false,
                    id: msg.key.id
                },
                message: quoted
            }
        });

        // Seulement la réaction de succès, pas de message texte
        await socket.sendMessage(sender, { 
            react: { text: "✅", key: msg.key } 
        });

    } catch (e) {
        console.error("[SAVE ERROR]:", e);
        await socket.sendMessage(sender, { 
            react: { text: "❌", key: msg.key } 
        });
        // Optionnel: garder le message d'erreur
        // await socket.sendMessage(sender, { 
        //     text: `❌ Erreur: ${e.message}` 
        // }, { quoted: msg });
    }
    break;
}

// ---------------------- PING ----------------------
case 'ping': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    const startTime = Date.now();
    const msgTime = msg.messageTimestamp ? msg.messageTimestamp * 1000 : startTime;
    const latency = startTime - msgTime;

    // Meta mention (optionnel, garde-le si tu veux le contact Meta)
    const metaQuote = {
      key: { 
        remoteJid: "status@broadcast", 
        participant: "0@s.whatsapp.net", 
        fromMe: false, 
        id: "META_AI_PING" 
      },
      message: { 
        contactMessage: { 
          displayName: botName, 
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
      }
    };

    // Déterminer le statut
    let status = "";
    let statusEmoji = "";
    
    if (latency < 200) {
      status = "Ultra rapide";
      statusEmoji = "⚡";
    } else if (latency < 500) {
      status = "Rapide";
      statusEmoji = "🚀";
    } else if (latency < 1000) {
      status = "Normal";
      statusEmoji = "📶";
    } else {
      status = "Lent";
      statusEmoji = "🐌";
    }

    // Texte simple et efficace
    const text = `✅ *${botName} EST ACTIF !*

${statusEmoji} *Statut :* ${status}
⏱️ *Latence :* ${latency}ms
🕒 *Heure :* ${getHaitiTimestamp()}
📍 *Fuseau :* Haïti

*Le bot répond parfaitement et est opérationnel.*`;

    // Envoyer juste le texte avec la meta mention
    await socket.sendMessage(sender, {
      text: text
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('❌ Erreur ping:', e);
    await socket.sendMessage(sender, { 
      text: '❌ Impossible de mesurer la latence.' 
    }, { quoted: msg });
  }
  break;
}

            case 'bibleai':
            case 'bible':
            case 'verset': {
                if (!args[0]) {
                    await socket.sendMessage(sender, { 
                        text: `Usage: !${command} [ta question]\nExemple: !${command} Qui est Jésus ?` 
                    }, { quoted: msg });
                    break;
                }

                const question = args.join(' ');
                await socket.sendMessage(sender, { 
                    text: "_🔍 Recherche dans les écritures..._" 
                }, { quoted: msg });

                try {
                    const params = new URLSearchParams({
                        question: question,
                        translation: 'LSG',
                        language: 'fr',
                        'filters[]': ['bible', 'books', 'articles'],
                        pro: 'false'
                    });

                    const url = `https://api.bibleai.com/v2/search?${params.toString()}`;
                    const fetch = require('node-fetch');
                    const res = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0',
                            'Accept': 'application/json',
                            'Origin': 'https://bibleai.com',
                            'Referer': 'https://bibleai.com/'
                        }
                    });

                    const json = await res.json();

                    if (json.status !== 1 || !json.data) {
                        await socket.sendMessage(sender, { 
                            text: 'Désolé, je n\'ai trouvé aucun résultat.' 
                        }, { quoted: msg });
                        break;
                    }

                    const { answer, sources } = json.data;
                    let responseText = `📖 *BIBLE AI RESPONSE*\n\n${answer}\n\n`;

                    if (Array.isArray(sources) && sources.length > 0) {
                        responseText += `📑 *SOURCES & VERSETS :*\n`;
                        const verses = sources.filter(s => s.type === 'verse').slice(0, 8);

                        verses.forEach((s, i) => {
                            let reference = s.title || s.metadata?.ref || `Source [${i + 1}]`;
                            let content = s.text.trim();

                            if (s.book && s.chapter) {
                                reference = `${s.book} ${s.chapter}:${s.verse || ''}`;
                            }

                            responseText += `\n${i + 1}. *${reference}*\n${content}\n`;
                        });
                    }

                    await socket.sendMessage(sender, { text: responseText }, { quoted: msg });

                } catch (e) {
                    console.error(e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur : ${e.message}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ CRÉATION DE GROUPE ============
            case 'creategroup':
            case 'cgroup': {
                const groupName = args.join(' ').replace(/@\d+/g, '').trim();
                if (!groupName) {
                    await socket.sendMessage(sender, {
                        text: `Usage : ${prefix}${command} <nom du groupe> [@membre]\n\nLa commande doit inclure un membre à ajouter si elle est envoyée depuis le compte du bot.`
                    }, { quoted: msg });
                    break;
                }
                if (Array.from(groupName).length > 25) {
                    await socket.sendMessage(sender, { text: '❌ Le nom du groupe doit contenir au maximum 25 caractères.' }, { quoted: msg });
                    break;
                }

                const groupParticipant = resolveGroupCreationParticipant(msg, socket);
                if (!groupParticipant) {
                    await socket.sendMessage(sender, {
                        text: '❌ Je n’ai pas pu identifier un membre valide à ajouter. Utilise .cgroup <nom> depuis ton compte, ou mentionne un membre si tu envoies la commande depuis le compte du bot.'
                    }, { quoted: msg });
                    break;
                }

                await socket.sendMessage(sender, { text: '⏳ Création du groupe en cours…' }, { quoted: msg });
                try {
                    const group = await socket.groupCreate(groupName, [groupParticipant]);
                    if (!group?.id) throw new Error('WhatsApp n’a pas renvoyé l’identifiant du nouveau groupe.');

                    let response = `✅ Groupe *${groupName}* créé avec succès !`;
                    try {
                        await socket.groupParticipantsUpdate(group.id, [groupParticipant], 'promote');
                        response += `\n\n👑 @${groupParticipant.split('@')[0]} a été promu administrateur.`;
                    } catch (error) {
                        console.warn('[CGROUP] Promotion du participant impossible :', error?.message || error);
                        response += '\n\n⚠️ Le groupe est créé, mais la promotion automatique a échoué.';
                    }
                    try {
                        const code = await socket.groupInviteCode(group.id);
                        response += `\n\n🔗 Lien d’invitation : https://chat.whatsapp.com/${code}`;
                    } catch (error) {
                        console.warn('[CGROUP] Récupération du lien impossible :', error?.message || error);
                        response += '\n\n⚠️ Le groupe est créé, mais WhatsApp n’a pas fourni le lien d’invitation.';
                    }

                    const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (quotedMessage?.imageMessage && typeof socket.updateProfilePicture === 'function') {
                        try {
                            const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
                            const chunks = [];
                            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
                            await socket.updateProfilePicture(group.id, Buffer.concat(chunks));
                            response += '\n\n🖼️ Photo du groupe mise à jour.';
                        } catch (error) {
                            console.warn('[CGROUP] Photo du groupe non modifiée :', error?.message || error);
                        }
                    }
                    await socket.sendMessage(sender, {
                        text: response,
                        mentions: [groupParticipant]
                    }, { quoted: msg });
                } catch (error) {
                    console.error('[CGROUP] Création impossible :', error?.message || error);
                    const detail = error?.output?.payload?.message || error?.message || 'erreur inconnue';
                    await socket.sendMessage(sender, {
                        text: `❌ Erreur lors de la création du groupe : ${detail}`
                    }, { quoted: msg });
                }
                break;
            }

            // ============ KICK ALL ============
            case 'kickall': {
                if (!from.endsWith('@g.us')) {
                    await socket.sendMessage(sender, { 
                        text: "❗ Cette commande doit être utilisée dans un groupe." 
                    }, { quoted: msg });
                    break;
                }

                try {
                    const { metadata, participants } = await getGroupAdminsInfo(socket, from);
                    const actor = nowsender || msg.key?.participant || msg.key?.remoteJid;
                    if (!isGroupAdmin(metadata, [actor, msg.key?.participantAlt])) {
                        await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser kickall.' }, { quoted: msg });
                        break;
                    }
                    if (!isBotGroupAdmin(metadata, socket)) {
                        await socket.sendMessage(from, { text: '❌ Le bot doit être administrateur pour kickall.' }, { quoted: msg });
                        break;
                    }
                    const groupName = metadata?.subject || "Sans nom";

                    // Membres à expulser (non-admins et pas le bot), résolus par leur JID réel.
                    const toKick = participants
                        .filter(participant => !isGroupAdmin(metadata, participant) && !isBotIdentity(socket, participant))
                        .map(participant => ({
                            ...participant,
                            id: getParticipantId(participant),
                            mentionJid: getParticipantMentionJid(participant)
                        }))
                        .filter(participant => participant.id);

                    if (!toKick.length) {
                        await socket.sendMessage(from, { 
                            text: "❌ Aucun membre à expulser (seulement des admins ou le bot)." 
                        }, { quoted: msg });
                        break;
                    }

                    // Liste numérotée
                    let kickLines = "";
                    toKick.forEach((mem, i) => {
                        const num = (mem.mentionJid || mem.id).split('@')[0];
                        kickLines += `☠️ ${(i + 1).toString().padStart(2, '0')}. @${num}\n`;
                    });

                    // Message pirate stylé
                    const caption = `✦━━━━━━━━━━━━━━━━━━━━✦
🏴‍☠️ *KAIDO-MD KICKALL* 🏴‍☠️
✦━━━━━━━━━━━━━━━━━━━━✦

📌 GROUPE : ${groupName}
⚓ Ordre donné par : @${actor.split('@')[0]}

💬 Vous tous avez étés jugés indigne de persister dans ce groupe🚶. Le roi des bêtes à scellé votre destin 🐉!
👥 Membres expulsés : ${toKick.length}

${kickLines}
✦━━━━━━━━━━━━━━━━━━━━✦
🔥 KAIDO-MD`;

                    // Annonce avant expulsion
                    await socket.sendMessage(from, {
                        text: caption,
                        mentions: [actor, ...toKick.map(p => p.mentionJid || p.id)]
                    }, { quoted: msg });

                    // Expulsion en un seul coup
                    await socket.groupParticipantsUpdate(from, toKick.map(p => p.id), "remove");

                    await socket.sendMessage(from, { 
                        text: "✅ Tous ces indignes seront supprimés d'un coup" 
                    }, { quoted: msg });

                } catch (e) {
                    console.error("[ERROR kickall]", e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur lors du kickall.\n\n${e.message || e}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ LISTE ADMINS ============
            case 'listadmin': {
                if (!from.endsWith('@g.us')) {
                    await socket.sendMessage(sender, { 
                        text: "❗ Cette commande doit être utilisée dans un groupe." 
                    }, { quoted: msg });
                    break;
                }

                try {
                    const metadata = await socket.groupMetadata(from);
                    const groupAdmins = getGroupAdminJids(metadata);

                    if (!groupAdmins.length) {
                        await socket.sendMessage(from, { 
                            text: "❌ Aucun admin détecté dans ce groupe." 
                        }, { quoted: msg });
                        break;
                    }

                    let caption = `👥 *LISTE DES ADMINS DU GROUPE*\n\n`;
                    groupAdmins.forEach((admin, i) => {
                        caption += `${(i + 1).toString().padStart(2, '0')}. @${admin.split('@')[0]}\n`;
                    });

                    await socket.sendMessage(from, {
                        text: caption,
                        mentions: groupAdmins
                    }, { quoted: msg });

                } catch (e) {
                    console.error("[ERROR listadmin]", e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur lors de la récupération des admins.\n\n${e.message || e}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ PLAY YOUTUBE ============
            // ============================================================
// YOUTUBE PLAY / MP3 / MP4
// ============================================================
case 'play':
case 'playaudio':
case 'playvideo':
case 'playptt': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text:
          `╭━━━━━━━━━━━━━━━━━━╮\n` +
          `┃  🎵 *KAIDO YOUTUBE*\n` +
          `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
          `❌ Aucun titre ou lien fourni !\n\n` +
          `📌 Exemple :\n` +
          `${prefix}play alan walker faded\n` +
          `${prefix}playvideo https://youtu.be/xxxxx\n\n` +
          `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ');

    await socket.sendMessage(from, {
      react: { text: '⏳', key: msg.key }
    });

    let url = query;
    let title = 'YouTube Media';
    let thumbnail = 'https://i.ytimg.com/vi_webp/default.webp';

    // Recherche YouTube si ce n'est pas un lien
    if (!query.startsWith('http')) {
      const search = await yts(query);

      if (!search.videos.length) {
        throw new Error('Aucun résultat trouvé.');
      }

      url = search.videos[0].url;
      title = search.videos[0].title;
      thumbnail = search.videos[0].thumbnail;
    }

    // PLAY = menu boutons
    if (command === 'play') {
      const buttons = [
        {
          buttonId: `${prefix}playaudio ${url}`,
          buttonText: { displayText: '🎵 AUDIO' },
          type: 1
        },
        {
          buttonId: `${prefix}playvideo ${url}`,
          buttonText: { displayText: '🎬 VIDEO' },
          type: 1
        },
        {
          buttonId: `${prefix}playptt ${url}`,
          buttonText: { displayText: '🎤 PTT' },
          type: 1
        }
      ];

      await socket.sendMessage(sender, {
        image: { url: thumbnail },
        caption:
          `╭━━━━━━━━━━━━━━━━━━╮\n` +
          `┃  🎵 *KAIDO YOUTUBE*\n` +
          `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
          `📌 ${title}\n\n` +
          `Choisis un format ci-dessous :`,
        footer: config.BOT_FOOTER,
        buttons,
        headerType: 4
      }, { quoted: msg });

      break;
    }

    // AUDIO / PTT
    if (command === 'playaudio' || command === 'playptt') {
      const data = await ytmp3(url);

      await socket.sendMessage(sender, {
        audio: { url: data.downloadUrl },
        mimetype: 'audio/mpeg',
        ptt: command === 'playptt',
        contextInfo: {
          externalAdReply: {
            title: data.title || title,
            body: 'KAIDO YTMP3',
            thumbnailUrl: data.thumbnail || thumbnail,
            mediaType: 1,
            sourceUrl: url,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: msg });

      await socket.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      });

      break;
    }

    // VIDEO
    if (command === 'playvideo') {
      const data = await ytmp4(url, '720');

      await socket.sendMessage(sender, {
        video: { url: data.downloadUrl },
        caption:
          `🎬 *${data.title || title}*\n\n` +
          `📺 Qualité : 720p\n` +
          `> ${config.BOT_FOOTER}`,
        mimetype: 'video/mp4'
      }, { quoted: msg });

      await socket.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      });

      break;
    }

  } catch (e) {
    console.error('[YOUTUBE ERROR]', e);

    await socket.sendMessage(from, {
      react: { text: '❌', key: msg.key }
    });

    await socket.sendMessage(sender, {
      text:
        `╭━━━━━━━━━━━━━━━━━━╮\n` +
        `┃  ❌ *YOUTUBE ERROR*\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
        `${e.message || e}\n\n` +
        `💡 Réessaie avec un autre lien.`
    }, { quoted: msg });
  }
  break;
}
            // ============ COMMANDE INCONNUE ============
// === COMMANDE UPSCALE (amélioration d'image) ===
// === COMMANDE UPSCALE (amélioration d'image) ===
case 'upscale': {
  try {
    // Définir les variables nécessaires
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    // Fonction aienhancer intégrée avec améliorations
    async function aienhancer(image, {
      model = 3,
      settings = 'kRpBbpnRCD2nL2RxnnuoMo7MBc0zHndTDkWMl9aW+Gw='
    } = {}) {
      if (!image) throw new Error('image is required');
      
      let base64;
      if (/^https?:\/\//.test(image)) {
        const img = await axios.get(image, { 
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        base64 = Buffer.from(img.data).toString('base64');
      } else {
        // Lire le fichier et vérifier qu'il n'est pas corrompu
        const fileBuffer = fs.readFileSync(image);
        if (fileBuffer.length < 100) {
          throw new Error('Fichier image trop petit ou corrompu');
        }
        base64 = fileBuffer.toString('base64');
      }

      // S'assurer que l'image est au bon format (PNG recommandé)
      const imageData = `data:image/png;base64,${base64}`;

      const headers = {
        'authority': 'aienhancer.ai',
        'accept': '*/*',
        'accept-language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6',
        'content-type': 'application/json',
        'origin': 'https://aienhancer.ai',
        'referer': 'https://aienhancer.ai/hd-picture-converter',
        'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
      };

      // Créer la tâche avec timeout
      const create = await axios.post('https://aienhancer.ai/api/v1/r/image-enhance/create',
        {
          model,
          image: imageData,
          settings
        },
        { 
          headers,
          timeout: 30000
        }
      );

      if (!create.data?.data?.id) {
        console.error('[AIENHANCER] Create response:', create.data);
        throw new Error('Réponse invalide du serveur');
      }

      const taskId = create.data.data.id;

      // Attendre le résultat avec un timeout global
      const maxAttempts = 30; // 30 * 2s = 60 secondes max
      let attempts = 0;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;

        const result = await axios.post('https://aienhancer.ai/api/v1/r/image-enhance/result',
          { task_id: taskId },
          { 
            headers,
            timeout: 30000
          }
        );

        const status = result.data?.data?.status;

        if (status === 'succeeded') {
          return {
            id: result.data.data.id,
            input: result.data.data.input,
            output: result.data.data.output,
            completed_at: result.data.data.completed_at
          };
        }

        if (status === 'failed') {
          throw new Error('Échec de l\'amélioration');
        }
      }

      throw new Error('Timeout: Le traitement a pris trop de temps');
    }

    // Vérifier si on a une image (citée ou dans le message)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const selfMedia = msg.message?.imageMessage;
    
    if (!quoted && !selfMedia) {
      await socket.sendMessage(sender, {
        text: `❌ Réponds à une image ou envoie une image avec la commande .upscale\nExemple: ${prefix}upscale (en répondant à une image)`
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

    // Récupérer l'image
    let imageBuffer;
    let imageMime;
    
    try {
      if (quoted) {
        // Image citée
        if (quoted.imageMessage) {
          const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          imageBuffer = Buffer.concat(chunks);
          imageMime = quoted.imageMessage.mimetype || 'image/jpeg';
        } else if (quoted.stickerMessage) {
          // Convertir sticker en image
          const stream = await downloadContentFromMessage(quoted.stickerMessage, 'sticker');
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          const stickerBuffer = Buffer.concat(chunks);
          
          // Vérifier si sharp est disponible
          let sharp;
          try {
            sharp = require('sharp');
          } catch (e) {
            await socket.sendMessage(sender, { 
              text: '❌ La conversion sticker → image nécessite sharp. Installe-le avec: npm install sharp'
            }, { quoted: msg });
            break;
          }
          
          // Convertir WebP en PNG avec gestion d'erreur
          try {
            imageBuffer = await sharp(stickerBuffer)
              .png()
              .toBuffer();
            imageMime = 'image/png';
          } catch (sharpErr) {
            console.error('[SHARP ERROR]', sharpErr);
            await socket.sendMessage(sender, { 
              text: '❌ Erreur lors de la conversion du sticker en image.'
            }, { quoted: msg });
            break;
          }
        } else {
          await socket.sendMessage(sender, { 
            text: '❌ Le message cité n\'est pas une image ou un sticker.'
          }, { quoted: msg });
          break;
        }
      } else if (selfMedia) {
        // Image dans le message courant
        const stream = await downloadContentFromMessage(selfMedia, 'image');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        imageBuffer = Buffer.concat(chunks);
        imageMime = selfMedia.mimetype || 'image/jpeg';
      }
    } catch (downloadErr) {
      console.error('[DOWNLOAD ERROR]', downloadErr);
      await socket.sendMessage(sender, { 
        text: '❌ Erreur lors du téléchargement de l\'image.'
      }, { quoted: msg });
      break;
    }

    if (!imageBuffer || imageBuffer.length < 100) {
      await socket.sendMessage(sender, { 
        text: '❌ Image invalide ou corrompue.'
      }, { quoted: msg });
      break;
    }

    // Vérifier la taille de l'image (max 10MB pour l'API)
    if (imageBuffer.length > 10 * 1024 * 1024) {
      await socket.sendMessage(sender, { 
        text: '❌ L\'image est trop volumineuse (max 10MB).'
      }, { quoted: msg });
      break;
    }

    // Optimiser l'image avec sharp si disponible
    try {
      const sharp = require('sharp');
      // Redimensionner si trop grande et convertir en PNG
      imageBuffer = await sharp(imageBuffer)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .png({ quality: 90 })
        .toBuffer();
      imageMime = 'image/png';
    } catch (sharpErr) {
      console.warn('[SHARP OPTIMIZE]', sharpErr.message);
      // Continuer sans optimisation
    }

    // Sauvegarder temporairement l'image
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempPath = `${tempDir}/upscale_${Date.now()}.png`;
    fs.writeFileSync(tempPath, imageBuffer);

    // Message de progression
    await socket.sendMessage(sender, { 
      text: '🔄 Amélioration de l\'image en cours... (cela peut prendre jusqu\'à 60 secondes)'
    }, { quoted: msg });

    try {
      // Appeler aienhancer
      const result = await aienhancer(tempPath, {
        model: 3, // 1, 2, 3, 4 (différents niveaux)
        settings: 'kRpBbpnRCD2nL2RxnnuoMo7MBc0zHndTDkWMl9aW+Gw='
      });

      if (!result || !result.output) {
        throw new Error('Échec de l\'amélioration');
      }

      // Télécharger l'image améliorée
      const enhancedResponse = await axios.get(result.output, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const enhancedBuffer = Buffer.from(enhancedResponse.data);

      // Vérifier que l'image améliorée est valide
      if (enhancedBuffer.length < 100) {
        throw new Error('Image améliorée invalide');
      }

      // Envoyer l'image améliorée
      await socket.sendMessage(sender, {
        image: enhancedBuffer,
        caption: `✅ Image améliorée avec succès !\n\n📊 *Informations:*\n• Modèle: ${model}\n• Taille originale: ${(imageBuffer.length / 1024).toFixed(2)} KB\n• Taille améliorée: ${(enhancedBuffer.length / 1024).toFixed(2)} KB\n\n🔗 Lien: ${result.output || 'N/A'}`
      }, { quoted: msg });

      // Réaction de succès
      await socket.sendMessage(jid, { react: { text: "✨", key: msg.key } });

    } catch (apiErr) {
      console.error('[API ERROR]', apiErr);
      
      let errorMessage = apiErr.message;
      if (apiErr.response?.status === 400) {
        errorMessage = 'Format d\'image non supporté. Essayez avec une autre image.';
      } else if (apiErr.response?.status === 413) {
        errorMessage = 'Image trop volumineuse pour l\'API.';
      } else if (apiErr.code === 'ECONNABORTED') {
        errorMessage = 'Timeout de connexion.';
      }
      
      await socket.sendMessage(sender, { 
        text: `❌ Erreur API: ${errorMessage}`
      }, { quoted: msg });
      
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      
    } finally {
      // Nettoyer le fichier temporaire
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanErr) {
        console.warn('[CLEANUP]', cleanErr.message);
      }
    }

  } catch (e) {
    console.error('[UPSCALE ERROR]', e);
    
    const jid = msg?.key?.remoteJid;
    const sender = msg?.key?.participant || msg?.key?.remoteJid;
    
    let errorMessage = e.message;
    if (e.response) {
      errorMessage += ` (Status: ${e.response.status})`;
    }
    
    // Messages d'erreur personnalisés
    if (errorMessage.includes('400')) {
      errorMessage = 'Format d\'image non supporté. Essayez avec une image JPG ou PNG.';
    } else if (errorMessage.includes('413')) {
      errorMessage = 'Image trop volumineuse (max 10MB).';
    } else if (errorMessage.includes('timeout')) {
      errorMessage = 'Délai d\'attente dépassé. Réessayez plus tard.';
    }
    
    await socket.sendMessage(sender, { 
      text: `❌ Erreur: ${errorMessage}`
    }, { quoted: msg });
    
    try {
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    } catch (reactErr) {}
  }
  break;
}
            

case 'active':
case 'bots': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // Vérification owner/admin Mongo déjà normalisée au début du handler.
    if (!isPrivileged) {
      await socket.sendMessage(sender, { 
        text: '❌ Accès réservé aux administrateurs.' 
      }, { quoted: msg });
      break;
    }

    const activeCount = activeSockets instanceof Map ? activeSockets.size : 0;
    const activeNumbers = activeSockets instanceof Map ? Array.from(activeSockets.keys(), value => String(value)) : [];

    // Meta mention
    const metaQuote = {
      key: { 
        remoteJid: "status@broadcast", 
        participant: "0@s.whatsapp.net", 
        fromMe: false, 
        id: "META_AI_ACTIVESESSIONS" 
      },
      message: { 
        contactMessage: { 
          displayName: botName, 
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
      }
    };

    // Texte avec séparateurs ASCII
    let text = `╔═══════════════════════════╗\n`;
    text += `   🤖 SESSIONS ACTIVES 🤖\n`;
    text += `╚═══════════════════════════╝\n\n`;
    
    text += `📊 INFORMATIONS\n`;
    text += `├─ Total : ${activeCount}\n`;
    text += `├─ Heure : ${getHaitiTimestamp()}\n`;
    text += `└─ Fuseau : Haïti\n\n`;
    
    if (activeCount > 0) {
      text += `📱 BOTS CONNECTÉS (${activeCount})\n`;
      text += `┌────────────────────────────┐\n`;
      
      activeNumbers.forEach((num, index) => {
        const status = "🟢";
        text += `│ ${status} ${String(index + 1).padStart(2, ' ')}. ${num.padEnd(15, ' ')} │\n`;
      });
      
      text += `└────────────────────────────┘\n\n`;
      
      text += `📈 STATISTIQUES\n`;
      text += `├─ Densité : ${Math.min(100, Math.round((activeCount / 50) * 100))}%\n`;
      text += `├─ Performance : ${activeCount > 10 ? "Élevée" : activeCount > 5 ? "Moyenne" : "Basse"}\n`;
      text += `└─ Statut : Opérationnel ✅\n\n`;
      
      text += `💡 Les sessions sont stables et actives.`;
      
    } else {
      text += `⚠️ AUCUN BOT CONNECTÉ\n\n`;
      text += `Recommandations :\n`;
      text += `• Vérifier la connexion internet\n`;
      text += `• Consulter les logs système\n`;
      text += `• Attendre la reconnexion automatique`;
    }

    // Utilise l’image locale plutôt qu’un logo personnalisé inaccessible (URL
    // expirée, chemin absent ou montage déployé sans ce fichier).
    const activeBanner = path.join(__dirname, '../../assets/images/kaido-menu-banner.png');
    let imagePayload = null;
    try { imagePayload = fs.readFileSync(activeBanner); }
    catch (imageError) { console.warn('[ACTIVE SESSIONS] Bannière locale indisponible :', imageError?.message || imageError); }
    if (imagePayload) {
      try {
        await socket.sendMessage(sender, {
          image: imagePayload,
          mimetype: 'image/png',
          caption: text
        }, { quoted: metaQuote });
      } catch (imageError) {
        console.warn('[ACTIVE SESSIONS] Envoi de l’image impossible; repli texte :', imageError?.message || imageError);
        await socket.sendMessage(sender, { text }, { quoted: metaQuote });
      }
    } else {
      await socket.sendMessage(sender, { text }, { quoted: metaQuote });
    }

  } catch(e) {
    console.error('❌ Erreur bots:', e);
    await socket.sendMessage(sender, {
      text: `❌ Impossible d'accéder aux données des sessions${e?.message ? ` : ${e.message}` : '.'}`
    }, { quoted: msg });
  }
  break;
}


// === COMMANDE FACEBOOK DOWNLOADER ===
// === COMMANDE FACEBOOK DOWNLOADER ===
case 'facebook': case 'fbdl': case 'fb': {
  try {
    // Définir jid à partir de remoteJid (disponible dans ton contexte)
    const jid = remoteJid; // ou msg.key.remoteJid selon ce qui est disponible
    const sender = msg.key.participant || msg.key.remoteJid;
    
    // Vérifier si un lien est fourni
    const url = args.join(' ').trim();
    
    if (!url) {
      await socket.sendMessage(sender, {
        text: `❌ Exemple: ${prefix}${command} https://fb.watch/xxxxxx/`
      }, { quoted: msg });
      break;
    }

    // Vérifier que c'est un lien Facebook valide
    if (!url.match(/(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.watch)\/.*/i)) {
      await socket.sendMessage(sender, {
        text: '❌ Lien Facebook invalide. Utilise un lien comme: https://fb.watch/xxxxxx/'
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
    await socket.sendMessage(sender, { text: '🔄 Téléchargement en cours...' }, { quoted: msg });

    // Appel à l'API fdownloader
    const response = await axios.post('https://v3.fdownloader.net/api/ajaxSearch',
      new URLSearchParams({
        q: url,
        lang: 'en',
        web: 'fdownloader.net',
        v: 'v2',
        w: ''
      }).toString(),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          origin: 'https://fdownloader.net',
          referer: 'https://fdownloader.net/',
          'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    // Vérifier la réponse
    if (!response.data || !response.data.data) {
      throw new Error('Impossible de récupérer les informations de la vidéo');
    }

    // Parser le HTML avec cheerio
    const $ = cheerio.load(response.data.data);
    
    // Extraire la durée
    const duration = $('.content p').first().text().trim() || 'Inconnue';
    
    // Extraire la miniature
    const thumbnail = $('.thumbnail img').attr('src') || null;
    
    // Extraire toutes les qualités disponibles
    const videos = [];
    $('.download-link-fb').each((_, el) => {
      const quality = $(el).attr('title')?.replace('Download ', '') || '';
      const videoUrl = $(el).attr('href');
      if (videoUrl) {
        videos.push({ quality, url: videoUrl });
      }
    });

    // Extraire aussi les liens normaux (parfois dans .download-button)
    $('.download-button a').each((_, el) => {
      const quality = $(el).text().trim() || 'SD';
      const videoUrl = $(el).attr('href');
      if (videoUrl && !videos.some(v => v.url === videoUrl)) {
        videos.push({ quality, url: videoUrl });
      }
    });

    if (videos.length === 0) {
      throw new Error('Aucune vidéo trouvée pour ce lien');
    }

    // Sélectionner la meilleure qualité disponible (priorité: HD > 720p > 480p > première)
    const qualityPriority = ['HD', '720p', '480p', '360p'];
    let selectedVideo = videos[0];
    
    for (const priority of qualityPriority) {
      const found = videos.find(v => 
        v.quality.toLowerCase().includes(priority.toLowerCase())
      );
      if (found) {
        selectedVideo = found;
        break;
      }
    }

    // Message d'information
    const infoMessage = `📹 *Facebook Downloader*\n\n` +
      `📊 *Qualité:* ${selectedVideo.quality}\n` +
      `⏱️ *Durée:* ${duration}\n` +
      `📦 *Taille:* (non disponible)\n\n` +
      `🔗 *Lien:* ${url}\n\n` +
      `📥 *Envoi de la vidéo en cours...*`;

    await socket.sendMessage(sender, { text: infoMessage }, { quoted: msg });

    try {
      // Essayer d'envoyer la vidéo directement
      await socket.sendMessage(jid, {
        video: { url: selectedVideo.url },
        caption: `📹 *Facebook Video*\n📊 Qualité: ${selectedVideo.quality}\n⏱️ Durée: ${duration}`,
        mimetype: 'video/mp4'
      }, { quoted: msg });
      
    } catch (sendErr) {
      console.error('[FACEBOOK SEND ERROR]', sendErr);
      
      // Si l'envoi direct échoue, envoyer le lien
      await socket.sendMessage(sender, {
        text: `❌ Impossible d'envoyer la vidéo directement.\n\n🔗 *Lien de téléchargement:*\n${selectedVideo.url}\n\n📊 *Qualité:* ${selectedVideo.quality}`
      }, { quoted: msg });
    }

    // Réaction de succès
    await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  } catch (e) {
    console.error('[FACEBOOK ERROR]', e);
    
    // Définir jid et sender pour le bloc catch aussi
    const jid = remoteJid || msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    let errorMessage = e.message;
    if (e.response) {
      errorMessage += ` (Status: ${e.response.status})`;
    }
    
    await socket.sendMessage(sender, {
      text: `❌ Erreur: ${errorMessage}\n\nEssayez un autre lien ou réessayez plus tard.`
    }, { quoted: msg });
    
    await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
  }
  break;
}
// case 'ig' : télécharger depuis reelsvideo.io et renvoyer média(s)
case 'ig': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = primaryOwnerNumber();
    // permission : seul le propriétaire de la session ou le bot owner peut utiliser
    if (!(isOwner || isSessionOwner)) {
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can use this command.' }, { quoted: msg });
    }

    const url = (args[0] || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return await socket.sendMessage(sender, { text: '❗ Usage: .ig <instagram_url>\nExample: .ig https://www.instagram.com/p/XXXXXXXXX/' }, { quoted: msg });
    }

    await socket.sendMessage(sender, { text: '🔎 Recherche et téléchargement en cours, merci de patienter...' }, { quoted: msg });

    // appelle la fonction reelsvideo (assure-toi qu'elle est importée dans le fichier)
    const info = await reelsvideo(url);

    if (!info) {
      return await socket.sendMessage(sender, { text: '❌ Impossible de récupérer les informations pour ce lien.' }, { quoted: msg });
    }

    // Préparer un résumé et l'envoyer d'abord
    const summaryLines = [
      `👤 Auteur: ${info.username || 'inconnu'}`,
      `📸 Type: ${info.type || 'inconnu'}`,
      `🖼️ Images: ${info.images?.length || 0}`,
      `🎞️ Vidéos: ${info.videos?.length || 0}`,
      `🎵 Audio: ${info.mp3?.length || 0}`
    ];
    if (info.thumb) summaryLines.unshift(`🔎 Aperçu: ${info.thumb}`);
    await socket.sendMessage(sender, { text: `✅ Résultat:\n${summaryLines.join('\n')}` }, { quoted: msg });

    // helper pour télécharger une URL en Buffer
    async function fetchBufferFromUrl(u) {
      try {
        const r = await axios.get(u, { responseType: 'arraybuffer', timeout: 30_000 });
        return Buffer.from(r.data);
      } catch (e) {
        console.error('[IG] fetchBufferFromUrl error', e?.message || e);
        return null;
      }
    }

    // envoyer les vidéos (priorité aux vidéos)
    if (Array.isArray(info.videos) && info.videos.length) {
      // si plusieurs vidéos, on envoie jusqu'à 3 pour éviter flood
      const toSend = info.videos.slice(0, 3);
      for (const v of toSend) {
        try {
          const buf = await fetchBufferFromUrl(v);
          if (!buf) {
            await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger la vidéo: ${v}` }, { quoted: msg });
            continue;
          }
          await socket.sendMessage(sender, {
            video: buf,
            caption: ` KAIDO MD -- 🎥 Vidéo extraite de ${info.username || 'Instagram'}`,
            mimetype: 'video/mp4'
          }, { quoted: msg });
        } catch (e) {
          console.error('[IG] send video error', e);
        }
      }
      return;
    }

    // sinon envoyer les images (carousel ou single)
    if (Array.isArray(info.images) && info.images.length) {
      const toSend = info.images.slice(0, 6); // limite raisonnable
      for (const imgUrl of toSend) {
        try {
          const buf = await fetchBufferFromUrl(imgUrl);
          if (!buf) {
            await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'image: ${imgUrl}` }, { quoted: msg });
            continue;
          }
          await socket.sendMessage(sender, {
            image: buf,
            caption: `🖼️ Image extraite de ${info.username || 'Instagram'}`
          }, { quoted: msg });
        } catch (e) {
          console.error('[IG] send image error', e);
        }
      }
      return;
    }

    // si audio disponible (mp3)
    if (Array.isArray(info.mp3) && info.mp3.length) {
      for (const a of info.mp3.slice(0, 2)) {
        try {
          const buf = await fetchBufferFromUrl(a.url);
          if (!buf) {
            await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'audio: ${a.url}` }, { quoted: msg });
            continue;
          }
          await socket.sendMessage(sender, {
            audio: buf,
            mimetype: 'audio/mpeg',
            fileName: `${a.id || 'audio'}.mp3`
          }, { quoted: msg });
        } catch (e) {
          console.error('[IG] send audio error', e);
        }
      }
      return;
    }

    // fallback : si aucune ressource trouvée
    await socket.sendMessage(sender, { text: '❌ Aucun média exploitable trouvé pour ce lien.' }, { quoted: msg });

  } catch (err) {
    console.error('[IG COMMAND ERROR]', err);
    try { await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: `❌ Erreur lors du traitement: ${err.message || err}` }, { quoted: msg });
  }
  break;
}


case 'menu': {
  try {
    await socket.sendMessage(sender, { react: { text: "🐉", key: msg.key } });
  } catch (e) {}

  try {
    // Récupérer le JID complet de l'utilisateur (groupe ou privé)
    const userJid = msg?.key?.participant ?? msg?.key?.remoteJid ?? sender;
    const userNumber = (typeof userJid === 'string') ? userJid.split('@')[0] : null;

    // Clés possibles selon comment tu as stocké socketCreationTime
    const keyNumber = userNumber;
    const keyJid = userNumber ? `${userNumber}@s.whatsapp.net` : null;

    // Récupérer startTime depuis la Map (ou undefined si absent)
    let startTime = undefined;
    if (typeof socketCreationTime !== 'undefined' && socketCreationTime instanceof Map) {
      startTime = socketCreationTime.get(keyNumber) ?? socketCreationTime.get(keyJid);
    }

    // Si absent, fallback sur Date.now() pour éviter NaN (ou afficher N/A si tu préfères)
    if (!startTime) startTime = Date.now();

    // Calcul et formatage de l'uptime
    const formatUptime = (ms) => {
      if (!ms || isNaN(ms)) return '0s';
      let total = Math.floor(ms / 1000);
      const days = Math.floor(total / 86400); total %= 86400;
      const hours = Math.floor(total / 3600); total %= 3600;
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      const parts = [];
      if (days) parts.push(`${days}d`);
      if (hours) parts.push(`${hours}h`);
      if (minutes) parts.push(`${minutes}m`);
      if (seconds || parts.length === 0) parts.push(`${seconds}s`);
      return parts.join(' ');
    };

    const uptimeMs = Date.now() - startTime;
    const uptimeStr = formatUptime(uptimeMs);

    // Bot info (défensif)
    const botName = (typeof config !== 'undefined' && config?.BOT_NAME) ? config.BOT_NAME : 'KAIDO-MD';
    const footer = (typeof config !== 'undefined' && config?.BOT_FOOTER) ? config.BOT_FOOTER : '© 2024';
    const version = (typeof config !== 'undefined' && config?.BOT_VERSION) ? config.BOT_VERSION : '1.0.0';

    // Sessions actives (assure-toi que activeSockets est défini dans le scope)
    const activeCount = (typeof activeSockets !== 'undefined' && activeSockets?.size != null) ? activeSockets.size : 0;
    const activeNumbers = (typeof activeSockets !== 'undefined' && activeSockets.keys) ? Array.from(activeSockets.keys()) : [];

    // Nombre de commandes (optionnel)
    const commandsCount = (typeof commandsList !== 'undefined' && Array.isArray(commandsList)) ? commandsList.length : 33;

    // Affichage court pour l'utilisateur (numéro)
    const userShort = userNumber ?? 'user';

    // metaQuote (pour utiliser comme quoted message si souhaité)
    const metaQuote = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_PING"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // Texte complet du menu (préfixe fixe : .)
    const text = `
⛩️  𝐊𝐀𝐈𝐃𝐎 - 𝐌𝐃  ⛩️
             ─── ᵇʸ ᑭ𝗹𝖺𝘨 ───

\`❦︎ ᴀᴛ 1ꪜᦓ1 𝑎𝑙𝑤𝑎𝑦𝑠 ᵇᵉᵗ ᵒⁿ ᵏᵃⁱᵈᵒ ❦︎\`

｢ 👤 𝐔𝐭𝐢𝐥𝐢𝐬𝐚𝐭𝐞𝐮𝐫 : @${userShort} ｣
｢ 🔰 𝐒𝐞𝐬𝐬𝐢𝐨𝐧𝐬 𝐚𝐜𝐭𝐢𝐯𝐞𝐬 : ${activeCount} ｣
｢ 📜 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐞𝐬 : 57 ｣

✵ Ⓟ︎ : 𝖯𝖱𝖤𝖬𝖨𝖴𝖬
✵ Ⓛ︎ : 𝖫𝖨𝖬𝖨𝖳𝖤𝖲 𝖰𝖴𝖮𝖳

**site officiel** : https://kaidomd-byplag.mooo.com/

> 〢  𝐌𝐄𝐍𝐔 𝐏𝐑𝐈𝐍𝐂𝐈𝐏𝐀𝐋 ✿︎

> ・ .menu
> ・ .ping
> ・ .aide / .help
> ・ .owner

> 〢 𝐆𝐑𝐎𝐔𝐏𝐄 ᯽

> ・ .kick
> ・ .add
> ・ .leave
> ・ .tagall
> ・ .hidetag /.h
> ・ .mute
> ・ .unmute
> ・ .swgc / .gcstatus
> ・ .style (audio stylisé / Fancy Text)
> ・ .setgpp
> ・ .listadmin
> ・ .creategroup
> ・ .acceptall
> ・ .revokeall
> ・ .listactive
> ・ .listinactive
> ・ .kickinactive
> ・ .kickall
> ・ .antilink
> ・ .antistatusmention

> 〢 𝐉𝐄𝐔𝐗 🎮

> ・ .tictactoe/ttt

> 〢 𝐎𝐔𝐓𝐈𝐋𝐒 ⚒️

> ・ .sticker
> ・ .take
> ・ .trt
> ・ .tovn
> ・ .save
> ・ .vv
> ・ .bible
> ・ .upch
> ・ .img
> ・ .jid
> ・ .cjid
> ・ .rch Ⓟ︎
> ・ .code
> ・ .getpp
> ・ .setpp
> ・ .setlang
> ・ .ssweb
> ・ .checkban
> ・ .shazam
> ・ .mediafire
> 〢𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ✿︎

> ・ .play Ⓛ︎
> ・ .playvideo Ⓛ︎
> ・ .playptt Ⓛ︎
> ・ .tiktok
> ・ .facebook
> ・ .ig
> ・ .modapk

> 〢𝐏𝐀𝐑𝐀𝐌𝐒 𖣘

> ・ .config show
> ・ .config autoview
> ・ .config autolike
> ・ .config autorec
> ・ .config setemoji
> ・ .config setprefix



━━━━━━━━━━━━━━━━━━━━━━━━
                🐉-𝑲𝒊𝒏𝒈 𝒐𝒇 𝒕𝒉𝒆 𝒃𝒆𝒂𝒔𝒕 -🐉
━━━━━━━━━━━━━━━━━━━━━━━━

*STATUT BOT*
• Uptime: ${uptimeStr}
• Prefix: .
• Version: ${version}

${footer}
`.trim();

    // Envoi du menu sans boutons, avec mention réelle, forwarded look et externalAdReply (newsletter)
    await socket.sendMessage(sender, {
      text: text,
      contextInfo: {
        mentionedJid: [userJid],      // permet la vraie mention
        forwardingScore: 999,         // apparence "forwarded many times"
        isForwarded: true,
        externalAdReply: {
          title: `${botName} - ON 🔥`,
          body: `Prefix: . | Uptime: ${uptimeStr}`,
          thumbnailUrl: 'https://files.catbox.moe/l1lzbx.png', // remplace par ton logo
          sourceUrl: 'https://whatsapp.com',
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: metaQuote });

  } catch (err) {
    console.error('menu error:', err);
    try {
      await socket.sendMessage(sender, {
        text:
          '📋 *MENU SIMPLE*\n\n' +
          `.add, .kick, .creategroup\n` +
          `.save, .tovn, .vv\n` +
          `.play, .bible, .code\n` +
          `.upch, .swgc / .gcstatus, .style, .img\n` +
          `\nUtilise .help [commande] pour plus d'info`
      }, { quoted: msg });
    } catch (e) {}
  }
  break;
}


// `.swgc` / `.gcstatus` et le mode audio de `.style` sont implémentés dans les
// plugins de groupe. Ils s’exécutent avant ce switch afin de garantir qu’aucun message normal ne soit envoyé dans
// le groupe ciblé : seul groupStatusMessageV2 y est relayé.

// ==================== DOWNLOAD MENU ====================


// ==================== TOOLS MENU ====================



// ==================== OWNER MENU ====================
// CASE AIDE / HELP
case 'aide':
case 'help': {
  if (!from) break;

  // quoted meta (contact) utilisé comme quoted pour le design
  const metaQuote = {
    key: {
      remoteJid: "status@broadcast",
      participant: "0@s.whatsapp.net",
      fromMe: false,
         id: "META_AI_PING"
    },
    message: {
      contactMessage: {
        displayName: botName || 'KAIDO-MD',
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName || 'KAIDO-MD'};;;;\nFN:${botName || 'KAIDO-MD'}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
      }
    }
  };

  // URL vidéo à afficher dans l'aperçu (remplace par ta vidéo)
  const videoUrl = 'https://www.example.com/preview-video.mp4';

  // Texte d'aide détaillé (utile et concis)
  const helpText = `
⛩️  𝐊𝐀𝐈𝐃𝐎 - 𝐌𝐃  ⛩️
───────────────

〢  𝐌𝐄𝐍𝐔 𝐏𝐑𝐈𝐍𝐂𝐈𝐏𝐀𝐋 ✿︎
・ .menu       → Affiche le menu principal.
・ .ping       → Vérifie si le bot répond et affiche l'uptime.
・ .aide/.help → Ce message d'aide détaillé.
・ .owner      → Contacte le propriétaire du bot.

〢  𝐆𝐑𝐎𝐔𝐏𝐄 ᯽
・ .kick @membre         → Expulse le membre mentionné (admins seulement).
・ .add <num>            → Ajoute un numéro au groupe (admins seulement).
・ .leave                → Le bot quitte le groupe (admin only).
・ .tagall               → Mentionne tous les membres du groupe.
・ .mute                 → Restreint l'envoi aux admins (admins).
・ .unmute               → Réactive l'envoi pour tous.
・ .swgc / .gcstatus     → Publie un statut de groupe (audio brut, texte, image ou vidéo).
・ .style                → Répond à un audio pour publier la vidéo Kaido stylisée; avec du texte, Fancy Text.
・ .listadmin            → Liste les admins du groupe.
・ .creategroup          → Crée un nouveau groupe via le bot.
・ .listactive           → Liste les membres actifs.
・ .listinactive         → Liste les membres inactifs.
・ .kickinactive         → Expulse les membres inactifs (admins only).
・ .kickall              → Expulse tous les non-admins (admins only).
・ .antilink on|off      → Supprime automatiquement les messages contenant des liens.
・ .antistatusmention on|off → Supprime les mentions de status dans le groupe.

〢  𝐎𝐔𝐓𝐈𝐋𝐒 ☀︎︎
・ .sticker   → Convertit une image/vidéo en sticker.
・ .trt       → Traduction.
・ .tovn      → Convertit audio en note vocale.
・ .save      → Sauvegarde un média(statut , vue unique etc..).
・ .vv        → révélateur de vue unique.
・ .bible     → Verset aléatoire / recherche biblique.
・ .upch      → envoyer un media vers une chaîne.
・ .img       → Recherche d'image.
・ .jid       → Récupère le JID d'un utilisateur.
・ .cjid      → Récupère le JID d'une chaîne citée.
・ .rch Ⓟ︎    → fake réaction de chaine(requiert accès premium).
・ .code      → connecter un nouvel appareil au bot.
・ .getpp     → Récupère la photo de profil d'un utilisateur.

〢  𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ✿︎
・ .play Ⓛ︎       → Télécharge l'audio d'une vidéo YouTube.
・ .playvideo Ⓛ︎  → Télécharge la vidéo YouTube.
・ .playptt Ⓛ︎    → Télécharge en note vocale.
・ .tiktok         → Télécharge une vidéo TikTok.
・ .facebook       → Télécharge depuis Facebook.
・ .ig             → Télécharge depuis Instagram.

━━━━━━━━━━━━━━━━
ℹ️  Pour chaque commande, utilise .help <commande> pour plus de détails.
━━━━━━━━━━━━━━━━
`.trim();

  try {
    // Envoi du message d'aide avec preview vidéo via externalAdReply
    await socket.sendMessage(from, {
      text: helpText,
      contextInfo: {
        mentionedJid: [], // tu peux ajouter des mentions si nécessaire
        externalAdReply: {
          title: `${botName || 'KAIDO-MD'} — Aide`,
          body: 'Guide rapide des commandes et utilitaires',
          mediaUrl: videoUrl,
          thumbnailUrl: 'https://files.catbox.moe/thumbnail.jpg', // remplace par ton thumbnail
          sourceUrl: videoUrl,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: metaQuote });
  } catch (err) {
    console.error('[ERROR help case]', err);
    // Fallback simple si l'envoi riche échoue
    await socket.sendMessage(from, { text: helpText }, { quoted: metaQuote });
  }
  break;
}


case 'owner': {
  try { await socket.sendMessage(sender, { react: { text: "👑", key: msg.key } }); } catch(e){}

  try {
    // Informations du propriétaire
    const ownerNumber = '50947440869'; // sans +
    const ownerDisplay = '𝛭𝑈𝐺𝛪𝑊𝛥𝑅𝛥   𝛮𝛩 𝛲𝐿𝛥𝐺';

    // Construire la vCard
    const vcard = `BEGIN:VCARD
VERSION:3.0
N:${ownerDisplay};;;;
FN:${ownerDisplay}
ORG:Créateur
TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}
END:VCARD`;

    // Objet "quoted" pour afficher la carte de contact en aperçu
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_OWNER"
      },
      message: {
        contactMessage: {
          displayName: ownerDisplay,
          vcard
        }
      }
    };

    // Texte "cool" qui met en valeur le créateur
    const text = `
╭─❏ *MEET THE CREATOR* ❏
│
│ 👑 *${ownerDisplay}*
│ 📱 *Contact*: +${ownerNumber}
│
│ ✨ Le génie derrière ce bot — créatif, passionné et toujours prêt à aider.
│ 🔧 Si tu veux des fonctionnalités sur mesure, c'est lui qu'il faut contacter.
│
│ 💬 *Support, collaborations ou idées* — il répondra avec plaisir.
│
╰───────────────❏
`.trim();

    // Envoyer le message principal en citant la vCard pour que l'aperçu apparaisse
    await socket.sendMessage(sender, {
      text,
      footer: "👑 CREATOR"
    }, { quoted: shonux });

    // Envoyer aussi la vCard en tant que contact (pour que l'utilisateur puisse l'ajouter facilement)
    try {
      await socket.sendMessage(sender, {
        contacts: {
          displayName: ownerDisplay,
          contacts: [{ vcard }]
        }
      }, { quoted: msg });
    } catch (e) {
      // Si l'envoi en "contacts" échoue, on ignore silencieusement (l'aperçu a déjà été envoyé)
      console.error('[OWNER] Envoi vCard direct échoué:', e);
    }

  } catch (err) {
    console.error('owner command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show owner info.' }, { quoted: msg }); } catch(e){}
  }
  break;
}
        case 'unfollow': {
  const requestedJid = args[0] ? args[0].trim() : null;
  if (!requestedJid) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide channel JID to unfollow. Example:\n.unfollow 120363396379901844@newsletter' }, { quoted: shonux });
  }

  if (!isPrivileged) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or admins can remove channels.' }, { quoted: shonux });
  }

  const jid = normaliseNewsletterJid(requestedJid);
  if (!jid) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Invalid JID. Must end with @newsletter' }, { quoted: shonux });
  }

  try {
    await removeNewsletterFromMongo(jid);
    await syncNewsletterSockets(activeSockets, jid, 'unfollow', [socket]);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Unfollowed and removed from DB: ${jid}` }, { quoted: shonux });
  } catch (e) {
    console.error('unfollow error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW5" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to unfollow: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tiktok':
case 'tt': {
  try {
    // Définir jid et sender
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    // headers adaptés au site savett.cc
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Origin': 'https://savett.cc',
      'Referer': 'https://savett.cc/en1/download',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
    };

    // helpers encapsulés
    async function getCsrfAndCookie() {
      const res = await axios.get('https://savett.cc/en1/download', { 
        headers,
        timeout: 10000 
      });
      const csrf = res.data.match(/name="csrf_token" value="([^"]+)"/)?.[1] || null;
      const cookie = (res.headers['set-cookie'] || [])
        .map(v => v.split(';')[0])
        .join('; ');
      return { csrf, cookie };
    }

    async function postDl(url, csrf, cookie) {
      const body = `csrf_token=${encodeURIComponent(csrf)}&url=${encodeURIComponent(url)}`;
      const res = await axios.post('https://savett.cc/en1/download', body, {
        headers: { ...headers, Cookie: cookie },
        timeout: 30000
      });
      return res.data;
    }

    function parseSavettHtml(html) {
      const $ = cheerio.load(html);
      const stats = [];
      $('#video-info .my-1 span').each((_, el) => stats.push($(el).text().trim()));

      const data = {
        username: $('#video-info h3').first().text().trim() || null,
        views: stats[0] || null,
        likes: stats[1] || null,
        bookmarks: stats[2] || null,
        comments: stats[3] || null,
        shares: stats[4] || null,
        duration: $('#video-info p.text-muted').first().text().replace(/Duration:/i, '').trim() || null,
        type: null,
        downloads: { nowm: [], wm: [] },
        mp3: [],
        slides: []
      };

      const slides = $('.carousel-item[data-data]');
      if (slides.length) {
        data.type = 'photo';
        slides.each((_, el) => {
          try {
            const json = JSON.parse($(el).attr('data-data').replace(/&quot;/g, '"'));
            if (Array.isArray(json.URL)) {
              json.URL.forEach(url => data.slides.push({ index: data.slides.length + 1, url }));
            }
          } catch {}
        });
        return data;
      }

      data.type = 'video';
      $('#formatselect option').each((_, el) => {
        const label = $(el).text().toLowerCase();
        const raw = $(el).attr('value');
        if (!raw) return;
        try {
          const json = JSON.parse(raw.replace(/&quot;/g, '"'));
          if (!json.URL) return;
          if (label.includes('mp4') && !label.includes('watermark')) data.downloads.nowm.push(...json.URL);
          if (label.includes('watermark')) data.downloads.wm.push(...json.URL);
          if (label.includes('mp3')) data.mp3.push(...json.URL);
        } catch {}
      });

      return data;
    }

    async function savett(url) {
      const { csrf, cookie } = await getCsrfAndCookie();
      if (!csrf) throw new Error('CSRF token not found');
      const html = await postDl(url, csrf, cookie);
      return parseSavettHtml(html);
    }

    // helper pour télécharger une URL en Buffer avec limite de taille
    async function fetchBufferFromUrl(u) {
      try {
        // Vérifier l'espace disque disponible
        const stats = await fs.promises.stat('/').catch(() => ({ size: 0 }));
        const freeSpace = stats.size || 1024 * 1024 * 1024; // fallback 1GB
        
        // Limiter à 50MB par fichier
        const response = await axios({
          method: 'GET',
          url: u,
          responseType: 'stream',
          timeout: 30000,
          maxContentLength: 50 * 1024 * 1024, // 50MB max
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const chunks = [];
        let totalSize = 0;
        
        for await (const chunk of response.data) {
          chunks.push(chunk);
          totalSize += chunk.length;
          
          // Vérifier la taille totale
          if (totalSize > 50 * 1024 * 1024) {
            throw new Error('Fichier trop volumineux (>50MB)');
          }
        }
        
        return Buffer.concat(chunks);
      } catch (e) {
        console.error('[TIKTOK] fetchBufferFromUrl error', e?.message || e);
        return null;
      }
    }

    // validation URL
    const url = (args[0] || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      await socket.sendMessage(sender, { 
        text: '❗ Usage: .tiktok <url>\nExample: .tiktok https://vt.tiktok.com/xxxxx' 
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
    await socket.sendMessage(sender, { 
      text: '🔎 Recherche et téléchargement en cours, merci de patienter...' 
    }, { quoted: msg });

    // exécution principale
    const info = await savett(url);

    if (!info) {
      await socket.sendMessage(sender, { 
        text: '❌ Impossible de récupérer les informations pour ce lien.' 
      }, { quoted: msg });
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      break;
    }

    // résumé
    const summary = [
      `👤 Auteur: ${info.username || 'inconnu'}`,
      `🎞️ Type: ${info.type || 'inconnu'}`,
      `🖼️ Slides: ${info.slides?.length || 0}`,
      `🎵 Audio: ${info.mp3?.length || 0}`,
      `📥 Vidéos (no watermark): ${info.downloads.nowm?.length || 0}`,
      `💧 Vidéos (watermark): ${info.downloads.wm?.length || 0}`
    ];
    if (info.duration) summary.push(`⏱️ Durée: ${info.duration}`);
    
    await socket.sendMessage(sender, { 
      text: `✅ Résultat:\n${summary.join('\n')}` 
    }, { quoted: msg });

    // Fonction pour envoyer avec gestion d'erreur
    async function sendMediaWithRetry(mediaType, buffer, caption, maxRetries = 2) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const messageOptions = { quoted: msg };
          if (mediaType === 'video') {
            await socket.sendMessage(jid, { video: buffer, caption, mimetype: 'video/mp4' }, messageOptions);
          } else if (mediaType === 'audio') {
            await socket.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3' }, messageOptions);
          } else if (mediaType === 'image') {
            await socket.sendMessage(jid, { image: buffer, caption }, messageOptions);
          }
          return true;
        } catch (sendErr) {
          console.error(`[TIKTOK] Send attempt ${i + 1} failed:`, sendErr.message);
          if (i === maxRetries - 1) throw sendErr;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      return false;
    }

    let mediaSent = false;

    // priorité: envoyer les vidéos sans watermark si disponibles
    if (Array.isArray(info.downloads.nowm) && info.downloads.nowm.length) {
      const toSend = info.downloads.nowm.slice(0, 1); // limiter à 1 pour éviter les problèmes
      for (const v of toSend) {
        const buf = await fetchBufferFromUrl(v);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger la vidéo` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('video', buf, `🎥 TikTok — ${info.username || 'Auteur'}`);
        if (sent) mediaSent = true;
      }
    }

    // sinon envoyer vidéos watermark si présentes
    if (!mediaSent && Array.isArray(info.downloads.wm) && info.downloads.wm.length) {
      const toSend = info.downloads.wm.slice(0, 1);
      for (const v of toSend) {
        const buf = await fetchBufferFromUrl(v);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger la vidéo` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('video', buf, `🎥 TikTok (watermark) — ${info.username || 'Auteur'}`);
        if (sent) mediaSent = true;
      }
    }

    // si mp3 disponible
    if (!mediaSent && Array.isArray(info.mp3) && info.mp3.length) {
      for (const a of info.mp3.slice(0, 1)) {
        const buf = await fetchBufferFromUrl(a);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'audio` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('audio', buf, '');
        if (sent) mediaSent = true;
      }
    }

    // slides (photos)
    if (!mediaSent && Array.isArray(info.slides) && info.slides.length) {
      for (const s of info.slides.slice(0, 3)) {
        const buf = await fetchBufferFromUrl(s.url);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'image` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('image', buf, `🖼️ Slide ${s.index} — ${info.username || 'Auteur'}`);
        if (sent) mediaSent = true;
      }
    }

    // Réaction finale
    if (mediaSent) {
      await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
    } else {
      await socket.sendMessage(sender, { text: '❌ Aucun média exploitable trouvé pour ce lien.' }, { quoted: msg });
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    }

  } catch (err) {
    console.error('[TIKTOK COMMAND ERROR]', err);
    
    // Définir jid et sender pour le catch
    const jid = msg?.key?.remoteJid;
    const sender = msg?.key?.participant || msg?.key?.remoteJid;
    
    try { 
      await socket.sendMessage(jid, { react: { text: '❌', key: msg.key } }); 
    } catch(e){}
    
    let errorMessage = err.message || 'Erreur inconnue';
    if (errorMessage.includes('ENOSPC')) {
      errorMessage = 'Espace disque insuffisant pour traiter ce média. Essayez avec un fichier plus petit.';
    } else if (errorMessage.includes('timeout')) {
      errorMessage = 'Délai d\'attente dépassé. Le serveur met trop de temps à répondre.';
    }
    
    await socket.sendMessage(sender, { 
      text: `❌ Erreur lors du traitement: ${errorMessage}` 
    }, { quoted: msg });
  }
  break;
}

case 'gjid':
case 'groupjid':
case 'grouplist': {
  try {
    // ✅ Owner check removed — now everyone can use it!

    await socket.sendMessage(sender, { 
      react: { text: "📝", key: msg.key } 
    });

    await socket.sendMessage(sender, { 
      text: "📝 Fetching group list..." 
    }, { quoted: msg });

    const groups = await socket.groupFetchAllParticipating();
    const groupArray = Object.values(groups);

    // Sort by creation time (oldest to newest)
    groupArray.sort((a, b) => a.creation - b.creation);

    if (groupArray.length === 0) {
      return await socket.sendMessage(sender, { 
        text: "❌ No groups found!" 
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY || "CHMA MD";

    // ✅ Pagination setup — 10 groups per message
    const groupsPerPage = 10;
    const totalPages = Math.ceil(groupArray.length / groupsPerPage);

    for (let page = 0; page < totalPages; page++) {
      const start = page * groupsPerPage;
      const end = start + groupsPerPage;
      const pageGroups = groupArray.slice(start, end);

      // ✅ Build message for this page
      const groupList = pageGroups.map((group, index) => {
        const globalIndex = start + index + 1;
        const memberCount = group.participants ? group.participants.length : 'N/A';
        const subject = group.subject || 'Unnamed Group';
        const jid = group.id;
        return `*${globalIndex}. ${subject}*\n👥 Members: ${memberCount}\n🆔 ${jid}`;
      }).join('\n\n');

      const textMsg = `📝 *Group List - ${botName}*\n\n📄 Page ${page + 1}/${totalPages}\n👥 Total Groups: ${groupArray.length}\n\n${groupList}`;

      await socket.sendMessage(sender, {
        text: textMsg,
        footer: `🤖 Powered by ${botName}`
      });

      // Add short delay to avoid spam
      if (page < totalPages - 1) {
        await delay(1000);
      }
    }

  } catch (err) {
    console.error('GJID command error:', err);
    await socket.sendMessage(sender, { 
      text: "❌ Failed to fetch group list. Please try again later." 
    }, { quoted: msg });
  }
  break;
}





case 'mediafire':
case 'mf':
case 'mfdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const url = text.split(" ")[1]; // .mediafire <link>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'KAIDO MD';

        // ✅ Fake Meta contact message (like Facebook style)
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: shonux });

        // 🔹 Call API
        let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: shonux });
        }

        const result = data.result;
        const title = result.title || result.filename;
        const filename = result.filename;
        const fileSize = result.size;
        const downloadUrl = result.url;

        const caption = `📦 *${title}*\n\n` +
                        `📁 *Filename:* ${filename}\n` +
                        `📏 *Size:* ${fileSize}\n` +
                        `🌐 *From:* ${result.from}\n` +
                        `📅 *Date:* ${result.date}\n` +
                        `🕑 *Time:* ${result.time}\n\n` +
                        `✅ Downloaded by KAIDO-MD`;

        // 🔹 Send file automatically (document type for .zip etc.)
        await socket.sendMessage(sender, {
            document: { url: downloadUrl },
            fileName: filename,
            mimetype: 'application/octet-stream',
            caption: caption
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in MediaFire downloader:", err);

        // ✅ In catch also send Meta mention style
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'NIKKA MINI BOT AI';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}


// ---------------- list saved newsletters (show emojis) ----------------
case 'plaglist': {
  try {
    const docs = await listNewslettersFromMongo();
    if (!docs || docs.length === 0) {
      let userCfg = {};
      try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
      const title = userCfg.botName || 'NIKKA MINI BOT AI';
      const shonux = {
          key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST" },
          message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '📭 No channels saved in DB.' }, { quoted: shonux });
    }

    let txt = '*📚 Saved Newsletter Channels:*\n\n';
    for (const d of docs) {
      txt += `• ${d.jid}\n  Emojis: ${Array.isArray(d.emojis) && d.emojis.length ? d.emojis.join(' ') : '(default)'}\n\n`;
    }

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('newslist error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to list channels.' }, { quoted: shonux });
  }
  break;
}



case 'cid': {
  try {
    // --- Extraire la requête depuis le message (supporte plusieurs types)
    const q = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || msg.message?.videoMessage?.caption
      || '';

    // --- sanitized session id (cohérence)
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'KAIDO-MD';

    // --- fausse vCard pour les réponses citées
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_CID"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    // --- Extraire le lien depuis la commande ou le texte (supporte .cid <link> ou texte contenant le lien)
    let channelLink = (args && args.length) ? args.join(' ').trim() : q.replace(/^[.\/!]cid\s*/i, '').trim();
    if (!channelLink) {
      const urlMatch = q.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) channelLink = urlMatch[0];
    }

    if (!channelLink) {
      return await socket.sendMessage(sender, {
        text: '❎ Veuillez fournir un lien de Channel WhatsApp.\n\n📌 Exemple : .cid https://whatsapp.com/channel/123456789'
      }, { quoted: shonux });
    }

    // --- Normaliser et valider le lien
    const match = channelLink.match(/(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([\w-]+)/i);
    if (!match) {
      return await socket.sendMessage(sender, {
        text: '⚠️ Format de lien invalide.\nAssurez‑vous qu’il ressemble à :\nhttps://whatsapp.com/channel/xxxxxxxxx'
      }, { quoted: shonux });
    }
    const inviteId = match[1].slice(0, 128);

    // Cache LRU borné, avec expiration : le TTL seul laissait les vieilles clés
    // oubliées en mémoire quand les liens n’étaient consultés qu’une fois.
    if (!isBoundedCache(global.__whatsapp_channel_cache)) {
      global.__whatsapp_channel_cache = createBoundedCache({ maxEntries: 128, maxAgeMs: 10 * 60 * 1000 });
    }
    const cacheKey = `channel_${inviteId}`;
    const cached = global.__whatsapp_channel_cache.get(cacheKey);
    if (cached) {
      const metadata = cached.metadata;
      if (process.env.LOG_LEVEL === 'debug') console.debug('[CID] renvoi depuis le cache pour', inviteId);
      const infoTextCached = buildChannelInfoText(metadata, botName);
      // Envoi interactif depuis le cache
      const previewUrlCached = normalizePreviewUrl(metadata.preview);
      const interactiveCached = buildChannelInfoInteractiveMessage({
        infoText: infoTextCached,
        botName,
        copyCode: metadata.id
      });
      if (previewUrlCached) {
        try {
          await socket.sendMessage(sender, {
            image: { url: previewUrlCached },
            caption: `📡 *${metadata.name || 'WhatsApp Channel'}*`
          }, { quoted: shonux });
        } catch (error) {
          console.warn('[CID] aperçu du channel indisponible :', error?.message || error);
        }
      }
      try {
        await socket.relayMessage(sender, interactiveCached, { messageId: `cid_${inviteId}_${Date.now()}` });
      } catch (e) {
        console.warn('[CID] CTA copy indisponible; repli texte :', e?.message || e);
        await socket.sendMessage(sender, { text: `${infoTextCached}\n\n🆔 ID à copier : \`${metadata.id}\`` }, { quoted: shonux });
      }
      break;
    }

    // --- Indiquer que l'on récupère les infos
    await socket.sendMessage(sender, { text: `🔎 Récupération des informations du channel : *${inviteId}*` }, { quoted: shonux });

    // --- Wrapper timeout pour appels asynchrones
    const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

    // --- Récupérer les métadonnées via l'API Baileys si disponible
    let metadata = null;
    try {
      if (typeof socket.newsletterMetadata === 'function') {
        metadata = await withTimeout(socket.newsletterMetadata("invite", inviteId), 15000);
      } else if (typeof socket.getNewsletterMetadata === 'function') {
        metadata = await withTimeout(socket.getNewsletterMetadata(inviteId), 15000);
      } else {
        throw new Error('newsletterMetadata non disponible sur le socket');
      }
    } catch (errMeta) {
      console.warn('[CID] échec récupération metadata', errMeta?.message || errMeta);
      metadata = null;
    }

    if (!metadata || !metadata.id) {
      return await socket.sendMessage(sender, {
        text: '❌ Channel introuvable ou inaccessible. Il peut être privé ou l’API ne fournit pas ses métadonnées.'
      }, { quoted: shonux });
    }

    const safeMetadataText = (value, maxLength = 256) => {
      if (value instanceof Date && Number.isFinite(value.getTime())) value = value.toISOString();
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const text = String(value).trim().slice(0, maxLength);
      return text || null;
    };
    const rawPreview = metadata.preview || metadata.thumbnail || metadata.image || null;
    const preview = typeof rawPreview === 'string'
      ? rawPreview.slice(0, 2048)
      : (typeof rawPreview?.url === 'string' ? rawPreview.url.slice(0, 2048) : null);
    const subscriberCount = Number(metadata.subscribers ?? metadata.subscriberCount ?? metadata.followers);
    const normalized = {
      id: safeMetadataText(metadata.id || inviteId, 256),
      name: safeMetadataText(metadata.name || metadata.title, 256),
      subscribers: Number.isFinite(subscriberCount) ? subscriberCount : null,
      creation_time: safeMetadataText(metadata.creation_time || metadata.createdAt || metadata.created_at, 64),
      preview,
      description: safeMetadataText(metadata.description || metadata.about, 1200),
      category: safeMetadataText(metadata.category, 100),
      owner: safeMetadataText(metadata.owner || metadata.creator, 256)
    };

    // --- Persister dans le cache mémoire
    global.__whatsapp_channel_cache.set(cacheKey, { metadata: normalized, _ts: Date.now() });

    // --- Construire le texte d'information
    function buildChannelInfoText(md, botNameLocal) {
      const lines = [];
      lines.push('📡 *Informations du WhatsApp Channel*');
      lines.push('');
      lines.push(`🆔 *ID:* ${md.id}`);
      if (md.name) lines.push(`📌 *Nom:* ${md.name}`);
      if (md.subscribers !== null && md.subscribers !== undefined) lines.push(`👥 *Abonnés:* ${Number(md.subscribers).toLocaleString()}`);
      if (md.creation_time) {
        try {
          const ts = Number(md.creation_time);
          const dateStr = isNaN(ts) ? String(md.creation_time) : new Date(ts * 1000).toLocaleString();
          lines.push(`📅 *Créé le:* ${dateStr}`);
        } catch { lines.push(`📅 *Créé le:* ${md.creation_time}`); }
      }
      if (md.category) lines.push(`🏷️ *Catégorie:* ${md.category}`);
      if (md.owner) lines.push(`👤 *Propriétaire:* ${md.owner}`);
      if (md.description) lines.push('');
      if (md.description) lines.push(`📝 ${md.description}`);
      lines.push('');
      lines.push(`_© Propulsé par ${botNameLocal}_`);
      return lines.join('\n');
    }

    function normalizePreviewUrl(preview) {
      if (typeof preview !== 'string' || !preview) return null;
      const value = preview.slice(0, 2048);
      if (/^https?:\/\//i.test(value)) return value;
      return `https://pps.whatsapp.net${value.startsWith('/') ? '' : '/'}${value}`;
    }

    const infoText = buildChannelInfoText(normalized, botName);
    const previewUrl = normalizePreviewUrl(normalized.preview);

    const interactive = buildChannelInfoInteractiveMessage({
      infoText,
      botName,
      copyCode: normalized.id
    });
    if (previewUrl) {
      try {
        await socket.sendMessage(sender, {
          image: { url: previewUrl },
          caption: `📡 *${normalized.name || 'WhatsApp Channel'}*`
        }, { quoted: shonux });
      } catch (error) {
        console.warn('[CID] aperçu du channel indisponible :', error?.message || error);
      }
    }

    // L’en-tête reste textuel : une URL ne peut pas être fournie comme
    // imageMessage brut dans un relay interactif; le bouton CTA copy est natif.
    try {
      await socket.relayMessage(sender, interactive, { messageId: `cid_${inviteId}_${Date.now()}` });
    } catch (errRelay) {
      console.warn('[CID] relay interactif indisponible, repli texte :', errRelay?.message || errRelay);
      await socket.sendMessage(sender, {
        text: `${infoText}\n\n🆔 ID à copier : \`${normalized.id}\``
      }, { quoted: shonux });
    }

  } catch (err) {
    console.error("Erreur commande CID :", err);
    try {
      await socket.sendMessage(sender, {
        text: '⚠️ Une erreur inattendue est survenue lors de la récupération des informations du channel. Veuillez réessayer plus tard.'
      }, { quoted: shonux });
    } catch (e) { /* ignore */ }
  }
  break;
}

case 'addadmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid or number to add as admin\nExample: .addadmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can add admins.' }, { quoted: shonux });
  }

  try {
    await addAdminToMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Added admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('addadmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to add admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'tagall': {
  try {
    if (!from || !from.endsWith('@g.us')) {
      return await socket.sendMessage(sender, { 
        text: '❌ Cette commande ne peut être utilisée que dans les groupes.' 
      }, { quoted: msg });
    }

    let gm = null;
    try { 
      gm = await socket.groupMetadata(from); 
    } catch(e) { 
      gm = null; 
    }
    
    if (!gm) {
      return await socket.sendMessage(sender, { 
        text: '❌ Impossible de récupérer les informations du groupe.' 
      }, { quoted: msg });
    }

    const participants = Array.isArray(gm.participants) ? gm.participants : [];
    const actor = nowsender || msg.key?.participant || msg.key?.remoteJid;
    if (!isGroupAdmin(gm, [actor, msg.key?.participantAlt])) {
      return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser tagall.' }, { quoted: msg });
    }
    if (!participants.length) {
      return await socket.sendMessage(sender, {
        text: '❌ Aucun membre trouvé dans le groupe.'
      }, { quoted: msg });
    }

    const text = args && args.length ? args.join(' ') : '📢 Annonce à tous les membres';

    let groupPP = 'https://i.ibb.co/9q2mG0Q/default-group.jpg';
    try { 
      groupPP = await socket.profilePictureUrl(from, 'image'); 
    } catch(e){}

    const mentions = participants.map(getParticipantMentionJid).filter(Boolean);
    const groupName = gm.subject || 'Groupe';
    const totalMembers = participants.length;

    const emojis = ['📢','🔊','🌐','🛡️','🚀','🎯','🧿','🪩','🌀','💠','🎊','🎧','📣','🗣️'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // BotName meta mention
    const metaQuote = {
      key: { 
        remoteJid: "status@broadcast", 
        participant: "0@s.whatsapp.net", 
        fromMe: false, 
        id: "META_AI_TAGALL" 
      },
      message: { 
        contactMessage: { 
          displayName: botName, 
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
      }
    };

    // Message stylisé en français
    let caption = `╔══════════════════════════════╗
      📢  MENTION GÉNÉRALE  📢
╚══════════════════════════════╝

📌 *Groupe :* ${groupName}
👥 *Membres :* ${totalMembers}
💬 *Message :* ${text}

${"─".repeat(35)}

📍 *Mention de tous les membres :*

`;

    // Ajouter les mentions avec format amélioré
    participants.forEach((m, index) => {
      const id = (m.id || m.jid);
      if (!id) return;
      const memberNumber = id.split('@')[0];
      caption += `┣ ${index + 1}. ${randomEmoji} @${memberNumber}\n`;
    });

    caption += `
${"─".repeat(35)}

🕒 ${getHaitiTimestamp()}
🤖 ${botName}
📍 Fuseau : Haïti

*Note :* Cette mention a été générée automatiquement.`;

    await socket.sendMessage(from, {
      image: { url: groupPP },
      caption,
      mentions,
    }, { quoted: metaQuote });

  } catch (err) {
    console.error('tagall error', err);
    await socket.sendMessage(sender, { 
      text: '❌ Erreur lors de l\'exécution de la commande tagall.' 
    }, { quoted: msg });
  }
  break;
}


case 'deladmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'KAIDO-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN1" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Indiquez un JID/numéro à supprimer\nExemple : .deladmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'KAIDO-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Seul les admin peuvent supprimer.' }, { quoted: shonux });
  }

  try {
    await removeAdminFromMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'KAIDO-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN3" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅  admin Supprimé : ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('deladmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'KAIDO-MD MINI';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN4" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to remove admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}


            case 'tovn': {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted) {
        await socket.sendMessage(sender, { 
            text: `🎵 *Convert to Voice Note*\n\n❌ Réponds à un audio ou vidéo` 
        }, { quoted: msg });
        break;
    }
    
    const isAudio = quoted.audioMessage;
    const isVideo = quoted.videoMessage;
    
    if (!isAudio && !isVideo) {
        await socket.sendMessage(sender, { 
            text: `❌ Type non supporté. Réponds à un audio (🎵) ou vidéo (🎥)` 
        }, { quoted: msg });
        break;
    }

    await socket.sendMessage(sender, { 
        react: { text: "⏳", key: msg.key } 
    });

    try {
        // CORRECTION ICI : Bonne méthode pour télécharger
        let buffer;
        
        // Méthode 1: Utiliser downloadContentFromMessage (méthode Baileys officielle)
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        
        if (quoted.audioMessage) {
            const stream = await downloadContentFromMessage(quoted.audioMessage, 'audio');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            buffer = Buffer.concat(chunks);
            
        } else if (quoted.videoMessage) {
            const stream = await downloadContentFromMessage(quoted.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            buffer = Buffer.concat(chunks);
        }
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Buffer vide");
        }
        
        console.log(`[TOVN] Buffer obtenu: ${buffer.length} bytes`);
        
        // Fonction de conversion (gardée de ton code)
        async function convertToOpus(inputBuffer) {
            return new Promise((resolve, reject) => {
                const ffmpeg = require('fluent-ffmpeg');
                const { PassThrough } = require('stream');
                
                const inStream = new PassThrough();
                const outStream = new PassThrough();
                const chunks = [];

                inStream.end(inputBuffer);

                ffmpeg(inStream)
                    .noVideo()
                    .audioCodec("libopus")
                    .format("ogg")
                    .audioBitrate("48k")
                    .audioChannels(1)
                    .audioFrequency(48000)
                    .outputOptions([
                        "-map_metadata", "-1",
                        "-application", "voip",
                        "-compression_level", "10",
                        "-page_duration", "20000",
                    ])
                    .on("error", (err) => {
                        console.error("[TOVN] FFmpeg error:", err);
                        reject(err);
                    })
                    .on("end", () => {
                        const result = Buffer.concat(chunks);
                        console.log(`[TOVN] Conversion réussie: ${result.length} bytes`);
                        resolve(result);
                    })
                    .pipe(outStream, { end: true });

                outStream.on("data", (c) => chunks.push(c));
            });
        }
        
        // Convertir
        const opusBuffer = await convertToOpus(buffer);
        
        // Envoyer comme voice note
        await socket.sendMessage(sender, {
            audio: opusBuffer,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true,
            caption: "🔊 Voice Note"
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { 
            react: { text: "✅", key: msg.key } 
        });

    } catch (e) {
        console.error("[TOVN ERROR]:", e);
        await socket.sendMessage(sender, { 
            react: { text: "❌", key: msg.key } 
        });
        
        // Fallback: méthode simple sans conversion
        try {
            console.log("[TOVN] Essai méthode fallback...");
            
            if (quoted.audioMessage) {
                // Juste forwarder l'audio en PTT
                await socket.sendMessage(sender, quoted, { 
                    quoted: msg,
                    ptt: true // Force en voice note
                });
                
                await socket.sendMessage(sender, { 
                    react: { text: "🎵", key: msg.key } 
                });
            }
            
        } catch (fallbackError) {
            console.error("[TOVN FALLBACK ERROR]:", fallbackError);
            await socket.sendMessage(sender, { 
                text: `❌ Impossible de convertir: ${e.message}` 
            }, { quoted: msg });
        }
    }
    break;
}

           

case 'admins': {
  try {
    const list = await loadAdminsFromMongo();
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'KAIDO-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!list || list.length === 0) {
      return await socket.sendMessage(sender, { text: 'No admins configured.' }, { quoted: shonux });
    }

    let txt = '*👑Liste des Admins de la Db:*\n\n';
    for (const a of list) txt += `• ${a}\n`;

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('admins error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to list admins.' }, { quoted: shonux });
  }
  break;
}


case 'jid': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'KAIDO-MD MINI';
    const userNumber = sender.split('@')[0];

    // Reaction
    await socket.sendMessage(sender, { react: { text: "🆔", key: msg.key } });

    // Fake contact quoting for meta style
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_FAKE_ID" },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:KAIDO-MD\nTEL;type=CELL;type=VOICE;waid=${userNumber}:${userNumber}\nEND:VCARD`
        }
      }
    };

    // Texte principal
    const mainText = `*🆔 Chat JID:* ${sender}\n*📞 Your Number:* +${userNumber}`;

    // Construire le message interactif avec bouton "copy"
    const interactive = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: mainText },
            footer: { text: "> © KAIDO-MD" },
            header: { hasMediaAttachment: false, title: "Identifiant de chat" },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Copier JID",
                    id: "copy_jid",
                    copy_code: sender
                  })
                }
              ]
            }
          }
        }
      }
    };

    // Envoyer le message interactif (un seul envoi, quoted pour style)
    await socket.relayMessage(sender, interactive.viewOnceMessage.message, { messageId: `jid_${Date.now()}` });
    // Envoyer aussi en quoted pour conserver l'apparence "meta" (optionnel)
    await socket.sendMessage(sender, { text: mainText }, { quoted: shonux });

  } catch (e) {
    console.error('JID ERROR', e);
    try {
      await socket.sendMessage(sender, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
    } catch (err) { /* ignore */ }
  }
  break;
}
// use inside your switch(command) { ... } block

case 'setpath': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = primaryOwnerNumber();
  
  // Vérification des permissions
  if (!(isOwner || isSessionOwner)) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { 
      text: '❌ Permission refusée. Seul le propriétaire de la session ou du bot peut configurer le chemin de sauvegarde.' 
    }, { quoted: shonux });
    break;
  }

  const pathNumber = args[0]?.trim();
  if (!pathNumber) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { 
      text: '❗ Fournissez un numéro. Exemple : `.setpath 50912345678`' 
    }, { quoted: shonux });
  }

  // Nettoyer et valider le numéro
  const cleanPathNumber = pathNumber.replace(/[^0-9]/g, '');
  if (cleanPathNumber.length < 8) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { 
      text: '❌ Numéro invalide. Format attendu : 50912345678' 
    }, { quoted: shonux });
  }

  try {
    // Charger la configuration existante
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    
    // Ajouter le chemin de sauvegarde avec @s.whatsapp.net
    cfg.savePath = `${cleanPathNumber}@s.whatsapp.net`;
    cfg.savePathNumber = cleanPathNumber; // Garder aussi le numéro sans suffixe
    
    // Sauvegarder dans MongoDB
    await setUserConfigInMongo(sanitized, cfg);

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { 
      text: `✅ Chemin de sauvegarde configuré pour cette session : ${cleanPathNumber}\n\nLes médias sauvegardés seront envoyés à : ${cleanPathNumber}@s.whatsapp.net` 
    }, { quoted: shonux });
    
  } catch (e) {
    console.error('setpath error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH5" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { 
      text: `❌ Échec de la configuration du chemin : ${e.message || e}` 
    }, { quoted: shonux });
  }
  break;
}


case 'getpath': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETPATH" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (cfg.savePath) {
      await socket.sendMessage(sender, { 
        text: `📍 Configuration de sauvegarde :
        
📱 Numéro cible : ${cfg.savePathNumber}
🔗 JID complet : ${cfg.savePath}
📅 Configuré le : ${cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString('fr-FR') : 'Date inconnue'}
💾 Statut : ✅ Activé

Les commandes .save2 enverront les médias à cette destination.` 
      }, { quoted: shonux });
    } else {
      await socket.sendMessage(sender, { 
        text: `⚠️ Aucun chemin de sauvegarde configuré.
        
Utilisez la commande :
.setpath <numéro>

Exemple : .setpath 50912345678

Les médias sauvegardés seront envoyés à ce numéro.` 
      }, { quoted: shonux });
    }
    
  } catch (e) {
    console.error('getpath error', e);
    await socket.sendMessage(sender, { 
      text: '❌ Impossible de récupérer la configuration.' 
    }, { quoted: msg });
  }
  break;
}

case 'showconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `*Session config for ${sanitized}:*\n`;
    txt += `• Bot name: ${botName}\n`;
    txt += `• Logo: ${cfg.logo || config.RCD_IMAGE_PATH}\n`;
    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonux });
  }
  break;
}

case 'resetconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = primaryOwnerNumber();
  if (!(isOwner || isSessionOwner)) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can reset configs.' }, { quoted: shonux });
    break;
  }

  try {
    await setUserConfigInMongo(sanitized, {});

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '✅ Session config reset to defaults.' }, { quoted: shonux });
  } catch (e) {
    console.error('resetconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to reset config.' }, { quoted: shonux });
  }
  break;
}


        // default
        default:
          break;
      }
    } catch (err) {
      console.error('Command handler error:', err);
      try { await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('❌ ERROR', 'An error occurred while processing your command. Please try again.', BOT_NAME_FANCY) }); } catch(e){}
    }
    }, (error, { index, message, queueDelayMs, processingDurationMs } = {}) => {
      if (batchStats) {
        if (Number.isFinite(queueDelayMs)) {
          batchStats.lastQueueDelayMs = queueDelayMs;
          batchStats.maxQueueDelayMs = Math.max(batchStats.maxQueueDelayMs || 0, queueDelayMs);
        }
        if (Number.isFinite(processingDurationMs)) batchStats.lastProcessingDurationMs = processingDurationMs;
        batchStats.errors += 1;
        batchStats.lastErrorAt = Date.now();
        batchStats.lastError = String(error?.message || error).slice(0, 300);
      }
      console.error(
        `[SESSION ${number || 'inconnue'}] traitement messages.upsert #${index} (${message?.key?.id || 'sans id'}) :`,
        error?.stack || error
      );
    }, (_result, { queueDelayMs, processingDurationMs } = {}) => {
      if (!batchStats) return;
      batchStats.processed += 1;
      batchStats.lastProcessedAt = Date.now();
      if (Number.isFinite(queueDelayMs)) {
        batchStats.lastQueueDelayMs = queueDelayMs;
        batchStats.maxQueueDelayMs = Math.max(batchStats.maxQueueDelayMs || 0, queueDelayMs);
      }
      if (Number.isFinite(processingDurationMs)) batchStats.lastProcessingDurationMs = processingDurationMs;
    });
  });
}

// ---------------- message handlers ----------------

function setupMessageHandlers() {
  // Le socket reste unavailable au repos. setupReplyPresenceWrapper ne publie
  // une présence available que pendant un sendMessage, puis revient offline.
}

// ---------------- cleanup helper ----------------

/**
 * Démontage complet et idempotent d'une session.
 * Point d'entrée unique : les commandes `.deletesession`, l'API
 * `/api/session/delete` et le logout détecté passent tous par ici, pour que
 * l'état d'authentification, les clés MongoDB et le socket soient toujours
 * nettoyés ensemble.
 */
async function deleteSessionAndCleanup(number, socketInstance, { notifyOwner = true } = {}) {
  const sanitized = String(number).replace(/[^0-9]/g, '');
  if (!sanitized) return false;
  try {
    // 1) On retire la session des tables de runtime : plus aucune reconnexion
    //    ne pourra être programmée pour ce numéro.
    reconnectScheduler.cancel(sanitized);
    pairingGuard.release(sanitized);
    activeSockets.delete(sanitized);
    pairingSockets.delete(sanitized);
    socketCreationTime.delete(sanitized);
    lastConnectionActivity.delete(sanitized);
    messageProcessingStats.delete(sanitized);
    messageDispatchers.delete(sanitized);
    sessionConfigCache.delete(sanitized);
    sessionConfigRefreshAfter.delete(sanitized);
    sessionConfigRevision.set(sanitized, (sessionConfigRevision.get(sanitized) || 0) + 1);
    connectionLifecycles.delete(sanitized);
    socketRuntimeMetadata.delete(sanitized);
    deleteSessionStore(sanitized);
    statusLog.clear(sanitized);

    // 2) Socket : logout côté WhatsApp puis fermeture de la websocket. Le
    // marqueur est posé AVANT logout(), car celui-ci peut émettre close aussitôt.
    if (socketInstance) {
      intentionalSocketClosures.add(socketInstance);
      try {
        if (typeof socketInstance.logout === 'function') {
          await socketInstance.logout().catch(err => console.warn('logout error (ignored):', err?.message || err));
        }
      } catch (e) { console.warn('socket.logout failed:', e?.message || e); }
      try { socketInstance.ws?.close(); } catch (e) {}
    }

    // 3) On bloque les nouvelles écritures et on attend celles déjà parties.
    //    Il n'existe aucun dossier de session local.
    const auth = authStates.get(sanitized);
    authStates.delete(sanitized);
    if (auth) await auth.discard();

    // 4) Source de vérité unique : creds, clés Signal et numéro dans MongoDB.
    await Promise.all([
      authBackend.remove(sanitized),
      removeNumberFromMongo(sanitized)
    ]);

    if (notifyOwner) {
      try {
        const ownerJid = `${primaryOwnerNumber()}@s.whatsapp.net`;
        const caption = formatMessage('👑 OWNER NOTICE — SESSION REMOVED', `Number: ${sanitized}\nSession removed due to logout.\n\nActive sessions now: ${activeSockets.size}`, BOT_NAME_FANCY);
        if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
      } catch(e){}
    }
    console.log(`Cleanup completed for ${sanitized}`);
    return true;
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); return false; }
}

/**
 * Efface toutes les traces d'un appairage raté : runtime et MongoDB.
 *
 * Contrairement à `deleteSessionAndCleanup` (logout d'une session valide), on
 * ne notifie personne et on ne fait pas de logout WhatsApp : la session n'a
 * jamais été enregistrée côté serveur.
 */
async function purgeFailedSession(number, { socket = null, reason = 'appairage échoué' } = {}) {
  const sanitized = String(number).replace(/[^0-9]/g, '');
  if (!sanitized) return false;

  // 1) Runtime : verrou d'appairage, reconnexion en attente, sockets.
  pairingGuard.release(sanitized);
  reconnectScheduler.cancel(sanitized);
  pairingSockets.delete(sanitized);
  activeSockets.delete(sanitized);
  socketCreationTime.delete(sanitized);
  lastConnectionActivity.delete(sanitized);
  messageProcessingStats.delete(sanitized);
  messageDispatchers.delete(sanitized);
  sessionConfigCache.delete(sanitized);
  sessionConfigRefreshAfter.delete(sanitized);
  sessionConfigRevision.set(sanitized, (sessionConfigRevision.get(sanitized) || 0) + 1);
  connectionLifecycles.delete(sanitized);
  socketRuntimeMetadata.delete(sanitized);
  deleteSessionStore(sanitized);
  statusLog.clear(sanitized);

  if (socket) {
    intentionalSocketClosures.add(socket);
    try { socket.ws?.close(); } catch (e) {}
  }

  // 2) Persistant : état mémoire jeté, documents MongoDB effacés.
  const auth = authStates.get(sanitized) || null;
  authStates.delete(sanitized);
  const result = await sessionPurger.purge(sanitized, { auth, reason });

  const all = ['runtime', ...result.traces];
  if (result.ok) {
    console.warn(`[SESSION ${sanitized}] purge après ${reason} — traces effacées : ${all.join(', ')}`);
  } else {
    console.error(
      `[SESSION ${sanitized}] purge incomplète après ${reason} : ${result.errors.join(' ; ')}`
    );
  }
  return result.ok;
}

// ---------------- auto-restart ----------------

// UN SEUL ordonnanceur de reconnexion pour tout le processus.
// Avant, deux gestionnaires `connection.update` programmaient chacun leur
// reconnexion : deux sockets pouvaient tourner sur la même identité, chacun
// avançant son ratchet Signal de son côté. Les messages partaient alors dans le
// vide (réponse « en attente » chez l'utilisateur).
const reconnectScheduler = createReconnectScheduler({
  baseMs: SESSION_RECONNECT_BASE_MS,
  maxMs: SESSION_RECONNECT_MAX_MS,
  onReconnect: async (sanitized, context = {}) => {
    const { attempt = 0, immediate = false, reason, refreshVersion = false } = context;
    console.log(
      immediate
        ? `[SESSION ${sanitized}] redémarrage post-appairage immédiat (515)…`
        : `[SESSION ${sanitized}] reconnexion (tentative ${attempt})…`
    );
    const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
    await EmpirePair(sanitized, mockRes, {
      internalReconnect: true,
      reconnectReason: reason,
      forceVersionRefresh: refreshVersion
    });
  },
  onGiveUp: (sanitized) => {
    console.error(
      `[SESSION ${sanitized}] trop de tentatives de reconnexion échouées — abandon. ` +
      'Relance via le dashboard ou la commande de pairing.'
    );
  }
});

// Baileys envoie déjà une IQ ping-pong sur CHAQUE socket au rythme configuré
// dans makeWASocket. Ce watchdog vérifie le vrai getter `socket.ws.isOpen` de
// WebSocketClient (pas `readyState`, qui n’existe pas sur son wrapper) et ne
// recycle que les sockets durablement bloqués. Il réutilise le scheduler unique.
const sessionHealthWatcher = createSessionHealthWatcher({
  getSessions: () => activeSockets,
  intervalMs: SESSION_HEALTH_CHECK_INTERVAL_MS,
  staleAfterMs: SESSION_STALE_AFTER_MS,
  onStale: async (number, socket, health) => {
    if (shuttingDown || activeSockets.get(number) !== socket || getSocketOpenState(socket) !== false) return;
    console.error(
      `[SESSION ${number}] WebSocket toujours fermé après ${Math.round(health.unhealthyForMs / 1000)} s; reconnexion ciblée.`
    );
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try {
      forceCloseSessionSocket(socket, error => {
        console.warn(`[SESSION ${number}] fermeture watchdog :`, error?.message || error);
      });
    } catch (error) {
      console.warn(`[SESSION ${number}] fermeture watchdog :`, error?.message || error);
    }
    const scheduled = reconnectScheduler.schedule(number, {
      reason: 'watchdog keepalive : socket non ouvert'
    });
    if (!scheduled.scheduled && scheduled.reason === 'tentatives-epuisees') {
      console.error(`[SESSION ${number}] le watchdog ne peut plus programmer de reconnexion.`);
    }
  },
  onError: (error, number) => {
    console.error(`[SESSION ${number || 'watchdog'}] contrôle keepalive :`, error?.message || error);
  }
});
sessionHealthWatcher.start();

function setupAutoRestart(socket, number, auth) {
  const sanitized = String(number).replace(/[^0-9]/g, '');
  lastConnectionActivity.set(sanitized, Date.now());

  const lifecycle = createPairingLifecycle({
    number: sanitized,
    socket,
    auth,
    initiallyRegistered: Boolean(socket?.authState?.creds?.registered),
    isIntentionalClose: (candidate) => intentionalSocketClosures.has(candidate),
    onPairingAccepted: () => {
      // Le verrou externe et la référence au socket restent posés jusqu'au
      // close 515/open : ils empêchent un clic/API concurrent d'écraser les
      // creds et permettent à force=1 de fermer proprement ce socket. La
      // reconnexion interne possède, elle seule, le droit de traverser le verrou.
    },
    onReconnect: async (decision) => {
      if (activeSockets.get(sanitized) === socket) activeSockets.delete(sanitized);
      if (pairingSockets.get(sanitized) === socket) pairingSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);

      const planned = decision.immediate
        ? reconnectScheduler.scheduleImmediate(sanitized, decision)
        : reconnectScheduler.schedule(sanitized, decision);

      if (planned.scheduled) {
        console.log(
          decision.immediate
            ? `[SESSION ${sanitized}] pair-success confirmé; nouveau socket programmé immédiatement.`
            : `[SESSION ${sanitized}] ${decision.reason}; reconnexion dans ${planned.delayMs} ms (tentative ${planned.attempt}).`
        );
      } else if (planned.reason === 'deja-programmee') {
        console.log(`[SESSION ${sanitized}] une reconnexion est déjà programmée.`);
      }
    },
    onPairingFailure: async (decision) => {
      console.warn(`[SESSION ${sanitized}] ${decision.reason}; purge de cette tentative.`);
      await purgeFailedSession(sanitized, { socket, reason: decision.reason });
    },
    onSessionInvalid: async (decision) => {
      console.warn(`[SESSION ${sanitized}] ${decision.reason}; suppression de la session.`);
      await deleteSessionAndCleanup(sanitized, socket);
    },
    onConnectionReplaced: async (decision) => {
      if (activeSockets.get(sanitized) === socket) activeSockets.delete(sanitized);
      if (pairingSockets.get(sanitized) === socket) pairingSockets.delete(sanitized);
      pairingGuard.release(sanitized);
      socketCreationTime.delete(sanitized);
      console.warn(`[SESSION ${sanitized}] ${decision.reason}; creds MongoDB conservées, aucune boucle de reconnexion.`);
    },
    onDiagnostic: (entry) => {
      if (['pair-success', 'connection-closed', 'auth-flushed', 'auth-flush-failed'].includes(entry.phase)) {
        console.log(`[PAIRING ${sanitized}] ${entry.phase}`, {
          statusCode: entry.statusCode,
          action: entry.action,
          registered: entry.registered,
          elapsedMs: entry.elapsedMs
        });
      }
    },
    onError: (error) => {
      console.error(`[SESSION ${sanitized}] erreur du cycle de connexion :`, error?.message || error);
    }
  });

  connectionLifecycles.set(sanitized, lifecycle);
  socket.ev.on('connection.update', (update) => {
    lastConnectionActivity.set(sanitized, Date.now());
    void lifecycle.handleConnectionUpdate(update).catch((error) => {
      console.error(`[SESSION ${sanitized}] traitement connection.update :`, error?.message || error);
    });
  });
  return lifecycle;
}

// ---------------- EmpirePair (pairing, sessions MongoDB uniquement) ----------------

async function EmpirePair(number, res, options = {}) {
  // forceFresh : demande explicite d'un nouveau code (dashboard).
  // internalReconnect : redémarrage piloté par le cycle Baileys ; il doit
  // traverser le verrou encore posé entre pair-success et le close 515, et ne
  // doit jamais générer un nouveau code que personne ne recevrait.
  const {
    forceFresh = false,
    internalReconnect = false,
    forceVersionRefresh = false,
    reconnectReason = null
  } = options;
  const sanitizedNumber = String(number).replace(/[^0-9]/g, '');
  if (!sanitizedNumber) throw new Error('Numéro de session invalide');

  // --- Session déjà connectée : on ne touche à rien. ---
  if (activeSockets.has(sanitizedNumber)) {
    if (res && !res.headersSent) {
      res.send({
        status: 'already_connected',
        number: sanitizedNumber,
        message: 'Ce numéro est déjà connecté et actif.'
      });
    }
    return;
  }

  // --- Appairage déjà en cours. ---
  // Une reconnexion interne (notamment le 515 attendu) n'est pas une deuxième
  // demande de code et doit pouvoir franchir ce verrou.
  if (pairingGuard.isLocked(sanitizedNumber) && !forceFresh && !internalReconnect) {
    if (res && !res.headersSent) {
      res.send({
        status: 'appairage_en_cours',
        number: sanitizedNumber,
        message: 'Un code est déjà en attente pour ce numéro. Saisis-le sur ton téléphone, ou force un nouveau code.'
      });
    }
    return;
  }

  // Un nouveau code forcé repart de zéro dans MongoDB, qu'un verrou runtime
  // existe encore ou non. La purge est faite avant de reprendre le verrou.
  if (forceFresh) {
    const purged = await purgeFailedSession(sanitizedNumber, {
      socket: pairingSockets.get(sanitizedNumber) || null,
      reason: 'nouvelle demande de code (force)'
    });
    if (!purged) {
      if (res && !res.headersSent && typeof res.status === 'function') {
        res.status(503).send({
          error: 'mongodb_purge_failed',
          message: 'MongoDB n’a pas pu supprimer l’ancienne session. Aucun nouveau code n’a été créé.'
        });
      }
      return;
    }
  }

  if (!internalReconnect) pairingGuard.reacquire(sanitizedNumber);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

  try {
    await initMongo();
  } catch (err) {
    pairingGuard.release(sanitizedNumber);
    console.error(`[SESSION ${sanitizedNumber}] MongoDB indisponible :`, err.message || err);
    if (res && !res.headersSent && typeof res.status === 'function') {
      res.status(503).send({
        error: 'mongodb_indisponible',
        message: 'Connexion MongoDB obligatoire indisponible. Vérifie MONGO_URI puis réessaie.'
      });
    }
    return;
  }

  // Fermer et sauvegarder l'ancien état AVANT de relire MongoDB. Faire
  // l'inverse chargerait un instantané obsolète puis écraserait la base avec le
  // ratchet plus récent de l'ancien socket.
  const previousAuth = authStates.get(sanitizedNumber);
  if (previousAuth) {
    try {
      await previousAuth.close();
      authStates.delete(sanitizedNumber);
    } catch (err) {
      pairingGuard.release(sanitizedNumber);
      console.error(`[SESSION ${sanitizedNumber}] vidage MongoDB avant reconnexion :`, err?.message || err);
      if (res && !res.headersSent && typeof res.status === 'function') {
        res.status(503).send({
          error: 'mongodb_indisponible',
          message: 'Impossible de sauvegarder l’état précédent avant la reconnexion.'
        });
      }
      return;
    }
  }

  // MongoDB est l'unique source de vérité des creds et des clés Signal.
  let auth;
  try {
    auth = await createMongoAuthState(sanitizedNumber, {
      backend: authBackend,
      logger,
      initCreds: initAuthCreds
    });
  } catch (err) {
    if (err instanceof MongoAuthCorruptedError) {
      console.error(`[SESSION ${sanitizedNumber}] ${err.message}`);
      const purged = await purgeFailedSession(sanitizedNumber, { reason: 'creds MongoDB invalides' });
      if (res && !res.headersSent && typeof res.status === 'function') {
        res.status(purged ? 409 : 503).send({
          error: 'session_invalide',
          message: purged
            ? `${err.message} Les données invalides ont été supprimées ; relance l’appairage.`
            : `${err.message} La purge MongoDB a échoué.`
        });
      }
    } else {
      pairingGuard.release(sanitizedNumber);
      console.error(`[SESSION ${sanitizedNumber}] état MongoDB indisponible :`, err.message || err);
      if (res && !res.headersSent && typeof res.status === 'function') {
        res.status(503).send({
          error: 'mongodb_indisponible',
          message: err.message || String(err)
        });
      }
    }
    return;
  }
  const { state } = auth;
  authStates.set(sanitizedNumber, auth);
  let socket = null;

 try {
    const versionResolution = await baileysVersionResolver.resolve({ force: forceVersionRefresh });
    const waVersion = versionResolution.version;
    socketRuntimeMetadata.set(sanitizedNumber, {
      version: [...waVersion],
      versionSource: versionResolution.source,
      versionStale: versionResolution.stale,
      browser: [...WA_BROWSER],
      internalReconnect,
      reconnectReason,
      resolvedAt: Date.now()
    });
    console.log(
      `[SESSION ${sanitizedNumber}] WhatsApp Web ${formatWaVersion(waVersion)} ` +
      `(${versionResolution.source}), navigateur ${WA_BROWSER[1]} (${WA_BROWSER[0]}).`
    );
    if (versionResolution.stale) {
      console.warn(
        `[SESSION ${sanitizedNumber}] version live indisponible; fallback conservé : ` +
        `${versionResolution.warning || 'raison inconnue'}. ` +
        'Définis WA_WEB_VERSION si web.whatsapp.com/sw.js est bloqué.'
      );
    }

    // On ferme proprement un éventuel socket résiduel du même numéro AVANT d'en
    // ouvrir un nouveau. Deux connexions simultanées sur la même identité,
    // c'est la recette exacte de la désynchronisation des clés Signal.
    const leftover = activeSockets.get(sanitizedNumber);
    if (leftover) {
      intentionalSocketClosures.add(leftover);
      try { leftover.ws?.close(); } catch (e) {}
      activeSockets.delete(sanitizedNumber);
    }

    socket = makeWASocket({
      // mongo-auth-state possède déjà un cache mémoire write-through. Ajouter
      // le cache Baileys par-dessus validerait une clé avant l'acquittement DB.
      auth: { creds: state.creds, keys: state.keys },
      version: waVersion,
      printQRInTerminal: false,
      logger,
      keepAliveIntervalMs: SESSION_KEEPALIVE_INTERVAL_MS,
      markOnlineOnConnect: false,
      browser: WA_BROWSER
    });

    // Après avoir créé le socket et défini socketCreationTime

socketCreationTime.set(sanitizedNumber, Date.now());
socket.downloadMediaMessage = (m, filename) => downloadMediaMessage(m, filename)
// Branché immédiatement, avant requestPairingCode : le code d'appairage modifie
// les creds et aucune mise à jour ne doit se perdre avant MongoDB.
socket.ev.on('creds.update', () => {
  void auth.saveCreds().catch((error) => {
    console.error(`[AUTH ${sanitizedNumber}] sauvegarde MongoDB échouée :`, error?.message || error);
    try { socket.ws?.close(); } catch (_) {}
  });
});
// Branché avant tout await : il doit voir pair-success puis le close 515, même
// si l'initialisation d'un handler métier prend du temps.
const pairingLifecycle = setupAutoRestart(socket, sanitizedNumber, auth);
// Le handshake Baileys peut terminer pendant l'initialisation des handlers :
// on s'abonne tout de suite, puis la demande de code attend le premier stanza
// déchiffré (ou update.qr) sans imposer le parcours QR.
const pairingReadyResult = socket.authState.creds.registered
  ? null
  : waitForPairingReady(socket, { timeoutMs: PAIRING_READY_TIMEOUT_MS }).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error })
    );
// Les wrappers fonctionnels sont installés avant le garde-fou afin que
// safe-send vérifie l'état Baileys avant toute traduction ou autre travail.
await setupTranslationWrapper(socket, sanitizedNumber);
installSafeSend(socket);
// Le fake contact Meta AI habille toutes les sorties utilisateur; les vrais
// événements restent citables pour le menu décoré.
setupMetaAiFakeQuote(socket);
setupReplyPresenceWrapper(socket);
// ============================================================
setupStatusHandlers(socket, sanitizedNumber);
setupCommandHandlers(socket, sanitizedNumber);
setupMessageHandlers(socket);
setupNewsletterHandlers(socket, sanitizedNumber);
registerGroupParticipantListener(socket).catch(err => console.error('Listener init failed', err));
handleMessageRevocation(socket, sanitizedNumber);
    if (!socket.authState.creds.registered) {
      // Une reconnexion automatique ne doit JAMAIS remplacer le code encore
      // affiché par un code secret envoyé à un mock HTTP. Pour le 515, arriver
      // ici signale que les creds pair-success n'ont pas été restaurées.
      if (internalReconnect) {
        const purged = await purgeFailedSession(sanitizedNumber, {
          socket,
          reason: `reconnexion interne sans creds enregistrées${reconnectReason ? ` (${reconnectReason})` : ''}`
        });
        console.error(
          `[SESSION ${sanitizedNumber}] reconnexion interne interrompue : creds non enregistrées; ` +
          `purge ${purged ? 'réussie' : 'incomplète'}.`
        );
        return;
      }

      // Socket d'appairage : il n'est PAS encore une session connectée, il va
      // dans `pairingSockets` et surtout pas dans `activeSockets`.
      pairingSockets.set(sanitizedNumber, socket);

      let code = null;
      let lastError = null;
      try {
        // Une seule demande par socket. Réessayer automatiquement ici peut
        // écraser creds.pairingCode alors que le téléphone traite encore la
        // première réponse (voir le cycle delayed primary_hello de Baileys).
        code = await issuePairingCode({
          socket,
          number: sanitizedNumber,
          auth,
          readiness: pairingReadyResult,
          onReady: () => pairingLifecycle.markPairingReady(),
          onRequest: () => pairingLifecycle.markCodeRequested(),
          onIssued: () => pairingLifecycle.markCodeIssued()
        });
      } catch (error) {
        lastError = error;
        console.warn(
          `[SESSION ${sanitizedNumber}] demande unique de code échouée :`,
          error?.message || error
        );
      }

      if (code) {
        // L'utilisateur a maintenant le temps de saisir le code sur son téléphone.
        pairingGuard.refresh(sanitizedNumber);
        if (!res.headersSent) {
          res.send({ status: 'code_genere', code, pairingCode: code, number: sanitizedNumber });
        }
      } else {
        // Échec définitif : on efface le runtime et les documents MongoDB pour
        // que la prochaine demande reparte réellement de zéro.
        const purged = await purgeFailedSession(
          sanitizedNumber,
          { socket, reason: 'génération du code impossible' }
        );
        if (res && !res.headersSent && typeof res.status === 'function') {
          res.status(purged ? 502 : 503).send({
            error: purged ? 'code_indisponible' : 'mongodb_purge_failed',
            message: purged
              ? `Impossible de générer le code pour ${sanitizedNumber}. La tentative a été supprimée de MongoDB : tu peux réessayer immédiatement.`
              : `Impossible de générer le code pour ${sanitizedNumber}, puis de purger la tentative dans MongoDB. Vérifie la base avant de réessayer.`,
            detail: lastError?.message || String(lastError || 'raison inconnue')
          });
        }
        return;
      }
    } else {
      // Session déjà enregistrée (reconnexion interne, pas une demande de code).
      // Il faut quand même répondre : sinon la requête HTTP reste suspendue.
      if (res && !res.headersSent) {
        res.send({
          status: 'session_existante',
          number: sanitizedNumber,
          message: 'Session déjà enregistrée : reconnexion en cours, aucun nouveau code nécessaire.'
        });
      }
    }

    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        // L'appairage a abouti : le socket passe de « en attente de code » à
        // « session connectée », et le verrou d'appairage est relâché.
        if (pairingSockets.get(sanitizedNumber) === socket) pairingSockets.delete(sanitizedNumber);
        pairingGuard.release(sanitizedNumber);
        reconnectScheduler.reset(sanitizedNumber);
        lastConnectionActivity.set(sanitizedNumber, Date.now());
        // `connection=open` est la frontière réelle d'activité. Publier le
        // socket avant les notifications/join non critiques évite qu'un close
        // pendant ces tâches soit ensuite écrasé par un ancien socket.
        activeSockets.set(sanitizedNumber, socket);
        try {
          // Rendre la session restaurable avant les notifications, délais ou
          // autres fonctionnalités non critiques du handler d'ouverture.
          await auth.saveCreds();
          await addNumberToMongo(sanitizedNumber);

          await applyAlwaysOnlineSetting(socket, false);
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed', error: 'joinGroup not configured' }));

          // try follow newsletters if configured
          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch(e){}
            }
          } catch(e){}

          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          // Load per-session config (botName, logo)
          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          const initialCaption = formatMessage(useBotName,
  `✅ Connexion établie avec succès !

🔢 Numéro : ${sanitizedNumber}
🕒 Connexion : Le bot sera actif dans quelques secondes`,
  useBotName
);

          // send initial message
          let sentMsg = null;
          try {
            if (String(useLogo).startsWith('http')) {
              sentMsg = await socket.sendMessage(userJid, { image: { url: useLogo }, caption: initialCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                sentMsg = await socket.sendMessage(userJid, { image: buf, caption: initialCaption });
              } catch (e) {
                sentMsg = await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: initialCaption });
              }
            }
          } catch (e) {
            console.warn('Failed to send initial connect message (image). Falling back to text.', e?.message || e);
            try { sentMsg = await socket.sendMessage(userJid, { text: initialCaption }); } catch(e){}
          }

          await delay(4000);

          const updatedCaption = formatMessage(useBotName,
  `✅ KAIDO-MD activé avec succès

🔢 Numéro : ${sanitizedNumber}
🕒 Connecté : ${getHaitiTimestamp()}

Le bot est maintenant connecté et fonctionnel.`,
  useBotName
);

          try {
            if (sentMsg && sentMsg.key) {
              try {
                await socket.sendMessage(userJid, { delete: sentMsg.key });
              } catch (delErr) {
                console.warn('Could not delete original connect message (not fatal):', delErr?.message || delErr);
              }
            }

            try {
              if (String(useLogo).startsWith('http')) {
                await socket.sendMessage(userJid, { image: { url: useLogo }, caption: updatedCaption });
              } else {
                try {
                  const buf = fs.readFileSync(useLogo);
                  await socket.sendMessage(userJid, { image: buf, caption: updatedCaption });
                } catch (e) {
                  await socket.sendMessage(userJid, { text: updatedCaption });
                }
              }
            } catch (imgErr) {
              await socket.sendMessage(userJid, { text: updatedCaption });
            }
          } catch (e) {
            console.error('Failed during connect-message edit sequence:', e);
          }

          await applyAlwaysOnlineSetting(socket, false);

        } catch (e) {
          // Ne JAMAIS redémarrer tout le processus ici : ça tuerait toutes les
          // autres sessions en pleine écriture de clés. On reconnecte seulement
          // la session concernée.
          console.error('Connection open error:', e);
          try { socket.ws?.close(); } catch (closeErr) {}
        }
      }
    });


    // Une session déjà enregistrée (reconnexion) est active tout de suite.
    // Un appairage neuf, lui, n'est PAS encore une session : le mettre dans
    // `activeSockets` faisait croire au bot que le numéro était pris, et la
    // demande suivante répondait sans code → « Indisponible ».
    if (socket.authState?.creds?.registered) {
      activeSockets.set(sanitizedNumber, socket);
    }

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (socket) intentionalSocketClosures.add(socket);
    try { socket?.ws?.close(); } catch (_) {}

    const registered = Boolean(auth?.state?.creds?.registered);
    let purged = false;
    if (registered) {
      // Une erreur de socket ou de handler ne doit jamais détruire une session
      // déjà valide. MongoDB reste intact pour la prochaine reconnexion.
      pairingGuard.release(sanitizedNumber);
      authStates.delete(sanitizedNumber);
      try { await auth.close(); } catch (_) {}
    } else {
      purged = await purgeFailedSession(sanitizedNumber, {
        socket: pairingSockets.get(sanitizedNumber) || socket,
        reason: `erreur d'appairage (${error?.message || error})`
      });
    }

    if (res && !res.headersSent && typeof res.status === 'function') {
      res.status(503).send({
        error: registered ? 'reconnexion_echouee' : 'appairage_echoue',
        message: registered
          ? `La reconnexion de ${sanitizedNumber} a échoué, mais sa session MongoDB a été conservée.`
          : purged
            ? `L'appairage a échoué pour ${sanitizedNumber}. La tentative MongoDB a été supprimée : tu peux réessayer.`
            : `L'appairage a échoué pour ${sanitizedNumber} et la purge MongoDB est incomplète.`,
        detail: error?.message || String(error || 'raison inconnue')
      });
    }
  }

}


// ---------------- endpoints (admin/newsletter management + others) ----------------

router.post('/newsletter/add', async (req, res) => {
  const jid = normaliseNewsletterJid(req.body?.jid);
  const emojis = normaliseEmojiList(req.body?.emojis);
  if (!jid) return res.status(400).send({ error: 'JID de chaîne invalide' });
  try {
    const saved = await addNewsletterToMongo(jid, emojis);
    const synchronization = await syncNewsletterSockets(activeSockets, jid, 'follow');
    res.status(200).send({
      status: 'ok',
      ...saved,
      synchronized: synchronization.filter(result => result.ok).length,
      failures: synchronization.filter(result => !result.ok && !result.skipped)
    });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/newsletter/remove', async (req, res) => {
  const jid = normaliseNewsletterJid(req.body?.jid);
  if (!jid) return res.status(400).send({ error: 'JID de chaîne invalide' });
  try {
    await removeNewsletterFromMongo(jid);
    const synchronization = await syncNewsletterSockets(activeSockets, jid, 'unfollow');
    res.status(200).send({
      status: 'ok',
      jid,
      synchronized: synchronization.filter(result => result.ok).length
    });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/newsletter/list', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.status(200).send({ status: 'ok', channels: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// admin endpoints

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    const normalizedJid = await addAdminToMongo(jid);
    res.status(200).send({ status: 'ok', jid: normalizedJid });
  } catch (e) { res.status(400).send({ error: e.message || e }); }
});


router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeAdminFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).send({ status: 'ok', admins: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// existing endpoints (connect, reconnect, active, etc.)

/** `force` = l'utilisateur veut un nouveau code tout de suite. */
function wantsFreshPairing(req) {
  const raw = String(req.query?.force ?? req.body?.force ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'oui' || raw === 'yes';
}

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) {
    return res.sendFile(path.join(__dirname, '..', '..', 'dashboard', 'pages', 'main.html'));
  }
  const sanitized = number.replace(/[^0-9]/g, '');
  if (activeSockets.has(sanitized)) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(sanitized, res, { forceFresh: wantsFreshPairing(req), source: 'dashboard' });
});

router.options('/code', (req, res) => {
  applyPairingCors(req, res);
  return res.sendStatus(204);
});

router.get('/code', (req, res, next) => {
  applyPairingCors(req, res);
  next();
}, async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  const sanitized = number.replace(/[^0-9]/g, '');
  if (activeSockets.has(sanitized)) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(sanitized, res, { forceFresh: wantsFreshPairing(req), source: 'dashboard' });
});

router.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'dashboard', 'pages', 'pair.html'));
});

router.get('/delete', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'dashboard', 'pages', 'delete.html'));
});

router.get('/api/session/config', async (req, res) => {
  try {
    const { number } = req.query;
    if (!number) return res.status(400).json({ ok: false, error: 'Number required' });
    const sanitized = String(number).replace(/[^0-9]/g, '');
    const configDoc = await loadSessionConfigMerged(sanitized);
    res.json({ ok: true, config: configDoc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getHaitiTimestamp() });
});


router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: 'KAIDO-MD', activesession: activeSockets.size });
});


async function launchSessionsWithConcurrency(numbers, reconnectReason, { skipLocked = false } = {}) {
  const { mapWithConcurrency } = require('../services/session-startup');
  const concurrency = getSessionStartupConcurrency();
  const uniqueNumbers = [...new Set((numbers || [])
    .map(number => String(number).replace(/[^0-9]/g, ''))
    .filter(Boolean))];
  const outcomes = await mapWithConcurrency(uniqueNumbers, concurrency, async number => {
    if (activeSockets.has(number)) return { number, status: 'already_connected' };
    if (skipLocked && pairingGuard.isLocked(number)) return { number, status: 'already_starting' };
    const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
    await EmpirePair(number, mockRes, { internalReconnect: true, reconnectReason });
    return { number, status: 'connection_initiated' };
  });
  return outcomes.map((outcome, index) => outcome.status === 'fulfilled'
    ? outcome.value
    : {
        number: uniqueNumbers[index],
        status: 'failed',
        error: outcome.reason?.message || String(outcome.reason || 'Erreur inconnue')
      });
}

function getSessionStartupConcurrency() {
  const { resolveSessionStartupConcurrency } = require('../services/session-startup');
  return resolveSessionStartupConcurrency(process.env.SESSION_STARTUP_CONCURRENCY);
}

router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = await launchSessionsWithConcurrency(numbers, 'connect-all');
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});


router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = await launchSessionsWithConcurrency(numbers, 'api-reconnect');
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});


router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});


router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});


router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) return res.status(400).send({ error: 'Number and target number are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const statusData = await socket.fetchStatus(targetJid);
    const aboutStatus = statusData.status || 'No status available';
    const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
    res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
  } catch (error) { console.error(`Failed to fetch status for ${target}:`, error); res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}.` }); }
});


// ---------------- Dashboard endpoints & static ----------------

const dashboardStaticDir = path.join(__dirname, '..', '..', 'dashboard', 'static');
if (!fs.existsSync(dashboardStaticDir)) fs.ensureDirSync(dashboardStaticDir);
router.use('/dashboard/static', express.static(dashboardStaticDir));
router.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(dashboardStaticDir, 'index.html'));
});


// API: sessions & active & delete

router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/active', async (req, res) => {
  try {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

/**
 * Diagnostic des sessions : source auth, clés Signal, websocket, messages reçus
 * et traités, erreurs du handler et statistiques d'envoi. C'est l'endroit où
 * localiser un cas où le téléphone affiche le compte connecté sans réponse du bot.
 */
router.get('/api/session/health', async (req, res) => {
  try {
    const sessions = [];
    for (const [number, socket] of activeSockets) {
      const auth = authStates.get(number);
      sessions.push({
        number,
        websocketOuverte: getSocketOpenState(socket) === true,
        enregistre: Boolean(socket?.authState?.creds?.registered),
        sourceAuth: auth ? auth.source : null,
        clesSignal: auth ? auth.keyCount() : null,
        ecrituresEnAttente: auth ? auth.pendingWrites() : null,
        envois: typeof getSendStats === 'function' ? getSendStats(socket) : null,
        traitementMessages: { ...getMessageProcessingStats(number) },
        fileTraitement: messageDispatchers.get(number)?.getStats() || null,
        derniereActivite: lastConnectionActivity.get(number) || null,
        runtimeBaileys: socketRuntimeMetadata.get(number) || null,
        cycleConnexion: connectionLifecycles.get(number)?.snapshot?.() || null
      });
    }
    const appairages = Array.from(pairingSockets.keys()).map((number) => ({
      number,
      runtimeBaileys: socketRuntimeMetadata.get(number) || null,
      cycleConnexion: connectionLifecycles.get(number)?.snapshot?.() || null
    }));
    res.json({
      ok: true,
      stockageSessions: 'mongodb',
      mongodbConnecte: mongoConnection.isConnected(),
      boucleEvenement: readEventLoopDelayStats(),
      versionWhatsAppWeb: baileysVersionResolver.snapshot(),
      appairages,
      sessions
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    // Même chemin de démontage que les commandes WhatsApp : socket, creds et
    // clés Signal dans MongoDB, sans dossier local.
    const running = activeSockets.get(sanitized) || null;
    const removed = await deleteSessionAndCleanup(sanitized, running, { notifyOwner: false });
    if (!removed) {
      return res.status(503).json({ ok: false, error: `MongoDB n’a pas supprimé la session ${sanitized}` });
    }
    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('API /api/session/delete error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/newsletters', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});
router.get('/api/admins', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


// ---------------- cleanup + process events ----------------

/** Fermeture propre des sockets ; les sessions restent dans MongoDB. */
process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
  });
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  sessionHealthWatcher.stop();
  githubAutoUpdater.stop();
  console.log(`[SHUTDOWN] ${signal} — vidage des écritures MongoDB…`);
  const socketsToClose = new Set([...activeSockets.values(), ...pairingSockets.values()]);
  socketsToClose.forEach((socket) => {
    intentionalSocketClosures.add(socket);
    try { socket.ws?.close(); } catch (e) {}
  });
  await Promise.allSettled(
    Array.from(authStates.values()).map((auth) => auth.close())
  );
  await mongoConnection.close().catch((error) => {
    console.error('[SHUTDOWN] fermeture MongoDB :', error?.message || error);
  });
  console.log('[SHUTDOWN] sessions MongoDB synchronisées.');
  process.exit(0);
}
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });


process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // On sauvegarde les sessions avant de redémarrer, sinon le ratchet Signal
  // repart désynchronisé au prochain boot.
  void gracefulShutdown('uncaughtException');
});


// Initialisation MongoDB et restauration des seules sessions présentes en base.
async function restoreSessionsOnBoot() {
  const numbers = new Set(
    (await getAllNumbersFromMongo())
      .map((number) => String(number).replace(/[^0-9]/g, ''))
      .filter(Boolean)
  );

  console.log(
    `[BOOT] ${numbers.size} session(s) MongoDB à restaurer avec ${getSessionStartupConcurrency()} démarrage(s) parallèle(s).`
  );
  const results = await launchSessionsWithConcurrency([...numbers], 'boot', { skipLocked: true });
  const started = results.filter(result => result.status === 'connection_initiated').length;
  const failed = results.filter(result => result.status === 'failed');
  console.log(`[BOOT] ${started} démarrage(s) lancé(s), ${results.length - started - failed.length} déjà actif(s/en attente), ${failed.length} échec(s).`);
  for (const result of failed) {
    console.error(`[BOOT] ${result.number}:`, result.error);
  }
}

async function bootstrapMongoSessions() {
  try {
    await initMongo();
    // Réchauffe les contrôles consultés à chaque commande avant l'ouverture des
    // sockets, afin qu'une première réponse ne dépende pas d'une lecture Mongo.
    await loadAdminsFromMongo().catch(error => {
      console.warn('[BOOT] cache des administrateurs indisponible :', error?.message || error);
    });
    await restoreRestartSchedule();
    await restoreSessionsOnBoot();
    githubAutoUpdater.start();
  } catch (error) {
    // Le serveur HTTP reste joignable pour afficher le diagnostic, mais aucun
    // socket WhatsApp ne démarre sans la source de vérité MongoDB.
    console.error('[BOOT] MongoDB obligatoire indisponible :', error?.message || error);
  }
}

void bootstrapMongoSessions();

module.exports = router;
