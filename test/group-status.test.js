'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const selector = require('../src/services/group-status-selector');
const {
  unwrapMessage,
  buildGroupStatusPayload,
  DEFAULT_TEXT_STATUS_FONT,
  STATUS_BACKGROUND_PALETTE,
  parseStatusColor,
  splitTextAndColor
} = require('../src/services/group-status-content');
const audioStatus = require('../src/services/group-status-audio');
const swgc = require('../src/plugins/group/swgc');
const { groupStatus, isGroupJid } = require('../src/handlers/status');

function resetSelections() {
  selector._test.pendingSelections.clear();
  selector._test.selectedGroups.clear();
}

function privateFixture() {
  const sent = [];
  const groups = {
    '222@g.us': {
      id: '222@g.us',
      subject: 'Zèbres',
      participants: [{ id: '50911111111@s.whatsapp.net' }, { id: '5092@s.whatsapp.net' }]
    },
    '111@g.us': {
      id: '111@g.us',
      subject: 'Amis',
      participants: [{ id: '50911111111@s.whatsapp.net' }]
    },
    '333@g.us': {
      id: '333@g.us',
      subject: 'Autres',
      participants: [{ id: '50999999999@s.whatsapp.net' }]
    }
  };
  const socket = {
    user: { id: '50900000000:1@s.whatsapp.net' },
    async groupFetchAllParticipating() { return groups; },
    async groupMetadata(jid) { return groups[jid]; },
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: String(sent.length) } };
    }
  };
  return {
    sent,
    socket,
    context: {
      socket,
      msg: { key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false }, message: {} },
      from: '50911111111@s.whatsapp.net',
      sender: '50911111111@s.whatsapp.net',
      senderNumber: '50911111111',
      sessionNumber: '50900000000',
      args: [],
      prefix: '.',
      isOwner: true,
      isSessionOwner: false,
      isSudo: false,
      quotedMsg: null
    }
  };
}

test('liste seulement les groupes dont l’utilisateur fait partie et les trie', async () => {
  const fixture = privateFixture();
  const groups = await selector.listUserGroups(fixture.socket, ['50911111111@s.whatsapp.net']);
  assert.deepEqual(groups.map(group => group.subject), ['Amis', 'Zèbres']);
  assert.deepEqual(groups.map(group => group.jid), ['111@g.us', '222@g.us']);
  const list = selector.renderGroupSelectionList(groups, '.');
  assert.match(list, /1\. Amis/);
  assert.match(list, /2\. Zèbres/);
  assert.match(list, /Réponds simplement avec le numéro/);
  assert.match(list, /MUGIWARA NO PLAG/);
  assert.match(list, /gcstatus/);
});

test('reconnaît les identités PN/LID et leurs champs alternatifs', () => {
  const phoneTokens = selector.identityTokens(['50911111111@s.whatsapp.net']);
  assert.equal(selector.participantMatches({
    id: '100000000000001@lid',
    phoneNumber: '50911111111@s.whatsapp.net'
  }, phoneTokens), true);

  const lidTokens = selector.identityTokens(['100000000000001@lid']);
  assert.equal(selector.participantMatches({
    id: '50911111111@s.whatsapp.net',
    lid: '100000000000001@lid'
  }, lidTokens), true);
});

test('résout un numéro uniquement pour la bonne session et le bon utilisateur', () => {
  resetSelections();
  const groups = [
    { jid: '111@g.us', subject: 'Un' },
    { jid: '222@g.us', subject: 'Deux' }
  ];
  selector.beginGroupSelection('session-5091', 'user-a', groups, 1000);

  assert.equal(selector.resolveGroupSelection('5092', 'user-a', '1', { now: 1001 }).status, 'none');
  assert.equal(selector.resolveGroupSelection('5091', 'user-b', '1', { now: 1001 }).status, 'none');
  assert.equal(selector.resolveGroupSelection('5091', 'user-a', '9', { now: 1001 }).status, 'invalid');
  const selected = selector.resolveGroupSelection('5091', 'user-a', '2', { now: 1001 });
  assert.equal(selected.status, 'selected');
  assert.equal(selected.group.jid, '222@g.us');
  assert.equal(selector.getSelectedGroup('5091', 'user-a').subject, 'Deux');
});

