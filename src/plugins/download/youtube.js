'use strict';

const yts = require('yt-search');
const { ytmp3, ytmp4 } = require('../../lib/youtube');
const { requestCobalt, isHttpUrl } = require('../../services/media-api');

function extractYoutubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
      return url.searchParams.get('v')
        || url.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/)?.[1]
        || null;
    }
  } catch (_) {}
  return null;
}

async function resolveYoutube(query, search = yts) {
  const direct = isHttpUrl(query);
  if (direct) {
    const id = extractYoutubeId(query);
    if (!id) throw new Error('Lien YouTube invalide.');
    const details = await search({ videoId: id }).catch(() => null);
    return {
      url: query,
      title: details?.title || 'YouTube Media',
      duration: details?.timestamp || 'N/A',
      views: details?.views || 'N/A',
      author: details?.author?.name || 'Inconnu',
      thumbnail: details?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    };
  }

  const result = await search(query);
  const video = result?.videos?.[0];
  if (!video?.url) throw new Error('Aucun résultat trouvé sur YouTube.');
  return {
    url: video.url,
    title: video.title || 'YouTube Media',
    duration: video.timestamp || 'N/A',
    views: video.views || 'N/A',
    author: video.author?.name || 'Inconnu',
    thumbnail: video.thumbnail || null
  };
}

function normaliseLegacyDownload(raw, metadata) {
  const url = raw?.downloadUrl || raw?.lien || raw?.url || raw?.download_url;
  if (!isHttpUrl(url)) throw new Error('Le convertisseur n’a retourné aucun lien de téléchargement valide.');
  return {
    url,
    title: raw?.title || raw?.titre || metadata.title,
    thumbnail: raw?.thumbnail || raw?.miniature || metadata.thumbnail
  };
}

async function downloadYoutubeVideo(metadata, dependencies = {}) {
  const converter = dependencies.ytmp4 || ytmp4;
  try {
    return normaliseLegacyDownload(await converter(metadata.url, '720'), metadata);
  } catch (legacyError) {
    const cobalt = dependencies.requestCobalt || requestCobalt;
    try {
      const result = await cobalt(metadata.url, {
        downloadMode: 'auto',
        videoQuality: '720',
        fallbackType: 'video'
      });
      const video = result.media?.find((item) => item.type === 'video') || result.media?.[0];
      if (!isHttpUrl(video?.url)) throw new Error('aucun lien vidéo');
      return { url: video.url, title: result.title || metadata.title, thumbnail: metadata.thumbnail };
    } catch (fallbackError) {
      throw new Error(`Conversion vidéo impossible (${legacyError.message}; secours: ${fallbackError.message}).`);
    }
  }
}

async function downloadYoutubeAudio(metadata, dependencies = {}) {
  const converter = dependencies.ytmp3 || ytmp3;
  return normaliseLegacyDownload(await converter(metadata.url), metadata);
}

module.exports = {
  name: 'play',
  alias: ['song', 'ytmp3', 'music', 'audio', 'playaudio', 'playptt', 'playvideo', 'ytmp4', 'video'],
  category: 'download',
  description: 'Recherche et télécharge un audio ou une vidéo YouTube',
  usage: '.play <titre/lien> ou .playvideo <titre/lien>',
  async execute({ socket, msg, from, args, prefix, command, dependencies = {} }) {
    const query = args.join(' ').trim();
    if (!query) {
      return socket.sendMessage(from, {
        text: `🎵 *Usage :* \`${prefix}${command} Céline Dion Titanic\` ou \`${prefix}${command} https://youtu.be/...\``
      }, { quoted: msg });
    }

    const wantsVideo = ['playvideo', 'ytmp4', 'video'].includes(command);
    const wantsPtt = command === 'playptt';
    await socket.sendMessage(from, { react: { text: '⏳', key: msg.key } });

    try {
      const metadata = await resolveYoutube(query, dependencies.yts || yts);
      const data = wantsVideo
        ? await downloadYoutubeVideo(metadata, dependencies)
        : await downloadYoutubeAudio(metadata, dependencies);

      if (wantsVideo) {
        await socket.sendMessage(from, {
          video: { url: data.url },
          mimetype: 'video/mp4',
          caption: `🎬 *${data.title}*\n📺 Qualité : jusqu’à 720p\n🔗 ${metadata.url}`
        }, { quoted: msg });
      } else {
        await socket.sendMessage(from, {
          audio: { url: data.url },
          mimetype: 'audio/mpeg',
          ptt: wantsPtt,
          fileName: `${data.title}.mp3`
        }, { quoted: msg });
      }

      await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[YOUTUBE DOWNLOAD ERROR]', error.message || error);
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await socket.sendMessage(from, {
        text: `❌ Téléchargement YouTube impossible : ${error.message || error}`
      }, { quoted: msg });
    }
  },
  _test: {
    extractYoutubeId,
    resolveYoutube,
    normaliseLegacyDownload,
    downloadYoutubeVideo,
    downloadYoutubeAudio
  }
};
