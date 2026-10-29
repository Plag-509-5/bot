'use strict';

function normalizeSessionNumbers(numbers) {
  return [...new Set((Array.isArray(numbers) ? numbers : [])
    .map(number => String(number ?? '').replace(/[^0-9]/g, ''))
    .filter(Boolean))];
}

/**
 * Reconnect only persisted sessions that are absent or have a definitively
 * closed socket. Unknown/open sockets are left alone to avoid parallel logins.
 */
async function reconnectInactiveSessions(numbers, {
  activeSockets,
  isPairingLocked = () => false,
  getOpenState = () => null,
  markIntentionalClose = () => {},
  clearSocketMetadata = () => {},
  closeSocket = () => {},
  launchSessions = async () => []
} = {}) {
  if (!(activeSockets instanceof Map)) {
    throw new TypeError('activeSockets must be a Map');
  }

  const uniqueNumbers = normalizeSessionNumbers(numbers);
  const skipped = [];
  const candidates = [];

  for (const number of uniqueNumbers) {
    const socket = activeSockets.get(number);
    if (socket && getOpenState(socket) !== false) {
      skipped.push({ number, status: 'already_connected' });
      continue;
    }
    if (isPairingLocked(number)) {
      skipped.push({ number, status: 'already_starting' });
      continue;
    }

    if (socket) {
      markIntentionalClose(socket);
      activeSockets.delete(number);
      clearSocketMetadata(number, socket);
      try {
        closeSocket(socket);
      } catch (error) {
        // The socket is already known closed; a close error must not prevent
        // Baileys from recreating it from the persisted credentials.
        console.warn(`[FORCE-RECONNECT ${number}] fermeture du socket :`, error?.message || error);
      }
    }
    candidates.push(number);
  }

  let launched = [];
  if (candidates.length) {
    try {
      launched = await launchSessions(candidates);
    } catch (error) {
      launched = candidates.map(number => ({
        number,
        status: 'failed',
        error: error?.message || String(error)
      }));
    }
  }

  return {
    total: uniqueNumbers.length,
    candidates: candidates.length,
    results: [...skipped, ...(Array.isArray(launched) ? launched : [])]
  };
}

function formatForceReconnectReport({ total = 0, candidates = 0, results = [], fatalErrors = 0 } = {}) {
  const entries = Array.isArray(results) ? results : [];
  const launched = entries.filter(result => ['connection_initiated', 'scheduled'].includes(result?.status)).length;
  const active = entries.filter(result => result?.status === 'already_connected').length;
  const starting = entries.filter(result => result?.status === 'already_starting').length;
  const failures = entries.filter(result => result?.status === 'failed').length + Math.max(0, Number(fatalErrors) || 0);

  return [
    '✅ Reconnexion terminée.',
    `Sessions examinées : ${Math.max(0, Number(total) || 0)}`,
    `Sessions inactives : ${Math.max(0, Number(candidates) || 0)}`,
    `Reconnexions programmées : ${launched}`,
    `Déjà actives : ${active}`,
    `Déjà en cours : ${starting}`,
    `Échecs : ${failures}`
  ].join('\n');
}

module.exports = {
  normalizeSessionNumbers,
  reconnectInactiveSessions,
  formatForceReconnectReport
};
