'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_BASE_URL,
  resolveChatEndpoint,
  extractDarkAiText,
  createDarkAiClient
} = require('../src/services/darkai-client');
const darkaiPlugin = require('../src/plugins/ai/darkai');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

test('publie la commande .darkai et affiche son aide sans question', async () => {
  assert.equal(darkaiPlugin.name, 'darkai');
  const sent = [];
  await darkaiPlugin.execute({
    socket: { async sendMessage(...args) { sent.push(args); } },
    msg: { key: { id: 'test' } },
    from: '509123@s.whatsapp.net',
    args: [],
    prefix: '.'
  });
  assert.match(sent[0][1].text, /\.darkai/);
});

test('construit le endpoint /v1/chat sans dupliquer le chemin', () => {
  assert.equal(resolveChatEndpoint(DEFAULT_BASE_URL), `${DEFAULT_BASE_URL}/v1/chat`);
  assert.equal(resolveChatEndpoint('https://example.test/api/v1/chat/'), 'https://example.test/api/v1/chat');
  assert.throws(() => resolveChatEndpoint('file:///tmp/api'), /HTTP\(S\)/);
  assert.throws(() => resolveChatEndpoint('https://user:pass@example.test'), /sans identifiants/);
});

test('extrait les formats de réponse usuels sans supposer un seul schéma', () => {
  assert.equal(extractDarkAiText({ message: { content: 'Bonjour' } }), 'Bonjour');
  assert.equal(extractDarkAiText({ response: 'Réponse' }), 'Réponse');
  assert.equal(extractDarkAiText({ choices: [{ message: { content: [{ text: 'A' }, { text: 'B' }] } }] }), 'A\nB');
});

test('envoie messages au POST /v1/chat avec X-API-Key et les limites documentées', async () => {
  let request;
  const client = createDarkAiClient({
    env: {
      DARKAI_API_KEY: 'test-secret',
      DARKAI_BASE_URL: 'http://localhost:8765',
      DARKAI_ALLOW_INSECURE_HTTP: 'true',
      DARKAI_NUM_CTX: '4096',
      DARKAI_TEMPERATURE: '0.4',
      DARKAI_MAX_TOKENS: '512'
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ message: { role: 'assistant', content: 'Réponse de test.' } });
    }
  });

  const result = await client.complete([
    { role: 'system', content: 'Règle système' },
    { role: 'user', content: 'Question' },
    { role: 'ignored', content: 'doit être filtré' }
  ]);

  assert.equal(result.text, 'Réponse de test.');
  assert.equal(request.url, 'http://localhost:8765/v1/chat');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-API-Key'], 'test-secret');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
  assert.equal(body.workspace_id, null);
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.equal(body.num_ctx, 4096);
  assert.equal(body.temperature, 0.4);
  assert.equal(body.max_tokens, 512);
});

test('ne transmet pas la clé sur HTTP sans opt-in explicite', async () => {
  let called = false;
  const client = createDarkAiClient({
    env: { DARKAI_API_KEY: 'test-secret', DARKAI_BASE_URL: 'http://localhost:8765' },
    fetchImpl: async () => { called = true; return jsonResponse({ response: 'should not run' }); }
  });
  await assert.rejects(
    () => client.complete([{ role: 'user', content: 'Salut' }]),
    error => error.code === 'insecure_transport'
  );
  assert.equal(called, false);
});

test('refuse une clé absente et ne lance pas de requête', async () => {
  let called = false;
  const client = createDarkAiClient({
    env: {},
    fetchImpl: async () => { called = true; return jsonResponse({}); }
  });
  await assert.rejects(() => client.complete([{ role: 'user', content: 'Salut' }]), error => error.code === 'not_configured');
  assert.equal(called, false);
});

test('convertit les erreurs HTTP sans exposer la clé API', async () => {
  const key = 'should-never-appear-in-error';
  const client = createDarkAiClient({
    env: { DARKAI_API_KEY: key, DARKAI_ALLOW_INSECURE_HTTP: 'true' },
    fetchImpl: async () => jsonResponse({ detail: 'unauthorized' }, 401)
  });
  await assert.rejects(
    () => client.complete([{ role: 'user', content: 'Salut' }]),
    error => error.code === 'authentication' && !error.message.includes(key)
  );
});

test('rejette les réponses HTTP réussies sans texte exploitable', async () => {
  const client = createDarkAiClient({
    env: { DARKAI_API_KEY: 'test', DARKAI_BASE_URL: 'https://api.example.test' },
    fetchImpl: async () => jsonResponse({ model: 'qwen3' })
  });
  await assert.rejects(
    () => client.complete([{ role: 'user', content: 'Salut' }]),
    error => error.code === 'empty_response'
  );
});
