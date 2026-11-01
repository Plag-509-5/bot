'use strict';

function isMessage(value) {
  return Boolean(value && typeof value === 'object' && value.key?.id && value.message);
}

function getConversationMessage(store, targetKey) {
  const messages = store?.messages;
  const jid = targetKey?.remoteJid;
  const id = String(targetKey?.id || '');
  if (!messages || !jid || !id) return null;

  const conversation = typeof messages.get === 'function'
    ? messages.get(jid)
    : messages[jid];
  if (!conversation) return null;

  if (typeof conversation.get === 'function') {
    const byId = conversation.get(id);
    if (isMessage(byId)) return byId;
  }

  const list = Array.isArray(conversation)
    ? conversation
    : Array.isArray(conversation.array)
      ? conversation.array
      : Array.isArray(conversation.messages)
        ? conversation.messages
        : conversation instanceof Map
          ? Array.from(conversation.values())
          : [];
  return list.find(message => String(message?.key?.id || '') === id && isMessage(message)) || null;
}

/**
 * Resolve the message referenced by a reaction. Prefer the bot's per-session
 * cache, then consult an optional Baileys in-memory store when the reaction
 * arrives after that cache entry has expired or was hydrated elsewhere.
 */
async function resolveReactionTargetMessage({ cachedMessage, socket, targetKey } = {}) {
  if (isMessage(cachedMessage)) return cachedMessage;

  const jid = targetKey?.remoteJid;
  const id = String(targetKey?.id || '');
  if (!jid || !id) return null;

  const stores = [socket, socket?.store, socket?.messageStore].filter(Boolean);
  for (const store of stores) {
    if (typeof store.loadMessage === 'function') {
      try {
        const loaded = await store.loadMessage(jid, id);
        if (isMessage(loaded)) return loaded;
      } catch (_) {
        // An optional store is best-effort; keep checking the remaining stores.
      }
    }
  }

  for (const store of [socket?.store, socket?.messageStore]) {
    const loaded = getConversationMessage(store, targetKey);
    if (loaded) return loaded;
  }
  return null;
}

module.exports = {
  isMessage,
  getConversationMessage,
  resolveReactionTargetMessage
};
