'use strict';

const DEFAULT_NEWSLETTER_EMOJIS = ['🐉', '🔥', '💀', '👑', '💪', '😎', '🇭🇹', '⚡', '🩸', '❤️'];

function normaliseNewsletterJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Les JID peuvent être numériques (120363…@newsletter) ou issus d'un lien
  // d'invitation WhatsApp, par exemple 0029Vb…@newsletter.
  const match = raw.match(/^([a-z0-9._-]{6,128})(?:@newsletter)?$/i);
  return match ? `${match[1]}@newsletter` : '';
}

function parseNewsletterMessageReference(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([^/?#\s]+)\/([^/?#\s,]+)(?:[?#].*)?$/i);
  if (/^(?:https?:\/\/|www\.|whatsapp\.com\/)/i.test(raw) && !urlMatch) return null;
  let channel = '';
  let serverId = '';
  if (urlMatch) {
    channel = urlMatch[1];
    serverId = urlMatch[2];
  } else {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 2) {
      channel = parts[parts.length - 2];
      serverId = parts[parts.length - 1];
    }
  }

  serverId = String(serverId || '').replace(/[?#].*$/, '').trim();
  const jid = normaliseNewsletterJid(channel);
  if (!jid || !/^[a-z0-9._-]{1,128}$/i.test(serverId)) return null;
  return { jid, serverId };
}

function extractNewsletterServerId(message) {
  const value = message?.key?.server_id
    ?? message?.key?.serverId
    ?? message?.newsletterServerId;
  return value === undefined || value === null ? '' : String(value).trim();
}

async function reactToNewsletterMessage(socket, jid, serverId, reaction) {
  const normalizedJid = normaliseNewsletterJid(jid);
  const normalizedServerId = String(serverId || '').trim();
  const emoji = String(reaction || '').trim();
  if (!normalizedJid) throw new Error('JID de chaîne invalide');
  if (!normalizedServerId) throw new Error('Identifiant server_id de publication manquant');
  if (!emoji) throw new Error('Emoji de réaction manquant');
  if (typeof socket?.newsletterReactMessage !== 'function') {
    throw new Error('newsletterReactMessage indisponible sur le socket NYXCORE');
  }

  // newsletterReactMessage ne requiert pas que le compte suive la chaîne.
  // Ne jamais appeler newsletterFollow ici : cela retardait les réactions et
  // faisait échouer les bots invités à réagir sans abonnement préalable.
  await socket.newsletterReactMessage(normalizedJid, normalizedServerId, emoji);
  return { jid: normalizedJid, serverId: normalizedServerId, reaction: emoji };
}

async function reactAcrossNewsletterSockets(sessions, jid, serverId, reaction, onSuccess) {
  const unique = new Map();
  for (const entry of Array.isArray(sessions) ? sessions : []) {
    const socket = entry?.socket || entry;
    if (!socket || unique.has(socket)) continue;
    unique.set(socket, String(entry?.session || socket?.user?.id || 'session-inconnue').split('@')[0]);
  }

  return Promise.all([...unique].map(async ([socket, session]) => {
    try {
      const result = await reactToNewsletterMessage(socket, jid, serverId, reaction);
      let persistenceError = '';
      if (typeof onSuccess === 'function') {
        try { await onSuccess(session, result); }
        catch (error) { persistenceError = String(error?.message || error); }
      }
      return { session, ok: true, persistenceError };
    } catch (error) {
      return { session, ok: false, error: String(error?.message || error) };
    }
  }));
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
  parseNewsletterMessageReference,
  extractNewsletterServerId,
  reactToNewsletterMessage,
  reactAcrossNewsletterSockets,
  syncNewsletterSockets
};
