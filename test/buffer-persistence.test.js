'use strict';

/**
 * Non-régression : les creds et clés Signal doivent survivre à un redémarrage
 * AVEC leurs Buffers intacts (disque ET MongoDB).
 *
 * Bug constaté : JSON.stringify/JSON.parse « nus » transformaient chaque Buffer
 * en objet `{ type: 'Buffer', data }`. Après redémarrage, Baileys recevait donc
 * des objets à la place des clés → déchiffrement impossible, messages « en
 * attente ». MongoDB renvoie quant à lui des objets BSON `Binary`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-bufpersist-'));
process.env.SESSIONS_DIR = sandbox;

const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { BSON } = require('mongodb');
const store = require('../src/auth/session-store');
const { createPersistentAuthState } = require('../src/auth/persistent-auth');
const { createMongoAuthBackend } = require('../src/auth/mongo-auth-backend');
const { toStorable, fromStored } = require('../src/auth/auth-serializer');
const { createSentMessageCache, recordSentMessages } = require('../src/lib/sent-message-cache');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function assertSameBytes(actual, expected, label) {
  assert.ok(Buffer.isBuffer(actual), `${label} doit être un Buffer (reçu ${typeof actual})`);
  assert.ok(actual.equals(expected), `${label} : contenu différent`);
}

// ---------------------------------------------------------------- sérialiseur

test('toStorable / fromStored font un aller-retour fidèle des Buffers imbriqués', () => {
  const value = {
    a: Buffer.from([0, 1, 2, 254, 255]),
    nested: { list: [Buffer.from('hello'), 3, 'texte'], empty: Buffer.alloc(0) },
    nothing: null
  };
  const stored = toStorable(value);
  // La forme stockée ne doit contenir aucun Buffer natif (JSON pur).
  assert.equal(stored.a.type, 'Buffer');
  assert.equal(typeof stored.a.data, 'string');

  const back = fromStored(JSON.parse(JSON.stringify(stored)));
  assertSameBytes(back.a, value.a, 'a');
  assertSameBytes(back.nested.list[0], Buffer.from('hello'), 'list[0]');
  assert.equal(back.nested.list[1], 3);
  assert.equal(back.nested.list[2], 'texte');
  assertSameBytes(back.nested.empty, Buffer.alloc(0), 'empty');
  assert.equal(back.nothing, null);
});

test('toStorable laisse null et undefined intacts', () => {
  assert.equal(toStorable(null), null);
  assert.equal(toStorable(undefined), undefined);
});

test('fromStored accepte une chaîne JSON encodée avec BufferJSON', () => {
  const raw = JSON.stringify({ key: Buffer.from('abc') }, BufferJSON.replacer);
  const back = fromStored(raw);
  assertSameBytes(back.key, Buffer.from('abc'), 'key');
});

test('fromStored convertit les objets BSON Binary (ce que renvoie MongoDB)', () => {
  // Document écrit par le driver puis relu sans promoteBuffers : Binary, pas Buffer.
  const bytes = BSON.serialize({ value: { private: Buffer.from([9, 8, 7]) } });
  const read = BSON.deserialize(bytes, { promoteBuffers: false });
  assert.notEqual(Buffer.isBuffer(read.value.private), true, 'précondition : le driver renvoie un Binary');

  const back = fromStored(read.value);
  assertSameBytes(back.private, Buffer.from([9, 8, 7]), 'private');
});

// ------------------------------------------------------------------- disque

test('creds et clés survivent à un redémarrage sur disque, Buffers intacts', async () => {
  const number = '50990100001';
  const creds = initAuthCreds();
  const auth = await createPersistentAuthState(number, {
    logger: silent,
    initCreds: () => creds,
    flushDelayMs: 10
  });
  const preKeyPrivate = Buffer.from([1, 2, 3, 250, 251, 252]);
  await auth.state.keys.set({
    'pre-key': { 7: { private: preKeyPrivate, public: Buffer.from('pub') } }
  });
  await auth.saveCreds();
  await auth.close();

  // « Redémarrage » : nouvelle lecture depuis le disque uniquement.
  const reloaded = await createPersistentAuthState(number, {
    logger: silent,
    initCreds: () => { throw new Error('ne doit pas créer de nouvelles creds'); }
  });
  try {
    assert.equal(reloaded.source, 'disque');
    assertSameBytes(reloaded.state.creds.noiseKey.private, creds.noiseKey.private, 'noiseKey.private');
    assertSameBytes(reloaded.state.creds.signedIdentityKey.private, creds.signedIdentityKey.private, 'signedIdentityKey.private');
    assert.equal(store.credsLooksValid(reloaded.state.creds), true);

    const [pre] = Object.values(await reloaded.state.keys.get('pre-key', ['7']));
    assertSameBytes(pre.private, preKeyPrivate, 'pre-key.private');
  } finally {
    await reloaded.close();
  }
});

test('un fichier écrit par l’ancienne version (forme {type:"Buffer"}) est relu en Buffer', async () => {
  const file = path.join(sandbox, 'legacy', 'creds.json');
  const legacyJson = JSON.stringify({ noiseKey: { private: Buffer.from([5, 6, 7]) } }); // ancien format
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, legacyJson, 'utf8');

  const value = await store.readJsonSafe(file);
  assertSameBytes(value.noiseKey.private, Buffer.from([5, 6, 7]), 'noiseKey.private (ancien fichier)');
});

test('writeJsonAtomic écrit les Buffers au format BufferJSON, sans perte', async () => {
  const file = path.join(sandbox, 'format', 'value.json');
  await store.writeJsonAtomic(file, { k: Buffer.from('xyz') });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.includes('"type":"Buffer"'));
  const back = await store.readJsonSafe(file);
  assertSameBytes(back.k, Buffer.from('xyz'), 'k');
});

// ---------------------------------------------------------------- MongoDB

/**
 * Collection mémoire qui stocke les documents en BSON, comme le vrai driver,
 * et les relit sans `promoteBuffers` : les Buffers reviennent donc en `Binary`.
 */
