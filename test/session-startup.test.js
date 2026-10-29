'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apps } = require('../ecosystem.config.cjs');
const {
  DEFAULT_SESSION_STARTUP_CONCURRENCY,
  MAX_SESSION_STARTUP_CONCURRENCY,
  resolveSessionStartupConcurrency,
  mapWithConcurrency
} = require('../src/services/session-startup');

test('PM2 garde un seul processus et le laisse restaurer ses sockets après arrêt propre', () => {
  assert.equal(apps.length, 1);
  assert.equal(apps[0].instances, 1);
  assert.equal(apps[0].exec_mode, 'fork');
  assert.equal(apps[0].script, 'npm');
  assert.equal(apps[0].args, 'start');
  assert.equal(apps[0].interpreter, 'none');
  assert.equal(apps[0].autorestart, true);
  assert.equal(apps[0].kill_timeout, 180_000);
});

test('session startup concurrency is bounded and configurable for large session sets', () => {
  assert.equal(DEFAULT_SESSION_STARTUP_CONCURRENCY, 8);
  assert.equal(MAX_SESSION_STARTUP_CONCURRENCY, 32);
  assert.equal(resolveSessionStartupConcurrency(undefined), DEFAULT_SESSION_STARTUP_CONCURRENCY);
  assert.equal(resolveSessionStartupConcurrency(2), 2);
  assert.equal(resolveSessionStartupConcurrency(0), DEFAULT_SESSION_STARTUP_CONCURRENCY);
  assert.equal(resolveSessionStartupConcurrency(100), MAX_SESSION_STARTUP_CONCURRENCY);
});

test('restaure un lot de 100 sessions sans plafond sur leur nombre et limite la vague de démarrage', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithConcurrency(Array.from({ length: 100 }, (_, index) => index), 32, async value => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setImmediate(resolve));
    running -= 1;
    return value;
  });

  assert.equal(results.length, 100);
  assert.equal(peak, 32);
  assert.ok(results.every(result => result.status === 'fulfilled'));
  assert.equal(results[99].value, 99);
});

test('mapWithConcurrency starts several sessions in parallel, preserves order, and isolates failures', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async value => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running -= 1;
    if (value === 3) throw new Error('one session failed');
    return value * 10;
  });

  assert.equal(peak, 3);
  assert.deepEqual(results.map(result => result.status), [
    'fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled'
  ]);
  assert.deepEqual(results.filter(result => result.status === 'fulfilled').map(result => result.value), [0, 10, 20, 40, 50]);
  assert.match(results[3].reason.message, /one session failed/);
});
