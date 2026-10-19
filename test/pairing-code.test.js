'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { issuePairingCode } = require('../src/auth/pairing-code');
const { waitForPairingReady } = require('../src/auth/pairing-lifecycle');

test('la création de code démarre sur un stanza Baileys déchiffré sans attendre update.qr', async () => {
  const socket = {
    authState: { creds: { registered: false } },
    ev: new EventEmitter(),
    ws: new EventEmitter()
  };
  const calls = [];
  let transportReady = false;
  socket.requestPairingCode = async (number) => {
    assert.equal(transportReady, true, 'le handshake doit précéder le stanza de pairing');
    calls.push(`request:${number}`);
    return '  ABCD-1234  ';
  };

  // Comme dans EmpirePair, l'écouteur est armé immédiatement après makeWASocket.
  const readiness = waitForPairingReady(socket, { timeoutMs: 1000 }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  );
  const codePromise = issuePairingCode({
    socket,
    number: '50947440869',
    auth: {
      async saveCreds() { calls.push('save-creds'); },
      async flush() { calls.push('flush'); }
    },
    readiness,
    onReady: () => calls.push('ready'),
    onRequest: () => calls.push('request-started'),
    onIssued: () => calls.push('issued')
  });

  socket.ev.emit('connection.update', { connection: 'connecting' });
  socket.ws.emit('frame', Buffer.from('noise handshake')); // ignoré : pas encore un stanza WA
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [], 'connection=connecting et le frame brut ne sont pas prêts');

  // La version Baileys du projet émet ici le premier BinaryNode déchiffré.
  // Aucun événement QR n'est émis dans cette reproduction.
  transportReady = true;
  socket.ws.emit('frame', { tag: 'iq', attrs: {}, content: [] });

  assert.equal(await codePromise, 'ABCD-1234');
  assert.deepEqual(calls, [
    'ready',
    'request-started',
    'request:50947440869',
    'save-creds',
    'flush',
    'issued'
  ]);
  assert.equal(socket.ws.listenerCount('frame'), 0, 'l’écouteur de handshake est nettoyé');
  assert.equal(socket.ev.listenerCount('connection.update'), 0, 'l’écouteur de cycle de vie est nettoyé');
});

test('un code n’est pas retourné si sa sauvegarde MongoDB échoue', async () => {
  const socket = {
    requestPairingCode: async () => 'ABCD-1234'
  };
  let issued = false;

  await assert.rejects(
    issuePairingCode({
      socket,
      number: '50947440869',
      auth: {
        async saveCreds() { throw new Error('MongoDB indisponible'); },
        async flush() {}
      },
      readiness: Promise.resolve({ ok: true }),
      onIssued: () => { issued = true; }
    }),
    /MongoDB indisponible/
  );
  assert.equal(issued, false);
});
