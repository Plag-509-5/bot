'use strict';

const { getLyrics } = require('../../services/lyrics-api');

const MAX_LYRICS_MESSAGE_LENGTH = 5500;

function formatLyricsMessage(song, query, maxLength = MAX_LYRICS_MESSAGE_LENGTH) {
  const metadata = [
    `🎵 *${song.title || query}*`,
    song.artist ? `👤 ${song.artist}` : '',
    song.album ? `💿 ${song.album}` : '',
    song.source ? `🔎 Source : ${song.source}` : ''
  ].filter(Boolean).join('\n');
  const text = `${metadata}\n\n${song.lyrics}`.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n… paroles tronquées.` : text;
}

module.exports = {
  name: 'lyrics',
  alias: ['lyric', 'paroles', 'songlyrics'],
  category: 'tools',
  description: "Recherche les paroles d'une chanson avec cinq API de secours",
  usage: '.lyrics <artiste - titre>',
  async execute({ socket, msg, from, args, prefix, dependencies = {} }) {
    const query = args.join(' ').trim();
    if (!query) {
      return socket.sendMessage(from, {
        text: `🎵 Usage : ${prefix}lyrics <artiste - titre>`
      }, { quoted: msg });
    }

    try {
      await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
      const lookup = dependencies.getLyrics || getLyrics;
      const song = await lookup(query, dependencies.lyricsApiOptions || {});
      const text = formatLyricsMessage(song, query);
      await socket.sendMessage(from, { text }, { quoted: msg });
    } catch (error) {
      console.error('[LYRICS ERROR]', error?.message || error);
      const details = String(error?.message || error).slice(0, 1400);
      await socket.sendMessage(from, {
        text: `❌ Paroles indisponibles. ${details}`
      }, { quoted: msg });
    }
  },
  _test: { formatLyricsMessage, MAX_LYRICS_MESSAGE_LENGTH }
};
