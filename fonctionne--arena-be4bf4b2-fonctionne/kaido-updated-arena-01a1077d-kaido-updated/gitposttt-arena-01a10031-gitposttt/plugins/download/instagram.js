'use strict';

const { downloadInstagram, isHttpUrl } = require('../../services/media-api');

module.exports = {
  name: 'instagram',
  alias: ['ig', 'reels', 'insta', 'igdl'],
  category: 'download',
  description: 'Télécharge une vidéo, un reel ou un carrousel Instagram public',
  usage: '.ig <lien Instagram>',
  async execute({ socket, msg, from, args, prefix }) {
    const url = args[0]?.trim();
    if (!isHttpUrl(url) || !/(^|\.)instagram\.com$/i.test(new URL(url).hostname)) {
      return socket.sendMessage(from, {
        text: `📸 *Usage :* \`${prefix}ig https://www.instagram.com/reel/...\``
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { react: { text: '⏳', key: msg.key } });
    try {
      const result = await downloadInstagram(url);
      const media = (result.media || []).filter((item) => isHttpUrl(item.url)).slice(0, 8);
      if (!media.length) throw new Error('Aucun média exploitable trouvé dans cette publication.');

      let sent = 0;
      for (const item of media) {
        if (item.type === 'image') {
          await socket.sendMessage(from, {
            image: { url: item.url },
            caption: `📸 *Instagram Photo* — KAIDO-MD\n${result.title || ''}`.trim()
          }, { quoted: msg });
        } else if (item.type === 'audio') {
          await socket.sendMessage(from, {
            audio: { url: item.url },
            mimetype: 'audio/mpeg'
          }, { quoted: msg });
        } else {
          await socket.sendMessage(from, {
            video: { url: item.url },
            mimetype: 'video/mp4',
            caption: `📸 *Instagram Reel/Vidéo* — KAIDO-MD\n${result.title || ''}`.trim()
          }, { quoted: msg });
        }
        sent += 1;
      }

      await socket.sendMessage(from, { react: { text: sent ? '✅' : '❌', key: msg.key } });
    } catch (error) {
      console.error('[INSTAGRAM ERROR]', error.message || error);
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await socket.sendMessage(from, {
        text: `❌ Téléchargement Instagram impossible : ${error.message || error}\n_Vérifie que la publication est publique._`
      }, { quoted: msg });
    }
  }
};
