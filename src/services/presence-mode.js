'use strict';

const presenceStates = new WeakMap();
const PRESENCE_DUPLICATE_TTL_MS = 5_000;
const PRESENCE_CACHE_MAX_JIDS = 64;

function configEnabled(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (/^(?:true|on|1|yes)$/i.test(value.trim())) return true;
    if (/^(?:false|off|0|no)$/i.test(value.trim())) return false;
  }
  return fallback;
}

async function setSessionPresence(socket, online = true, jid) {
  // Keep the existing Baileys socket available. WhatsApp presence is separate
  // from the websocket connection, so an unavailable update must never be used
  // as an idle/offline policy for this session.
  if (!online || !socket || typeof socket.sendPresenceUpdate !== 'function') return false;
  const key = String(jid || '');
  const now = Date.now();
  let cache = presenceStates.get(socket);
  if (!cache) {
    cache = new Map();
    presenceStates.set(socket, cache);
  }

  const previous = cache.get(key);
  if (previous && now - previous.updatedAt < PRESENCE_DUPLICATE_TTL_MS) return true;

  try {
    await socket.sendPresenceUpdate('available', jid);
    cache.delete(key);
    cache.set(key, { updatedAt: now });
    while (cache.size > PRESENCE_CACHE_MAX_JIDS) cache.delete(cache.keys().next().value);
    return true;
  } catch (_) {
    return false;
  }
}

// Messages that are not commands must not toggle WhatsApp availability. The
// socket stays online from connection-open until Baileys reports a real close.
async function handleIgnoredMessage() {
  return false;
}

async function wakeForCommand(socket, msg, sessionConfig = {}) {
  const jid = msg?.key?.remoteJid;

  if (!msg?.key?.fromMe && msg?.key && typeof socket?.readMessages === 'function') {
    try { await socket.readMessages([msg.key]); } catch (_) {}
  }

  await setSessionPresence(socket, true, jid);
  if (configEnabled(sessionConfig.AUTO_RECORDING, false) && typeof socket?.sendPresenceUpdate === 'function') {
    try { await socket.sendPresenceUpdate('recording', jid); } catch (_) {}
  }
}

async function applyAlwaysOnlineSetting(socket, _enabled, jid) {
  // Backward-compatible entry point for the old `alwaysonline on|off` option.
  // The offline mode was removed; `off` is intentionally treated as online.
  return setSessionPresence(socket, true, jid);
}

module.exports = {
  configEnabled,
  setSessionPresence,
  handleIgnoredMessage,
  wakeForCommand,
  applyAlwaysOnlineSetting,
  _test: {
    clearPresenceCache(socket) { presenceStates.delete(socket); }
  }
};
