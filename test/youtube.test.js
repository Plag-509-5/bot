'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const youtube = require('../src/lib/youtube');
const youtubePlugin = require('../src/plugins/download/youtube');

const metadata = {
  url: 'https://youtu.be/dQw4w9WgXcQ',
  title: 'Test video',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
};

test('ytmp4 normalise les anciens champs lien/titre vers downloadUrl/title', () => {
  const result = youtube._test.normaliserResultat({
    lien: 'https://cdn.example/video.mp4',
    titre: 'Ancien format',
    miniature: 'https://cdn.example/thumb.jpg'
  });
  assert.equal(result.downloadUrl, 'https://cdn.example/video.mp4');
  assert.equal(result.title, 'Ancien format');
  assert.equal(result.thumbnail, 'https://cdn.example/thumb.jpg');
});

test('une URL absente produit une erreur claire au lieu de undefined.toString', () => {
  assert.throws(
    () => youtube._test.normaliserResultat({ title: 'sans lien' }),
    /aucun lien valide/i
  );
  assert.throws(
    () => youtubePlugin._test.normaliseLegacyDownload({}, metadata),
    /aucun lien de téléchargement valide/i
  );
});

test('playvideo accepte la forme historique retournée par ytmp4', async () => {
  const result = await youtubePlugin._test.downloadYoutubeVideo(metadata, {
    ytmp4: async () => ({ lien: 'https://cdn.example/video.mp4', titre: 'Vidéo prête' }),
    requestCobalt: async () => { throw new Error('ne doit pas être appelé'); }
  });
  assert.deepEqual(result, {
    url: 'https://cdn.example/video.mp4',
    title: 'Vidéo prête',
    thumbnail: metadata.thumbnail
  });
});

test('playvideo bascule sur Cobalt si le premier convertisseur échoue', async () => {
  const result = await youtubePlugin._test.downloadYoutubeVideo(metadata, {
    ytmp4: async () => { throw new Error('convertisseur indisponible'); },
    requestCobalt: async () => ({
      title: 'Secours Cobalt',
      media: [{ type: 'video', url: 'https://cdn.example/fallback.mp4' }]
    })
  });
  assert.equal(result.url, 'https://cdn.example/fallback.mp4');
  assert.equal(result.title, 'Secours Cobalt');
});

test('la commande playvideo envoie toujours une URL chaîne valide à Baileys', async () => {
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return {};
    }
  };

  await youtubePlugin.execute({
    socket,
    msg: { key: { id: 'message-1', remoteJid: 'chat@s.whatsapp.net' } },
    from: 'chat@s.whatsapp.net',
    args: [metadata.url],
    prefix: '.',
    command: 'playvideo',
    dependencies: {
      yts: async () => ({ title: metadata.title, thumbnail: metadata.thumbnail }),
      ytmp4: async () => ({ lien: 'https://cdn.example/command-video.mp4', titre: metadata.title })
    }
  });

  const videoMessage = sent.find((entry) => entry.content.video);
  assert.ok(videoMessage);
  assert.equal(typeof videoMessage.content.video.url, 'string');
  assert.equal(videoMessage.content.video.url, 'https://cdn.example/command-video.mp4');
  assert.equal(sent.at(-1).content.react.text, '✅');
});

test('extrait les identifiants des principaux formats YouTube', () => {
  assert.equal(youtubePlugin._test.extractYoutubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubePlugin._test.extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubePlugin._test.extractYoutubeId('https://example.com/video'), null);
});
