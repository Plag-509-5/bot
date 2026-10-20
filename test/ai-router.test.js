'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AiRouterError,
  createAiRouter,
  normalizeCompatibleEndpoint
} = require('../src/services/ai-router');

function fakeResponse(payload, status = 200, retryAfter = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name === 'retry-after' ? retryAfter : null; } },
    async text() { return JSON.stringify(payload); }
  };
}

test('le routeur transmet exactement le même historique aux fournisseurs de secours', async () => {
  const prompts = [];
  let now = 10_000;
  const router = createAiRouter({
    env: { AI_PROVIDER_ORDER: 'first,second' },
    now: () => now,
    providers: [
      {
        name: 'first',
        isConfigured: () => true,
        async complete(messages) {
          prompts.push(messages);
          throw Object.assign(new Error('provider down'), { status: 503 });
        }
      },
      {
        name: 'second',
        isConfigured: () => true,
        async complete(messages) {
          prompts.push(messages);
          return { text: 'Réponse de secours', provider: 'second', model: 'model-b' };
        }
      }
    ]
  });
  const conversation = [
    { role: 'system', content: 'Tu es Kaido.' },
    { role: 'user', content: 'Question précédente' },
    { role: 'assistant', content: 'Réponse précédente' },
    { role: 'user', content: 'Question actuelle' }
  ];

  const result = await router.complete(conversation);
  assert.equal(result.provider, 'second');
  assert.equal(result.text, 'Réponse de secours');
  assert.deepEqual(prompts[0], prompts[1]);
  assert.deepEqual(prompts[0], conversation);
  assert.equal(router.getStatus()[0].coolingDown, true);

  now += 1000;
  await router.complete(conversation);
  assert.equal(prompts.length, 3, 'le fournisseur en cooldown est sauté au prochain tour');
});

test('le routeur échoue proprement quand aucune clé API n’est configurée', async () => {
  const router = createAiRouter({ env: {}, fetchImpl: async () => { throw new Error('ne doit pas appeler le réseau'); } });
  await assert.rejects(router.complete([{ role: 'user', content: 'bonjour' }]), error => {
    assert.ok(error instanceof AiRouterError);
    assert.equal(error.code, 'no_provider_configured');
    return true;
  });
});

test('le provider Gemini reçoit le rôle system et l’historique user/model sans exposer la clé dans l’URL', async () => {
  let requestInfo;
  const router = createAiRouter({
    env: {
      GEMINI_API_KEY: 'secret-test-key',
      GEMINI_MODEL: 'test-flash',
      AI_PROVIDER_ORDER: 'gemini',
      AI_MAX_OUTPUT_TOKENS: '123'
    },
    fetchImpl: async (url, init) => {
      requestInfo = { url, init, body: JSON.parse(init.body) };
      return fakeResponse({ candidates: [{ content: { parts: [{ text: 'Salut, je suis Kaido.' }] } }] });
    }
  });
  const result = await router.complete([
    { role: 'system', content: 'Personnalité Kaido' },
    { role: 'user', content: 'Ancienne question' },
    { role: 'assistant', content: 'Ancienne réponse' },
    { role: 'user', content: 'Question actuelle' }
  ]);

  assert.equal(result.provider, 'gemini');
  assert.equal(result.model, 'test-flash');
  assert.equal(result.text, 'Salut, je suis Kaido.');
  assert.match(requestInfo.url, /test-flash:generateContent/);
  assert.equal(requestInfo.url.includes('secret-test-key'), false);
  assert.equal(requestInfo.init.headers['x-goog-api-key'], 'secret-test-key');
  assert.equal(requestInfo.body.systemInstruction.parts[0].text, 'Personnalité Kaido');
  assert.deepEqual(requestInfo.body.contents.map(item => item.role), ['user', 'model', 'user']);
  assert.equal(requestInfo.body.generationConfig.maxOutputTokens, 123);
});

test('le provider Groq utilise l’endpoint OpenAI-compatible et conserve les messages', async () => {
  let requestInfo;
  const router = createAiRouter({
    env: {
      GROQ_API_KEY: 'groq-test-key',
      GROQ_MODEL: 'test-model',
      AI_PROVIDER_ORDER: 'groq'
    },
    fetchImpl: async (url, init) => {
      requestInfo = { url, init, body: JSON.parse(init.body) };
      return fakeResponse({ choices: [{ message: { content: 'La réponse arrive.' } }] });
    }
  });
  const messages = [
    { role: 'system', content: 'Kaido' },
    { role: 'user', content: 'bonjour' }
  ];
  const result = await router.complete(messages);

  assert.equal(requestInfo.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(requestInfo.init.headers.authorization, 'Bearer groq-test-key');
  assert.deepEqual(requestInfo.body.messages, messages);
  assert.equal(requestInfo.body.max_completion_tokens, 400);
  assert.equal('max_tokens' in requestInfo.body, false);
  assert.equal(result.text, 'La réponse arrive.');
});

test('Jina DeepSearch utilise son endpoint, son modèle et uniquement les champs documentés', async () => {
  let requestInfo;
  const router = createAiRouter({
    env: {
      JINA_API_KEY: 'jina-test-key',
      JINA_MODEL: 'jina-deepsearch-v1',
      JINA_REQUEST_TIMEOUT_MS: '90000',
      AI_PROVIDER_ORDER: 'jina'
    },
    fetchImpl: async (url, init) => {
      requestInfo = { url, init, body: JSON.parse(init.body) };
      return fakeResponse({ choices: [{ message: { content: 'Voici la réponse Jina.' } }] });
    }
  });
  const messages = [
    { role: 'system', content: 'Tu es Kaido.' },
    { role: 'user', content: 'Réponds à ma question.' }
  ];
  const result = await router.complete(messages);

  assert.equal(requestInfo.url, 'https://deepsearch.jina.ai/v1/chat/completions');
  assert.equal(requestInfo.init.headers.authorization, 'Bearer jina-test-key');
  assert.deepEqual(requestInfo.body, { model: 'jina-deepsearch-v1', messages, stream: false });
  assert.equal(result.provider, 'jina');
  assert.equal(result.text, 'Voici la réponse Jina.');
});

test('les modèles libres OpenRouter utilisent le routeur gratuit par défaut', async () => {
  let body;
  const router = createAiRouter({
    env: { OPENROUTER_API_KEY: 'or-test', AI_PROVIDER_ORDER: 'openrouter' },
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return fakeResponse({ choices: [{ message: { content: 'Bonjour.' } }] });
    }
  });
  await router.complete([{ role: 'user', content: 'bonjour' }]);
  assert.equal(body.model, 'openrouter/free');
});

test('un endpoint compatible n’accepte que HTTPS et normalise la route chat completions', () => {
  assert.equal(normalizeCompatibleEndpoint('https://example.test/v1/'), 'https://example.test/v1/chat/completions');
  assert.equal(normalizeCompatibleEndpoint('https://example.test/v1/chat/completions'), 'https://example.test/v1/chat/completions');
  assert.equal(normalizeCompatibleEndpoint('http://localhost:1234/v1'), '');
  assert.equal(normalizeCompatibleEndpoint('https://user:pass@example.test/v1'), '');
});
