'use strict';

const { normalizedUserJid } = require('../../services/status-audience');
const {
  collectContextInfos,
  findQuotedStatus
} = require('../../services/status-reply-forwarder');

const VIEW_ONCE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage'
];

function unwrapForSave(message) {
  let current = message || {};
  let isViewOnce = false;
  for (let depth = 0; depth < 8; depth += 1) {
    let next = null;
    for (const wrapper of VIEW_ONCE_WRAPPERS) {
      if (!current?.[wrapper]?.message) continue;
      if (wrapper.startsWith('viewOnce')) isViewOnce = true;
      next = current[wrapper].message;
      break;
    }
    if (!next || next === current) break;
    current = next;
  }
  const content = { ...current };
  if (content.imageMessage) {
    content.imageMessage = { ...content.imageMessage, viewOnce: false };
  }
  if (content.videoMessage) {
    content.videoMessage = { ...content.videoMessage, viewOnce: false };
  }
  return { content, isViewOnce };
}

function getQuotedMessageFromContext(message) {
  return collectContextInfos(message).find(contextInfo => contextInfo?.quotedMessage) || null;
}

function makeForwardKey({ message, from, quotedContext, statusQuote, selfJid }) {
  if (statusQuote?.key?.id) {
    return {
      ...statusQuote.key,
      remoteJid: 'status@broadcast',
      fromMe: normalizedUserJid(statusQuote.authorJid) === selfJid
    };
  }

  const quoteKey = message?.quoted?.key || {};
  const contextInfo = quotedContext || {};
  const participant = contextInfo.participant || quoteKey.participant || '';
  const sender = normalizedUserJid(participant || quoteKey.remoteJid);
  const id = contextInfo.stanzaId || quoteKey.id || `SAVE_${Date.now()}`;
  return {
    remoteJid: contextInfo.remoteJid || quoteKey.remoteJid || from,
    fromMe: Boolean(sender && sender === selfJid) || Boolean(quoteKey.fromMe),
    id: String(id),
    ...(participant ? { participant: String(participant) } : {})
  };
}

module.exports = {
  name: 'save',
  alias: ['sauvegarder', 'vv', 'rvo', 'readviewonce'],
  category: 'tools',
  description: 'Transfère un statut ou un média éphémère dans le chat « Vous » du compte du bot',
  usage: '.save (en répondant à un média, statut ou vue unique)',
  async execute(context) {
    const { socket, msg, from, quotedMsg } = context;
    const quoted = quotedMsg
      || msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage
      || msg?.message?.stickerMessage?.contextInfo?.quotedMessage
      || msg?.message?.imageMessage?.contextInfo?.quotedMessage
      || msg?.message?.videoMessage?.contextInfo?.quotedMessage
      || msg?.quoted?.msg;
    const statusQuote = findQuotedStatus(msg);

    if (!quoted && !statusQuote) {
      return socket.sendMessage(from, {
        text: '❌ *Réponds à un média (photo, vidéo, audio, statut ou vue unique) avec .save.*'
      }, { quoted: msg });
    }

    try {
      const selfJid = normalizedUserJid(socket?.user?.id);
      if (!selfJid) throw new Error('JID du compte du bot indisponible.');

      const quotedContext = getQuotedMessageFromContext(msg);
      const source = statusQuote?.message || quoted;
      const { content } = unwrapForSave(source);
      if (!content || typeof content !== 'object' || !Object.keys(content).length) {
        throw new Error('Le contenu cité est vide ou indisponible.');
      }

      const forwardKey = makeForwardKey({
        message: msg,
        from,
        quotedContext,
        statusQuote,
        selfJid
      });
      const forwarded = await socket.sendMessage(selfJid, {
        forward: {
          key: forwardKey,
          message: content
        },
        force: true
      });
      if (!forwarded) throw new Error('WhatsApp n’a pas confirmé le transfert.');

      if (msg?.key) {
        await socket.sendMessage(from, {
          react: { text: '💾', key: msg.key }
        }).catch(() => {});
      }
      return forwarded;
    } catch (error) {
      console.error('[SAVE PLUGIN ERROR]', error);
      await socket.sendMessage(from, {
        text: `❌ Impossible de transférer le message dans le chat « Vous » : ${error?.message || error}`
      }, { quoted: msg });
      return null;
    }
  },
  _test: { unwrapForSave, getQuotedMessageFromContext, makeForwardKey }
};
