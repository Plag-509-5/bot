'use strict';

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 90_000;

function boundedInteger(value, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const SESSION_KEEPALIVE_INTERVAL_MS = boundedInteger(
  process.env.SESSION_KEEPALIVE_INTERVAL_MS,
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  10_000,
  120_000
);
const SESSION_HEALTH_CHECK_INTERVAL_MS = Math.min(
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  SESSION_KEEPALIVE_INTERVAL_MS
);
const SESSION_STALE_AFTER_MS = boundedInteger(
  process.env.SESSION_STALE_AFTER_MS,
  Math.max(DEFAULT_STALE_AFTER_MS, SESSION_KEEPALIVE_INTERVAL_MS * 3),
  60_000
);

/**
 * Baileys 7 exposes the WebSocketClient wrapper as socket.ws. Its `isOpen`
 * getter is the supported state check; older/custom sockets may expose readyState.
 * Return null when this socket implementation does not expose a health signal.
 */
function getSocketOpenState(socket) {
  const ws = socket?.ws;
  if (typeof ws?.isOpen === 'boolean') return ws.isOpen;
  if (typeof ws?.readyState === 'number') return ws.readyState === 1;
  if (typeof ws?.socket?.readyState === 'number') return ws.socket.readyState === 1;
  return null;
}

/**
 * Force-close only an already-unhealthy socket, so Baileys emits its normal
 * connection update and the existing lifecycle/reconnect scheduler can recover
 * this session without opening a parallel WhatsApp connection.
 */
function forceCloseSessionSocket(socket, onError = () => {}) {
  const ws = socket?.ws;
  const underlyingSocket = ws?.socket;
  if (typeof underlyingSocket?.terminate === 'function') {
    underlyingSocket.terminate();
    return 'terminated';
  }
  if (typeof ws?.close === 'function') {
    Promise.resolve(ws.close()).catch(error => {
      try { onError(error); } catch {}
    });
    return 'closing';
  }
  return 'unavailable';
}

function createSessionHealthWatcher({
  getSessions,
  intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = Date.now,
  onStale = () => {},
  onError = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (typeof getSessions !== 'function') {
    throw new TypeError('getSessions must be a function returning active session sockets.');
  }

  const healthBySession = new Map();
  let timer = null;
  let checking = false;

  async function checkNow(at = now()) {
    if (checking) return { skipped: true, tracked: healthBySession.size, stale: 0 };
    checking = true;
    try {
      const sessions = getSessions();
      const entries = sessions instanceof Map
        ? sessions.entries()
        : Object.entries(sessions || {});
      const present = new Set();
      const staleSockets = [];

      for (const [number, socket] of entries) {
        if (!socket || typeof socket !== 'object') continue;
        const key = String(number);
        present.add(key);
        if (getSocketOpenState(socket) !== false) {
          healthBySession.delete(key);
          continue;
        }

        let health = healthBySession.get(key);
        if (!health || health.socket !== socket) {
          health = { socket, unhealthySince: at, notified: false };
          healthBySession.set(key, health);
        }
        if (!health.notified && at - health.unhealthySince >= staleAfterMs) {
          health.notified = true;
          staleSockets.push({ number: key, socket, health });
        }
      }

      for (const number of healthBySession.keys()) {
        if (!present.has(number)) healthBySession.delete(number);
      }

      for (const stale of staleSockets) {
        try {
          await onStale(stale.number, stale.socket, {
            unhealthyForMs: Math.max(0, at - stale.health.unhealthySince),
            unhealthySince: stale.health.unhealthySince
          });
        } catch (error) {
          stale.health.notified = false;
          try { await onError(error, stale.number); } catch {}
        }
      }

      return { skipped: false, tracked: healthBySession.size, stale: staleSockets.length };
    } finally {
      checking = false;
    }
  }

  function start() {
    if (timer !== null) return false;
    timer = setIntervalFn(() => {
      void checkNow().catch(error => {
        try { onError(error, null); } catch {}
      });
    }, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    healthBySession.clear();
  }

  return {
    checkNow,
    start,
    stop,
    isRunning: () => timer !== null,
    getTrackedSessions: () => healthBySession.size
  };
}

module.exports = {
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_STALE_AFTER_MS,
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_HEALTH_CHECK_INTERVAL_MS,
  SESSION_STALE_AFTER_MS,
  boundedInteger,
  getSocketOpenState,
  forceCloseSessionSocket,
  createSessionHealthWatcher
};
