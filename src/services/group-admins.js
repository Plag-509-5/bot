'use strict';

const ADMIN_ROLES = new Set(['admin', 'superadmin']);
const INVALID_USER_SERVERS = new Set(['g.us', 'broadcast', 'newsletter']);

function normalizeJid(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';

  const at = raw.lastIndexOf('@');
  if (at < 0) {
    const number = raw.replace(/\D/g, '');
    return number ? `${number}@s.whatsapp.net` : '';
  }

  const user = raw.slice(0, at).trim().replace(/:\d+$/, '');
  let server = raw.slice(at + 1).trim().toLowerCase();
  if (server === 'c.us') server = 's.whatsapp.net';
  return user && server ? `${user}@${server}` : '';
}

function normalizeLid(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  if (raw.includes('@')) return normalizeJid(raw);
  const local = raw.replace(/:\d+$/, '').replace(/[^\da-z_-]/gi, '');
  return local ? `${local}@lid` : '';
}

function pushIdentifier(target, value, forceLid = false) {
  const jid = forceLid ? normalizeLid(value) : normalizeJid(value);
  if (!jid || INVALID_USER_SERVERS.has(jid.slice(jid.lastIndexOf('@') + 1))) return;
  if (!target.includes(jid)) target.push(jid);
}

function getIdentityJids(identity) {
  if (!identity) return [];
  if (Array.isArray(identity)) {
    return [...new Set(identity.flatMap(getIdentityJids))];
  }
  if (typeof identity === 'string') {
    const identifiers = [];
    pushIdentifier(identifiers, identity);
    return identifiers;
  }
  if (typeof identity !== 'object') return [];

  const identifiers = [];
  for (const field of ['id', 'jid', 'pn', 'phoneNumber', 'phoneNumberJid', 'jidAlt', 'participantAlt']) {
    pushIdentifier(identifiers, identity[field]);
  }
  for (const field of ['lid', 'lidJid']) {
    pushIdentifier(identifiers, identity[field], true);
  }
  return identifiers;
}

function getParticipantJids(participant) {
  return getIdentityJids(participant);
}

function getBotJids(socket) {
  const creds = socket?.authState?.creds || {};
  return [...new Set([
    ...getIdentityJids(socket?.user),
    ...getIdentityJids(creds.me)
  ])];
}

function areSameIdentity(first, second) {
  const left = getIdentityJids(first);
  if (!left.length) return false;
  const right = new Set(getIdentityJids(second));
  return left.some(jid => right.has(jid));
}

function isAdminRole(role) {
  if (role === true) return true;
  return typeof role === 'string' && ADMIN_ROLES.has(role.toLowerCase());
}

function isAdminParticipant(participant) {
  return Boolean(participant && isAdminRole(participant.admin));
}

function isSuperAdminParticipant(participant) {
  return Boolean(participant && typeof participant.admin === 'string' && participant.admin.toLowerCase() === 'superadmin');
}

function getParticipants(metadata) {
  return Array.isArray(metadata?.participants) ? metadata.participants : [];
}

function findGroupParticipant(metadata, identity) {
  const identities = getIdentityJids(identity);
  if (!identities.length) return null;
  const requested = new Set(identities);
  return getParticipants(metadata).find(participant =>
    getParticipantJids(participant).some(jid => requested.has(jid))
  ) || null;
}

function isGroupAdmin(metadata, identity) {
  return isAdminParticipant(findGroupParticipant(metadata, identity));
}

function isGroupSuperAdmin(metadata, identity) {
  return isSuperAdminParticipant(findGroupParticipant(metadata, identity));
}

function isBotAdmin(metadata, socket) {
  const botJids = getBotJids(socket);
  return botJids.length > 0 && isGroupAdmin(metadata, botJids);
}

function isBotIdentity(socket, identity) {
  return areSameIdentity(getBotJids(socket), identity);
}

function getAdminParticipants(metadata) {
  return getParticipants(metadata).filter(isAdminParticipant);
}

function getParticipantId(participant) {
  const jid = participant?.id || participant?.jid || participant?.pn || participant?.phoneNumber || '';
  return jid ? normalizeJid(jid) : normalizeLid(participant?.lid || '');
}

function getParticipantMentionJid(participant) {
  const candidates = getParticipantJids(participant);
  return candidates.find(jid => jid.endsWith('@s.whatsapp.net'))
    || candidates[0]
    || getParticipantId(participant);
}

function getGroupAdminJids(metadata) {
  return [...new Set(getAdminParticipants(metadata).map(getParticipantMentionJid).filter(Boolean))];
}

function getPhoneNumberJid(identity) {
  return getIdentityJids(identity).find(jid => jid.endsWith('@s.whatsapp.net')) || '';
}

function getLidJid(identity) {
  return getIdentityJids(identity).find(jid => jid.endsWith('@lid')) || '';
}

function getGroupAdminNumbers(metadata) {
  return [...new Set(getAdminParticipants(metadata)
    .map(participant => getPhoneNumberJid(participant).split('@')[0])
    .filter(Boolean))];
}

function getBotParticipant(metadata, socket) {
  return findGroupParticipant(metadata, getBotJids(socket));
}

function getBotJid(metadata, socket) {
  const participant = getBotParticipant(metadata, socket);
  return participant
    ? getParticipantId(participant)
    : (getBotJids(socket).find(jid => jid.endsWith('@s.whatsapp.net')) || getBotJids(socket)[0] || '');
}

module.exports = {
  areSameIdentity,
  findGroupParticipant,
  getAdminParticipants,
  getBotJid,
  getBotJids,
  getBotParticipant,
  getGroupAdminJids,
  getGroupAdminNumbers,
  getIdentityJids,
  getLidJid,
  getParticipantId,
  getParticipantJids,
  getParticipantMentionJid,
  getParticipants,
  getPhoneNumberJid,
  isAdminParticipant,
  isAdminRole,
  isBotAdmin,
  isBotIdentity,
  isGroupAdmin,
  isGroupSuperAdmin,
  isSuperAdminParticipant,
  normalizeJid,
  normalizeLid
};
