'use strict';

const webp = require('node-webpmux');
const crypto = require('crypto');

const EXIF_HEADER = Buffer.from([
  0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x16, 0x00, 0x00, 0x00
]);

function createStickerPackId() {
  return crypto.randomBytes(16).toString('hex');
}

async function addStickerPackMetadata(stickerBuffer, { packname, author, packId = createStickerPackId(), emojis = [''] } = {}) {
  if (!Buffer.isBuffer(stickerBuffer) || stickerBuffer.length === 0) {
    throw new TypeError('Le buffer du sticker est vide.');
  }
  const metadata = {
    'sticker-pack-id': packId,
    'sticker-pack-name': String(packname || 'KAIDO-MD'),
    'sticker-pack-publisher': String(author || 'Kᴀɪᴅᴏ ᴍD'),
    emojis
  };
  const json = Buffer.from(JSON.stringify(metadata), 'utf8');
  const exif = Buffer.concat([EXIF_HEADER, json]);
  exif.writeUIntLE(json.length, 14, 4);
  const image = new webp.Image();
  await image.load(stickerBuffer);
  image.exif = exif;
  return image.save(null);
}

module.exports = { addStickerPackMetadata, createStickerPackId };
