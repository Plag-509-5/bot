'use strict';

const { normalizedUserJid } = require('../../services/status-audience');
const {
  collectContextInfos,
  findQuotedStatus
} = require('../../services/status-reply-forwarder');
const { extractViewOnceMedia } = require('../../services/view-once-media');

const VIEW_ONCE_ALIASES = new Set(['vv', 'rvo', 'readviewonce']);
const MAX_VIEW_ONCE_MEDIA_BYTES = 100 * 1024 * 1024;
const VIEW_ONCE_DEFAULTS = {
  image: { mimetype: 'image/jpeg', fileName: 'view-once.jpg', caption: '📷 Vue unique déballée' },
  video: { mimetype: 'video/mp4', fileName: 'view-once.mp4', caption: '🎥 Vue unique déballée' },
  audio: { mimetype: 'audio/mpeg', fileName: 'view-once.mp3', caption: '🎧 Vue unique déballée' },
  document: { mimetype: 'application/octet-stream', fileName: 'view-once', caption: '📎 Vue unique déballée' },
  sticker: { mimetype: 'image/webp', fileName: 'view-once.webp', caption: '✨ Sticker vue unique déballé' }
};

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

async function collectMediaStream(stream, maxBytes = MAX_VIEW_ONCE_MEDIA_BYTES) {
  if (Buffer.isBuffer(stream)) return stream;
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new Error('Le téléchargeur Baileys n’a pas retourné de flux média valide.');
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        stream.destroy?.();
        throw new Error(`Le média dépasse la limite de sécurité de ${Math.round(maxBytes / 1024 / 1024)} Mo.`);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    stream.destroy?.();
    throw error;
  }
  return Buffer.concat(chunks, size);
}

function getCommandName(context) {
  if (context?.command) return String(context.command).toLowerCase();
  return String(context?.body || '').trim().split(/\s+/)[0].replace(/^[./!#]+/, '').toLowerCase();
}

function buildViewOncePayload(extracted, buffer, { includeUnwrappedNotice = false } = {}) {
  const defaults = VIEW_ONCE_DEFAULTS[extracted.type];
  const mimetype = extracted.content.mimetype || defaults.mimetype;
  const fileName = extracted.content.fileName || defaults.fileName;
  const originalCaption = extracted.content.caption || '';
  const caption = includeUnwrappedNotice
    ? (originalCaption ? `${originalCaption}\n\n${defaults.caption}` : defaults.caption)
    : originalCaption;
  const captionField = caption ? { caption } : {};

  switch (extracted.type) {
    case 'image':
      return { image: buffer, ...captionField, mimetype };
    case 'video':
      return { video: buffer, ...captionField, mimetype, fileName };
    case 'audio':
      return { audio: buffer, mimetype, ptt: Boolean(extracted.content.ptt) };
    case 'document':
      return { document: buffer, mimetype, fileName, ...captionField };
    case 'sticker':
      return { sticker: buffer, mimetype };
    default:
      throw new Error('Type de média non pris en charge pour une vue unique.');
  }
}

async function executeViewOnce(context, quoted) {
  const { socket, msg, downloadContentFromMessage } = context;
  const chatId = context?.from || msg?.key?.remoteJid;
  if (!chatId) throw new Error('Conversation d’origine introuvable.');

  if (!quoted) {
    return socket.sendMessage(chatId, {
      text: '❗ Réponds à une image, vidéo, audio, document ou sticker en vue unique avec .vv.'
    }, { quoted: msg });
  }

  const extracted = extractViewOnceMedia(quoted);
  if (!extracted || !extracted.isViewOnce) {
    return socket.sendMessage(chatId, {
      text: '❌ Le message cité ne contient pas de média en vue unique reconnu.'
    }, { quoted: msg });
  }
  if (typeof downloadContentFromMessage !== 'function') {
    throw new Error('Le téléchargeur média Baileys n’est pas disponible pour cette session.');
  }

  if (msg?.key) {
    await socket.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});
  }

  const stream = await downloadContentFromMessage(extracted.content, extracted.type);
  const buffer = await collectMediaStream(stream);
  if (!buffer.length) throw new Error('Le flux view-once téléchargé est vide.');

  const payload = buildViewOncePayload(extracted, buffer, { includeUnwrappedNotice: true });

  const sent = await socket.sendMessage(chatId, payload, { quoted: msg });
  if (!sent) throw new Error('WhatsApp n’a pas confirmé l’envoi du média.');
  if (msg?.key) {
    await socket.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});
  }
  return sent;
}

module.exports = {
  name: 'save',
  alias: ['sauvegarder', 'vv', 'rvo', 'readviewonce'],
  category: 'tools',
  description: 'Transfère .save dans le chat « Vous »; .vv déballe une vue unique dans le chat courant',
  usage: '.save (statut/média) | .vv (en répondant à une vue unique)',
  async execute(context) {
    const { socket, msg, from, quotedMsg } = context;
    const quoted = quotedMsg
      || msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage
      || msg?.message?.stickerMessage?.contextInfo?.quotedMessage
      || msg?.message?.imageMessage?.contextInfo?.quotedMessage
      || msg?.message?.videoMessage?.contextInfo?.quotedMessage
      || msg?.quoted?.msg;

    if (VIEW_ONCE_ALIASES.has(getCommandName(context))) {
      try {
        return await executeViewOnce(context, quoted);
      } catch (error) {
        console.error('[READVIEWONCE ERROR]', error);
        const chatId = from || msg?.key?.remoteJid;
        if (!chatId) return null;
        if (msg?.key) {
          await socket.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
        }
        await socket.sendMessage(chatId, {
          text: `❌ Impossible de déballer la vue unique : ${error?.message || error}`
        }, { quoted: msg });
        return null;
      }
    }

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
      const viewOnceMedia = extractViewOnceMedia(source);
      if ((viewOnceMedia?.isViewOnce || context.isReactionCommand) && viewOnceMedia
          && typeof context.downloadContentFromMessage === 'function') {
        const stream = await context.downloadContentFromMessage(viewOnceMedia.content, viewOnceMedia.type);
        const buffer = await collectMediaStream(stream);
        if (!buffer.length) throw new Error('Le flux view-once téléchargé est vide.');
        const payload = buildViewOncePayload(viewOnceMedia, buffer);
        const saved = await socket.sendMessage(selfJid, payload);
        if (!saved) throw new Error('WhatsApp n’a pas confirmé la sauvegarde du média.');
        if (msg?.key && from) {
          await socket.sendMessage(from, { react: { text: '💾', key: msg.key } }).catch(() => {});
        }
        return saved;
      }

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
  _test: {
    unwrapForSave,
    getQuotedMessageFromContext,
    makeForwardKey,
    collectMediaStream,
    executeViewOnce,
    getCommandName
  }
};
