'use strict';

const DEFAULT_MAX_MESSAGES_PER_SESSION = 500;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_MESSAGE_FIELDS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];

function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const next = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message
      || current.editedMessage?.message;
    if (!next) break;
    current = next;
  }
  return current || {};
}

function snapshotMessageEnvelope(message) {
  return {
    ...message,
    ...(message.key && typeof message.key === 'object' ? { key: { ...message.key } } : {}),
    message: message.message
  };
}

function createReactionTargetCache({
  maxMessagesPerSession = DEFAULT_MAX_MESSAGES_PER_SESSION,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now
} = {}) {
  const sessions = new Map();
  const storedAt = new WeakMap();

  function prune(sessionId) {
    const cache = sessions.get(sessionId);
    if (!cache) return;
    const cutoff = now() - ttlMs;
    for (const [id, message] of cache) {
      if ((storedAt.get(message) || 0) <= cutoff) cache.delete(id);
    }
    while (cache.size > maxMessagesPerSession) cache.delete(cache.keys().next().value);
    if (!cache.size) sessions.delete(sessionId);
  }

  function record(sessionNumber, message) {
    const sessionId = String(sessionNumber || '').replace(/[^0-9]/g, '');
    if (!sessionId || !message?.key?.id || !message.message) return false;
    const content = unwrapMessage(message.message);
    const isMedia = MEDIA_MESSAGE_FIELDS.some(field => content[field]);
    if (!isMedia && !content.albumMessage) return false;

    prune(sessionId);
    let cache = sessions.get(sessionId);
    if (!cache) {
      cache = new Map();
      sessions.set(sessionId, cache);
    }
    const snapshot = snapshotMessageEnvelope(message);
    cache.delete(String(message.key.id));
    cache.set(String(message.key.id), snapshot);
    storedAt.set(snapshot, now());
    prune(sessionId);
    return true;
  }

  function get(sessionNumber, messageId) {
    const sessionId = String(sessionNumber || '').replace(/[^0-9]/g, '');
    const id = String(messageId || '');
    if (!sessionId || !id) return null;
    prune(sessionId);
    const cache = sessions.get(sessionId);
    const message = cache?.get(id) || null;
    if (message) {
      cache.delete(id);
      cache.set(id, message);
    }
    return message;
  }

  function clear(sessionNumber) {
    const sessionId = String(sessionNumber || '').replace(/[^0-9]/g, '');
    if (!sessionId) return false;
    return sessions.delete(sessionId);
  }

  return { record, get, clear, prune, size: sessionNumber => {
    const sessionId = String(sessionNumber || '').replace(/[^0-9]/g, '');
    prune(sessionId);
    return sessions.get(sessionId)?.size || 0;
  } };
}

module.exports = {
  DEFAULT_MAX_MESSAGES_PER_SESSION,
  DEFAULT_TTL_MS,
  MEDIA_MESSAGE_FIELDS,
  createReactionTargetCache
};
