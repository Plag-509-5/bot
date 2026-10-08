'use strict';

/**
 * Garde-fous sur le câblage de l'appairage dans pair.js.
 *
 * Ces assertions figent le correctif du « code indisponible » : chaque chemin
 * d'échec doit purger la session et relâcher le verrou, et un socket
 * d'appairage ne doit jamais être pris pour une session connectée.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
const pairHtml = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard', 'pages', 'pair.html'),
  'utf8'
);

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Source sans les lignes de commentaire (les commentaires citent l'ancien code). */
const code = source
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  })
  .join('\n');

test('l’ancien verrou à libération automatique a disparu', () => {
  assert.doesNotMatch(code, /connectingSessions/, 'le Set connectingSessions ne doit plus exister');
  assert.doesNotMatch(
    code,
    /setTimeout\(\(\) => connectingSessions\.delete/,
    'le verrou ne doit plus dépendre d’un minuteur de 90 s'
  );
  assert.match(code, /pairingGuard\.reacquire\(/);
  assert.match(code, /pairingGuard\.release\(/);
});

test('chaque chemin d’échec d’EmpirePair purge la session', () => {
  const empirePair = code.slice(
    code.indexOf('async function EmpirePair('),
    code.indexOf('// ---------------- endpoints (admin/newsletter management + others)')
  );
  assert.ok(empirePair.length > 1000, 'EmpirePair introuvable');

  // 1) creds invalides / illisibles
  assert.match(empirePair, /purgeFailedSession\(sanitizedNumber, \{ reason: 'creds invalides' \}\)/);
  // 2) génération du code impossible
  assert.match(empirePair, /purgeFailedSession\(sanitizedNumber, \{ socket, reason: 'génération du code impossible' \}\)/);
  // 3) erreur d'appairage (catch final)
  assert.match(empirePair, /purgeFailedSession\(sanitizedNumber, \{\n?\s*socket: pairingSockets\.get/);
});

test('un échec de génération de code répond une erreur explicite, jamais un code vide', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  // L'ancien `res.send({ code })` avec `code` undefined produisait `{}` en HTTP 200.
  assert.doesNotMatch(empirePair, /res\.send\(\{ code \}\)/);
  assert.match(empirePair, /res\.status\(502\)\.send\(\{/);
  assert.match(empirePair, /error: 'code_indisponible'/);
});

test('une session déjà enregistrée reçoit quand même une réponse', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /status: 'session_existante'/);
});

test('un socket d’appairage n’est pas mis dans activeSockets', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /pairingSockets\.set\(sanitizedNumber, socket\)/);
  // L'ajout à activeSockets doit être conditionné à l'enregistrement réel.
  assert.match(empirePair, /if \(socket\.authState\?\.creds\?\.registered\) \{\n\s*activeSockets\.set\(sanitizedNumber, socket\)/);
});

test('un appairage abandonné est purgé au lieu d’être reconnecté en boucle', () => {
  const autoRestart = code.slice(
    code.indexOf('function setupAutoRestart('),
    code.indexOf('async function EmpirePair(')
  );
  assert.ok(autoRestart.length > 200, 'setupAutoRestart introuvable');
  assert.match(autoRestart, /neverRegistered/);
  assert.match(autoRestart, /purgeFailedSession\(sanitized, \{ socket, reason: 'connexion fermée avant enregistrement' \}\)/);
  // On ne doit pas vider un état non enregistré sur disque/base.
  assert.match(autoRestart, /if \(auth && !neverRegistered\)/);
});

test('la purge délègue au module testable et couvre disque + MongoDB', () => {
  assert.match(code, /createSessionPurger\(\{/);
  assert.match(code, /sessionPurger\.purge\(sanitized, \{ auth, reason \}\)/);
  assert.match(code, /removeSession: \(n\) => removeSessionFromMongo\(n\)/);
  assert.match(code, /removeNumber: \(n\) => removeNumberFromMongo\(n\)/);
});

test('le dashboard peut forcer un nouveau code immédiatement', () => {
  assert.match(code, /function wantsFreshPairing\(req\)/);
  assert.equal(
    occurrences(code, 'forceFresh: wantsFreshPairing(req)'),
    2,
    'les routes / et /code doivent toutes les deux accepter force'
  );
});

test('le dashboard n’affiche plus « Indisponible » en silence', () => {
  assert.doesNotMatch(pairHtml, /\|\|\s*"Indisponible"/);
  assert.match(pairHtml, /appairage_en_cours/);
  assert.match(pairHtml, /Forcer un nouveau code/);
  assert.match(pairHtml, /Réessayer maintenant/);
  assert.match(pairHtml, /force=1/);
});
