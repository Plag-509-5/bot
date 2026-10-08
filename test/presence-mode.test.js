'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configEnabled,
  handleIgnoredMessage,
  wakeForCommand,
  applyAlwaysOnlineSetting,
  _test
} = require('../src/services/presence-mode');

function fakeSocket() {
  const events = [];
  return {
    events,
    async sendPresenceUpdate(value, jid) { events.push(['presence', value, jid]); },
    async readMessages(keys) { events.push(['read', keys]); }
  };
}

const msg = { key: { id: 'm1', remoteJid: 'chat@s.whatsapp.net', fromMe: false } };

test('un message ordinaire en mode offline ne déclenche aucun accusé de lecture', async () => {
  const socket = fakeSocket();
  await handleIgnoredMessage(socket, msg, { AUTO_ONLINE: false });
  assert.deepEqual(socket.events, [['presence', 'unavailable', 'chat@s.whatsapp.net']]);
});

test('une commande réveille le bot et marque uniquement cette commande comme lue', async () => {
  const socket = fakeSocket();
  await wakeForCommand(socket, msg, { AUTO_ONLINE: false, AUTO_RECORDING: false }, { sleepAfterMs: 60_000 });
  assert.equal(socket.events[0][0], 'read');
  assert.deepEqual(socket.events[1], ['presence', 'available', 'chat@s.whatsapp.net']);
  _test.clearIdleTimer(socket);
});

test('always online on/off applique immédiatement la présence correspondante', async () => {
  const socket = fakeSocket();
  assert.equal(await applyAlwaysOnlineSetting(socket, 'on'), true);
  assert.equal(await applyAlwaysOnlineSetting(socket, 'off'), false);
  assert.deepEqual(socket.events.map((event) => event[1]), ['available', 'unavailable']);
});

test('normalise les valeurs booléennes de configuration', () => {
  assert.equal(configEnabled(true), true);
  assert.equal(configEnabled('on'), true);
  assert.equal(configEnabled('false', true), false);
  assert.equal(configEnabled(undefined, true), true);
});
