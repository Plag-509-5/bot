'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const audience = require('../src/services/status-audience');
const statusLog = require('../src/services/status-log');
const tostatus = require('../src/plugins/owner/tostatus');
const pluginLoader = require('../src/core/pluginLoader');

function fakeSocket(extra = {}) {
  const sent = [];
  let nextId = 0;
  const socket = {
    user: { id: '50900000000:7@s.whatsapp.net' },
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      if (jid === 'status@broadcast' && content?.delete) return { key: { id: content.delete.id } };
      if (jid === 'status@broadcast') return { key: { id: `status-${++nextId}` } };
      return { key: { id: `reply-${sent.length}` } };
    },
    ...extra
  };
  return { socket, sent };
}

function ownerContext(socket, overrides = {}) {
  return {
    socket,
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'command-1' },
      message: { conversation: '.tostatus Bonjour' }
    },
    from: '50911111111@s.whatsapp.net',
    sender: '50911111111@s.whatsapp.net',
    sessionNumber: '50900000000',
    sessionCfg: { STATUS_VIEWERS: ['50922222222'] },
    args: ['Bonjour'],
    prefix: '.',
    command: 'tostatus',
    isOwner: true,
    isSessionOwner: false,
    isSudo: false,
    ...overrides
  };
}

function resetLog() {
  statusLog.clear();
}

test('normalise les destinataires PN/LID, retire les suffixes device et déduplique', async () => {
  const { socket } = fakeSocket({
    store: {
      contacts: {
        a: { id: '50911111111:4@s.whatsapp.net' },
        b: { phoneNumber: '50911111111@s.whatsapp.net' },
        c: { phoneNumber: '50933333333@s.whatsapp.net' },
        d: { id: '123456789012345@lid' }
      }
    }
  });

  const list = await audience.getStatusJidList(socket, []);
  assert.deepEqual(list.sort(), [
    '123456789012345@lid',
    '50900000000@s.whatsapp.net',
    '50911111111@s.whatsapp.net',
    '50933333333@s.whatsapp.net'
  ].sort());
});

test('public personnalisé prioritaire; fallback aux membres de groupe si aucun contact connu', async () => {
  let groupFetches = 0;
  const { socket } = fakeSocket({
    store: { contacts: { self: { id: '50900000000:7@s.whatsapp.net' } } },
    async groupFetchAllParticipating() {
      groupFetches += 1;
      return new Map([['1@g.us', {
        participants: [
          { id: '50911111111@s.whatsapp.net' },
          { id: '50922222222:2@s.whatsapp.net' }
        ]
      }]]);
    }
  });

  const fallback = await audience.getStatusJidList(socket, []);
  assert.equal(groupFetches, 1);
  assert.deepEqual(fallback.sort(), [
    '50900000000@s.whatsapp.net',
    '50911111111@s.whatsapp.net',
    '50922222222@s.whatsapp.net'
  ].sort());

  const custom = await audience.getStatusJidList(socket, ['50999999999']);
  assert.equal(groupFetches, 1, 'une audience personnalisée ne doit pas élargir au groupe');
  assert.deepEqual(custom.sort(), ['50900000000@s.whatsapp.net', '50999999999@s.whatsapp.net'].sort());
});

test('valide et déduplique la liste de numéros configurés', () => {
  assert.deepEqual(audience.parseStatusViewerNumbers(' +50911111111, 50922222222 50911111111 '), {
    numbers: ['50911111111', '50922222222'],
    invalid: []
  });
  assert.deepEqual(audience.parseStatusViewerNumbers('12 nope'), {
    numbers: [],
    invalid: ['12', 'nope']
  });
});

test('publie un statut texte avec statusJidList, option de fond et journal de suppression', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  const context = ownerContext(socket);
  await tostatus._test.executeToStatus(context);

  const statusSend = sent.find(event => event.jid === 'status@broadcast');
  assert.ok(statusSend);
  assert.deepEqual(statusSend.content, { text: 'Bonjour' });
  assert.deepEqual(statusSend.options.statusJidList.sort(), [
    '50900000000@s.whatsapp.net',
    '50922222222@s.whatsapp.net'
  ].sort());
  assert.equal(statusSend.options.backgroundColor, '#000000');
  assert.equal(statusSend.options.font, 0);
  assert.equal(statusLog.getLatest('50900000000').key.id, 'status-1');
  assert.match(sent.at(-1).content.text, /Statut 📝 Texte publié/);
  assert.match(sent.at(-1).content.text, /\.delstatus/);
});

