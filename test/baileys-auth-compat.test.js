'use strict';

/** Contrat local entre le store MongoDB et le Baileys officiel. */

const test = require('node:test');
const assert = require('node:assert/strict');
const pino = require('pino');

const baileys = require('@whiskeysockets/baileys');
const {
  default: makeWASocket,
  initAuthCreds,
  makeCacheableSignalKeyStore
} = baileys;
const { createMongoAuthState } = require('../src/auth/mongo-auth-state');
const { cloneAuthValue } = require('../src/auth/mongo-auth-backend');

function backend() {
  const state = { creds: null, keys: new Map() };
  return {
    state,
    async load() {
      if (!state.creds) return null;
      return {
        creds: cloneAuthValue(state.creds),
        keys: Array.from(state.keys.entries()).map(([ref, value]) => {
          const slash = ref.indexOf('/');
          return { type: ref.slice(0, slash), id: ref.slice(slash + 1), value: cloneAuthValue(value) };
        })
      };
    },
    async saveCreds(_number, creds) { state.creds = cloneAuthValue(creds); },
    async saveKeys(_number, entries) {
      for (const { ref, value } of entries) {
        if (value === null || value === undefined) state.keys.delete(ref);
        else state.keys.set(ref, cloneAuthValue(value));
      }
    },
    async remove() { state.creds = null; state.keys.clear(); }
  };
}

const logger = pino({ level: 'silent' });

test('le paquet installé est le Baileys officiel et expose les APIs utilisées', () => {
  const metadata = require('@whiskeysockets/baileys/package.json');
  assert.equal(metadata.name, '@whiskeysockets/baileys');
  assert.equal(metadata.version, '7.0.0-rc14');

  for (const name of [
    'default',
    'initAuthCreds',
    'makeCacheableSignalKeyStore',
    'BufferJSON',
    'jidNormalizedUser',
    'delay',
    'getContentType',
    'downloadContentFromMessage',
    'generateWAMessageFromContent',
    'generateWAMessageContent',
    'proto'
  ]) {
    assert.ok(name in baileys, `export Baileys officiel manquant : ${name}`);
  }
});

test('makeWASocket accepte l’état MongoDB sans créer de session locale', async () => {
  const auth = await createMongoAuthState('50990000001', {
    backend: backend(),
    logger,
    initCreds: initAuthCreds
  });

  const socket = makeWASocket({
    auth: {
      creds: auth.state.creds,
      keys: auth.state.keys
    },
    printQRInTerminal: false,
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    connectTimeoutMs: 1000
  });

  try {
    assert.equal(typeof socket.sendMessage, 'function');
    assert.equal(socket.authState.creds.registrationId, auth.state.creds.registrationId);
    assert.equal(typeof socket.authState.keys.get, 'function');
    assert.equal(typeof socket.authState.keys.set, 'function');
    assert.equal(typeof socket.authState.keys.transaction, 'function');

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      timer.unref?.();
      socket.ev.on('connection.update', (update) => {
        if (update.connection === 'open' || update.connection === 'close') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } finally {
    try { socket.end?.(undefined, 'test local'); } catch (_) {}
    await new Promise((resolve) => setImmediate(resolve));
    await auth.close();
  }
});

test('le cache de clés officiel écrit et lit à travers MongoDB', async () => {
  const store = backend();
  const auth = await createMongoAuthState('50990000002', {
    backend: store,
    logger,
    initCreds: initAuthCreds
  });
  const keys = makeCacheableSignalKeyStore(auth.state.keys, logger);

  await keys.set({
    'pre-key': { 11: { privateKey: Buffer.from('une'), publicKey: Buffer.from('deux') } },
    session: { '50947440869:3@s.whatsapp.net': { _sessions: { x: 1 } } }
  });

  assert.equal(store.state.keys.size, 2);
  const first = await keys.get('pre-key', ['11']);
  assert.equal(first['11'].privateKey.toString(), 'une');

  await keys.set({ 'pre-key': { 11: null } });
  assert.equal(store.state.keys.has('pre-key/11'), false);
  await auth.close();
});
