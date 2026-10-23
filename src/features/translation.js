'use strict';

const fs = require('node:fs');
const path = require('node:path');

const COLLECTION_NAME = 'session_languages';
const DEFAULT_LANGUAGE = 'fr';
const SUPPORTED_LANGUAGES = Object.freeze(['fr', 'en', 'es', 'ht']);
const DEFAULT_LANGUAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LANGUAGE_ERROR_TTL_MS = 30 * 1000;
const DEFAULT_LANGUAGE_LOOKUP_TIMEOUT_MS = 1_500;
const LANGUAGE_CACHE_MAX_ENTRIES = 500;
const TRANSLATION_WRAPPER_MARK = Symbol.for('kaido.translationWrapper');
const SKIP_FORMATTING_OPTION = '__kaidoSkipLocalFormatting';
const LOCALE_DIR = path.join(__dirname, '../locales');

let initMongoProvider = null;
let getDbProvider = null;
let languageLookupTimeoutMs = DEFAULT_LANGUAGE_LOOKUP_TIMEOUT_MS;
const languageCache = new Map();
const languageLoads = new Map();
const localeCache = new Map();
let styleSequence = 0;

function normaliseSessionId(sessionId) {
  return String(sessionId || '').replace(/[^0-9]/g, '');
}

function normaliseLanguage(langCode) {
  const language = String(langCode || '').trim().toLowerCase();
  return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

function assertLanguage(langCode) {
  const language = String(langCode || '').trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new TypeError(`Langue indisponible. Choisis : ${SUPPORTED_LANGUAGES.join(', ')}.`);
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
    throw new Error('Stockage de langue MongoDB non configuré');
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

async function getSessionLanguage(sessionId) {
  const key = normaliseSessionId(sessionId);
  if (!key) return DEFAULT_LANGUAGE;
  const cached = getCachedLanguage(key);
  if (cached) return cached;
  void primeSessionLanguage(key);
  return DEFAULT_LANGUAGE;
}

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
  languageLoads.delete(key);
  rememberLanguage(key, language);
  return true;
}

function loadLocale(language) {
  const lang = normaliseLanguage(language);
  if (localeCache.has(lang)) return localeCache.get(lang);
  let catalog = {};
  try {
    catalog = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${lang}.json`), 'utf8'));
  } catch (error) {
    console.warn(`[LANG] Catalogue local ${lang} indisponible :`, error?.message || error);
  }
  const responseMap = catalog && typeof catalog.responses === 'object' ? catalog.responses : {};
  localeCache.set(lang, responseMap);
  return responseMap;
}

function translateStaticText(value, language) {
  const input = String(value || '');
  const lang = normaliseLanguage(language);
  if (!input || lang === DEFAULT_LANGUAGE) return input;
  const translations = loadLocale(lang);
  const phrases = Object.entries(translations)
    .filter(([source, target]) => source && typeof target === 'string' && source !== target)
    .sort((a, b) => b[0].length - a[0].length);
  let output = input;
  for (const [source, target] of phrases) output = output.split(source).join(target);
  return output;
}

const SMALL_CAPS = Object.freeze({
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
  s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
});
const FONT_STYLES = Object.freeze(['sans-bold', 'small-caps', 'serif-bold', 'typewriter']);

function mapStyledCharacter(character, style) {
  const code = character.codePointAt(0);
  const upper = code >= 65 && code <= 90;
  const lower = code >= 97 && code <= 122;
  const digit = code >= 48 && code <= 57;
  if (!upper && !lower && !digit) return character;
  if (style === 'small-caps') {
    return lower ? (SMALL_CAPS[character] || character) : character;
  }
  const base = style === 'sans-bold'
    ? { upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC }
    : style === 'serif-bold'
      ? { upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE }
      : { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 };
  const offset = upper ? code - 65 : lower ? code - 97 : code - 48;
  return String.fromCodePoint((upper ? base.upper : lower ? base.lower : base.digit) + offset);
}

function styleStaticText(value, style) {
  const text = String(value || '');
  // Leave values that need exact typing/copying readable: URLs, inline code,
  // WhatsApp identifiers, and bot command names.
  const protectedPattern = /(`[^`]*`|https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\b|@\d{5,15}|\+?\d{6,15}|(?:^|\s)([.!/][a-z][a-z0-9_-]*)(?=[\s.,!?;:]|$))/gi;
  let output = '';
  let lastIndex = 0;
  for (const match of text.matchAll(protectedPattern)) {
    const start = match.index;
    const protectedValue = match[0];
    const commandPrefix = match[1] || '';
    const commandStart = commandPrefix ? protectedValue.lastIndexOf(commandPrefix) : -1;
    const normalPart = commandStart >= 0 ? protectedValue.slice(0, commandStart) : '';
    output += [...text.slice(lastIndex, start) + normalPart]
      .map(character => mapStyledCharacter(character, style)).join('');
    output += commandStart >= 0 ? commandPrefix : protectedValue;
    lastIndex = start + protectedValue.length;
  }
  output += [...text.slice(lastIndex)].map(character => mapStyledCharacter(character, style)).join('');
  return output;
}

function formatStaticContent(content, language, style) {
  if (!content || typeof content !== 'object') return content;
  const translated = { ...content };
  // Style/localize textual bot replies only. Media captions can contain user or
  // API-provided text, so leave them byte-for-byte unchanged.
  if (typeof translated.text === 'string' && translated.text) {
    translated.text = styleStaticText(translateStaticText(translated.text, language), style);
  }
  return translated;
}

function setupTranslationWrapper(socket, number, options = {}) {
  if (!socket || typeof socket.sendMessage !== 'function' || socket[TRANSLATION_WRAPPER_MARK]) return;
  const originalSendMessage = socket.sendMessage.bind(socket);
  const sessionId = normaliseSessionId(number || socket.user?.id?.split(':')[0]);
  const lookupTimeoutMs = Number.isFinite(options.languageLookupTimeoutMs)
    ? Math.max(0, options.languageLookupTimeoutMs)
    : languageLookupTimeoutMs;
  if (sessionId) void primeSessionLanguage(sessionId, lookupTimeoutMs);

  socket.sendMessage = async (jid, content, sendOptions = {}) => {
    const { [SKIP_FORMATTING_OPTION]: skipFormatting, ...safeOptions } = sendOptions || {};
    if (skipFormatting) return originalSendMessage(jid, content, safeOptions);
    let language = DEFAULT_LANGUAGE;
    if (sessionId) {
      language = getCachedLanguage(sessionId) || DEFAULT_LANGUAGE;
      if (!getCachedLanguage(sessionId)) void primeSessionLanguage(sessionId, lookupTimeoutMs);
    }
    const hasTextReply = typeof content?.text === 'string' && Boolean(content.text);
    const style = FONT_STYLES[hasTextReply ? styleSequence++ % FONT_STYLES.length : 0];
    return originalSendMessage(jid, formatStaticContent(content, language, style), safeOptions);
  };
  Object.defineProperty(socket, TRANSLATION_WRAPPER_MARK, { value: true, enumerable: false });
}

function configureTranslationStorage({ initMongo, getDb, languageLookupTimeoutMs: timeoutMs } = {}) {
  initMongoProvider = typeof initMongo === 'function' ? initMongo : null;
  getDbProvider = typeof getDb === 'function' ? getDb : null;
  if (Number.isFinite(timeoutMs)) languageLookupTimeoutMs = Math.max(0, timeoutMs);
}

module.exports = {
  COLLECTION_NAME,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  SKIP_FORMATTING_OPTION,
  DEFAULT_LANGUAGE_CACHE_TTL_MS,
  DEFAULT_LANGUAGE_LOOKUP_TIMEOUT_MS,
  configureTranslationStorage,
  saveSessionLanguage,
  getSessionLanguage,
  setupTranslationWrapper,
  _test: {
    clearCache() {
      languageCache.clear();
      languageLoads.clear();
      localeCache.clear();
      styleSequence = 0;
    },
    cacheLanguage: rememberLanguage,
    getCachedLanguage,
    translateStaticText,
    styleStaticText,
    formatStaticContent,
    assertLanguage,
    loadLocale
  }
};
