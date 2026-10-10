'use strict';

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STATUS_LOGS_PER_SESSION = 20;
const logsBySession = new Map();

function normalizeSessionId(value) {
  return String(value || '').replace(/[^0-9]/g, '') || 'session';
}

function add(sessionId, entry, now = Date.now()) {
  if (!entry?.key?.id) throw new Error('Impossible de journaliser un statut sans identifiant.');
  const key = normalizeSessionId(sessionId);
  const items = (logsBySession.get(key) || [])
    .filter(item => now - item.createdAt < STATUS_TTL_MS);
  const stored = {
    ...entry,
    key: { ...entry.key },
    statusJidList: [...new Set(entry.statusJidList || [])],
    createdAt: now
  };
  items.push(stored);
  while (items.length > MAX_STATUS_LOGS_PER_SESSION) items.shift();
  logsBySession.set(key, items);
  return { ...stored, key: { ...stored.key }, statusJidList: [...stored.statusJidList] };
}

function getLatest(sessionId, now = Date.now()) {
  const key = normalizeSessionId(sessionId);
  const items = (logsBySession.get(key) || [])
    .filter(item => now - item.createdAt < STATUS_TTL_MS);
  if (!items.length) {
    logsBySession.delete(key);
    return null;
  }
  logsBySession.set(key, items);
  const latest = items.at(-1);
  return { ...latest, key: { ...latest.key }, statusJidList: [...latest.statusJidList] };
}

function removeLatest(sessionId, expectedId) {
  const key = normalizeSessionId(sessionId);
  const items = logsBySession.get(key) || [];
  const index = expectedId
    ? items.findIndex(item => item.key?.id === expectedId)
    : items.length - 1;
  if (index < 0) return null;
  const [removed] = items.splice(index, 1);
  if (items.length) logsBySession.set(key, items);
  else logsBySession.delete(key);
  return { ...removed, key: { ...removed.key }, statusJidList: [...removed.statusJidList] };
}

function clear(sessionId) {
  if (sessionId === undefined) {
    logsBySession.clear();
    return;
  }
  logsBySession.delete(normalizeSessionId(sessionId));
}

module.exports = {
  STATUS_TTL_MS,
  MAX_STATUS_LOGS_PER_SESSION,
  add,
  getLatest,
  removeLatest,
  clear,
  _test: { logsBySession }
};
