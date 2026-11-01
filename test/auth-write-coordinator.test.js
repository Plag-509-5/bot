'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthWriteCoordinator } = require('../src/auth/auth-write-coordinator');

test('les écritures de clés Signal distinctes se font en parallèle', async () => {
  const started = [];
  const releases = new Map();
  const coordinator = createAuthWriteCoordinator({
    writeKeys: changes => new Promise(resolve => {
      const ref = changes[0].ref;
      started.push(ref);
      releases.set(ref, resolve);
    }),
    writeCreds: async () => {}
  });

  const first = coordinator.enqueueKeys([{ ref: 'session/a', value: 1 }]);
  const second = coordinator.enqueueKeys([{ ref: 'session/b', value: 2 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['session/a', 'session/b']);
  assert.equal(coordinator.pendingWrites(), 2);
  releases.get('session/a')();
  releases.get('session/b')();
  await Promise.all([first, second]);
  assert.equal(coordinator.pendingWrites(), 0);
});

test('les mises à jour d’une même clé conservent leur ordre', async () => {
  const started = [];
  let releaseFirst;
  const coordinator = createAuthWriteCoordinator({
    writeKeys: changes => new Promise(resolve => {
      started.push(changes[0].value);
      if (started.length === 1) releaseFirst = resolve;
      else resolve();
    }),
    writeCreds: async () => {}
  });

  const first = coordinator.enqueueKeys([{ ref: 'session/a', value: 'ancien' }]);
  const second = coordinator.enqueueKeys([{ ref: 'session/a', value: 'récent' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['ancien']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(started, ['ancien', 'récent']);
});

test('les sauvegardes des creds ne sont plus bloquées derrière une écriture de clé', async () => {
  let releaseKey;
  let credsWritten = false;
  const coordinator = createAuthWriteCoordinator({
    writeKeys: () => new Promise(resolve => { releaseKey = resolve; }),
    writeCreds: async () => { credsWritten = true; }
  });

  const keyWrite = coordinator.enqueueKeys([{ ref: 'session/a', value: 1 }]);
  await new Promise(resolve => setImmediate(resolve));
  await coordinator.enqueueCreds({ registered: true });
  assert.equal(credsWritten, true);
  releaseKey();
  await keyWrite;
});

test('flush attend les écritures auth en vol', async () => {
  let release;
  const coordinator = createAuthWriteCoordinator({
    writeKeys: () => new Promise(resolve => { release = resolve; }),
    writeCreds: async () => {}
  });
  const writing = coordinator.enqueueKeys([{ ref: 'session/a', value: 1 }]);
  const flushed = coordinator.flush();
  let didFlush = false;
  void flushed.then(() => { didFlush = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(didFlush, false);
  release();
  await Promise.all([writing, flushed]);
  assert.equal(didFlush, true);
});
