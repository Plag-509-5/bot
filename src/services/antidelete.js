'use strict';

const GROUP_SUFFIX = '@g.us';
const USER_SUFFIX = '@s.whatsapp.net';
const LID_SUFFIX = '@lid';
const EXCLUDED_CHAT_SUFFIXES = ['@newsletter', '@broadcast'];
const MEDIA_TYPES = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker']
];

function normaliseJid(value) {
  const raw = String(value || '').trim().toLowerCase().split(':')[0];
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  const number = raw.replace(/[^0-9]/g, '');
  return number ? `${number}${USER_SUFFIX}` : '';
}

function isGroupChat(chatId) {
  return normaliseJid(chatId).endsWith(GROUP_SUFFIX);
}

function isPrivateChat(chatId) {
  const jid = normaliseJid(chatId);
  if (!jid || isGroupChat(jid) || jid === 'status@broadcast') return false;
  return !EXCLUDED_CHAT_SUFFIXES.some(suffix => jid.endsWith(suffix));
}

function normaliseAntideleteMode(value) {
  if (value === true) return 'all';
  const mode = String(value || 'off').trim().toLowerCase();
  return ['all', 'g', 'p'].includes(mode) ? mode : 'off';
}

function modeAllowsChat(modeValue, chatId) {
  const mode = normaliseAntideleteMode(modeValue);
  if (mode === 'off') return false;
  if (mode === 'g') return isGroupChat(chatId);
  if (mode === 'p') return isPrivateChat(chatId);
  return isGroupChat(chatId) || isPrivateChat(chatId);
}

function unwrapMessage(message) {
  let current = message || {};
  let isViewOnce = false;
  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage'
  ];

  for (let depth = 0; depth < 8 && current; depth += 1) {
    const wrapper = wrappers.find(key => current[key]?.message);
    if (!wrapper) break;
    if (wrapper.startsWith('viewOnce')) isViewOnce = true;
    current = current[wrapper].message;
  }

  return { message: current || {}, isViewOnce };
}

function getMediaDescriptor(message) {
  const { message: content, isViewOnce } = unwrapMessage(message);
  for (const [key, type] of MEDIA_TYPES) {
    const node = content[key];
    if (!node) continue;
    return {
      key,
      type,
      node,
      isViewOnce,
      caption: String(node.caption || ''),
      mimetype: node.mimetype || '',
      fileName: node.fileName || `message-supprime.${type === 'sticker' ? 'webp' : 'bin'}`
    };
  }
  return null;
}

function getTextContent(message) {
  const { message: content } = unwrapMessage(message);
  return String(
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  );
}

function userJidCandidates(...values) {
  const result = [];
  const add = value => {
    if (Array.isArray(value)) return value.forEach(add);
    const jid = normaliseJid(value);
    if (!jid || isGroupChat(jid) || EXCLUDED_CHAT_SUFFIXES.some(suffix => jid.endsWith(suffix))) return;
    if (!result.includes(jid)) result.push(jid);
  };
  values.forEach(add);
  return result.sort((left, right) => {
    const rank = jid => jid.endsWith(USER_SUFFIX) ? 0 : jid.endsWith(LID_SUFFIX) ? 1 : 2;
    return rank(left) - rank(right);
  });
}

function chooseUserJid(...values) {
  return userJidCandidates(...values)[0] || '';
}

function resolveOriginalAuthor(storedMessage, chatId, ownerJid) {
  const key = storedMessage?.key || {};
  if (key.fromMe) return normaliseJid(ownerJid);
  if (isGroupChat(chatId)) {
    return chooseUserJid(key.participantAlt, key.participant, storedMessage?.participant);
  }
  return chooseUserJid(
    key.remoteJidAlt,
    key.participantAlt,
    storedMessage?.participantAlt,
    chatId,
    key.remoteJid
  );
}

