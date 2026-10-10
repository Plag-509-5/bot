'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Binary } = require('mongodb');
const { initAuthCreds } = require('@whiskeysockets/baileys');

const {
  createMongoAuthBackend,
  encodeAuthValue,
  decodeAuthValue,
  AUTH_FORMAT
} = require('../src/auth/mongo-auth-backend');
const { createFakeDb } = require('./helpers/fake-mongo');

function registeredCreds(number = '50947440869') {
  const creds = initAuthCreds();
  creds.registered = true;
  creds.me = { id: `${number}@s.whatsapp.net`, name: 'Kaido' };
  return creds;
}

function makeBackend(db, calls = []) {
  return createMongoAuthBackend({
    initMongo: async () => { calls.push('initMongo'); },
    getDb: () => db
  });
}

test('BufferJSON conserve les Buffer des creds Baileys', () => {
  const creds = registeredCreds();
  const restored = decodeAuthValue(encodeAuthValue(creds));

  assert.ok(Buffer.isBuffer(restored.noiseKey.private));
  assert.ok(Buffer.isBuffer(restored.signedIdentityKey.public));
  assert.deepEqual(restored.noiseKey.private, creds.noiseKey.private);
  assert.equal(restored.registrationId, creds.registrationId);
});

test('load renvoie null pour une session inconnue et prépare les index uniques', async () => {
  const db = createFakeDb();
  const calls = [];
  const backend = makeBackend(db, calls);

  assert.equal(await backend.load('50900000000'), null);
  assert.ok(calls.length >= 1);
  assert.equal(db.collection('sessions').indexes[0].options.unique, true);
  assert.equal(db.collection('session_keys').indexes[0].options.unique, true);
});

test('saveCreds stocke uniquement le payload BufferJSON et le recharge', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  const creds = registeredCreds();

  await backend.saveCreds('50947440869', creds);

  const document = db.collection('sessions').docs[0];
  assert.equal(document.format, AUTH_FORMAT);
  assert.equal(typeof document.data, 'string');
  assert.equal('creds' in document, false);
  assert.equal(document.registered, true);

  const loaded = await backend.load('50947440869');
  assert.ok(Buffer.isBuffer(loaded.creds.noiseKey.private));
  assert.deepEqual(loaded.creds.noiseKey.private, creds.noiseKey.private);
  assert.deepEqual(loaded.keys, []);
});

test('saveKeys recharge toutes les clés Signal, JID à points compris', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  const entries = [
    { ref: 'pre-key/1', value: { private: Buffer.from('un') } },
    { ref: 'session/50947440869:12@s.whatsapp.net', value: { ratchet: Buffer.from('deux') } },
    { ref: 'sender-key/120363000000@g.us', value: { senderKey: Buffer.from('trois') } },
    { ref: 'app-state-sync-key/AAAAA', value: { keyData: Buffer.from('quatre') } }
  ];

  await backend.saveCreds('50947440869', registeredCreds());
  await backend.saveKeys('50947440869', entries);

  const loaded = await backend.load('50947440869');
  const byRef = new Map(loaded.keys.map((entry) => [`${entry.type}/${entry.id}`, entry.value]));
  assert.equal(byRef.size, 4);
  for (const entry of entries) {
    assert.deepEqual(byRef.get(entry.ref), entry.value);
  }
  assert.ok(db.collection('session_keys').docs.every((doc) => !('value' in doc)));
});

test('une valeur null supprime la clé ciblée seulement', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  await backend.saveKeys('50947440869', [
    { ref: 'pre-key/1', value: { a: 1 } },
    { ref: 'pre-key/2', value: { b: 2 } }
  ]);

  await backend.saveKeys('50947440869', [{ ref: 'pre-key/1', value: null }]);
  const loaded = await backend.load('50947440869');
  assert.equal(loaded.keys.length, 1);
  assert.equal(loaded.keys[0].id, '2');
});

test('les anciennes valeurs BSON sont lues et signalées pour migration', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  const creds = registeredCreds();
  creds.noiseKey.private = new Binary(Buffer.from(creds.noiseKey.private));

  await db.collection('sessions').updateOne(
    { number: '50947440869' },
    { $set: { number: '50947440869', creds, keys: {} } },
    { upsert: true }
  );
  await db.collection('session_keys').updateOne(
    { number: '50947440869', type: 'pre-key', id: '1' },
    { $set: {
      number: '50947440869',
      type: 'pre-key',
      id: '1',
      value: { private: new Binary(Buffer.from('legacy')) }
    } },
    { upsert: true }
  );

  const loaded = await backend.load('50947440869');
  assert.equal(loaded.needsMigration, true);
  assert.ok(Buffer.isBuffer(loaded.creds.noiseKey.private));
  assert.ok(Buffer.isBuffer(loaded.keys[0].value.private));
  assert.equal(loaded.keys[0].value.private.toString(), 'legacy');
});

test('un payload MongoDB tronqué produit une erreur de corruption identifiable', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  await db.collection('sessions').updateOne(
    { number: '50940000000' },
    { $set: { number: '50940000000', data: '{"noiseKey":' } },
    { upsert: true }
  );

  await assert.rejects(
    backend.load('50940000000'),
    (error) => error.code === 'MONGODB_AUTH_DECODE_ERROR'
  );
});

test('deux sessions restent isolées et remove ne touche que sa cible', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  await backend.saveCreds('50911111111', registeredCreds('50911111111'));
  await backend.saveKeys('50911111111', [{ ref: 'pre-key/1', value: { who: 'un' } }]);
  await backend.saveCreds('50922222222', registeredCreds('50922222222'));
  await backend.saveKeys('50922222222', [{ ref: 'pre-key/1', value: { who: 'deux' } }]);

  assert.equal(await backend.exists('50911111111'), true);
  await backend.remove('50911111111');

  assert.equal(await backend.load('50911111111'), null);
  const survivor = await backend.load('50922222222');
  assert.equal(survivor.keys[0].value.who, 'deux');
});

test('ping vérifie réellement la base et le backend refuse une base absente', async () => {
  const db = createFakeDb();
  const backend = makeBackend(db);
  assert.equal(await backend.ping(), true);
  assert.deepEqual(db.commands, [{ ping: 1 }]);

  const unavailable = createMongoAuthBackend({
    initMongo: async () => {},
    getDb: () => null
  });
  await assert.rejects(unavailable.load('50955555555'), /indisponible/);
});
