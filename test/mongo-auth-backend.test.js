'use strict';

/**
 * Tests du miroir MongoDB de l'état d'authentification.
 *
 * Point vérifié en priorité : les clés Signal (dont les identifiants sont des
 * JID contenant des points, comme `session-50947440869@s.whatsapp.net`) sont
 * stockées une par une et rechargées à l'identique. L'ancien code écrivait un
 * champ `keys` qui ne contenait que `{}`.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createMongoAuthBackend } = require('../src/auth/mongo-auth-backend');

function applyUpdate(doc, update) {
  const result = { ...doc };
  for (const [key, value] of Object.entries(update.$set || {})) result[key] = value;
  for (const key of Object.keys(update.$unset || {})) delete result[key];
  return result;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
}

/** Collection mémoire qui imite les opérations MongoDB utilisées. */
function fakeCollection() {
  const docs = [];
  return {
    docs,
    async createIndex() { return 'ok'; },
    async findOne(filter) { return docs.find((d) => matches(d, filter)) || null; },
    async updateOne(filter, update, options = {}) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index >= 0) {
        docs[index] = applyUpdate(docs[index], update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        docs.push(applyUpdate({ ...filter }, update));
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async deleteOne(filter) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      let deleted = 0;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (matches(docs[i], filter)) { docs.splice(i, 1); deleted += 1; }
      }
      return { deletedCount: deleted };
    },
    find(filter) {
      const found = docs.filter((d) => matches(d, filter));
      return { async toArray() { return found; } };
    },
    async bulkWrite(operations) {
      for (const operation of operations) {
        if (operation.updateOne) {
          await this.updateOne(operation.updateOne.filter, operation.updateOne.update, { upsert: operation.updateOne.upsert });
        } else if (operation.deleteOne) {
          await this.deleteOne(operation.deleteOne.filter);
        }
      }
      return { ok: 1 };
    }
  };
}

function fakeDb() {
  const collections = new Map();
  let initCalled = 0;
  return {
    collections,
    collection(name) {
      if (!collections.has(name)) collections.set(name, fakeCollection());
      return collections.get(name);
    },
    async initMongo() { initCalled += 1; },
    initCalls: () => initCalled
  };
}

function makeBackend(db) {
  return createMongoAuthBackend({ initMongo: () => db.initMongo(), getDb: () => db });
}

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

test('load renvoie null quand la session est inconnue', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);
  assert.equal(await backend.load('50900000000'), null);
  assert.ok(db.initCalls() >= 1, 'initMongo doit être appelé');
});

test('saveCreds enregistre les creds et retire l’ancien champ keys fantôme', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);
  const creds = validCreds();

  // Vieille ligne laissée par les versions précédentes.
  await db.collection('sessions').updateOne(
    { number: '50947440869' },
    { $set: { number: '50947440869', creds: { vieux: true }, keys: {} } },
    { upsert: true }
  );

  await backend.saveCreds('50947440869', creds);

  const doc = db.collection('sessions').docs[0];
  assert.deepEqual(doc.creds, creds);
  assert.equal('keys' in doc, false, 'le champ keys fantôme doit être retiré');

  const loaded = await backend.load('50947440869');
  assert.deepEqual(loaded.creds, creds);
  assert.deepEqual(loaded.keys, []);
});

test('saveKeys puis load rechargent les clés à l’identique, JID à points compris', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);

  const entries = [
    { ref: 'pre-key/1', value: { privateKey: 'aGk=' } },
    { ref: 'session/50947440869:12@s.whatsapp.net', value: { ratchet: 'abc' } },
    { ref: 'sender-key/120363000000@g.us', value: { senderKey: 'xyz' } },
    { ref: 'app-state-sync-key/AAAAA', value: { keyData: 'base64' } }
  ];

  await backend.saveKeys('50947440869', entries);
  await backend.saveCreds('50947440869', validCreds());

  const loaded = await backend.load('50947440869');
  assert.equal(loaded.keys.length, 4);

  const byRef = new Map(loaded.keys.map((k) => [`${k.type}/${k.id}`, k.value]));
  for (const entry of entries) {
    assert.deepEqual(byRef.get(entry.ref), entry.value, `clé ${entry.ref} mal rechargée`);
  }
});

test('saveKeys avec value null supprime la clé', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);

  await backend.saveKeys('50947440869', [
    { ref: 'pre-key/1', value: { a: 1 } },
    { ref: 'pre-key/2', value: { b: 2 } }
  ]);
  assert.equal(db.collection('session_keys').docs.length, 2);

  await backend.saveKeys('50947440869', [{ ref: 'pre-key/1', value: null }]);

  const loaded = await backend.load('50947440869');
  assert.equal(loaded.keys.length, 1);
  assert.equal(loaded.keys[0].id, '2');
});

test('saveKeys est un no-op sur une liste vide', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);
  await assert.doesNotReject(backend.saveKeys('50947440869', []));
  assert.equal(db.collection('session_keys').docs.length, 0);
});

test('deux sessions ne se mélangent pas', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);

  await backend.saveCreds('50911111111', validCreds('50911111111@s.whatsapp.net'));
  await backend.saveKeys('50911111111', [{ ref: 'pre-key/1', value: { who: 'un' } }]);
  await backend.saveCreds('50922222222', validCreds('50922222222@s.whatsapp.net'));
  await backend.saveKeys('50922222222', [{ ref: 'pre-key/1', value: { who: 'deux' } }]);

  const un = await backend.load('50911111111');
  const deux = await backend.load('50922222222');
  assert.equal(un.keys[0].value.who, 'un');
  assert.equal(deux.keys[0].value.who, 'deux');
  assert.equal(un.creds.me.id, '50911111111@s.whatsapp.net');
});

test('remove efface les creds ET toutes les clés de la session', async () => {
  const db = fakeDb();
  const backend = makeBackend(db);

  await backend.saveCreds('50933333333', validCreds());
  await backend.saveKeys('50933333333', [
    { ref: 'pre-key/1', value: { a: 1 } },
    { ref: 'session/50947440869@s.whatsapp.net', value: { b: 2 } }
  ]);
  // Une autre session doit survivre.
  await backend.saveCreds('50944444444', validCreds('50944444444@s.whatsapp.net'));

  await backend.remove('50933333333');

  assert.equal(await backend.load('50933333333'), null);
  assert.equal(db.collection('session_keys').docs.length, 0);
  assert.notEqual(await backend.load('50944444444'), null);
});

test('le backend refuse de travailler sans base disponible', async () => {
  const backend = createMongoAuthBackend({ initMongo: async () => {}, getDb: () => null });
  await assert.rejects(backend.load('50955555555'), /indisponible/);
});

test('les noms de collections par défaut sont stables', () => {
  const db = fakeDb();
  const backend = makeBackend(db);
  assert.deepEqual(backend.collectionNames, { sessions: 'sessions', keys: 'session_keys' });
});
