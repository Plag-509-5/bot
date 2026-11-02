'use strict';

const { createHash } = require('node:crypto');
const {
  normaliseNewsletterJid,
  parseNewsletterMessageReference,
  resolveNewsletterJid
} = require('./newsletter-config');

const PERCENT_EPSILON = 1e-8;

function parseBPollInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Forme recommandée : <lien-de-publication> | <options>. La forme sans lien
  // reste acceptée pour compatibilité avec le vote en répondant à un sondage.
  let reference = null;
  let choiceInput = raw;
  const separator = raw.indexOf('|');
  if (separator >= 0) {
    reference = parseNewsletterMessageReference(raw.slice(0, separator).trim());
    choiceInput = raw.slice(separator + 1).trim();
    if (!reference) return null;
  }

  const pieces = choiceInput.split(',').map(piece => piece.trim());
  if (pieces.some(piece => !piece)) return null;

  const choices = [];
  if (pieces.length === 1 && /^\d+$/.test(pieces[0])) {
    const option = Number(pieces[0]);
    if (!Number.isSafeInteger(option) || option < 1) return null;
    return { ...(reference || {}), choices: [{ option, percent: 100 }] };
  }

  for (const piece of pieces) {
    const match = piece.match(/^(\d+)\s*\(\s*(\d+(?:\.\d{1,2})?)\s*%?\s*\)$/);
    if (!match) return null;
    const option = Number(match[1]);
    const percent = Number(match[2]);
    if (!Number.isSafeInteger(option) || option < 1 || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return null;
    }
    if (choices.some(choice => choice.option === option)) return null;
    choices.push({ option, percent });
  }

  const total = choices.reduce((sum, choice) => sum + choice.percent, 0);
  if (Math.abs(total - 100) > PERCENT_EPSILON) return null;
  return { ...(reference || {}), choices };
}

/**
 * Largest-remainder allocation (Hamilton method): floors exact quotas, then
 * awards remaining sessions by descending fractional remainder; ties follow
 * the option order in the command. This always assigns every session once.
 */
function allocateBPollVotes(sessionCount, choices) {
  const count = Number(sessionCount);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Nombre de sessions invalide');
  if (!Array.isArray(choices) || !choices.length) throw new Error('Répartition de vote vide');
  const total = choices.reduce((sum, choice) => sum + Number(choice.percent), 0);
  if (Math.abs(total - 100) > PERCENT_EPSILON) throw new Error('Les pourcentages doivent totaliser 100 %');

  const quotas = choices.map((choice, index) => {
    const exact = count * Number(choice.percent) / 100;
    const allocated = Math.floor(exact);
    return { option: Number(choice.option), allocated, remainder: exact - allocated, index };
  });
  let remaining = count - quotas.reduce((sum, quota) => sum + quota.allocated, 0);
  const priority = [...quotas].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i += 1) priority[i % priority.length].allocated += 1;

  const result = [];
  for (const quota of quotas) {
    for (let i = 0; i < quota.allocated; i += 1) result.push(quota.option);
  }
  return result;
}

function unwrapMessage(message) {
  let current = message || {};
  for (let i = 0; i < 6; i += 1) {
    const nested = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.documentWithCaptionMessage?.message
      || current.deviceSentMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}

function findPollContent(message) {
  const unwrapped = unwrapMessage(message);
  const candidates = [
    ['pollCreationMessage', unwrapped.pollCreationMessage],
    ['pollCreationMessageV2', unwrapped.pollCreationMessageV2],
    ['pollCreationMessageV3', unwrapped.pollCreationMessageV3],
    ['pollResultSnapshotMessage', unwrapped.pollResultSnapshotMessage]
  ];
  return candidates.find(([, content]) => content)?.[1] || null;
}

function getPollOptionNames(pollMessage) {
  const poll = findPollContent(pollMessage);
  if (!poll) return [];
  const options = Array.isArray(poll.options)
    ? poll.options
    : Array.isArray(poll.pollVotes)
      ? poll.pollVotes
      : [];
  // Preserve the exact option bytes: WhatsApp hashes optionName as UTF-8 without trimming.
  return options.map(option => String(option?.optionName ?? '')).filter(name => name.length > 0);
}

function collectNewsletterMessages(value, serverId, matched = [], inheritedMatch = false, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || Buffer.isBuffer(value) || value instanceof Uint8Array) return matched;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) collectNewsletterMessages(child, serverId, matched, inheritedMatch, seen);
    return matched;
  }

  const currentId = value.attrs?.server_id ?? value.server_id ?? value.serverId;
  const isMatch = inheritedMatch || (currentId !== undefined && String(currentId) === String(serverId));
  if (isMatch && (value.tag === 'message' || value.message || value.pollCreationMessage || value.pollResultSnapshotMessage)) {
    matched.push(value);
  }
  if (Array.isArray(value.content)) {
    for (const child of value.content) collectNewsletterMessages(child, serverId, matched, isMatch, seen);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'attrs' || key === 'content') continue;
    if (child && typeof child === 'object') collectNewsletterMessages(child, serverId, matched, isMatch, seen);
  }
  return matched;
}

