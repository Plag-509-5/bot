'use strict';

const PRESENCE_DUPLICATE_TTL_MS = 1_000;
const PRESENCE_CACHE_MAX_JIDS = 64;
const REPLY_PRESENCE_WRAPPED = Symbol('kaidoReplyPresenceWrapped');
const presenceStates = new WeakMap();

function configEnabled(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (/^(?:true|on|1|yes)$/i.test(value.trim())) return true;
    if (/^(?:false|off|0|no)$/i.test(value.trim())) return false;
  }
  return fallback;
}

function getPresenceState(socket) {
  let state = presenceStates.get(socket);
  if (!state) {
    state = { cache: new Map(), currentPresence: null, presenceUpdatedAt: 0, alwaysOnline: false, activeReplies: 0, transition: Promise.resolve() };
    presenceStates.set(socket, state);
  }
  return state;
}

function enqueuePresence(socket, online, jid) {
  const state = getPresenceState(socket);
  state.transition = state.transition.catch(() => {}).then(() => setSessionPresence(socket, online, jid));
  return state.transition;
}

async function setSessionPresence(socket, online = true, jid) {
  if (!socket || typeof socket.sendPresenceUpdate !== 'function') return false;
  const state = getPresenceState(socket);
  const type = online ? 'available' : 'unavailable';
  const key = online ? `available:${String(jid || '')}` : 'unavailable';
  const now = Date.now();
  if (state.currentPresence === type && now - state.presenceUpdatedAt < PRESENCE_DUPLICATE_TTL_MS) return true;

  try {
    if (online) await socket.sendPresenceUpdate('available', jid);
    else await socket.sendPresenceUpdate('unavailable');
    state.currentPresence = type;
    state.presenceUpdatedAt = now;
    state.cache.delete(key);
    state.cache.set(key, { type, updatedAt: now });
    while (state.cache.size > PRESENCE_CACHE_MAX_JIDS) state.cache.delete(state.cache.keys().next().value);
    return true;
  } catch (_) {
    return false;
  }
}

function setupReplyPresenceWrapper(socket) {
  if (!socket || typeof socket.sendMessage !== 'function' || socket.sendMessage[REPLY_PRESENCE_WRAPPED]) return false;
  const original = socket.sendMessage;
  const state = getPresenceState(socket);

  async function sendMessageWithReplyPresence(jid, ...args) {
    const target = String(jid || '');
    if (state.alwaysOnline) return original.call(this, jid, ...args);

    state.activeReplies += 1;
    if (state.activeReplies === 1) await enqueuePresence(socket, true, target).catch(() => {});
    else await state.transition.catch(() => {});

    try {
      return await original.call(this, jid, ...args);
    } finally {
      state.activeReplies = Math.max(0, state.activeReplies - 1);
      if (state.activeReplies === 0 && !state.alwaysOnline) {
        await enqueuePresence(socket, false).catch(() => {});
      }
    }
  }
  Object.defineProperty(sendMessageWithReplyPresence, REPLY_PRESENCE_WRAPPED, { value: true });
  socket.sendMessage = sendMessageWithReplyPresence;
  return true;
}

async function handleIgnoredMessage() {
  return false;
}

async function wakeForCommand(socket, msg, sessionConfig = {}) {
  if (!msg?.key?.fromMe && msg?.key && typeof socket?.readMessages === 'function') {
    try { await socket.readMessages([msg.key]); } catch (_) {}
  }
  // The socket remains unavailable while a command is working. Its actual
  // reply temporarily sets availability inside setupReplyPresenceWrapper.
  if (configEnabled(sessionConfig.AUTO_RECORDING, false) && typeof socket?.sendPresenceUpdate === 'function') {
    try { await socket.sendPresenceUpdate('recording', msg?.key?.remoteJid); } catch (_) {}
  }
}

async function applyAlwaysOnlineSetting(socket, enabled = false, jid) {
  if (!socket) return false;
  const state = getPresenceState(socket);
  state.alwaysOnline = configEnabled(enabled, false);
  if (state.alwaysOnline) return enqueuePresence(socket, true, jid);
  if (state.activeReplies > 0) return true;
  return enqueuePresence(socket, false);
}

module.exports = {
  configEnabled,
  setSessionPresence,
  setupReplyPresenceWrapper,
  handleIgnoredMessage,
  wakeForCommand,
  applyAlwaysOnlineSetting,
  _test: {
    clearPresenceCache(socket) { presenceStates.delete(socket); },
    REPLY_PRESENCE_WRAPPED
  }
};
