'use strict';

const {
  getParticipantJids,
  getPhoneNumberJid
} = require('./group-admins');

const PHONE_DOMAINS = new Set(['s.whatsapp.net', 'c.us']);
const NON_USER_DOMAINS = new Set(['g.us', 'lid', 'broadcast', 'newsletter']);
const PHONE_FIELDS = [
  'phoneNumber',
  'phoneNumberJid',
  'phone',
  'pn',
  'participantAlt',
  'remoteJidAlt',
  'jidAlt',
  'number',
  'jid',
  'id',
  'lid'
];
const CONTEXT_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage'
];

function normalizeJid(value) {
  const raw = String(value || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 0) return raw.split(':')[0];
  return `${raw.slice(0, at).split(':')[0]}@${raw.slice(at + 1)}`;
}

function extractPhoneNumber(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const number = extractPhoneNumber(item, depth + 1);
      if (number) return number;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const field of PHONE_FIELDS) {
      const number = extractPhoneNumber(value[field], depth + 1);
      if (number) return number;
    }
    return '';
  }

  const raw = String(value).trim();
  if (!raw) return '';
  const at = raw.lastIndexOf('@');
  let local = raw;
  if (at >= 0) {
    const domain = raw.slice(at + 1).toLowerCase();
    if (NON_USER_DOMAINS.has(domain) || !PHONE_DOMAINS.has(domain)) return '';
    local = raw.slice(0, at);
  }
  local = local.split(':')[0];
  const digits = local.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? digits : '';
}

function collectLids(value, output = [], depth = 0) {
  if (depth > 5 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectLids(item, output, depth + 1);
    return output;
  }
  if (typeof value === 'object') {
    for (const field of PHONE_FIELDS) collectLids(value[field], output, depth + 1);
    return output;
  }
  const raw = normalizeJid(value);
  if (raw.endsWith('@lid') && !output.includes(raw)) output.push(raw);
  return output;
}

function findContextInfos(message) {
  const found = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return;
    seen.add(value);
    if (value.contextInfo && typeof value.contextInfo === 'object') found.push(value.contextInfo);
    if (value.messageContextInfo?.contextInfo) found.push(value.messageContextInfo.contextInfo);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'contextInfo' || key === 'messageContextInfo') continue;
      visit(child, depth + 1);
    }
  };
  visit(message?.message || message);
  return found;
}

function getQuotedContext(msg) {
  return findContextInfos(msg).find(contextInfo =>
    contextInfo?.quotedMessage || contextInfo?.stanzaId || contextInfo?.placeholderKey
  ) || null;
}

function getQuoteCandidates(msg, contextInfo, from) {
  const quotedKey = contextInfo?.quotedMessage?.key || msg?.quoted?.key || {};
  const candidates = [
    contextInfo?.participantAlt,
    contextInfo?.remoteJidAlt,
    contextInfo?.participant,
    contextInfo?.senderPn,
    quotedKey.participantAlt,
    quotedKey.remoteJidAlt,
    quotedKey.participant,
    quotedKey.remoteJid,
    msg?.quoted?.sender
  ].filter(Boolean);

  // In a private conversation the chat JID identifies the other participant;
  // in a group it identifies the group and must never be used as a number.
  if (!String(from || '').endsWith('@g.us')) candidates.push(from);
  return candidates;
}

function getSenderCandidates(msg, senderJid, from) {
  const candidates = [
    msg?.key?.participantAlt,
    msg?.key?.remoteJidAlt,
    msg?.key?.senderPn,
    msg?.key?.participant,
    senderJid
  ].filter(Boolean);
  if (!String(from || '').endsWith('@g.us')) candidates.push(from);
  return candidates;
}

async function resolveLidNumber(lid, { socket, from, groupMetadata } = {}) {
  const normalizedLid = normalizeJid(lid);
  if (!normalizedLid.endsWith('@lid')) return '';

  let metadata = groupMetadata || null;
  if (!metadata && String(from || '').endsWith('@g.us') && typeof socket?.groupMetadata === 'function') {
    try {
      metadata = await socket.groupMetadata(from);
    } catch (_) {}
  }

  const participant = (metadata?.participants || []).find(item =>
    getParticipantJids(item).some(identity => normalizeJid(identity) === normalizedLid)
    || normalizeJid(item?.lid) === normalizedLid
  );
  const metadataNumber = extractPhoneNumber(getPhoneNumberJid(participant) || participant);
  if (metadataNumber) return metadataNumber;

  const mapping = socket?.signalRepository?.lidMapping;
  if (!mapping) return '';
  try {
    if (typeof mapping.getPNForLID === 'function') {
      const number = extractPhoneNumber(await mapping.getPNForLID(normalizedLid));
      if (number) return number;
    }
    if (typeof mapping.getPNsForLIDs === 'function') {
      const resolved = await mapping.getPNsForLIDs([normalizedLid]);
      for (const item of Array.isArray(resolved) ? resolved : []) {
        if (normalizeJid(item?.lid) && normalizeJid(item.lid) !== normalizedLid) continue;
        const number = extractPhoneNumber(item?.pn || item?.phoneNumber || item?.number);
        if (number) return number;
      }
    }
  } catch (_) {}
  return '';
}

async function resolveCandidateNumber(candidate, options = {}) {
  const direct = extractPhoneNumber(candidate);
  if (direct) return direct;
  for (const lid of collectLids(candidate)) {
    const mapped = await resolveLidNumber(lid, options);
    if (mapped) return mapped;
  }
  return '';
}

async function resolvePairingNumber({
  explicitNumber = '',
  msg,
  from,
  senderJid,
  socket,
  groupMetadata
} = {}) {
  const supplied = String(explicitNumber || '').trim();
  if (supplied) {
    return { number: supplied.replace(/\D/g, ''), source: 'explicit' };
  }

  const contextInfo = getQuotedContext(msg);
  const hasReply = Boolean(contextInfo && (
    contextInfo.quotedMessage || contextInfo.stanzaId || contextInfo.placeholderKey
  ));
  const candidates = hasReply
    ? getQuoteCandidates(msg, contextInfo, from)
    : getSenderCandidates(msg, senderJid, from);

  for (const candidate of candidates) {
    const number = await resolveCandidateNumber(candidate, { socket, from, groupMetadata });
    if (number) return { number, source: hasReply ? 'reply' : 'sender' };
  }

  return {
    number: '',
    source: hasReply ? 'reply' : 'sender',
    error: hasReply
      ? 'Impossible de résoudre le numéro de la personne citée. Réponds à un message avec un JID téléphonique, ou indique le numéro international.'
      : 'Impossible de trouver ton numéro de téléphone depuis ce JID. Indique le numéro international sans +.'
  };
}

module.exports = {
  extractPhoneNumber,
  collectLids,
  findContextInfos,
  getQuotedContext,
  getQuoteCandidates,
  getSenderCandidates,
  resolveLidNumber,
  resolveCandidateNumber,
  resolvePairingNumber
};
