'use strict';

const axios = require('axios');

const PEXELS_API = 'https://api.pexels.com/v1/search';
const GOOGLE_CSE_API = 'https://www.googleapis.com/customsearch/v1';
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const SUPPORTED_FILETYPES = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', '']);

function safeHttpUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function normaliseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function relevanceScore(image, query) {
  const phrase = normaliseText(query);
  const tokens = phrase.split(/\s+/).filter(token => token.length > 1);
  const title = normaliseText(image.title);
  const tags = normaliseText((image.tags || []).join(' '));
  let score = 0;
  if (phrase && title === phrase) score += 200;
  else if (phrase && title.includes(phrase)) score += 120;
  for (const token of tokens) {
    if (title.includes(token)) score += 20;
    if (tags.includes(token)) score += 8;
  }
  if (tokens.length && tokens.every(token => title.includes(token) || tags.includes(token))) score += 50;
  return score;
}

function normalisePexelsResponse(data, limit = 5) {
  const seen = new Set();
  const images = [];
  for (const photo of data?.photos || []) {
    const url = safeHttpUrl(photo?.src?.large2x || photo?.src?.large || photo?.src?.medium || photo?.src?.original);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      originalUrl: safeHttpUrl(photo?.src?.original) || url,
      sourceUrl: safeHttpUrl(photo?.url),
      title: photo?.alt || `Photo ${photo?.id || ''}`.trim(),
      creator: photo?.photographer || null,
      provider: 'Pexels',
      attribution: photo?.photographer
        ? `Photo par ${photo.photographer} sur Pexels`
        : 'Photo fournie par Pexels'
    });
    if (images.length >= limit) break;
  }
  return images;
}

function normaliseOpenverseResponse(data, query, limit = 5) {
  const candidates = [];
  const seen = new Set();
  for (const result of data?.results || []) {
    const filetype = String(result?.filetype || '').toLowerCase();
    if (result?.mature === true || !SUPPORTED_FILETYPES.has(filetype)) continue;
    const url = safeHttpUrl(result?.thumbnail || result?.url);
    const originalUrl = safeHttpUrl(result?.url) || url;
    if (!url || seen.has(originalUrl)) continue;
    seen.add(originalUrl);
    const image = {
      url,
      originalUrl,
      sourceUrl: safeHttpUrl(result?.foreign_landing_url || result?.detail_url),
      title: result?.title || 'Image',
      creator: result?.creator || null,
      provider: 'Openverse',
      license: [result?.license, result?.license_version].filter(Boolean).join(' ').toUpperCase() || null,
      attribution: result?.attribution || null,
      tags: (result?.tags || []).map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean)
    };
    candidates.push({ image, score: relevanceScore(image, query), order: candidates.length });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(candidate => {
      const { tags, ...image } = candidate.image;
      return image;
    });
}

function normaliseGoogleResponse(data, limit = 5) {
  const seen = new Set();
  const images = [];
  for (const result of data?.items || []) {
    const originalUrl = safeHttpUrl(result?.link);
    const thumbnail = safeHttpUrl(result?.image?.thumbnailLink);
    const url = thumbnail || originalUrl;
    if (!url || seen.has(originalUrl || url)) continue;
    seen.add(originalUrl || url);
    images.push({
      url,
      originalUrl: originalUrl || url,
      sourceUrl: safeHttpUrl(result?.image?.contextLink),
      title: result?.title || 'Image',
      provider: 'Google Images',
      attribution: result?.displayLink ? `Résultat Google Images — ${result.displayLink}` : null
    });
    if (images.length >= limit) break;
  }
  return images;
}

function normaliseWikimediaResponse(data, limit = 5) {
  const pages = Object.values(data?.query?.pages || {});
  const images = [];
  const seen = new Set();
  for (const page of pages) {
    const info = page?.imageinfo?.[0] || {};
    const originalUrl = safeHttpUrl(info.url);
    const url = safeHttpUrl(info.thumburl || originalUrl);
    if (!url || seen.has(originalUrl || url)) continue;
    seen.add(originalUrl || url);
    const metadata = info.extmetadata || {};
    const creator = metadata.Artist?.value
      ? String(metadata.Artist.value).replace(/<[^>]*>/g, '').trim()
      : null;
    const license = metadata.LicenseShortName?.value || null;
    images.push({
      url,
      originalUrl: originalUrl || url,
      sourceUrl: safeHttpUrl(`https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '').replace(/%20/g, '_')}`),
      title: String(page.title || 'Image').replace(/^File:/i, '').replace(/_/g, ' '),
      creator,
      provider: 'Wikimedia Commons',
      license,
      attribution: [creator, license].filter(Boolean).join(' — ') || null
    });
    if (images.length >= limit) break;
  }
  return images;
}

