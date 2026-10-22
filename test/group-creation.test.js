'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGroupCreationParticipant } = require('../src/services/group-creation');

const socket = { user: { id: '50900000000:5@s.whatsapp.net' } };

test('cgroup utilise le participant et son JID téléphonique, pas le JID du groupe', () => {
  assert.equal(resolveGroupCreationParticipant({
    key: {
      remoteJid: '120363000000000000@g.us',
      participant: '188811111111@lid',
      participantAlt: '50911111111:2@s.whatsapp.net'
    },
    message: {}
  }, socket), '50911111111@s.whatsapp.net');
});

test('cgroup prend le JID de la personne en conversation privée', () => {
  assert.equal(resolveGroupCreationParticipant({
    key: { remoteJid: '50922222222:3@s.whatsapp.net', fromMe: false },
    message: {}
  }, socket), '50922222222@s.whatsapp.net');
});

test('depuis le compte du bot, cgroup exige un membre mentionné et exclut le bot', () => {
  const message = {
    key: { remoteJid: '50900000000@s.whatsapp.net', fromMe: true },
    message: { extendedTextMessage: { contextInfo: { mentionedJid: ['50933333333@s.whatsapp.net'] } } }
  };
  assert.equal(resolveGroupCreationParticipant(message, socket), '50933333333@s.whatsapp.net');
  message.message.extendedTextMessage.contextInfo.mentionedJid = ['50900000000@s.whatsapp.net'];
  assert.equal(resolveGroupCreationParticipant(message, socket), '');
});
