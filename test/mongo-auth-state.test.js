'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initAuthCreds, proto } = require('@whiskeysockets/baileys');

const {
  createMongoAuthState,
  MongoAuthCorruptedError
} = require('../src/auth/mongo-auth-state');
const { cloneAuthValue } = require('../src/auth/mongo-auth-backend');
const { credsLooksValid } = require('../src/auth/auth-utils');

const initCreds = initAuthCreds;

function newCreds(number = '') {
  const creds = initAuthCreds();
  if (number) {
    creds.registered = true;
    creds.me = { id: `${number}@s.whatsapp.net`, name: 'Kaido' };
  }
  return creds;
}

function memoryBackend(options = {}) {
  const state = { creds: null, keys: new Map(), calls: [] };
  return {
    state,
    async load() {
      state.calls.push('load');
      if (options.failLoad) throw new Error('mongo indisponible');
      if (!state.creds && state.keys.size === 0) return null;
      return {
        creds: state.creds ? cloneAuthValue(state.creds) : null,
        keys: Array.from(state.keys.entries()).map(([ref, value]) => {
          const slash = ref.indexOf('/');
          return {
            type: ref.slice(0, slash),
            id: ref.slice(slash + 1),
            value: cloneAuthValue(value)
          };
        }),
        needsMigration: Boolean(options.needsMigration)
      };
    },
    async saveCreds(_number, creds) {
      state.calls.push('saveCreds');
      if (options.failSaveCreds) throw new Error('écriture creds impossible');
      if (options.beforeSaveCreds) await options.beforeSaveCreds();
      state.creds = cloneAuthValue(creds);
    },
    async saveKeys(_number, entries) {
      state.calls.push('saveKeys');
      if (options.failSaveKeys) throw new Error('écriture clés impossible');
      if (options.beforeSaveKeys) await options.beforeSaveKeys();
      for (const { ref, value } of entries) {
        if (value === null || value === undefined) state.keys.delete(ref);
        else state.keys.set(ref, cloneAuthValue(value));
      }
    },
    async remove() {
      state.calls.push('remove');
      state.creds = null;
      state.keys.clear();
    }
  };
}

const quiet = { info() {}, warn() {}, error() {} };
let sequence = 0;
function nextNumber() {
  sequence += 1;
  return `509${String(10000000 + sequence).slice(0, 8)}`;
}

test('une nouvelle session est créée directement dans MongoDB', async () => {
  const backend = memoryBackend();
  const auth = await createMongoAuthState(nextNumber(), {
    backend,
    initCreds,
    logger: quiet
  });

  assert.equal(auth.source, 'nouvelle');
  assert.equal(credsLooksValid(auth.state.creds), true);
  assert.ok(backend.state.creds, 'les creds initiaux doivent être durables avant le retour');
  assert.deepEqual(backend.state.calls.slice(0, 2), ['load', 'saveCreds']);
  assert.equal('dir' in auth, false, 'aucun chemin de session local ne doit être exposé');
  await auth.close();
});

test('le backend MongoDB est obligatoire et ses erreurs ne déclenchent aucun fallback', async () => {
  await assert.rejects(
    createMongoAuthState(nextNumber(), { backend: null, initCreds }),
    /Backend MongoDB invalide/
  );
  await assert.rejects(
    createMongoAuthState(nextNumber(), {
      backend: memoryBackend({ failLoad: true }),
      initCreds,
      logger: quiet
    }),
    /mongo indisponible/
  );
});

test('une session complète est rechargée uniquement depuis MongoDB', async () => {
  const number = nextNumber();
  const backend = memoryBackend();
  backend.state.creds = newCreds(number);
  backend.state.keys.set('session/50947440869:3@s.whatsapp.net', {
    ratchet: Buffer.from('signal')
  });

  const auth = await createMongoAuthState(number, { backend, initCreds, logger: quiet });
  assert.equal(auth.source, 'mongodb');
  assert.equal(auth.keyCount(), 1);
  const result = await auth.state.keys.get('session', ['50947440869:3@s.whatsapp.net']);
  assert.ok(Buffer.isBuffer(result['50947440869:3@s.whatsapp.net'].ratchet));
  assert.equal(result['50947440869:3@s.whatsapp.net'].ratchet.toString(), 'signal');
  await auth.close();
});

