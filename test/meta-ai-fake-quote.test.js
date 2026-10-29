'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupMetaAiFakeQuote } = require('../src/services/meta-ai-fake-quote');
const menu = require('../src/plugins/general/menu');

function fakeSocket() {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      if (content?.event) return { key: { id: 'event-1', remoteJid: jid }, message: { eventMessage: { ...content.event } } };
      return { key: { id: `msg-${sent.length}`, remoteJid: jid }, message: content };
    }
  };
}

test('all ordinary bot replies receive a fresh Meta AI fake contact quote', async () => {
  const socket = fakeSocket();
  setupMetaAiFakeQuote(socket);
  await socket.sendMessage('chat@s.whatsapp.net', { text: 'Réponse' }, { quoted: { key: { id: 'real-user-message' }, message: { conversation: 'hello' } } });
  const quote = socket.sent[0].options.quoted;
  assert.equal(quote.message.contactMessage.displayName, 'Meta AI');
  assert.match(quote.message.contactMessage.vcard, /ORG:Meta Platforms/);
  assert.notEqual(quote.key.id, 'real-user-message');
});

test('control reactions and actual event messages are not wrapped as fake quotes', async () => {
  const socket = fakeSocket();
  setupMetaAiFakeQuote(socket);
  await socket.sendMessage('chat@s.whatsapp.net', { react: { text: '🐉', key: { id: 'msg' } } });
  await socket.sendMessage('chat@s.whatsapp.net', { event: { name: 'Menu', startDate: new Date() } });
  assert.deepEqual(socket.sent[0].options, {});
  assert.deepEqual(socket.sent[1].options, {});
});

test('menu sends one message with its full text, artwork preview, and decorative event quote', async () => {
  const socket = fakeSocket();
  await menu._test.sendMenuPresentation({
    socket,
    from: 'chat@s.whatsapp.net',
    msg: { key: { id: 'command' } },
    text: 'Texte du menu complet',
    mentions: ['123@s.whatsapp.net'],
    botName: 'Kaido'
  });
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].content.text, 'Texte du menu complet');
  assert.ok(socket.sent[0].content.contextInfo.externalAdReply.thumbnail.length > 0);
  assert.ok(socket.sent[0].content.contextInfo.externalAdReply.thumbnail.length < 50_000);
  assert.equal(socket.sent[0].content.contextInfo.externalAdReply.title, 'Kaido — Menu');
  assert.deepEqual(socket.sent[0].content.mentions, ['123@s.whatsapp.net']);
  assert.equal(socket.sent[0].options.quoted.message.eventMessage.name, 'Kaido • Menu');
});

test('menu event quote builder creates a synthetic native event for fallback quoting', () => {
  const fake = menu._test.createFakeMenuEventQuote('Kaido', 1_000_000);
  assert.equal(fake.key.remoteJid, 'status@broadcast');
  assert.equal(fake.message.eventMessage.name, 'Kaido • Menu');
  assert.equal(fake.message.eventMessage.endTime - fake.message.eventMessage.startTime, 3600);
});
