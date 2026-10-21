'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChatbotProfileText,
  parseChatbotProfileText,
  MAX_PROFILE_BYTES
} = require('../src/services/chatbot-profile');

test('le profil exporté en TXT restaure le nom et les exemples Watch sans identifiants privés', () => {
  const text = buildChatbotProfileText({
    hostName: 'Nadia',
    watchEnabled: true,
    watchSamples: ['Salut 👋', 'À tantôt!'],
    hostIdentities: ['5095550000@s.whatsapp.net']
  });

  assert.match(text, /"format": "kaido-chatbot-profile"/);
  assert.doesNotMatch(text, /5095550000/);
  assert.deepEqual(parseChatbotProfileText(text), {
    hostName: 'Nadia',
    watchEnabled: true,
    watchSamples: ['Salut 👋', 'À tantôt!']
  });
});

test('le parseur rejette les fichiers invalides et surdimensionnés', () => {
  assert.throws(() => parseChatbotProfileText('ceci n’est pas du JSON'), /profil Kaido valide/);
  assert.throws(() => parseChatbotProfileText(JSON.stringify({ format: 'autre', version: 1 })), /inconnu/);
  assert.throws(() => parseChatbotProfileText(Buffer.alloc(MAX_PROFILE_BYTES + 1)), /trop volumineux/);
});
