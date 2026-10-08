'use strict';

// Contrats de contenu communs aux commandes (pas exécution de leurs API web).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');
const baileys = require('@whiskeysockets/baileys');
const { makeOfflineSocket } = require('./helpers/baileys-socket');

const USER = '50990000002@s.whatsapp.net';
const KEY = { remoteJid: USER, id: '3EB0QUOTED', fromMe: false };
const QUOTED = { key: KEY, message: { conversation: 'Texte cité' } };

async function roundTrip(payload, options = {}) {
  const message = await baileys.generateWAMessageContent(payload, options);
  const wrapped = baileys.generateWAMessageFromContent(USER, message, {
    userJid: '50990000001@s.whatsapp.net', quoted: QUOTED
  });
  return baileys.proto.Message.decode(baileys.proto.Message.encode(wrapped.message).finish());
}

test('textes, mentions, citations et contexte externalAdReply utilisés par menu/aide restent encodables', async () => {
  const decoded = await roundTrip({
    text: 'Bonjour @50990000002', mentions: [USER],
    contextInfo: { externalAdReply: { title: 'Kaido', body: 'Menu', sourceUrl: 'https://example.invalid', mediaType: 1 } }
  });
  assert.equal(decoded.extendedTextMessage.text, 'Bonjour @50990000002');
  assert.deepEqual(decoded.extendedTextMessage.contextInfo.mentionedJid, [USER]);
  assert.equal(decoded.extendedTextMessage.contextInfo.stanzaId, KEY.id);
  assert.equal(decoded.extendedTextMessage.contextInfo.externalAdReply.title, 'Kaido');
});

test('réactions, suppression, édition, transfert et contacts des commandes gardent leur type protobuf', async () => {
  const reaction = await roundTrip({ react: { text: '🔥', key: KEY } });
  assert.equal(reaction.reactionMessage.text, '🔥');
  assert.equal(reaction.reactionMessage.key.id, KEY.id);
  const deleted = await roundTrip({ delete: KEY });
  assert.equal(deleted.protocolMessage.type, baileys.proto.Message.ProtocolMessage.Type.REVOKE);
  const edited = await roundTrip({ text: 'Texte modifié', edit: KEY });
  assert.equal(edited.protocolMessage.type, baileys.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT);
  assert.equal(edited.protocolMessage.editedMessage.extendedTextMessage.text, 'Texte modifié');
  const forwarded = await roundTrip({ forward: QUOTED });
  assert.equal(forwarded.extendedTextMessage.text, 'Texte cité');
  const contacts = await roundTrip({ contacts: {
    displayName: 'Test', contacts: [{ displayName: 'Test', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Test\nTEL:+50990000002\nEND:VCARD' }]
  } });
  assert.equal(contacts.contactMessage.displayName, 'Test');
});

test('les boutons legacy de configuration passent par generateWAMessageContent puis le vrai relais groupe', async t => {
  const patched = [];
  const { socket, state, nodes } = makeOfflineSocket(t, {
    cachedGroupMetadata: async jid => ({ id: jid, participants: [], addressingMode: 'pn' }),
    patchMessageBeforeSending(message) { patched.push(message); return message; }
  });
  state.creds.me = { id: '50990000001:1@s.whatsapp.net' };
  const sent = await socket.sendMessage('120363000000001@g.us', {
    text: 'Configuration', headerType: 1, footer: 'Choisis',
    buttons: [{ buttonId: 'antistatusmention_on', buttonText: { displayText: 'ON' }, type: 1 }]
  }, { quoted: { ...QUOTED, key: { ...KEY, remoteJid: '120363000000001@g.us', participant: USER } } });
  assert.equal(sent.message.buttonsMessage.buttons[0].buttonId, 'antistatusmention_on');
  const interactive = patched.at(-1).interactiveMessage;
  assert.equal(interactive.body.text, 'Configuration');
  const button = interactive.nativeFlowMessage.buttons[0];
  assert.equal(button.name, 'quick_reply');
  assert.equal(JSON.parse(button.buttonParamsJson).id, 'antistatusmention_on');
  assert.ok(baileys.getBinaryNodeChild(nodes.at(-1), 'enc'));
});

test('stickers WebP, documents et image view-once des commandes utilisent le vrai préparateur média', async () => {
  const input = sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } });
  const webp = await input.clone().webp().toBuffer();
  const png = await input.png().toBuffer();
  const uploads = [];
  const upload = async (file, info) => {
    assert.equal(typeof file, 'string');
    assert.ok(fs.readFileSync(file).length);
    uploads.push(info.mediaType);
    return { mediaUrl: 'https://media.invalid/test', directPath: '/test' };
  };
  const sticker = await roundTrip({ sticker: webp }, { upload });
  assert.equal(sticker.stickerMessage.mimetype, 'image/webp');
  const document = await roundTrip({ document: Buffer.from('%PDF-1.4\n%%EOF'), mimetype: 'application/pdf', fileName: 'test.pdf' }, { upload });
  assert.equal(document.documentMessage.fileName, 'test.pdf');
  const once = await roundTrip({ image: png, mimetype: 'image/png', viewOnce: true }, { upload });
  assert.ok(once.viewOnceMessage.message.imageMessage);
  assert.deepEqual(uploads, ['sticker', 'document', 'image']);
});
