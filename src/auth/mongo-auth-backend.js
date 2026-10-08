'use strict';

/**
 * mongo-auth-backend.js — miroir MongoDB de l'état d'authentification.
 *
 * Deux collections :
 *   - `sessions`      : { number, creds, updatedAt }                  (existant)
 *   - `session_keys`  : { number, type, id, value, updatedAt }        (nouveau)
 *
 * Le point clé : AVANT, seules les creds partaient dans MongoDB et le code
 * écrivait un champ `keys` qui contenait en réalité `state.keys`, c'est-à-dire
 * un objet de FONCTIONS (`{ get, set }`) sérialisé en `{}`. Les clés Signal
 * n'étaient donc jamais sauvegardées. Elles sont maintenant stockées une par
 * une, ce qui rend une session restaurable intégralement après un redéploiement
 * (disque éphémère, conteneur recréé, tmp vidé, …).
 */

const DEFAULT_SESSION_COLLECTION = 'sessions';
const DEFAULT_KEYS_COLLECTION = 'session_keys';

function createMongoAuthBackend({ initMongo, getDb, sessionCollection, keysCollection } = {}) {
  const sessionName = sessionCollection || DEFAULT_SESSION_COLLECTION;
  const keysName = keysCollection || DEFAULT_KEYS_COLLECTION;

  async function ready() {
    if (typeof initMongo === 'function') await initMongo();
    const db = typeof getDb === 'function' ? getDb() : null;
    if (!db) throw new Error('Base MongoDB indisponible pour la sauvegarde de session');
    return db;
  }

  /** Migration paresseuse : garantit les index une seule fois. */
  let indexed = false;
  async function ensureIndexes(db) {
    if (indexed) return;
    indexed = true;
    try {
      await db.collection(sessionName).createIndex({ number: 1 }, { unique: true });
      await db.collection(keysName).createIndex({ number: 1, type: 1, id: 1 }, { unique: true });
      await db.collection(keysName).createIndex({ number: 1 });
    } catch (err) {
      // Un index existant avec d'autres options ne doit pas bloquer le bot.
      console.warn('[AUTH] createIndex ignoré :', err.message || err);
    }
  }

  return {
    collectionNames: { sessions: sessionName, keys: keysName },

    async load(number) {
      const db = await ready();
      await ensureIndexes(db);
      const num = String(number);
      const doc = await db.collection(sessionName).findOne({ number: num });
      const keyDocs = await db
        .collection(keysName)
        .find({ number: num })
        .toArray();
      // On renvoie les clés même sans document de creds : pendant l'appairage,
      // les clés sont écrites AVANT les creds. Renvoyer null ici ferait perdre
      // les pre-keys d'une session en cours d'enregistrement.
      if (!doc && keyDocs.length === 0) return null;
      return {
        creds: (doc && doc.creds) || null,
        keys: keyDocs.map((entry) => ({ type: entry.type, id: entry.id, value: entry.value }))
      };
    },

    async saveCreds(number, creds) {
      const db = await ready();
      await ensureIndexes(db);
      await db.collection(sessionName).updateOne(
        { number: String(number) },
        { $set: { number: String(number), creds, updatedAt: new Date() }, $unset: { keys: '' } },
        { upsert: true }
      );
    },

    async saveKeys(number, entries) {
      if (!entries || !entries.length) return;
      const db = await ready();
      await ensureIndexes(db);
      const now = new Date();
      const operations = entries.map(({ ref, value }) => {
        const separator = String(ref).indexOf('/');
        const type = separator < 0 ? String(ref) : String(ref).slice(0, separator);
        const id = separator < 0 ? '' : String(ref).slice(separator + 1);
        const filter = { number: String(number), type, id };
        if (value === null || value === undefined) {
          return { deleteOne: { filter } };
        }
        return {
          updateOne: {
            filter,
            update: { $set: { ...filter, value, updatedAt: now } },
            upsert: true
          }
        };
      });
      await db.collection(keysName).bulkWrite(operations);
    },

    async remove(number) {
      const db = await ready();
      await ensureIndexes(db);
      await db.collection(keysName).deleteMany({ number: String(number) });
      await db.collection(sessionName).deleteOne({ number: String(number) });
    }
  };
}

module.exports = {
  createMongoAuthBackend,
  DEFAULT_SESSION_COLLECTION,
  DEFAULT_KEYS_COLLECTION
};
