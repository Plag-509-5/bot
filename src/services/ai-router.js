'use strict';

const DEFAULT_PROVIDER_ORDER = ['jina', 'gemini', 'groq', 'openrouter', 'compatible'];
const DEFAULT_MODELS = Object.freeze({
  jina: 'jina-deepsearch-v1',
  gemini: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-20b',
  openrouter: 'openrouter/free'
});

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(message => ['system', 'user', 'assistant'].includes(message?.role))
    .map(message => ({
      role: message.role,
      content: String(message.content || '').replace(/\u0000/g, '').slice(0, 12_000)
    }))
    .filter(message => message.content.trim());
}

function extractOpenAiText(payload) {
  const content = payload?.choices?.[0]?.message?.content
    ?? payload?.choices?.[0]?.message?.refusal;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'string' ? part : part?.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
}

function retryAfterMs(response) {
  const header = response?.headers?.get?.('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10 * 60 * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 10 * 60 * 1000)) : 0;
}

async function readResponsePayload(response) {
  if (typeof response?.text === 'function') {
    const raw = await response.text();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return { text: raw }; }
  }
  if (typeof response?.json === 'function') return response.json();
  return {};
}

class AiProviderError extends Error {
  constructor(provider, message, options = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.provider = provider;
    this.status = Number(options.status) || 0;
    this.code = options.code || 'provider_error';
    this.retryAfterMs = Number(options.retryAfterMs) || 0;
  }
}

class AiRouterError extends Error {
  constructor(code, failures = [], retryInMs = 0) {
    super(code === 'no_provider_configured'
      ? 'Aucune API IA n’est configurée.'
      : 'Toutes les API IA configurées sont temporairement indisponibles.');
    this.name = 'AiRouterError';
    this.code = code;
    this.failures = failures;
    this.retryInMs = Math.max(0, Number(retryInMs) || 0);
  }
}

function createTimeoutFetch(fetchImpl, timeoutMs, providerName) {
  return async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new AiProviderError(
        providerName,
        timedOut ? 'provider_timeout' : 'provider_network_error',
        { code: timedOut ? 'timeout' : 'network_error' }
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}

function makeOpenAiCompatibleProvider({
  name,
  endpoint,
  getApiKey,
  getApiKeys,
  getModel,
  fetchImpl,
  timeoutMs,
  maxOutputTokens,
  maxTokenField = 'max_tokens',
  includeTemperature = true,
  extraHeaders = () => ({})
}) {
  let nextKeyIndex = 0;
  const resolveKeys = () => {
    const rawKeys = typeof getApiKeys === 'function' ? getApiKeys() : [getApiKey?.()];
    return [...new Set((Array.isArray(rawKeys) ? rawKeys : [rawKeys])
      .map(key => String(key || '').trim())
      .filter(Boolean))];
  };

  return {
    name,
    isConfigured() {
      return Boolean(resolveKeys().length && String(getModel() || '').trim());
    },
    async complete(messages) {
      const keys = resolveKeys();
      const model = String(getModel() || '').trim();
      if (!keys.length || !model) throw new AiProviderError(name, 'provider_not_configured', { code: 'not_configured' });

      const start = nextKeyIndex++ % keys.length;
      const orderedKeys = [...keys.slice(start), ...keys.slice(0, start)];
      const request = createTimeoutFetch(fetchImpl, timeoutMs, name);
      const requestBody = { model, messages, stream: false };
      if (includeTemperature) requestBody.temperature = 0.7;
      if (maxTokenField) requestBody[maxTokenField] = maxOutputTokens;
      let lastRotatableError = null;

      for (let index = 0; index < orderedKeys.length; index += 1) {
        const apiKey = orderedKeys[index];
        const response = await request(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            ...extraHeaders()
          },
          body: JSON.stringify(requestBody)
        });
        const payload = await readResponsePayload(response);
        if (!response?.ok) {
          const error = new AiProviderError(name, `provider_http_${response?.status || 0}`, {
            status: response?.status,
            retryAfterMs: retryAfterMs(response),
            code: response?.status === 429 ? 'rate_limited' : 'http_error'
          });
          const canRotate = orderedKeys.length > 1
            && index < orderedKeys.length - 1
            && [401, 403, 429].includes(response?.status);
          if (canRotate) {
            lastRotatableError = error;
            continue;
          }
          throw error;
        }

        const text = extractOpenAiText(payload);
        if (!text) throw new AiProviderError(name, 'provider_empty_response', { code: 'empty_response' });
        return { text, provider: name, model: String(payload?.model || model) };
      }

      throw lastRotatableError || new AiProviderError(name, 'provider_http_429', { status: 429, code: 'rate_limited' });
    }
  };
}

