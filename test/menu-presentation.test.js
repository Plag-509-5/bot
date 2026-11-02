'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const menuPlugin = require('../src/plugins/general/menu');

 test('.menu envoie le visuel, le texte et l’événement cité dans un seul message', async () => {
  const sent = [];
  await menuPlugin._test.sendMenuPresentation({
    socket: { async sendMessage(jid, content, options) { sent.push({ jid, content, options }); } },
    from: 'owner@s.whatsapp.net',
    msg: { key: { id: 'menu-request' } },
    text: 'Texte complet du menu',
    mentions: ['owner@s.whatsapp.net'],
    botName: 'KAIDO-MD'
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].content.caption, 'Texte complet du menu');
  assert.deepEqual(sent[0].content.image, fs.readFileSync(menuPlugin._test.MENU_IMAGE_PATH));
  assert.deepEqual(sent[0].content.mentions, ['owner@s.whatsapp.net']);
  assert.equal(sent[0].options.quoted.message.eventMessage.name, 'KAIDO-MD • Menu');
  assert.equal(sent[0].content.contextInfo, undefined);
});
