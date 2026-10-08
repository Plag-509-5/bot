'use strict';

/**
 * persistent-auth.js — état d'authentification Baileys persistant et non corrompible.
 *
 * Remplace `useMultiFileAuthState()` qui :
 *   - écrivait `creds.json` de façon NON atomique (un kill en pleine écriture
 *     laissait un JSON tronqué → « clé corrompue ») ;
 *   - gardait les clés Signal uniquement sur disque, dans un dossier que le
 *     reste du code supprimait au moindre redémarrage.
 *
 * Ce module fournit le même contrat (`{ state: { creds, keys }, saveCreds }`)
 * plus `flush()` et `close()`, et :
 *   - écrit tout de façon atomique (voir session-store.js) ;
 *   - maintient les clés en mémoire et les reflète sur disque + dans un
 *     backend distant (MongoDB) ;
 *   - au démarrage, choisit la meilleure source disponible (disque, MongoDB,
 *     ou fusion des deux si l'identité est la même) ;
 *   - met en quarantaine des creds invalides au lieu de les utiliser.
 *
 * Backend attendu (toutes les méthodes sont optionnelles) :
 *   load(number)      -> { creds, keys: [{ type, id, value }] } | null
 *   saveCreds(number, creds)
 *   saveKeys(number, [{ ref, value }])   // value === null => suppression
 *   remove(number)
 */

const store = require('./session-store');

const DEFAULT_FLUSH_DELAY_MS = 750;

class AuthCorruptedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AuthCorruptedError';
    this.details = details;
  }
}

function splitRef(ref) {
  const idx = String(ref).indexOf('/');
  if (idx < 0) return { type: String(ref), id: '' };
  return { type: String(ref).slice(0, idx), id: String(ref).slice(idx + 1) };
}

function identityOf(creds) {
  const id = creds && creds.me && creds.me.id;
  return id ? String(id).split(':')[0] : '';
}

function sameIdentity(a, b) {
  const left = identityOf(a);
  const right = identityOf(b);
  return Boolean(left && right && left === right);
}

function logWarn(logger, ...args) {
  if (!logger) return;
  if (typeof logger.warn === 'function') logger.warn(...args);
  else if (typeof logger.error === 'function') logger.error(...args);
}

function logInfo(logger, ...args) {
  if (!logger) return;
  if (typeof logger.info === 'function') logger.info(...args);
  else if (typeof logger.log === 'function') logger.log(...args);
}

/**
 * Choisit les creds/clés à utiliser au démarrage.
 * Exporté séparément pour être testé sans disque ni Mongo.
 */
function resolveAuthSource({ local, remote }) {
  const localValid = store.credsLooksValid(local && local.creds);
  const remoteValid = store.credsLooksValid(remote && remote.creds);

  if (localValid && remoteValid && sameIdentity(local.creds, remote.creds)) {
    // Fusion : le disque est la source la plus récente, MongoDB comble les
    // clés manquantes (disque partiellement perdu, conteneur redémarré, …).
    const merged = new Map();
    for (const key of (remote.keys || [])) merged.set(store.keyRef(key.type, key.id), key);
    for (const key of (local.keys || [])) merged.set(store.keyRef(key.type, key.id), key);
    const keys = Array.from(merged.values());
    return {
      creds: local.creds,
      keys,
      source: keys.length > (local.keys || []).length ? 'disque+mongodb' : 'disque',
      valid: true
    };
  }

  if (localValid) {
    return { creds: local.creds, keys: local.keys || [], source: 'disque', valid: true };
  }

  if (remoteValid) {
    return { creds: remote.creds, keys: remote.keys || [], source: 'mongodb', valid: true };
  }

  const hadSomething = Boolean((local && local.creds) || (remote && remote.creds));
  return { creds: null, keys: [], source: hadSomething ? 'corrompue' : 'nouvelle', valid: false };
}

