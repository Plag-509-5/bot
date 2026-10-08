'use strict';

/**
 * Tests de l'état d'authentification persistant : choix de la source au
 * démarrage, fusion disque/MongoDB, persistance des clés Signal, et mise en
 * quarantaine des creds corrompus.
 *
 * C'est le cœur du correctif « clé corrompue » : si ces tests passent, une
 * session survit à un redémarrage avec toutes ses clés Signal.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-auth-'));
process.env.SESSIONS_DIR = sandbox;

const store = require('../src/auth/session-store');
const {
  createPersistentAuthState,
  resolveAuthSource,
  AuthCorruptedError
} = require('../src/auth/persistent-auth');

let counter = 0;
function nextNumber() {
  counter += 1;
  return `509${String(10000000 + counter).slice(0, 8)}`;
}

function validCreds(meId) {
  return {
    noiseKey: { private: 'cHJpdmU=', public: 'cHVibGlj' },
    signedIdentityKey: { private: 'aWRlbnRpdHk=' },
    signedPreKey: {
      keyPair: { private: 'c3ByaXY=', public: 'c3BwdWI=' },
      signature: 'c2lnbmF0dXJl',
      keyId: 1
    },
    registrationId: 137,
    advSecretKey: 'YWR2LXNlY3JldA==',
    me: { id: meId || '50900000000@s.whatsapp.net', name: 'Kaido' },
    registered: true
  };
}

const initCreds = () => validCreds();

/** Backend mémoire qui imite l'interface MongoDB. */
function fakeBackend(options = {}) {
  const state = { creds: null, keys: new Map(), calls: [] };
  return {
    state,
    async load() {
      state.calls.push('load');
      if (options.failLoad) throw new Error('mongo indisponible');
      if (!state.creds && state.keys.size === 0) return null;
      return {
        creds: state.creds,
        keys: Array.from(state.keys.entries()).map(([ref, value]) => {
          const idx = ref.indexOf('/');
          return { type: ref.slice(0, idx), id: ref.slice(idx + 1), value };
        })
      };
    },
    async saveCreds(_number, creds) {
      state.calls.push('saveCreds');
      if (options.failSave) throw new Error('mongo indisponible');
      state.creds = creds;
    },
    async saveKeys(_number, entries) {
      state.calls.push('saveKeys');
      if (options.failSave) throw new Error('mongo indisponible');
      for (const { ref, value } of entries) {
        if (value === null || value === undefined) state.keys.delete(ref);
        else state.keys.set(ref, value);
      }
    },
    async remove() {
      state.calls.push('remove');
      state.creds = null;
      state.keys.clear();
    }
  };
}

const quiet = { warn() {}, info() {}, error() {} };

test('sans état existant, une nouvelle session est créée via initCreds', async () => {
  const number = nextNumber();
  const auth = await createPersistentAuthState(number, { initCreds, logger: quiet, flushDelayMs: 1 });
  assert.equal(auth.source, 'nouvelle');
  assert.equal(store.credsLooksValid(auth.state.creds), true);
  assert.equal(auth.keyCount(), 0);
  await auth.close();
});

test('sans état ni initCreds, on obtient une erreur explicite et pas un crash', async () => {
  const number = nextNumber();
  await assert.rejects(
    createPersistentAuthState(number, { logger: quiet }),
    /initCreds/
  );
});

test('saveCreds écrit creds.json de façon atomique et prévient le backend', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const auth = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });

  await auth.saveCreds();

  const onDisk = JSON.parse(fs.readFileSync(store.credsPath(auth.dir), 'utf8'));
  assert.deepEqual(onDisk, auth.state.creds);
  assert.deepEqual(backend.state.creds, auth.state.creds);
  assert.equal(auth.pendingWrites(), 0);
  await auth.close();
});

test('les clés Signal sont écrites sur disque ET dans le backend', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const auth = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });

  await auth.state.keys.set({
    'pre-key': { 1: { privateKey: 'aGk=' } },
    session: { '50947440869:3@s.whatsapp.net': { ratchet: 'abc' } }
  });
  await auth.flush();

  const onDisk = await store.readKeysFromDisk(auth.dir);
  assert.equal(onDisk.length, 2, `clés sur disque : ${onDisk.length}`);
  assert.equal(backend.state.keys.size, 2, 'les clés doivent aussi partir dans le backend');
  assert.ok(backend.state.keys.has('session/50947440869:3@s.whatsapp.net'));

  const read = await auth.state.keys.get('session', ['50947440869:3@s.whatsapp.net']);
  assert.deepEqual(read['50947440869:3@s.whatsapp.net'], { ratchet: 'abc' });
  await auth.close();
});

test('poser null sur une clé la supprime du disque, du cache et du backend', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const auth = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });

  await auth.state.keys.set({ 'pre-key': { 1: { a: 1 }, 2: { b: 2 } } });
  await auth.flush();
  assert.equal(auth.keyCount(), 2);

  await auth.state.keys.set({ 'pre-key': { 1: null } });
  await auth.flush();

  assert.equal(auth.keyCount(), 1);
  assert.equal((await store.readKeysFromDisk(auth.dir)).length, 1);
  assert.equal(backend.state.keys.has('pre-key/1'), false);
  assert.deepEqual(await auth.state.keys.get('pre-key', ['1']), {});
  await auth.close();
});

