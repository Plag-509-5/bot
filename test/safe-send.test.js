'use strict';

/**
 * Tests de l'envoi fiable.
 *
 * Le bug d'origine : `socket.sendMessage()` résout sans erreur même quand la
 * websocket est morte. Le bot croit avoir répondu, l'utilisateur ne voit rien
 * et le message reste « en attente » côté compte WhatsApp.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  safeSend,
  installSafeSend,
  socketReadiness,
  getSendStats,
  WEBSOCKET_OPEN
} = require('../src/lib/safe-send');

const noDelay = async () => {};
const quiet = { error() {}, warn() {}, log() {} };

function makeSocket({ readyState = WEBSOCKET_OPEN, registered = true, send } = {}) {
  return {
    ws: { readyState },
    authState: { creds: { registered } },
    sendMessage: send || (async () => ({ key: { id: 'OK' } }))
  };
}

test('socketReadiness détecte une websocket fermée', () => {
  assert.equal(socketReadiness(makeSocket()).ready, true);
  assert.equal(socketReadiness(makeSocket({ readyState: 0 })).ready, false);
  assert.equal(socketReadiness(makeSocket({ readyState: 2 })).ready, false);
  assert.equal(socketReadiness(makeSocket({ readyState: 3 })).ready, false);
  assert.equal(socketReadiness(null).ready, false);
  assert.equal(socketReadiness(makeSocket({ registered: false })).ready, false);
});

test('un envoi sur connexion ouverte passe immédiatement', async () => {
  const socket = makeSocket();
  const sent = [];
  const result = await safeSend(
    async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'ABC' } }; },
    socket,
    '50947440869@s.whatsapp.net',
    { text: 'salut' },
    { delay: noDelay, logger: quiet }
  );

  assert.equal(result.key.id, 'ABC');
  assert.deepEqual(sent, [{ jid: '50947440869@s.whatsapp.net', content: { text: 'salut' } }]);
  assert.equal(getSendStats(socket).ok, 1);
  assert.equal(getSendStats(socket).failed, 0);
});

test('un envoi sur connexion fermée lève une erreur au lieu de disparaître', async () => {
  const socket = makeSocket({ readyState: 3 });
  let called = 0;

  await assert.rejects(
    safeSend(
      async () => { called += 1; return {}; },
      socket,
      '50947440869@s.whatsapp.net',
      { text: 'invisible sinon' },
      { delay: noDelay, readyTimeoutMs: 0, logger: quiet }
    ),
    /Connexion WhatsApp indisponible/
  );

  assert.equal(called, 0, 'rien ne doit être remis à une websocket fermée');
  assert.equal(getSendStats(socket).failed, 1);
});

test('l’envoi attend la reconnexion puis part réellement', async () => {
  const socket = makeSocket({ readyState: 2 });
  const sent = [];
  let ticks = 0;

  const promise = safeSend(
    async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'APRES' } }; },
    socket,
    '50947440869@s.whatsapp.net',
    { text: 'réponse' },
    {
      readyTimeoutMs: 5000,
      pollIntervalMs: 1,
      delay: async (ms) => {
        ticks += 1;
        // La connexion revient pendant l'attente.
        if (ticks >= 3) socket.ws.readyState = WEBSOCKET_OPEN;
        await new Promise((resolve) => setTimeout(resolve, ms || 1));
      },
      logger: quiet
    }
  );

  const result = await promise;
  assert.equal(result.key.id, 'APRES');
  assert.equal(sent.length, 1, 'le message doit partir une fois la connexion revenue');
  assert.equal(getSendStats(socket).waitedForConnection, 1);
});

test('une erreur d’envoi déclenche une nouvelle tentative', async () => {
  const socket = makeSocket();
  let attempts = 0;

  const result = await safeSend(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Connection Closed');
      return { key: { id: 'RETRY' } };
    },
    socket,
    '50947440869@s.whatsapp.net',
    { text: 'bonjour' },
    { retries: 2, delay: noDelay, logger: quiet }
  );

  assert.equal(result.key.id, 'RETRY');
  assert.equal(attempts, 2);
  assert.equal(getSendStats(socket).ok, 1);
});

test('après épuisement des tentatives, l’erreur remonte à l’appelant', async () => {
  const socket = makeSocket();
  let attempts = 0;

  await assert.rejects(
    safeSend(
      async () => {
        attempts += 1;
        throw new Error('boom');
      },
      socket,
      '50947440869@s.whatsapp.net',
      { text: 'perdu' },
      { retries: 1, delay: noDelay, logger: quiet }
    ),
    /boom/
  );

  assert.equal(attempts, 2, 'tentative initiale + 1 retry');
  assert.equal(getSendStats(socket).failed, 1);
});

test('installSafeSend protège tous les socket.sendMessage du bot', async () => {
  const sent = [];
  const socket = {
    ws: { readyState: WEBSOCKET_OPEN },
    authState: { creds: { registered: true } },
    async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: 'WRAP' } }; }
  };

  installSafeSend(socket);
  installSafeSend(socket); // ne doit pas empiler deux wrappers

  const result = await socket.sendMessage('50947440869@s.whatsapp.net', { text: 'via wrapper' }, { delay: noDelay, logger: quiet });
  assert.equal(result.key.id, 'WRAP');
  assert.equal(sent.length, 1);
  assert.equal(getSendStats(socket).ok, 1);
});

test('installSafeSend bloque l’envoi quand la connexion tombe', async () => {
  const socket = {
    ws: { readyState: 3 },
    authState: { creds: { registered: true } },
    async sendMessage() { throw new Error('ne devrait jamais être appelé'); }
  };
  installSafeSend(socket);

  await assert.rejects(
    socket.sendMessage('50947440869@s.whatsapp.net', { text: 'x' }, { delay: noDelay, readyTimeoutMs: 0, logger: quiet }),
    /Connexion WhatsApp indisponible/
  );
});

test('_unsafeSend contourne la garde pour les envois internes', async () => {
  const sent = [];
  const socket = {
    ws: { readyState: 3 },
    authState: { creds: { registered: true } },
    async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: 'DIRECT' } }; }
  };
  installSafeSend(socket);

  const result = await socket.sendMessage('50947440869@s.whatsapp.net', { text: 'interne' }, { _unsafeSend: true });
  assert.equal(result.key.id, 'DIRECT');
  assert.equal(sent.length, 1);
});
