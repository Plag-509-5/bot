'use strict';

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function cleanMessageText(value, maxChars = 6000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxChars);
}

function createAiMemory(options = {}) {
  const maxConversations = boundedInteger(options.maxConversations, 300, 1, 2000);
  const maxMessages = Math.max(2, boundedInteger(options.maxMessages, 12, 2, 40));
  const maxChars = boundedInteger(options.maxChars, 12_000, 512, 100_000);
  const ttlMs = boundedInteger(options.ttlMs, 6 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const entries = new Map();

  function pruneExpired(at = now()) {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (at - entry.updatedAt < ttlMs) continue;
      entries.delete(key);
      removed += 1;
    }
    return removed;
  }

  function readEntry(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return null;
    const entry = entries.get(normalizedKey);
    if (!entry) return null;
    if (now() - entry.updatedAt >= ttlMs) {
      entries.delete(normalizedKey);
      return null;
    }
    // LRU: une conversation active reste en cache avant les anciennes.
    entries.delete(normalizedKey);
    entries.set(normalizedKey, entry);
    return entry;
  }

  function trimConversation(messages) {
    let totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    while (messages.length > 2 && (messages.length > maxMessages || totalChars > maxChars)) {
      const removed = messages.splice(0, Math.min(2, messages.length));
      totalChars -= removed.reduce((sum, message) => sum + message.content.length, 0);
    }

    if (totalChars > maxChars && messages.length) {
      // Une seule paire très longue peut rester après l'élagage. Préserver le
      // tour le plus récent tout en respectant le plafond mémoire configuré.
      const user = messages[messages.length - 2];
      const assistant = messages[messages.length - 1];
      if (user && assistant) {
        const userBudget = Math.floor(maxChars * 0.4);
        const assistantBudget = maxChars - userBudget;
        user.content = user.content.slice(-userBudget);
        assistant.content = assistant.content.slice(-assistantBudget);
      } else {
        messages[0].content = messages[0].content.slice(-maxChars);
      }
    }
  }

  function appendTurn(key, userContent, assistantContent) {
    const normalizedKey = String(key || '').trim();
    const user = cleanMessageText(userContent);
    const assistant = cleanMessageText(assistantContent);
    if (!normalizedKey || !user || !assistant) return false;

    const timestamp = now();
    let entry = readEntry(normalizedKey);
    if (!entry) {
      entry = { messages: [], updatedAt: timestamp };
      entries.set(normalizedKey, entry);
    }

    entry.messages.push(
      { role: 'user', content: user },
      { role: 'assistant', content: assistant }
    );
    entry.updatedAt = timestamp;
    trimConversation(entry.messages);
    // Reinsert after readEntry so this conversation is the most recently used.
    entries.delete(normalizedKey);
    entries.set(normalizedKey, entry);

    while (entries.size > maxConversations) {
      entries.delete(entries.keys().next().value);
    }
    return true;
  }

  function getMessages(key) {
    const entry = readEntry(key);
    return entry ? entry.messages.map(message => ({ ...message })) : [];
  }

  function clear(key) {
    return entries.delete(String(key || '').trim());
  }

  function clearSession(sessionNumber) {
    const session = String(sessionNumber || '').replace(/[^0-9]/g, '');
    if (!session) return 0;
    const prefix = `${session}::`;
    let removed = 0;
    for (const key of entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      entries.delete(key);
      removed += 1;
    }
    return removed;
  }

  function getStats() {
    pruneExpired();
    return {
      conversations: entries.size,
      maxConversations,
      maxMessages,
      maxChars,
      ttlMs
    };
  }

  return {
    appendTurn,
    getMessages,
    clear,
    clearSession,
    pruneExpired,
    getStats
  };
}

module.exports = { createAiMemory, cleanMessageText };