test('expire proprement une sélection qui attend trop longtemps', () => {
  resetSelections();
  selector.beginGroupSelection('5091', 'user', [{ jid: '111@g.us', subject: 'Un' }], 1000);
  const result = selector.resolveGroupSelection('5091', 'user', '1', { now: 7001, ttlMs: 5000 });
  assert.equal(result.status, 'expired');
  assert.equal(selector.getSelectedGroup('5091', 'user'), null);
});

test('les textes utilisent la nouvelle police et la palette sombre personnalisée', async () => {
  assert.equal(DEFAULT_TEXT_STATUS_FONT, 2);
  assert.ok(STATUS_BACKGROUND_PALETTE.length >= 5);
  assert.equal(parseStatusColor('VIOLET'), '#5537A8');
  assert.equal(parseStatusColor('nuit'), '#12002B');
  assert.equal(parseStatusColor('bleu nuit'), '#14213D');
  assert.equal(parseStatusColor('or'), '#8A6416');
  assert.equal(parseStatusColor('doré'), '#8A6416');
  assert.equal(parseStatusColor('#ff8800'), '#FF8800');
  assert.equal(parseStatusColor('constructor'), null);
  assert.equal(parseStatusColor('couleur inconnue'), null);
  assert.deepEqual(splitTextAndColor('Salut tout le monde, violet'), {
    text: 'Salut tout le monde',
    color: '#5537A8',
    colorName: 'violet'
  });
  assert.deepEqual(splitTextAndColor('Bonjour, avec une virgule'), {
    text: 'Bonjour, avec une virgule',
    color: null,
    colorName: ''
  });

  const text = await buildGroupStatusPayload({ textInput: 'Bonjour propre, violet', random: () => 0 });
  assert.deepEqual(text.payload, { text: 'Bonjour propre', backgroundColor: '#5537A8', font: 2 });
  const defaultText = await buildGroupStatusPayload({ textInput: 'Bonjour propre', random: () => 0 });
  assert.equal(defaultText.payload.backgroundColor, STATUS_BACKGROUND_PALETTE[0]);
  assert.equal(defaultText.payload.font, 2);
});

test('construit les statuts image/vidéo et transforme les audios en vidéo de marque', async () => {
  const downloadContent = async function * download(media) {
    yield Buffer.from(media.bytes);
  };
  const image = await buildGroupStatusPayload({
    quotedMessage: { viewOnceMessage: { message: { imageMessage: { bytes: 'img', caption: 'originale' } } } },
    textInput: 'nouvelle légende',
    downloadContent
  });
  assert.equal(image.type, 'image');
  assert.equal(image.payload.image.toString(), 'img');
  assert.equal(image.payload.caption, 'originale');
  assert.equal(image.payload.mimetype, 'image/jpeg');

  const imageWithoutCaption = await buildGroupStatusPayload({
    quotedMessage: { imageMessage: { bytes: 'img2', mimetype: 'image/png' } },
    textInput: 'légende de commande',
    downloadContent
  });
  assert.equal(imageWithoutCaption.payload.caption, 'légende de commande');
  assert.equal(imageWithoutCaption.payload.mimetype, 'image/png');

  const video = await buildGroupStatusPayload({
    quotedMessage: { videoMessage: { bytes: 'vid', mimetype: 'video/mp4', caption: 'vidéo' } },
    downloadContent
  });
  assert.equal(video.payload.video.toString(), 'vid');
  assert.equal(video.payload.caption, 'vidéo');

  let conversionOptions;
  const audio = await buildGroupStatusPayload({
    quotedMessage: { audioMessage: { bytes: 'aud', mimetype: 'audio/ogg', ptt: true, seconds: 41, caption: 'note audio' } },
    downloadContent,
    audioToStatusVideo: async (buffer, options) => {
      assert.equal(buffer.toString(), 'aud');
      conversionOptions = options;
      return Buffer.from('mp4-video');
    }
  });
  assert.equal(audio.type, 'audio');
  assert.equal(audio.payload.video.toString(), 'mp4-video');
  assert.equal(audio.payload.mimetype, 'video/mp4');
  assert.equal(audio.payload.caption, 'note audio');
  assert.deepEqual(conversionOptions, { durationSeconds: 41 });
  assert.equal(unwrapMessage({ ephemeralMessage: { message: { conversation: 'ok' } } }).conversation, 'ok');
});

