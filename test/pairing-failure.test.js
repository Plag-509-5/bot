'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
const pairHtml = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard', 'pages', 'pair.html'),
  'utf8'
);
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

test('le verrou d’appairage est explicite et libéré sur les erreurs MongoDB', () => {
  assert.doesNotMatch(code, /connectingSessions/);
  assert.match(code, /pairingGuard\.reacquire\(/);
  assert.match(code, /pairingGuard\.release\(sanitizedNumber\)/);
  assert.match(code, /error: 'mongodb_indisponible'/);
});

test('les creds MongoDB corrompus sont purgés, une panne temporaire ne l’est pas', () => {
  const creation = code.slice(
    code.indexOf('auth = await createMongoAuthState'),
    code.indexOf('const { state } = auth')
  );
  assert.match(creation, /err instanceof MongoAuthCorruptedError/);
  assert.match(creation, /purgeFailedSession\(sanitizedNumber, \{ reason: 'creds MongoDB invalides' \}\)/);

  const genericBranch = creation.slice(creation.indexOf('} else {'));
  assert.match(genericBranch, /pairingGuard\.release\(sanitizedNumber\)/);
  assert.doesNotMatch(genericBranch, /purgeFailedSession/);
});

test('un échec de génération de code purge MongoDB et répond explicitement', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /purgeFailedSession\([\s\S]*génération du code impossible/);
  assert.match(empirePair, /error: purged \? 'code_indisponible' : 'mongodb_purge_failed'/);
  assert.doesNotMatch(empirePair, /res\.send\(\{ code \}\)/);
});

test('une session déjà enregistrée reçoit une réponse sans nouveau code', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /status: 'session_existante'/);
});

test('un socket de pairing reste séparé des sockets actifs', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /pairingSockets\.set\(sanitizedNumber, socket\)/);
  assert.match(
    empirePair,
    /if \(socket\.authState\?\.creds\?\.registered\) \{\n\s*activeSockets\.set\(sanitizedNumber, socket\)/
  );
});

test('le cycle central distingue le 515 immédiat des vrais échecs de pairing', () => {
  const autoRestart = code.slice(
    code.indexOf('function setupAutoRestart('),
    code.indexOf('async function EmpirePair(')
  );
  assert.match(autoRestart, /createPairingLifecycle\(\{/);
  assert.match(autoRestart, /onPairingAccepted:/);
  const acceptedBranch = autoRestart.slice(
    autoRestart.indexOf('onPairingAccepted:'),
    autoRestart.indexOf('onReconnect:')
  );
  assert.doesNotMatch(acceptedBranch, /pairingGuard\.release/);
  assert.match(autoRestart, /reconnectScheduler\.scheduleImmediate\(sanitized, decision\)/);
  assert.match(autoRestart, /onPairingFailure:/);
  assert.match(autoRestart, /purgeFailedSession\(sanitized, \{ socket, reason: decision\.reason \}\)/);
});

test('le code attend pair-device et une reconnexion interne n’en génère jamais un autre', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /waitForPairingReady\(socket, \{ timeoutMs: PAIRING_READY_TIMEOUT_MS \}\)/);
  assert.match(empirePair, /!forceFresh && !internalReconnect/);
  assert.match(empirePair, /if \(!internalReconnect\) pairingGuard\.reacquire/);
  assert.match(empirePair, /if \(internalReconnect\)/);
  assert.match(empirePair, /reconnexion interne sans creds enregistrées/);
  assert.equal(occurrences(empirePair, 'socket.requestPairingCode(sanitizedNumber)'), 1);
  assert.doesNotMatch(empirePair, /demande de code échouée \(essai/);
});

test('le socket utilise une version WhatsApp live stable et un navigateur canonique', () => {
  const empirePair = code.slice(code.indexOf('async function EmpirePair('));
  assert.match(empirePair, /baileysVersionResolver\.resolve\(/);
  assert.match(empirePair, /version: waVersion/);
  assert.match(empirePair, /browser: WA_BROWSER/);
  assert.match(code, /Browsers\.ubuntu\('Chrome'\)/);
  assert.doesNotMatch(code, /\["Ubuntu", "Chrome", "20\.0\.04"\]/);
});

test('une erreur après chargement ne détruit pas une session déjà enregistrée', () => {
  const finalCatch = code.slice(
    code.indexOf("console.error('Pairing error:'"),
    code.indexOf('// ---------------- endpoints (admin/newsletter management + others)')
  );
  assert.match(finalCatch, /const registered = Boolean\(auth\?\.state\?\.creds\?\.registered\)/);
  assert.match(finalCatch, /if \(registered\)/);
  assert.match(finalCatch, /session MongoDB a été conservée/);
});

test('la purge délègue au module MongoDB sans gestion de dossier local', () => {
  assert.match(code, /createSessionPurger\(\{/);
  assert.match(code, /sessionPurger\.purge\(sanitized, \{ auth, reason \}\)/);
  assert.match(code, /removeNumber: \(n\) => removeNumberFromMongo\(n\)/);
  assert.doesNotMatch(code, /sessionStore|removeAuthDir|sessionDir/);
});

test('le dashboard peut forcer un nouveau code immédiatement', () => {
  assert.match(code, /function wantsFreshPairing\(req\)/);
  assert.equal(occurrences(code, 'forceFresh: wantsFreshPairing(req)'), 2);
  assert.match(code, /error: 'mongodb_purge_failed'/);
});

test('le dashboard n’affiche pas « Indisponible » silencieusement', () => {
  assert.doesNotMatch(pairHtml, /\|\|\s*"Indisponible"/);
  assert.match(pairHtml, /appairage_en_cours/);
  assert.match(pairHtml, /Forcer un nouveau code/);
  assert.match(pairHtml, /Réessayer maintenant/);
  assert.match(pairHtml, /force=1/);
});
