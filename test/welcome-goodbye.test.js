'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const welcome = require('../src/handlers/welcome_goodbye');

function createStore() {
  const docs = new Map();
  const calls = [];
  const db = {
    collection(name) {
      assert.equal(name, 'group_welcome_goodbye');
      return {
        async findOne(query) { return docs.get(query.groupId) || null; },
        async updateOne(query, update, options) {
          calls.push({ query, update, options });
          docs.set(query.groupId, { ...(docs.get(query.groupId) || { groupId: query.groupId }), ...update.$set });
        }
      };
    }
  };
  return { docs, calls, db };
}

test('Welcome/Goodbye utilisent le stockage Mongo injecté, pas des globals non déclarés', async () => {
  const store = createStore();
  let initialized = 0;
  welcome.configureWelcomeGoodbyeStorage({
    async initMongo() { initialized += 1; },
    getDb: () => store.db
  });

  await welcome.updateGroupSetting('120363@g.us', 'welcomeEnabled', true);
  await welcome.setGoodbyeTemplate('120363@g.us', 'Au revoir {user}');
  const settings = await welcome.getGroupSettings('120363@g.us');
  assert.equal(settings.welcomeEnabled, true);
  assert.equal(settings.goodbyeTemplate, 'Au revoir {user}');
  assert.equal(store.calls.length, 2);
  assert.equal(initialized, 3);
  await assert.rejects(() => welcome.updateGroupSetting('120363@g.us', 'unexpected', true), /inconnu/i);
});

test('les événements Welcome et Goodbye mentionnent correctement un participant chaîne ou objet', async () => {
  const store = createStore();
  welcome.configureWelcomeGoodbyeStorage({ async initMongo() {}, getDb: () => store.db });
  await welcome.updateGroupSetting('120363@g.us', 'welcomeEnabled', true);
  await welcome.updateGroupSetting('120363@g.us', 'goodbyeEnabled', true);
  const sent = [];
  const socket = {
    async groupMetadata() { return { subject: 'Équipage' }; },
    async sendMessage(jid, content) { sent.push({ jid, content }); }
  };

  await welcome.handleParticipantUpdate(socket, '120363@g.us', {
    action: 'add', participants: ['50912345678@s.whatsapp.net']
  });
  await welcome.handleParticipantUpdate(socket, '120363@g.us', {
    action: 'remove', participants: [{ id: '50987654321@s.whatsapp.net' }]
  });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].content.mentions, ['50912345678@s.whatsapp.net']);
  assert.match(sent[0].content.text, /Bienvenue @50912345678/);
  assert.deepEqual(sent[1].content.mentions, ['50987654321@s.whatsapp.net']);
  assert.match(sent[1].content.text, /@50987654321 a quitté/);
});
