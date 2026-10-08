'use strict';

const axios = require('axios');

const DEFAULT_COBALT_APIS = [
  // Instances without a browser Turnstile challenge at the time of integration.
  'https://rue-cobalt.xenon.zone',
  'https://cobaltapi.cjs.nz'
];
const DEFAULT_TIMEOUT = 30_000;

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

function absoluteUrl(value, base) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = new URL(value, base);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch (_) {
    return null;
  }
}

function detectMediaType(item = {}, fallback = 'video') {
  const declared = String(item.type || item.mediaType || item.mimetype || '').toLowerCase();
  if (declared.includes('image') || declared === 'photo') return 'image';
  if (declared.includes('audio')) return 'audio';
  if (declared.includes('video')) return 'video';

  const candidate = `${item.filename || ''} ${item.url || ''}`.toLowerCase().split('?')[0];
  if (/\.(?:jpe?g|png|webp|gif|avif)(?:\s|$)/i.test(candidate)) return 'image';
  if (/\.(?:mp3|m4a|ogg|opus|wav)(?:\s|$)/i.test(candidate)) return 'audio';
  if (/\.(?:mp4|mov|mkv|webm)(?:\s|$)/i.test(candidate)) return 'video';
  return fallback;
}

function normaliseCobaltResponse(data, baseUrl, fallbackType = 'video') {
  if (!data || typeof data !== 'object') {
    throw new Error('Réponse vide reçue du serveur média.');
  }

  if (data.status === 'error' || data.error) {
    const code = data.error?.code || data.error || data.text || 'erreur inconnue';
    throw new Error(`Le serveur média a refusé le lien (${code}).`);
  }

  const title = data.filename || data.title || 'Média';
  if (Array.isArray(data.picker)) {
    const media = data.picker
      .map((item) => {
        const url = absoluteUrl(item?.url, baseUrl);
        if (!url) return null;
        return {
          url,
          type: detectMediaType(item, fallbackType),
          filename: item.filename || null,
          thumbnail: absoluteUrl(item.thumb || item.thumbnail, baseUrl)
        };
      })
      .filter(Boolean);

    if (media.length) return { title, media, provider: baseUrl };
  }

  const directUrl = absoluteUrl(
    data.url || data.downloadUrl || data.download_url || data.tunnel,
    baseUrl
  );
  if (directUrl) {
    const item = {
      url: directUrl,
      type: detectMediaType(data, fallbackType),
      filename: data.filename || null,
      thumbnail: absoluteUrl(data.thumbnail, baseUrl)
    };
    return { title, media: [item], provider: baseUrl };
  }

  throw new Error('Le serveur média n’a retourné aucun lien téléchargeable.');
}

function cobaltApiUrls() {
  const configured = String(process.env.COBALT_API_URLS || '')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(isHttpUrl);
  return configured.length ? configured : DEFAULT_COBALT_APIS;
}

function cobaltHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'KAIDO-MD/2.0'
  };
  if (process.env.COBALT_API_KEY) {
    headers.Authorization = `Api-Key ${process.env.COBALT_API_KEY}`;
  }
  return headers;
}

async function requestCobalt(sourceUrl, options = {}, http = axios) {
  if (!isHttpUrl(sourceUrl)) throw new Error('Lien média invalide.');

  const endpoints = Array.isArray(options.endpoints) && options.endpoints.length
    ? options.endpoints
    : cobaltApiUrls();
  const payload = {
    url: sourceUrl,
    downloadMode: options.downloadMode || 'auto',
    filenameStyle: 'basic',
    youtubeVideoCodec: 'h264',
    videoQuality: String(options.videoQuality || '720')
  };

  const failures = [];
  for (const endpointValue of endpoints) {
    const endpoint = String(endpointValue).replace(/\/+$/, '');
    if (!isHttpUrl(endpoint)) continue;
    try {
      const response = await http.post(endpoint, payload, {
        headers: cobaltHeaders(),
        timeout: options.timeout || DEFAULT_TIMEOUT,
        maxRedirects: 5
      });
      return normaliseCobaltResponse(response.data, endpoint, options.fallbackType || 'video');
    } catch (error) {
      const reason = error.response?.data?.error?.code
        || error.response?.data?.error
        || error.response?.status
        || error.message
        || 'échec';
      failures.push(`${new URL(endpoint).hostname}: ${String(reason)}`);
    }
  }

  throw new Error(`Aucun serveur média disponible${failures.length ? ` (${failures.join(' ; ')})` : ''}.`);
}

function normaliseFacebookResponse(data, baseUrl) {
  const root = data?.result || data?.data || data;
  const formats = root?.available_formats || root?.formats || root?.links || [];
  const formatList = Array.isArray(formats) ? formats : Object.values(formats || {});
  const bestFormat = formatList
    .filter((item) => item && (item.url || item.download_url))
    .sort((a, b) => {
      const score = (item) => Number(String(item.quality || item.label || '').match(/\d+/)?.[0] || 0);
      return score(b) - score(a);
    })[0];

  const url = absoluteUrl(
    root?.download_url
      || root?.downloadUrl
      || root?.videoUrl
      || root?.video_url
      || root?.hd
      || root?.hd_url
      || root?.sd
      || root?.sd_url
      || bestFormat?.url
      || bestFormat?.download_url,
    baseUrl
  );

  if (!url) throw new Error('L’API Facebook n’a retourné aucune vidéo.');
  return {
    title: root?.video_info?.title || root?.title || root?.caption || 'Facebook Video',
    thumbnail: absoluteUrl(root?.video_info?.thumbnail || root?.thumbnail, baseUrl),
    media: [{ url, type: 'video', filename: null, thumbnail: null }],
    provider: baseUrl
  };
}

async function downloadFacebook(sourceUrl, http = axios) {
  if (!isHttpUrl(sourceUrl) || !/(^|\.)(facebook\.com|fb\.watch)$/i.test(new URL(sourceUrl).hostname)) {
    throw new Error('Lien Facebook invalide.');
  }

  // Cobalt is shared with Instagram and its service status is independently monitored.
  try {
    return await requestCobalt(sourceUrl, { fallbackType: 'video' }, http);
  } catch (primaryError) {
    // Dedicated fallback with a documented /health and POST /download contract.
    const apiBase = String(process.env.FACEBOOK_DOWNLOADER_API || 'https://fdown.isuru.eu.org').replace(/\/+$/, '');
    try {
      const response = await http.post(`${apiBase}/download`, {
        url: sourceUrl,
        quality: 'best'
      }, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: 60_000,
        maxRedirects: 5
      });
      return normaliseFacebookResponse(response.data, apiBase);
    } catch (fallbackError) {
      const fallbackReason = fallbackError.response?.status || fallbackError.message || 'échec';
      throw new Error(`Téléchargement Facebook impossible (Cobalt: ${primaryError.message}; secours: ${fallbackReason}).`);
    }
  }
}

async function downloadInstagram(sourceUrl, http = axios) {
  if (!isHttpUrl(sourceUrl) || !/(^|\.)instagram\.com$/i.test(new URL(sourceUrl).hostname)) {
    throw new Error('Lien Instagram invalide.');
  }
  return requestCobalt(sourceUrl, { fallbackType: 'video' }, http);
}

module.exports = {
  downloadFacebook,
  downloadInstagram,
  requestCobalt,
  isHttpUrl,
  _test: {
    absoluteUrl,
    detectMediaType,
    normaliseCobaltResponse,
    normaliseFacebookResponse,
    cobaltApiUrls
  }
};
