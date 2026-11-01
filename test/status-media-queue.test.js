'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/services/status-media-queue');

const { createSemaphore } = _test;

test('le sémaphore refuse les publications média au-delà de ses limites', async () => {
  const gate = createSemaphore({ maxConcurrent: 1, maxQueued: 1, busyMessage: 'busy' });
  const releaseFirst = await gate.acquire();
  const queued = gate.acquire();

  assert.deepEqual(gate.stats(), { active: 1, waiting: 1, maxConcurrent: 1, maxQueued: 1 });
  await assert.rejects(gate.acquire(), /busy/);

  releaseFirst();
  const releaseSecond = await queued;
  assert.deepEqual(gate.stats(), { active: 1, waiting: 0, maxConcurrent: 1, maxQueued: 1 });
  releaseSecond();
  releaseSecond();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0, maxConcurrent: 1, maxQueued: 1 });
});

test('le sémaphore traite les éléments de la file dans l’ordre FIFO', async () => {
  const gate = createSemaphore({ maxConcurrent: 1, maxQueued: 2 });
  const order = [];
  const releaseFirst = await gate.acquire();
  const second = gate.acquire().then(release => {
    order.push('second');
    return release;
  });
  const third = gate.acquire().then(release => {
    order.push('third');
    return release;
  });

  releaseFirst();
  const releaseSecond = await second;
  assert.deepEqual(order, ['second']);
  releaseSecond();
  const releaseThird = await third;
  assert.deepEqual(order, ['second', 'third']);
  releaseThird();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0, maxConcurrent: 1, maxQueued: 2 });
});
