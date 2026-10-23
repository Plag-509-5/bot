'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KAIDO_SYSTEM_PROMPT,
  AiQueueFullError,
  createAiChatbot,
  createKeyedTaskQueue,
  formatAiError
} = require('../src/services/ai-chatbot');

function fakeRouter(complete) {
  return {
    complete,
    getConfiguredProviders() { return ['provider-a', 'provider-b']; },
    getStatus() { return []; }
  };
}

test('la mémoire partagée reste identique quand le routeur change de fournisseur', async () => {
  const prompts = [];
  let call = 0;
  const chatbot = createAiChatbot({
    env: {},
    router: fakeRouter(async messages => {
      prompts.push(messages);
      call += 1;
      return {
        text: `réponse-${call}`,
        provider: call === 1 ? 'provider-a' : 'provider-b',
        model: `model-${call}`
      };
    })
  });

  const first = await chatbot.respond({
    sessionNumber: '509-111',
    chatJid: 'group@g.us',
    senderName: 'Alice',
    text: 'Bonjour Kaido'
  });
  const second = await chatbot.respond({
    sessionNumber: '509111',
    chatJid: 'group@g.us',
    senderName: 'Bob',
    text: 'Tu te souviens de ma question ?'
  });

  assert.equal(first.provider, 'provider-a');
  assert.equal(second.provider, 'provider-b');
  assert.equal(prompts[0][0].role, 'system');
  assert.match(prompts[0][0].content, /Kaido, le Roi des Bêtes/);
  assert.deepEqual(prompts[1].slice(0, 4), [
    { role: 'system', content: `${KAIDO_SYSTEM_PROMPT} Réponds exclusivement en français, même si la question est posée dans une autre langue; conserve les noms propres et les citations nécessaires.` },
    { role: 'user', content: 'Alice : Bonjour Kaido' },
    { role: 'assistant', content: 'réponse-1' },
    { role: 'user', content: 'Bob : Tu te souviens de ma question ?' }
  ]);
  assert.equal(chatbot.getStatus().memory.conversations, 1);
});

test('la langue sélectionnée devient la langue obligatoire des réponses IA', async () => {
  let systemPrompt = '';
  const chatbot = createAiChatbot({
    env: {},
    router: fakeRouter(async messages => {
      systemPrompt = messages[0].content;
      return { text: 'M reponn an kreyòl.', provider: 'provider-a' };
    })
  });
  const result = await chatbot.respond({
    sessionNumber: '5091',
    chatJid: 'chat@s.whatsapp.net',
    text: 'What time is it?',
    language: 'ht'
  });
  assert.match(systemPrompt, /exclusivement en créole haïtien/);
  assert.equal(result.text, 'M reponn an kreyòl.');
});

test('les chats et sessions gardent des historiques distincts', async () => {
  const prompts = [];
  const chatbot = createAiChatbot({
    env: {},
    router: fakeRouter(async messages => {
      prompts.push(messages);
      return { text: 'ok', provider: 'provider-a' };
    })
  });

  await chatbot.respond({ sessionNumber: '5091', chatJid: 'alice@s.whatsapp.net', text: 'secret chat A' });
  await chatbot.respond({ sessionNumber: '5091', chatJid: 'bob@s.whatsapp.net', text: 'chat B' });
  await chatbot.respond({ sessionNumber: '5092', chatJid: 'alice@s.whatsapp.net', text: 'session B' });

  assert.equal(prompts[1].some(message => message.content.includes('secret chat A')), false);
  assert.equal(prompts[2].some(message => message.content.includes('secret chat A')), false);
});

test('la file sérialise les messages d’un chat et rejette un excès de travail en attente', async () => {
  const queue = createKeyedTaskQueue({ concurrency: 1, maxQueue: 2, maxPerKey: 1 });
  let releaseFirst;
  const first = queue.run('session::chat', () => new Promise(resolve => { releaseFirst = resolve; }));
  await Promise.resolve();
  assert.equal(queue.getStats().active, 1);

  const second = queue.run('session::chat', async () => 'second');
  await assert.rejects(
    queue.run('session::chat', async () => 'third'),
    error => error instanceof AiQueueFullError && error.code === 'queue_full'
  );
  const otherChat = queue.run('session::other', async () => 'other');

  releaseFirst('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.equal(await otherChat, 'other');
  assert.deepEqual(queue.getStats().queued, 0);
});

test('désactiver le chatbot pendant un appel annule la réponse et ne réinscrit pas la conversation', async () => {
  let finishRequest;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const responseGate = new Promise(resolve => { finishRequest = resolve; });
  const chatbot = createAiChatbot({
    env: {},
    router: fakeRouter(async () => {
      markStarted();
      await responseGate;
      return { text: 'réponse tardive', provider: 'provider-a' };
    })
  });

  const pending = chatbot.respond({ sessionNumber: '5091', chatJid: 'chat@s.whatsapp.net', text: 'bonjour' });
  await started;
  chatbot.clearSession('5091');
  finishRequest();

  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(chatbot.getStatus().memory.conversations, 0);
});

test('une tâche déjà en file ne part pas si le chatbot est désactivé avant son démarrage', async () => {
  let calls = 0;
  const chatbot = createAiChatbot({
    env: {},
    router: fakeRouter(async () => {
      calls += 1;
      return { text: 'ne doit pas partir', provider: 'provider-a' };
    })
  });
  const result = await chatbot.respond({
    sessionNumber: '5091',
    chatJid: 'chat@s.whatsapp.net',
    text: 'bonjour',
    isActive: async () => false
  });
  assert.equal(result.cancelled, true);
  assert.equal(calls, 0);
});

test('les erreurs IA sont présentées sans exposer les erreurs internes des providers', () => {
  assert.match(formatAiError({ code: 'no_provider_configured' }), /GEMINI_API_KEY/);
  assert.match(formatAiError({ code: 'queue_full' }), /très sollicité/);
  assert.match(formatAiError(new Error('secret provider response')), /indisponibles/);
  assert.doesNotMatch(formatAiError(new Error('secret provider response')), /secret provider response/);
});
