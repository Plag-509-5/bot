'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
const stylePlugin = require('../src/plugins/group/style');
const pluginLoader = require('../src/core/pluginLoader');
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
  const styleList = selector.renderGroupSelectionList(groups, '.', 'style');
  assert.match(styleList, /réponds à un audio avec \.style/);
  assert.doesNotMatch(styleList, /Couleurs/);
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

test('les commandes publiques de statut de groupe ne le sont que dans un groupe', () => {
  for (const command of ['swgc', 'gcstatus', 'groupstatus', 'statusgroup', 'style']) {
    assert.equal(selector.isPublicGroupStatusCommand('111@g.us', command), true);
  }
  assert.equal(selector.isPublicGroupStatusCommand('50911111111@s.whatsapp.net', 'swgc'), false);
  assert.equal(selector.isPublicGroupStatusCommand('111@g.us', 'tostatus'), false);
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

test('construit les statuts image/vidéo et garde le chemin audio stylisé en vidéo de marque', async () => {
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
  assert.equal(audio.type, 'styledAudio');
  assert.equal(audio.payload.video.toString(), 'mp4-video');
  assert.equal(audio.payload.mimetype, 'video/mp4');
  assert.equal(audio.payload.caption, 'note audio');
  assert.deepEqual(conversionOptions, { durationSeconds: 41 });

  const rawAudio = await buildGroupStatusPayload({
    quotedMessage: { audioMessage: { bytes: 'raw-audio', mimetype: 'audio/ogg', caption: 'caption originale' } },
    textInput: 'texte ajouté, violet',
    audioMode: 'raw',
    downloadContent,
    random: () => 0,
    audioToStatusVideo: async () => { throw new Error('le mode brut ne doit pas convertir en vidéo'); }
  });
  assert.equal(rawAudio.type, 'audio');
  assert.equal(rawAudio.payload.audio.toString(), 'raw-audio');
  assert.equal(rawAudio.payload.video, undefined);
  assert.equal(rawAudio.payload.mimetype, 'audio/ogg');
  assert.equal(rawAudio.payload.backgroundColor, '#5537A8');
  assert.equal(rawAudio.caption, 'caption originale');
  assert.equal(rawAudio.originalCaption, 'caption originale');
  assert.equal(rawAudio.textInput, 'texte ajouté');
  const randomColorAudio = await buildGroupStatusPayload({
    quotedMessage: { audioMessage: { bytes: 'raw-audio', mimetype: 'audio/mp4' } },
    audioMode: 'raw',
    downloadContent,
    random: () => 0.5
  });
  assert.equal(randomColorAudio.payload.backgroundColor, Math.floor(0.5 * 0xFFFFFF));
  assert.equal(unwrapMessage({ ephemeralMessage: { message: { conversation: 'ok' } } }).conversation, 'ok');
});

test('le chemin audio par défaut diffuse le MP4 temporaire et expose son nettoyage après publication', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kaido-group-status-file-test-'));
  const videoPath = path.join(tempDir, 'converted.mp4');
  let cleanupCalls = 0;
  try {
    const built = await buildGroupStatusPayload({
      quotedMessage: { audioMessage: { bytes: 'audio-source', mimetype: 'audio/ogg', seconds: 205, caption: 'long audio' } },
      downloadContent: async function * download() { yield Buffer.from('audio-source'); },
      audioToStatusVideoFile: async (source, options) => {
        assert.deepEqual(options, { durationSeconds: 205 });
        const chunks = [];
        for await (const chunk of source) chunks.push(Buffer.from(chunk));
        assert.equal(Buffer.concat(chunks).toString(), 'audio-source');
        await fs.promises.writeFile(videoPath, 'large-enough-mp4');
        return {
          path: videoPath,
          async cleanup() {
            cleanupCalls += 1;
            await fs.promises.rm(tempDir, { recursive: true, force: true });
          }
        };
      }
    });

    assert.equal(built.type, 'styledAudio');
    assert.ok(built.payload.video.stream, 'la vidéo doit rester en flux, pas en buffer');
    assert.equal((await fs.promises.readFile(videoPath)).toString(), 'large-enough-mp4');
    const uploadedChunks = [];
    for await (const chunk of built.payload.video.stream) uploadedChunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(uploadedChunks).toString(), 'large-enough-mp4');
    await built.cleanup();
    assert.equal(cleanupCalls, 1);
    await assert.rejects(fs.promises.access(videoPath));
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});

test('les fichiers audio temporaires vont sur le volume configurable, pas dans /tmp par défaut', () => {
  assert.equal(
    audioStatus.getAudioStatusTempRoot({}),
    path.resolve(__dirname, '..', 'tmp', 'audio-status')
  );
  assert.equal(
    audioStatus.getAudioStatusTempRoot({ AUDIO_STATUS_TEMP_DIR: '/data/kaido/audio-work' }),
    path.resolve('/data/kaido/audio-work')
  );
});

test('une erreur ENOSPC indique le dossier persistant sans renvoyer la commande FFmpeg complète', () => {
  const error = audioStatus._test.formatFfmpegError({
    stderr: 'av_interleaved_write_frame(): No space left on device',
    message: `Command failed: ffmpeg ${'filter-graph '.repeat(1000)}`
  }, '/data/kaido/audio-work');
  assert.match(error.message, /Espace disque insuffisant sur \/data\/kaido\/audio-work/);
  assert.match(error.message, /AUDIO_STATUS_TEMP_DIR/);
  assert.doesNotMatch(error.message, /Command failed|filter-graph/);
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

  assert.equal(audioStatus.BRANDING.title, 'Kaido-MD');
  assert.equal(audioStatus.BRANDING.subtitle, 'Développeur : PlagTech');
  assert.equal(audioStatus.BRANDING.tags, 'À LA GLOIRE DE KAIDO');
  assert.match(graph, /showwaves=s=520x260/);
  assert.match(graph, /\[1:v\]scale=720:1280/);
  assert.match(graph, /drawtext=fontfile=\/app\/assets\/fonts\/Poppins-SemiBold\.ttf/);
  assert.match(graph, /0x080A12/);
  assert.match(graph, /alpha='min\(1,max\(0,/);
  assert.match(graph, /520\*t\/65\.00/);
  assert.match(graph, /colors=0x72DDF7/, 'le cadre Kaido utilise la même palette pour les statuts personnels et de groupe');
  assert.equal(audioStatus.DESIGN.fps, 15);
  assert.ok(fs.existsSync(audioStatus.KAIDO_FRAME_PATH));
  assert.ok(fs.existsSync(audioStatus.FONT_CANDIDATES[0]));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'fonts', 'OFL-Poppins.txt')));
  assert.equal(audioStatus.formatTime(65), '01:05');
  assert.equal(audioStatus.formatTime(3665), '1:01:05');
});

