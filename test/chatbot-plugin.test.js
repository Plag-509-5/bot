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

test('la commande documente les actions si l’argument manque ou est invalide', async () => {
  const state = fixture(['unknown'], { isOwner: true });
  await plugin.execute(state.context);
  assert.match(state.sent[0].content.text, /chatbot on/);
  assert.match(state.sent[0].content.text, /chatbot off/);
});
