'use strict';

const axios = require('axios');

const PEXELS_API = 'https://api.pexels.com/v1/search';
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
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

async function searchPexels(query, limit, apiKey, http = axios) {
  if (!apiKey) return [];
  const response = await http.get(PEXELS_API, {
    params: { query, per_page: Math.min(Math.max(limit * 2, 8), 40), page: 1 },
    headers: { Authorization: apiKey, Accept: 'application/json' },
    timeout: 20_000
  });
  return normalisePexelsResponse(response.data, limit);
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

async function searchImages(query, limit = 5, http = axios, options = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) throw new Error('La recherche est vide.');
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 8);
  const apiKey = options.pexelsApiKey ?? process.env.PEXELS_API_KEY;
  let pexelsError = null;

  if (apiKey) {
    try {
      const pexels = await searchPexels(cleanQuery, safeLimit, apiKey, http);
      if (pexels.length) return pexels;
    } catch (error) {
      pexelsError = error;
      console.warn('[IMAGE SEARCH] Pexels indisponible, fallback Openverse:', error?.message || error);
    }
  }

  try {
    const openverse = await searchOpenverse(cleanQuery, safeLimit, http);
    if (openverse.length) return openverse;
  } catch (error) {
    if (pexelsError) throw new Error(`Pexels et Openverse indisponibles : ${error?.message || error}`);
    throw error;
  }

  throw new Error('Aucune image pertinente trouvée.');
}

module.exports = {
  searchImages,
  _test: {
    PEXELS_API,
    OPENVERSE_API,
    SUPPORTED_FILETYPES,
    normaliseText,
    relevanceScore,
    normalisePexelsResponse,
    normaliseOpenverseResponse,
    searchPexels,
    searchOpenverse
  }
};
