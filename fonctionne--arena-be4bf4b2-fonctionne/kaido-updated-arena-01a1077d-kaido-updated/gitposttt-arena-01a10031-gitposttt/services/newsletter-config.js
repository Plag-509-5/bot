'use strict';

const DEFAULT_NEWSLETTER_EMOJIS = ['🐉', '🔥', '💀', '👑', '💪', '😎', '🇭🇹', '⚡', '🩸', '❤️'];

function normaliseNewsletterJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{6,30})(?:@newsletter)?$/i);
  return match ? `${match[1]}@newsletter` : '';
}

function normaliseEmojiList(value, limit = 20) {
  const input = Array.isArray(value) ? value : [value];
  const emojis = [];
  const seen = new Set();

  for (const item of input) {
    const pieces = String(item || '').includes(',')
      ? String(item || '').split(',')
      : String(item || '').split(/\s+/);
    for (const piece of pieces) {
      const emoji = piece.trim();
      if (!emoji || seen.has(emoji)) continue;
      seen.add(emoji);
      emojis.push(emoji);
      if (emojis.length >= limit) return emojis;
    }
  }
  return emojis;
}

function resolveNewsletterEmojis(primary, secondary, fallback = DEFAULT_NEWSLETTER_EMOJIS) {
  const preferred = normaliseEmojiList(primary);
  if (preferred.length) return preferred;
  const alternate = normaliseEmojiList(secondary);
  if (alternate.length) return alternate;
  return normaliseEmojiList(fallback);
}

async function syncNewsletterSockets(sockets, jid, action = 'follow', extraSockets = []) {
  const normalizedJid = normaliseNewsletterJid(jid);
  if (!normalizedJid) throw new Error('JID de chaîne invalide');
  const method = action === 'unfollow' ? 'newsletterUnfollow' : 'newsletterFollow';
  const uniqueSockets = new Set([
    ...(sockets instanceof Map ? sockets.values() : Array.isArray(sockets) ? sockets : []),
    ...extraSockets
  ].filter(Boolean));

  const results = [];
  for (const socket of uniqueSockets) {
    const session = String(socket?.user?.id || 'session-inconnue').split(':')[0];
    if (typeof socket?.[method] !== 'function') {
      results.push({ session, ok: false, skipped: true, error: `${method} indisponible` });
      continue;
    }
    try {
      await socket[method](normalizedJid);
      results.push({ session, ok: true });
    } catch (error) {
      results.push({ session, ok: false, error: error?.message || String(error) });
    }
  }
  return results;
}

module.exports = {
  DEFAULT_NEWSLETTER_EMOJIS,
  normaliseNewsletterJid,
  normaliseEmojiList,
  resolveNewsletterEmojis,
  syncNewsletterSockets
};