function findPlaintextPayloads(value, payloads = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || Buffer.isBuffer(value) || value instanceof Uint8Array) return payloads;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) findPlaintextPayloads(child, payloads, seen);
    return payloads;
  }
  if (value.tag === 'plaintext' && (Buffer.isBuffer(value.content) || value.content instanceof Uint8Array)) {
    payloads.push(Buffer.from(value.content));
  }
  if (Array.isArray(value.content)) {
    for (const child of value.content) findPlaintextPayloads(child, payloads, seen);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'attrs' || key === 'content') continue;
    if (child && typeof child === 'object') findPlaintextPayloads(child, payloads, seen);
  }
  return payloads;
}

function getNewsletterPollOptionsFromHistory(history, serverId, decodeMessage) {
  const candidates = collectNewsletterMessages(history, serverId);
  for (const candidate of candidates) {
    const direct = getPollOptionNames(candidate.message || candidate);
    if (direct.length) return direct;
    for (const payload of findPlaintextPayloads(candidate)) {
      try {
        const decoded = decodeMessage(payload);
        const names = getPollOptionNames(decoded);
        if (names.length) return names;
      } catch (_) {
        // Une publication non-poll ou une enveloppe inconnue; tenter les autres.
      }
    }
  }
  return [];
}

async function fetchNewsletterPollOptions(socket, reference, decodeMessage) {
  if (typeof socket?.newsletterFetchMessages !== 'function') {
    throw new Error('newsletterFetchMessages indisponible sur le socket Baileys');
  }
  if (typeof decodeMessage !== 'function') throw new Error('Décodeur protobuf Baileys indisponible');
  const target = {
    jid: await resolveNewsletterJid(socket, reference),
    serverId: String(reference?.serverId || '').trim()
  };
  if (!/^\d+$/.test(target.serverId)) throw new Error('Le server_id du lien doit être numérique');

  const after = String(Math.max(0, Number(target.serverId) - 1));
  const responses = [
    await socket.newsletterFetchMessages(target.jid, 10, undefined, after)
  ];
  let optionNames = getNewsletterPollOptionsFromHistory(responses[0], target.serverId, decodeMessage);
  if (!optionNames.length) {
    responses.push(await socket.newsletterFetchMessages(target.jid, 100, undefined, undefined));
    optionNames = getNewsletterPollOptionsFromHistory(responses[1], target.serverId, decodeMessage);
  }
  if (!optionNames.length) throw new Error('La publication liée est introuvable ou ne contient pas de sondage lisible');
  return { ...target, optionNames };
}

function findForwardedNewsletterInfo(...values) {
  const queue = [...values];
  const seen = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const info = value.forwardedNewsletterMessageInfo
      || value.contextInfo?.forwardedNewsletterMessageInfo;
    if (info?.newsletterJid && info?.serverMessageId !== undefined && info?.serverMessageId !== null) return info;
    if (value.message && typeof value.message === 'object') queue.push(value.message);
    if (value.quotedMessage && typeof value.quotedMessage === 'object') queue.push(value.quotedMessage);
    if (value.contextInfo && typeof value.contextInfo === 'object') queue.push(value.contextInfo);
    if (value.pollResultSnapshotMessage && typeof value.pollResultSnapshotMessage === 'object') queue.push(value.pollResultSnapshotMessage);
    if (value.pollCreationMessage && typeof value.pollCreationMessage === 'object') queue.push(value.pollCreationMessage);
  }
  return null;
}

