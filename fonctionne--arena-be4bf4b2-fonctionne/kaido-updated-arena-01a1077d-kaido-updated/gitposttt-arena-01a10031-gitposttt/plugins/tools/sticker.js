const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { createStickerFromMedia } = require('../../s-utils');

module.exports = {
  name: 'sticker',
  alias: ['s', 'stiker', 'autocollant'],
  category: 'tools',
  description: 'Convertit une image ou vidéo en sticker WhatsApp',
  usage: '.sticker [nom_du_pack|auteur]',
  async execute({ socket, msg, from, args }) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted || msg.message;

    const isImage = targetMsg.imageMessage || targetMsg.viewOnceMessage?.message?.imageMessage || targetMsg.viewOnceMessageV2?.message?.imageMessage;
    const isVideo = targetMsg.videoMessage || targetMsg.viewOnceMessage?.message?.videoMessage || targetMsg.viewOnceMessageV2?.message?.videoMessage;

    if (!isImage && !isVideo) {
      return await socket.sendMessage(from, {
        text: '❌ *Veuillez envoyer ou répondre à une image ou une courte vidéo (<10s) avec .s*'
      }, { quoted: msg });
    }

    const packname = args.join(' ') || 'KAIDO-MD';
    const author = 'Mugiwara no plag';

    await socket.sendMessage(from, { text: '⏳ *Création du sticker en cours...*' }, { quoted: msg });

    try {
      let type = isImage ? 'image' : 'video';
      let mediaObj = isImage || isVideo;
      const stream = await downloadContentFromMessage(mediaObj, type);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

      const sticker = await createStickerFromMedia({
        buffer,
        mime: mediaObj.mimetype || (isImage ? 'image/jpeg' : 'video/mp4')
      }, author, packname);

      await socket.sendMessage(from, { sticker: sticker.buffer }, { quoted: msg });
    } catch (err) {
      console.error('[STICKER ERROR]', err);
      await socket.sendMessage(from, { text: `❌ Impossible de créer le sticker : ${err.message}` }, { quoted: msg });
    }
  }
};
