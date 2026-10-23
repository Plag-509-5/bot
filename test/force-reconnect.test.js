'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
const {
  normalizeSessionNumbers,
  reconnectInactiveSessions,
  formatForceReconnectReport
} = require('../src/services/force-reconnect');

test('normalise les identifiants de session et supprime les doublons', () => {
  assert.deepEqual(normalizeSessionNumbers(['509-111', '509111', '', null, 'abc']), ['509111']);
});

test('relance uniquement les sessions absentes ou dont le socket est fermé', async () => {
  const openSocket = { ws: { isOpen: true } };
  const closedSocket = { ws: { isOpen: false } };
  const unknownSocket = { ws: {} };
  const activeSockets = new Map([
    ['509111', openSocket],
    ['509222', closedSocket],
    ['509333', unknownSocket]
  ]);
  const intentional = [];
  const cleared = [];
  const closed = [];
  let launched;

  const result = await reconnectInactiveSessions(
    ['509-111', '509222', '509333', '509444', '509222'],
    {
      activeSockets,
      getOpenState: socket => socket.ws.isOpen === true ? true : socket.ws.isOpen === false ? false : null,
      isPairingLocked: number => number === '509444',
      markIntentionalClose: socket => intentional.push(socket),
      clearSocketMetadata: number => cleared.push(number),
      closeSocket: socket => closed.push(socket),
      launchSessions: async numbers => {
        launched = numbers;
        return numbers.map(number => ({ number, status: 'connection_initiated' }));
      }
    }
  );

  assert.deepEqual(launched, ['509222']);
  assert.deepEqual(intentional, [closedSocket]);
  assert.deepEqual(cleared, ['509222']);
  assert.deepEqual(closed, [closedSocket]);
  assert.equal(activeSockets.has('509222'), false);
  assert.equal(activeSockets.get('509111'), openSocket);
  assert.equal(activeSockets.get('509333'), unknownSocket);
  assert.deepEqual(result.results.map(item => [item.number, item.status]), [
    ['509111', 'already_connected'],
    ['509333', 'already_connected'],
    ['509444', 'already_starting'],
    ['509222', 'connection_initiated']
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.candidates, 1);
});

test('convertit les erreurs de lancement en échecs et produit un bilan chiffré', async () => {
  const result = await reconnectInactiveSessions(['509555', '509666'], {
    activeSockets: new Map(),
    launchSessions: async () => { throw new Error('hidden detail'); }
  });
  assert.equal(result.results.filter(item => item.status === 'failed').length, 2);
  assert.equal(
    formatForceReconnectReport({
      total: result.total,
      candidates: result.candidates,
      results: result.results
    }),
    '✅ Reconnexion terminée.\nSessions examinées : 2\nSessions inactives : 2\nReconnexions programmées : 0\nDéjà actives : 0\nDéjà en cours : 0\nÉchecs : 2'
  );
  assert.match(formatForceReconnectReport({ fatalErrors: 1 }), /Échecs : 1$/);
});

test('.forcereconnect et .force sont protégées et passent par les sessions Mongo sauvegardées', () => {
  const start = source.indexOf("case 'forcereconnect':");
  const end = source.indexOf("case 'active':", start);
  const block = source.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(block, /case 'force':/);
  assert.match(block, /if \(!isPrivileged\)/);
  assert.match(block, /getAllNumbersFromMongo\(\)/);
  assert.match(block, /reconnectInactiveSessions\(/);
  assert.match(block, /reconnectScheduler\.scheduleImmediate\(/);
  assert.match(block, /formatForceReconnectReport\(/);
});
