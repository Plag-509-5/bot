'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTION_NAME,
  configureTranslationStorage,
  saveSessionLanguage,
  getSessionLanguage,
  setupTranslationWrapper,
  setSessionFontTheme,
  FONT_THEME_OPTIONS,
  SKIP_FORMATTING_OPTION,
  SUPPORTED_LANGUAGES,
  _test
} = require('../src/features/translation');

function configureStorage({ findOne = async () => null, updateOne = async () => ({ acknowledged: true }), getSessionConfig } = {}) {
  configureTranslationStorage({
    initMongo: async () => {},
    getDb: () => ({
      collection(name) {
        assert.equal(name, COLLECTION_NAME);
        return { findOne, updateOne };
      }
    }),
    getSessionConfig,
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

test('MongoDB lent ne retarde pas les réponses et les réponses statiques sont stylisées localement', async () => {
  _test.clearCache();
  configureStorage({ findOne: () => new Promise(() => {}) });
  const socket = fakeSocket();
  setupTranslationWrapper(socket, '50947440869', { languageLookupTimeoutMs: 25 });

  const startedAt = Date.now();
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'Réponse immédiate' });
  assert.ok(Date.now() - startedAt < 100, 'la recherche de langue reste hors du chemin critique');
  assert.match(socket.sent[0].content.text, /[\u{1D400}-\u{1D7FF}]/u);
  assert.equal(await getSessionLanguage('50947440869'), 'fr');
  _test.clearCache();
});

test('les phrases statiques utilisent le catalogue local choisi et préservent les commandes', async () => {
  _test.clearCache();
  configureStorage();
  await saveSessionLanguage('50947440869', 'en');
  const socket = fakeSocket();
  setupTranslationWrapper(socket, '50947440869');
  const original = { text: 'Aucun quiz en cours. Lance-en un avec .quiz.' };

  await socket.sendMessage('chat@s.whatsapp.net', original, { quoted: { key: { id: 'q' } } });
  assert.equal(
    socket.sent[0].content.text,
    _test.styleStaticText('No quiz is running. Start one with .quiz.', 'sans-bold')
  );
  assert.ok(socket.sent[0].content.text.includes('.quiz.'));
  assert.equal(original.text, 'Aucun quiz en cours. Lance-en un avec .quiz.');
  assert.equal(socket.sent[0].options.quoted.key.id, 'q');
  _test.clearCache();
});

test('restaure le thème sélectionné depuis la configuration persistée de la session', async () => {
  _test.clearCache();
  configureStorage({ getSessionConfig: async () => ({ FONT_THEME: 'a' }) });
  assert.equal(await _test.primeSessionFontTheme('50947440869'), 'a');
  assert.equal(_test.getCachedFontTheme('50947440869'), 'a');
  _test.clearCache();
});

test('le thème sélectionné reste stable et s’applique aux textes et légendes statiques', async () => {
  _test.clearCache();
  configureStorage();
  setSessionFontTheme('50947440869', 'a');
  const socket = fakeSocket();
  setupTranslationWrapper(socket, '50947440869');
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'Réponse stable', caption: 'Légende stable' });
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'Deuxième réponse' });
  assert.equal(socket.sent[0].content.text, _test.styleStaticText('Réponse stable', 'small-caps'));
  assert.equal(socket.sent[0].content.caption, _test.styleStaticText('Légende stable', 'small-caps'));
  assert.equal(socket.sent[1].content.text, _test.styleStaticText('Deuxième réponse', 'small-caps'));
  assert.equal(Object.keys(FONT_THEME_OPTIONS).join(''), 'abcd');
  _test.clearCache();
});

test('les réponses IA et codes peuvent ignorer traduction et stylisation sans transmettre l’option interne', async () => {
  _test.clearCache();
  configureStorage();
  await saveSessionLanguage('50947440869', 'ht');
  const socket = fakeSocket();
  setupTranslationWrapper(socket, '50947440869');
  const aiText = 'Kaido answers in English, even if that is not the selected language.';

  await socket.sendMessage('chat@s.whatsapp.net', { text: aiText }, {
    quoted: { key: { id: 'q' } },
    [SKIP_FORMATTING_OPTION]: true
  });
  assert.equal(socket.sent[0].content.text, aiText);
  assert.deepEqual(socket.sent[0].options, { quoted: { key: { id: 'q' } } });
  _test.clearCache();
});

test('le style garde les commandes, numéros et mentions techniquement copiables', () => {
  const styled = _test.styleStaticText('Réponds avec .quiz à @50912345678 ou au 50911111111.', 'sans-bold');
  assert.ok(styled.includes('.quiz'));
  assert.ok(styled.includes('@50912345678'));
  assert.ok(styled.includes('50911111111'));
});

test('les catalogues locaux existent pour toutes les langues sélectionnables', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['fr', 'en', 'es', 'ht']);
  for (const language of SUPPORTED_LANGUAGES) {
    assert.ok(_test.loadLocale(language));
  }
  assert.equal(_test.translateStaticText('Configuration réussie !', 'ht'), 'Konfigirasyon an anrejistre!');
  assert.throws(() => _test.assertLanguage('de'), /Langue indisponible/);
});

test('enregistre immédiatement la langue confirmée dans MongoDB et le cache mémoire', async () => {
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
