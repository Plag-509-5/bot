'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lyricsPlugin = require('../src/plugins/tools/lyrics');
const lyricsApi = require('../src/services/lyrics-api');

function fakeHttp(handlers) {
  const calls = [];
  return {
    calls,
    http: {
      async get(url, options = {}) {
        calls.push({ url, options });
        const handler = handlers.find(item => item.match(url));
        if (!handler) throw new Error(`unexpected request: ${url}`);
        if (handler.error) throw handler.error;
        return { data: handler.data };
      }
    }
  };
}

test('sépare artiste et titre en conservant les requêtes sans séparateur', () => {
  assert.deepEqual(lyricsApi.splitArtistTitle('Adele - Hello'), { artist: 'Adele', title: 'Hello' });
  assert.deepEqual(lyricsApi.splitArtistTitle('AC/DC — Thunderstruck'), { artist: 'AC/DC', title: 'Thunderstruck' });
  assert.deepEqual(lyricsApi.splitArtistTitle('Bohemian Rhapsody'), { artist: '', title: 'Bohemian Rhapsody' });
});

test('nettoie les horodatages LRCLIB sans casser les lignes', () => {
  assert.equal(lyricsApi.cleanLyrics('[00:01.20]First line\r\n[01:02.345]Second line'), 'First line\nSecond line');
});

test('l’API principale LRCLIB fournit les paroles quand elle répond', async () => {
  const { http, calls } = fakeHttp([
    { match: url => url === 'https://lrclib.net/api/search', data: [{
      trackName: 'Hello', artistName: 'Adele', albumName: '25', plainLyrics: 'Hello, it is me.'
    }] }
  ]);

  const result = await lyricsApi.getLyrics('Adele - Hello', { http, env: {} });
  assert.equal(result.source, 'LRCLIB');
  assert.equal(result.artist, 'Adele');
  assert.equal(result.album, '25');
  assert.equal(calls.length, 1);
});

test('bascule sur Lyrics.ovh si LRCLIB échoue', async () => {
  const { http, calls } = fakeHttp([
    { match: url => url === 'https://lrclib.net/api/search', error: new Error('timeout primaire') },
    { match: url => url.includes('api.lyrics.ovh/v1/Adele/Hello'), data: { lyrics: 'Hello from fallback.' } }
  ]);

  const result = await lyricsApi.getLyrics('Adele - Hello', { http, env: {} });
  assert.equal(result.source, 'Lyrics.ovh');
  assert.equal(result.lyrics, 'Hello from fallback.');
  assert.equal(calls.length, 2);
});

test('la recherche sans artiste utilise les suggestions Lyrics.ovh puis son endpoint paroles', async () => {
  const { http, calls } = fakeHttp([
    { match: url => url === 'https://lrclib.net/api/search', error: new Error('indisponible') },
    { match: url => url.includes('/suggest/Hello'), data: { data: [{ title: 'Hello', artist: { name: 'Adele' } }] } },
    { match: url => url.includes('/v1/Adele/Hello'), data: { lyrics: 'Suggested lyrics.' } }
  ]);

  const result = await lyricsApi.getLyrics('Hello', { http, env: {} });
  assert.equal(result.source, 'Lyrics.ovh');
  assert.equal(result.artist, 'Adele');
  assert.equal(calls.length, 3);
});

test('bascule vers la troisième API JioSaavn et normalise son enveloppe JSON', async () => {
  const { http } = fakeHttp([
    { match: url => url === 'https://lrclib.net/api/search', error: new Error('down') },
    { match: url => url.includes('api.lyrics.ovh/v1'), error: new Error('down') },
    { match: url => url === 'https://jio.shnwaz.dev/api/lyrics', data: {
      success: true,
      data: { title: 'Naatu Naatu', primaryArtists: 'Rahul Sipligunj', lyrics: 'JioSaavn lyrics result.' }
    } }
  ]);

  const result = await lyricsApi.getLyrics('Naatu Naatu', { http, env: {} });
  assert.equal(result.source, 'JioSaavn');
  assert.equal(result.title, 'Naatu Naatu');
  assert.equal(result.artist, 'Rahul Sipligunj');
});