function bsonCollection() {
  const rows = [];
  const read = (bytes) => BSON.deserialize(bytes, { promoteBuffers: false });
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => doc[k] === v);
  return {
    rows,
    async createIndex() { return 'ok'; },
    async findOne(filter) {
      const hit = rows.find((bytes) => matches(read(bytes), filter));
      return hit ? read(hit) : null;
    },
    find(filter) {
      return { async toArray() { return rows.map(read).filter((d) => matches(d, filter)); } };
    },
    async updateOne(filter, update, options = {}) {
      const index = rows.findIndex((bytes) => matches(read(bytes), filter));
      const apply = (base) => {
        const doc = { ...base };
        for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v;
        for (const k of Object.keys(update.$unset || {})) delete doc[k];
        return doc;
      };
      if (index >= 0) {
        rows[index] = BSON.serialize(apply(read(rows[index])));
      } else if (options.upsert) {
        rows.push(BSON.serialize(apply({ ...filter })));
      }
      return { ok: 1 };
    },
    async deleteOne(filter) {
      const index = rows.findIndex((bytes) => matches(read(bytes), filter));
      if (index >= 0) rows.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    async deleteMany(filter) {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(read(rows[i]), filter)) rows.splice(i, 1);
      }
      return { ok: 1 };
    },
    async bulkWrite(operations) {
      for (const op of operations) {
        if (op.updateOne) await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert });
        else if (op.deleteOne) await this.deleteOne(op.deleteOne.filter);
      }
      return { ok: 1 };
    }
  };
}

function fakeDb() {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, bsonCollection());
      return collections.get(name);
    },
    async initMongo() {}
  };
}

test('MongoDB : creds et clés restaurés avec des Buffers (et non des Binary)', async () => {
  const db = fakeDb();
  const backend = createMongoAuthBackend({ initMongo: () => db.initMongo(), getDb: () => db });
  const creds = initAuthCreds();
  const number = '50990100002';

  await backend.saveCreds(number, creds);
  const keyBytes = Buffer.from([42, 43, 44, 200]);
  await backend.saveKeys(number, [
    { ref: 'session/50947440869:3@s.whatsapp.net', value: { _sessions: { abc: { privateKey: keyBytes } } } }
  ]);

  const loaded = await backend.load(number);
  assertSameBytes(loaded.creds.noiseKey.private, creds.noiseKey.private, 'creds.noiseKey.private');
  assertSameBytes(loaded.creds.signedIdentityKey.private, creds.signedIdentityKey.private, 'creds.signedIdentityKey.private');
  assert.equal(loaded.keys.length, 1);
  assertSameBytes(loaded.keys[0].value._sessions.abc.privateKey, keyBytes, 'session key');
  assert.equal(store.credsLooksValid(loaded.creds), true);
});