test('les écritures de clés sont write-through et les suppressions sont durables', async () => {
  const backend = memoryBackend();
  const auth = await createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet });

  await auth.state.keys.set({
    'pre-key': { 1: { private: Buffer.from('a') }, 2: { private: Buffer.from('b') } },
    session: { '50947440869@s.whatsapp.net': { ratchet: Buffer.from('c') } }
  });
  assert.equal(backend.state.keys.size, 3);
  assert.equal(auth.keyCount(), 3);
  assert.equal(auth.pendingWrites(), 0);

  await auth.state.keys.set({ 'pre-key': { 1: null } });
  assert.equal(backend.state.keys.has('pre-key/1'), false);
  assert.equal(auth.keyCount(), 2);
  assert.deepEqual(await auth.state.keys.get('pre-key', ['1']), {});
  await auth.close();
});

test('une écriture MongoDB ratée ne valide pas la clé dans le cache', async () => {
  const backend = memoryBackend({ failSaveKeys: true });
  const auth = await createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet });

  await assert.rejects(
    auth.state.keys.set({ 'pre-key': { 1: { a: 1 } } }),
    /écriture clés impossible/
  );
  assert.equal(auth.keyCount(), 0);
  assert.equal(backend.state.keys.size, 0);
  await auth.close();
});

test('saveCreds photographie les creds au moment de l’appel', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let delayed = false;
  const backend = memoryBackend({
    async beforeSaveCreds() {
      if (delayed) await gate;
    }
  });
  const auth = await createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet });

  delayed = true;
  auth.state.creds.pairingCode = 'AVANT';
  const saving = auth.saveCreds();
  auth.state.creds.pairingCode = 'APRES';
  release();
  await saving;

  assert.equal(backend.state.creds.pairingCode, 'AVANT');
  await auth.close();
});

test('close peut retenter la sauvegarde après une panne MongoDB', async () => {
  const backend = memoryBackend();
  const originalSave = backend.saveCreds.bind(backend);
  let unavailable = false;
  backend.saveCreds = async (...args) => {
    if (unavailable) throw new Error('mongo temporairement hors ligne');
    return originalSave(...args);
  };
  const auth = await createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet });

  unavailable = true;
  await assert.rejects(auth.close(), /temporairement hors ligne/);
  unavailable = false;
  await assert.doesNotReject(auth.close());
});

test('une session MongoDB structurellement invalide est refusée explicitement', async () => {
  const backend = memoryBackend();
  backend.state.creds = { registered: true, me: { id: 'cassé@s.whatsapp.net' } };

  await assert.rejects(
    createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet }),
    (error) => {
      assert.ok(error instanceof MongoAuthCorruptedError);
      assert.equal(error.code, 'MONGODB_AUTH_CORRUPTED');
      return true;
    }
  );
});

test('l’ancien format est réécrit en BufferJSON au chargement', async () => {
  const number = nextNumber();
  const backend = memoryBackend({ needsMigration: true });
  backend.state.creds = newCreds(number);
  backend.state.keys.set('pre-key/1', { private: Buffer.from('legacy') });

  const auth = await createMongoAuthState(number, { backend, initCreds, logger: quiet });
  assert.ok(backend.state.calls.includes('saveKeys'));
  assert.equal(backend.state.calls.filter((call) => call === 'saveCreds').length, 1);
  await auth.close();
});

test('app-state-sync-key est reconstruit avec le type protobuf attendu', async () => {
  const backend = memoryBackend();
  const auth = await createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet });
  await auth.state.keys.set({
    'app-state-sync-key': {
      abc: { keyData: Buffer.from('secret'), fingerprint: { rawId: 1 } }
    }
  });

  const value = (await auth.state.keys.get('app-state-sync-key', ['abc'])).abc;
  assert.ok(value instanceof proto.Message.AppStateSyncKeyData);
  assert.ok(Buffer.isBuffer(value.keyData));
  await auth.close();
});

test('discard attend une écriture en vol puis interdit toute résurrection', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const backend = memoryBackend({ beforeSaveKeys: () => gate });
  const auth = await createMongoAuthState(nextNumber(), { backend, initCreds, logger: quiet });

  const writing = auth.state.keys.set({ 'pre-key': { 1: { a: 1 } } });
  assert.equal(auth.pendingWrites(), 1);
  const discarding = auth.discard();
  release();
  await Promise.all([writing, discarding]);

  assert.equal(auth.keyCount(), 0);
  await assert.rejects(auth.saveCreds(), /déjà fermé/);
});
