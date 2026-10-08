'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { uploadBuffer, MAX_UPLOAD_BYTES, safeFilename } = require('../../services/file-upload');

const MEDIA_TYPES = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker']
];

function unwrapMessage(message) {
  let current = message || {};
  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage'
  ];
  for (let depth = 0; depth < 8; depth += 1) {
    const wrapper = wrappers.find(key => current?.[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current || {};
}

function findMedia(message) {
  const content = unwrapMessage(message);
  for (const [key, type] of MEDIA_TYPES) {
    if (content[key]) return { node: content[key], type, key };
  }
  return null;
}

function contextQuotedMessage(msg) {
  const message = msg?.message || {};
  for (const value of Object.values(message)) {
    const quoted = value?.contextInfo?.quotedMessage;
    if (quoted) return quoted;
  }
  return msg?.quoted?.msg || null;
}

function extensionFromMedia(media) {
  const original = String(media.node.fileName || '').split('.').pop();
  if (original && original !== media.node.fileName && /^[a-z0-9]{1,10}$/i.test(original)) return original.toLowerCase();
  const mime = String(media.node.mimetype || '').split(';')[0].toLowerCase();
  const known = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf'
  };
  return known[mime] || mime.split('/')[1] || (media.type === 'sticker' ? 'webp' : 'bin');
}

async function streamToBuffer(stream, maxBytes = MAX_UPLOAD_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) throw new Error(`Fichier trop volumineux. Limite : ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
    chunks.push(data);
  }
  if (!size) throw new Error('Le média téléchargé est vide.');
  return Buffer.concat(chunks);
}

module.exports = {
  name: 'tourl',
  alias: ['tolink', 'upload', 'url'],
  category: 'tools',
  description: 'Convertit une image, vidéo, audio, sticker ou document en lien direct',
  usage: '.tourl (en répondant à un média)',
  async execute(context) {
    const { socket, msg, from } = context;
    const quoted = context.quoted || context.quotedMsg || contextQuotedMessage(msg);
    const media = findMedia(quoted || msg.message);

    if (!media) {
      return socket.sendMessage(from, {
        text: '❌ *Répondez à une image, vidéo, audio, sticker ou document avec .tourl*'
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { react: { text: '📤', key: msg.key } });
    try {
      const downloader = context.downloadContent || downloadContentFromMessage;
      const stream = await downloader(media.node, media.type);
      const buffer = await streamToBuffer(stream);
      const ext = extensionFromMedia(media);
      const filename = safeFilename(media.node.fileName || `kaido_${Date.now()}.${ext}`);
      const uploader = context.uploadMedia || uploadBuffer;
      const result = await uploader(buffer, {
        filename,
        mimetype: media.node.mimetype || 'application/octet-stream'
      });
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
      const previousFailures = result.failures?.length
        ? `\n│ 🔁 *Fallback :* ${result.failures.map(item => item.provider).join(', ')}`
        : '';

      const reply = `╭───「 📤 *UPLOAD RÉUSSI* 」───\n` +
        `│ 🔗 *Lien :* ${result.url}\n` +
        `│ ☁️ *Hébergeur :* ${result.provider}\n` +
        `│ 📁 *Taille :* ${sizeMB} MB\n` +
        `│ 📋 *Type :* ${media.node.mimetype || media.type}` +
        `${previousFailures}\n` +
        `╰─────────────────────────☉`;

      await socket.sendMessage(from, { text: reply }, { quoted: msg });
      await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[TOURL ERROR]', error);
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await socket.sendMessage(from, {
        text: `❌ Échec du téléversement : ${error.message || error}`
      }, { quoted: msg });
    }
  },
  _test: {
    unwrapMessage,
    findMedia,
    contextQuotedMessage,
    extensionFromMedia,
    streamToBuffer
  }
};