test('les conversions audio restent séquentielles et la file a une limite', async () => {
  const queue = audioStatus._test.createAudioJobQueue({
    maxConcurrent: 1,
    maxQueued: 2,
    busyMessage: 'queue pleine'
  });
  const started = [];
  let startFirst;
  let startSecond;
  let finishFirst;
  let finishSecond;
  const firstStarted = new Promise(resolve => { startFirst = resolve; });
  const secondStarted = new Promise(resolve => { startSecond = resolve; });
  const first = queue.run(() => {
    started.push('first');
    startFirst();
    return new Promise(resolve => { finishFirst = resolve; });
  });
  const second = queue.run(() => {
    started.push('second');
    startSecond();
    return new Promise(resolve => { finishSecond = resolve; });
  });
  const third = queue.run(() => {
    started.push('third');
    return 'third-result';
  });

  assert.deepEqual(queue.stats(), { active: 1, waiting: 2, maxConcurrent: 1, maxQueued: 2 });
  await assert.rejects(queue.run(() => 'overflow'), /queue pleine/);
  await firstStarted;
  assert.deepEqual(started, ['first']);

  finishFirst('first-result');
  assert.equal(await first, 'first-result');
  await secondStarted;
  assert.deepEqual(started, ['first', 'second']);
  finishSecond('second-result');
  assert.equal(await second, 'second-result');
  assert.equal(await third, 'third-result');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['first', 'second', 'third']);
  assert.deepEqual(queue.stats(), { active: 0, waiting: 0, maxConcurrent: 1, maxQueued: 2 });
});

