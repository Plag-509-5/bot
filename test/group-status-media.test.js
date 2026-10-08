'use strict';

// Vrais petits fichiers, vrai chiffrement média et vrai relay Signal local.
// L'upload HTTP et le transport WhatsApp restent simulés ; aucun test de
// livraison / affichage sur un téléphone n'est réalisé ici.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const baileys = require('@whiskeysockets/baileys');
const { makeOfflineSocket } = require('./helpers/baileys-socket');
const { buildGroupStatusPayload } = require('../src/services/group-status-content');
const { groupStatus } = require('../src/handlers/status');
const swgc = require('../src/plugins/group/swgc');

const GROUP = '120363000000001@g.us';
const USER = '50990000002@s.whatsapp.net';

async function mediaSamples() {
  const image = sharp({ create: { width: 32, height: 24, channels: 3, background: '#123456' } });
  const thumbnail = await image.clone().jpeg().toBuffer();
  return [
    { type: 'image', bytes: await image.png().toBuffer(), message: { mimetype: 'image/png', caption: 'Image originale', jpegThumbnail: thumbnail, width: 32, height: 24 } },
    { type: 'video', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'status-video.mp4')), message: { mimetype: 'video/mp4', caption: 'Vidéo originale', jpegThumbnail: thumbnail, seconds: 1, width: 32, height: 32 } },
    { type: 'audio', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'status-audio.ogg')), message: { mimetype: 'audio/ogg; codecs=opus', seconds: 1, ptt: true, waveform: Buffer.alloc(64, 32) } }
  ];
}

function uploader(uploads, raw = false) {
  return async (file, metadata) => {
    assert.equal(typeof file, 'string', 'contrat upload de xzcbailz : chemin de fichier');
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length);
    assert.ok(metadata.fileEncSha256B64);
    uploads.push({ file, bytes, metadata, raw });
    return { mediaUrl: `https://media.invalid/${metadata.mediaType}`, directPath: `/local/${metadata.mediaType}` };
  };
}

async function assertEncryptedMedia(media, upload, sample) {
  assert.ok(media.mediaKey?.length === 32);
  assert.ok(media.fileEncSha256?.length === 32);
  assert.equal(Number(media.fileLength), sample.bytes.length);
  assert.deepEqual(Buffer.from(media.fileSha256), crypto.createHash('sha256').update(sample.bytes).digest());
  assert.deepEqual(Buffer.from(media.fileEncSha256), crypto.createHash('sha256').update(upload.bytes).digest());
  const keys = await baileys.getMediaKeys(media.mediaKey, sample.type);
  const decipher = crypto.createDecipheriv('aes-256-cbc', keys.cipherKey, keys.iv);
  const decrypted = Buffer.concat([decipher.update(upload.bytes.subarray(0, -10)), decipher.final()]);
  assert.deepEqual(decrypted, sample.bytes, 'le média transmis doit être intact après déchiffrement');
  assert.equal(media.mimetype, sample.message.mimetype);
  assert.equal(fs.existsSync(upload.file), false, 'fichier temporaire supprimé après upload');
}

function registeredSocket(t, options = {}) {
  const fixture = makeOfflineSocket(t, {
    cachedGroupMetadata: async jid => ({ id: jid, participants: [], addressingMode: 'pn' }),
    ...options
  });
  fixture.state.creds.me = { id: '50990000001:1@s.whatsapp.net' };
  fixture.state.creds.registered = true;
  return fixture;
}

test('workflow swgc : image, vidéo et vocal téléchargés, rechiffrés et relayés en V2 sans réponse dans le chat de groupe', async t => {
  const samples = await mediaSamples();
  const privateReplies = [];
  const uploads = [];
  const { socket, nodes } = registeredSocket(t);
  socket.waUploadToServer = uploader(uploads);
  t.mock.method(socket, 'sendMessage', async (jid, content) => { privateReplies.push({ jid, content }); return {}; });

  for (const sample of samples) {
    const quoted = {
      [`${sample.type}Message`]: {
        ...sample.message,
        url: 'https://old.invalid/media',
        directPath: '/old/media',
        mediaKey: Buffer.alloc(32, 1),
        fileSha256: Buffer.alloc(32, 2)
      }
    };
    await swgc.execute({
      socket, from: GROUP, sender: USER, senderNumber: '50990000002', sessionNumber: '50990000001',
      msg: { key: { remoteJid: GROUP, participant: USER, fromMe: false }, message: {} },
      args: [], prefix: '.', quotedMsg: { viewOnceMessageV2: { message: quoted } }
    }, {
      downloadContent: async function* (media, type) {
        assert.equal(type, sample.type);
        assert.equal(media.url, 'https://old.invalid/media');
        yield sample.bytes.subarray(0, 10);
        yield sample.bytes.subarray(10);
      }
    });
    assert.equal(privateReplies.at(-1).jid, USER);
    assert.equal(privateReplies.at(-1).content.text, `Statut ${sample.type} posté sur : ce groupe`);
    const stanza = nodes.at(-1);
    assert.equal(stanza.attrs.to, GROUP);
    assert.equal(baileys.getBinaryNodeChild(stanza, 'meta').attrs.is_group_status, 'true');
    assert.equal(baileys.getBinaryNodeChild(stanza, 'enc').attrs.type, 'skmsg');
  }
  assert.equal(uploads.length, 3);
  assert.equal(nodes.filter(node => node.tag === 'message' && node.attrs.to === GROUP).length, 3);
  assert.equal(privateReplies.some(reply => reply.jid === GROUP), false);
});

