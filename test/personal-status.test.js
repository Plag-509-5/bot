'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { getStatusMediaQueueStats } = require('../src/services/status-media-queue');
const { createStatusAckMonitor, personalStatus } = require('../src/handlers/status');
const audioStatus = require('../src/services/group-status-audio');
const audience = require('../src/services/status-audience');
const statusLog = require('../src/services/status-log');
const tostatus = require('../src/plugins/owner/tostatus');
const pluginLoader = require('../src/core/pluginLoader');

function fakeSocket(extra = {}) {
  const sent = [];
  const relayed = [];
  const upserted = [];
  const socket = {
    user: { id: '50900000000:7@s.whatsapp.net' },
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      if (jid === 'status@broadcast' && content?.delete) return { key: { id: content.delete.id } };
      if (jid === 'status@broadcast') {
        relayed.push({ jid, message: content, options });
        return { key: { id: options?.messageId || `status-${relayed.length}` } };
      }
      return { key: { id: `reply-${sent.length}` } };
    },
    async waUploadToServer(_encryptedPath, { mediaType } = {}) {
      return {
        mediaUrl: `https://upload.invalid/${mediaType || 'media'}`,
        directPath: `/status/${mediaType || 'media'}`
      };
    },
    async upsertMessage(message, type) {
      upserted.push({ message, type });
    },
    messageMutex: { async mutex(operation) { return operation(); } },
    ...extra
  };
  return { socket, sent, relayed, upserted };
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

function testStatusPublisher(relayed) {
  return async (_socket, content, options) => {
    const messageId = `test-status-${relayed.length + 1}`;
    let message;
    if (content.text) {
      message = {
        extendedTextMessage: {
          text: content.text,
          backgroundArgb: options.backgroundColor,
          font: options.font
        }
      };
    } else if (content.image) {
      const media = content.image?.stream || content.image;
      assert.equal(Buffer.isBuffer(content.image), false, 'la photo doit être envoyée en flux');
      assert.equal(typeof media?.[Symbol.asyncIterator], 'function');
      const chunks = [];
      for await (const chunk of media) chunks.push(Buffer.from(chunk));
      message = {
        imageMessage: {
          mimetype: content.mimetype,
          caption: content.caption,
          url: 'https://upload.invalid/image',
          data: Buffer.concat(chunks)
        }
      };
    } else if (content.video) {
      const media = content.video?.stream || content.video;
      assert.equal(Buffer.isBuffer(content.video), false, 'la vidéo doit être envoyée en flux');
      assert.equal(typeof media?.[Symbol.asyncIterator], 'function');
      const chunks = [];
      for await (const chunk of media) chunks.push(Buffer.from(chunk));
      message = {
        videoMessage: {
          mimetype: content.mimetype,
          caption: content.caption,
          url: 'https://upload.invalid/video',
          data: Buffer.concat(chunks)
        }
      };
    }
    relayed.push({ jid: 'status@broadcast', message, options: { ...options, messageId } });
    if (typeof _socket.upsertMessage === 'function') {
      await _socket.upsertMessage({
        key: { remoteJid: 'status@broadcast', fromMe: true, id: messageId },
        message,
        messageTimestamp: Math.floor(Date.now() / 1000)
      }, 'append');
    }
    return { key: { id: messageId } };
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
    '50911111111@s.whatsapp.net',
    '50922222222@s.whatsapp.net'
  ].sort());

  const custom = await audience.getStatusJidList(socket, ['50999999999']);
  assert.equal(groupFetches, 1, 'une audience personnalisée ne doit pas élargir au groupe');
  assert.deepEqual(custom, ['50999999999@s.whatsapp.net']);
});

