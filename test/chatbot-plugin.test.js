'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../src/plugins/owner/chatbot');

function fixture(args, overrides = {}) {
  const sent = [];
  const saved = [];
  const context = {
    socket: { async sendMessage(jid, content) { sent.push({ jid, content }); } },
    msg: { key: { id: 'm1' } },
    from: 'chat@s.whatsapp.net',
    args,
    prefix: '.',
    senderNumber: '50911111111',
    sessionNumber: '50911111111',
    sessionCfg: { CHATBOT_ENABLED: true, PREFIX: '.' },
    async setUserConfigInMongo(number, config) {
      saved.push({ number, config });
      return true;
    },
    ...overrides
  };
  return { context, sent, saved };
}

test('le propriétaire peut désactiver le chatbot et effacer la mémoire de sa session', async () => {
  const state = fixture(['off'], { isSessionOwner: true });
  await plugin.execute(state.context);
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].number, '50911111111');
  assert.equal(state.saved[0].config.CHATBOT_ENABLED, false);
  assert.match(state.sent.at(-1).content.text, /désactivé/i);
  assert.match(state.sent.at(-1).content.text, /mémoire.*effacée/i);
});

test('la désactivation envoie le profil appris en TXT dans le privé puis demande sa restauration future', async () => {
  const state = fixture(['off'], {
    isSessionOwner: true,
    sender: '50911111111@s.whatsapp.net',
    sessionCfg: {
      CHATBOT_ENABLED: true,
      CHATBOT_HOST_NAME: 'Mika',
      CHATBOT_HOST_IDENTITIES: ['50911111111@s.whatsapp.net'],
      CHATBOT_WATCH_ENABLED: true,
      CHATBOT_WATCH_SAMPLES: ['Sak pase?']
    }
  });
  await plugin.execute(state.context);

  assert.equal(state.saved.length, 2);
  const file = state.sent.find(entry => entry.content.fileName === 'kaido-profil.txt');
  assert.ok(file);
  assert.equal(file.jid, '50911111111@s.whatsapp.net');
  assert.equal(file.content.mimetype, 'text/plain');
  const exported = JSON.parse(file.content.document.toString('utf8'));
  assert.equal(exported.hostName, 'Mika');
  assert.deepEqual(exported.watchSamples, ['Sak pase?']);
  assert.equal(state.saved.at(-1).config.CHATBOT_PROFILE_IMPORT_PENDING, true);
  assert.deepEqual(state.saved.at(-1).config.CHATBOT_WATCH_SAMPLES, []);
  assert.equal(state.saved.at(-1).config.CHATBOT_HOST_NAME, '');
});

test('à la réactivation, une demande privée invite à renvoyer le TXT même si le nom a été vidé', async () => {
  const previous = process.env.JINA_API_KEY;
  process.env.JINA_API_KEY = 'test-only';
  try {
    const state = fixture(['on'], {
      isSessionOwner: true,
      sender: '50911111111@s.whatsapp.net',
      sessionCfg: {
        CHATBOT_ENABLED: false,
        CHATBOT_PROFILE_IMPORT_PENDING: true,
        CHATBOT_HOST_IDENTITIES: ['50911111111@s.whatsapp.net'],
        CHATBOT_HOST_NAME: '',
        CHATBOT_WATCH_SAMPLES: []
      }
    });
    await plugin.execute(state.context);
    assert.equal(state.saved[0].config.CHATBOT_ENABLED, true);
    assert.equal(state.saved[0].config.CHATBOT_PROFILE_IMPORT_PENDING, true);
    assert.equal(state.sent[0].jid, '50911111111@s.whatsapp.net');
    assert.match(state.sent[0].content.text, /renvoie ici le fichier TXT/i);
  } finally {
    if (previous === undefined) delete process.env.JINA_API_KEY;
    else process.env.JINA_API_KEY = previous;
  }
});

