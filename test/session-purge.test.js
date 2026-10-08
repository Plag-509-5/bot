'use strict';

/**
 * Tests de la purge d'une session ratée.
 *
 * Contrat vérifié : après un appairage raté, il ne reste **rien** — ni sur
 * disque, ni dans MongoDB (creds, clés Signal, numéro). C'est la condition pour
 * que la demande de code suivante fonctionne au lieu d'afficher « Indisponible ».
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-purge-'));
process.env.SESSIONS_DIR = sandbox;

const store = require('../src/auth/session-store');
const { createSessionPurger } = require('../src/auth/session-purge');
const { createMongoAuthBackend } = require('../src/auth/mongo-auth-backend');

function validCreds(meId = '50947440869@s.whatsapp.net') {
  return {
    noiseKey: { private: 'cHJpdmU=', public: 'cHVibGlj' },
    signedIdentityKey: { private: 'aWRlbnRpdHk=' },
    signedPreKey: { keyPair: { private: 'c3ByaXY=' }, signature: 'c2ln', keyId: 1 },
    registrationId: 137,
    me: { id: meId },
    registered: true
  };
}

/** Collections MongoDB mémoire (mêmes opérations que le vrai backend). */
function fakeMongo() {
  const sessions = new Map();
  const keys = new Map();
  const numbers = new Map();
  const calls = [];
  const k = (n, t, i) => `${n}|${t}|${i}`;
  return {
    sessions,
    keys,
    numbers,
    calls,
    backend: createMongoAuthBackend({
      initMongo: async () => { calls.push('initMongo'); },
      getDb: () => ({
        collection(name) {
          const map = name === 'sessions' ? sessions : keys;
          return {
            async createIndex() { return 'ok'; },
            async findOne(filter) {
              return map.get(filter.number) || (name === 'keys' ? null : null);
            },
            find(filter) {
              const found = Array.from(map.values()).filter((d) => d.number === filter.number);
              return { async toArray() { return found; } };
            },
            async updateOne(filter, update) {
              const doc = { ...(map.get(filter.number) || filter) };
              Object.assign(doc, update.$set || {});
              for (const key of Object.keys(update.$unset || {})) delete doc[key];
              map.set(filter.number, doc);
              return { matchedCount: 1 };
            },
            async deleteOne(filter) {
              const had = map.delete(filter.number);
              return { deletedCount: had ? 1 : 0 };
            },
            async deleteMany(filter) {
              let n = 0;
              for (const [key, doc] of Array.from(map.entries())) {
                if (doc.number === filter.number) { map.delete(key); n += 1; }
              }
              return { deletedCount: n };
            },
            async bulkWrite(operations) {
              for (const op of operations) {
                if (op.updateOne) {
                  const { number, type, id } = op.updateOne.filter;
                  map.set(k(number, type, id), { number, type, id, ...op.updateOne.update.$set });
                } else if (op.deleteOne) {
                  const { number, type, id } = op.deleteOne.filter;
                  map.delete(k(number, type, id));
                }
              }
              return { ok: 1 };
            }
          };
        }
      })
    }),
    async removeSession(number) { calls.push(`removeSession:${number}`); sessions.delete(number); },
    async removeNumber(number) { calls.push(`removeNumber:${number}`); numbers.delete(number); }
  };
}

/** Construit une session ratée complète : disque + toutes les collections. */
async function seedFailedSession(number, existingMongo = null) {
  const mongo = existingMongo || fakeMongo();
  const dir = store.sessionDir(number);

  await store.writeJsonAtomic(store.credsPath(dir), validCreds(`${number}@s.whatsapp.net`));
  await store.writeKeyToDisk(dir, 'pre-key', '1', { privateKey: 'aGk=' });
  await store.writeKeyToDisk(dir, 'session', `${number}:3@s.whatsapp.net`, { ratchet: 'abc' });

  await mongo.backend.saveCreds(number, validCreds(`${number}@s.whatsapp.net`));
  await mongo.backend.saveKeys(number, [
    { ref: 'pre-key/1', value: { privateKey: 'aGk=' } },
    { ref: `session/${number}:3@s.whatsapp.net`, value: { ratchet: 'abc' } }
  ]);
  mongo.numbers.set(number, { number });

  // Ancien dossier temporaire, tel que les versions précédentes le créaient.
  const tmp = path.join(os.tmpdir(), `session_${number}`);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'creds.json'), '{}');

  return { mongo, dir, tmp };
}