test('met en cache brièvement l’audience par socket et protège le cache des mutations appelantes', async () => {
  let groupFetches = 0;
  const { socket } = fakeSocket({
    async groupFetchAllParticipating() {
      groupFetches += 1;
      return {
        '1@g.us': {
          participants: [{ id: '50911111111@s.whatsapp.net' }]
        }
      };
    }
  });

  const first = await audience.getStatusJidList(socket, []);
  first.push('50999999999@s.whatsapp.net');
  const second = await audience.getStatusJidList(socket, []);

  assert.equal(groupFetches, 1, 'l’audience par défaut ne doit pas relire les groupes à chaque statut');
  assert.deepEqual(second.sort(), [
    '50911111111@s.whatsapp.net'
  ].sort());
  assert.equal(audience.DEFAULT_AUDIENCE_CACHE_TTL_MS, 60_000);
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

test('le flux média .tostatus ne rejette pas un fichier selon une limite applicative de taille', async () => {
  const source = Readable.from([Buffer.from('photo-'), Buffer.from('stream')]);
  const upload = tostatus._test.mediaUploadStream(source, 'La photo');
  const chunks = [];
  for await (const chunk of upload.stream) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), 'photo-stream');
  assert.equal(source.destroyed, true);
});

test('publie un statut texte avec statusJidList, option de fond et journal de suppression', async () => {
  resetLog();
  const { socket, sent, relayed, upserted } = fakeSocket();
  const context = ownerContext(socket);
  await tostatus._test.executeToStatus(context, {
    publishPersonalStatus: testStatusPublisher(relayed)
  });
  await new Promise(resolve => setImmediate(resolve));

  const statusSend = relayed.find(event => event.jid === 'status@broadcast');
  assert.ok(statusSend);
  assert.equal(sent.some(event => event.jid === 'status@broadcast'), false, 'la publication doit passer par le relay NYXCORE, pas par un second chemin sendMessage');
  assert.equal(statusSend.message.extendedTextMessage.text, 'Bonjour');
  assert.deepEqual(statusSend.options.statusJidList.sort(), [
    '50922222222@s.whatsapp.net',
    '50900000000@s.whatsapp.net'
  ].sort());
  assert.ok(statusSend.message.extendedTextMessage.backgroundArgb !== undefined);
  assert.equal(statusLog.getLatest('50900000000').key.id, statusSend.options.messageId);
  assert.equal(upserted.length, 1, 'le relay direct doit conserver l’append local effectué par sendMessage Baileys');
  assert.equal(upserted[0].type, 'append');
  assert.equal(upserted[0].message.key.fromMe, true);
  assert.equal(upserted[0].message.key.id, statusSend.options.messageId);
  assert.match(sent.at(-1).content.text, /Statut 📝 Texte publié/);
  assert.match(sent.at(-1).content.text, /\.delstatus/);
});

test('un compte migré route les destinataires en LID et inclut le numéro PN du bot', async () => {
  resetLog();
  const relayed = [];
  const { socket, sent } = fakeSocket({
    authState: {
      creds: {
        me: {
          id: '50900000000:0@s.whatsapp.net',
          lid: 'self-lid:4@lid'
        }
      }
    },
    signalRepository: {
      lidMapping: {
        async getLIDsForPNs(pns) {
          assert.deepEqual(pns, [
            '50922222222@s.whatsapp.net',
            '50933333333@s.whatsapp.net'
          ]);
          return [
            { pn: '50922222222@s.whatsapp.net', lid: 'contact-222:2@lid' },
            { pn: '50933333333@s.whatsapp.net', lid: 'contact-333:1@lid' }
          ];
        }
      }
    }
  });

  await tostatus._test.executeToStatus(ownerContext(socket, {
    sessionCfg: { STATUS_VIEWERS: ['50922222222', '50933333333'] },
    args: ['LID routing']
  }), { publishPersonalStatus: testStatusPublisher(relayed) });

  const statusSend = relayed.find(event => event.jid === 'status@broadcast');
  assert.deepEqual(
    [...statusSend.options.statusJidList].sort(),
    ['contact-222@lid', 'contact-333@lid', '50900000000@s.whatsapp.net'].sort()
  );
  assert.equal(statusSend.options.additionalAttributes, undefined);
  assert.equal(statusSend.options.useUserDevicesCache, undefined, 'le plugin laisse le cache Baileys activé par défaut');
  assert.equal(statusLog.getLatest('50900000000').addressingMode, 'lid');
  assert.match(sent.at(-1).content.text, /visible par 2 destinataire/);

  await tostatus._test.executeToStatus(ownerContext(socket, { command: 'delstatus', args: [] }));
  const revoke = sent.find(event => event.jid === 'status@broadcast' && event.content.delete);
  assert.deepEqual(
    [...revoke.options.statusJidList].sort(),
    ['contact-222@lid', 'contact-333@lid', '50900000000@s.whatsapp.net'].sort()
  );
  assert.equal(revoke.options.additionalAttributes, undefined);
  assert.equal(revoke.options.useUserDevicesCache, undefined);
});

