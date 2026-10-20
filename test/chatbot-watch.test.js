'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendWatchSample,
  buildChatbotStyleInstruction,
  cleanHostName,
  collectHostIdentities,
  createPendingHostName,
  createReplyTracker,
  formatChatbotReply,
  isHostMessage,
  matchesPendingHostName,
  normalizeWatchSamples
} = require('../src/services/chatbot-watch');

test('le nom de l’hôte est nettoyé et les identités sont dédupliquées', () => {
  assert.equal(cleanHostName('  Jean\nPaul  '), 'Jean Paul');
  assert.deepEqual(collectHostIdentities({
    sender: '50911111111@s.whatsapp.net',
    senderNumber: '50911111111',
    access: { candidates: new Set(['50911111111', '50911111111@s.whatsapp.net']) }
  }), ['50911111111', '50911111111@s.whatsapp.net']);
  assert.equal(isHostMessage({ CHATBOT_HOST_IDENTITIES: ['50911111111@s.whatsapp.net'] }, ['50911111111@s.whatsapp.net']), true);
});

test('la réponse au nom de l’hôte est liée au chat, à son identité et expire', () => {
  let clock = 100;
  const pending = createPendingHostName({
    chatJid: 'group@g.us', identities: ['50911111111@s.whatsapp.net'], enableAfterName: true, now: () => clock
  });
  assert.equal(pending.enableAfterName, true);
  assert.equal(matchesPendingHostName(pending, {
    chatJid: 'group@g.us', identities: ['50911111111@s.whatsapp.net'], now: () => clock
  }), true);
  assert.equal(matchesPendingHostName(pending, {
    chatJid: 'other@g.us', identities: ['50911111111@s.whatsapp.net'], now: () => clock
  }), false);
  assert.equal(matchesPendingHostName(pending, {
    chatJid: 'group@g.us', identities: ['50922222222@s.whatsapp.net'], now: () => clock
  }), false);
  clock += 11 * 60 * 1000;
  assert.equal(matchesPendingHostName(pending, {
    chatJid: 'group@g.us', identities: ['50911111111@s.whatsapp.net'], now: () => clock
  }), false);
});

test('Watch conserve des exemples bornés, garde les plus récents et construit un prompt de style', () => {
  let samples = [];
  for (let i = 0; i < 25; i += 1) samples = appendWatchSample(samples, `message ${i}`).samples;
  assert.equal(samples.length, 20);
  assert.equal(samples[0], 'message 5');
  const instruction = buildChatbotStyleInstruction({ hostName: 'Jean', watchEnabled: true, watchSamples: samples });
  assert.match(instruction, /Jean/);
  assert.match(instruction, /habitudes de forme/);
  assert.match(instruction, /message 24/);
  assert.equal(normalizeWatchSamples(Array(20).fill('x'.repeat(240))).length, 15);
});

test('les réponses gardent un habillage simple et le tracker empêche d’apprendre les réponses du bot', () => {
  assert.equal(formatChatbotReply('Salut !', 'Mika'), '🐉 *Mika*\n\nSalut !\n\n> 🤖 Kaido-MD');
  let clock = 500;
  const tracker = createReplyTracker({ ttlMs: 20, now: () => clock });
  tracker.mark('5091', 'chat@s.whatsapp.net', 'Réponse générée');
  assert.equal(tracker.consume('5091', 'chat@s.whatsapp.net', 'Réponse générée'), true);
  assert.equal(tracker.consume('5091', 'chat@s.whatsapp.net', 'Réponse générée'), false);
  tracker.mark('5091', 'chat@s.whatsapp.net', 'expirée');
  clock += 21;
  assert.equal(tracker.consume('5091', 'chat@s.whatsapp.net', 'expirée'), false);
});
