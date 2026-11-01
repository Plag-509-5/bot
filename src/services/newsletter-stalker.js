'use strict';

const REFRESH_INTERVAL_MS = 60_000;
const subscriptionsBySocket = new WeakMap();

function normalizedJid(value) {
  const jid = String(value || '').trim().toLowerCase();
  if (!jid) return '';
  return jid.endsWith('@newsletter') ? jid : `${jid}@newsletter`;
}

function socketClosed(socket) {
  return socket?.ws?.isOpen === false
    || (typeof socket?.ws?.readyState === 'number' && socket.ws.readyState !== 1)
    || (typeof socket?.ws?.socket?.readyState === 'number' && socket.ws.socket.readyState !== 1);
}

function isLiveNewsletterPost(message, type, configuredAt) {
  if (type !== 'notify' && type !== 'append') return false;
  const timestamp = Number(message?.messageTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const startedAtMs = configuredAt instanceof Date
    ? configuredAt.getTime()
    : Number(configuredAt);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return true;
  return timestamp >= Math.floor(startedAtMs / 1000) - 5;
}

async function subscribeNewsletterStalker(socket, jid, options = {}) {
  const normalizedJid = normalizedJidValue(jid);
  if (!socket || typeof socket.subscribeNewsletterUpdates !== 'function') {
    throw new Error('subscribeNewsletterUpdates indisponible sur cette version du socket.');
  }
  if (!normalizedJid) throw new Error('JID de chaîne invalide.');

  let subscriptions = subscriptionsBySocket.get(socket);
  if (!subscriptions) {
    subscriptions = new Map();
    subscriptionsBySocket.set(socket, subscriptions);
  }
  const existing = subscriptions.get(normalizedJid);
  if (existing?.pending) return existing.pending;
  if (existing && !options.force) return { jid: normalizedJid, alreadyActive: true, response: existing.response };

  const state = existing || { jid: normalizedJid, timer: null, response: null, pending: null, stopped: false };
  state.stopped = false;
  subscriptions.set(normalizedJid, state);
  const subscribe = Promise.resolve().then(() => socket.subscribeNewsletterUpdates(normalizedJid));
  state.pending = subscribe.then(response => {
    state.pending = null;
    state.response = response;
    if (!state.stopped && !state.timer) {
      const refreshMs = Math.max(10_000, Number(options.refreshIntervalMs) || REFRESH_INTERVAL_MS);
      state.timer = setInterval(() => {
        if (socketClosed(socket)) return;
        void subscribeNewsletterStalker(socket, normalizedJid, { force: true, refreshIntervalMs: refreshMs })
          .catch(error => socket.logger?.warn?.({ error, jid: normalizedJid }, 'Newsletter live-update renewal failed'));
      }, refreshMs);
      state.timer.unref?.();
    }
    return { jid: normalizedJid, alreadyActive: false, response };
  }, error => {
    state.pending = null;
    if (!state.timer && subscriptions.get(normalizedJid) === state) subscriptions.delete(normalizedJid);
    throw error;
  });
  return state.pending;
}

function normalizedJidValue(jid) {
  return normalizedJid(jid);
}

function stopNewsletterStalker(socket, jid) {
  const normalized = normalizedJid(jid);
  const subscriptions = subscriptionsBySocket.get(socket);
  const state = subscriptions?.get(normalized);
  if (!state) return false;
  state.stopped = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  subscriptions.delete(normalized);
  return true;
}

function stopAllNewsletterStalkers(socket) {
  const subscriptions = subscriptionsBySocket.get(socket);
  if (!subscriptions) return 0;
  let stopped = 0;
  for (const jid of subscriptions.keys()) {
    if (stopNewsletterStalker(socket, jid)) stopped += 1;
  }
  return stopped;
}

module.exports = {
  REFRESH_INTERVAL_MS,
  subscribeNewsletterStalker,
  stopNewsletterStalker,
  stopAllNewsletterStalkers,
  isLiveNewsletterPost,
  _test: { subscriptionsBySocket, socketClosed }
};