test('annule la publication complète si une entrée de la liste n’a pas de mapping LID', async () => {
  resetLog();
  const relayed = [];
  const { socket, sent } = fakeSocket({
    authState: {
      creds: {
        me: {
          id: '50900000000@s.whatsapp.net',
          lid: 'self-lid@lid'
        }
      }
    },
    signalRepository: {
      lidMapping: {
        async getLIDsForPNs() {
          return [{ pn: '50922222222@s.whatsapp.net', lid: 'contact-222@lid' }];
        }
      }
    }
  });

  await tostatus._test.executeToStatus(ownerContext(socket, {
    sessionCfg: { STATUS_VIEWERS: ['50922222222', '50933333333'] },
    args: ['no partial status']
  }), { publishPersonalStatus: testStatusPublisher(relayed) });

  assert.equal(relayed.some(event => event.jid === 'status@broadcast'), false);
  assert.equal(statusLog.getLatest('50900000000'), null);
  assert.match(sent.at(-1).content.text, /Publication annulée/);
  assert.match(sent.at(-1).content.text, /50933333333/);
});

test('surveille les erreurs de relay correspondant à l’identifiant du statut', async () => {
  const ev = new EventEmitter();
  const monitor = createStatusAckMonitor({ ev }, 'status-123', 100);
  const resultPromise = monitor.wait();
  ev.emit('messages.update', [
    { key: { id: 'another-status' }, update: { status: 0, messageStubParameters: ['479'] } },
    { key: { id: 'status-123' }, update: { status: 0, messageStubParameters: ['479'] } }
  ]);
  assert.deepEqual(await resultPromise, { code: '479' });
  monitor.close();
  assert.equal(ev.listenerCount('messages.update'), 0);
});

test('sendMessage suit le chemin officiel et un ACK 479 déclenche un repli PN/LID sûr', async () => {
  const ev = new EventEmitter();
  const relayed = [];
  const { socket } = fakeSocket({
    ev,
    authState: { creds: { me: { id: '50900000000@s.whatsapp.net', lid: 'self-lid@lid' } } },
    signalRepository: { lidMapping: {} },
    async sendMessage(jid, message, options) {
      relayed.push({ jid, message, options });
      if (relayed.length === 1) {
        ev.emit('messages.update', [{
          key: { id: options.messageId },
          update: { status: 0, messageStubParameters: ['479'] }
        }]);
      }
      return { key: { id: options.messageId } };
    }
  });

  const sent = await personalStatus(socket, { text: 'Fallback validé' }, {
    statusJidList: ['contact-lid@lid'],
    sourceStatusJidList: ['50922222222@s.whatsapp.net'],
    additionalAttributes: { addressing_mode: 'lid' },
    ackGraceMs: 0
  });

  assert.equal(relayed.length, 2);
  assert.deepEqual(relayed[0].options.statusJidList, ['contact-lid@lid']);
  assert.equal(relayed[0].options.useUserDevicesCache, true);
  assert.equal(relayed[0].options.additionalAttributes, undefined);
  assert.deepEqual(relayed[1].options.statusJidList, [
    '50922222222@s.whatsapp.net',
    '50900000000@s.whatsapp.net'
  ]);
  assert.equal(relayed[1].options.useUserDevicesCache, true);
  assert.equal(relayed[1].options.additionalAttributes, undefined);
  assert.notEqual(relayed[0].options.messageId, relayed[1].options.messageId);
  assert.equal(sent.statusAddressingMode, 'pn');
  assert.deepEqual(sent.statusJidList, [
    '50922222222@s.whatsapp.net',
    '50900000000@s.whatsapp.net'
  ]);
});

