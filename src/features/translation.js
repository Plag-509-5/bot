'use strict';

const COLLECTION_NAME = 'session_languages';
const DEFAULT_LANGUAGE = 'fr';
const DEFAULT_LANGUAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LANGUAGE_ERROR_TTL_MS = 30 * 1000;
const DEFAULT_LANGUAGE_LOOKUP_TIMEOUT_MS = 1_500;
const DEFAULT_TRANSLATION_TIMEOUT_MS = 500;
const MAX_CONCURRENT_TRANSLATIONS = 8;
const LANGUAGE_CACHE_MAX_ENTRIES = 500;
const TRANSLATION_WRAPPER_MARK = Symbol.for('kaido.translationWrapper');

let initMongoProvider = null;
let getDbProvider = null;
let languageLookupTimeoutMs = DEFAULT_LANGUAGE_LOOKUP_TIMEOUT_MS;
const languageCache = new Map();
const languageLoads = new Map();
let activeTranslations = 0;

function normaliseSessionId(sessionId) {
  return String(sessionId || '').replace(/[^0-9]/g, '');
}

function normaliseLanguage(langCode) {
  const language = String(langCode || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(language) ? language : DEFAULT_LANGUAGE;
}

function assertLanguage(langCode) {
  const language = String(langCode || '').trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(language)) {
    throw new TypeError('Le code langue doit contenir deux lettres ISO.');
  }
  return language;
}

function rememberLanguage(sessionId, language, ttlMs = DEFAULT_LANGUAGE_CACHE_TTL_MS) {
  if (!sessionId) return;
  languageCache.delete(sessionId);
  languageCache.set(sessionId, {
    language: normaliseLanguage(language),
    expiresAt: Date.now() + Math.max(0, ttlMs)
  });
  while (languageCache.size > LANGUAGE_CACHE_MAX_ENTRIES) {
    languageCache.delete(languageCache.keys().next().value);
  }
}

function getCachedLanguage(sessionId) {
  const entry = languageCache.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    languageCache.delete(sessionId);
    return null;
  }
  languageCache.delete(sessionId);
  languageCache.set(sessionId, entry);
  return entry.language;
}

function withTimeout(promise, timeoutMs, fallback) {
  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };

    timer = setTimeout(() => finish(fallback), Math.max(0, timeoutMs));
    Promise.resolve(promise).then(finish, () => finish(fallback));
  });
}

async function translationCollection() {
  if (!initMongoProvider || !getDbProvider) {
    throw new Error('Stockage de traduction MongoDB non configuré');
  }
  await initMongoProvider();
  const db = getDbProvider();
  if (!db) throw new Error('MongoDB indisponible pour les langues de session');
  return db.collection(COLLECTION_NAME);
}

async function readSessionLanguage(sessionId) {
  const collection = await translationCollection();
  const doc = await collection.findOne({ sessionId: String(sessionId) });
  return normaliseLanguage(doc?.lang);
}

/**
 * Charge la langue en arrière-plan. Une panne ou une requête Mongo lente ne
 * doit jamais retarder l'envoi d'une réponse WhatsApp.
 */
function primeSessionLanguage(sessionId, timeoutMs = languageLookupTimeoutMs) {
  const key = normaliseSessionId(sessionId);
  if (!key) return Promise.resolve(DEFAULT_LANGUAGE);

  const cached = getCachedLanguage(key);
  if (cached) return Promise.resolve(cached);
  const pending = languageLoads.get(key);
  if (pending) return pending.promise;

  const token = Symbol(key);
  const promise = withTimeout(readSessionLanguage(key), timeoutMs, null)
    .then(language => {
      const loaded = language || DEFAULT_LANGUAGE;
      if (languageLoads.get(key)?.token === token) {
        rememberLanguage(key, loaded, language ? DEFAULT_LANGUAGE_CACHE_TTL_MS : DEFAULT_LANGUAGE_ERROR_TTL_MS);
      }
      return loaded;
    })
    .catch(() => {
      if (languageLoads.get(key)?.token === token) {
        rememberLanguage(key, DEFAULT_LANGUAGE, DEFAULT_LANGUAGE_ERROR_TTL_MS);
      }
      return DEFAULT_LANGUAGE;
    })
    .finally(() => {
      if (languageLoads.get(key)?.token === token) languageLoads.delete(key);
    });

  languageLoads.set(key, { token, promise });
  return promise;
}

/**
 * Resolve instantanément depuis le cache; sinon lance une lecture Mongo limitée
 * dans le temps et renvoie le français par défaut pour cette réponse.
 */
async function getSessionLanguage(sessionId) {
  const key = normaliseSessionId(sessionId);
  if (!key) return DEFAULT_LANGUAGE;
  const cached = getCachedLanguage(key);
  if (cached) return cached;
  void primeSessionLanguage(key);
  return DEFAULT_LANGUAGE;
}

