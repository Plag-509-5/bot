'use strict';

/**
 * Commandes ssweb et ia : fournisseurs de secours, validation des images,
 * clé Gemini passée en en-tête, et fonctionnement identique en privé et en groupe.
 * Aucun appel réseau réel : le client HTTP est simulé.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ssweb = require('../src/plugins/tools/ssweb');
const ai = require('../src/plugins/ai/ai');

// En-têtes binaires minimaux reconnus comme images.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 2)]);

function fakeHttp(routes) {
  const calls = [];
  const http = {
    calls,
    async get(url, options = {}) {
      calls.push({ method: 'GET', url, options });
      for (const [match, handler] of routes) {
        if (url.includes(match)) return handler(url, options);
      }
      throw new Error(`hors-ligne : ${url}`);
    },
    async post(url, body, options = {}) {
      calls.push({ method: 'POST', url, body, options });
      for (const [match, handler] of routes) {
        if (url.includes(match)) return handler(url, body, options);
      }
      throw new Error(`hors-ligne : ${url}`);
    }
  };
  return http;
}

function fakeSocket() {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: 'X', remoteJid: jid } };
    }
  };
}

// ------------------------------------------------------------------ ssweb

test('ssweb normalise les URLs et refuse les mots sans domaine', () => {
  const { normaliseUrl } = ssweb._test;
  assert.equal(normaliseUrl('google.com'), 'https://google.com/');
  assert.equal(normaliseUrl('https://example.org/page'), 'https://example.org/page');
  assert.equal(normaliseUrl('hello'), null);
  assert.equal(normaliseUrl('ftp://example.com'), null);
  assert.equal(normaliseUrl(''), null);
});

test('ssweb borne la taille demandée (LxH)', () => {
  const { parseSize } = ssweb._test;
  assert.deepEqual(parseSize('1920x1080'), { width: 1920, height: 1080 });
  assert.deepEqual(parseSize('50000x10'), { width: 3840, height: 200 });
  assert.deepEqual(parseSize('abc'), { width: 1280, height: 720 });
  assert.deepEqual(parseSize(undefined), { width: 1280, height: 720 });
});

test('ssweb reconnaît PNG, JPEG et WEBP et rejette le reste', () => {
  const { detectImageType } = ssweb._test;
  assert.equal(detectImageType(PNG), 'png');
  assert.equal(detectImageType(JPEG), 'jpeg');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);
  assert.equal(detectImageType(webp), 'webp');
  assert.equal(detectImageType(Buffer.from('<html>erreur</html>'.padEnd(2000, ' '))), null);
});

test('ssweb utilise le premier fournisseur qui renvoie une vraie image', async () => {
  const http = fakeHttp([
    ['movanest.xyz', () => ({ data: { result: 'https://cdn.example/shot.png' } })],
    ['cdn.example', () => ({ data: PNG })]
  ]);
  const { buffer, provider } = await ssweb._test.captureScreenshot('https://example.org', { width: 800, height: 600 }, http);
  assert.equal(provider, 'movanest');
  assert.ok(buffer.equals(PNG));
  assert.ok(http.calls[0].url.includes('width=800&height=600&full_page=true'));
});

test('ssweb bascule sur thum.io quand le premier fournisseur échoue', async () => {
  const http = fakeHttp([
    ['movanest.xyz', () => { throw new Error('503'); }],
    ['image.thum.io', () => ({ data: JPEG })]
  ]);
  const { buffer, provider } = await ssweb._test.captureScreenshot('https://example.org', { width: 1280, height: 720 }, http);
  assert.equal(provider, 'thum.io');
  assert.ok(buffer.equals(JPEG));
});

test('ssweb ne renvoie pas une page HTML d’erreur comme si c’était une capture', async () => {
  const http = fakeHttp([
    ['movanest.xyz', () => ({ data: { result: 'https://cdn.example/err' } })],
    ['cdn.example', () => ({ data: Buffer.from('<html>Access denied</html>'.padEnd(3000, ' ')) })],
    ['image.thum.io', () => ({ data: Buffer.from('<html>blocked</html>'.padEnd(3000, ' ')) })]
  ]);
  await assert.rejects(
    () => ssweb._test.captureScreenshot('https://example.org', { width: 1280, height: 720 }, http),
    /capture impossible.*movanest.*thum\.io/s
  );
});

test('ssweb fonctionne en conversation privée (répond à `from`, sans contrainte de groupe)', async () => {
  const socket = fakeSocket();
  const privateJid = '50912345678@s.whatsapp.net';
  const http = fakeHttp([['image.thum.io', () => ({ data: PNG })], ['movanest.xyz', () => { throw new Error('off'); }]]);
  await ssweb.execute({
    socket, msg: { key: { remoteJid: privateJid, id: 'M1' } }, from: privateJid,
    args: ['google.com', '1920x1080'], prefix: '.', dependencies: { http }
  });
  const image = socket.sent.find((m) => m.content.image);
  assert.ok(image, 'une image doit être envoyée');
  assert.equal(image.jid, privateJid);
  assert.ok(Buffer.isBuffer(image.content.image), 'image envoyée en binaire, pas en URL');
  assert.match(image.content.caption, /1920x1080/);
});

test('ssweb sans URL affiche l’usage et ne fait aucun appel réseau', async () => {
  const socket = fakeSocket();
  const http = fakeHttp([]);
  await ssweb.execute({ socket, msg: { key: { id: 'M2' } }, from: 'g@g.us', args: [], prefix: '.', dependencies: { http } });
  assert.equal(http.calls.length, 0);
  assert.match(socket.sent[0].content.text, /Usage/);
});

// --------------------------------------------------------------------- ia

test('ia envoie la clé Gemini dans un en-tête, jamais dans l’URL', async () => {
  const http = fakeHttp([
    ['generativelanguage.googleapis.com', () => ({
      data: { candidates: [{ content: { parts: [{ text: 'Port-au-Prince' }] } }] }
    })]
  ]);
  const answer = await ai._test.askGemini('capitale ?', { http, apiKey: 'SECRET-KEY', model: 'gemini-test' });
  assert.equal(answer, 'Port-au-Prince');
  const call = http.calls[0];
  assert.ok(!call.url.includes('SECRET-KEY'), 'la clé ne doit pas apparaître dans l’URL');
  assert.equal(call.options.headers['x-goog-api-key'], 'SECRET-KEY');
  assert.ok(call.url.includes('/models/gemini-test:generateContent'));
});

test('ia utilise Gemini quand une clé est configurée', async () => {
  const http = fakeHttp([
    ['generativelanguage.googleapis.com', () => ({ data: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } })]
  ]);
  const { answer, provider } = await ai._test.askAI('test', { http, apiKey: 'k' });
  assert.equal(answer, 'OK');
  assert.equal(provider, 'gemini');
});

test('ia se rabat sur les endpoints gratuits si Gemini échoue', async () => {
  const http = fakeHttp([
    ['generativelanguage.googleapis.com', () => { throw new Error('quota'); }],
    ['giftedtech', () => ({ data: { result: 'Réponse gratuite' } })]
  ]);
  const { answer, provider } = await ai._test.askAI('test', { http, apiKey: 'k' });
  assert.equal(answer, 'Réponse gratuite');
  assert.equal(provider, 'gratuit');
});

test('ia sans clé utilise directement les endpoints gratuits', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const http = fakeHttp([
      ['giftedtech', () => ({ data: { result: 'sans clé' } })]
    ]);
    const { answer, provider } = await ai._test.askAI('test', { http });
    assert.equal(answer, 'sans clé');
    assert.equal(provider, 'gratuit');
    assert.ok(!http.calls.some((c) => c.url.includes('generativelanguage')), 'Gemini ne doit pas être appelé sans clé');
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test('ia affiche une erreur explicite si tous les fournisseurs échouent', async () => {
  const socket = fakeSocket();
  const http = fakeHttp([]);
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await ai.execute({ socket, msg: { key: { id: 'A' } }, from: 'x@s.whatsapp.net', args: ['bonjour'], prefix: '.', dependencies: { http } });
    const last = socket.sent[socket.sent.length - 1];
    assert.match(last.content.text, /Erreur IA.*indisponibles/);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test('ia sans question affiche l’usage', async () => {
  const socket = fakeSocket();
  await ai.execute({ socket, msg: { key: { id: 'A' } }, from: 'x@s.whatsapp.net', args: [], prefix: '.', dependencies: {} });
  assert.match(socket.sent[0].content.text, /Usage/);
});
