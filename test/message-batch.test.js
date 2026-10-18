'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { processMessageBatch } = require('../src/services/message-batch');

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

test('le handler WhatsApp route les items de messages.upsert au processeur de lot', () => {
  assert.match(pairSource, /processMessageBatch\(messages/);
  assert.doesNotMatch(pairSource, /const msg = messages\[0\];/);
  assert.match(pairSource, /batchStats\.received \+= messages\.length/);
  assert.match(pairSource, /traitementMessages:\s*\{ \.\.\.getMessageProcessingStats\(number\) \}/);
});
