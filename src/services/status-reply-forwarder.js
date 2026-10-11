'use strict';

const { normalizedUserJid } = require('./status-audience');

const STATUS_JID = 'status@broadcast';
const MAX_KEYWORDS = 30;
const MAX_KEYWORD_LENGTH = 80;
const MAX_PROCESSED_MESSAGE_IDS = 2000;
const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'associatedChildMessage'
];

function unwrapMessageContent(message) {
  let current = message || {};
  for (let depth = 0; depth < 8; depth += 1) {
    let next = null;
    for (const wrapper of MESSAGE_WRAPPERS) {
      if (current?.[wrapper]?.message) {
        next = current[wrapper].message;
        break;
      }
    }
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function collectContextInfos(message) {
  const content = unwrapMessageContent(message?.message || message);
  const contexts = [];
  if (content?.messageContextInfo?.contextInfo) contexts.push(content.messageContextInfo.contextInfo);
  for (const value of Object.values(content || {})) {
    if (value && typeof value === 'object' && value.contextInfo && typeof value.contextInfo === 'object') {
      contexts.push(value.contextInfo);
    }
  }
  return contexts;
}

function statusKeyFromContext(contextInfo, fallbackKey = {}) {
  const placeholderKey = contextInfo?.placeholderKey || {};
  const quotedKey = contextInfo?.quotedMessage?.key || {};
  const statusQuotedKey = contextInfo?.statusQuotedMessage?.originalStatusId || {};
  const remoteJid = placeholderKey.remoteJid
    || quotedKey.remoteJid
    || statusQuotedKey.remoteJid
    || contextInfo?.remoteJid
    || STATUS_JID;
  const id = contextInfo?.stanzaId
    || placeholderKey.id
    || quotedKey.id
    || statusQuotedKey.id
    || '';
  const participant = contextInfo?.participant
    || contextInfo?.participantAlt
    || contextInfo?.remoteJidAlt
    || placeholderKey.participant
    || placeholderKey.participantAlt
    || quotedKey.participant
    || quotedKey.participantAlt
    || statusQuotedKey.participant
    || statusQuotedKey.participantAlt
    || '';
  return {
    remoteJid: remoteJid === STATUS_JID ? STATUS_JID : remoteJid,
    id: String(id),
    participant: participant ? String(participant) : undefined,
    fromMe: Boolean(placeholderKey.fromMe || quotedKey.fromMe || statusQuotedKey.fromMe || fallbackKey.fromMe)
  };
}

function isStatusContext(contextInfo = {}) {
  const keys = [contextInfo.remoteJid, contextInfo.placeholderKey?.remoteJid,
    contextInfo.quotedMessage?.key?.remoteJid,
    contextInfo.statusQuotedMessage?.originalStatusId?.remoteJid];
  return keys.includes(STATUS_JID)
    || contextInfo.statusSourceType !== undefined && contextInfo.statusSourceType !== null
    || contextInfo.statusAttributionType !== undefined && contextInfo.statusAttributionType !== null;
}

function findQuotedStatus(message) {
  const contexts = collectContextInfos(message);
  for (const contextInfo of contexts) {
    if (!isStatusContext(contextInfo)) continue;
    const key = statusKeyFromContext(contextInfo, message?.key);
    const quoted = contextInfo.quotedMessage
      || contextInfo.statusMentionMessage?.quotedStatus
      || message?.message?.statusMentionMessage?.quotedStatus;
    const content = unwrapMessageContent(quoted);
    if (!key.id || !content || typeof content !== 'object' || !Object.keys(content).length) continue;
    return {
      key: {
        remoteJid: STATUS_JID,
        fromMe: Boolean(key.fromMe),
        id: key.id,
        ...(key.participant ? { participant: key.participant } : {})
      },
      authorJid: key.participant || '',
      message: content,
      contextInfo
    };
  }

  // Some status replies/reshare flows carry the original key in a dedicated
  // protobuf field instead of the regular quoted-message context.
  const content = unwrapMessageContent(message?.message);
  const originalKey = content?.statusQuestionAnswerMessage?.key
    || content?.statusNotificationMessage?.originalMessageKey;
  if (originalKey?.remoteJid === STATUS_JID && originalKey.id) {
    const quoted = content.statusMentionMessage?.quotedStatus;
    const statusContent = unwrapMessageContent(quoted);
    if (statusContent && Object.keys(statusContent).length) {
      return {
        key: {
          remoteJid: STATUS_JID,
          fromMe: Boolean(originalKey.fromMe),
          id: String(originalKey.id),
          ...(originalKey.participant ? { participant: String(originalKey.participant) } : {})
        },
        authorJid: String(originalKey.participant || ''),
        message: statusContent,
        contextInfo: null
      };
    }
  }

  return null;
}

function getMessageText(message) {
  const content = unwrapMessageContent(message?.message || message);
  const candidates = [
    content?.conversation,
    content?.extendedTextMessage?.text,
    content?.imageMessage?.caption,
    content?.videoMessage?.caption,
    content?.documentMessage?.caption,
    content?.audioMessage?.caption,
    content?.statusQuestionAnswerMessage?.text,
    content?.questionResponseMessage?.text,
    content?.buttonsResponseMessage?.selectedDisplayText,
    content?.templateButtonReplyMessage?.selectedDisplayText,
    content?.listResponseMessage?.title,
    content?.interactiveResponseMessage?.body?.text
  ];
  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseKeywords(values) {
  const input = Array.isArray(values) ? values : [values];
  const keywords = [];
  const invalid = [];
  const seen = new Set();
  for (const value of input) {
    for (const candidate of String(value || '').split(/[,;|]+/)) {
      const keyword = candidate.trim().replace(/\s+/g, ' ');
      const normalized = normalizeKeyword(keyword);
      if (!normalized) continue;
      if (keyword.length > MAX_KEYWORD_LENGTH) {
        invalid.push(keyword.slice(0, MAX_KEYWORD_LENGTH));
        continue;
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        keywords.push(keyword);
      }
    }
  }
  return { keywords, invalid };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingKeyword(text, keywords = []) {
  const normalizedText = normalizeKeyword(text);
  if (!normalizedText) return '';
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) continue;
    const phrase = normalized.split(' ').map(escapeRegExp).join('\\s+');
    const expression = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${phrase}(?=$|[^\\p{L}\\p{N}_])`, 'u');
    if (expression.test(normalizedText)) return String(keyword);
  }
  return '';
}

function getSelfJids(socket) {
  const me = socket?.authState?.creds?.me || {};
  const user = socket?.user || {};
  return new Set([
    user.id,
    user.lid,
    user.jid,
    user.phoneNumber,
    me.id,
    me.lid,
    me.phoneNumber
  ].map(normalizedUserJid).filter(Boolean));
}

function resolveReplyRecipient(message, selfJids = new Set()) {
  const key = message?.key || {};
  if (key.fromMe) return '';
  const remoteJid = String(key.remoteJid || '');
  const isGroup = remoteJid.endsWith('@g.us');
  const rawJid = isGroup
    ? (key.participantAlt || key.participant)
    : (key.remoteJidAlt || remoteJid);
  const recipient = normalizedUserJid(rawJid);
  if (!recipient || selfJids.has(recipient)) return '';
  return recipient;
}

function extractStatusReply(message, selfJids = new Set()) {
  if (!message?.key || !message?.message || message.key.fromMe) return null;
  const quotedStatus = findQuotedStatus(message);
  if (!quotedStatus) return null;
  const authorJid = normalizedUserJid(quotedStatus.authorJid || quotedStatus.key.participant);
  if (!authorJid || !selfJids.has(authorJid)) return null;
  const text = getMessageText(message);
  if (!text) return null;
  const recipient = resolveReplyRecipient(message, selfJids);
  if (!recipient) return null;
  return {
    ...quotedStatus,
    key: { ...quotedStatus.key, fromMe: true },
    authorJid,
    text,
    recipient
  };
}

function normalizeStoredKeywords(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;|]+/);
  return parseKeywords(source).keywords.slice(0, MAX_KEYWORDS);
}

function remember(set, value, maxSize = MAX_PROCESSED_MESSAGE_IDS) {
  if (!value) return;
  set.add(value);
  while (set.size > maxSize) set.delete(set.values().next().value);
}

function createStatusReplyForwarder({
  socket,
  loadSessionConfig = async () => ({}),
  logger = console
} = {}) {
  const inFlight = new Set();
  const forwardedIds = new Set();

  async function handleMessage(message) {
    const selfJids = getSelfJids(socket);
    const candidate = extractStatusReply(message, selfJids);
    if (!candidate) return { status: 'not-applicable' };
    const messageId = String(message.key.id || '');
    if (!messageId) return { status: 'missing-message-id' };
    if (forwardedIds.has(messageId) || inFlight.has(messageId)) return { status: 'duplicate' };
    inFlight.add(messageId);

    try {
      const config = await loadSessionConfig();
      if (!config?.STATUS_REPLY_FORWARD_ENABLED) return { status: 'disabled' };
      const keywords = normalizeStoredKeywords(config.STATUS_REPLY_KEYWORDS);
      if (!keywords.length) return { status: 'no-keywords' };
      const matchedKeyword = findMatchingKeyword(candidate.text, keywords);
      if (!matchedKeyword) return { status: 'no-match' };

      await socket.sendMessage(candidate.recipient, {
        forward: {
          key: candidate.key,
          message: candidate.message
        },
        force: true
      });
      remember(forwardedIds, messageId);
      return { status: 'forwarded', recipient: candidate.recipient, keyword: matchedKeyword };
    } catch (error) {
      logger.error?.('[STATUS REPLY SEND ERROR]', error?.message || error);
      return { status: 'error', error };
    } finally {
      inFlight.delete(messageId);
    }
  }

  async function handleUpsert(event = {}) {
    if (event.type && event.type !== 'notify') return [];
    const results = [];
    for (const message of event.messages || []) {
      results.push(await handleMessage(message));
    }
    return results;
  }

  return {
    handleMessage,
    handleUpsert,
    clearProcessedMessages() {
      forwardedIds.clear();
      inFlight.clear();
    },
    _test: { forwardedIds, inFlight }
  };
}

module.exports = {
  STATUS_JID,
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  unwrapMessageContent,
  collectContextInfos,
  statusKeyFromContext,
  isStatusContext,
  findQuotedStatus,
  getMessageText,
  normalizeKeyword,
  parseKeywords,
  findMatchingKeyword,
  getSelfJids,
  resolveReplyRecipient,
  extractStatusReply,
  normalizeStoredKeywords,
  createStatusReplyForwarder
};