test('la carte audio est animée, brandée et utilise Poppins SemiBold', () => {
  const paths = {
    title: '/tmp/title.txt',
    subtitle: '/tmp/subtitle.txt',
    tags: '/tmp/tags.txt',
    current: '/tmp/current.txt',
    total: '/tmp/total.txt'
  };
  const graph = audioStatus.buildAudioStatusFilterGraph({
    fontPath: '/app/assets/fonts/Poppins-SemiBold.ttf',
    textPaths: paths,
    durationSeconds: 65
  });

  assert.equal(audioStatus.BRANDING.title, 'MUGIWARA NO PLAG');
  assert.equal(audioStatus.BRANDING.subtitle, 'DEVELOPER DE KAIDO MD');
  assert.match(graph, /showwaves=s=640x300/);
  assert.match(graph, /drawtext=fontfile=\/app\/assets\/fonts\/Poppins-SemiBold\.ttf/);
  assert.match(graph, /0x0B0D19/);
  assert.match(graph, /alpha='min\(1,max\(0,/);
  assert.match(graph, /600\*t\/65\.00/);
  assert.ok(fs.existsSync(audioStatus.FONT_CANDIDATES[0]));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'fonts', 'OFL-Poppins.txt')));
  assert.equal(audioStatus.formatTime(65), '01:05');
  assert.equal(audioStatus.formatTime(3665), '1:01:05');
});

