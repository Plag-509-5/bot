'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const savePlugin = require('../src/plugins/tools/save');
const { executePlugin, loadPlugins } = require('../src/core/pluginLoader');
const { resolveReactionTargetMessage } = require('../src/services/reaction-target-message');

const selfJid = '50900000000@s.whatsapp.net';
const requesterJid = '50911111111@s.whatsapp.net';
const groupJid = '120363000000000000@g.us';

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
    quotedMsg: status,
    command: 'save'
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
  await savePlugin.execute({ socket, msg, from: requesterJid, quotedMsg: quoted, command: 'save' });

  const forward = sent.find(event => event.content?.forward);
  assert.equal(forward.jid, selfJid);
  assert.equal(forward.content.forward.message.imageMessage.viewOnce, false);
  assert.equal(sent.some(event => event.jid === requesterJid && event.content?.forward), false);
});

test('.save sur réaction télécharge un média direct @lid même si le marqueur view-once a été perdu', async () => {
  const { socket, sent } = fakeSocket();
  const targetChat = '246454467731604@lid';
  const targetMessage = {
    key: { remoteJid: targetChat, fromMe: false, id: 'A50ABE483971B8A65577A88A72883877', participant: requesterJid },
    message: {
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'Vue unique directe',
        url: 'https://media.example/once.jpg'
      }
    }
  };
  const targetKey = { ...targetMessage.key };
  const recovered = await resolveReactionTargetMessage({
    cachedMessage: targetMessage,
    socket,
    targetKey
  });
  assert.equal(recovered, targetMessage);

  const syntheticMsg = {
    key: { remoteJid: targetChat, fromMe: false, id: 'reaction-save', participant: requesterJid },
    message: {
      extendedTextMessage: {
        text: '.save',
        contextInfo: {
          remoteJid: targetChat,
          stanzaId: targetMessage.key.id,
          participant: requesterJid,
          quotedMessage: { conversation: 'autre charge utile de test' }
        }
      }
    }
  };
  loadPlugins(false);
  const handled = await executePlugin('save', {
    socket,
    msg: syntheticMsg,
    from: targetChat,
    sender: requesterJid,
    command: 'save',
    quoted: recovered.message,
    isReactionCommand: true,
    downloadContentFromMessage: async (media, type) => {
      assert.equal(media, targetMessage.message.imageMessage);
      assert.equal(type, 'image');
      return Readable.from([Buffer.from('saved from reaction')]);
    }
  });
  assert.equal(handled, true);

  const saved = sent.find(event => event.jid === selfJid && event.content?.image);
  assert.ok(saved, 'le média cité doit être téléchargé puis enregistré dans « Vous »');
  assert.equal(saved.content.image.toString(), 'saved from reaction');
  assert.equal(saved.content.caption, 'Vue unique directe');
  assert.equal(sent.some(event => event.content?.forward), false);
  assert.equal(sent.some(event => event.content?.text?.includes('Réponds à un média')), false);
});

test('.save via une réaction déballée envoie une vue unique éphémère vers « Vous »', async () => {
  const { socket, sent } = fakeSocket();
  const targetChat = '120363000000000000@g.us';
  const image = { mimetype: 'image/jpeg', viewOnce: true, caption: 'Photo éphémère', fileLength: 123 };
  const targetMessage = {
    key: { remoteJid: targetChat, fromMe: false, id: 'ephemeral-view-once', participant: requesterJid },
    message: {
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: {
            message: { imageMessage: image }
          }
        }
      }
    }
  };
  const syntheticMsg = {
    key: { remoteJid: targetChat, fromMe: false, id: 'reaction-save-ephemeral', participant: requesterJid },
    message: {
      extendedTextMessage: {
        text: '.save',
        contextInfo: {
          remoteJid: targetChat,
          stanzaId: targetMessage.key.id,
          participant: requesterJid,
          quotedMessage: targetMessage.message
        }
      }
    }
  };
  const bytes = Buffer.from('decrypted ephemeral view-once image');
  await savePlugin.execute({
    socket,
    msg: syntheticMsg,
    from: targetChat,
    command: 'save',
    quotedMsg: targetMessage.message,
    isReactionCommand: true,
    downloadContentFromMessage: async (content, mediaType) => {
      assert.equal(content, image);
      assert.equal(mediaType, 'image');
      return Readable.from([bytes]);
    }
  });

  const saved = sent.find(event => event.jid === selfJid && event.content?.image);
  assert.ok(saved, 'la vue unique décodée doit être réenvoyée dans « Vous »');
  assert.equal(saved.content.image.toString(), bytes.toString());
  assert.equal(saved.content.caption, 'Photo éphémère');
  assert.equal(saved.content.mimetype, 'image/jpeg');
  assert.equal(sent.some(event => event.content?.forward), false, 'une vue unique doit être téléchargée puis réenvoyée, pas forwardée comme proto chiffré');
});

test('.vv extrait une vue unique via le quote d’un alias de réaction et renvoie le média dans le même groupe', async () => {
  const { socket, sent } = fakeSocket();
  const image = { mimetype: 'image/png', viewOnce: true, caption: 'Photo privée' };
  const quoted = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2Extension: {
          message: { imageMessage: image }
        }
      }
    }
  };
  const reactionCommandMessage = {
    key: { remoteJid: groupJid, fromMe: false, id: 'reaction-command' },
    message: {
      extendedTextMessage: {
        text: '.vv',
        contextInfo: {
          remoteJid: groupJid,
          stanzaId: 'view-once-original',
          participant: requesterJid,
          quotedMessage: quoted
        }
      }
    },
    quoted: { msg: quoted, sender: requesterJid, id: 'view-once-original' }
  };
  const bytes = Buffer.from('decoded view-once image');

  loadPlugins(false);
  const handled = await executePlugin('vv', {
    socket,
    msg: reactionCommandMessage,
    from: groupJid,
    sender: requesterJid,
    command: 'vv',
    quotedMsg: quoted,
    downloadContentFromMessage: async (content, mediaType) => {
      assert.equal(content, image);
      assert.equal(mediaType, 'image');
      return Readable.from([bytes]);
    }
  });
  assert.equal(handled, true, 'le plugin doit reconnaître l’alias réaction .vv');

  const media = sent.find(event => event.content?.image);
  assert.ok(media, 'le média doit être renvoyé');
  assert.equal(media.jid, groupJid);
  assert.equal(media.content.image.toString(), bytes.toString());
  assert.equal(media.content.mimetype, 'image/png');
  assert.equal(media.options.quoted, reactionCommandMessage);
  assert.equal(sent.some(event => event.jid === selfJid && event.content?.image), false);
});

test('.vv refuse un média normal sans drapeau view-once', async () => {
  const { socket, sent } = fakeSocket();
  const quoted = { imageMessage: { mimetype: 'image/jpeg' } };
  const msg = {
    key: { remoteJid: requesterJid, fromMe: false, id: 'vv-normal' },
    message: { extendedTextMessage: { text: '.vv' } }
  };

  await savePlugin.execute({
    socket,
    msg,
    from: requesterJid,
    command: 'vv',
    quotedMsg: quoted,
    downloadContentFromMessage: async () => { throw new Error('ne doit pas être appelé'); }
  });

  assert.equal(sent.some(event => event.content?.image), false);
  assert.ok(sent.some(event => event.jid === requesterJid && /vue unique/i.test(event.content?.text || '')));
});