async function searchPexels(query, limit, apiKey, http = axios) {
  if (!apiKey) return [];
  const response = await http.get(PEXELS_API, {
    params: { query, per_page: Math.min(Math.max(limit * 2, 8), 40), page: 1 },
    headers: { Authorization: apiKey, Accept: 'application/json' },
    timeout: 20_000
  });
  return normalisePexelsResponse(response.data, limit);
}

async function searchGoogleImages(query, limit, apiKey, engineId, http = axios) {
  if (!apiKey || !engineId) return [];
  const response = await http.get(GOOGLE_CSE_API, {
    params: {
      key: apiKey,
      cx: engineId,
      q: query,
      searchType: 'image',
      num: Math.min(Math.max(limit, 1), 10),
      safe: 'active'
    },
    headers: { Accept: 'application/json' },
    timeout: 20_000
  });
  return normaliseGoogleResponse(response.data, limit);
}

async function searchOpenverse(query, limit, http = axios) {
  const response = await http.get(OPENVERSE_API, {
    params: {
      q: query,
      page_size: Math.min(Math.max(limit * 4, 20), 50),
      page: 1,
      mature: 'false'
    },
    headers: {
      Accept: 'application/json',
      'User-Agent': 'KAIDO-MD/2.0 (WhatsApp image search)'
    },
    timeout: 20_000
  });
  return normaliseOpenverseResponse(response.data, query, limit);
}

async function searchWikimedia(query, limit, http = axios) {
  const response = await http.get(WIKIMEDIA_API, {
    params: {
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: 6,
      gsrlimit: Math.min(Math.max(limit * 2, 10), 50),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: 1000,
      format: 'json',
      origin: '*'
    },
    headers: { Accept: 'application/json', 'User-Agent': 'KAIDO-MD/2.0 (WhatsApp image search)' },
    timeout: 20_000
  });
  return normaliseWikimediaResponse(response.data, limit);
}

async function searchImages(query, limit = 5, http = axios, options = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) throw new Error('La recherche est vide.');
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 8);
  const pexelsApiKey = options.pexelsApiKey ?? process.env.PEXELS_API_KEY;
  const googleApiKey = options.googleApiKey ?? process.env.GOOGLE_CSE_API_KEY;
  const googleEngineId = options.googleEngineId ?? process.env.GOOGLE_CSE_CX;
  const provider = String(options.provider || '').toLowerCase();
  const attempts = [];

  // Le chemin explicite permet à l’utilisateur de demander Google Images même
  // si un autre fournisseur est configuré ou répond plus vite.
  const providers = provider === 'google'
    ? [() => searchGoogleImages(cleanQuery, safeLimit, googleApiKey, googleEngineId, http)]
    : [
        ...(pexelsApiKey ? [() => searchPexels(cleanQuery, safeLimit, pexelsApiKey, http)] : []),
        ...(googleApiKey && googleEngineId ? [() => searchGoogleImages(cleanQuery, safeLimit, googleApiKey, googleEngineId, http)] : []),
        () => searchOpenverse(cleanQuery, safeLimit, http),
        () => searchWikimedia(cleanQuery, safeLimit, http)
      ];

  for (const search of providers) {
    try {
      const images = await search();
      if (images.length) return images;
    } catch (error) {
      attempts.push(error?.message || String(error));
      console.warn('[IMAGE SEARCH] Fournisseur indisponible, essai du suivant:', error?.message || error);
    }
  }

  if (provider === 'google' && (!googleApiKey || !googleEngineId)) {
    throw new Error('Google Images nécessite GOOGLE_CSE_API_KEY et GOOGLE_CSE_CX (Programmable Search Engine).');
  }
  if (attempts.length === providers.length) {
    throw new Error(`Aucun service d’images n’a répondu : ${attempts.join(' | ')}`);
  }
  throw new Error('Aucune image pertinente trouvée.');
}

module.exports = {
  searchImages,
  _test: {
    PEXELS_API,
    GOOGLE_CSE_API,
    OPENVERSE_API,
    WIKIMEDIA_API,
    SUPPORTED_FILETYPES,
    normaliseText,
    relevanceScore,
    normalisePexelsResponse,
    normaliseOpenverseResponse,
    normaliseGoogleResponse,
    normaliseWikimediaResponse,
    searchPexels,
    searchGoogleImages,
    searchOpenverse,
    searchWikimedia
  }
};