test('NYXCORE construit image, vidéo, audio et texte, puis le socket actif les relaie en statut de groupe', async () => {
  const { proto } = require('@whiskeysockets/baileys');
  const uploads = [];
  const relayed = [];
  const socket = {
    user: { id: '50900000000@s.whatsapp.net' },
    async waUploadToServer(encryptedFilePath, metadata) {
      // Contrat du Baileys officiel : `options.upload` reçoit le chemin du
      // fichier chiffré temporaire, qu'il supprime après le téléversement.
      assert.equal(typeof encryptedFilePath, 'string');
      assert.ok(fs.existsSync(encryptedFilePath), 'fichier chiffré temporaire absent');
      uploads.push(metadata.mediaType);
      return {
        mediaUrl: `https://upload.invalid/${metadata.mediaType}`,
        directPath: `/group-status/${metadata.mediaType}`
      };
    },
    async relayMessage(jid, message, options) {
      relayed.push({ jid, message, options });
    }
  };
  const samples = [
    ['image', {
      image: Buffer.from('image-binaire'),
      mimetype: 'image/png',
      caption: 'image originale',
      jpegThumbnail: Buffer.alloc(0)
    }],
    ['video', {
      video: Buffer.from('video-binaire'),
      mimetype: 'video/mp4',
      caption: 'vidéo originale',
      jpegThumbnail: Buffer.alloc(0),
      seconds: 1
    }],
    ['audio', {
      audio: Buffer.from('audio-binaire'),
      mimetype: 'audio/ogg',
      ptt: true,
      seconds: 1,
      waveform: Buffer.alloc(0)
    }],
    ['text', {
      text: 'Bonjour groupe',
      backgroundColor: '#5537A8',
      font: 2
    }]
  ];

  for (const [type, payload] of samples) {
    const result = await groupStatus(socket, '123456@g.us', payload);
    assert.ok(result.key?.id);
    const call = relayed.at(-1);
    const inner = call.message.groupStatusMessageV2?.message;
    const messageType = type === 'text' ? 'extendedTextMessage' : `${type}Message`;
    const media = inner?.[messageType];
    const decoded = proto.Message.decode(proto.Message.encode(call.message).finish());

    assert.ok(decoded.groupStatusMessageV2?.message?.[messageType], `${type} incompatible avec le schéma Baileys du socket`);
    assert.equal(decoded.messageContextInfo?.messageSecret?.length, 32);
    assert.equal(call.jid, '123456@g.us');
    assert.ok(media, `${messageType} absent de groupStatusMessageV2`);
    assert.equal(media.contextInfo?.isGroupStatus, true);
    assert.ok(call.message.messageContextInfo?.messageSecret);
    assert.equal(call.message.messageContextInfo.messageSecret.length, 32);
    assert.deepEqual(call.options.additionalNodes, [{
      tag: 'meta',
      attrs: { is_group_status: 'true' },
      content: undefined
    }]);
    if (payload.mimetype) assert.equal(media.mimetype, payload.mimetype);
    if (payload.caption) assert.equal(media.caption, payload.caption);
    if (type === 'text') {
      assert.equal(media.text, payload.text);
      assert.equal(media.font, 2);
      assert.equal(media.backgroundArgb, 0xff5537a8);
    } else {
      assert.ok(media.fileLength, `${type} n’a pas été téléversé`);
    }
  }

  assert.deepEqual(uploads, ['image', 'video', 'audio']);
  assert.equal(relayed.length, 4);
  assert.equal(isGroupJid('123456@g.us'), true);
  assert.equal(isGroupJid('123456@s.whatsapp.net'), false);
  await assert.rejects(groupStatus(socket, '123456@s.whatsapp.net', { text: 'non' }), /JID @g\.us/);
});

test('le Baileys officiel supporte le wrapper V2 et les additionalNodes du relay', () => {
  // `.swgc` dépend de deux capacités vérifiées dans le paquet officiel :
  //   1. relayMessage accepte `additionalNodes` et les ajoute à la stanza ;
  //   2. le schéma officiel contient `groupStatusMessageV2`.
  // Sans elles, le statut part sans le nœud `meta` et n'apparaît pas comme
  // statut de groupe.
  const baileysEntry = require.resolve('@whiskeysockets/baileys');
  const baileysDir = path.dirname(baileysEntry);
  const relaySource = fs.readFileSync(
    path.join(baileysDir, 'Socket', 'messages-send.js'),
    'utf8'
  );
  const messagesSource = fs.readFileSync(
    path.join(baileysDir, 'Utils', 'messages.js'),
    'utf8'
  );

  assert.match(relaySource, /additionalNodes/, 'relayMessage ne déclare plus additionalNodes');
  assert.match(
    relaySource,
    /stanza\.content\.push\(\.\.\.additionalNodes\)/,
    'les additionalNodes ne sont plus injectés dans la stanza'
  );
  assert.match(messagesSource, /groupStatusMessageV2/, 'groupStatusMessageV2 non reconnu');

  const packageJson = require('../package.json');
  const baileysSpec = packageJson.dependencies['@whiskeysockets/baileys'];
  assert.equal(baileysSpec, '7.0.0-rc14');
  assert.equal(
    require('@whiskeysockets/baileys/package.json').name,
    '@whiskeysockets/baileys'
  );
});

test('les confirmations swgc restent concises pour chaque type', () => {
  const labels = { image: 'image', video: 'vidéo', audio: 'audio stylisé en vidéo', text: 'texte' };
  for (const [type, label] of Object.entries(labels)) {
    assert.equal(
      swgc._test.groupStatusConfirmation(type, 'Amis'),
      `Statut ${label} posté sur : Amis`
    );
  }
  assert.ok(swgc.alias.includes('gcstatus'));
});

