'use strict';

/**
 * Test d'intégration : notre état d'authentification persistant est-il accepté
 * par le `makeWASocket` de wileys, et le cache de clés de Baileys
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
  default: makeWASocket,
  initAuthCreds,
  makeCacheableSignalKeyStore
} = baileys;
const pino = require('pino');

const { createPersistentAuthState } = require('../src/auth/persistent-auth');
const store = require('../src/auth/session-store');

const logger = pino({ level: 'silent' });

test('wileys expose bien ce dont le bot a besoin', () => {
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
    assert.ok(name in baileys, `export manquant dans wileys : ${name}`);
  }
});

test('makeWASocket accepte l’état d’authentification persistant', async () => {
  const auth = await createPersistentAuthState('50990000001', {
    logger,
    initCreds: initAuthCreds,
    flushDelayMs: 20
  });
  assert.equal(auth.source, 'nouvelle');
  assert.equal(store.credsLooksValid(auth.state.creds), true);

  const socket = makeWASocket({
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

    // On laisse la websocket aboutir (ouverte, ou fermée faute de réseau) avant
    // de la fermer : fermer une socket encore en CONNECTING lève une exception.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      if (typeof timer.unref === 'function') timer.unref();
      socket.ev.on('connection.update', (update) => {
        if (update.connection === 'open' || update.connection === 'close') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } finally {
    try { socket.end?.(undefined, 'test'); } catch (e) { /* déjà fermée */ }
    await new Promise((resolve) => setImmediate(resolve));
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