async function createPersistentAuthState(number, options = {}) {
  const {
    backend = null,
    logger = null,
    initCreds = null,
    flushDelayMs = Number(process.env.AUTH_FLUSH_DELAY_MS) || DEFAULT_FLUSH_DELAY_MS
  } = options;

  const sanitized = store.sanitizeNumber(number);
  if (!sanitized) throw new Error('Numéro de session invalide');

  const dir = store.sessionDir(sanitized);

  const local = await store.snapshotAuthDir(dir);

  let remote = null;
  if (backend && typeof backend.load === 'function') {
    try {
      remote = await backend.load(sanitized);
    } catch (err) {
      logWarn(logger, `[AUTH ${sanitized}] lecture backend impossible : ${err.message || err}`);
    }
  }

  const resolved = resolveAuthSource({ local, remote });

  if (!resolved.valid) {
    if (resolved.source === 'corrompue') {
      const quarantined = await store.quarantineAuthDir(dir, 'creds invalides au démarrage');
      throw new AuthCorruptedError(
        `Creds invalides/corrompus pour la session ${sanitized}. ` +
        `Le dossier a été mis en quarantaine${quarantined ? ` (${quarantined})` : ''}. ` +
        'Un nouvel appairage est nécessaire.',
        { number: sanitized, quarantined }
      );
    }
    if (typeof initCreds !== 'function') {
      throw new Error(
        `Aucune session pour ${sanitized} et aucune fabrique de creds fournie (initCreds).`
      );
    }
  }

  let creds = resolved.valid ? resolved.creds : initCreds();
  let keys = resolved.valid ? resolved.keys : [];

  if (!resolved.valid) {
    logInfo(logger, `[AUTH ${sanitized}] nouvelle session créée (aucun état exploitable).`);
  } else if (resolved.source === 'mongodb') {
    // On recopie immédiatement sur disque : le prochain démarrage sera local.
    await store.restoreAuthDir(dir, { creds, keys });
    logInfo(logger, `[AUTH ${sanitized}] session restaurée depuis MongoDB (${keys.length} clés).`);
  } else {
    logInfo(logger, `[AUTH ${sanitized}] session chargée (${resolved.source}, ${keys.length} clés).`);
  }

  // ---- cache mémoire des clés ----
  const keyCache = new Map();
  for (const key of keys) keyCache.set(store.keyRef(key.type, key.id), key.value);

  // Tout ce qui n'est pas déjà cohérent sur disque doit être écrit une fois.
  let credsDirty = resolved.source !== 'disque';
  const dirtyKeys = new Map(); // ref -> valeur | null

  let flushTimer = null;
  let flushChain = Promise.resolve();
  let closed = false;

  async function performFlush() {
    const keyEntries = Array.from(dirtyKeys.entries());
    dirtyKeys.clear();
    const writeCreds = credsDirty;
    credsDirty = false;

    try {
      // Les clés AVANT les creds : des creds valides sans leurs clés Signal
      // produisent exactement la session « corrompue » qu'on veut éviter.
      for (const [ref, value] of keyEntries) {
        const { type, id } = splitRef(ref);
        await store.writeKeyToDisk(dir, type, id, value);
      }
      if (writeCreds) await store.writeJsonAtomic(store.credsPath(dir), creds);
    } catch (err) {
      // Échec disque : on remet les écritures en attente pour retenter.
      for (const [ref, value] of keyEntries) dirtyKeys.set(ref, value);
      if (writeCreds) credsDirty = true;
      logWarn(logger, `[AUTH ${sanitized}] écriture disque échouée : ${err.message || err}`);
      return;
    }

    if (backend) {
      if (keyEntries.length && typeof backend.saveKeys === 'function') {
        try {
          await backend.saveKeys(
            sanitized,
            keyEntries.map(([ref, value]) => ({ ref, value }))
          );
        } catch (err) {
          for (const [ref, value] of keyEntries) dirtyKeys.set(ref, value);
          logWarn(logger, `[AUTH ${sanitized}] sauvegarde des clés (backend) échouée : ${err.message || err}`);
        }
      }
      if (writeCreds && typeof backend.saveCreds === 'function') {
        try {
          await backend.saveCreds(sanitized, creds);
        } catch (err) {
          credsDirty = true;
          logWarn(logger, `[AUTH ${sanitized}] sauvegarde des creds (backend) échouée : ${err.message || err}`);
        }
      }
    }
  }

  function flush() {
    flushChain = flushChain.then(performFlush, performFlush);
    return flushChain;
  }

  function scheduleFlush() {
    if (closed || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushDelayMs);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  const signalKeys = {
    async get(type, ids) {
      const found = {};
      for (const id of ids || []) {
        const value = keyCache.get(store.keyRef(type, id));
        if (value !== undefined && value !== null) found[id] = value;
      }
      return found;
    },
    async set(data) {
      for (const [type, entries] of Object.entries(data || {})) {
        for (const [id, value] of Object.entries(entries || {})) {
          const ref = store.keyRef(type, id);
          if (value === null || value === undefined) {
            keyCache.delete(ref);
            dirtyKeys.set(ref, null);
          } else {
            keyCache.set(ref, value);
            dirtyKeys.set(ref, value);
          }
        }
      }
      scheduleFlush();
    }
  };

  const saveCreds = async () => {
    credsDirty = true;
    await flush();
  };

  /**
   * Variante debouncée de `saveCreds` : `creds.update` se déclenche très
   * souvent, on regroupe les écritures (disque + MongoDB) sur `flushDelayMs`.
   */
  const persistSoon = () => {
    credsDirty = true;
    scheduleFlush();
  };

  const close = async () => {
    closed = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flush();
  };

  return {
    state: { creds, keys: signalKeys },
    saveCreds,
    persistSoon,
    flush,
    close,
    dir,
    number: sanitized,
    source: resolved.valid ? resolved.source : 'nouvelle',
    /** Nombre d'écritures encore en attente (utile en test et au shutdown). */
    pendingWrites: () => dirtyKeys.size + (credsDirty ? 1 : 0),
    keyCount: () => keyCache.size,
    /** Écrit tout de suite (appelé à la fermeture de la connexion). */
    persistNow: () => flush()
  };
}

module.exports = {
  createPersistentAuthState,
  resolveAuthSource,
  AuthCorruptedError,
  identityOf,
  sameIdentity,
  splitRef
};
