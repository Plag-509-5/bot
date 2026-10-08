'use strict';

/**
 * Garde-fous sur le câblage de pair.js.
 *
 * Ces assertions figent les correctifs de la « clé corrompue » : si quelqu'un
 * réintroduit un des motifs qui cassaient les sessions, le test échoue.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
const packageJson = require('../package.json');

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * Source privée de ses lignes de commentaire : les garde-fous ci-dessous
 * cherchent du CODE interdit, et les commentaires qui expliquent l'ancien
 * comportement ne doivent pas les faire échouer.
 */
const code = source
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  })
  .join('\n');

test('pair.js utilise l’état d’authentification persistant, plus useMultiFileAuthState', () => {
  assert.match(source, /createPersistentAuthState\(/);

  // On inspecte le bloc d'import Baileys lui-même : `useMultiFileAuthState`
  // écrit creds.json de façon non atomique et ne persiste aucune clé Signal.
  const importStart = source.indexOf('const {\n  default: makeWASocket');
  const importEnd = source.indexOf("} = require('@whiskeysockets/baileys');");
  assert.ok(importStart > 0 && importEnd > importStart, 'bloc d’import Baileys introuvable');
  const baileysImport = source.slice(importStart, importEnd);
  assert.doesNotMatch(baileysImport, /useMultiFileAuthState/);
  assert.match(baileysImport, /initAuthCreds/);

  assert.match(source, /createMongoAuthBackend\(/);
  assert.match(source, /initCreds:\s*initAuthCreds/);
});

test('les sessions ne sont plus créées dans le dossier temporaire', () => {
  assert.doesNotMatch(
    code,
    /path\.join\(os\.tmpdir\(\),\s*`session_\$\{sanitizedNumber\}`\)/,
    'la session doit vivre dans sessions/<numéro>, pas dans tmp'
  );
  assert.match(source, /sessionStore\.sessionDir\(/);
});

test('le champ keys fantôme (state.keys sérialisé) a disparu', () => {
  // `state.keys` est un objet de fonctions : JSON.stringify en faisait `{}`.
  assert.doesNotMatch(
    code,
    /saveCredsToMongo\([^)]*state\.keys/,
    'state.keys ne doit plus être passé à saveCredsToMongo'
  );
  assert.match(source, /creds\.update['"]?,\s*\(\)\s*=>\s*\{?\s*auth\.persistSoon\(\)/);
});

test('une seule reconnexion est programmée par fermeture de connexion', () => {
  assert.equal(
    occurrences(source, 'reconnectScheduler.schedule('),
    1,
    'deux gestionnaires qui reconnectent = deux sockets sur la même identité'
  );
  // L'ancien setTimeout de reconnexion fixe à 5 s dans EmpirePair doit avoir disparu.
  assert.doesNotMatch(code, /Reconnexion automatique dans 5 secondes/);
});

test('l’arrêt du processus ne supprime plus les dossiers de session', () => {
  // lastIndexOf : il existe aussi un petit gestionnaire 'exit' en tête de fichier.
  const exitBlock = source.slice(
    source.lastIndexOf("process.on('exit'"),
    source.indexOf('let shuttingDown')
  );
  assert.ok(exitBlock.length > 0, 'bloc process.on(exit) introuvable');
  assert.doesNotMatch(
    exitBlock,
    /removeSync|removeAuthDir/,
    "process.on('exit') ne doit supprimer aucune session"
  );
  assert.match(source, /process\.on\('SIGTERM'/);
  assert.match(source, /process\.on\('SIGINT'/);
  assert.match(source, /auth\.close\(\)/);
});

test('chaque envoi du bot passe par la vérification de connexion', () => {
  assert.match(source, /installSafeSend\(socket\)/);
  // installSafeSend doit précéder le wrapper de thème, qui capture sendMessage.
  const safeAt = source.indexOf('installSafeSend(socket)');
  const themeAt = source.indexOf('setupCommandThemeWrapper(socket)');
  assert.ok(safeAt > 0 && themeAt > 0, 'les deux wrappers doivent être présents');
  assert.ok(safeAt < themeAt, 'installSafeSend doit être posé avant le wrapper de thème');
});

test('un socket résiduel est fermé avant d’en ouvrir un nouveau', () => {
  const empirePair = source.slice(source.indexOf('async function EmpirePair('));
  const makeSocketAt = empirePair.indexOf('makeWASocket({');
  const leftoverAt = empirePair.indexOf('leftover.ws?.close()');
  assert.ok(makeSocketAt > 0 && leftoverAt > 0);
  assert.ok(leftoverAt < makeSocketAt, 'la fermeture du socket résiduel doit précéder makeWASocket');
});

test('le démontage de session passe par un point d’entrée unique', () => {
  assert.match(source, /async function deleteSessionAndCleanup\(/);
  // Commandes WhatsApp + API : au moins 3 appelants.
  assert.ok(
    occurrences(source, 'deleteSessionAndCleanup(') >= 4,
    'toutes les suppressions de session doivent passer par deleteSessionAndCleanup'
  );
  assert.match(source, /authBackend\.remove\(sanitized\)/);
});

test('le bot dépend de wileys et d’aucun autre fork Baileys', () => {
  const baileys = packageJson.dependencies['@whiskeysockets/baileys'];
  assert.equal(baileys, 'npm:wileys@^0.7.8');

  const forbidden = [
    '@rexxhayanasi/elaina-baileys',
    '@ryuu-reinzz/baileys',
    'baileyz',
    'baileys'
  ];
  for (const name of forbidden) {
    assert.equal(
      packageJson.dependencies[name],
      undefined,
      `le fork ${name} ne doit plus être installé`
    );
  }
  // Deux bibliothèques Baileys en parallèle = deux implémentations du protocole
  // Signal pour le même compte.
  assert.doesNotMatch(code, /require\('@rexxhayanasi\/elaina-baileys'\)/);
  assert.doesNotMatch(code, /require\('@ryuu-reinzz\/baileys'\)/);
});

test('dotenv et body-parser sont déclarés (ils sont requis au démarrage)', () => {
  assert.ok(packageJson.dependencies.dotenv, 'index.js fait require(\'dotenv\').config()');
  assert.ok(packageJson.dependencies['body-parser'], 'index.js fait require(\'body-parser\')');
});

test('.npmrc neutralise le conflit de peer jimp imposé par wileys', () => {
  const npmrc = fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
  assert.match(npmrc, /legacy-peer-deps=true/);
});

test('.gitignore exclut le dossier de sessions sans masquer src/auth', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/sessions\/$/m, 'les creds ne doivent jamais être committés');
  // Piège déjà rencontré : un « auth/ » non ancré ignore aussi src/auth/,
  // donc tout le correctif de persistance disparaîtrait du dépôt.
  const lignes = gitignore.split('\n').map((l) => l.trim());
  assert.ok(!lignes.includes('auth/'), 'une règle « auth/ » masquerait src/auth/');
});
