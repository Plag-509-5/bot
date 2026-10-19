'use strict';

const {
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
  getPhoneNumberJid,
  isAdminParticipant,
  isAdminRole,
  normalizeJid: normalizeGroupJid
} = require('../services/group-admins');

function normalizeJid(jid) {
  if (typeof jid !== 'string') return '';
  return normalizeGroupJid(jid);
}

function jidToNumber(jid) {
  const normalized = normalizeJid(typeof jid === 'string' ? jid : '');
  return normalized ? normalized.split('@')[0].split(':')[0] : '';
}

function createLidMapping(participants) {
  const mapping = {
    lidToInfo: {},
    numberToInfo: {},
    jidToInfo: {},
    adminNumbers: [],
    adminLids: [],
    adminJids: [],
    adminIdentifiers: []
  };
  if (!Array.isArray(participants)) return mapping;

  for (const participant of participants) {
    const identifiers = getParticipantJids(participant);
    const jid = getParticipantId(participant);
    const lid = getLidJid(participant);
    const phoneJid = getPhoneNumberJid(participant);
    const number = phoneJid ? phoneJid.split('@')[0] : '';
    const admin = isAdminParticipant(participant) ? participant.admin : null;
    const info = { number, jid, lid, admin, raw: participant, identifiers };

    if (lid) mapping.lidToInfo[lid] = info;
    if (number) mapping.numberToInfo[number] = info;
    for (const identifier of identifiers) mapping.jidToInfo[identifier] = info;

    if (admin) {
      mapping.adminIdentifiers.push(...identifiers);
      if (number) mapping.adminNumbers.push(number);
      if (lid) mapping.adminLids.push(lid);
      const mentionJid = getParticipantMentionJid(participant);
      if (mentionJid) mapping.adminJids.push(mentionJid);
    }
  }

  for (const key of ['adminIdentifiers', 'adminNumbers', 'adminLids', 'adminJids']) {
    mapping[key] = [...new Set(mapping[key])];
  }
  return mapping;
}

async function getGroupAdminsInfo(socket, groupJid) {
  if (!socket || !groupJid) throw new Error('socket et groupJid requis');
  const metadata = await socket.groupMetadata(groupJid);
  const rawParticipants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const lidMapping = createLidMapping(rawParticipants);
  const participants = rawParticipants.map(participant => ({
    ...participant,
    id: getParticipantId(participant),
    jid: getParticipantMentionJid(participant),
    lid: getLidJid(participant),
    number: getPhoneNumberJid(participant).split('@')[0] || '',
    identifiers: getParticipantJids(participant),
    admin: isAdminParticipant(participant) ? participant.admin : null
  }));

  const botParticipant = getBotParticipant(metadata, socket);
  const botJids = getBotJids(socket);
  const botPhoneJid = getPhoneNumberJid(botJids);
  const botLid = getLidJid(botJids) || null;
  const botJid = botParticipant ? getParticipantId(botParticipant) : (getBotJid(metadata, socket) || null);
  const botNum = botPhoneJid ? botPhoneJid.split('@')[0] : '';

  return {
    metadata,
    participants,
    lidMapping,
    groupAdminsJid: getGroupAdminJids(metadata),
    groupAdminsNum: getGroupAdminNumbers(metadata),
    groupAdminsLid: [...new Set(getAdminParticipants(metadata).map(getLidJid).filter(Boolean))],
    botJid,
    botNum,
    botLid,
    rawSocketUser: socket.user
  };
}

function isAdmin(lidMapping, userIdentifier) {
  if (!lidMapping || !userIdentifier) return false;
  const identifiers = new Set(getIdentityJids(userIdentifier));
  if (lidMapping.adminIdentifiers?.some(identifier => identifiers.has(identifier))) return true;

  const number = jidToNumber(typeof userIdentifier === 'string' ? userIdentifier : '');
  if (number && lidMapping.adminNumbers.includes(number)) return true;
  return [...identifiers].some(identifier => isAdminRole(lidMapping.jidToInfo[identifier]?.admin));
}

module.exports = {
  getGroupAdminsInfo,
  jidToNumber,
  normalizeJid,
  isAdmin,
  createLidMapping
};
