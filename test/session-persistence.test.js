'use strict';

/** Garde-fous : auth MongoDB seule et paquet Baileys officiel. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pairPath = path.join(root, 'src', 'core', 'pair.js');
const source = fs.readFileSync(pairPath, 'utf8');
const packageJson = require('../package.json');
const code = source
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  })
  .join('\n');

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('pair.js utilise l’état MongoDB et jamais useMultiFileAuthState', () => {
  assert.match(source, /createMongoAuthState\(/);
  assert.match(source, /createMongoAuthBackend\(/);
  assert.match(source, /initCreds:\s*initAuthCreds/);
  assert.doesNotMatch(code, /useMultiFileAuthState/);
  assert.doesNotMatch(code, /createPersistentAuthState/);
  assert.doesNotMatch(code, /sessionStore|SESSIONS_DIR/);
});

test('aucun module de session locale ne subsiste', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'auth', 'session-store.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'src', 'auth', 'persistent-auth.js')), false);
  assert.doesNotMatch(code, /creds\.json|sessionDir\(|listLocalSessions|removeAuthDir/);
  assert.match(source, /stockageSessions:\s*'mongodb'/);
});

test('MONGO_URI est obligatoire et aucun secret MongoDB n’est codé en dur', () => {
  assert.match(source, /createMongoConnection\(\)/);
  assert.doesNotMatch(source, /mongodb\+srv:\/\/[^\s'"`]+:[^\s'"`]+@/);
  assert.doesNotMatch(code, /initMongo\(\)\.catch\(\(\)\s*=>\s*\{?\}?\)/);
  assert.match(source, /error: 'mongodb_indisponible'/);
});

test('le Baileys officiel est épinglé directement, sans alias ni fork', () => {
  assert.equal(packageJson.dependencies['@whiskeysockets/baileys'], '7.0.0-rc14');
  assert.equal(require('@whiskeysockets/baileys/package.json').name, '@whiskeysockets/baileys');
  assert.equal(require('@whiskeysockets/baileys/package.json').version, '7.0.0-rc14');

  // `wileys` est une exception volontaire, limitée aux helpers de construction
  // des statuts de groupe (.swgc). Le reste des forks reste interdit.
  for (const forbidden of [
    '@rexxhayanasi/elaina-baileys',
    '@ryuu-reinzz/baileys',
    'baileyz',
    'baileys'
  ]) {
    assert.equal(packageJson.dependencies[forbidden], undefined, `fork interdit : ${forbidden}`);
  }
  assert.doesNotMatch(packageJson.dependencies['@whiskeysockets/baileys'], /^npm:/);
  assert.equal(packageJson.dependencies.wileys, '0.7.8', 'wileys doit être épinglé en version exacte');

  // libsignal doit rester celui de Baileys officiel, même si wileys le déclare.
  assert.equal(
    packageJson.overrides?.libsignal,
    'github:whiskeysockets/libsignal-node#bcea72df9ec34d9d9140ab30619cf479c7c144c7'
  );
});

test('les creds et clés sont sauvegardés par les APIs MongoDB dédiées', () => {
  const state = fs.readFileSync(path.join(root, 'src', 'auth', 'mongo-auth-state.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'src', 'auth', 'mongo-auth-backend.js'), 'utf8');
  assert.match(state, /backend\.saveCreds/);
  assert.match(state, /backend\.saveKeys/);
  assert.match(backend, /BufferJSON\.replacer/);
  assert.match(backend, /BufferJSON\.reviver/);
  assert.match(backend, /session_keys/);
  assert.doesNotMatch(state, /node:fs|fs-extra|node:os|SESSIONS_DIR/);
});

test('une seule reconnexion est programmée par fermeture', () => {
  assert.equal(occurrences(source, 'reconnectScheduler.schedule('), 1);
  assert.doesNotMatch(code, /Reconnexion automatique dans 5 secondes/);
});

test('un socket résiduel est fermé avant d’en ouvrir un nouveau', () => {
  const empirePair = source.slice(source.indexOf('async function EmpirePair('));
  const makeSocketAt = empirePair.indexOf('makeWASocket({');
  const leftoverAt = empirePair.indexOf('leftover.ws?.close()');
  assert.ok(makeSocketAt > 0 && leftoverAt > 0);
  assert.ok(leftoverAt < makeSocketAt);
});

test('chaque envoi passe par le garde-fou de connexion', () => {
  const safeAt = source.indexOf('installSafeSend(socket)');
  const themeAt = source.indexOf('setupCommandThemeWrapper(socket)');
  assert.ok(safeAt > 0 && themeAt > safeAt);
});

test('la suppression de session retire MongoDB via un point d’entrée unique', () => {
  assert.match(source, /async function deleteSessionAndCleanup\(/);
  assert.ok(occurrences(source, 'deleteSessionAndCleanup(') >= 4);
  assert.match(source, /authBackend\.remove\(sanitized\)/);
  assert.doesNotMatch(code, /removeSessionFromMongo/);
});

test('l’arrêt vide les écritures puis ferme la connexion MongoDB', () => {
  assert.match(source, /process\.on\('SIGTERM'/);
  assert.match(source, /process\.on\('SIGINT'/);
  assert.match(source, /auth\.close\(\)/);
  assert.match(source, /mongoConnection\.close\(\)/);
});

test('les fonctions de traduction réutilisent le pool MongoDB central', () => {
  const translation = fs.readFileSync(path.join(root, 'src', 'features', 'translation.js'), 'utf8');
  assert.match(source, /configureTranslationStorage\(\{/);
  assert.doesNotMatch(translation, /new MongoClient|mongodb\+srv:\/\//);
  assert.match(translation, /getDbProvider/);
});

test('le script de test MongoDB est exposé par npm', () => {
  assert.equal(packageJson.scripts['mongo:check'], 'node scripts/check-mongodb.js');
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'check-mongodb.js')), true);
});

test('dotenv et body-parser restent déclarés', () => {
  assert.ok(packageJson.dependencies.dotenv);
  assert.ok(packageJson.dependencies['body-parser']);
});

test('.npmrc documente le peer optionnel du Baileys officiel', () => {
  const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
  assert.match(npmrc, /Baileys officiel/);
  assert.match(npmrc, /legacy-peer-deps=true/);
  assert.doesNotMatch(npmrc, /Wileys/);
});