function makePurger(mongo) {
  return createSessionPurger({
    authBackend: mongo.backend,
    removeSession: mongo.removeSession,
    removeNumber: mongo.removeNumber,
    logger: { warn() {}, error() {}, info() {} }
  });
}

test('après purge, il ne reste rien sur disque', async () => {
  const number = '50910000001';
  const { mongo, dir, tmp } = await seedFailedSession(number);
  assert.equal(fs.existsSync(dir), true, 'précondition : le dossier existe');

  await makePurger(mongo).purge(number, { reason: 'test' });

  assert.equal(fs.existsSync(dir), false, 'sessions/<numéro> doit avoir disparu');
  assert.equal(fs.existsSync(tmp), false, 'l’ancien dossier tmp doit avoir disparu');
});

test('après purge, MongoDB ne contient plus ni creds, ni clés, ni numéro', async () => {
  const number = '50910000002';
  const { mongo } = await seedFailedSession(number);
  assert.notEqual(await mongo.backend.load(number), null, 'précondition : la session existe en base');

  await makePurger(mongo).purge(number, { reason: 'test' });

  assert.equal(await mongo.backend.load(number), null, 'creds et clés doivent avoir disparu');
  assert.equal(mongo.sessions.has(number), false, 'collection sessions non purgée');
  assert.equal(mongo.numbers.has(number), false, 'collection numbers non purgée');
  const restantes = Array.from(mongo.keys.values()).filter((d) => d.number === number);
  assert.equal(restantes.length, 0, 'des clés Signal subsistent dans session_keys');
});

test('la purge liste les traces effacées pour le journal', async () => {
  const number = '50910000003';
  const { mongo } = await seedFailedSession(number);

  const result = await makePurger(mongo).purge(number, { reason: 'génération du code impossible' });

  assert.equal(result.ok, true);
  assert.equal(result.number, number);
  assert.ok(result.traces.includes(`sessions/${number}`), `traces : ${result.traces.join(', ')}`);
  assert.ok(result.traces.includes('mongo:sessions+session_keys'));
  assert.ok(result.traces.includes('mongo:numbers'));
});

test('l’état d’auth est jeté (discard) et non sauvegardé (close)', async () => {
  const number = '50910000004';
  const { mongo } = await seedFailedSession(number);

  let discarded = 0;
  let closed = 0;
  const auth = {
    discard() { discarded += 1; },
    close() { closed += 1; return Promise.resolve(); }
  };

  await makePurger(mongo).purge(number, { auth, reason: 'test' });

  assert.equal(discarded, 1, 'discard doit être appelé');
  assert.equal(closed, 0, 'close ne doit PAS être appelé : il réécrirait les creds');
});

test('une purge ne touche pas les autres sessions', async () => {
  const cible = '50910000005';
  const autre = '50910000006';
  // Même base pour les deux : on vérifie que la purge est bien ciblée.
  const { mongo } = await seedFailedSession(cible);
  await seedFailedSession(autre, mongo);

  await makePurger(mongo).purge(cible, { reason: 'test' });

  assert.equal(fs.existsSync(store.sessionDir(cible)), false);
  assert.equal(fs.existsSync(store.sessionDir(autre)), true, 'l’autre session ne doit pas être touchée');
  assert.notEqual(await mongo.backend.load(autre), null);
  assert.equal(mongo.numbers.has(autre), true);
});

test('un numéro invalide est refusé sans rien supprimer', async () => {
  const mongo = fakeMongo();
  const result = await makePurger(mongo).purge('   ', { reason: 'test' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'numéro invalide');
  assert.deepEqual(result.traces, []);
});

test('une base MongoDB injoignable n’empêche pas de nettoyer le disque', async () => {
  const number = '50910000007';
  const { dir } = await seedFailedSession(number);

  const purger = createSessionPurger({
    authBackend: { async remove() { throw new Error('mongo hors ligne'); } },
    removeSession: async () => { throw new Error('mongo hors ligne'); },
    removeNumber: async () => { throw new Error('mongo hors ligne'); },
    logger: { warn() {}, error() {}, info() {} }
  });

  const result = await purger.purge(number, { reason: 'test' });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(dir), false, 'le disque doit être nettoyé même sans MongoDB');
});

test('purger une session déjà absente ne provoque aucune erreur', async () => {
  const mongo = fakeMongo();
  await assert.doesNotReject(makePurger(mongo).purge('50910000008', { reason: 'test' }));
});
