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
  setupReplyPresenceWrapper,
  _test
} = require('../src/services/presence-mode');
const pairSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');

function fakeSocket() {
  const events = [];
  return {
    events,
    async sendPresenceUpdate(value, jid) { events.push(['presence', value, jid]); },
    async readMessages(keys) { events.push(['read', keys]); },
    async sendMessage(jid, content) { events.push(['send', jid, content]); return { key: { id: 'sent' } }; }
  };
}

const msg = { key: { id: 'm1', remoteJid: 'chat@s.whatsapp.net', fromMe: false } };

test('un message ignoré ne met pas la présence en ligne et n’est pas marqué lu', async () => {
  const socket = fakeSocket();
  assert.equal(await handleIgnoredMessage(socket, msg, { AUTO_ONLINE: false }), false);
  assert.deepEqual(socket.events, []);
});

test('la préparation d’une commande marque le message lu sans exposer la présence', async () => {
  const socket = fakeSocket();
  await wakeForCommand(socket, msg, { AUTO_ONLINE: false, AUTO_RECORDING: false });
  assert.deepEqual(socket.events, [['read', [msg.key]]]);
});

test('alwaysonline off impose unavailable et on reste une option explicite', async () => {
  const socket = fakeSocket();
  assert.equal(await applyAlwaysOnlineSetting(socket, false), true);
  assert.equal(await applyAlwaysOnlineSetting(socket, true), true);
  assert.equal(await applyAlwaysOnlineSetting(socket, false), true);
  assert.deepEqual(socket.events.map(event => event[1]), ['unavailable', 'available', 'unavailable']);
});

test('chaque réponse passe temporairement en available puis revient unavailable', async () => {
  const socket = fakeSocket();
  setupReplyPresenceWrapper(socket);
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'réponse' });
  assert.deepEqual(socket.events.map(event => event[1]), ['available', 'chat@s.whatsapp.net', 'unavailable']);
  _test.clearPresenceCache(socket);
});

test('les envois concurrents restent disponibles jusqu’à la fin du dernier envoi', async () => {
  const events = [];
  let finishFirst;
  let finishSecond;
  let startedCount = 0;
  let markBothStarted;
  const bothStarted = new Promise(resolve => { markBothStarted = resolve; });
  const socket = {
    async sendPresenceUpdate(value) { events.push(['presence', value]); },
    sendMessage(_jid, content) {
      events.push(['start', content.text]);
      startedCount += 1;
      if (startedCount === 2) markBothStarted();
      return new Promise(resolve => {
        if (content.text === 'one') finishFirst = resolve;
        else finishSecond = resolve;
      });
    }
  };
  setupReplyPresenceWrapper(socket);
  const first = socket.sendMessage('chat', { text: 'one' });
  const second = socket.sendMessage('chat', { text: 'two' });
  await bothStarted;
  finishFirst('one');
  await first;
  assert.equal(events.some(event => event[0] === 'presence' && event[1] === 'unavailable'), false);
  finishSecond('two');
  await second;
  assert.deepEqual(events.filter(event => event[0] === 'presence').map(event => event[1]), ['available', 'unavailable']);
});

test('les sockets démarrent hors ligne et installent le wrapper après safe-send', () => {
  assert.match(pairSource, /markOnlineOnConnect:\s*false/);
  const safeAt = pairSource.indexOf('installSafeSend(socket)');
  const presenceAt = pairSource.indexOf('setupReplyPresenceWrapper(socket)');
  assert.ok(safeAt > 0 && presenceAt > safeAt);
});

test('normalise les valeurs booléennes de configuration', () => {
  assert.equal(configEnabled(true), true);
  assert.equal(configEnabled('on'), true);
  assert.equal(configEnabled('false', true), false);
  assert.equal(configEnabled(undefined, true), true);
});
