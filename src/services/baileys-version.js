'use strict';

/**
 * Résolution stable de la version WhatsApp Web utilisée par Baileys.
 *
 * Le numéro embarqué dans une release Baileys vieillit rapidement. À l'inverse,
 * rappeler fetchLatestWaWebVersion à chaque reconnexion peut faire régresser une
 * session vers le fallback embarqué si une requête HTTP échoue. Ce résolveur :
 *   - partage une seule requête entre toutes les sessions ;
 *   - conserve la dernière version live valide et ne la remplace jamais par un
 *     fallback plus ancien ;
 *   - permet un override explicite WA_WEB_VERSION pour les environnements sans
 *     accès HTTP à web.whatsapp.com.
 */

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FAILURE_RETRY_MS = 60 * 1000;

function parseWaVersion(value) {
  if (Array.isArray(value)) {
    const parsed = value.map(Number);
    return parsed.length === 3 && parsed.every((part) => Number.isInteger(part) && part >= 0)
      ? parsed
      : null;
  }

  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = value.trim().split(/[.,\s]+/).filter(Boolean).map(Number);
  return parsed.length === 3 && parsed.every((part) => Number.isInteger(part) && part >= 0)
    ? parsed
    : null;
}

function formatWaVersion(version) {
  return Array.isArray(version) ? version.join('.') : 'inconnue';
}

function cloneResolution(value, extra = {}) {
  if (!value) return null;
  return {
    ...value,
    ...extra,
    version: [...value.version]
  };
}

function errorMessage(error) {
  return error?.message || error?.error?.message || (error ? String(error) : null);
}

function createBaileysVersionResolver(options = {}) {
  const {
    fetchLatestWaWebVersion,
    override = process.env.WA_WEB_VERSION,
    cacheTtlMs = Math.max(60_000, Number(process.env.WA_VERSION_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS),
    failureRetryMs = DEFAULT_FAILURE_RETRY_MS,
    now = Date.now,
    fetchOptions = () => ({})
  } = options;

  if (typeof fetchLatestWaWebVersion !== 'function') {
    throw new TypeError('fetchLatestWaWebVersion est obligatoire');
  }

  const overrideVersion = parseWaVersion(override);
  if (override && !overrideVersion) {
    throw new Error('WA_WEB_VERSION invalide : format attendu 2.3000.1234567890');
  }

  let cached = overrideVersion
    ? {
        version: overrideVersion,
        source: 'environment',
        isLatest: null,
        stale: false,
        fetchedAt: now(),
        expiresAt: Number.POSITIVE_INFINITY,
        warning: null
      }
    : null;
  let lastLive = null;
  let pending = null;

  async function fetchResolution() {
    let result;
    let thrown = null;
    try {
      result = await fetchLatestWaWebVersion(fetchOptions());
    } catch (error) {
      thrown = error;
      result = null;
    }

    const fetchedAt = now();
    const version = parseWaVersion(result?.version);
    if (version && result?.isLatest === true) {
      const live = {
        version,
        source: 'whatsapp-web-live',
        isLatest: true,
        stale: false,
        fetchedAt,
        expiresAt: fetchedAt + cacheTtlMs,
        warning: null
      };
      lastLive = live;
      cached = live;
      return cloneResolution(live);
    }

    const warning = errorMessage(thrown || result?.error)
      || 'WhatsApp n’a pas confirmé que la version récupérée est actuelle';

    // Invariant critique : une panne temporaire de sw.js ne doit jamais faire
    // redescendre une reconnexion 515 vers la version embarquée plus ancienne.
    if (lastLive) {
      cached = {
        ...lastLive,
        source: 'whatsapp-web-cache',
        stale: true,
        expiresAt: fetchedAt + failureRetryMs,
        warning
      };
      return cloneResolution(cached);
    }

    if (!version) {
      throw new Error(`Impossible de déterminer la version WhatsApp Web : ${warning}`);
    }

    cached = {
      version,
      source: 'baileys-bundled-fallback',
      isLatest: false,
      stale: true,
      fetchedAt,
      expiresAt: fetchedAt + failureRetryMs,
      warning
    };
    return cloneResolution(cached);
  }

  async function resolve({ force = false } = {}) {
    if (overrideVersion) return cloneResolution(cached);
    if (!force && cached && cached.expiresAt > now()) return cloneResolution(cached);
    if (pending) return cloneResolution(await pending);

    pending = fetchResolution();
    try {
      return cloneResolution(await pending);
    } finally {
      pending = null;
    }
  }

  function snapshot() {
    return cloneResolution(cached);
  }

  return {
    resolve,
    snapshot,
    parseWaVersion,
    formatWaVersion
  };
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_FAILURE_RETRY_MS,
  parseWaVersion,
  formatWaVersion,
  createBaileysVersionResolver
};
