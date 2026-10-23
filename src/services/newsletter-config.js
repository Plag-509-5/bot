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
  return { jid, serverId, channelKey: channel };
}

async function resolveNewsletterJid(socket, reference) {
  const channelKey = String(reference?.channelKey || reference?.jid || reference || '').trim();
  const normalized = normaliseNewsletterJid(channelKey);
  if (!normalized) throw new Error('Lien ou identifiant de chaîne invalide');
  const identifier = normalized.slice(0, -'@newsletter'.length);

  // Les liens whatsapp.com/channel/<invite-code>/<server_id> portent un code
  // d’invitation, pas un JID. Les IDs de chaîne Baileys sont du type 120363…;
  // ne pas prendre un code d’invitation numérique (souvent préfixé par 0029) pour un JID.
  if (/^120363\d{6,}$/.test(identifier)) return normalized;
  if (typeof socket?.newsletterMetadata !== 'function') {
    throw new Error('Impossible de résoudre le code d’invitation : newsletterMetadata indisponible sur NYXCORE');
  }
  const metadata = await socket.newsletterMetadata('invite', identifier);
  const canonicalJid = normaliseNewsletterJid(metadata?.id);
  if (!canonicalJid || !/^\d{6,}@newsletter$/.test(canonicalJid)) {
    throw new Error('Le lien de chaîne ne renvoie pas de JID newsletter canonique');
  }
  return canonicalJid;
}

function extractNewsletterServerId(message) {
  const value = message?.key?.server_id
    ?? message?.key?.serverId
    ?? message?.newsletterServerId;
  return value === undefined || value === null ? '' : String(value).trim();
}

const followedNewsletterChannels = new WeakMap();

async function ensureNewsletterFollow(socket, jid) {
  if (typeof socket?.newsletterFollow !== 'function') return false;
  let channels = followedNewsletterChannels.get(socket);
  if (!channels) {
    channels = new Map();
    followedNewsletterChannels.set(socket, channels);
  }
  if (channels.has(jid)) return channels.get(jid);
  const pending = Promise.resolve().then(() => socket.newsletterFollow(jid)).then(
    () => true,
    error => {
      channels.delete(jid);
      throw error;
    }
  );
  channels.set(jid, pending);
  return pending;
}

async function reactToNewsletterMessage(socket, jid, serverId, reaction, options = {}) {
  const normalizedJid = normaliseNewsletterJid(jid);
  const normalizedServerId = String(serverId || '').trim();
  const emoji = String(reaction || '').trim();
  if (!normalizedJid) throw new Error('JID de chaîne invalide');
  if (!normalizedServerId) throw new Error('Identifiant server_id de publication manquant');
  if (!emoji) throw new Error('Emoji de réaction manquant');
  if (typeof socket?.newsletterReactMessage !== 'function') {
    throw new Error('newsletterReactMessage indisponible sur le socket NYXCORE');
  }

  // Les deux appels existent dans Baileys/NYXCORE : newsletterFollow reçoit le
  // JID canonique, puis newsletterReactMessage cible le server_id de la publication.
  // Le suivi est mémorisé par socket pour ne pas répéter le WMex query à chaque réaction.
  if (options.ensureFollow) await ensureNewsletterFollow(socket, normalizedJid);
  await socket.newsletterReactMessage(normalizedJid, normalizedServerId, emoji);
  return { jid: normalizedJid, serverId: normalizedServerId, reaction: emoji };
}

async function reactAcrossNewsletterSockets(sessions, jid, serverId, reaction, onSuccess, options = {}) {
  const unique = new Map();
  for (const entry of Array.isArray(sessions) ? sessions : []) {
    const socket = entry?.socket || entry;
    if (!socket || unique.has(socket)) continue;
    unique.set(socket, String(entry?.session || socket?.user?.id || 'session-inconnue').split('@')[0]);
  }

  return Promise.all([...unique].map(async ([socket, session]) => {
    try {
      const result = await reactToNewsletterMessage(socket, jid, serverId, reaction, options);
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

function formatBReactSummary(succeeded, failed) {
  const sentCount = Number.isFinite(Number(succeeded)) ? Math.max(0, Math.floor(Number(succeeded))) : 0;
  const failedCount = Number.isFinite(Number(failed)) ? Math.max(0, Math.floor(Number(failed))) : 0;
  return `✅ Tâche accomplie.\nRéactions envoyées : ${sentCount}\nÉchecs : ${failedCount}`;
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
  formatBReactSummary,
  parseNewsletterMessageReference,
  resolveNewsletterJid,
  extractNewsletterServerId,
  ensureNewsletterFollow,
  reactToNewsletterMessage,
  reactAcrossNewsletterSockets,
  syncNewsletterSockets
};