function parseApiKeys(...values) {
  const keys = values.flatMap(value => String(value || '').split(/[,;\r\n]+/));
  return [...new Set(keys.map(key => key.trim()).filter(Boolean))];
}

function normalizeCompatibleEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = trimmedPath.endsWith('/chat/completions')
      ? trimmedPath
      : `${trimmedPath}/chat/completions`.replace(/^\/chat\/chat\//, '/chat/');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function createDefaultProviders({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const timeoutMs = boundedInteger(env.AI_REQUEST_TIMEOUT_MS, 8000, 1000, 30_000);
  const maxOutputTokens = boundedInteger(env.AI_MAX_OUTPUT_TOKENS, 400, 64, 2000);
  const request = createTimeoutFetch(fetchImpl, timeoutMs, 'gemini');

  const gemini = {
    name: 'gemini',
    isConfigured: () => Boolean(String(env.GEMINI_API_KEY || '').trim() && String(env.GEMINI_MODEL || DEFAULT_MODELS.gemini).trim()),
    async complete(messages) {
      const apiKey = String(env.GEMINI_API_KEY || '').trim();
      const model = String(env.GEMINI_MODEL || DEFAULT_MODELS.gemini).trim();
      if (!apiKey) throw new AiProviderError('gemini', 'provider_not_configured', { code: 'not_configured' });

      const systemText = messages.find(message => message.role === 'system')?.content || '';
      const contents = messages
        .filter(message => message.role !== 'system')
        .map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        }));
      if (!contents.length) throw new AiProviderError('gemini', 'provider_empty_request', { code: 'empty_request' });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await request(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens }
        })
      });
      const payload = await readResponsePayload(response);
      if (!response?.ok) {
        throw new AiProviderError('gemini', `provider_http_${response?.status || 0}`, {
          status: response?.status,
          retryAfterMs: retryAfterMs(response),
          code: response?.status === 429 ? 'rate_limited' : 'http_error'
        });
      }
      const text = extractGeminiText(payload);
      if (!text) throw new AiProviderError('gemini', 'provider_empty_response', { code: 'empty_response' });
      return { text, provider: 'gemini', model };
    }
  };

  // Jina DeepSearch uses the OpenAI Chat Completions shape but may spend up to
  // roughly two minutes researching. Keep its longer timeout isolated from the
  // faster chat providers, and send only the documented request fields.
  const jina = makeOpenAiCompatibleProvider({
    name: 'jina',
    endpoint: 'https://deepsearch.jina.ai/v1/chat/completions',
    getApiKey: () => env.JINA_API_KEY,
    getApiKeys: () => parseApiKeys(env.JINA_API_KEYS, env.JINA_API_KEY),
    getModel: () => env.JINA_MODEL || DEFAULT_MODELS.jina,
    fetchImpl,
    timeoutMs: boundedInteger(env.JINA_REQUEST_TIMEOUT_MS, 120_000, 1000, 120_000),
    maxOutputTokens,
    maxTokenField: null,
    includeTemperature: false
  });

  const groq = makeOpenAiCompatibleProvider({
    name: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    getApiKey: () => env.GROQ_API_KEY,
    getModel: () => env.GROQ_MODEL || DEFAULT_MODELS.groq,
    fetchImpl,
    timeoutMs,
    maxOutputTokens,
    maxTokenField: 'max_completion_tokens'
  });

  const openrouter = makeOpenAiCompatibleProvider({
    name: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    getApiKey: () => env.OPENROUTER_API_KEY,
    getModel: () => env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter,
    fetchImpl,
    timeoutMs,
    maxOutputTokens,
    extraHeaders: () => ({ 'x-title': 'Kaido-MD' })
  });

  const compatibleEndpoint = normalizeCompatibleEndpoint(env.AI_COMPAT_BASE_URL);
  const compatible = makeOpenAiCompatibleProvider({
    name: 'compatible',
    endpoint: compatibleEndpoint,
    getApiKey: () => env.AI_COMPAT_API_KEY,
    getModel: () => env.AI_COMPAT_MODEL,
    fetchImpl,
    timeoutMs,
    maxOutputTokens
  });
  const isCompatibleConfigured = compatible.isConfigured.bind(compatible);
  compatible.isConfigured = () => Boolean(compatibleEndpoint && isCompatibleConfigured());

  return [jina, gemini, groq, openrouter, compatible];
}

