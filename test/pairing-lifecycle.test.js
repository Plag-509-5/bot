'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  CLOSE_ACTION,
  STATUS,
  classifyConnectionClose,
  createPairingLifecycle,
  waitForPairingReady
} = require('../src/auth/pairing-lifecycle');

function disconnect(statusCode, message = `status ${statusCode}`) {
  const error = new Error(message);
  error.output = { statusCode };
  return { error };
}

function fakeSocket(registered = false) {
  return {
    authState: { creds: { registered } },
    ev: new EventEmitter()
  };
}

test('515 reste un redémarrage attendu même si registered est observé en retard', () => {
  const decision = classifyConnectionClose({
    lastDisconnect: disconnect(STATUS.RESTART_REQUIRED, 'Stream Errored (restart required)'),
    registered: false,
    pairingAccepted: false
  });

  assert.equal(decision.action, CLOSE_ACTION.RESTART_REQUIRED);
  assert.equal(decision.immediate, true);
  assert.equal(decision.countAttempt, false);
});

test('pair-success marque le pairing puis 515 vide MongoDB avant la reconnexion immédiate', async () => {
  const socket = fakeSocket(false);
  const calls = [];
  const auth = {
    async close() { calls.push('auth.close'); }
  };
  const lifecycle = createPairingLifecycle({
    number: '50947440869',
    socket,
    auth,
    onPairingAccepted: () => { calls.push('pairing.accepted'); },
    onReconnect: async (decision) => {
      calls.push(`reconnect:${decision.immediate}`);
    }
  });

  await lifecycle.handleConnectionUpdate({ isNewLogin: true });
  socket.authState.creds.registered = true;
  const decision = await lifecycle.handleConnectionUpdate({
    connection: 'close',
    lastDisconnect: disconnect(STATUS.RESTART_REQUIRED)
  });

  assert.equal(decision.action, CLOSE_ACTION.RESTART_REQUIRED);
  assert.deepEqual(calls, ['pairing.accepted', 'auth.close', 'reconnect:true']);
  assert.equal(lifecycle.snapshot().pairingAccepted, true);
});

test('un logout 401 d’une session valide supprime la session sans reconnexion', async () => {
  const socket = fakeSocket(true);
  const calls = [];
  const lifecycle = createPairingLifecycle({
    number: '5091',
    socket,
    auth: { async close() { calls.push('close'); } },
    onReconnect: async () => { calls.push('reconnect'); },
    onSessionInvalid: async (decision) => { calls.push(`delete:${decision.statusCode}`); }
  });

  const decision = await lifecycle.handleConnectionUpdate({
    connection: 'close',
    lastDisconnect: disconnect(STATUS.LOGGED_OUT, 'Intentional Logout')
  });

  assert.equal(decision.action, CLOSE_ACTION.DELETE_SESSION);
  assert.deepEqual(calls, ['delete:401']);
});

test('un code expiré avant pair-success purge seulement la tentative', async () => {
  const socket = fakeSocket(false);
  const calls = [];
  const lifecycle = createPairingLifecycle({
    number: '5092',
    socket,
    auth: { async close() { calls.push('close'); } },
    onReconnect: async () => { calls.push('reconnect'); },
    onPairingFailure: async (decision) => { calls.push(`purge:${decision.reason}`); }
  });

  const decision = await lifecycle.handleConnectionUpdate({
    connection: 'close',
    lastDisconnect: disconnect(STATUS.TIMED_OUT, 'QR refs attempts ended')
  });

  assert.equal(decision.action, CLOSE_ACTION.PURGE_PAIRING);
  assert.match(decision.reason, /expiré/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^purge:/);
});

test('un vrai refus 401 avant enregistrement purge le pairing, pas une session valide', async () => {
  const decision = classifyConnectionClose({
    lastDisconnect: disconnect(STATUS.LOGGED_OUT, 'device_removed'),
    registered: false,
    pairingAccepted: false
  });
  assert.equal(decision.action, CLOSE_ACTION.PURGE_PAIRING);
  assert.match(decision.reason, /refusé/);
});

test('une coupure transitoire d’une session enregistrée utilise le backoff', () => {
  const decision = classifyConnectionClose({
    lastDisconnect: disconnect(STATUS.CONNECTION_CLOSED),
    registered: true
  });
  assert.equal(decision.action, CLOSE_ACTION.RECONNECT);
  assert.equal(decision.immediate, false);
  assert.equal(decision.countAttempt, true);
});

test('une connexion remplacée conserve MongoDB et ne lutte pas en boucle', async () => {
  const socket = fakeSocket(true);
  const calls = [];
  const lifecycle = createPairingLifecycle({
    number: '5093',
    socket,
    auth: { async close() { calls.push('auth.close'); } },
    onReconnect: async () => { calls.push('reconnect'); },
    onConnectionReplaced: async () => { calls.push('replaced'); }
  });

  const decision = await lifecycle.handleConnectionUpdate({
    connection: 'close',
    lastDisconnect: disconnect(STATUS.CONNECTION_REPLACED)
  });

  assert.equal(decision.action, CLOSE_ACTION.STOP_REPLACED);
  assert.deepEqual(calls, ['auth.close', 'replaced']);
});

test('une panne MongoDB empêche le redémarrage 515 immédiat', async () => {
  const socket = fakeSocket(true);
  let received;
  const lifecycle = createPairingLifecycle({
    number: '5094',
    socket,
    auth: { async close() { throw new Error('mongo down'); } },
    onReconnect: async (decision) => { received = decision; }
  });

  await lifecycle.handleConnectionUpdate({
    connection: 'close',
    lastDisconnect: disconnect(STATUS.RESTART_REQUIRED)
  });

  assert.equal(received.immediate, false);
  assert.equal(received.countAttempt, true);
  assert.match(received.persistenceError.message, /mongo down/);
});

test('waitForPairingReady attend réellement le premier update.qr', async () => {
  const socket = fakeSocket(false);
  let resolved = false;
  const ready = waitForPairingReady(socket, { timeoutMs: 1000 }).then(() => { resolved = true; });

  socket.ev.emit('connection.update', { connection: 'connecting' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);

  socket.ev.emit('connection.update', { qr: 'ref-prête' });
  await ready;
  assert.equal(resolved, true);
  assert.equal(socket.ev.listenerCount('connection.update'), 0);
});

test('waitForPairingReady rejette une fermeture avant le stanza pair-device', async () => {
  const socket = fakeSocket(false);
  const ready = waitForPairingReady(socket, { timeoutMs: 1000 });
  socket.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: disconnect(STATUS.CONNECTION_CLOSED)
  });

  await assert.rejects(ready, (error) => {
    assert.equal(error.code, 'PAIRING_SOCKET_CLOSED');
    assert.equal(error.statusCode, STATUS.CONNECTION_CLOSED);
    return true;
  });
  assert.equal(socket.ev.listenerCount('connection.update'), 0);
});
