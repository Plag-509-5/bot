'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const savePlugin = require('../src/plugins/tools/save');

const selfJid = '50900000000@s.whatsapp.net';
const requesterJid = '50911111111@s.whatsapp.net';

function fakeSocket() {
  const sent = [];
  return {
    sent,
    socket: {
      user: { id: '50900000000:2@s.whatsapp.net' },
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: `send-${sent.length}` } };
      }
    }
  };
}

test('.save transfère le statut cité vers le chat « Vous » du compte du bot', async () => {
  const { socket, sent } = fakeSocket();
  const status = {
    imageMessage: { url: 'https://media.example/story.jpg', caption: 'Statut original' }
  };
  const msg = {
    key: { remoteJid: requesterJid, fromMe: false, id: 'save-command' },
    message: {
      extendedTextMessage: {
        text: '.save',
        contextInfo: {
          remoteJid: 'status@broadcast',
          participant: selfJid,
          stanzaId: 'status-abc',
          quotedMessage: status
        }
      }
    }
  };
  await savePlugin.execute({
    socket,
    msg,
    from: requesterJid,
    quotedMsg: status
  });

  const forward = sent.find(event => event.content?.forward);
  assert.ok(forward);
  assert.equal(forward.jid, selfJid);
  assert.notEqual(forward.jid, requesterJid);
  assert.equal(forward.content.forward.key.remoteJid, 'status@broadcast');
  assert.equal(forward.content.forward.key.id, 'status-abc');
  assert.equal(forward.content.forward.key.participant, selfJid);
  assert.equal(forward.content.forward.key.fromMe, true);
  assert.equal(forward.content.forward.message.imageMessage.caption, 'Statut original');
});

test('.save conserve le transfert dans « Vous » et retire le drapeau vue unique', async () => {
  const { socket, sent } = fakeSocket();
  const image = { mimetype: 'image/jpeg', viewOnce: true, url: 'https://media.example/once.jpg' };
  const quoted = { viewOnceMessageV2: { message: { imageMessage: image } } };
  const msg = {
    key: { remoteJid: requesterJid, fromMe: false, id: 'save-viewonce' },
    message: {
      extendedTextMessage: {
        text: '.save',
        contextInfo: {
          remoteJid: requesterJid,
          participant: requesterJid,
          stanzaId: 'quoted-viewonce',
          quotedMessage: quoted
        }
      }
    }
  };
  await savePlugin.execute({ socket, msg, from: requesterJid, quotedMsg: quoted });

  const forward = sent.find(event => event.content?.forward);
  assert.equal(forward.jid, selfJid);
  assert.equal(forward.content.forward.message.imageMessage.viewOnce, false);
  assert.equal(sent.some(event => event.jid === requesterJid && event.content?.forward), false);
});
