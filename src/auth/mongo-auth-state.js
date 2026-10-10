'use strict';

/**
 * État d'authentification Baileys 100 % MongoDB.
 *
 * Le cache est uniquement en mémoire pendant la vie du processus. Toutes les
 * mutations de creds et de clés Signal sont écrites dans MongoDB avant que la
 * promesse correspondante ne soit résolue. Aucun fichier de session n'est créé.
 */

const { proto } = require('@whiskeysockets/baileys');
const { sanitizeNumber, credsLooksValid } = require('./auth-utils');
const { cloneAuthValue } = require('./mongo-auth-backend');

class MongoAuthCorruptedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MongoAuthCorruptedError';
    this.code = 'MONGODB_AUTH_CORRUPTED';
    this.details = details;
  }
}

function keyRef(type, id) {
  return `${type}/${id}`;
}

function splitRef(ref) {
  const separator = String(ref).indexOf('/');
  return separator < 0
    ? { type: String(ref), id: '' }
    : { type: String(ref).slice(0, separator), id: String(ref).slice(separator + 1) };
}

function log(logger, level, ...args) {
  const fn = logger?.[level] || logger?.info || logger?.log;
  if (typeof fn === 'function') fn.call(logger, ...args);
}

function assertBackend(backend) {
  for (const method of ['load', 'saveCreds', 'saveKeys', 'remove']) {
    if (typeof backend?.[method] !== 'function') {
      throw new TypeError(`Backend MongoDB invalide : méthode ${method} manquante`);
    }
  }
}

async function createMongoAuthState(number, options = {}) {
  const { backend, logger = null, initCreds } = options;
  assertBackend(backend);

  const sanitized = sanitizeNumber(number);
  if (!sanitized) throw new Error('Numéro de session invalide');

  // Une indisponibilité MongoDB remonte volontairement jusqu'à l'appelant :
  // sans base, le bot ne doit jamais créer une session locale de secours.
  let stored;
  try {
    stored = await backend.load(sanitized);
  } catch (error) {
    if (error?.code === 'MONGODB_AUTH_DECODE_ERROR') {
      throw new MongoAuthCorruptedError(
        `État d'authentification MongoDB illisible pour la session ${sanitized}.`,
        { number: sanitized, cause: error.message }
      );
    }
    throw error;
  }
  const hadStoredState = stored !== null;
  const validStoredCreds = credsLooksValid(stored?.creds);

  if (hadStoredState && !validStoredCreds) {
    throw new MongoAuthCorruptedError(
      `État d'authentification MongoDB invalide pour la session ${sanitized}. ` +
      'Supprime la session puis effectue un nouvel appairage.',
      { number: sanitized, hasCreds: Boolean(stored?.creds), keyCount: stored?.keys?.length || 0 }
    );
  }

  let creds;
  let source;
  let keys;

  if (validStoredCreds) {
    creds = stored.creds;
    keys = stored.keys || [];
    source = 'mongodb';
  } else {
    if (typeof initCreds !== 'function') {
      throw new Error(`Aucune session MongoDB pour ${sanitized} et aucune fabrique initCreds fournie.`);
    }
    creds = initCreds();
    if (!credsLooksValid(creds)) {
      throw new Error('initCreds a produit des identifiants Baileys invalides');
    }
    keys = [];
    source = 'nouvelle';
    // MongoDB est la seule source de vérité : les creds initiaux doivent être
    // durables avant même de demander un code d'appairage.
    await backend.saveCreds(sanitized, creds);
  }

  if (stored?.needsMigration) {
    if (keys.length) {
      await backend.saveKeys(
        sanitized,
        keys.map(({ type, id, value }) => ({ ref: keyRef(type, id), value }))
      );
    }
    await backend.saveCreds(sanitized, creds);
    log(logger, 'info', `[AUTH ${sanitized}] ancien format MongoDB migré vers BufferJSON.`);
  }

  const keyCache = new Map();
  for (const key of keys) {
    keyCache.set(keyRef(key.type, key.id), cloneAuthValue(key.value));
  }

  let writeTail = Promise.resolve();
  let pending = 0;
  let closed = false;
  let discarded = false;

  function enqueue(operation) {
    if (closed || discarded) {
      return Promise.reject(new Error(`État d'authentification ${sanitized} déjà fermé`));
    }
    pending += 1;
    const result = writeTail.then(operation);
    // Une écriture ratée est renvoyée à son appelant, sans condamner toutes les
    // écritures suivantes de la file.
    writeTail = result.catch(() => {});
    return result.finally(() => {
      pending = Math.max(0, pending - 1);
    });
  }

  const signalKeys = {
    async get(type, ids) {
      const found = {};
      for (const id of ids || []) {
        const cached = keyCache.get(keyRef(type, id));
        if (cached === undefined || cached === null) continue;
        const value = cloneAuthValue(cached);
        found[id] = type === 'app-state-sync-key'
          ? proto.Message.AppStateSyncKeyData.fromObject(value)
          : value;
      }
      return found;
    },

    async set(data) {
      const changes = [];
      for (const [type, entries] of Object.entries(data || {})) {
        for (const [id, value] of Object.entries(entries || {})) {
          changes.push({
            type,
            id,
            ref: keyRef(type, id),
            value: value === null || value === undefined ? null : cloneAuthValue(value)
          });
        }
      }
      if (!changes.length) return;

      await enqueue(async () => {
        await backend.saveKeys(
          sanitized,
          changes.map(({ ref, value }) => ({ ref, value }))
        );
        // Le cache n'est validé qu'après l'acquittement MongoDB.
        for (const { ref, value } of changes) {
          if (value === null) keyCache.delete(ref);
          else keyCache.set(ref, value);
        }
      });
    }
  };

  async function saveCreds() {
    const snapshot = cloneAuthValue(creds);
    await enqueue(() => backend.saveCreds(sanitized, snapshot));
  }

  async function flush() {
    await writeTail;
  }

  async function close() {
    if (discarded) return;
    if (closed) {
      await writeTail;
      return;
    }

    let saveError = null;
    try {
      // Dernière photographie explicite : protège aussi une mutation de creds
      // qui n'aurait pas encore déclenché l'événement Baileys correspondant.
      await saveCreds();
    } catch (error) {
      saveError = error;
    }
    await writeTail;
    if (saveError) throw saveError;
    closed = true;
  }

  /**
   * Arrête l'état sans nouvelle sauvegarde et attend les écritures déjà parties.
   * Le purger MongoDB peut ensuite supprimer les documents sans qu'une écriture
   * tardive ne ressuscite la session.
   */
  async function discard() {
    if (discarded) return;
    discarded = true;
    closed = true;
    await writeTail;
    keyCache.clear();
  }

  log(
    logger,
    'info',
    source === 'mongodb'
      ? `[AUTH ${sanitized}] session chargée depuis MongoDB (${keyCache.size} clés).`
      : `[AUTH ${sanitized}] nouvelle session créée dans MongoDB.`
  );

  return {
    state: { creds, keys: signalKeys },
    saveCreds,
    // Alias temporaire pour les appelants historiques ; l'écriture reste
    // immédiate et retourne une promesse, sans debounce ni fichier local.
    persistSoon: saveCreds,
    flush,
    close,
    discard,
    number: sanitized,
    source,
    pendingWrites: () => pending,
    keyCount: () => keyCache.size,
    persistNow: flush
  };
}

module.exports = {
  createMongoAuthState,
  MongoAuthCorruptedError,
  keyRef,
  splitRef
};
