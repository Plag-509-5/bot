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
    state = { cache: new Map(), currentPresence: null, presenceUpdatedAt: 0, alwaysOnline: false, activeReplies: 0, transition: Promise.resolve(), pendingReads: new Map() };
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

  async function flushPendingReads(target, replyTo) {
    const chats = [...new Set([target, replyTo].filter(Boolean))];
    const keys = chats.flatMap(chat => {
      const pending = state.pendingReads.get(chat) || [];
      state.pendingReads.delete(chat);
      return pending;
    });
    if (keys.length && typeof socket.readMessages === 'function') {
      try { await socket.readMessages(keys); } catch (_) {}
    }
  }

  async function sendMessageWithReplyPresence(jid, ...args) {
    const target = String(jid || '');
    const sendOptions = args[1] || {};
    const replyTo = String(sendOptions?.quoted?.key?.remoteJid || '');
    if (state.alwaysOnline) {
      await flushPendingReads(target, replyTo);
      return original.call(this, jid, ...args);
    }

    state.activeReplies += 1;
    if (state.activeReplies === 1) await enqueuePresence(socket, true, target).catch(() => {});
    else await state.transition.catch(() => {});

    try {
      await flushPendingReads(target, replyTo);
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
  if (!msg?.key?.fromMe && msg?.key?.remoteJid && msg?.key?.id && socket) {
    const state = getPresenceState(socket);
    const chat = String(msg.key.remoteJid);
    const pending = state.pendingReads.get(chat) || [];
    if (!pending.some(key => key.id === msg.key.id)) {
      pending.push(msg.key);
      if (pending.length > 100) pending.shift();
      state.pendingReads.set(chat, pending);
    }
  }
  // Ne marque le message comme lu qu’au moment où une réponse sort réellement.
  // La présence reste indisponible pendant le traitement.
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
