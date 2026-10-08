'use strict';

const {
  normaliseNewsletterJid,
  normaliseEmojiList,
  resolveNewsletterEmojis
} = require('./newsletter-config');

function normaliseServerId(value) {
  // Ne pas convertir en Number : les identifiants peuvent dépasser 2^53.
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const id = String(value ?? '').trim();
  return /^[1-9]\d*$/.test(id) ? id : '';
}

function newsletterServerId(message) {
  // xzcbailz 1.0.6 expose server_id dans la clé de decodeMessageNode.
  // D'autres forks / notifications exposent newsletterServerId ou un id
  // numérique. Un ID local alphanumérique n'est JAMAIS un server_id valide.
  const candidates = [
    message?.key?.server_id,
    message?.newsletterServerId,
    message?.server_id,
    message?.key?.serverId,
    message?.key?.id
  ];
  return candidates.map(normaliseServerId).find(Boolean) || '';
}

/** Résout un lien de post, un JID/id ou un invite/id en JID NUMÉRIQUE/id. */
async function resolveNewsletterPost(socket, reference) {
  const raw = String(reference || '').trim();
  let channel;
  let id;
  if (/^(?:https?:\/\/|(?:www\.)?whatsapp\.com\/)/i.test(raw)) {
    let url;
    try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { }
    const match = url?.pathname.match(/^\/channel\/([A-Za-z0-9_-]+)\/([1-9]\d*)\/?$/);
    if (!url || !['whatsapp.com', 'www.whatsapp.com'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port || !match) {
      throw new Error('Lien de publication WhatsApp invalide');
    }
    [, channel, id] = match;
  } else {
    const match = raw.match(/^([A-Za-z0-9_-]+(?:@newsletter)?)\/([1-9]\d*)$/);
    if (!match) throw new Error('Utilise un lien de post ou <jid_chaîne/id_message>');
    [, channel, id] = match;
  }
  const messageId = normaliseServerId(id);
  let channelJid = normaliseNewsletterJid(channel);
  if (!channelJid) {
    if (channel.includes('@') || /^\d+$/.test(channel)) throw new Error('JID de chaîne invalide');
    if (typeof socket?.newsletterMetadata !== 'function') throw new Error('Résolution du lien de chaîne indisponible');
    // Le code d'invitation 0029... n'est PAS le JID de la chaîne.
    const metadata = await socket.newsletterMetadata('invite', channel);
    channelJid = normaliseNewsletterJid(metadata?.id);
    if (!channelJid) throw new Error('Le lien ne correspond pas à une chaîne accessible');
  }
  return { channelJid, messageId };
}

/**
 * Traite tous les posts d'un upsert. Dépendances Mongo et délai injectés pour
 * pouvoir tester le handler sans lancer pair.js ni accéder au réseau.
 */
function createNewsletterReactionHandler(socket, {
  sessionNumber,
  listNewsletters,
  listReactionConfigs,
  saveReaction = async () => {},
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  logger = console,
  maxRemembered = 500
}) {
  const pointers = new Map();
  const reacted = new Map();
  let queue = Promise.resolve();

  async function processBatch({ messages = [] } = {}) {
    const posts = messages.filter(message => normaliseNewsletterJid(message?.key?.remoteJid)
      && !message.key.fromMe && message.message
      && !message.message.reactionMessage && !message.message.protocolMessage);
    if (!posts.length) return [];
    const [followedDocs, oldConfigs] = await Promise.all([listNewsletters(), listReactionConfigs()]);
    const followed = new Map((followedDocs || []).map(item => [normaliseNewsletterJid(item.jid), item]));
    const alternate = new Map((oldConfigs || []).map(item => [normaliseNewsletterJid(item.jid), normaliseEmojiList(item.emojis)]));
    const results = [];

    for (const message of posts) {
      const jid = normaliseNewsletterJid(message.key.remoteJid);
      if (!followed.has(jid) && !alternate.has(jid)) continue;
      const serverId = newsletterServerId(message);
      if (!serverId) {
        logger.warn?.(`[NEWSLETTER] Post ignoré : server_id absent (${jid})`);
        continue;
      }
      const key = `${jid}/${serverId}`;
      if (reacted.has(key)) continue;
      const emojis = resolveNewsletterEmojis(followed.get(jid)?.emojis, alternate.get(jid));
      const index = pointers.get(jid) || 0;
      const emoji = emojis[index % emojis.length];
      let sent = false;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          if (typeof socket.newsletterReactMessage !== 'function') throw new Error('Réactions de chaîne indisponibles');
          await socket.newsletterReactMessage(jid, serverId, emoji);
          sent = true;
          break;
        } catch (error) {
          lastError = error;
          logger.warn?.(`[NEWSLETTER] Réaction échouée (${attempt}/3) : ${error?.message || error}`);
          if (attempt < 3) await delay(1200);
        }
      }
      if (!sent) {
        results.push({ jid, serverId, ok: false, error: lastError?.message });
        continue;
      }
      logger.info?.(`[NEWSLETTER] Réaction envoyée : ${jid}/${serverId} ${emoji}`);
      pointers.set(jid, (index + 1) % emojis.length);
      reacted.set(key, true);
      while (reacted.size > maxRemembered) reacted.delete(reacted.keys().next().value);
      // Un échec Mongo ne doit pas renvoyer trois fois une réaction déjà partie.
      try { await saveReaction(jid, serverId, emoji, sessionNumber || null); }
      catch (error) { logger.warn?.(`[NEWSLETTER] Journalisation impossible : ${error?.message || error}`); }
      results.push({ jid, serverId, emoji, ok: true });
    }
    return results;
  }

  return payload => {
    // Les listeners async d'EventEmitter ne sont pas attendus. Cette file
    // préserve l'ordre des emojis et évite deux réactions sur le même post.
    const task = queue.then(() => processBatch(payload)).catch(error => {
      logger.error?.('[NEWSLETTER] Handler :', error?.message || error);
      return [];
    });
    queue = task;
    return task;
  };
}

module.exports = {
  normaliseServerId,
  newsletterServerId,
  resolveNewsletterPost,
  createNewsletterReactionHandler
};