test('ne publie pas un statut adressé uniquement au propre compte du bot', async () => {
  resetLog();
  const { socket, sent, relayed } = fakeSocket();
  await tostatus._test.executeToStatus(ownerContext(socket, {
    sessionCfg: { STATUS_VIEWERS: [] },
    args: ['invisible']
  }));
  assert.equal(relayed.some(event => event.jid === 'status@broadcast'), false);
  assert.match(sent.at(-1).content.text, /Aucun autre destinataire/);
  assert.match(sent.at(-1).content.text, /\.setstatusviewers/);
});

test('publie une image citée en utilisant le downloader NYXCORE injecté', async () => {
  resetLog();
  const { socket, sent, relayed } = fakeSocket();
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
    },
    publishPersonalStatus: testStatusPublisher(relayed)
  });

  const statusSend = relayed.find(event => event.jid === 'status@broadcast');
  assert.equal(statusSend.message.imageMessage.mimetype, 'image/png');
  assert.equal(statusSend.message.imageMessage.caption, 'photo citée');
  assert.ok(statusSend.message.imageMessage.url || statusSend.message.imageMessage.directPath);
});

test('conserve une vidéo citée et retire la commande d’une caption de média propre', async () => {
  resetLog();
  const { socket, sent, relayed } = fakeSocket();
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
    },
    publishPersonalStatus: testStatusPublisher(relayed)
  });

  const statusSend = relayed.find(event => event.jid === 'status@broadcast');
  assert.equal(statusSend.message.videoMessage.mimetype, 'video/mp4');
  assert.equal(statusSend.message.videoMessage.caption, 'légende vidéo');
  assert.ok(statusSend.message.videoMessage.url || statusSend.message.videoMessage.directPath);
  assert.equal(tostatus._test.mediaCaption({ caption: '.tostatus Description' }, true, '', '.', 'tostatus'), 'Description');
  assert.equal(tostatus._test.commandCaptionText('!to+status Texte', '!', 'to+status'), 'Texte');
});

test('audio de statut personnel conserve le cadre Kaido réutilisé par style', async () => {
  resetLog();
  const { socket, sent, relayed } = fakeSocket();
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
    },
    publishPersonalStatus: testStatusPublisher(relayed)
  });

  const statusSend = relayed.find(event => event.jid === 'status@broadcast');
  assert.equal(statusSend.message.videoMessage.mimetype, 'video/mp4');
  assert.equal(statusSend.message.videoMessage.caption, 'mon audio');
  assert.ok(statusSend.message.videoMessage.url || statusSend.message.videoMessage.directPath);
  assert.equal(converterOptions.durationSeconds, 180);
  assert.equal(converterOptions.maxDurationSeconds, null);
  assert.equal(converterOptions.maxInputBytes, null);
  assert.equal(converterOptions.maxOutputBytes, null);
  assert.equal(converterOptions.branding.title, 'Kaido-MD');
  assert.equal(converterOptions.branding.subtitle, 'Développeur : PlagTech');
  assert.equal(converterOptions.design.cyan, '0x72DDF7');
  assert.equal(converterOptions.design.background, '0x080A12');
  assert.equal(tostatus._test.PERSONAL_STATUS_BRANDING, audioStatus.BRANDING);
  assert.equal(tostatus._test.PERSONAL_STATUS_DESIGN, audioStatus.DESIGN);
});