test('un administrateur ne peut pas remplacer l’identité persistante de l’hôte', () => {
  const saved = ['50911111111@s.whatsapp.net'];
  assert.deepEqual(plugin._test.resolveHostIdentities({ CHATBOT_HOST_IDENTITIES: saved }, {
    senderNumber: '50922222222',
    sessionNumber: '50911111111',
    access: { candidates: new Set(['50922222222@s.whatsapp.net']) }
  }), saved);
  assert.deepEqual(plugin._test.resolveHostIdentities({ CHATBOT_HOST_IDENTITIES: saved }, {
    senderNumber: '50911111111',
    sessionNumber: '50911111111',
    access: { candidates: new Set(['50911111111@s.whatsapp.net', 'host-lid@lid']) }
  }), ['50911111111@s.whatsapp.net', 'host-lid@lid', '50911111111']);
});

test('un utilisateur non privilégié ne peut pas modifier le switch', async () => {
  const state = fixture(['on'], {
    senderNumber: '50922222222',
    sessionNumber: '50911111111'
  });
  await plugin.execute(state.context);
  assert.equal(state.saved.length, 0);
  assert.match(state.sent[0].content.text, /propriétaire/i);
});

test('un sudo, un administrateur Mongo et le propriétaire sont autorisés', () => {
  assert.equal(plugin._test.canManageChatbot({ isSudo: true }), true);
  assert.equal(plugin._test.canManageChatbot({ isMongoAdmin: true }), true);
  assert.equal(plugin._test.canManageChatbot({ isOwner: true }), true);
  assert.equal(plugin._test.canManageChatbot({ isSessionOwner: true }), true);
  assert.equal(plugin._test.canManageChatbot({ senderNumber: '50911111111', sessionNumber: '50911111111' }), true);
  assert.equal(plugin._test.canManageChatbot({ senderNumber: '50911111111', sessionNumber: '50922222222' }), false);
});

test('la commande documente le nom Kaido et les commandes Watch', async () => {
  const state = fixture(['unknown'], { isOwner: true });
  await plugin.execute(state.context);
  assert.match(state.sent[0].content.text, /kaido on/);
  assert.match(state.sent[0].content.text, /kaido watch/);
  assert.match(state.sent[0].content.text, /kaido name/);
});

test('kaido on demande le nom de l’hôte avant d’activer le chatbot', async () => {
  const previous = process.env.JINA_API_KEY;
  process.env.JINA_API_KEY = 'test-only';
  try {
    const state = fixture(['on'], { isSessionOwner: true });
    await plugin.execute(state.context);
    assert.equal(state.saved[0].config.CHATBOT_ENABLED, false);
    assert.equal(state.saved[0].config.CHATBOT_PENDING_HOST_NAME.enableAfterName, true);
    assert.match(state.sent[0].content.text, /comment dois-je t’appeler/i);
  } finally {
    if (previous === undefined) delete process.env.JINA_API_KEY;
    else process.env.JINA_API_KEY = previous;
  }
});

test('kaido name demande puis enregistre le nom de l’hôte dans la configuration Mongo', async () => {
  const prompt = fixture(['name'], { isSessionOwner: true });
  await plugin.execute(prompt.context);
  assert.ok(prompt.saved[0].config.CHATBOT_PENDING_HOST_NAME);
  assert.match(prompt.sent[0].content.text, /Comment dois-je t’appeler/);

  const direct = fixture(['name', 'Mika'], { isSessionOwner: true });
  await plugin.execute(direct.context);
  assert.equal(direct.saved[0].config.CHATBOT_HOST_NAME, 'Mika');
  assert.equal(direct.saved[0].config.CHATBOT_PENDING_HOST_NAME, null);
});

test('kaido watch peut être activé ou effacé sans désactiver le profil du chatbot', async () => {
  const on = fixture(['watch'], { isSessionOwner: true, sessionCfg: { CHATBOT_ENABLED: true, CHATBOT_WATCH_SAMPLES: ['salut'] } });
  await plugin.execute(on.context);
  assert.equal(on.saved[0].config.CHATBOT_WATCH_ENABLED, true);
  assert.deepEqual(on.saved[0].config.CHATBOT_WATCH_SAMPLES, ['salut']);

  const clear = fixture(['watch', 'clear'], { isSessionOwner: true, sessionCfg: { CHATBOT_ENABLED: true, CHATBOT_WATCH_ENABLED: true, CHATBOT_WATCH_SAMPLES: ['salut'] } });
  await plugin.execute(clear.context);
  assert.deepEqual(clear.saved[0].config.CHATBOT_WATCH_SAMPLES, []);
  assert.equal(clear.saved[0].config.CHATBOT_ENABLED, true);
});
