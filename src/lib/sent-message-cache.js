'use strict';

/**
 * sent-message-cache.js — mémoire des derniers messages envoyés par le bot.
 *
 * Pourquoi ce module existe
 * -------------------------
 * Quand le téléphone d'un destinataire n'arrive pas à déchiffrer un message,
 * il envoie une « demande de renvoi » (retry receipt). Baileys doit alors
 * retrouver le contenu original du message pour le ré-encrypter. Cela passe par
 * l'option `getMessage` de `makeWASocket`, dont la valeur par défaut renvoie
 * toujours `undefined` : le renvoi échoue en silence et le message reste
 * « en attente » côté destinataire.
 *
 * Ce cache garde les derniers messages envoyés (borne de taille + durée de vie),
 * indexés par `remoteJid|id`, comme le fait whatsmeow.
 */

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 h

function cacheKey(jid, id) {
  return `${String(jid)}|${String(id)}`;
}

function createSentMessageCache({
  maxEntries = DEFAULT_MAX_ENTRIES,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now()
} = {}) {
  // Map conserve l'ordre d'insertion : la première entrée est la plus ancienne.
  const entries = new Map();

  function prune() {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  /** Mémorise le contenu d'un message envoyé (objet WAMessage renvoyé par sendMessage). */
  function remember(sent) {
    const key = sent && sent.key;
    if (!key || !key.id || !key.remoteJid || !sent.message) return false;
    const k = cacheKey(key.remoteJid, key.id);
    entries.delete(k); // réinsertion en fin de file
    entries.set(k, { message: sent.message, expiresAt: now() + ttlMs });
    prune();
    return true;
  }

  /** Message à renvoyer pour une clé `{ remoteJid, id }`, ou `undefined`. */
  function get(key) {
    if (!key || !key.id || !key.remoteJid) return undefined;
    const k = cacheKey(key.remoteJid, key.id);
    const entry = entries.get(k);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(k);
      return undefined;
    }
    return entry.message;
  }

  return {
    remember,
    get,
    size: () => {
      prune();
      return entries.size;
    }
  };
}

/**
 * Enveloppe `socket.sendMessage` pour alimenter le cache à chaque envoi réussi.
 * À appliquer AVANT les autres wrappers (safe-send, thème, traduction) : il
 * doit voir le WAMessage brut renvoyé par Baileys.
 */
function recordSentMessages(socket, cache) {
  if (!socket || typeof socket.sendMessage !== 'function') return socket;
  const original = socket.sendMessage.bind(socket);
  socket.sendMessage = async (jid, content, options) => {
    const sent = await original(jid, content, options);
    try { cache.remember(sent); } catch (err) { /* le cache ne doit jamais casser un envoi */ }
    return sent;
  };
  return socket;
}

module.exports = {
  createSentMessageCache,
  recordSentMessages,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS
};