test('MongoDB : un document ancien (Binary écrits par l’ancien code) est relu correctement', async () => {
  const db = fakeDb();
  const backend = createMongoAuthBackend({ initMongo: () => db.initMongo(), getDb: () => db });
  const creds = initAuthCreds();
  const number = '50990100003';

  // Reproduit l'ancien code : objets natifs (Buffers) écrits tels quels dans BSON.
  await db.collection('sessions').updateOne(
    { number },
    { $set: { number, creds, updatedAt: new Date() } },
    { upsert: true }
  );
  await db.collection('session_keys').updateOne(
    { number, type: 'pre-key', id: '1' },
    { $set: { number, type: 'pre-key', id: '1', value: { private: Buffer.from([1, 1, 2]) } } },
    { upsert: true }
  );

  const loaded = await backend.load(number);
  assertSameBytes(loaded.creds.noiseKey.private, creds.noiseKey.private, 'creds ancien format');
  assertSameBytes(loaded.keys[0].value.private, Buffer.from([1, 1, 2]), 'clé ancien format');
});

// ---------------------------------------------------------- messages envoyés

test('sent-message-cache renvoie le message mémorisé pour une clé {remoteJid,id}', () => {
  const cache = createSentMessageCache();
  const message = { conversation: 'salut' };
  assert.equal(cache.remember({ key: { remoteJid: '50947440869@s.whatsapp.net', id: 'A1', fromMe: true }, message }), true);
  assert.deepEqual(cache.get({ remoteJid: '50947440869@s.whatsapp.net', id: 'A1' }), message);
  assert.equal(cache.get({ remoteJid: '50947440869@s.whatsapp.net', id: 'INCONNU' }), undefined);
});

test('sent-message-cache ignore les messages sans clé ni contenu', () => {
  const cache = createSentMessageCache();
  assert.equal(cache.remember({ key: { remoteJid: 'x@s.whatsapp.net', id: 'B' } }), false);
  assert.equal(cache.remember(null), false);
  assert.equal(cache.get(undefined), undefined);
});

test('sent-message-cache expire après sa durée de vie', () => {
  let clock = 1000;
  const cache = createSentMessageCache({ ttlMs: 500, now: () => clock });
  cache.remember({ key: { remoteJid: 'j', id: 'C' }, message: { conversation: 'x' } });
  clock += 499;
  assert.ok(cache.get({ remoteJid: 'j', id: 'C' }));
  clock += 2;
  assert.equal(cache.get({ remoteJid: 'j', id: 'C' }), undefined);
});

test('sent-message-cache borne sa taille en supprimant les plus anciens', () => {
  const cache = createSentMessageCache({ maxEntries: 2 });
  for (const id of ['1', '2', '3']) {
    cache.remember({ key: { remoteJid: 'j', id }, message: { conversation: id } });
  }
  assert.equal(cache.size(), 2);
  assert.equal(cache.get({ remoteJid: 'j', id: '1' }), undefined);
  assert.deepEqual(cache.get({ remoteJid: 'j', id: '3' }), { conversation: '3' });
});

test('recordSentMessages mémorise chaque envoi réussi sans modifier son résultat', async () => {
  const cache = createSentMessageCache();
  const sent = { key: { remoteJid: 'g@g.us', id: 'D', fromMe: true }, message: { conversation: 'ok' } };
  const socket = { sendMessage: async () => sent };
  recordSentMessages(socket, cache);

  const result = await socket.sendMessage('g@g.us', { text: 'ok' });
  assert.equal(result, sent);
  assert.deepEqual(cache.get({ remoteJid: 'g@g.us', id: 'D' }), sent.message);
});

test('recordSentMessages propage une erreur d’envoi sans rien mémoriser', async () => {
  const cache = createSentMessageCache();
  const socket = { sendMessage: async () => { throw new Error('réseau coupé'); } };
  recordSentMessages(socket, cache);
  await assert.rejects(() => socket.sendMessage('j', { text: 'x' }), /réseau coupé/);
  assert.equal(cache.size(), 0);
});
