'use strict';

const DEFAULT_BASE_URL = 'http://69.48.206.15:8765';
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 1200;
const MAX_RESPONSE_CHARS = 12_000;

function boundedNumber(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveChatEndpoint(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('DARKAI_BASE_URL invalide.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('DARKAI_BASE_URL doit être une URL HTTP(S) sans identifiants intégrés.');
  }
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v1/chat') ? path : `${path}/v1/chat`;
  return url.toString();
}

function textFrom(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(part => {
      if (typeof part === 'string') return part;
      return typeof part?.text === 'string' ? part.text : '';
    }).filter(Boolean).join('\n').trim();
  }
  return '';
}

function extractDarkAiText(payload) {
  const candidates = [
    payload?.message?.content,
    payload?.message,
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.response,
    payload?.answer,
    payload?.reply,
    payload?.output_text,
    payload?.output,
    payload?.content,
    payload?.text,
    payload?.data?.message?.content,
    payload?.data?.response,
    payload?.data?.answer,
    payload?.data?.text
  ];
  for (const candidate of candidates) {
    const text = textFrom(candidate);
    if (text) return text.slice(0, MAX_RESPONSE_CHARS);
  }
  return '';
}

async function readJsonResponse(response) {
  const raw = typeof response?.text === 'function'
    ? await response.text()
    : typeof response?.json === 'function'
      ? JSON.stringify(await response.json())
      : '';
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { text: raw };
  }
}

function createDarkAiClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('La fonction fetch est indisponible.');

  async function complete(messages, overrides = {}) {
    const apiKey = String(env.DARKAI_API_KEY || '').trim();
    if (!apiKey) {
      const error = new Error('La clé DARKAI_API_KEY n’est pas configurée dans les variables d’environnement.');
      error.code = 'not_configured';
      throw error;
    }

    const normalizedMessages = (Array.isArray(messages) ? messages : [])
      .filter(message => ['system', 'user', 'assistant'].includes(message?.role))
      .map(message => ({
        role: message.role,
        content: String(message.content || '').replace(/\u0000/g, '').trim().slice(0, 12_000)
      }))
      .filter(message => message.content);
    if (!normalizedMessages.length || normalizedMessages.length > 100) {
      throw new Error('La requête DARK AI doit contenir entre 1 et 100 messages.');
    }

    const endpoint = resolveChatEndpoint(overrides.baseUrl || env.DARKAI_BASE_URL);
    if (new URL(endpoint).protocol === 'http:'
      && String(env.DARKAI_ALLOW_INSECURE_HTTP || '').trim().toLowerCase() !== 'true') {
      const error = new Error('DARK AI utilise HTTP sans chiffrement. Configure une URL HTTPS ou active explicitement DARKAI_ALLOW_INSECURE_HTTP=true.');
      error.code = 'insecure_transport';
      throw error;
    }
    const timeoutMs = boundedNumber(env.DARKAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 180_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          messages: normalizedMessages,
          workspace_id: null,
          think: false,
          stream: false,
          num_ctx: Math.round(boundedNumber(env.DARKAI_NUM_CTX, 8192, 1024, 32768)),
          temperature: boundedNumber(env.DARKAI_TEMPERATURE, 0.7, 0, 2),
          max_tokens: Math.round(boundedNumber(env.DARKAI_MAX_TOKENS, DEFAULT_MAX_TOKENS, 1, 8192))
        }),
        signal: controller.signal
      });
    } catch (cause) {
      const error = new Error(controller.signal.aborted
        ? 'DARK AI n’a pas répondu avant le délai d’attente.'
        : 'Impossible de joindre le service DARK AI.');
      error.code = controller.signal.aborted ? 'timeout' : 'network_error';
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const payload = await readJsonResponse(response);
    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      const error = new Error(status === 401 || status === 403
        ? 'La clé DARKAI_API_KEY a été refusée par le service.'
        : status === 429
          ? 'Le service DARK AI est temporairement limité (HTTP 429).'
          : `Le service DARK AI a répondu avec une erreur HTTP ${status}.`);
      error.status = status;
      error.code = status === 401 || status === 403 ? 'authentication' : status === 429 ? 'rate_limited' : 'http_error';
      throw error;
    }

    const text = extractDarkAiText(payload);
    if (!text) {
      const error = new Error('DARK AI a répondu, mais aucun texte de réponse exploitable n’a été trouvé.');
      error.code = 'empty_response';
      throw error;
    }
    return { text, payload };
  }

  return { complete };
}

const defaultClient = createDarkAiClient();

module.exports = {
  DEFAULT_BASE_URL,
  resolveChatEndpoint,
  extractDarkAiText,
  createDarkAiClient,
  complete: (...args) => defaultClient.complete(...args)
};
