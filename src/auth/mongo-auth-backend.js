'use strict';

/**
 * Persistance MongoDB de l'état d'authentification Baileys.
 *
 * Il n'existe volontairement aucun repli sur le système de fichiers :
 *   - `sessions` contient les creds encodés avec BufferJSON ;
 *   - `session_keys` contient une ligne par clé Signal.
 *
 * Les valeurs sont stockées sous forme de chaînes BufferJSON. Cela évite que
 * BSON transforme les Buffer/Uint8Array en `Binary`, objet que libsignal ne
 * sait pas utiliser directement après un redémarrage.
 */

const { BufferJSON } = require('@whiskeysockets/baileys');

const DEFAULT_SESSION_COLLECTION = 'sessions';
const DEFAULT_KEYS_COLLECTION = 'session_keys';
const AUTH_FORMAT = 'baileys-buffer-json-v1';

function encodeAuthValue(value) {
  if (value === undefined) throw new TypeError('Impossible de sérialiser une valeur auth undefined');
  return JSON.stringify(value, BufferJSON.replacer);
}

function decodeAuthValue(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Le document auth MongoDB ne contient pas une chaîne BufferJSON');
  }
  return JSON.parse(value, BufferJSON.reviver);
}

/** Convertit les anciens BSON Binary en Buffer avant leur migration. */
function normalizeLegacyBson(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== 'object') return value;

  if (value._bsontype === 'Binary' && value.buffer) {
    return Buffer.from(value.buffer);
  }
  if (value instanceof Date) return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const entry of value) result.push(normalizeLegacyBson(entry, seen));
    return result;
  }

  // Les anciennes sauvegardes JSON peuvent déjà contenir la forme BufferJSON.
  if (value.type === 'Buffer' && value.data !== undefined) {
    return BufferJSON.reviver('', value);
  }

  const result = {};
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) {
    result[key] = normalizeLegacyBson(entry, seen);
  }
  return result;
}

function cloneAuthValue(value) {
  return decodeAuthValue(encodeAuthValue(normalizeLegacyBson(value)));
}

function splitRef(ref) {
  const separator = String(ref).indexOf('/');
  return separator < 0
    ? { type: String(ref), id: '' }
    : { type: String(ref).slice(0, separator), id: String(ref).slice(separator + 1) };
}

function decodeStoredValue(value, context) {
  try {
    return typeof value.data === 'string'
      ? decodeAuthValue(value.data)
      : cloneAuthValue(value.legacy);
  } catch (cause) {
    const error = new Error(`Document d'authentification MongoDB illisible (${context})`);
    error.name = 'MongoAuthDecodeError';
    error.code = 'MONGODB_AUTH_DECODE_ERROR';
    error.cause = cause;
    throw error;
  }
}

function createMongoAuthBackend({ initMongo, getDb, sessionCollection, keysCollection } = {}) {
  const sessionName = sessionCollection || DEFAULT_SESSION_COLLECTION;
  const keysName = keysCollection || DEFAULT_KEYS_COLLECTION;
  let indexPromise = null;

  async function ready() {
    if (typeof initMongo === 'function') await initMongo();
    const db = typeof getDb === 'function' ? getDb() : null;
    if (!db) throw new Error('Base MongoDB indisponible pour les sessions WhatsApp');
    await ensureIndexes(db);
    return db;
  }

  function ensureIndexes(db) {
    if (!indexPromise) {
      indexPromise = Promise.all([
        db.collection(sessionName).createIndex({ number: 1 }, { unique: true }),
        db.collection(keysName).createIndex({ number: 1, type: 1, id: 1 }, { unique: true }),
        db.collection(keysName).createIndex({ number: 1 })
      ]).catch((error) => {
        indexPromise = null;
        throw error;
      });
    }
    return indexPromise;
  }

  return {
    collectionNames: { sessions: sessionName, keys: keysName },

    async ping() {
      const db = await ready();
      await db.command({ ping: 1 });
      return true;
    },

    async load(number) {
      const db = await ready();
      const num = String(number);
      const [doc, keyDocs] = await Promise.all([
        db.collection(sessionName).findOne({ number: num }),
        db.collection(keysName).find({ number: num }).toArray()
      ]);
      if (!doc && keyDocs.length === 0) return null;

      let needsMigration = false;
      let creds = null;
      if (doc) {
        if (typeof doc.data === 'string') {
          creds = decodeStoredValue({ data: doc.data }, `creds ${num}`);
        } else if (doc.creds) {
          creds = decodeStoredValue({ legacy: doc.creds }, `anciens creds ${num}`);
          needsMigration = true;
        }
      }

      const keys = keyDocs.map((entry) => {
        const isCurrent = typeof entry.data === 'string';
        const value = decodeStoredValue(
          isCurrent ? { data: entry.data } : { legacy: entry.value },
          `clé ${entry.type}/${entry.id} de ${num}`
        );
        if (!isCurrent) needsMigration = true;
        return { type: entry.type, id: entry.id, value };
      });

      return { creds, keys, needsMigration };
    },

    async exists(number) {
      const db = await ready();
      const num = String(number);
      const session = await db.collection(sessionName).findOne(
        { number: num },
        { projection: { _id: 1 } }
      );
      if (session) return true;
      const key = await db.collection(keysName).findOne(
        { number: num },
        { projection: { _id: 1 } }
      );
      return Boolean(key);
    },

    async saveCreds(number, creds) {
      // L'encodage est fait avant le premier await : on photographie l'objet,
      // que Baileys continue à muter en mémoire pendant l'écriture réseau.
      const data = encodeAuthValue(creds);
      const num = String(number);
      const metadata = {
        registered: Boolean(creds?.registered),
        userId: creds?.me?.id ? String(creds.me.id) : null
      };
      const db = await ready();
      await db.collection(sessionName).updateOne(
        { number: num },
        {
          $set: {
            number: num,
            data,
            format: AUTH_FORMAT,
            ...metadata,
            updatedAt: new Date()
          },
          $unset: { creds: '', keys: '' }
        },
        { upsert: true }
      );
    },

    async saveKeys(number, entries) {
      if (!entries?.length) return;
      const num = String(number);
      const now = new Date();
      // Même principe que saveCreds : photographier avant l'attente MongoDB.
      const operations = entries.map(({ ref, value }) => {
        const { type, id } = splitRef(ref);
        const filter = { number: num, type, id };
        if (value === null || value === undefined) {
          return { deleteOne: { filter } };
        }
        return {
          updateOne: {
            filter,
            update: {
              $set: {
                ...filter,
                data: encodeAuthValue(value),
                format: AUTH_FORMAT,
                updatedAt: now
              },
              $unset: { value: '' }
            },
            upsert: true
          }
        };
      });
      const db = await ready();
      await db.collection(keysName).bulkWrite(operations, { ordered: true });
    },

    async remove(number) {
      const db = await ready();
      const num = String(number);
      await Promise.all([
        db.collection(keysName).deleteMany({ number: num }),
        db.collection(sessionName).deleteOne({ number: num })
      ]);
    }
  };
}

module.exports = {
  createMongoAuthBackend,
  encodeAuthValue,
  decodeAuthValue,
  cloneAuthValue,
  normalizeLegacyBson,
  splitRef,
  AUTH_FORMAT,
  DEFAULT_SESSION_COLLECTION,
  DEFAULT_KEYS_COLLECTION
};
