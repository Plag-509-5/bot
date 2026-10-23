'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  processMessageBatch,
  createMessageProcessingPool,
  createMessageDispatcher
} = require('../src/services/message-batch');

const pairSource = fs.readFileSync(path.join(__dirname, '../src/core/pair.js'), 'utf8');

test('traite tous les messages d’un upsert dans l’ordre', async () => {
  const seen = [];
  const results = await processMessageBatch(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    async message => {
      seen.push(message.id);
      return message.id.toUpperCase();
    }
  );

  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.deepEqual(results, ['A', 'B', 'C']);
});

test('une erreur sur un message est journalisée et ne bloque pas le reste du lot', async () => {
  const seen = [];
  const errors = [];
  const results = await processMessageBatch(
    [{ id: 'first' }, { id: 'bad' }, { id: 'last' }],
    async message => {
      seen.push(message.id);
      if (message.id === 'bad') throw new Error('échec isolé');
      return message.id;
    },
    (error, context) => errors.push({ error: error.message, ...context })
  );

  assert.deepEqual(seen, ['first', 'bad', 'last']);
  assert.deepEqual(results, ['first', undefined, 'last']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, 'échec isolé');
  assert.equal(errors[0].message.id, 'bad');
  assert.equal(errors[0].index, 1);
});

test('le callback de suivi est appelé uniquement après un traitement réussi', async () => {
  const processed = [];
  await processMessageBatch(
    [{ id: 'ok' }, { id: 'fail' }],
    async message => {
      if (message.id === 'fail') throw new Error('échec');
      return message.id;
    },
    () => {},
    (result, context) => processed.push({ result, id: context.message.id })
  );
  assert.deepEqual(processed, [{ result: 'ok', id: 'ok' }]);
});

test('les chats différents sont traités en parallèle sans dépasser la limite', async () => {
  const dispatcher = createMessageDispatcher({ concurrency: 2 });
  const releases = new Map();
  const started = [];
  let active = 0;
  let maxActive = 0;
  const batch = dispatcher.processBatch([
    { id: 'a', key: { remoteJid: 'chat-a' } },
    { id: 'b', key: { remoteJid: 'chat-b' } },
    { id: 'c', key: { remoteJid: 'chat-c' } }
  ], message => new Promise(resolve => {
    started.push(message.id);
    active += 1;
    maxActive = Math.max(maxActive, active);
    releases.set(message.id, () => { active -= 1; resolve(message.id); });
  }));

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b']);
  assert.equal(maxActive, 2);
  releases.get('a')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b', 'c']);
  releases.get('b')();
  releases.get('c')();
  assert.deepEqual(await batch, ['a', 'b', 'c']);
});

test('un pool global plafonne le traitement partagé entre plusieurs sessions', async () => {
  const pool = createMessageProcessingPool({ concurrency: 2, maxQueued: 10 });
  const dispatchers = Array.from({ length: 4 }, () => createMessageDispatcher({
    concurrency: 3,
    processingPool: pool
  }));
  let running = 0;
  let peak = 0;
  const batches = dispatchers.map((dispatcher, sessionIndex) => dispatcher.processBatch(
    Array.from({ length: 3 }, (_, index) => ({
      id: `${sessionIndex}-${index}`,
      key: { remoteJid: `chat-${sessionIndex}-${index}` }
    })),
    async message => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
      return message.id;
    }
  ));

  await Promise.all(batches);
  assert.equal(peak, 2);
  assert.deepEqual(pool.getStats(), {
    inFlight: 0,
    queued: 0,
    concurrency: 2,
    maxQueued: 10,
    rejected: 0
  });
});

test('le plafond de file global rejette la surcharge et la mesure', async () => {
  const pool = createMessageProcessingPool({ concurrency: 1, maxQueued: 0 });
  const dispatcher = createMessageDispatcher({ concurrency: 1, processingPool: pool });
  const overflowDispatcher = createMessageDispatcher({ concurrency: 1, processingPool: pool });
  let finish;
  const first = dispatcher.processBatch([
    { id: 'running', key: { remoteJid: 'chat-one' } }
  ], () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));

  const errors = [];
  const overflow = await overflowDispatcher.processBatch([
    { id: 'overflow', key: { remoteJid: 'chat-two' } }
  ], async () => 'must-not-run', (error, context) => errors.push({ error, context }));
  assert.deepEqual(overflow, [undefined]);
  assert.match(errors[0].error.message, /File globale des messages pleine/);
  assert.equal(errors[0].context.rejected, true);
  assert.equal(overflowDispatcher.getStats().rejected, 1);
  assert.equal(pool.getStats().rejected, 1);
  finish('ok');
  await first;
});

test('un chat garde un ordre FIFO entre lots successifs', async () => {
  const dispatcher = createMessageDispatcher({ concurrency: 3 });
  const started = [];
  let finishFirst;
  const first = dispatcher.processBatch([{ id: 'first', key: { remoteJid: 'same' } }], message => {
    started.push(message.id);
    return new Promise(resolve => { finishFirst = resolve; });
  });
  const second = dispatcher.processBatch([{ id: 'second', key: { remoteJid: 'same' } }], async message => {
    started.push(message.id);
    return message.id;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['first']);
  finishFirst('first');
  assert.deepEqual(await first, ['first']);
  assert.deepEqual(await second, ['second']);
  assert.deepEqual(started, ['first', 'second']);
});

test('une surcharge est explicitement mesurée au lieu de faire grossir la mémoire', async () => {
  const dispatcher = createMessageDispatcher({ concurrency: 1, maxPending: 1 });
  const errors = [];
  let finish;
  const running = dispatcher.processBatch([{ id: 'running', key: { remoteJid: 'one' } }], () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const queued = dispatcher.processBatch([{ id: 'queued', key: { remoteJid: 'one' } }], async () => 'queued');
  const rejected = await dispatcher.processBatch([{ id: 'overflow', key: { remoteJid: 'two' } }], async () => 'unexpected', error => errors.push(error.message));
  assert.deepEqual(rejected, [undefined]);
  assert.match(errors[0], /File de messages pleine/);
  assert.equal(dispatcher.getStats().rejected, 1);
  finish('done');
  await Promise.all([running, queued]);
});

test('le handler WhatsApp route les items de messages.upsert au processeur de lot', () => {
  assert.match(pairSource, /dispatcher\.processBatch\(messages/);
  assert.match(pairSource, /createMessageDispatcher\(/);
  assert.match(pairSource, /processingPool:\s*messageProcessingPool/);
  assert.match(pairSource, /traitementMessagesGlobal:\s*messageProcessingPool\.getStats\(\)/);
  assert.match(pairSource, /capaciteProcessus:\s*\{/);
  assert.match(pairSource, /memoireMiB:/);
  assert.doesNotMatch(pairSource, /const msg = messages\[0\];/);
  assert.match(pairSource, /batchStats\.received \+= messages\.length/);
  assert.match(pairSource, /if \(type === 'append'\) return/);
  assert.match(pairSource, /receivedByType/);
  assert.match(pairSource, /fileTraitement:\s*messageDispatchers\.get\(number\)\?\.getStats\(\)/);
  assert.match(pairSource, /traitementMessages:\s*\{ \.\.\.getMessageProcessingStats\(number\) \}/);
});