function resolveRevoker(revokeMessage, chatId, ownerJid, fallbackAuthor = '') {
  const key = revokeMessage?.key || {};
  if (key.fromMe) return normaliseJid(ownerJid);
  if (isGroupChat(chatId)) {
    return chooseUserJid(
      key.participantAlt,
      key.participant,
      revokeMessage?.participantAlt,
      fallbackAuthor
    );
  }
  return chooseUserJid(
    key.remoteJidAlt,
    key.participantAlt,
    revokeMessage?.participantAlt,
    chatId,
    key.remoteJid,
    fallbackAuthor
  );
}

function jidLabel(jid) {
  const normalized = normaliseJid(jid);
  return normalized ? normalized.split('@')[0] : 'inconnu';
}

function cleanConversationName(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 120);
}

async function resolveConversationName(socket, chatId, storedMessage, revokeMessage) {
  if (isGroupChat(chatId)) {
    try {
      const metadata = await socket.groupMetadata(chatId);
      const subject = cleanConversationName(metadata?.subject);
      return subject || 'Groupe sans nom';
    } catch (_) {
      return 'Groupe WhatsApp';
    }
  }

  // Dans une discussion privée, pushName correspond au nom publié par le contact.
  // On évite volontairement d'afficher le LID brut comme nom de conversation.
  const storedName = storedMessage?.key?.fromMe ? '' : storedMessage?.pushName;
  const revokeName = revokeMessage?.key?.fromMe ? '' : revokeMessage?.pushName;
  return cleanConversationName(storedName || revokeName || storedMessage?.verifiedBizName) || 'Discussion privée';
}

function uniqueMentions(...jids) {
  return [...new Set(jids.map(normaliseJid).filter(jid => jid.endsWith(USER_SUFFIX) || jid.endsWith(LID_SUFFIX)))];
}

function buildAntideleteHeader({ revokerJid, authorJid, conversationName, timestamp, isViewOnce = false }) {
  const revoker = jidLabel(revokerJid);
  const author = jidLabel(authorJid);
  const differentAuthor = authorJid && normaliseJid(authorJid) !== normaliseJid(revokerJid);

  return `╭━━━━━━━━━━━━━━━━━━╮\n` +
    `┃  🗑️ *ANTIDELETE*\n` +
    `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
    `🗑️ *Supprimé par :* @${revoker}\n` +
    (differentAuthor ? `👤 *Auteur original :* @${author}\n` : '') +
    `💬 *Conversation :* ${cleanConversationName(conversationName) || 'Discussion privée'}\n` +
    `⏰ *Heure :* ${timestamp}\n` +
    (isViewOnce ? `👁️ *Type d'origine :* Vue unique récupérée\n` : '') +
    `━━━━━━━━━━━━━━━━━━`;
}