/** Sauvegarde la langue d'une session dans le MongoDB central. */
async function saveSessionLanguage(sessionId, langCode) {
  const key = normaliseSessionId(sessionId);
  if (!key) throw new Error('Numéro de session invalide');
  const language = assertLanguage(langCode);
  const collection = await translationCollection();
  await collection.updateOne(
    { sessionId: key },
    { $set: { lang: language, updatedAt: new Date() } },
    { upsert: true }
  );

  // Une lecture Mongo démarrée avant la commande ne doit pas écraser son choix.
  languageLoads.delete(key);
  rememberLanguage(key, language);
  return true;
}

function resolveTranslateFunction(override) {
  if (typeof override === 'function') return override;
  try {
    const provider = require('@vitalets/google-translate-api');
    return provider.translate || provider.default?.translate || provider.default || null;
  } catch (_) {
    return null;
  }
}

async function translateContent(content, targetLanguage, translateFn, timeoutMs) {
  if (!content || typeof content !== 'object') return content;
  const fields = ['text', 'caption'].filter(field => (
    typeof content[field] === 'string' && content[field].trim()
  ));
  if (!fields.length) return content;

  const translate = resolveTranslateFunction(translateFn);
  if (typeof translate !== 'function') return content;

  const translated = { ...content };
  await Promise.all(fields.map(async field => {
    if (activeTranslations >= MAX_CONCURRENT_TRANSLATIONS) return;
    activeTranslations += 1;
    const pending = Promise.resolve()
      .then(() => translate(content[field], {
        to: targetLanguage,
        autoCorrect: true
      }))
      .finally(() => {
        activeTranslations = Math.max(0, activeTranslations - 1);
      });
    const result = await withTimeout(pending, timeoutMs, null);
    if (typeof result?.text === 'string' && result.text.trim()) translated[field] = result.text;
  }));
  return translated;
}

/**
 * Injecte la traduction automatique sans mettre la réponse en dépendance de
 * MongoDB ou de Google Translate. Langue inconnue = envoi immédiat du texte
 * d'origine; une traduction lente/indisponible retombe aussi sur l'original.
 */
function setupTranslationWrapper(socket, number, options = {}) {
  if (!socket || typeof socket.sendMessage !== 'function' || socket[TRANSLATION_WRAPPER_MARK]) return;

  const originalSendMessage = socket.sendMessage.bind(socket);
  const sessionId = normaliseSessionId(number || socket.user?.id?.split(':')[0]);
  const lookupTimeoutMs = Number.isFinite(options.languageLookupTimeoutMs)
    ? Math.max(0, options.languageLookupTimeoutMs)
    : languageLookupTimeoutMs;
  const translationTimeoutMs = Number.isFinite(options.translationTimeoutMs)
    ? Math.max(0, options.translationTimeoutMs)
    : DEFAULT_TRANSLATION_TIMEOUT_MS;
  const translateFn = options.translate;

  if (sessionId) void primeSessionLanguage(sessionId, lookupTimeoutMs);

  socket.sendMessage = async (jid, content, sendOptions = {}) => {
    if (!sessionId) return originalSendMessage(jid, content, sendOptions);

    let targetLanguage = getCachedLanguage(sessionId);
    if (!targetLanguage) {
      void primeSessionLanguage(sessionId, lookupTimeoutMs);
      targetLanguage = DEFAULT_LANGUAGE;
    }
    if (targetLanguage === DEFAULT_LANGUAGE) {
      return originalSendMessage(jid, content, sendOptions);
    }

    const translatedContent = await translateContent(
      content,
      targetLanguage,
      translateFn,
      translationTimeoutMs
    );
    return originalSendMessage(jid, translatedContent, sendOptions);
  };

  Object.defineProperty(socket, TRANSLATION_WRAPPER_MARK, { value: true, enumerable: false });
}

function configureTranslationStorage({ initMongo, getDb, languageLookupTimeoutMs: timeoutMs } = {}) {
  initMongoProvider = typeof initMongo === 'function' ? initMongo : null;
  getDbProvider = typeof getDb === 'function' ? getDb : null;
  if (Number.isFinite(timeoutMs)) {
    languageLookupTimeoutMs = Math.max(0, timeoutMs);
  }
}

module.exports = {
  COLLECTION_NAME,
  DEFAULT_LANGUAGE,
  DEFAULT_LANGUAGE_CACHE_TTL_MS,
  DEFAULT_LANGUAGE_LOOKUP_TIMEOUT_MS,
  DEFAULT_TRANSLATION_TIMEOUT_MS,
  MAX_CONCURRENT_TRANSLATIONS,
  configureTranslationStorage,
  saveSessionLanguage,
  getSessionLanguage,
  setupTranslationWrapper,
  _test: {
    clearCache() {
      languageCache.clear();
      languageLoads.clear();
    },
    cacheLanguage: rememberLanguage,
    getCachedLanguage
  }
};
