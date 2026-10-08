'use strict';

/**
 * Test d'intégration : notre état d'authentification persistant est-il accepté
 * par le `makeWASocket` du fork configuré, et le cache de clés de Baileys
 * (`makeCacheableSignalKeyStore`) dialogue-t-il correctement avec lui ?
 *
 * Aucune connexion WhatsApp n'est établie : on vérifie le contrat d'interface,
 * pas le réseau.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-compat-'));
process.env.SESSIONS_DIR = sandbox;

const baileys = require('@whiskeysockets/baileys');
const {
  initAuthCreds,
  makeCacheableSignalKeyStore
} = baileys;
const pino = require('pino');
const { makeOfflineSocket } = require('./helpers/baileys-socket');
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const { createPersistentAuthState } = require('../src/auth/persistent-auth');
const store = require('../src/auth/session-store');

const logger = pino({ level: 'silent' });

test('xzcbailz expose bien ce dont le bot a besoin', () => {
  for (const name of [
    'default',
    'initAuthCreds',
    'makeCacheableSignalKeyStore',
    'jidNormalizedUser',
    'delay',
    'getContentType',
    'downloadContentFromMessage',
    'generateWAMessageFromContent',
    'generateWAMessageContent',
    'proto'
  ]) {
    assert.ok(name in baileys, `export manquant dans xzcbailz : ${name}`);
  }
});

test('makeWASocket accepte l’état d’authentification persistant sans connexion réseau', async t => {
  const auth = await createPersistentAuthState('50990000001', {
    logger,
    initCreds: initAuthCreds,
    flushDelayMs: 20
  });
  assert.equal(auth.source, 'nouvelle');
  assert.equal(store.credsLooksValid(auth.state.creds), true);

  const { socket } = makeOfflineSocket(t, {
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(auth.state.keys, logger)
    },
    printQRInTerminal: false,
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  });

  try {
    assert.equal(typeof socket.sendMessage, 'function');
    assert.ok(socket.authState && socket.authState.creds, 'authState absent du socket');
    assert.equal(socket.authState.creds.registrationId, auth.state.creds.registrationId);
    assert.equal(typeof socket.authState.keys.get, 'function');
    assert.equal(typeof socket.authState.keys.set, 'function');

    socket.ev.on('creds.update', auth.persistSoon);
    const code = await socket.requestPairingCode('50990000001');
    await auth.flush();
    const { creds: saved } = await store.snapshotAuthDir(auth.dir);
    assert.equal(saved.pairingCode, code);
    assert.equal(saved.me.id, '50990000001@s.whatsapp.net');
  } finally {
    await socket.end();
    await auth.close();
  }
});

test('le cache de clés Baileys lit et écrit à travers notre store', async () => {
  const auth = await createPersistentAuthState('50990000002', {
    logger,
    initCreds: initAuthCreds,
    flushDelayMs: 20
  });
  const keys = makeCacheableSignalKeyStore(auth.state.keys, logger);

  try {
    // Écriture via la couche de cache, comme le fait Baileys.
    await keys.set({
      'pre-key': { 11: { privateKey: 'dW5l', publicKey: 'ZGV1eA==' } },
      session: { '50947440869:3@s.whatsapp.net': { _sessions: { x: 1 } } }
    });
    await auth.flush();

    const onDisk = await store.readKeysFromDisk(auth.dir);
    assert.equal(onDisk.length, 2, `clés sur disque : ${onDisk.length}`);

    // Lecture : première fois depuis le store, ensuite depuis le cache.
    const first = await keys.get('pre-key', ['11']);
    assert.deepEqual(first['11'], { privateKey: 'dW5l', publicKey: 'ZGV1eA==' });

    const sessions = await keys.get('session', ['50947440869:3@s.whatsapp.net', 'inconnu@s.whatsapp.net']);
    assert.deepEqual(Object.keys(sessions), ['50947440869:3@s.whatsapp.net']);

    // Suppression via null, comme Baileys le fait pour une clé consommée.
    await keys.set({ 'pre-key': { 11: null } });
    await auth.flush();
    assert.equal((await store.readKeysFromDisk(auth.dir)).length, 1);
  } finally {
    await auth.close();
  }
});

test('les creds générés par initAuthCreds passent la validation du store', () => {
  assert.equal(store.credsLooksValid(initAuthCreds()), true);
});

test('les clés protobuf et binaires du nouveau fork survivent à un arrêt puis une restauration', async t => {
  const number = '50990000003';
  const initial = await createPersistentAuthState(number, { initCreds: initAuthCreds, logger });
  const key = baileys.proto.Message.AppStateSyncKeyData.fromObject({
    keyData: Buffer.alloc(32, 7),
    fingerprint: { rawId: 42, currentIndex: 1, deviceIndexes: [1, 2] },
    timestamp: 1700000000
  });
  try {
    await makeCacheableSignalKeyStore(initial.state.keys, logger).set({
      'app-state-sync-key': { 'key-one': key },
      'pre-key': { 12: { private: Buffer.alloc(32, 3), public: Buffer.alloc(32, 4) } }
    });
    await initial.flush();
  } finally { await initial.close(); }
  const restored = await createPersistentAuthState(number, {
    initCreds: initAuthCreds, logger,
    restoreKey: (type, value) => type === 'app-state-sync-key'
      ? baileys.proto.Message.AppStateSyncKeyData.fromObject(value) : value
  });
  try {
    assert.equal(restored.source, 'disque');
    assert.ok(Buffer.isBuffer(restored.state.creds.noiseKey.private));
    assert.ok(Buffer.isBuffer(restored.state.creds.signedPreKey.signature));
    const keys = makeCacheableSignalKeyStore(restored.state.keys, logger);
    const appState = (await keys.get('app-state-sync-key', ['key-one']))['key-one'];
    assert.ok(appState instanceof baileys.proto.Message.AppStateSyncKeyData);
    const decoded = appState;
    assert.deepEqual(Buffer.from(decoded.keyData), Buffer.alloc(32, 7));
    assert.deepEqual(decoded.fingerprint.deviceIndexes, [1, 2]);
    const preKey = (await keys.get('pre-key', ['12']))['12'];
    assert.deepEqual(preKey.private, Buffer.alloc(32, 3));
    assert.deepEqual(preKey.public, Buffer.alloc(32, 4));
    const { socket } = makeOfflineSocket(t, { auth: { creds: restored.state.creds, keys } });
    assert.match(await socket.requestPairingCode(number), /^[1-9A-HJ-NP-TV-Z]{8}$/);
    await socket.end();
  } finally { await restored.close(); }
});
