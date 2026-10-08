const axios = require('axios');

module.exports = {
  name: 'ssweb',
  alias: ['ss', 'screenshot', 'capture'],
  category: 'tools',
  description: 'Prend une capture d\'écran d\'un site web',
  usage: '.ssweb <url>',
  async execute({ socket, msg, from, args }) {
    let url = args[0];
    if (!url) {
      return await socket.sendMessage(from, { text: '📝 *Usage :* `.ssweb https://google.com`' }, { quoted: msg });
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    await socket.sendMessage(from, { text: '📸 *Capture en cours... Veuillez patienter.*' }, { quoted: msg });

    try {
      const ssUrl = `https://image.thum.io/get/width/1280/crop/800/noanimate/${url}`;
      await socket.sendMessage(from, {
        image: { url: ssUrl },
        caption: `🌐 *Capture d'écran de :* ${url}`
      }, { quoted: msg });
    } catch (err) {
      console.error('[SSWEB ERROR]', err);
      await socket.sendMessage(from, { text: `❌ Impossible de capturer le site : ${err.message}` }, { quoted: msg });
    }
  }
};