test('la quatrième API Musixmatch est appelée après échec des trois premières', async () => {
  const { http, calls } = fakeHttp([
    { match: url => url === 'https://lrclib.net/api/search', error: new Error('down') },
    { match: url => url.includes('api.lyrics.ovh/v1'), error: new Error('down') },
    { match: url => url === 'https://jio.shnwaz.dev/api/lyrics', error: new Error('down') },
    { match: url => url === 'https://api.musixmatch.com/ws/1.1/matcher.lyrics.get', data: {
      message: { body: { lyrics: {
        lyrics_body: 'Musixmatch lyrics result.\n******* This Lyrics is NOT for Commercial use *******',
        track_name: 'Hello', artist_name: 'Adele', album_name: '25'
      } } }
    } }
  ]);

  const result = await lyricsApi.getLyrics('Adele - Hello', {
    http,
    env: { MUSIXMATCH_API_KEY: 'unit-test-key' }
  });
  assert.equal(result.source, 'Musixmatch');
  assert.equal(result.lyrics, 'Musixmatch lyrics result.');
  assert.equal(calls.length, 4);
  assert.equal(calls[3].options.params.apikey, 'unit-test-key');
});

test('Vagalume reste une cinquième solution facultative avec une clé dédiée', async () => {
  const { http, calls } = fakeHttp([
    { match: url => url === 'https://lrclib.net/api/search', error: new Error('down') },
    { match: url => url.includes('api.lyrics.ovh/v1'), error: new Error('down') },
    { match: url => url === 'https://jio.shnwaz.dev/api/lyrics', error: new Error('down') },
    { match: url => url === 'https://api.musixmatch.com/ws/1.1/matcher.lyrics.get', error: new Error('down') },
    { match: url => url === 'https://api.vagalume.com.br/search.php', data: {
      art: { name: 'Adele' }, mus: [{ name: 'Hello', text: 'Vagalume lyrics result.' }]
    } }
  ]);

  const result = await lyricsApi.getLyrics('Adele - Hello', {
    http,
    env: { MUSIXMATCH_API_KEY: 'unit-test-key', VAGALUME_API_KEY: 'unit-vagalume-key' }
  });
  assert.equal(result.source, 'Vagalume');
  assert.equal(calls.length, 5);
  assert.equal(calls[4].options.params.apikey, 'unit-vagalume-key');
});

test('signale clairement les fournisseurs épuisés si aucun service ne rend de paroles', async () => {
  const { http } = fakeHttp([
    { match: () => true, error: new Error('service indisponible') }
  ]);
  await assert.rejects(
    lyricsApi.getLyrics('Adele - Hello', { http, env: {} }),
    /LRCLIB: service indisponible.*Lyrics\.ovh: service indisponible.*JioSaavn: service indisponible.*MUSIXMATCH_API_KEY.*VAGALUME_API_KEY/
  );
});

test('le plugin lyrics indique la source, tronque les longs textes et utilise le service injecté', async () => {
  const sent = [];
  const socket = {
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return {};
    }
  };
  const msg = { key: { id: 'm1' } };
  await lyricsPlugin.execute({
    socket,
    msg,
    from: '50900000000@s.whatsapp.net',
    args: ['Artist', '-', 'Song'],
    prefix: '.',
    dependencies: {
      async getLyrics(query) {
        assert.equal(query, 'Artist - Song');
        return { title: 'Song', artist: 'Artist', source: 'LRCLIB', lyrics: 'L'.repeat(6000) };
      }
    }
  });
  assert.match(sent.at(-1).content.text, /Source : LRCLIB/);
  assert.match(sent.at(-1).content.text, /paroles tronquées/);
  assert.equal(sent[0].content.react.text, '🎵');
});

test('retourne l’usage si la requête est vide', async () => {
  const sent = [];
  await lyricsPlugin.execute({
    socket: { sendMessage: async (jid, content) => sent.push({ jid, content }) },
    msg: { key: { id: 'm2' } },
    from: '50900000000@s.whatsapp.net',
    args: [],
    prefix: '.'
  });
  assert.match(sent[0].content.text, /Usage/);
});
