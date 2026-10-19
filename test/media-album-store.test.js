'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMediaAlbumStore,
  snapshotMessageEnvelope,
  getImageMessage,
  albumAssociation
} = require('../src/services/media-album-store');

function mediaMessage({ id, parentId, remoteJid = '120@g.us', timestamp = 100, mime = 'image/jpeg' }) {
  return {
    key: { id, remoteJid, participant: '509123@s.whatsapp.net' },
    messageTimestamp: timestamp,
    message: {
      imageMessage: { mimetype: mime, data: id },
      messageContextInfo: {
        messageAssociation: { parentMessageKey: { id: parentId, remoteJid } }
      }
    }
  };
}

test('album cache indexes media by Baileys parentMessageKey and isolates chats', () => {
  let clock = 1000;
  const store = createMediaAlbumStore({ now: () => clock, ttlMs: 500 });
  store.record('120@g.us', {
    key: { id: 'album-1', remoteJid: '120@g.us' },
    message: { albumMessage: { expectedImageCount: 2 } }
  });
  const first = mediaMessage({ id: 'photo-1', parentId: 'album-1', timestamp: 101 });
  const second = mediaMessage({ id: 'photo-2', parentId: 'album-1', timestamp: 102 });
  store.record('120@g.us', first);
  store.record('120@g.us', second);

  const album = store.getImages('120@g.us', 'album-1');
  assert.equal(album.expectedImageCount, 2);
  assert.deepEqual(album.messages.map(item => item.key.id), ['photo-1', 'photo-2']);
  assert.equal(store.getImages('other@g.us', 'album-1').messages.length, 0);
  assert.equal(getImageMessage(first.message).data, 'photo-1');
  assert.equal(albumAssociation(first).id, 'album-1');

  clock += 501;
  assert.equal(store.getImages('120@g.us', 'album-1').messages.length, 0);
});

test('message snapshots retain ephemeral wrappers when the live message is unwrapped in place', () => {
  const original = {
    key: { id: 'once-1', remoteJid: '246454467731604@lid' },
    message: { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: {} } } } } }
  };
  const snapshot = snapshotMessageEnvelope(original);
  original.message = original.message.ephemeralMessage.message;
  assert.ok(snapshot.message.ephemeralMessage);
  assert.ok(snapshot.message.ephemeralMessage.message.viewOnceMessageV2);
  assert.notEqual(snapshot.key, original.key);
});

test('sticker pack metadata is encoded as EXIF and reuses the supplied pack id', async () => {
  const Module = require('node:module');
  const helperPath = require.resolve('../src/lib/sticker-pack');
  const originalHelper = require.cache[helperPath];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'node-webpmux') {
      return { Image: class {
        async load(buffer) { this.buffer = buffer; }
        async save() { return this.exif; }
      } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[helperPath];
  try {
    const { addStickerPackMetadata } = require('../src/lib/sticker-pack');
    const exif = await addStickerPackMetadata(Buffer.from('webp'), {
      packname: 'Album', author: 'Kaido', packId: 'shared-pack-id'
    });
    const size = exif.readUIntLE(14, 4);
    const metadata = JSON.parse(exif.subarray(22, 22 + size).toString('utf8'));
    assert.equal(metadata['sticker-pack-name'], 'Album');
    assert.equal(metadata['sticker-pack-publisher'], 'Kaido');
    assert.equal(metadata['sticker-pack-id'], 'shared-pack-id');
  } finally {
    Module._load = originalLoad;
    delete require.cache[helperPath];
    if (originalHelper) require.cache[helperPath] = originalHelper;
  }
});

test('spack converts and sends each cached album photo with shared pack metadata', async () => {
  const utilsPath = require.resolve('../src/lib/s-utils');
  const packPath = require.resolve('../src/lib/sticker-pack');
  const pluginPath = require.resolve('../src/plugins/tools/spack');
  const originalUtils = require.cache[utilsPath];
  const originalPack = require.cache[packPath];
  const conversions = [];
  const packMetadata = [];
  require.cache[packPath] = {
    id: packPath,
    filename: packPath,
    loaded: true,
    exports: {
      createStickerPackId: () => 'one-pack-id',
      addStickerPackMetadata: async (buffer, metadata) => {
        packMetadata.push(metadata);
        return Buffer.concat([buffer, Buffer.from(':packed')]);
      }
    }
  };
  require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: {
      createStickerFromMedia: async (media, author, title) => {
        conversions.push({ source: media.buffer.toString(), author, title });
        return { buffer: Buffer.from(`sticker:${media.buffer.toString()}`) };
      }
    }
  };
  delete require.cache[pluginPath];
  try {
    const plugin = require('../src/plugins/tools/spack');
    const store = createMediaAlbumStore();
    const first = mediaMessage({ id: 'photo-1', parentId: 'album-1', timestamp: 101 });
    const second = mediaMessage({ id: 'photo-2', parentId: 'album-1', timestamp: 102 });
    store.record('120@g.us', {
      key: { id: 'album-1', remoteJid: '120@g.us' },
      message: { albumMessage: { expectedImageCount: 2 } }
    });
    store.record('120@g.us', first);
    store.record('120@g.us', second);

    const sent = [];
    const parentMessage = {
      key: { id: 'album-1', remoteJid: '120@g.us' },
      message: { albumMessage: { expectedImageCount: 2 } }
    };
    const msg = {
      key: { id: 'command-1', remoteJid: '120@g.us' },
      message: {
        extendedTextMessage: {
          text: '.spack Vacances | Plag by Kᴀɪᴅᴏ ᴍD',
          contextInfo: {
            stanzaId: 'album-1',
            quotedMessage: parentMessage.message
          }
        }
      }
    };
    await plugin.execute({
      socket: { sendMessage: async (_jid, content) => sent.push(content) },
      msg,
      from: '120@g.us',
      args: ['Vacances', '|', 'Plag by Kᴀɪᴅᴏ ᴍD'],
      downloadContentFromMessage: async function* (image) { yield Buffer.from(image.data); },
      getAlbumImages: (chat, parentId, quoted) => store.getImages(chat, parentId, quoted)
    });

    assert.deepEqual(conversions.map(item => item.source), ['photo-1', 'photo-2']);
    assert.deepEqual(packMetadata.map(item => [item.packname, item.author, item.packId]), [
      ['Vacances', 'Plag by Kᴀɪᴅᴏ ᴍD', 'one-pack-id'],
      ['Vacances', 'Plag by Kᴀɪᴅᴏ ᴍD', 'one-pack-id']
    ]);
    assert.equal(sent.filter(item => item.sticker).length, 2);
    assert.equal(sent[1].sticker.toString(), 'sticker:photo-1:packed');
    assert.equal(sent[2].sticker.toString(), 'sticker:photo-2:packed');
    assert.match(sent.at(-1).text, /2 sticker\(s\) créé\(s\)/);
  } finally {
    delete require.cache[pluginPath];
    if (originalUtils) require.cache[utilsPath] = originalUtils;
    else delete require.cache[utilsPath];
    if (originalPack) require.cache[packPath] = originalPack;
    else delete require.cache[packPath];
  }
});
