'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTION_NAME,
  configureTranslationStorage,
  saveSessionLanguage,
  getSessionLanguage,
  setupTranslationWrapper,
  MAX_CONCURRENT_TRANSLATIONS,
  _test
} = require('../src/features/translation');

function configureStorage({ findOne = async () => null, updateOne = async () => ({ acknowledged: true }) } = {}) {
  configureTranslationStorage({
    initMongo: async () => {},
    getDb: () => ({
      collection(name) {
        assert.equal(name, COLLECTION_NAME);
        return { findOne, updateOne };
      }
    }),
    languageLookupTimeoutMs: 25
  });
}

function fakeSocket() {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: 'sent' } };
    }
  };
}

test('MongoDB lent ou bloqué ne retarde pas les réponses WhatsApp', async () => {
  _test.clearCache();
  configureStorage({ findOne: () => new Promise(() => {}) });
  const socket = fakeSocket();
  setupTranslationWrapper(socket, '50947440869', { languageLookupTimeoutMs: 25 });

  const startedAt = Date.now();
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'Réponse immédiate' });
  assert.ok(Date.now() - startedAt < 100, 'la recherche de langue ne doit pas être sur le chemin critique');
  assert.equal(socket.sent[0].content.text, 'Réponse immédiate');
  assert.equal(await getSessionLanguage('50947440869'), 'fr');
  _test.clearCache();
});

test('la traduction en cache fonctionne sans modifier le contenu original', async () => {
  _test.clearCache();
  configureStorage();
  await saveSessionLanguage('50947440869', 'en');
  const socket = fakeSocket();
  setupTranslationWrapper(socket, '50947440869', {
    translate: async text => ({ text: `EN: ${text}` }),
    translationTimeoutMs: 50
  });
  const content = { text: 'Bonjour', caption: 'Légende' };

  await socket.sendMessage('chat@s.whatsapp.net', content, { quoted: { key: { id: 'q' } } });
  assert.deepEqual(socket.sent[0].content, { text: 'EN: Bonjour', caption: 'EN: Légende' });
  assert.equal(content.text, 'Bonjour');
  assert.equal(content.caption, 'Légende');
  assert.equal(socket.sent[0].options.quoted.key.id, 'q');
  _test.clearCache();
});

test('une API de traduction bloquée retombe sur le texte original avec délai borné', async () => {
  _test.clearCache();
  configureStorage();
  await saveSessionLanguage('50947440869', 'en');
  const socket = fakeSocket();
  let resolveTranslation;
  setupTranslationWrapper(socket, '50947440869', {
    translate: () => new Promise(resolve => { resolveTranslation = resolve; }),
    translationTimeoutMs: 15
  });

  const startedAt = Date.now();
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'Toujours livrer' });
  assert.ok(Date.now() - startedAt < 150, 'la traduction ne doit pas bloquer indéfiniment');
  assert.equal(socket.sent[0].content.text, 'Toujours livrer');
  resolveTranslation({ text: 'late translation' });
  await new Promise(resolve => setImmediate(resolve));
  _test.clearCache();
});

test('borne le nombre de requêtes de traduction concurrentes entre sessions', async () => {
  _test.clearCache();
  configureStorage();
  await saveSessionLanguage('50947440869', 'en');
  let started = 0;
  const finish = [];
  const sockets = Array.from({ length: 5 }, () => fakeSocket());
  for (const socket of sockets) {
    setupTranslationWrapper(socket, '50947440869', {
      translate: () => new Promise(resolve => {
        started += 1;
        finish.push(() => resolve({ text: 'translated' }));
      }),
      translationTimeoutMs: 100
    });
  }

  const sends = sockets.map(socket => socket.sendMessage('chat@s.whatsapp.net', {
    text: 'hello',
    caption: 'caption'
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, MAX_CONCURRENT_TRANSLATIONS);
  for (const resolve of finish) resolve();
  await Promise.all(sends);
  assert.ok(sockets.every(socket => socket.sent.length === 1));
  _test.clearCache();
});

test('enregistre immédiatement une langue confirmée en MongoDB dans le cache mémoire', async () => {
  _test.clearCache();
  let saved;
  configureStorage({
    updateOne: async (filter, update) => {
      saved = { filter, update };
      return { acknowledged: true };
    }
  });

  await saveSessionLanguage('50947440869', 'es');
  assert.equal(saved.filter.sessionId, '50947440869');
  assert.equal(saved.update.$set.lang, 'es');
  assert.equal(await getSessionLanguage('50947440869'), 'es');
  _test.clearCache();
});