test('écrit l’audio source en flux et arrête la lecture dès que la limite d’octets est dépassée', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kaido-audio-stream-test-'));
  const sourcePath = path.join(tempDir, 'source-audio');
  try {
    async function* normalChunks() {
      yield Buffer.from('audio-');
      yield Buffer.from('stream');
    }
    const written = await audioStatus.writeAudioSourceToFile(normalChunks(), sourcePath, 64);
    assert.equal(written, 12);
    assert.equal((await fs.promises.readFile(sourcePath)).toString(), 'audio-stream');

    let yielded = 0;
    async function* oversizedChunks() {
      yielded += 1;
      yield Buffer.from('12345678');
      yielded += 1;
      yield Buffer.from('abcdefgh');
      yielded += 1;
      yield Buffer.from('must-not-be-read');
    }
    await assert.rejects(
      audioStatus.writeAudioSourceToFile(oversizedChunks(), sourcePath, 10),
      /limite de 10 octets/
    );
    assert.equal(yielded, 2, 'la source ne doit pas être consommée après le dépassement');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
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
    assert.ok(call.message.messageContextInfo?.messageSecret);
    assert.equal(call.message.messageContextInfo.messageSecret.length, 32);
    assert.equal(call.options.messageId, result.key.id);
    assert.equal(call.options.additionalNodes, undefined);
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

test('Baileys classe correctement les médias après déballage du statut de groupe V2', () => {
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
  const receiveSource = fs.readFileSync(
    path.join(baileysDir, 'Socket', 'messages-recv.js'),
    'utf8'
  );
  const { patchRelaySource } = require('../scripts/patch-baileys-group-status-media');

  assert.match(messagesSource, /groupStatusMessageV2/, 'groupStatusMessageV2 non reconnu');
  assert.match(
    relaySource,
    /const getMediaType = \(message\) => \{\s+message = normalizeMessageContent\(message\) \|\| message;/,
    'le relay ne détecte pas le type du média à travers groupStatusMessageV2'
  );
  assert.match(relaySource, /additionalAttributes: \{ \.\.\.\(options\.additionalAttributes \|\| \{\}\), \.\.\.additionalAttributes \}/);
  assert.match(relaySource, /useUserDevicesCache: options\.useUserDevicesCache/);
  assert.match(receiveSource, /server_id: child\.attrs\.server_id \|\| child\.attrs\.message_id/);
  assert.deepEqual(patchRelaySource(relaySource), { source: relaySource, changed: false });

  const packageJson = require('../package.json');
  assert.equal(packageJson.dependencies['@whiskeysockets/baileys'], '7.0.0-rc14');
  assert.equal(packageJson.scripts.postinstall, 'node scripts/patch-baileys-group-status-media.js');
  assert.equal(packageJson.scripts.prestart, 'node scripts/patch-baileys-group-status-media.js');
  assert.equal(
    require('@whiskeysockets/baileys/package.json').name,
    '@whiskeysockets/baileys'
  );
});

test('le postinstall corrige le relay rc14 une seule fois', () => {
  const { patchRelaySource } = require('../scripts/patch-baileys-group-status-media');
  const source = [
    'const getMediaType = (message) => {',
    '        if (message.imageMessage) {',
    "            return 'image';",
    '        }',
    '    };',
    'await relayMessage(jid, fullMsg.message, {',
    '    messageId: fullMsg.key.id,',
    '    additionalAttributes,',
    '    statusJidList: options.statusJidList',
    '});'
  ].join('\n');

  const first = patchRelaySource(source);
  assert.equal(first.changed, true);
  assert.match(first.source, /message = normalizeMessageContent\(message\) \|\| message;/);
  assert.match(first.source, /additionalAttributes: \{ \.\.\.\(options\.additionalAttributes \|\| \{\}\), \.\.\.additionalAttributes \}/);
  assert.match(first.source, /useUserDevicesCache: options\.useUserDevicesCache/);
  const second = patchRelaySource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});

test('le postinstall conserve le server_id des notifications newsletter dans la clé upsert', () => {
  const { patchNewsletterMessageServerId } = require('../scripts/patch-baileys-group-status-media');
  const source = [
    'key: {',
    '    remoteJid: from,',
    '    id: child.attrs.message_id || child.attrs.server_id,',
    '    fromMe: false // TODO: is this really true though'
  ].join('\n');
  const patched = patchNewsletterMessageServerId(source);
  assert.equal(patched.changed, true);
  assert.match(patched.source, /server_id: child\.attrs\.server_id \|\| child\.attrs\.message_id/);
  assert.equal(patchNewsletterMessageServerId(patched.source).changed, false);
});

test('les confirmations swgc restent concises pour chaque type', () => {
  const labels = { image: 'image', video: 'vidéo', audio: 'audio', styledAudio: 'audio stylisé en vidéo', text: 'texte' };
  for (const [type, label] of Object.entries(labels)) {
    assert.equal(
      swgc._test.groupStatusConfirmation(type, 'Amis'),
      `Statut ${label} posté sur : Amis`
    );
  }
  const rawAudioCaption = swgc._test.formatRawAudioStatusCaption('caption d’origine', 'texte ajouté');
  assert.match(rawAudioCaption, /caption d’origine/);
  assert.match(rawAudioCaption, /texte ajouté/);
  assert.match(rawAudioCaption, /Kaido-MD — Développeur : PlagTech/);
  assert.ok(swgc.alias.includes('gcstatus'));
});

test('mode privé réservé au propriétaire; depuis un groupe tous les membres publient et reçoivent la réponse dans le groupe', async () => {
  resetSelections();
  const privateFixtureValue = privateFixture();
  const unauthorized = {
    ...privateFixtureValue.context,
    isOwner: false,
    isSessionOwner: false,
    isSudo: false,
    args: ['publication privée interdite']
  };
  const privatePublications = [];
  await swgc._test.executeSwgc(unauthorized, {
    async publishGroupStatus(_socket, jid, payload) { privatePublications.push({ jid, payload }); }
  });

  assert.equal(privatePublications.length, 0);
  assert.equal(privateFixtureValue.sent.length, 1);
  assert.equal(privateFixtureValue.sent[0].jid, privateFixtureValue.context.from);
  assert.match(privateFixtureValue.sent[0].content.text, /réservée au propriétaire/i);

  const groupFixture = privateFixture();
  const published = [];
  const groupContext = {
    ...groupFixture.context,
    isOwner: false,
    isSessionOwner: false,
    isSudo: false,
    from: '111@g.us',
    sender: '50911111111@s.whatsapp.net',
    args: ['publication publique'],
    msg: {
      key: { remoteJid: '111@g.us', participant: '50911111111@s.whatsapp.net' },
      message: {}
    }
  };
  await swgc._test.executeSwgc(groupContext, {
    async publishGroupStatus(socket, jid, payload) { published.push({ socket, jid, payload }); }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].jid, '111@g.us');
  assert.equal(published[0].payload.text, 'publication publique');
  assert.equal(groupFixture.sent.length, 1);
  assert.equal(groupFixture.sent[0].jid, '111@g.us');
  assert.match(groupFixture.sent[0].content.text, /Statut texte posté sur : ce groupe/);
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

test('.style en privé sélectionne un groupe, puis publie la vidéo stylisée vers cette cible', async () => {
  resetSelections();
  const fixture = privateFixture();
  await stylePlugin._test.executeStyle(fixture.context);

  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].jid, fixture.context.from);
  assert.match(fixture.sent[0].content.text, /réponds à un audio avec \.style/);
  const selected = selector.resolveGroupSelection('50900000000', fixture.context.from, '1');
  assert.equal(selected.status, 'selected');
  assert.equal(selected.purpose, 'style');

  const published = [];
  const audioContext = {
    ...fixture.context,
    args: [],
    quotedMsg: { audioMessage: { mimetype: 'audio/ogg', seconds: 12, caption: 'voix du groupe' } }
  };
  await stylePlugin._test.executeStyle(audioContext, {
    async *downloadContent(_media, type) {
      assert.equal(type, 'audio');
      yield Buffer.from('audio-source');
    },
    async audioToStatusVideo(source) {
      assert.equal(source.toString(), 'audio-source');
      return Buffer.from('styled-video');
    },
    async publishGroupStatus(_socket, jid, payload) {
      published.push({ jid, payload });
    }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].jid, '111@g.us');
  assert.equal(published[0].payload.video.toString(), 'styled-video');
  assert.equal(fixture.sent.at(-1).jid, fixture.context.from);
  assert.match(fixture.sent.at(-1).content.text, /audio stylisé en vidéo posté sur : Amis/);
});

test('.style <texte> conserve le comportement Fancy Text', async () => {
  const fixture = privateFixture();
  await stylePlugin._test.executeStyle({ ...fixture.context, args: ['Kaido', 'MD'] });

  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].jid, fixture.context.from);
  assert.match(fixture.sent[0].content.text, /TEXTES STYLISÉS POUR/);
  assert.match(fixture.sent[0].content.text, /Kaido MD/);
});

test('pluginLoader enregistre .style pour les statuts et conserve Fancy Text', () => {
  pluginLoader.loadPlugins(false);
  const commands = pluginLoader.getPlugins();
  const style = commands.get('style');
  const fancy = commands.get('fancy');

  assert.ok(style);
  assert.equal(style.name, 'style');
  assert.equal(style.category, 'group');
  assert.equal(commands.get('fancytext'), fancy);
  assert.notEqual(style, fancy);
  assert.equal(fancy.aliases.includes('style'), false);
});

test('une commande lancée dans un groupe publie et confirme dans le même groupe', async () => {
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
  assert.equal(fixture.sent.some(event => event.jid === '50911111111@s.whatsapp.net'), false);
  assert.equal(fixture.sent.at(-1).jid, '111@g.us');
  assert.match(fixture.sent.at(-1).content.text, /Statut texte posté sur/);
});

test('swgc trouve un média cité dans le contexte de message et répond dans le groupe', async () => {
  resetSelections();
  const fixture = privateFixture();
  const published = [];
  const context = {
    ...fixture.context,
    from: '111@g.us',
    sender: '50911111111@s.whatsapp.net',
    args: [],
    msg: {
      key: { remoteJid: '111@g.us', participant: '50911111111@s.whatsapp.net' },
      message: {
        extendedTextMessage: {
          text: '.swgc',
          contextInfo: { quotedMessage: { imageMessage: { caption: 'image citée', mimetype: 'image/png' } } }
        }
      }
    }
  };
  await swgc._test.executeSwgc(context, {
    async *downloadContent(media, type) {
      assert.equal(type, 'image');
      assert.equal(media.caption, 'image citée');
      yield Buffer.from('image buffer');
    },
    async publishGroupStatus(socket, jid, payload) { published.push({ jid, payload }); }
  });

  assert.equal(published[0].jid, '111@g.us');
  assert.equal(published[0].payload.image.toString(), 'image buffer');
  assert.equal(fixture.sent.at(-1).jid, '111@g.us');
  assert.match(fixture.sent.at(-1).content.text, /Statut image posté/);
});

test('swgc publie image, vidéo et audio dans un groupe admin-only quand le bot et l’auteur sont admins', async () => {
  resetSelections();
  const botJid = '50900000000:1@s.whatsapp.net';
  const memberJid = '50911111111@s.whatsapp.net';
  const metadata = {
    id: '111@g.us',
    subject: 'Groupe fermé',
    announce: true,
    participants: [
      { id: '50900000000@s.whatsapp.net', admin: 'admin' },
      { id: memberJid, admin: 'admin' }
    ]
  };
  const relayed = [];
  const uploaded = [];
  const sent = [];
  const socket = {
    user: { id: botJid },
    async groupMetadata(jid) {
      assert.equal(jid, metadata.id);
      return metadata;
    },
    async waUploadToServer(filePath, options = {}) {
      assert.ok(fs.existsSync(filePath), 'fichier média temporaire absent pendant le téléversement');
      uploaded.push({ filePath, mediaType: options.mediaType });
      return { mediaUrl: `https://upload.invalid/${options.mediaType}`, directPath: `/closed/${options.mediaType}` };
    },
    async relayMessage(jid, message, options) {
      relayed.push({ jid, message, options });
    },
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: `reply-${sent.length}` } };
    }
  };
  const cases = [
    { type: 'image', key: 'imageMessage', media: { mimetype: 'image/png', caption: 'photo du groupe' } },
    { type: 'video', key: 'videoMessage', media: { mimetype: 'video/mp4', caption: 'vidéo du groupe' } },
    { type: 'audio', key: 'audioMessage', media: { mimetype: 'audio/ogg', seconds: 3, caption: 'audio du groupe' } }
  ];

  for (const [index, item] of cases.entries()) {
    const context = {
      socket,
      from: metadata.id,
      sender: memberJid,
      senderNumber: '50911111111',
      sessionNumber: '50900000000',
      prefix: '.',
      args: [],
      isOwner: false,
      isSessionOwner: false,
      isSudo: false,
      msg: {
        key: { remoteJid: metadata.id, participant: memberJid, id: `closed-${index}` },
        message: {
          extendedTextMessage: {
            text: '.swgc',
            contextInfo: { quotedMessage: { [item.key]: item.media } }
          }
        }
      }
    };
    await swgc._test.executeSwgc(context, {
      async *downloadContent(_media, mediaType) {
        assert.equal(mediaType, item.type);
        yield Buffer.from(`${item.type}-source`);
      },
      async publishGroupStatus(_socket, jid, payload, options) {
        const mediaType = payload.image ? 'image' : payload.video ? 'video' : payload.audio ? 'audio' : 'text';
        const messageKey = mediaType === 'text' ? 'extendedTextMessage' : `${mediaType}Message`;
        uploaded.push({ mediaType });
        relayed.push({
          jid,
          message: { groupStatusMessageV2: { message: { [messageKey]: payload } } },
          options
        });
      }
    });
  }

  assert.equal(relayed.length, 3);
  assert.ok(relayed.every(event => event.options.useCachedGroupMetadata === false), 'le relay d’un groupe fermé doit utiliser des métadonnées fraîches');
  assert.equal(uploaded.length, 3);
  assert.deepEqual(uploaded.map(item => item.mediaType), ['image', 'video', 'audio']);
  assert.ok(relayed[0].message.groupStatusMessageV2.message.imageMessage);
  assert.equal(relayed[0].message.groupStatusMessageV2.message.imageMessage.caption, 'photo du groupe');
  assert.ok(relayed[1].message.groupStatusMessageV2.message.videoMessage);
  assert.equal(relayed[1].message.groupStatusMessageV2.message.videoMessage.caption, 'vidéo du groupe');
  assert.ok(relayed[2].message.groupStatusMessageV2.message.audioMessage);
  assert.equal(relayed[2].message.groupStatusMessageV2.message.audioMessage.mimetype, 'audio/ogg');
  assert.equal(sent.length, 4, 'le statut audio reçoit un message de caption et une confirmation');
  assert.ok(sent.every(event => event.jid === metadata.id), 'les réponses doivent rester dans le groupe fermé');
  assert.match(sent[2].content.text, /audio du groupe/);
  assert.match(sent[2].content.text, /Kaido-MD — Développeur : PlagTech/);
  assert.match(sent[3].content.text, /Statut audio posté sur : ce groupe/);
});

