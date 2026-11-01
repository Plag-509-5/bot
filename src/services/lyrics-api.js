'use strict';

const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 5000;
const LRCLIB_URL = 'https://lrclib.net/api/search';
const LYRICS_OVH_URL = 'https://api.lyrics.ovh';
const DEFAULT_SAAVN_LYRICS_URL = 'https://jio.shnwaz.dev/api/lyrics';
const MUSIXMATCH_URL = 'https://api.musixmatch.com/ws/1.1/matcher.lyrics.get';
const VAGALUME_URL = 'https://api.vagalume.com.br/search.php';

function splitArtistTitle(query) {
  const input = String(query || '').trim();
  const match = input.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return match
    ? { artist: match[1].trim(), title: match[2].trim() }
    : { artist: '', title: input };
}

function cleanLyrics(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/^\[(?:\d{1,2}:\d{2}(?:\.\d{1,3})?|(?:ar|al|ti|by):[^\]]*)\]\s*/gim, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/g, '')
    .trim();
}

function firstText(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function normalizeResult({ lyrics, title, artist, album, source }, query) {
  const clean = cleanLyrics(lyrics);
  if (!clean || clean.length < 8) return null;
  return {
    lyrics: clean,
    title: firstText(title, splitArtistTitle(query).title, query),
    artist: firstText(artist, splitArtistTitle(query).artist),
    album: firstText(album),
    source
  };
}

function formatTimedLyrics(song) {
  return cleanLyrics(song?.plainLyrics)
    || cleanLyrics(song?.syncedLyrics)
    || cleanLyrics(song?.lyrics);
}

async function fetchLrclib(query, client, timeout) {
  const response = await client.get(LRCLIB_URL, {
    params: { q: query },
    timeout,
    headers: { 'User-Agent': 'Kaido-MD/1.0 (lyrics lookup)' }
  });
  const songs = Array.isArray(response?.data) ? response.data : response?.data?.results;
  if (!Array.isArray(songs)) throw new Error('réponse LRCLIB invalide');
  for (const song of songs) {
    const result = normalizeResult({
      lyrics: formatTimedLyrics(song),
      title: song.trackName,
      artist: song.artistName,
      album: song.albumName,
      source: 'LRCLIB'
    }, query);
    if (result) return result;
  }
  throw new Error('aucune parole trouvée');
}

async function fetchLyricsOvh(query, client, timeout) {
  const parsed = splitArtistTitle(query);
  let artist = parsed.artist;
  let title = parsed.title;
  if (!artist) {
    const suggestions = await client.get(`${LYRICS_OVH_URL}/suggest/${encodeURIComponent(query)}`, { timeout });
    const tracks = suggestions?.data?.data;
    const match = Array.isArray(tracks) ? tracks.find(track => track?.title && track?.artist?.name) : null;
    if (!match) throw new Error('recherche sans résultat');
    artist = match.artist.name;
    title = match.title;
  }

  const response = await client.get(
    `${LYRICS_OVH_URL}/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
    { timeout }
  );
  const data = response?.data;
  const result = normalizeResult({
    lyrics: data?.lyrics,
    title: data?.title || title,
    artist: data?.artist || artist,
    album: data?.album,
    source: 'Lyrics.ovh'
  }, query);
  if (!result) throw new Error('aucune parole trouvée');
  return result;
}

function extractLyricsObject(value, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractLyricsObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const direct = firstText(value.plainLyrics, value.syncedLyrics, value.lyrics, value.lyrics_body, value.text);
  if (direct) return direct;
  for (const key of ['data', 'result', 'results', 'track', 'song', 'message', 'body', 'mus']) {
    if (Object.hasOwn(value, key)) {
      const found = extractLyricsObject(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractSaavnMetadata(value, depth = 0) {
  if (depth > 5 || value == null || typeof value !== 'object') return {};
  if (Array.isArray(value)) return extractSaavnMetadata(value[0], depth + 1);
  const title = firstText(value.title, value.name, value.trackName, value.song);
  const artist = firstText(value.artist, value.artistName, value.primaryArtists, value.singers);
  const album = firstText(value.album, value.albumName);
  if (title || artist || album) return { title, artist, album };
  for (const key of ['data', 'result', 'results', 'track', 'song']) {
    if (Object.hasOwn(value, key)) {
      const metadata = extractSaavnMetadata(value[key], depth + 1);
      if (metadata.title || metadata.artist || metadata.album) return metadata;
    }
  }
  return {};
}

async function fetchSaavn(query, client, timeout, env) {
  const endpoint = String(env.LYRICS_SAAVN_API_URL || DEFAULT_SAAVN_LYRICS_URL).replace(/\/+$/, '');
  const response = await client.get(endpoint, { params: { query }, timeout });
  const data = response?.data;
  const lyrics = extractLyricsObject(data);
  if (!lyrics) throw new Error('aucune parole trouvée dans la réponse Saavn');
  const result = normalizeResult({ ...extractSaavnMetadata(data), lyrics, source: 'JioSaavn' }, query);
  if (!result) throw new Error('réponse Saavn sans paroles valides');
  return result;
}

async function fetchMusixmatch(query, client, timeout, env) {
  const apiKey = String(env.MUSIXMATCH_API_KEY || '').trim();
  if (!apiKey) throw new Error('clé MUSIXMATCH_API_KEY non configurée');
  const { artist, title } = splitArtistTitle(query);
  const response = await client.get(MUSIXMATCH_URL, {
    params: { format: 'json', q_track: title, ...(artist ? { q_artist: artist } : {}), apikey: apiKey },
    timeout
  });
  const body = response?.data?.message?.body?.lyrics;
  const lyrics = firstText(body?.lyrics_body, body?.lyrics);
  if (!lyrics || /^instrumental/i.test(lyrics)) throw new Error('aucune parole trouvée');
  const cleaned = cleanLyrics(lyrics.replace(/\s*\*{3,}\s*This Lyrics is NOT for Commercial use\s*\*{3,}\s*$/i, ''));
  if (!cleaned || cleaned.length < 8) throw new Error('réponse sans paroles valides');
  return normalizeResult({
    lyrics: cleaned,
    title: body?.track_name,
    artist: body?.artist_name,
    album: body?.album_name,
    source: 'Musixmatch'
  }, query);
}

async function fetchVagalume(query, client, timeout, env) {
  const apiKey = String(env.VAGALUME_API_KEY || '').trim();
  if (!apiKey) throw new Error('clé VAGALUME_API_KEY non configurée');
  const { artist, title } = splitArtistTitle(query);
  const response = await client.get(VAGALUME_URL, {
    params: { art: artist || query, mus: title, apikey: apiKey },
    timeout
  });
  const song = response?.data?.mus?.find(item => typeof item?.text === 'string' && item.text.trim());
  const result = normalizeResult({
    lyrics: song?.text,
    title: song?.name,
    artist: response?.data?.art?.name || artist,
    source: 'Vagalume'
  }, query);
  if (!result) throw new Error('aucune parole trouvée');
  return result;
}

function createProviders(query, http, timeout, env) {
  return [
    { name: 'LRCLIB', run: () => fetchLrclib(query, http, timeout) },
    { name: 'Lyrics.ovh', run: () => fetchLyricsOvh(query, http, timeout) },
    { name: 'JioSaavn', run: () => fetchSaavn(query, http, timeout, env) },
    { name: 'Musixmatch', run: () => fetchMusixmatch(query, http, timeout, env) },
    { name: 'Vagalume', run: () => fetchVagalume(query, http, timeout, env) }
  ];
}

async function getLyrics(query, options = {}) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) throw new Error('Indique le titre ou « artiste - titre ».');
  const http = options.http || axios;
  const env = options.env || process.env;
  const configuredTimeout = Number(options.timeoutMs || env.LYRICS_API_TIMEOUT_MS);
  const timeout = configuredTimeout > 0
    ? Math.min(configuredTimeout, 15_000)
    : DEFAULT_TIMEOUT_MS;
  const failures = [];
  const providers = createProviders(normalizedQuery, http, timeout, env);

  for (const provider of providers) {
    try {
      const result = await provider.run();
      if (result?.lyrics) return result;
      failures.push(`${provider.name}: réponse sans paroles`);
    } catch (error) {
      failures.push(`${provider.name}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(`Aucune API lyrics n’a répondu avec des paroles. ${failures.join(' | ')}`);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  splitArtistTitle,
  cleanLyrics,
  fetchLrclib,
  fetchLyricsOvh,
  fetchSaavn,
  fetchMusixmatch,
  fetchVagalume,
  getLyrics
};