test('une session se recharge intégralement depuis le disque', async () => {
  const number = nextNumber();
  const first = await createPersistentAuthState(number, { initCreds, logger: quiet, flushDelayMs: 1 });
  await first.state.keys.set({ 'sender-key': { '120363@g.us': { sk: 'valeur' } } });
  await first.saveCreds();
  await first.flush();
  const credsAvant = first.state.creds;
  await first.close();

  const second = await createPersistentAuthState(number, { initCreds, logger: quiet, flushDelayMs: 1 });
  assert.equal(second.source, 'disque');
  assert.deepEqual(second.state.creds, credsAvant);
  assert.equal(second.keyCount(), 1);
  assert.deepEqual(
    (await second.state.keys.get('sender-key', ['120363@g.us']))['120363@g.us'],
    { sk: 'valeur' }
  );
  await second.close();
});

test('disque perdu : la session est restaurée depuis le backend, clés comprises', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const first = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  await first.state.keys.set({ 'pre-key': { 5: { z: 1 } }, session: { '50947440869@s.whatsapp.net': { r: 1 } } });
  await first.saveCreds();
  await first.flush();
  const creds = first.state.creds;
  await first.close();

  // Le conteneur redémarre : le disque est vidé, MongoDB reste.
  await store.removeAuthDir(first.dir);

  const second = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  assert.equal(second.source, 'mongodb');
  assert.deepEqual(second.state.creds, creds);
  assert.equal(second.keyCount(), 2, 'les clés Signal doivent survivre à la perte du disque');
  // Et elles sont recopiées sur disque pour le prochain démarrage.
  assert.equal((await store.readKeysFromDisk(second.dir)).length, 2);
  await second.close();
});

test('disque partiel : les clés manquantes sont complétées depuis le backend', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const first = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  await first.state.keys.set({ 'pre-key': { 1: { a: 1 }, 2: { b: 2 } } });
  await first.saveCreds();
  await first.flush();
  await first.close();

  // Une clé disparaît du disque (nettoyage tmp partiel, disque plein, …).
  await store.writeKeyToDisk(first.dir, 'pre-key', '2', null);

  const second = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  assert.equal(second.source, 'disque+mongodb');
  assert.equal(second.keyCount(), 2);
  assert.deepEqual((await second.state.keys.get('pre-key', ['2']))['2'], { b: 2 });
  await second.close();
});

test('creds disque corrompus : on repart du backend au lieu de tout perdre', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const first = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  await first.saveCreds();
  await first.flush();
  const creds = first.state.creds;
  await first.close();

  const raw = fs.readFileSync(store.credsPath(first.dir), 'utf8');
  fs.writeFileSync(store.credsPath(first.dir), raw.slice(0, raw.length / 2));

  const second = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  assert.equal(second.source, 'mongodb');
  assert.deepEqual(second.state.creds, creds);
  await second.close();
});

test('creds corrompus partout : erreur explicite + quarantaine, jamais un usage silencieux', async () => {
  const number = nextNumber();
  const backend = fakeBackend();
  const dir = store.sessionDir(number);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(store.credsPath(dir), '{"noiseKey":{"priv');
  backend.state.creds = { tronque: true };

  await assert.rejects(
    createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 }),
    (err) => {
      assert.ok(err instanceof AuthCorruptedError);
      assert.match(err.message, /re-pairing|nouvel appairage/i);
      return true;
    }
  );
  assert.equal(fs.existsSync(dir), false, 'le dossier corrompu doit être mis en quarantaine');
  assert.ok(fs.existsSync(path.join(store.SESSIONS_ROOT, '_corrompu')));
});

test('un backend injoignable ne bloque pas le démarrage', async () => {
  const number = nextNumber();
  const first = await createPersistentAuthState(number, { initCreds, logger: quiet, flushDelayMs: 1 });
  await first.state.keys.set({ 'pre-key': { 9: { q: 1 } } });
  await first.saveCreds();
  await first.flush();
  await first.close();

  const backend = fakeBackend({ failLoad: true });
  const second = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });
  assert.equal(second.source, 'disque');
  assert.equal(second.keyCount(), 1);
  await second.close();
});

test('un échec d’écriture backend garde les écritures en attente pour retenter', async () => {
  const number = nextNumber();
  const backend = fakeBackend({ failSave: true });
  const auth = await createPersistentAuthState(number, { backend, initCreds, logger: quiet, flushDelayMs: 1 });

  await auth.state.keys.set({ 'pre-key': { 4: { v: 1 } } });
  await auth.flush();

  assert.ok(auth.pendingWrites() >= 1, 'les clés doivent rester en attente après un échec');
  // Le disque, lui, a bien été écrit.
  assert.equal((await store.readKeysFromDisk(auth.dir)).length, 1);
  await auth.close();
});

test('resolveAuthSource refuse de mélanger deux identités différentes', () => {
  const local = { creds: validCreds('50911111111@s.whatsapp.net'), keys: [{ type: 'pre-key', id: '1', value: { a: 1 } }] };
  const remote = { creds: validCreds('50922222222@s.whatsapp.net'), keys: [{ type: 'pre-key', id: '9', value: { z: 9 } }] };

  const resolved = resolveAuthSource({ local, remote });
  assert.equal(resolved.source, 'disque');
  assert.equal(resolved.keys.length, 1, 'les clés d’une autre identité ne doivent pas être fusionnées');
  assert.equal(resolved.keys[0].id, '1');
});

test('resolveAuthSource signale la corruption quand rien n’est valide', () => {
  assert.equal(resolveAuthSource({ local: null, remote: null }).source, 'nouvelle');
  assert.equal(resolveAuthSource({ local: { creds: { casse: 1 } }, remote: null }).source, 'corrompue');
});
