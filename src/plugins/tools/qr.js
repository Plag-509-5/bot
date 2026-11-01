'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qr = require('../../services/qr-code');

function unwrapImage(message) {
  let current = message || {};
  for (let depth = 0; depth < 6; depth += 1) {
    if (current.imageMessage) return current.imageMessage;
    const wrapper = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']
      .find(name => current[name]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

module.exports = {
  name: 'qr',
  alias: ['qrcode'],
  category: 'tools',
  description: 'Crée un QR localement ou lit le QR d’une image citée',
  usage: '.qr <texte ou URL> | réponds à une image avec .qr read',
  async execute(context) {
    const { socket, msg, from, args = [], prefix = '.' } = context;
    const commandText = args.join(' ').trim();
    if (!commandText || ['help', 'aide'].includes(commandText.toLowerCase())) {
      return socket.sendMessage(from, {
        text: `🔳 *KAIDO QR*\n${prefix}qr <texte ou URL> — créer un QR\nRéponds à une image avec ${prefix}qr read — décoder un QR`
      }, { quoted: msg });
    }

    if (['read', 'lire', 'decode', 'décoder', 'decoder'].includes(commandText.toLowerCase())) {
      const quoted = context.quotedMsg || context.quoted || msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const imageMessage = unwrapImage(quoted) || unwrapImage(msg?.message);
      if (!imageMessage) {
        return socket.sendMessage(from, { text: `❌ Réponds à une image contenant un QR avec ${prefix}qr read.` }, { quoted: msg });
      }
      try {
        const downloader = context.downloadContentFromMessage || downloadContentFromMessage;
        const buffer = await streamToBuffer(await downloader(imageMessage, 'image'));
        const result = await qr.readQr(buffer);
        return socket.sendMessage(from, { text: `🔳 *KAIDO QR — CONTENU*\n\n${result}` }, { quoted: msg });
      } catch (error) {
        return socket.sendMessage(from, { text: `❌ Lecture du QR impossible : ${error.message || error}` }, { quoted: msg });
      }
    }

    try {
      const image = await qr.createQr(commandText);
      return socket.sendMessage(from, {
        image,
        mimetype: 'image/png',
        caption: `🔳 *KAIDO QR*\nContenu : ${commandText.slice(0, 500)}`
      }, { quoted: msg });
    } catch (error) {
      return socket.sendMessage(from, { text: `❌ Création du QR impossible : ${error.message || error}` }, { quoted: msg });
    }
  },
  _test: { unwrapImage, streamToBuffer, qr }
};