test('ne publie pas un statut adressé uniquement au propre compte du bot', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  await tostatus._test.executeToStatus(ownerContext(socket, {
    sessionCfg: { STATUS_VIEWERS: [] },
    args: ['invisible']
  }));
  assert.equal(sent.some(event => event.jid === 'status@broadcast'), false);
  assert.match(sent.at(-1).content.text, /Aucun autre destinataire/);
  assert.match(sent.at(-1).content.text, /\.setstatusviewers/);
});

test('publie une image citée en utilisant le downloader NYXCORE injecté', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  const context = ownerContext(socket, {
    args: [],
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'reply-image' },
      message: {
        extendedTextMessage: {
          text: '.tostatus',
          contextInfo: {
            quotedMessage: {
              viewOnceMessageV2: {
                message: { imageMessage: { mimetype: 'image/png', caption: 'photo citée', media: true } }
              }
            }
          }
        }
      }
    },
    quotedMsg: {
      viewOnceMessageV2: {
        message: { imageMessage: { mimetype: 'image/png', caption: 'photo citée', media: true } }
      }
    }
  });
  await tostatus._test.executeToStatus(context, {
    async *downloadContentFromMessage(media, type) {
      assert.equal(type, 'image');
      assert.equal(media.caption, 'photo citée');
      yield Buffer.from('png-binary');
    }
  });

  const statusSend = sent.find(event => event.jid === 'status@broadcast');
  assert.equal(statusSend.content.image.toString(), 'png-binary');
  assert.equal(statusSend.content.mimetype, 'image/png');
  assert.equal(statusSend.content.caption, 'photo citée');
});

test('conserve une vidéo citée et retire la commande d’une caption de média propre', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  const video = { mimetype: 'video/mp4', caption: 'légende vidéo' };
  await tostatus._test.executeToStatus(ownerContext(socket, {
    args: [],
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'reply-video' },
      message: {
        extendedTextMessage: {
          text: '.tostatus',
          contextInfo: { quotedMessage: { videoMessage: video } }
        }
      },
    },
    quotedMsg: { videoMessage: video }
  }), {
    async *downloadContentFromMessage(media, type) {
      assert.equal(media, video);
      assert.equal(type, 'video');
      yield Buffer.from('video-binary');
    }
  });

  const statusSend = sent.find(event => event.jid === 'status@broadcast');
  assert.equal(statusSend.content.video.toString(), 'video-binary');
  assert.equal(statusSend.content.mimetype, 'video/mp4');
  assert.equal(statusSend.content.caption, 'légende vidéo');
  assert.equal(tostatus._test.mediaCaption({ caption: '.tostatus Description' }, true, '', '.', 'tostatus'), 'Description');
  assert.equal(tostatus._test.commandCaptionText('!to+status Texte', '!', 'to+status'), 'Texte');
});

test('audio de statut devient vidéo mp4 stylisée et utilise le visuel Toumaï', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  const audio = { mimetype: 'audio/ogg', ptt: true, seconds: 180, caption: 'mon audio' };
  const context = ownerContext(socket, {
    args: [],
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'reply-audio' },
      message: {
        extendedTextMessage: {
          text: '.tostatus',
          contextInfo: { quotedMessage: { audioMessage: audio } }
        }
      }
    },
    quotedMsg: { audioMessage: audio }
  });
  let converterOptions;
  await tostatus._test.executeToStatus(context, {
    async *downloadContentFromMessage(media, type) {
      assert.equal(media, audio);
      assert.equal(type, 'audio');
      yield Buffer.from('audio-binary');
    },
    async audioToStatusVideo(buffer, options) {
      assert.equal(buffer.toString(), 'audio-binary');
      converterOptions = options;
      return Buffer.from('stylized-video');
    }
  });

  const statusSend = sent.find(event => event.jid === 'status@broadcast');
  assert.equal(statusSend.content.video.toString(), 'stylized-video');
  assert.equal(statusSend.content.mimetype, 'video/mp4');
  assert.equal(statusSend.content.caption, 'mon audio');
  assert.equal(converterOptions.durationSeconds, 180);
  assert.equal(converterOptions.branding.title, 'LE SEIGNEUR DES APPAREILS');
  assert.equal(converterOptions.branding.subtitle, 'PÈRE FONDATEUR DE TOUMAÏ MD');
  assert.equal(converterOptions.design.cyan, '0x25D366');
  assert.equal(converterOptions.design.background, '0x0B1020');
});

