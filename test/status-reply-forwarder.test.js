'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const forwarderService = require('../src/services/status-reply-forwarder');

const selfJid = '50900000000@s.whatsapp.net';
const senderJid = '50911111111@s.whatsapp.net';
const ownStatus = {
  imageMessage: {
    url: 'https://media.example/status.jpg',
    mimetype: 'image/jpeg',
    caption: 'Photo publiée par le bot'
  }
};

function statusReply({
  id = 'reply-1',
  text = 'Voye foto a tanpri',
  author = selfJid,
  recipient = senderJid,
  remoteJid = 'status@broadcast',
  statusId = 'status-123',
  quotedMessage = ownStatus,
  fromMe = false
} = {}) {
  return {
    key: { remoteJid: recipient, fromMe, id },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: {
          remoteJid,
          participant: author,
          stanzaId: statusId,
          quotedMessage
        }
      }
    }
  };
}

function fakeSocket() {
  const sent = [];
  return {
    sent,
    socket: {
      user: { id: '50900000000:4@s.whatsapp.net' },
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: `sent-${sent.length}` } };
      }
    }
  };
}

test('normalise les mots-clés, retire les accents et exige un mot/une expression complète', () => {
  assert.equal(forwarderService.normalizeKeyword('  VÓYÉ  '), 'voye');
  assert.deepEqual(forwarderService.parseKeywords(['voye, envoie', 'VOYE']), {
    keywords: ['voye', 'envoie'],
    invalid: []
  });
  assert.equal(forwarderService.findMatchingKeyword('S’il vous plaît, ENVOIE-moi la photo !', ['envoie']), 'envoie');
  assert.equal(forwarderService.findMatchingKeyword('il veut envoyer la photo', ['envoie']), '');
  assert.equal(forwarderService.findMatchingKeyword('Voye foto', ['voye']), 'voye');
});

test('reconnaît une réponse à son propre statut et transfère le statut dans le chat privé du répondant', async () => {
  const { socket, sent } = fakeSocket();
  let configReads = 0;
  const handler = forwarderService.createStatusReplyForwarder({
    socket,
    async loadSessionConfig() {
      configReads += 1;
      return {
        STATUS_REPLY_FORWARD_ENABLED: true,
        STATUS_REPLY_KEYWORDS: ['voye', 'envoie']
      };
    }
  });

  const result = await handler.handleMessage(statusReply());
  assert.equal(result.status, 'forwarded');
  assert.equal(result.recipient, senderJid);
  assert.equal(result.keyword, 'voye');
  assert.equal(configReads, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, senderJid);
  assert.equal(sent[0].content.force, true);
  assert.equal(sent[0].content.forward.key.remoteJid, 'status@broadcast');
  assert.equal(sent[0].content.forward.key.id, 'status-123');
  assert.equal(sent[0].content.forward.key.fromMe, true);
  assert.equal(sent[0].content.forward.message.imageMessage.caption, ownStatus.imageMessage.caption);
});

test('ne transfère ni les statuts d’autres personnes ni les messages ordinaires', async () => {
  const { socket, sent } = fakeSocket();
  const handler = forwarderService.createStatusReplyForwarder({
    socket,
    loadSessionConfig: async () => ({
      STATUS_REPLY_FORWARD_ENABLED: true,
      STATUS_REPLY_KEYWORDS: ['envoie']
    })
  });

  const foreign = await handler.handleMessage(statusReply({
    id: 'reply-foreign',
    author: '50922222222@s.whatsapp.net',
    text: 'envoie la photo'
  }));
  const ordinary = await handler.handleMessage({
    key: { remoteJid: senderJid, fromMe: false, id: 'reply-ordinary' },
    message: { conversation: 'envoie la photo' }
  });
  assert.equal(foreign.status, 'not-applicable');
  assert.equal(ordinary.status, 'not-applicable');
  assert.equal(sent.length, 0);
});

test('respecte on/off, ignore les mots non configurés et évite les doubles transferts', async () => {
  const { socket, sent } = fakeSocket();
  let enabled = false;
  const handler = forwarderService.createStatusReplyForwarder({
    socket,
    loadSessionConfig: async () => ({
      STATUS_REPLY_FORWARD_ENABLED: enabled,
      STATUS_REPLY_KEYWORDS: ['envoie']
    })
  });

  assert.equal((await handler.handleMessage(statusReply({ id: 'reply-disabled' }))).status, 'disabled');
  enabled = true;
  assert.equal((await handler.handleMessage(statusReply({ id: 'reply-nomatch', text: 'merci beaucoup' }))).status, 'no-match');
  assert.equal((await handler.handleMessage(statusReply({ id: 'reply-2', text: 'Envoie-moi ça' }))).status, 'forwarded');
  assert.equal((await handler.handleMessage(statusReply({ id: 'reply-2', text: 'Envoie-moi ça' }))).status, 'duplicate');
  assert.equal(sent.length, 1);
});

test('ne transfère pas les événements d’historique ou append comme s’il s’agissait de nouvelles réponses', async () => {
  const { socket, sent } = fakeSocket();
  const handler = forwarderService.createStatusReplyForwarder({
    socket,
    loadSessionConfig: async () => ({
      STATUS_REPLY_FORWARD_ENABLED: true,
      STATUS_REPLY_KEYWORDS: ['voye']
    })
  });
  const results = await handler.handleUpsert({ type: 'append', messages: [statusReply()] });
  assert.deepEqual(results, []);
  assert.equal(sent.length, 0);
});

test('peut extraire un statut cité avec marqueur de source même si remoteJid manque', () => {
  const message = statusReply();
  const contextInfo = message.message.extendedTextMessage.contextInfo;
  delete contextInfo.remoteJid;
  contextInfo.statusSourceType = 0;
  const extracted = forwarderService.extractStatusReply(message, new Set([selfJid]));
  assert.ok(extracted);
  assert.equal(extracted.key.remoteJid, 'status@broadcast');
});
