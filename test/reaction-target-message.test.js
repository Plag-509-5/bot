'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getConversationMessage,
  resolveReactionTargetMessage
} = require('../src/services/reaction-target-message');

const targetKey = {
  remoteJid: '246454467731604@lid',
  id: 'A50ABE483971B8A65577A88A72883877'
};
const targetMessage = {
  key: targetKey,
  message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true } }
};

test('préfère le message cible du cache de session', async () => {
  const result = await resolveReactionTargetMessage({
    cachedMessage: targetMessage,
    socket: { loadMessage: async () => { throw new Error('ne doit pas charger'); } },
    targetKey
  });
  assert.equal(result, targetMessage);
});

test('charge un message cible absent du cache local depuis le store Baileys', async () => {
  const socket = {
    store: {
      async loadMessage(jid, id) {
        assert.equal(jid, targetKey.remoteJid);
        assert.equal(id, targetKey.id);
        return targetMessage;
      }
    }
  };
  assert.equal(await resolveReactionTargetMessage({ socket, targetKey }), targetMessage);
});

test('recherche dans la collection de conversation d’un store Baileys', () => {
  const store = {
    messages: new Map([[targetKey.remoteJid, { array: [targetMessage] }]])
  };
  assert.equal(getConversationMessage(store, targetKey), targetMessage);
});

test('renvoie null si le message cité ne se trouve dans aucun store', async () => {
  assert.equal(await resolveReactionTargetMessage({ socket: {}, targetKey }), null);
});
