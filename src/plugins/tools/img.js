'use strict';

const { searchImages } = require('../../services/image-search');

module.exports = {
  name: 'img',
  alias: ['image', 'images', 'image-search'],
  category: 'tools',
  description: 'Recherche des images pertinentes via Pexels/Openverse',
  usage: '.img <recherche>',
  async execute({ socket, msg, from, args, prefix }) {
    const query = args.join(' ').trim();
    if (!query) {
      return socket.sendMessage(from, {
        text: `🔎 Usage : ${prefix}img <mot-clé>\nExemple : ${prefix}img paysages d'Haïti`
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { react: { text: '🔎', key: msg.key } });
    try {
      const images = await searchImages(query, 4);
      if (!images.length) throw new Error('Aucune image compatible trouvée.');

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const credits = [
          `🖼️ *${query}* (${index + 1}/${images.length})`,
          `📄 ${image.title}`,
          `🔎 Source : ${image.provider || 'Openverse'}`,
          image.creator ? `📷 ${image.creator}` : null,
          image.license ? `📜 ${image.license}` : null,
          image.sourceUrl ? `🔗 ${image.sourceUrl}` : null,
          image.attribution ? `ℹ️ ${String(image.attribution).slice(0, 500)}` : null
        ].filter(Boolean).join('\n');
        await socket.sendMessage(from, {
          image: { url: image.url },
          caption: credits
        }, { quoted: msg });
      }
      await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[IMG ERROR]', error.message || error);
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await socket.sendMessage(from, {
        text: `❌ Recherche d’images impossible : ${error.message || error}`
      }, { quoted: msg });
    }
  }
};