test('les payloads V2 gardent légendes, miniatures, durée et waveform après un round-trip protobuf', async t => {
  const uploads = [];
  const { socket } = registeredSocket(t);
  socket.waUploadToServer = uploader(uploads);
  for (const sample of await mediaSamples()) {
    const { payload } = await buildGroupStatusPayload({
      quotedMessage: { [`${sample.type}Message`]: sample.message },
      downloadContent: async function* () { yield sample.bytes; }
    });
    const wrapped = await groupStatus(socket, GROUP, payload);
    const decoded = baileys.proto.Message.decode(baileys.proto.Message.encode(wrapped.message).finish());
    const inner = decoded.groupStatusMessageV2.message;
    const media = inner[`${sample.type}Message`];
    assert.equal(media.contextInfo.isGroupStatus, true);
    assert.deepEqual(inner.messageContextInfo.messageSecret, decoded.messageContextInfo.messageSecret);
    await assertEncryptedMedia(media, uploads.at(-1), sample);
    if (sample.message.caption) assert.equal(media.caption, sample.message.caption);
    if (sample.message.jpegThumbnail) assert.deepEqual(media.jpegThumbnail, sample.message.jpegThumbnail);
    if (sample.message.seconds !== undefined) assert.equal(media.seconds, sample.message.seconds);
    if (sample.type === 'audio') {
      assert.equal(media.ptt, true);
      assert.deepEqual(media.waveform, sample.message.waveform);
    }
  }
});

test('sharp du projet génère réellement la miniature image quand le message cité n’en fournit pas', async t => {
  const uploads = [];
  const { socket } = registeredSocket(t);
  socket.waUploadToServer = uploader(uploads);
  const sample = (await mediaSamples())[0];
  const result = await groupStatus(socket, GROUP, { image: sample.bytes, mimetype: 'image/png' });
  const media = result.message.groupStatusMessageV2.message.imageMessage;
  assert.ok(media.jpegThumbnail?.length > 10);
  assert.equal(media.width, 32);
  assert.equal(media.height, 24);
  await assertEncryptedMedia(media, uploads[0], sample);
});

test('les métadonnées copiées du média ne réutilisent jamais les anciennes clés ni URL/hashes', async () => {
  const sample = (await mediaSamples())[1];
  const { payload } = await buildGroupStatusPayload({
    quotedMessage: { videoMessage: { ...sample.message, url: 'old', directPath: 'old', mediaKey: Buffer.alloc(32), fileSha256: Buffer.alloc(32), contextInfo: { mentionedJid: [USER] } } },
    downloadContent: async function* () { yield sample.bytes; }
  });
  for (const forbidden of ['url', 'directPath', 'mediaKey', 'fileSha256', 'fileEncSha256', 'contextInfo']) assert.equal(payload[forbidden], undefined);
  assert.equal(payload.seconds, 1);
  assert.deepEqual(payload.jpegThumbnail, sample.message.jpegThumbnail);
});

test('les envois média de type post/status utilisent le chemin status@broadcast et gardent leur contenu', async t => {
  const { socket, nodes } = registeredSocket(t);
  const uploads = [];
  for (const sample of await mediaSamples()) {
    const sent = await socket.sendMessage('status@broadcast', { [sample.type]: sample.bytes, ...sample.message }, {
      upload: uploader(uploads), statusJidList: []
    });
    const stanza = nodes.at(-1);
    assert.equal(stanza.attrs.to, 'status@broadcast');
    assert.equal(baileys.getBinaryNodeChild(stanza, 'enc').attrs.type, 'skmsg');
    assert.equal(sent.message.groupStatusMessageV2, null, 'un statut personnel n’est pas un statut de groupe');
    await assertEncryptedMedia(sent.message[`${sample.type}Message`], uploads.at(-1), sample);
  }
});

test('les envois média de type upch/upload vers une newsletter sont uploadés en clair comme l’exige le fork', async t => {
  const { socket, nodes } = registeredSocket(t);
  const uploads = [];
  const jid = '120363421675697127@newsletter';
  for (const sample of await mediaSamples()) {
    const sent = await socket.sendMessage(jid, { [sample.type]: sample.bytes, ...sample.message }, { upload: uploader(uploads, true) });
    const stanza = nodes.at(-1);
    assert.equal(stanza.attrs.to, jid);
    const plaintext = baileys.getBinaryNodeChild(stanza, 'plaintext');
    assert.ok(plaintext);
    const decoded = baileys.proto.Message.decode(plaintext.content);
    const media = decoded[`${sample.type}Message`];
    assert.equal(media.mimetype, sample.message.mimetype);
    assert.equal(Number(media.fileLength), sample.bytes.length);
    assert.equal(media.mediaKey, null);
    assert.deepEqual(uploads.at(-1).bytes, sample.bytes);
    assert.equal(fs.existsSync(uploads.at(-1).file), false);
    assert.ok(sent.key.id);
  }
});

test('un upload qui échoue ne relaie pas de faux statut réussi et nettoie les fichiers temporaires', async t => {
  const { socket, nodes } = registeredSocket(t);
  let file;
  socket.waUploadToServer = async first => { file = first; throw new Error('Upload refusé'); };
  const sample = (await mediaSamples())[0];
  await assert.rejects(groupStatus(socket, GROUP, { image: sample.bytes, ...sample.message }), /Upload refusé/);
  assert.equal(nodes.length, 0);
  assert.equal(fs.existsSync(file), false);
});
