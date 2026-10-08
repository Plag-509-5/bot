'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateChat,
  modeAllowsChat,
  unwrapMessage,
  resolveOriginalAuthor,
  resolveRevoker,
  resolveConversationName,
  buildAntideleteHeader,
  sendRecoveredMessage
} = require('../services/antidelete');

const OWNER = '50911111111@s.whatsapp.net';

function asyncStream(buffer) {
  return (async function* stream() {
    yield buffer.subarray(0, Math.max(1, Math.floor(buffer.length / 2)));
    yield buffer.subarray(Math.max(1, Math.floor(buffer.length / 2)));
  }());
}

test('.ad p accepte les discussions privées PN et LID mais refuse groupes/statuts', () => {
  assert.equal(isPrivateChat('50922222222@s.whatsapp.net'), true);
  assert.equal(isPrivateChat('263217590849594@lid'), true);
  assert.equal(modeAllowsChat('p', '263217590849594@lid'), true);
  assert.equal(modeAllowsChat('p', '120363000000000@g.us'), false);
  assert.equal(modeAllowsChat('p', 'status@broadcast'), false);
  assert.equal(modeAllowsChat('g', '120363000000000@g.us'), true);
});

test('identifie le vrai suppresseur privé depuis le message REVOKE et non le bot', () => {
  const stored = {
    key: {
      id: 'original-1',
      fromMe: false,
      remoteJid: '263217590849594@lid',
      remoteJidAlt: '50922222222@s.whatsapp.net'
    },
    pushName: 'Plagy'
  };
  const revoke = {
    key: {
      fromMe: false,
      remoteJid: '263217590849594@lid',
      remoteJidAlt: '50922222222@s.whatsapp.net'
    },
    pushName: 'Plagy'
  };

  const author = resolveOriginalAuthor(stored, stored.key.remoteJid, OWNER);
  const revoker = resolveRevoker(revoke, stored.key.remoteJid, OWNER, author);
  assert.equal(author, '50922222222@s.whatsapp.net');
  assert.equal(revoker, '50922222222@s.whatsapp.net');
  assert.notEqual(revoker, OWNER);
});

test('distingue dans un groupe le suppresseur de l’auteur original et affiche le nom du groupe', async () => {
  const chatId = '120363000000000@g.us';
  const stored = {
    key: { participant: '50933333333@s.whatsapp.net', fromMe: false },
    pushName: 'Auteur'
  };
  const revoke = {
    key: { participant: '50944444444@s.whatsapp.net', fromMe: false }
  };
  const socket = {
    async groupMetadata(jid) {
      assert.equal(jid, chatId);
      return { subject: 'Groupe des tests' };
    }
  };

  const author = resolveOriginalAuthor(stored, chatId, OWNER);
  const revoker = resolveRevoker(revoke, chatId, OWNER, author);
  const conversationName = await resolveConversationName(socket, chatId, stored, revoke);
  const header = buildAntideleteHeader({
    revokerJid: revoker,
    authorJid: author,
    conversationName,
    timestamp: 'Tuesday 6 October 2026, 12:11:44'
  });

  assert.equal(revoker, '50944444444@s.whatsapp.net');
  assert.equal(author, '50933333333@s.whatsapp.net');
  assert.match(header, /Supprimé par[^\n]*@50944444444/);
  assert.match(header, /Auteur original[^\n]*@50933333333/);
  assert.match(header, /Conversation[^\n]*Groupe des tests/);
});

test('le titre privé utilise pushName et retire les anciennes lignes inutiles', async () => {
  const chatId = '263217590849594@lid';
  const stored = { key: { fromMe: false }, pushName: 'Plagy' };
  const name = await resolveConversationName({}, chatId, stored, null);
  const header = buildAntideleteHeader({
    revokerJid: '50922222222@s.whatsapp.net',
    authorJid: '50922222222@s.whatsapp.net',
    conversationName: name,
    timestamp: 'maintenant'
  });

  assert.equal(name, 'Plagy');
  assert.match(header, /Conversation[^\n]*Plagy/);
  assert.doesNotMatch(header, /Privé\s*:/i);
  assert.doesNotMatch(header, /Message retransmis ci-dessous/i);
  assert.doesNotMatch(header, /263217590849594/);
});

test('récupère et renvoie directement une image supprimée avec sa légende', async () => {
  const sent = [];
  const socket = {
    async sendMessage(jid, payload) { sent.push({ jid, payload }); }
  };
  const media = Buffer.from('image-binaire-test');
  const storedMessage = {
    key: { id: 'image-1' },
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: { caption: 'Légende test', mimetype: 'image/jpeg', viewOnce: true }
        }
      }
    }
  };

  const unwrapped = unwrapMessage(storedMessage.message);
  assert.equal(unwrapped.isViewOnce, true);
  const result = await sendRecoveredMessage({
    socket,
    ownerJid: OWNER,
    storedMessage,
    header: 'ENTÊTE ANTIDELETE',
    mentions: ['50922222222@s.whatsapp.net'],
    async downloadContent(node, type) {
      assert.equal(type, 'image');
      assert.equal(node.caption, 'Légende test');
      return asyncStream(media);
    }
  });

  assert.deepEqual(result, { method: 'media', type: 'image' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload.image, media);
  assert.match(sent[0].payload.caption, /ENTÊTE ANTIDELETE/);
  assert.match(sent[0].payload.caption, /Légende test/);
});

test('récupère aussi vidéos, audios, documents et stickers supprimés', async () => {
  const cases = [
    { key: 'videoMessage', type: 'video', payloadKey: 'video', node: { mimetype: 'video/mp4' } },
    { key: 'audioMessage', type: 'audio', payloadKey: 'audio', node: { mimetype: 'audio/ogg', ptt: true } },
    { key: 'documentMessage', type: 'document', payloadKey: 'document', node: { mimetype: 'application/pdf', fileName: 'preuve.pdf' } },
    { key: 'stickerMessage', type: 'sticker', payloadKey: 'sticker', node: { mimetype: 'image/webp' } }
  ];

  for (const fixture of cases) {
    const sent = [];
    const socket = {
      async sendMessage(jid, payload) { sent.push({ jid, payload }); }
    };
    const binary = Buffer.from(`binaire-${fixture.type}`);
    const result = await sendRecoveredMessage({
      socket,
      ownerJid: OWNER,
      storedMessage: { message: { [fixture.key]: fixture.node } },
      header: 'ENTÊTE',
      mentions: [],
      async downloadContent(node, type) {
        assert.equal(type, fixture.type);
        return asyncStream(binary);
      }
    });
    assert.equal(result.method, 'media');
    assert.deepEqual(sent.at(-1).payload[fixture.payloadKey], binary);
    if (fixture.type === 'audio') assert.equal(sent.at(-1).payload.ptt, true);
    if (fixture.type === 'document') assert.equal(sent.at(-1).payload.fileName, 'preuve.pdf');
  }
});

test('renvoie un message texte supprimé dans une seule alerte', async () => {
  const sent = [];
  const socket = {
    async sendMessage(jid, payload) { sent.push({ jid, payload }); }
  };
  const result = await sendRecoveredMessage({
    socket,
    ownerJid: OWNER,
    storedMessage: { message: { conversation: 'Message original' } },
    header: 'ENTÊTE',
    mentions: [],
    async downloadContent() { throw new Error('ne doit pas être appelé'); }
  });

  assert.equal(result.method, 'text');
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.text, /Message original/);
});
