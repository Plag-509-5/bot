'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiMemory } = require('../src/services/ai-memory');

test('la mémoire est isolée par clé de conversation et renvoie des copies', () => {
  const memory = createAiMemory();
  memory.appendTurn('5091::chat-a', 'bonjour', 'Salut.');

  const first = memory.getMessages('5091::chat-a');
  assert.deepEqual(first, [
    { role: 'user', content: 'bonjour' },
    { role: 'assistant', content: 'Salut.' }
  ]);
  first[0].content = 'modifié';
  assert.equal(memory.getMessages('5091::chat-a')[0].content, 'bonjour');
  assert.deepEqual(memory.getMessages('5091::chat-b'), []);
  assert.deepEqual(memory.getMessages('5092::chat-a'), []);
});

test('la mémoire conserve seulement les derniers messages et respecte le plafond de caractères', () => {
  const memory = createAiMemory({ maxMessages: 4, maxChars: 512 });
  memory.appendTurn('session::chat', 'ancienne question', 'ancienne réponse');
  memory.appendTurn('session::chat', 'question suivante', 'réponse suivante');
  memory.appendTurn('session::chat', 'x'.repeat(300), 'y'.repeat(300));

  const messages = memory.getMessages('session::chat');
  assert.ok(messages.length <= 4);
  assert.equal(messages.at(-2).role, 'user');
  assert.equal(messages.at(-1).role, 'assistant');
  assert.ok(messages.reduce((sum, message) => sum + message.content.length, 0) <= 512);
});

test('les conversations expirent après le TTL sans timer de fond', () => {
  let now = 1_000_000;
  const memory = createAiMemory({ ttlMs: 60_000, now: () => now });
  memory.appendTurn('session::chat', 'bonjour', 'salut');
  assert.equal(memory.getMessages('session::chat').length, 2);

  now += 60_000;
  assert.deepEqual(memory.getMessages('session::chat'), []);
  assert.equal(memory.getStats().conversations, 0);
});

test('la mémoire est bornée et applique un ordre LRU', () => {
  const memory = createAiMemory({ maxConversations: 2 });
  memory.appendTurn('session::one', '1', 'a');
  memory.appendTurn('session::two', '2', 'b');
  memory.getMessages('session::one');
  memory.appendTurn('session::three', '3', 'c');

  assert.deepEqual(memory.getMessages('session::two'), []);
  assert.equal(memory.getStats().conversations, 2);
});

test('clearSession supprime uniquement les conversations de la session demandée', () => {
  const memory = createAiMemory();
  memory.appendTurn('5091::chat-a', 'question', 'réponse');
  memory.appendTurn('5091::chat-b', 'question', 'réponse');
  memory.appendTurn('5092::chat-a', 'question', 'réponse');

  assert.equal(memory.clearSession('5091'), 2);
  assert.deepEqual(memory.getMessages('5091::chat-a'), []);
  assert.equal(memory.getMessages('5092::chat-a').length, 2);
});
