'use strict';

const axios = require('axios');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const TGS = require('tgs-to');
const crypto = require('crypto');
const webp = require('node-webpmux');
const { createStickerFromMedia, sendSticker } = require('../../s-utils');
const { getTelegramStickerEntries } = require('../../services/telegram-stickers');

async function addExif(buffer, pack, author) {
  const img = new webp.Image();
  const metadata = {
    'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    emojis: ['✨']
  };
  const header = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
  const data = Buffer.from(JSON.stringify(metadata));
  const exif = Buffer.concat([header, data]);
  exif.writeUIntLE(data.length, 14, 4);
  await img.load(buffer);
  img.exif = exif;
  return img.save(null);
}

function parseInput(args) {
  const parts = args.join(' ').trim().split('|').map((part) => part.trim());
  return {
    link: parts[0],
    author: (parts[1] || 'KAIDO-MD').slice(0, 40),
    pack: parts[2] ? parts[2].slice(0, 40) : null
  };
}

async function downloadStickerFile(entry, token, http = axios) {
  try {
    const response = await http.get(entry.url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 12 * 1024 * 1024,
      maxBodyLength: 12 * 1024 * 1024
    });
    return Buffer.from(response.data);
  } catch (error) {
    const reason = String(error.response?.status || error.message || 'téléchargement impossible');
    throw new Error(token ? reason.replace(String(token), '[TOKEN]') : reason);
  }
}

async function convertToWhatsAppSticker(entry, source, work, index) {
  const extension = String(entry.extension || 'tgs').toLowerCase();
  if (extension === 'tgs') {
    const input = path.join(work, `${index}.tgs`);
    const output = path.join(work, `${index}.webp`);
    await fs.writeFile(input, source);
    await new TGS(input).convertToWebp(output);
    return fs.readFile(output);
  }

  if (extension === 'webp') return source;

  const mime = extension === 'webm' ? 'video/webm'
    : extension === 'mp4' ? 'video/mp4'
      : extension === 'png' ? 'image/png'
        : 'image/jpeg';
  const result = await createStickerFromMedia({
    buffer: source,
    mime,
    fileName: `telegram-sticker.${extension}`
  });
  return result.buffer;
}

module.exports = {
  name: 'tgs',
  alias: ['telegramsticker', 'tgsticker'],
  category: 'tools',
  description: 'Importe un pack Telegram en stickers WhatsApp (TGS, WebP ou WebM)',
  usage: '.tgs <lien_pack> | auteur | nom_du_pack',
  async execute({ socket, msg, from, args }) {
    if (!args.length) {
      return socket.sendMessage(from, {
        text: '📦 Usage : .tgs https://t.me/addstickers/NomDuPack | Auteur | Nom du pack'
      }, { quoted: msg });
    }

    const input = parseInput(args);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'kaido-tgs-'));
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    try {
      await socket.sendMessage(from, { text: '⏳ Lecture du pack Telegram...' }, { quoted: msg });
      const stickerSet = await getTelegramStickerEntries(input.link, { token, limit: 30 });
      const pack = input.pack || String(stickerSet.title || 'Telegram Pack').slice(0, 40);
      const entries = stickerSet.entries || [];

      let sent = 0;
      let failed = 0;
      for (let index = 0; index < entries.length; index += 1) {
        try {
          const source = await downloadStickerFile(entries[index], token);
          const sticker = await convertToWhatsAppSticker(entries[index], source, work, index);
          const finalSticker = await addExif(sticker, pack, input.author).catch(() => sticker);
          await sendSticker(socket, from, finalSticker, msg);
          sent += 1;
        } catch (error) {
          failed += 1;
          console.warn(`[TGS] sticker ${index + 1} ignoré:`, error.message || error);
        }
      }

      if (!sent) {
        throw new Error('Aucun sticker n’a pu être converti. Vérifie que FFmpeg est disponible sur le serveur.');
      }
      await socket.sendMessage(from, {
        text: `✅ ${sent}/${entries.length} sticker(s) envoyé(s)${failed ? ` (${failed} ignoré(s))` : ''}\n👤 Auteur : ${input.author}\n📦 Pack : ${pack}`
      }, { quoted: msg });
    } catch (error) {
      console.error('[TGS ERROR]', error.message || error);
      await socket.sendMessage(from, { text: `❌ ${error.message || error}` }, { quoted: msg });
    } finally {
      await fs.remove(work).catch(() => {});
    }
  },
  _test: { parseInput, downloadStickerFile, convertToWhatsAppSticker, addExif }
};
