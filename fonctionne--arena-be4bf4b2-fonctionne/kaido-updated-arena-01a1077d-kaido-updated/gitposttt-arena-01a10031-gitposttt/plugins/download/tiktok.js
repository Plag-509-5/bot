const axios = require('axios');

async function downloadTikTok(url) {
  // Option 1 : Tikwm API
  try {
    const res = await axios.post('https://www.tikwm.com/api/', { url }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      timeout: 15000
    });
    if (res.data?.data) {
      const d = res.data.data;
      return {
        title: d.title || 'TikTok Video',
        author: d.author?.nickname || 'Inconnu',
        videoUrl: d.play || d.wmplay,
        audioUrl: d.music,
        cover: d.cover
      };
    }
  } catch (e) {}

  // Option 2 : Fallback API
  try {
    const res = await axios.get(`https://api.giftedtech.web.id/api/download/tiktok?apikey=gifted&url=${encodeURIComponent(url)}`, { timeout: 15000 });
    if (res.data?.result) {
      const d = res.data.result;
      return {
        title: d.title || 'TikTok Video',
        author: d.author || 'Inconnu',
        videoUrl: d.video || d.hdvideo || d.nowm,
        audioUrl: d.audio,
        cover: d.thumbnail
      };
    }
  } catch (e) {}

  throw new Error('Impossible de récupérer la vidéo TikTok. Vérifiez l\'URL.');
}

module.exports = {
  name: 'tiktok',
  alias: ['tt', 'ttdl', 'tiktokdl'],
  category: 'download',
  description: 'Télécharge une vidéo TikTok sans filigrane (No Watermark)',
  usage: '.tiktok <lien TikTok>',
  async execute({ socket, msg, from, args, prefix }) {
    const url = args[0];
    if (!url || (!url.includes('tiktok.com') && !url.includes('vt.tiktok.com'))) {
      return await socket.sendMessage(from, {
        text: `📱 *Usage :* \`${prefix}tiktok https://vt.tiktok.com/...\``
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { text: '⏳ *Téléchargement de la vidéo TikTok...*' }, { quoted: msg });

    try {
      const data = await downloadTikTok(url);

      const caption = `╭───「 📱 *TIKTOK DOWNLOAD* 」───
│ 📌 *Description :* ${data.title}
│ 👤 *Créateur :* ${data.author}
╰─────────────────────────☉
> 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐛𝐲 𝐊𝐚𝐢𝐝𝐨-𝐌𝐃`;

      await socket.sendMessage(from, {
        video: { url: data.videoUrl },
        caption
      }, { quoted: msg });

    } catch (err) {
      console.error('[TIKTOK ERROR]', err);
      await socket.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
    }
  }
};
