'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  configEnabled,
  setSessionPresence,
  handleIgnoredMessage,
  wakeForCommand,
  applyAlwaysOnlineSetting,
  _test
} = require('../src/services/presence-mode');
const pairSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');

function fakeSocket() {
  const events = [];
  return {
    events,
    async sendPresenceUpdate(value, jid) { events.push(['presence', value, jid]); },
    async readMessages(keys) { events.push(['read', keys]); }
  };
}

const msg = { key: { id: 'm1', remoteJid: 'chat@s.whatsapp.net', fromMe: false } };

test('un message ordinaire ignoré ne met jamais la présence hors ligne et n’est pas marqué lu', async () => {
  const socket = fakeSocket();
  assert.equal(await handleIgnoredMessage(socket, msg, { AUTO_ONLINE: false }), false);
  assert.deepEqual(socket.events, []);
});

test('les commandes peuvent être lues sans minuterie qui repasse la session hors ligne', async () => {
  const socket = fakeSocket();
  await wakeForCommand(socket, msg, { AUTO_ONLINE: false, AUTO_RECORDING: false });
  assert.equal(socket.events[0][0], 'read');
  assert.deepEqual(socket.events[1], ['presence', 'available', 'chat@s.whatsapp.net']);
  assert.equal(socket.events.some(event => event[1] === 'unavailable'), false);
});

test('alwaysonline off est rétrocompatible mais ne peut plus envoyer unavailable', async () => {
  const socket = fakeSocket();
  assert.equal(await applyAlwaysOnlineSetting(socket, 'on'), true);
  assert.equal(await applyAlwaysOnlineSetting(socket, 'off'), true);
  assert.deepEqual(socket.events.map(event => event[1]), ['available']);
  assert.equal(await setSessionPresence(socket, false, 'chat@s.whatsapp.net'), false);
  assert.equal(socket.events.some(event => event[1] === 'unavailable'), false);
});

test('la présence available redondante est dédupliquée par socket et JID', async () => {
  const socket = fakeSocket();
  assert.equal(await setSessionPresence(socket, true, 'chat@s.whatsapp.net'), true);
  assert.equal(await setSessionPresence(socket, true, 'chat@s.whatsapp.net'), true);
  assert.equal(socket.events.length, 1);
  _test.clearPresenceCache(socket);
});

test('les sockets Baileys sont marqués disponibles dès la connexion, sans présence offline par commande', () => {
  assert.match(pairSource, /markOnlineOnConnect:\s*true/);
  assert.match(pairSource, /await applyAlwaysOnlineSetting\(socket, true\)/);
  assert.doesNotMatch(pairSource, /markOnlineOnConnect:\s*configEnabled/);
});

test('normalise les valeurs booléennes de configuration', () => {
  assert.equal(configEnabled(true), true);
  assert.equal(configEnabled('on'), true);
  assert.equal(configEnabled('false', true), false);
  assert.equal(configEnabled(undefined, true), true);
});
