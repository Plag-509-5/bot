const axios = require('axios');

module.exports = {
  name: 'lyrics',
  alias: ['lyric', 'paroles', 'songlyrics'],
  category: 'tools',
  description: "Recherche les paroles d'une chanson",
  usage: '.lyrics <artiste - titre>',
  async execute({ socket, msg, from, args, prefix }) {
    const query = args.join(' ').trim();
    if (!query) return socket.sendMessage(from, { text: `🎵 Usage : ${prefix}lyrics <artiste - titre>` }, { quoted: msg });
    try {
      await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
      const { data } = await axios.get('https://lrclib.net/api/search', { params: { q: query }, timeout: 15000 });
      const song = data?.find(x => x.plainLyrics || x.syncedLyrics);
      if (!song) throw new Error('Paroles introuvables pour cette recherche');
      const lyrics = (song.plainLyrics || song.syncedLyrics.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*/g, '')).trim();
      const max = 5500;
      const text = `🎵 *${song.trackName || query}*\n👤 ${song.artistName || ''}${song.albumName ? `\n💿 ${song.albumName}` : ''}\n\n${lyrics}`;
      await socket.sendMessage(from, { text: text.length > max ? `${text.slice(0, max)}\n\n… paroles tronquées.` : text }, { quoted: msg });
    } catch (err) {
      console.error('[LYRICS ERROR]', err);
      await socket.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
    }
  }
};
