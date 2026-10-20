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