function resolveBPollTarget({ pollMessage, quotedContext, chatJid, quotedKey } = {}) {
  const forwarded = findForwardedNewsletterInfo(pollMessage, quotedContext);
  let jid = forwarded?.newsletterJid || '';
  let serverId = forwarded?.serverMessageId;

  const pollKey = quotedKey || pollMessage?.key || {};
  if (!jid) {
    const contextJid = quotedContext?.remoteJid || pollKey.remoteJid || chatJid || '';
    if (String(contextJid).toLowerCase().endsWith('@newsletter')) jid = contextJid;
  }
  if (serverId === undefined || serverId === null || serverId === '') {
    serverId = pollKey.server_id ?? pollKey.serverId ?? quotedContext?.server_id ?? quotedContext?.serverId;
    if ((serverId === undefined || serverId === null || serverId === '')
      && String(jid).toLowerCase().endsWith('@newsletter')) {
      serverId = quotedContext?.stanzaId || pollKey.id;
    }
  }

  const normalizedJid = normaliseNewsletterJid(jid);
  const normalizedServerId = String(serverId ?? '').trim();
  if (!normalizedJid || !normalizedServerId) return null;
  return { jid: normalizedJid, serverId: normalizedServerId };
}

function hashPollOption(optionName) {
  return createHash('sha256').update(Buffer.from(String(optionName), 'utf8')).digest();
}

function buildNewsletterPollVoteNode({ jid, serverId, optionNames, messageId }) {
  const normalizedJid = normaliseNewsletterJid(jid);
  const normalizedServerId = String(serverId || '').trim();
  if (!normalizedJid) throw new Error('JID de chaîne invalide');
  if (!normalizedServerId) throw new Error('Identifiant server_id de publication manquant');
  if (!Array.isArray(optionNames) || !optionNames.length) throw new Error('Aucune option à voter');
  if (!messageId) throw new Error('Identifiant de message manquant');

  const hashes = optionNames.map(hashPollOption);
  return {
    tag: 'message',
    attrs: {
      to: normalizedJid,
      id: String(messageId),
      type: 'poll',
      server_id: normalizedServerId
    },
    content: [
      { tag: 'meta', attrs: { polltype: 'vote' } },
      { tag: 'votes', attrs: {}, content: hashes.map(hash => ({ tag: 'vote', attrs: {}, content: hash })) }
    ]
  };
}

async function sendNewsletterPollVote(socket, target, optionNames) {
  if (typeof socket?.query !== 'function' || typeof socket?.generateMessageTag !== 'function') {
    throw new Error('Le socket Baileys ne fournit pas query/generateMessageTag pour les votes newsletter');
  }
  const node = buildNewsletterPollVoteNode({
    ...target,
    optionNames,
    messageId: socket.generateMessageTag()
  });
  await socket.query(node);
  return { jid: node.attrs.to, serverId: node.attrs.server_id, options: optionNames };
}

async function voteAcrossNewsletterSockets(sessions, target, optionNamesBySession) {
  const unique = new Map();
  for (const entry of Array.isArray(sessions) ? sessions : []) {
    const socket = entry?.socket || entry;
    if (!socket || unique.has(socket)) continue;
    unique.set(socket, String(entry?.session || socket?.user?.id || 'session-inconnue').split('@')[0]);
  }
  const sockets = [...unique];
  if (optionNamesBySession.length !== sockets.length) throw new Error('La répartition ne correspond pas aux sessions actives');
  return Promise.all(sockets.map(async ([socket, session], index) => {
    try {
      const result = await sendNewsletterPollVote(socket, target, optionNamesBySession[index]);
      return { session, ok: true, options: optionNamesBySession[index], result };
    } catch (error) {
      return { session, ok: false, options: optionNamesBySession[index], error: String(error?.message || error) };
    }
  }));
}

module.exports = {
  parseBPollInput,
  allocateBPollVotes,
  findPollContent,
  getPollOptionNames,
  getNewsletterPollOptionsFromHistory,
  fetchNewsletterPollOptions,
  findForwardedNewsletterInfo,
  resolveBPollTarget,
  hashPollOption,
  buildNewsletterPollVoteNode,
  sendNewsletterPollVote,
  voteAcrossNewsletterSockets
};
