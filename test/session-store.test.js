'use strict';

/**
 * Tests de la couche disque des sessions : écriture atomique, lecture tolérante,
 * instantané creds + clés, et détection des creds corrompus.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// SESSIONS_DIR doit être posé AVANT le require : le module fige la racine au chargement.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-store-'));
process.env.SESSIONS_DIR = sandbox;

const store = require('../src/auth/session-store');

function validCreds(meId = '50947440869:12@s.whatsapp.net') {
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
    me: { id: meId, name: 'Kaido' },
    registered: true
  };
}

test('SESSIONS_DIR pointe sur le dossier de test, jamais sur tmp par défaut', () => {
  assert.equal(store.SESSIONS_ROOT, path.resolve(sandbox));
});

test('sanitizeNumber ne conserve que les chiffres', () => {
  assert.equal(store.sanitizeNumber('+509 474-408 69'), '50947440869');
  assert.equal(store.sanitizeNumber('50947440869:12@s.whatsapp.net'), '5094744086912');
  assert.equal(store.sanitizeNumber(''), '');
  assert.equal(store.sanitizeNumber(null), '');
});

test('sessionDir refuse un numéro vide', () => {
  assert.throws(() => store.sessionDir('   '), /invalide/);
  assert.equal(store.sessionDir('50947440869'), path.join(sandbox, '50947440869'));
});

test('writeJsonAtomic puis readJsonSafe font un aller-retour fidèle', async () => {
  const file = path.join(sandbox, 'roundtrip', 'creds.json');
  const value = validCreds();
  await store.writeJsonAtomic(file, value);
  assert.deepEqual(await store.readJsonSafe(file), value);
});

test('writeJsonAtomic ne laisse aucun fichier temporaire derrière lui', async () => {
  const dir = path.join(sandbox, 'no-tmp');
  const file = path.join(dir, 'creds.json');
  await store.writeJsonAtomic(file, { ok: true });
  const left = fs.readdirSync(dir);
  assert.deepEqual(left, ['creds.json'], `fichiers présents : ${left.join(', ')}`);
});

test('un creds.json tronqué est détecté au lieu de faire planter la lecture', async () => {
  const file = path.join(sandbox, 'corrupt', 'creds.json');
  await store.writeJsonAtomic(file, validCreds());
  // Simulation d'un kill en pleine écriture par l'ancien code non atomique.
  const raw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, raw.slice(0, Math.floor(raw.length / 2)));

  assert.equal(await store.readJsonSafe(file), null, 'un JSON tronqué doit renvoyer null');
});

test('readJsonSafe distingue absent (undefined) et corrompu (null)', async () => {
  assert.equal(await store.readJsonSafe(path.join(sandbox, 'absent.json')), undefined);
  const empty = path.join(sandbox, 'vide.json');
  fs.writeFileSync(empty, '');
  assert.equal(await store.readJsonSafe(empty), null);
});

test('les noms de fichiers de clés survivent aux JID contenant @ et :', () => {
  const samples = [
    ['session', '50947440869:12@s.whatsapp.net'],
    ['sender-key', '120363000000@g.us'],
    ['pre-key', '7'],
    ['app-state-sync-key', 'AAAAA'],
    ['sender-key-memory', '120363000000@g.us']
  ];
  for (const [type, id] of samples) {
    const name = store.keyFileName(type, id);
    assert.doesNotMatch(name, /[/:]/, `${name} contient un caractère interdit`);
    assert.deepEqual(store.parseKeyFileName(name), { type, id });
  }
  assert.equal(store.parseKeyFileName('bruit.txt'), null);
});

test('writeKeyToDisk / readKeysFromDisk font un aller-retour, null supprime', async () => {
  const dir = path.join(sandbox, '50900000001');
  await store.writeKeyToDisk(dir, 'pre-key', '1', { privateKey: 'aGk=' });
  await store.writeKeyToDisk(dir, 'session', '50947440869@s.whatsapp.net', { a: 1 });

  let keys = await store.readKeysFromDisk(dir);
  assert.equal(keys.length, 2);
  const session = keys.find((k) => k.type === 'session');
  assert.equal(session.id, '50947440869@s.whatsapp.net');
  assert.deepEqual(session.value, { a: 1 });

  await store.writeKeyToDisk(dir, 'pre-key', '1', null);
  keys = await store.readKeysFromDisk(dir);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].type, 'session');
});

test('snapshotAuthDir / restoreAuthDir reconstituent creds et clés à l’identique', async () => {
  const source = path.join(sandbox, '50900000002');
  const creds = validCreds('50900000002@s.whatsapp.net');
  await store.writeJsonAtomic(store.credsPath(source), creds);
  await store.writeKeyToDisk(source, 'pre-key', '3', { k: 'v' });
  await store.writeKeyToDisk(source, 'sender-key', '120363@g.us', { s: 'k' });

  const snapshot = await store.snapshotAuthDir(source);
  assert.deepEqual(snapshot.creds, creds);
  assert.equal(snapshot.keys.length, 2);

  const target = path.join(sandbox, '50900000003');
  await store.restoreAuthDir(target, snapshot);
  const restored = await store.snapshotAuthDir(target);
  assert.deepEqual(restored.creds, creds);
  assert.deepEqual(
    restored.keys.map((k) => store.keyRef(k.type, k.id)).sort(),
    snapshot.keys.map((k) => store.keyRef(k.type, k.id)).sort()
  );
});

test('credsLooksValid accepte des creds complets', () => {
  assert.equal(store.credsLooksValid(validCreds()), true);
});

test('credsLooksValid refuse chaque forme de creds tronqués', () => {
  const cases = [
    ['null', null],
    ['objet vide', {}],
    ['JSON partiel', { noiseKey: { private: 'a' } }],
    ['sans signedIdentityKey', { ...validCreds(), signedIdentityKey: undefined }],
    ['sans signedPreKey', { ...validCreds(), signedPreKey: undefined }],
    ['registrationId absent', { ...validCreds(), registrationId: undefined }],
    ['enregistré sans identité', { ...validCreds(), me: undefined, registered: true }]
  ];
  for (const [label, creds] of cases) {
    assert.equal(store.credsLooksValid(creds), false, `${label} devrait être refusé`);
  }
});

test('listLocalSessions ignore les dossiers qui ne sont pas des numéros', async () => {
  await fsp.mkdir(path.join(sandbox, '50911111111'), { recursive: true });
  await fsp.mkdir(path.join(sandbox, '_corrompu'), { recursive: true });
  await fsp.mkdir(path.join(sandbox, 'sauvegardes'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'notes.txt'), 'x');

  const found = await store.listLocalSessions();
  assert.ok(found.includes('50911111111'), `sessions trouvées : ${found.join(', ')}`);
  assert.ok(!found.includes('_corrompu'));
  assert.ok(!found.includes('sauvegardes'));
});

test('quarantineAuthDir déplace le dossier et écrit la raison', async () => {
  const dir = path.join(sandbox, '50922222222');
  await store.writeJsonAtomic(store.credsPath(dir), { casse: true });

  const target = await store.quarantineAuthDir(dir, 'creds invalides au démarrage');
  assert.ok(target, 'aucun dossier de quarantaine renvoyé');
  assert.equal(fs.existsSync(dir), false, 'le dossier d’origine doit avoir disparu');
  const raison = JSON.parse(fs.readFileSync(path.join(target, 'RAISON.json'), 'utf8'));
  assert.equal(raison.raison, 'creds invalides au démarrage');
});

test('removeAuthDir supprime le dossier sans erreur s’il est absent', async () => {
  const dir = path.join(sandbox, '50933333333');
  await store.writeJsonAtomic(store.credsPath(dir), { ok: true });
  await store.removeAuthDir(dir);
  assert.equal(fs.existsSync(dir), false);
  await assert.doesNotReject(store.removeAuthDir(dir));
});