test('refuse un non-propriétaire et persiste/remplace l’audience par session', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  await tostatus._test.executeToStatus(ownerContext(socket, {
    isOwner: false,
    isSessionOwner: false,
    args: ['non autorisé']
  }));
  assert.equal(sent.some(event => event.jid === 'status@broadcast'), false);
  assert.match(sent.at(-1).content.text, /propriétaire/i);

  const writes = [];
  await tostatus._test.executeToStatus(ownerContext(socket, {
    command: 'setstatusviewers',
    args: ['+50933333333,', '50944444444'],
    setUserConfigInMongo: async (session, config) => {
      writes.push({ session, config });
      return true;
    }
  }));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].session, '50900000000');
  assert.deepEqual(writes[0].config.STATUS_VIEWERS, ['50933333333', '50944444444']);
  assert.deepEqual(writes[0].config.MODE, undefined);
  assert.match(sent.at(-1).content.text, /2 contact/);
});

test('protège la liste des destinataires et répond en privé si la commande vient d’un groupe', async () => {
  resetLog();
  const { socket, sent } = fakeSocket();
  const ownerJid = '50911111111@s.whatsapp.net';
  const context = ownerContext(socket, {
    command: 'statusviewers',
    args: [],
    from: '120363123456789@g.us',
    msg: {
      key: {
        remoteJid: '120363123456789@g.us',
        participant: ownerJid,
        participantAlt: ownerJid,
        fromMe: false,
        id: 'group-command'
      },
      message: { conversation: '.statusviewers' }
    }
  });

  await tostatus._test.executeToStatus(context);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, ownerJid);
  assert.match(sent[0].content.text, /50922222222/);
  assert.equal(sent[0].options, undefined, 'ne cite pas un message de groupe dans la réponse privée');
  assert.equal(tostatus._test.replyJid(context.from, context.msg), ownerJid);
});

test('pluginLoader enregistre les commandes de statut et de mise à jour avec leurs alias', () => {
  pluginLoader.loadPlugins(false);
  const expectedNames = {
    tostatus: 'tostatus',
    setstatusviewers: 'tostatus',
    statusviewers: 'tostatus',
    delstatus: 'tostatus',
    update: 'update',
    updatebot: 'update'
  };
  for (const [command, name] of Object.entries(expectedNames)) {
    const plugin = pluginLoader.getPlugins().get(command);
    assert.ok(plugin, `${command} non enregistré`);
    assert.equal(plugin.name, name);
    assert.equal(plugin.category, 'owner');
    assert.equal(typeof plugin.execute, 'function');
  }
});

test('.delstatus révoque le dernier statut avec la même statusJidList', async () => {
  resetLog();
  statusLog.add('50900000000', {
    key: { remoteJid: 'status@broadcast', fromMe: true, id: 'old-status' },
    statusJidList: ['50911111111@s.whatsapp.net'],
    label: '🎬 Vidéo'
  });
  const { socket, sent } = fakeSocket();
  await tostatus._test.executeToStatus(ownerContext(socket, {
    command: 'delstatus',
    args: []
  }));

  const revoke = sent.find(event => event.jid === 'status@broadcast' && event.content.delete);
  assert.deepEqual(revoke.content.delete, {
    remoteJid: 'status@broadcast',
    fromMe: true,
    id: 'old-status'
  });
  assert.deepEqual(revoke.options.statusJidList, ['50911111111@s.whatsapp.net']);
  assert.equal(statusLog.getLatest('50900000000'), null);
  assert.match(sent.at(-1).content.text, /Dernier statut supprimé/);
});