function createAiRouter(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('La fonction fetch est indisponible dans cette version de Node.js.');

  const providers = Array.isArray(options.providers)
    ? options.providers
    : createDefaultProviders({ env, fetchImpl });
  const cooldowns = new Map();
  const now = typeof options.now === 'function' ? options.now : Date.now;

  function providerOrder() {
    const configuredOrder = String(env.AI_PROVIDER_ORDER || DEFAULT_PROVIDER_ORDER.join(','))
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    const uniqueOrder = [...new Set(configuredOrder)];
    const byName = new Map(providers.map(provider => [String(provider.name).toLowerCase(), provider]));
    return uniqueOrder.map(name => byName.get(name)).filter(Boolean);
  }

  function getConfiguredProviders() {
    return providerOrder()
      .filter(provider => {
        try { return provider.isConfigured?.() !== false; } catch (_) { return false; }
      })
      .map(provider => String(provider.name));
  }

  function cooldownMsFor(error) {
    if (error?.retryAfterMs > 0) return Math.min(error.retryAfterMs, 10 * 60 * 1000);
    if (error?.status === 429) return 30_000;
    if (error?.status === 401 || error?.status === 403) return 5 * 60 * 1000;
    if (error?.code === 'timeout' || error?.code === 'network_error' || error?.status >= 500) return 5000;
    return 30_000;
  }

  async function complete(rawMessages) {
    const messages = normalizeMessages(rawMessages);
    const configured = providerOrder().filter(provider => {
      try { return provider.isConfigured?.() !== false; } catch (_) { return false; }
    });
    if (!configured.length) throw new AiRouterError('no_provider_configured');

    const timestamp = now();
    const available = configured.filter(provider => (cooldowns.get(provider.name) || 0) <= timestamp);
    if (!available.length) {
      const nextReady = Math.min(...configured.map(provider => cooldowns.get(provider.name) || timestamp));
      throw new AiRouterError('providers_cooling_down', [], Math.max(0, nextReady - timestamp));
    }

    const failures = [];
    for (const provider of available) {
      try {
        const result = await provider.complete(messages);
        const text = String(result?.text || '').trim().slice(0, 6000);
        if (!text) throw new AiProviderError(provider.name, 'provider_empty_response', { code: 'empty_response' });
        cooldowns.delete(provider.name);
        return {
          text,
          provider: String(result?.provider || provider.name),
          model: String(result?.model || '')
        };
      } catch (error) {
        const cooldownMs = cooldownMsFor(error);
        cooldowns.set(provider.name, now() + cooldownMs);
        failures.push({
          provider: String(provider.name),
          status: Number(error?.status) || 0,
          code: String(error?.code || 'provider_error'),
          retryInMs: cooldownMs
        });
      }
    }
    throw new AiRouterError('providers_unavailable', failures);
  }

  return {
    complete,
    getConfiguredProviders,
    getStatus() {
      const timestamp = now();
      return providerOrder()
        .filter(provider => {
          try { return provider.isConfigured?.() !== false; } catch (_) { return false; }
        })
        .map(provider => ({
          name: String(provider.name),
          coolingDown: (cooldowns.get(provider.name) || 0) > timestamp,
          retryInMs: Math.max(0, (cooldowns.get(provider.name) || timestamp) - timestamp)
        }));
    },
    clearCooldowns() { cooldowns.clear(); }
  };
}

module.exports = {
  DEFAULT_PROVIDER_ORDER,
  DEFAULT_MODELS,
  AiProviderError,
  AiRouterError,
  createAiRouter,
  createDefaultProviders,
  normalizeCompatibleEndpoint,
  normalizeMessages,
  extractOpenAiText,
  extractGeminiText
};
