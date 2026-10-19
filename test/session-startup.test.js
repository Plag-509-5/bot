'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SESSION_STARTUP_CONCURRENCY,
  MAX_SESSION_STARTUP_CONCURRENCY,
  resolveSessionStartupConcurrency,
  mapWithConcurrency
} = require('../src/services/session-startup');

test('session startup concurrency is bounded and configurable', () => {
  assert.equal(resolveSessionStartupConcurrency(undefined), DEFAULT_SESSION_STARTUP_CONCURRENCY);
  assert.equal(resolveSessionStartupConcurrency(2), 2);
  assert.equal(resolveSessionStartupConcurrency(0), DEFAULT_SESSION_STARTUP_CONCURRENCY);
  assert.equal(resolveSessionStartupConcurrency(100), MAX_SESSION_STARTUP_CONCURRENCY);
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