test('le statut de groupe reste réservé au propriétaire et refuse en privé', async () => {
  resetSelections();
  const fixture = privateFixture();
  const unauthorized = {
    ...fixture.context,
    isOwner: false,
    isSessionOwner: false,
    isSudo: false,
    args: ['publication interdite']
  };
  const published = [];
  await swgc._test.executeSwgc(unauthorized, {
    async publishGroupStatus(_socket, jid, payload) { published.push({ jid, payload }); }
  });

  assert.equal(published.length, 0);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].jid, fixture.context.from);
  assert.match(fixture.sent[0].content.text, /réservée au propriétaire/i);
  assert.equal(fixture.sent.some(event => event.jid.endsWith('@g.us')), false);

  const groupFixture = privateFixture();
  await swgc._test.executeSwgc({
    ...groupFixture.context,
    isOwner: false,
    from: '111@g.us',
    sender: '50911111111@s.whatsapp.net',
    args: ['publication interdite'],
    msg: {
      key: { remoteJid: '111@g.us', participant: '50911111111@s.whatsapp.net' },
      message: {}
    }
  });
  assert.equal(groupFixture.sent.length, 1);
  assert.equal(groupFixture.sent[0].jid, '50911111111@s.whatsapp.net');
  assert.equal(groupFixture.sent.some(event => event.jid.endsWith('@g.us')), false);
});

test('workflow privé: liste, sélectionne puis publie sans sendMessage dans le groupe', async () => {
  resetSelections();
  const fixture = privateFixture();
  await swgc._test.executeSwgc(fixture.context, {});

  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].jid, fixture.context.from);
  assert.match(fixture.sent[0].content.text, /1\. Amis/);
  assert.equal(selector.resolveGroupSelection('50900000000', fixture.context.from, '1').status, 'selected');

  const published = [];
  const publishContext = { ...fixture.context, args: ['Salut', 'le', 'groupe'] };
  await swgc._test.executeSwgc(publishContext, {
    downloadContent: async function * empty() {},
    async publishGroupStatus(socket, jid, payload) { published.push({ socket, jid, payload }); }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].jid, '111@g.us');
  assert.equal(published[0].payload.text, 'Salut le groupe');
  assert.equal(fixture.sent.filter(event => event.jid.endsWith('@g.us')).length, 0);
  assert.equal(fixture.sent.at(-1).jid, fixture.context.from);
  assert.equal(fixture.sent.at(-1).content.text, 'Statut texte posté sur : Amis');
});

test('même depuis un groupe, swgc ne répond jamais dans la conversation du groupe', async () => {
  resetSelections();
  const fixture = privateFixture();
  const published = [];
  const context = {
    ...fixture.context,
    from: '111@g.us',
    sender: '50911111111@s.whatsapp.net',
    args: ['Statut', 'direct'],
    msg: { key: { remoteJid: '111@g.us', participant: '50911111111@s.whatsapp.net' }, message: {} }
  };
  await swgc._test.executeSwgc(context, {
    downloadContent: async function * empty() {},
    async publishGroupStatus(socket, jid, payload) { published.push({ jid, payload }); }
  });
  assert.equal(published[0].jid, '111@g.us');
  assert.equal(fixture.sent.some(event => event.jid === '111@g.us'), false);
  assert.equal(fixture.sent.at(-1).jid, '50911111111@s.whatsapp.net');
});