test('.style supprime le MP4 temporaire après la fin du relay, même si la publication échoue', async () => {
  for (const shouldFail of [false, true]) {
    resetSelections();
    const fixture = privateFixture();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kaido-swgc-audio-cleanup-'));
    const videoPath = path.join(tempDir, 'group-status.mp4');
    let cleanupCalls = 0;
    let relayFinished = false;
    const audio = { mimetype: 'audio/ogg', seconds: 205, caption: 'audio de groupe' };
    const context = {
      ...fixture.context,
      from: '111@g.us',
      sender: '50911111111@s.whatsapp.net',
      args: [],
      isOwner: false,
      isSessionOwner: false,
      isSudo: false,
      quotedMsg: { audioMessage: audio },
      msg: {
        key: { remoteJid: '111@g.us', participant: '50911111111@s.whatsapp.net', id: `audio-${shouldFail}` },
        message: {}
      }
    };

    try {
      await stylePlugin._test.executeStyle(context, {
        async *downloadContent(_media, type) {
          assert.equal(type, 'audio');
          yield Buffer.from('audio-source');
        },
        async audioToStatusVideoFile(source, options) {
          assert.equal(options.durationSeconds, 205);
          const chunks = [];
          for await (const chunk of source) chunks.push(Buffer.from(chunk));
          assert.equal(Buffer.concat(chunks).toString(), 'audio-source');
          await fs.promises.writeFile(videoPath, 'converted-group-status-video');
          return {
            path: videoPath,
            async cleanup() {
              assert.equal(relayFinished, true, 'le fichier ne doit pas être supprimé avant la fin du relay');
              cleanupCalls += 1;
              await fs.promises.rm(tempDir, { recursive: true, force: true });
            }
          };
        },
        async publishGroupStatus(_socket, jid, payload) {
          assert.equal(jid, '111@g.us');
          assert.ok(payload.video.stream);
          const chunks = [];
          for await (const chunk of payload.video.stream) chunks.push(Buffer.from(chunk));
          assert.equal(Buffer.concat(chunks).toString(), 'converted-group-status-video');
          relayFinished = true;
          if (shouldFail) throw new Error('relay de test échoué');
        }
      });

      assert.equal(cleanupCalls, 1);
      await assert.rejects(fs.promises.access(videoPath));
      assert.equal(fixture.sent.at(-1).jid, '111@g.us');
      assert.match(fixture.sent.at(-1).content.text, shouldFail
        ? /relay de test échoué/
        : /Statut audio stylisé en vidéo posté/);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('swgc refuse un groupe admin-only si le compte du bot n’en est pas administrateur', async () => {
  const fixture = privateFixture();
  const groupJid = '111@g.us';
  let publications = 0;
  fixture.socket.user.id = '50900000000@s.whatsapp.net';
  fixture.socket.groupMetadata = async () => ({
    id: groupJid,
    announce: true,
    participants: [
      { id: '50900000000@s.whatsapp.net', admin: null },
      { id: '50911111111@s.whatsapp.net', admin: 'admin' }
    ]
  });
  const context = {
    ...fixture.context,
    from: groupJid,
    args: ['test fermé'],
    msg: { key: { remoteJid: groupJid, participant: '50911111111@s.whatsapp.net' }, message: {} }
  };
  await swgc._test.executeSwgc(context, {
    async publishGroupStatus() { publications += 1; }
  });

  assert.equal(publications, 0);
  assert.equal(fixture.sent.at(-1).jid, groupJid);
  assert.match(fixture.sent.at(-1).content.text, /admin-only/i);
  assert.match(fixture.sent.at(-1).content.text, /administrateur/i);
});

test('le handler intercepte la réponse numérique et l’ancien case swgc bruyant a disparu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  assert.match(source, /resolveGroupSelection\(sessionId, selectionActor, normalizedBody\)/);
  assert.match(source, /selection\.purpose === 'style'/);
  assert.match(source, /isPublicGroupStatusCommand\(from, command\)/);
  assert.doesNotMatch(source, /case 'swgc':/);
  const pluginSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'plugins', 'group', 'swgc.js'), 'utf8');
  assert.match(pluginSource, /socket\.sendMessage\(from/);
  assert.match(pluginSource, /sendContextReply\(context/);
  assert.doesNotMatch(pluginSource, /privateJid/);
  const statusSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'status.js'), 'utf8');
  assert.match(statusSource, /groupStatusMessageV2/);
  assert.match(statusSource, /socket\.relayMessage\(jid/);
  assert.doesNotMatch(statusSource, /isGroupStatus\s*:/);
  assert.doesNotMatch(statusSource, /is_group_status\s*:/);
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