async function streamToBuffer(streamOrBuffer, maxBytes = 100 * 1024 * 1024) {
  if (Buffer.isBuffer(streamOrBuffer)) return streamOrBuffer;
  if (!streamOrBuffer || typeof streamOrBuffer[Symbol.asyncIterator] !== 'function') {
    throw new Error('Le téléchargement du média n’a renvoyé aucune donnée.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of streamOrBuffer) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) throw new Error('Le média supprimé dépasse la limite de récupération (100 MB).');
    chunks.push(data);
  }
  if (!size) throw new Error('Le média supprimé est vide.');
  return Buffer.concat(chunks);
}

async function downloadDeletedMedia(socket, storedMessage, descriptor, downloadContent) {
  try {
    const stream = await downloadContent(descriptor.node, descriptor.type);
    return await streamToBuffer(stream);
  } catch (error) {
    // Le wrapper downloadMediaMessage historique écrit des fichiers temporaires
    // et attend un objet sms() différent du WebMessageInfo stocké. On ne
    // l'utilise donc pas ici; copyNForward reste le fallback sans effet disque.
    throw error || new Error('Média supprimé indisponible.');
  }
}

function captionWithOriginal(header, caption) {
  const cleanCaption = String(caption || '').trim();
  return cleanCaption ? `${header}\n\n📝 *Légende originale :*\n${cleanCaption}` : header;
}

async function sendRecoveredMessage({
  socket,
  ownerJid,
  storedMessage,
  header,
  mentions = [],
  downloadContent
}) {
  const descriptor = getMediaDescriptor(storedMessage?.message);
  const options = {};

  if (descriptor) {
    try {
      const buffer = await downloadDeletedMedia(socket, storedMessage, descriptor, downloadContent);
      const commonCaption = captionWithOriginal(header, descriptor.caption);
      if (descriptor.type === 'image') {
        await socket.sendMessage(ownerJid, { image: buffer, caption: commonCaption, mentions });
      } else if (descriptor.type === 'video') {
        await socket.sendMessage(ownerJid, {
          video: buffer,
          caption: commonCaption,
          mimetype: descriptor.mimetype || 'video/mp4',
          gifPlayback: Boolean(descriptor.node.gifPlayback),
          mentions
        });
      } else if (descriptor.type === 'document') {
        await socket.sendMessage(ownerJid, {
          document: buffer,
          caption: commonCaption,
          mimetype: descriptor.mimetype || 'application/octet-stream',
          fileName: descriptor.fileName,
          mentions
        });
      } else {
        // WhatsApp n'accepte pas de légende sur un audio ou un sticker.
        await socket.sendMessage(ownerJid, { text: header, mentions });
        if (descriptor.type === 'audio') {
          await socket.sendMessage(ownerJid, {
            audio: buffer,
            mimetype: descriptor.mimetype || 'audio/ogg; codecs=opus',
            ptt: Boolean(descriptor.node.ptt)
          });
        } else {
          await socket.sendMessage(ownerJid, { sticker: buffer });
        }
      }
      return { method: 'media', type: descriptor.type };
    } catch (error) {
      options.mediaError = error;
      // Le téléchargement direct est prioritaire. Si le CDN refuse le média,
      // on tente encore le mécanisme de transfert Baileys avant d'abandonner.
      await socket.sendMessage(ownerJid, {
        text: captionWithOriginal(header, descriptor.caption),
        mentions
      });
      if (typeof socket.copyNForward === 'function') {
        await socket.copyNForward(ownerJid, storedMessage, true);
      } else {
        await socket.sendMessage(ownerJid, { forward: storedMessage });
      }
      return { method: 'forward', type: descriptor.type, mediaError: error };
    }
  }

  const text = getTextContent(storedMessage?.message);
  if (text) {
    await socket.sendMessage(ownerJid, {
      text: `${header}\n\n📝 *Message supprimé :*\n${text}`,
      mentions
    });
    return { method: 'text', type: 'text', mediaError: options.mediaError };
  }

  // Dernier recours pour les contacts, localisations, sondages et nouveaux types
  // de messages que Baileys sait transférer mais que ce module ne connaît pas encore.
  await socket.sendMessage(ownerJid, { text: header, mentions });
  if (typeof socket.copyNForward === 'function') {
    await socket.copyNForward(ownerJid, storedMessage, true);
    return { method: 'forward', type: 'unknown', mediaError: options.mediaError };
  }
  await socket.sendMessage(ownerJid, { forward: storedMessage });
  return { method: 'forward', type: 'unknown', mediaError: options.mediaError };
}

module.exports = {
  normaliseJid,
  isGroupChat,
  isPrivateChat,
  normaliseAntideleteMode,
  modeAllowsChat,
  unwrapMessage,
  getMediaDescriptor,
  getTextContent,
  chooseUserJid,
  resolveOriginalAuthor,
  resolveRevoker,
  resolveConversationName,
  uniqueMentions,
  buildAntideleteHeader,
  streamToBuffer,
  sendRecoveredMessage
};
