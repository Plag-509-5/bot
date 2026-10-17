'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getChatbotInput } = require('../src/services/chatbot-message');

test('le texte reçu est transmis tel quel', () => {
  assert.equal(getChatbotInput({ message: { conversation: 'Salut Kaido' } }, 'Salut Kaido'), 'Salut Kaido');
});

test('une légende d’image est transmise comme texte, sans octets média', () => {
  const input = getChatbotInput({
    message: { imageMessage: { caption: 'Que vois-tu ?', jpegThumbnail: Buffer.from('private') } }
  }, 'Que vois-tu ?');
  assert.equal(input, 'L’utilisateur a envoyé une image avec ce texte ou cette légende : Que vois-tu ?');
  assert.doesNotMatch(input, /private/);
});

test('les wrappers view-once sont décrits mais leur média n’est pas transmis', () => {
  const input = getChatbotInput({
    message: { viewOnceMessageV2: { message: { imageMessage: {} } } }
  }, '');
  assert.match(input, /image sans légende/i);
  assert.match(input, /n’est pas transmis/i);
});

test('l’audio est signalé sans prétendre le transcrire ni le téléverser', () => {
  const input = getChatbotInput({ message: { audioMessage: { ptt: true, mediaKey: 'secret' } } }, '');
  assert.match(input, /message vocal/);
  assert.match(input, /aucune transcription/);
  assert.doesNotMatch(input, /secret/);
});

test('les coordonnées et les données de contacts ne sont pas incluses', () => {
  const location = getChatbotInput({
    message: { locationMessage: { degreesLatitude: 18.5, degreesLongitude: -72.3 } }
  }, '');
  const contact = getChatbotInput({
    message: { contactMessage: { vcard: 'BEGIN:VCARD\nTEL:+50912345678' } }
  }, '');
  assert.match(location, /coordonnées ne sont pas transmises/);
  assert.doesNotMatch(location, /18\.5|-72\.3/);
  assert.match(contact, /coordonnées du contact ne sont pas transmises/);
  assert.doesNotMatch(contact, /50912345678/);
});

test('les notifications système sans texte exploitable sont ignorées', () => {
  assert.equal(getChatbotInput({ message: { protocolMessage: { type: 0 } } }, ''), null);
  assert.equal(getChatbotInput({ message: { reactionMessage: { text: '🔥' } } }, ''), null);
});
