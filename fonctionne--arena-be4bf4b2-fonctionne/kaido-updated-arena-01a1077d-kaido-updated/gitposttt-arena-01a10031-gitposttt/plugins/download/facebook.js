'use strict';

const { downloadFacebook, isHttpUrl } = require('../../services/media-api');

module.exports = {
  name: 'facebook',
  alias: ['fb', 'fbdl', 'fbvideo'],
  category: 'download',
  description: 'Télécharge une vidéo ou un Reel Facebook public',
  usage: '.fb <lien Facebook>',
  async execute({ socket, msg, from, args, prefix }) {
    const url = args.join(' ').trim();
    let valid = false;
    try {
      valid = isHttpUrl(url) && /(^|\.)(facebook\.com|fb\.watch)$/i.test(new URL(url).hostname);
    } catch (_) {}
    if (!valid) {
      return socket.sendMessage(from, {
        text: `👥 Usage : ${prefix}fb https://www.facebook.com/reel/...`
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { react: { text: '⏳', key: msg.key } });
    try {
      const result = await downloadFacebook(url);
      const video = result.media?.find((item) => item.type === 'video') || result.media?.[0];
      if (!isHttpUrl(video?.url)) throw new Error('Aucun lien vidéo valide reçu.');

      await socket.sendMessage(from, {
        video: { url: video.url },
        mimetype: 'video/mp4',
        caption: `👥 *Facebook Video* — KAIDO-MD\n📌 ${result.title || 'Facebook Video'}`
      }, { quoted: msg });
      await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[FACEBOOK ERROR]', error.message || error);
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await socket.sendMessage(from, {
        text: `❌ Téléchargement Facebook impossible : ${error.message || error}\n_Vérifie que la vidéo est publique._`
      }, { quoted: msg });
    }
  }
};
