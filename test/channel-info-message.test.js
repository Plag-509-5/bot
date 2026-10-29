'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChannelInfoInteractiveMessage } = require('../src/services/channel-info-message');

test('la carte CID construit un CTA copy natif sans en-tête image URL invalide', () => {
  const message = buildChannelInfoInteractiveMessage({
    infoText: 'Channel details',
    botName: 'Kaido',
    copyCode: '123456789'
  });
  assert.equal(message.interactiveMessage.header.title, 'Kaido • Channel');
  assert.equal(message.interactiveMessage.header.hasMediaAttachment, false);
  assert.equal(message.interactiveMessage.nativeFlowMessage.messageVersion, 3);
  const button = message.interactiveMessage.nativeFlowMessage.buttons[0];
  assert.equal(button.name, 'cta_copy');
  assert.equal(JSON.parse(button.buttonParamsJson).copy_code, '123456789');
  assert.equal('imageMessage' in message.interactiveMessage.header, false);
});