test('nettoie le MP4 temporaire et libère le slot média après un échec de publication', async () => {
  resetLog();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaido-tostatus-cleanup-test-'));
  const videoPath = path.join(tempDir, 'converted.mp4');
  await fs.writeFile(videoPath, 'converted-video');
  const { socket, sent } = fakeSocket();
  const audio = { mimetype: 'audio/ogg', seconds: 60, caption: 'audio temporaire' };
  const context = ownerContext(socket, {
    args: [],
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'reply-audio-cleanup' },
      message: {
        extendedTextMessage: {
          text: '.tostatus',
          contextInfo: { quotedMessage: { audioMessage: audio } }
        }
      }
    },
    quotedMsg: { audioMessage: audio }
  });
  const before = getStatusMediaQueueStats();
  let cleanupCalls = 0;

  try {
    await tostatus._test.executeToStatus(context, {
      async *downloadContentFromMessage(_media, type) {
        assert.equal(type, 'audio');
        yield Buffer.from('audio-source');
      },
      async audioToStatusVideoFile(source, options) {
        assert.equal(options.maxDurationSeconds, null);
        assert.equal(options.maxInputBytes, null);
        assert.equal(Object.hasOwn(options, 'maxOutputBytes'), false);
        const chunks = [];
        for await (const chunk of source) chunks.push(Buffer.from(chunk));
        assert.equal(Buffer.concat(chunks).toString(), 'audio-source');
        return {
          path: videoPath,
          async cleanup() {
            cleanupCalls += 1;
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        };
      },
      async publishPersonalStatus(_activeSocket, content) {
        assert.ok(content.video.stream instanceof Readable);
        const chunks = [];
        for await (const chunk of content.video.stream) chunks.push(Buffer.from(chunk));
        assert.equal(Buffer.concat(chunks).toString(), 'converted-video');
        throw new Error('publication simulée échouée');
      }
    });

    assert.equal(cleanupCalls, 1);
    assert.deepEqual(getStatusMediaQueueStats(), before);
    await assert.rejects(fs.access(videoPath));
    assert.match(sent.at(-1).content.text, /publication simulée échouée/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('ferme la source audio si la file FFmpeg globale est pleine', async () => {
  const queueLimits = audioStatus.getAudioStatusQueueStats();
  assert.equal(queueLimits.active, 0);
  assert.equal(queueLimits.waiting, 0);
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const createHeldJob = () => {
    const started = deferred();
    const gate = deferred();
    const job = audioStatus._test.runAudioStatusJob(() => {
      started.resolve();
      return gate.promise;
    });
    return { started, gate, job };
  };
  const activeJobs = Array.from({ length: queueLimits.maxConcurrent }, createHeldJob);
  await Promise.all(activeJobs.map(job => job.started.promise));
  const queuedJobs = Array.from({ length: queueLimits.maxQueued }, createHeldJob);
  assert.deepEqual(audioStatus.getAudioStatusQueueStats(), {
    active: queueLimits.maxConcurrent,
    waiting: queueLimits.maxQueued,
    maxConcurrent: queueLimits.maxConcurrent,
    maxQueued: queueLimits.maxQueued
  });

  const source = new Readable({ read() {} });
  const { socket } = fakeSocket();
  const audio = { mimetype: 'audio/ogg', seconds: 60 };
  const context = ownerContext(socket, {
    args: [],
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'audio-queue-full' },
      message: {
        extendedTextMessage: {
          text: '.tostatus',
          contextInfo: { quotedMessage: { audioMessage: audio } }
        }
      }
    },
    quotedMsg: { audioMessage: audio }
  });

  try {
    await tostatus._test.executeToStatus(context, {
      downloadContentFromMessage() { return source; }
    });
    assert.equal(source.destroyed, true, 'le flux téléchargé non consommé doit être fermé');
  } finally {
    for (const activeJob of activeJobs) activeJob.gate.resolve();
    await Promise.all(activeJobs.map(job => job.job));
    for (const queued of queuedJobs) {
      await queued.started.promise;
      queued.gate.resolve();
      await queued.job;
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(audioStatus.getAudioStatusQueueStats(), {
    active: 0,
    waiting: 0,
    maxConcurrent: queueLimits.maxConcurrent,
    maxQueued: queueLimits.maxQueued
  });
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
    updatebot: 'update',
    send: 'send',
    sendstatus: 'send'
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