test('le handler intercepte la réponse numérique et l’ancien case swgc bruyant a disparu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  assert.match(source, /resolveGroupSelection\(sessionId, selectionActor, normalizedBody\)/);
  assert.doesNotMatch(source, /case 'swgc':/);
  const pluginSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'plugins', 'group', 'swgc.js'), 'utf8');
  assert.doesNotMatch(pluginSource, /sendMessage\(target\.jid|sendMessage\(from/);
  const statusSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'status.js'), 'utf8');
  assert.match(statusSource, /groupStatusMessageV2/);
  assert.match(statusSource, /isGroupStatus:\s*true/);
  assert.match(statusSource, /is_group_status:\s*["']true["']/);
  assert.match(statusSource, /socket\.relayMessage\(jid/);
  assert.doesNotMatch(statusSource, /socket\.sendMessage\(jid/);
});

test('NYXCORE construit le statut et le socket Baileys du projet nettoie le média temporaire après téléversement', async () => {
  const uploadedPaths = [];
  const relayed = [];
  const socket = {
    user: { id: '50900000000@s.whatsapp.net' },
    async waUploadToServer(filePath, metadata) {
      assert.equal(typeof filePath, 'string');
      assert.ok(fs.existsSync(filePath), 'fichier chiffré absent pendant le téléversement');
      assert.ok(fs.statSync(filePath).size > 0, 'fichier chiffré vide');
      assert.equal(metadata.mediaType, 'image');
      uploadedPaths.push(filePath);
      return {
        mediaUrl: 'https://upload.invalid/image',
        directPath: '/group-status/image'
      };
    },
    async relayMessage(jid, message, options) {
      relayed.push({ jid, message, options });
    }
  };

  await groupStatus(socket, '123456@g.us', {
    image: Buffer.from('image-binaire'),
    mimetype: 'image/png',
    jpegThumbnail: Buffer.alloc(0)
  });

  assert.equal(uploadedPaths.length, 1);
  assert.equal(fs.existsSync(uploadedPaths[0]), false, 'fichier temporaire non supprimé');
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].jid, '123456@g.us');
  assert.ok(relayed[0].message.groupStatusMessageV2?.message?.imageMessage, 'imageMessage absent');
});

test('le plugin utilise les helpers NYXCORE et le socket Baileys de la session', () => {
  const pluginSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'plugins', 'group', 'swgc.js'), 'utf8');
  const statusSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'status.js'), 'utf8');
  const packageJson = require('../package.json');

  assert.match(pluginSource, /import\('@nyxcore\/nyxcoresocket'\)/);
  assert.match(pluginSource, /installGroupStatusMethod\(socket\)/);
  assert.match(pluginSource, /socket\.sendGroupStatus/);
  assert.match(statusSource, /import\('@nyxcore\/nyxcoresocket'\)/);
  assert.match(statusSource, /generateWAMessage\(/);
  assert.match(statusSource, /socket\.waUploadToServer\.bind\(socket\)/);
  assert.match(statusSource, /socket\.relayMessage\(jid/);
  assert.match(statusSource, /groupStatusMessageV2/);
  assert.equal(packageJson.dependencies['@nyxcore/nyxcoresocket'], '^0.3.2');
  assert.equal(packageJson.dependencies['@whiskeysockets/baileys'], '7.0.0-rc14');
  assert.equal(packageJson.dependencies.wileys, undefined);
});

test('le socket du projet reçoit sendGroupStatus comme adaptateur NYXCORE', async () => {
  const relayed = [];
  const socket = {
    user: { id: '50900000000@s.whatsapp.net' },
    async relayMessage(jid, message, options) {
      relayed.push({ jid, message, options });
    }
  };
  const { installGroupStatusMethod } = require('../src/handlers/status');
  const sendGroupStatus = installGroupStatusMethod(socket);

  assert.equal(typeof socket.sendGroupStatus, 'function');
  assert.equal(sendGroupStatus, socket.sendGroupStatus);
  await socket.sendGroupStatus('123456@g.us', { text: 'NYXCORE sur socket existant' });
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].jid, '123456@g.us');
  assert.equal(
    relayed[0].message.groupStatusMessageV2.message.extendedTextMessage.text,
    'NYXCORE sur socket existant'
  );
});
