'use strict';

const { createStickerFromMedia } = require('../../lib/s-utils');
const { addStickerPackMetadata, createStickerPackId } = require('../../lib/sticker-pack');
const { getImageMessage, albumAssociation, unwrapMessage } = require('../../services/media-album-store');

const DEFAULT_AUTHOR = 'Kᴀɪᴅᴏ ᴍD';
const MAX_ALBUM_IMAGES = 30;

function parsePackDetails(args = []) {
  const raw = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
  const [namePart = '', ...authorParts] = raw.split('|');
  return {
    packname: namePart.trim() || 'KAIDO-MD',
    author: authorParts.join('|').trim() || DEFAULT_AUTHOR
  };
}

async function readMediaBuffer(downloadContentFromMessage, imageMessage) {
  const stream = await downloadContentFromMessage(imageMessage, 'image');
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function quotedRecord(msg, from) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo
    || {};
  if (!contextInfo.quotedMessage) return null;
  return {
    key: {
      remoteJid: from,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant
    },
    message: contextInfo.quotedMessage
  };
}

module.exports = {
  name: 'spack',
  alias: ['stickerpack'],
  category: 'tools',
  description: 'Convertit un album WhatsApp en stickers avec le même nom de pack et auteur',
  usage: '.spack nom | auteur by Kᴀɪᴅᴏ ᴍD (en répondant au message album)',
  parsePackDetails,
  async execute({ socket, msg, from, args, downloadContentFromMessage, getAlbumImages }) {
    const targetRecord = quotedRecord(msg, from);
    const currentImage = getImageMessage(msg);
    const record = targetRecord || (currentImage ? msg : null);
    const targetMessage = targetRecord?.message || (currentImage ? msg.message : null);
    const targetContent = unwrapMessage(targetMessage);
    const targetImage = getImageMessage(targetMessage);
    const isAlbumMessage = Boolean(targetContent.albumMessage);
    const parentMessageId = isAlbumMessage
      ? targetRecord?.key?.id
      : albumAssociation(record)?.id;

    if (!targetImage && !isAlbumMessage) {
      await socket.sendMessage(from, {
        text: '❌ Réponds directement au message album (pas à une photo séparée) avec `.spack nom | auteur by Kᴀɪᴅᴏ ᴍD`.'
      }, { quoted: msg });
      return true;
    }

    const details = parsePackDetails(args);
    let images = [];
    let expectedImageCount = Number(targetContent.albumMessage?.expectedImageCount) || 0;
    if (parentMessageId && typeof getAlbumImages === 'function') {
      const stored = getAlbumImages(from, parentMessageId, targetRecord || record);
      if (stored && Array.isArray(stored.messages)) images = stored.messages;
      expectedImageCount = Math.max(expectedImageCount, Number(stored?.expectedImageCount) || 0);
    } else if (targetImage && record) {
      images = [record];
    }
    images = images.filter(item => getImageMessage(item)).slice(0, MAX_ALBUM_IMAGES);
    if (!images.length) {
      const text = isAlbumMessage
        ? '❌ J’ai bien détecté le message album, mais ses photos ne sont pas disponibles dans le cache de cette session. Réessaie juste après la réception complète de l’album.'
        : '❌ Aucune photo exploitable trouvée dans cet album.';
      await socket.sendMessage(from, { text }, { quoted: msg });
      return true;
    }

    const download = downloadContentFromMessage || require('@whiskeysockets/baileys').downloadContentFromMessage;
    await socket.sendMessage(from, {
      text: `⏳ Conversion de ${images.length} photo(s) en stickers…\n📦 ${details.packname}\n✍️ ${details.author}`
    }, { quoted: msg });

    let sent = 0;
    const failures = [];
    // Un même identifiant EXIF fait appartenir chaque sticker au même pack WhatsApp.
    const packId = createStickerPackId();
    for (const item of images) {
      const media = getImageMessage(item);
      try {
        const buffer = await readMediaBuffer(download, media);
        const sticker = await createStickerFromMedia({
          buffer,
          mime: media.mimetype || 'image/jpeg',
          fileName: media.fileName
        });
        const packedSticker = await addStickerPackMetadata(sticker.buffer, {
          packname: details.packname,
          author: details.author,
          packId
        });
        await socket.sendMessage(from, {
          sticker: packedSticker,
          mimetype: 'image/webp'
        }, { quoted: msg });
        sent += 1;
      } catch (error) {
        failures.push(error?.message || 'conversion impossible');
        console.error('[SPACK ERROR]', item.key?.id || 'message inconnue', error);
      }
    }

    const partialAlbum = expectedImageCount > images.length
      ? `\n⚠️ L’album annonce ${expectedImageCount} photo(s), mais seules ${images.length} sont encore disponibles en mémoire. Réessaie en répondant à l’album juste après sa réception.`
      : '';
    const result = sent === images.length
      ? `✅ ${sent} sticker(s) créé(s) avec le pack *${details.packname}*.`
      : `⚠️ ${sent}/${images.length} sticker(s) créé(s). ${failures.length} photo(s) n’ont pas pu être converties.`;
    await socket.sendMessage(from, { text: `${result}${partialAlbum}` }, { quoted: msg });
    return true;
  }
};
