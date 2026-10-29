'use strict';

const MAX_STATUS_VIEWERS = 1000;
const DEFAULT_AUDIENCE_CACHE_TTL_MS = 60_000;
const defaultAudienceCache = new WeakMap();

function normalizedUserJid(value) {
  if (value && typeof value === 'object') {
    const candidates = [
      value.phoneNumber,
      value.pn,
      value.participantAlt,
      value.remoteJidAlt,
      value.jid,
      value.id,
      value.lid
    ];
    for (const candidate of candidates) {
      const normalized = normalizedUserJid(candidate);
      if (normalized) return normalized;
    }
    return '';
  }

  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const withoutDevice = raw.replace(/:\d+(?=@)/, '');
  if (/^\d{6,15}$/.test(withoutDevice)) return `${withoutDevice}@s.whatsapp.net`;

  const match = withoutDevice.match(/^([^@]+)@(s\.whatsapp\.net|hosted|lid|hosted\.lid)$/);
  if (!match) return '';
  if (['s.whatsapp.net', 'hosted'].includes(match[2]) && !/^\d{6,15}$/.test(match[1])) return '';
  return `${match[1]}@${match[2]}`;
}

function isPhoneNumberJid(jid) {
  return typeof jid === 'string' && /@(?:s\.whatsapp\.net|hosted)$/.test(jid);
}

function isLidJid(jid) {
  return typeof jid === 'string' && /@(?:lid|hosted\.lid)$/.test(jid);
}

async function getStatusJidMappings(mapping, sourceJids, direction) {
  const resolved = new Map();
  if (!sourceJids.length) return resolved;

  const [bulkMethod, singleMethod, sourceProperty, targetProperty] = direction === 'pn-to-lid'
    ? ['getLIDsForPNs', 'getLIDForPN', 'pn', 'lid']
    : ['getPNsForLIDs', 'getPNForLID', 'lid', 'pn'];

  let pairs;
  if (typeof mapping?.[bulkMethod] === 'function') {
    pairs = await mapping[bulkMethod](sourceJids);
  } else if (typeof mapping?.[singleMethod] === 'function') {
    pairs = await Promise.all(sourceJids.map(async source => {
      const target = await mapping[singleMethod](source);
      if (!target) return null;
      return typeof target === 'string'
        ? { [sourceProperty]: source, [targetProperty]: target }
        : target;
    }));
  } else {
    throw new Error('Le socket Baileys ne fournit pas le mapping PN/LID nécessaire.');
  }

  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const source = normalizedUserJid(pair?.[sourceProperty]);
    const target = normalizedUserJid(pair?.[targetProperty]);
    if (source && target) resolved.set(source, target);
  }
  return resolved;
}

/**
 * Baileys 7 rc14 resolves status recipients using the sender's addressing
 * mode. On LID-migrated accounts a PN-only statusJidList can therefore omit
 * recipients (the server rejects it with ack 479). Route every recipient into
 * the sender's address space before relay, never send a mixed PN/LID list.
 */
async function resolveStatusRelayAudience(socket, statusJidList = [], options = {}) {
  const ownPn = normalizedUserJid(socket?.authState?.creds?.me?.id || socket?.user?.id);
  const ownLid = normalizedUserJid(socket?.authState?.creds?.me?.lid || socket?.user?.lid);
  const requestedMode = options.addressingMode === 'lid' || options.addressingMode === 'pn'
    ? options.addressingMode
    : null;
  const useLidAddressing = requestedMode ? requestedMode === 'lid' : Boolean(ownLid);
  if (useLidAddressing && !ownLid) {
    throw new Error('Le socket n’a pas d’identité LID utilisable pour adresser le statut.');
  }
  const ownJid = useLidAddressing ? ownLid : ownPn;
  const candidates = [...new Set((Array.isArray(statusJidList) ? statusJidList : [])
    .map(normalizedUserJid)
    .filter(Boolean))];
  const mapping = socket?.signalRepository?.lidMapping;
  const outgoingByInput = new Map();

  if (useLidAddressing) {
    const pnToLid = new Map();
    if (ownPn && ownLid) pnToLid.set(ownPn, ownLid);
    const pendingPns = candidates.filter(jid => isPhoneNumberJid(jid) && !pnToLid.has(jid));
    try {
      const mapped = await getStatusJidMappings(mapping, pendingPns, 'pn-to-lid');
      for (const [pn, lid] of mapped) {
        if (isPhoneNumberJid(pn) && isLidJid(lid)) pnToLid.set(pn, lid);
      }
    } catch (error) {
      throw new Error(`Impossible de résoudre les destinataires PN en LID : ${error?.message || error}`);
    }

    for (const jid of candidates) {
      const target = isLidJid(jid) ? jid : pnToLid.get(jid);
      if (target && isLidJid(target)) outgoingByInput.set(jid, target);
    }
  } else {
    const lidToPn = new Map();
    if (ownPn && ownLid) lidToPn.set(ownLid, ownPn);
    const pendingLids = candidates.filter(jid => isLidJid(jid) && !lidToPn.has(jid));
    try {
      const mapped = await getStatusJidMappings(mapping, pendingLids, 'lid-to-pn');
      for (const [lid, pn] of mapped) {
        if (isLidJid(lid) && isPhoneNumberJid(pn)) lidToPn.set(lid, pn);
      }
    } catch (error) {
      throw new Error(`Impossible de résoudre les destinataires LID en PN : ${error?.message || error}`);
    }

    for (const jid of candidates) {
      const target = isPhoneNumberJid(jid) ? jid : lidToPn.get(jid);
      if (target && isPhoneNumberJid(target)) outgoingByInput.set(jid, target);
    }
  }

  const outgoing = [];
  const seen = new Set();
  const unresolvedJids = [];
  for (const jid of candidates) {
    const target = outgoingByInput.get(jid);
    if (!target) {
      // A PN and its LID can both be present in the source audience. If one
      // resolved address already covers the other exact JID, it is not missing.
      if (!seen.has(jid)) unresolvedJids.push(jid);
      continue;
    }
    // WhatsApp's `statusJidList` is the audience, not the sender. Including
    // the publishing account itself can make the server reject the stanza
    // with smax-invalid (479), especially when its PN and LID are both present.
    if (target === ownJid) continue;
    if (!seen.has(target)) {
      seen.add(target);
      outgoing.push(target);
    }
  }

  return {
    statusJidList: outgoing,
    ownJid,
    addressingMode: useLidAddressing ? 'lid' : (requestedMode === 'pn' ? 'pn' : null),
    unresolvedJids
  };
}

function parseStatusViewerNumbers(input) {
  const tokens = (Array.isArray(input) ? input : String(input || '').split(/[\s,;|]+/))
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const numbers = [];
  const invalid = [];
  const seen = new Set();

  for (const token of tokens) {
    const compact = token.replace(/[\s().-]/g, '');
    const number = compact.replace(/^\+/, '');
    if (!/^\+?\d{6,15}$/.test(compact)) {
      invalid.push(token);
      continue;
    }
    if (!seen.has(number)) {
      seen.add(number);
      numbers.push(number);
    }
  }

  return { numbers, invalid };
}

function mergeStatusViewerNumbers(currentInput, additionsInput) {
  const current = parseStatusViewerNumbers(currentInput);
  if (current.invalid.length) {
    throw new Error('La liste STATUS_VIEWERS contient un numéro invalide. Corrige-la avec .setstatusviewers.');
  }
  const additions = parseStatusViewerNumbers(additionsInput);
  if (additions.invalid.length) {
    throw new Error(`Numéro(s) invalide(s) : ${additions.invalid.slice(0, 5).join(', ')}`);
  }

  const numbers = [...current.numbers];
  const seen = new Set(numbers);
  let added = 0;
  let alreadyPresent = 0;
  for (const number of additions.numbers) {
    if (seen.has(number)) {
      alreadyPresent += 1;
      continue;
    }
    seen.add(number);
    numbers.push(number);
    added += 1;
  }
  if (numbers.length > MAX_STATUS_VIEWERS) {
    throw new Error(`La liste est limitée à ${MAX_STATUS_VIEWERS} numéros; aucun changement n’a été enregistré.`);
  }

  return { numbers, added, alreadyPresent, total: numbers.length };
}

function participantLids(participant) {
  const lids = [];
  for (const value of [participant?.lid, participant?.lidJid]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const raw = value.trim().toLowerCase();
    const normalized = raw.includes('@')
      ? normalizedUserJid(raw)
      : (/^\d+(?::\d+)?$/.test(raw) ? `${raw.split(':')[0]}@lid` : '');
    if (isLidJid(normalized) && !lids.includes(normalized)) lids.push(normalized);
  }
  for (const value of [participant?.id, participant?.jid, participant?.participantAlt, participant?.remoteJidAlt]) {
    const normalized = normalizedUserJid(value);
    if (isLidJid(normalized) && !lids.includes(normalized)) lids.push(normalized);
  }
  return lids;
}

function participantPhoneNumber(participant) {
  for (const value of [
    participant?.phoneNumber,
    participant?.pn,
    participant?.phoneNumberJid,
    participant?.participantAlt,
    participant?.remoteJidAlt,
    participant?.id,
    participant?.jid
  ]) {
    const parsed = parseStatusViewerNumbers([value]);
    if (parsed.numbers.length) return parsed.numbers[0];
    const normalized = normalizedUserJid(value);
    if (isPhoneNumberJid(normalized)) return normalized.split('@')[0];
  }
  return '';
}

async function getGroupParticipantNumbers(socket, participants = []) {
  const numbers = [];
  const seenNumbers = new Set();
  const pendingLids = new Map();
  let unresolvedParticipants = 0;

  participants.forEach((participant, index) => {
    const number = participantPhoneNumber(participant);
    if (number) {
      if (!seenNumbers.has(number)) {
        seenNumbers.add(number);
        numbers.push(number);
      }
      return;
    }
    const lid = participantLids(participant)[0];
    if (lid) pendingLids.set(index, lid);
    else unresolvedParticipants += 1;
  });

  const mapping = socket?.signalRepository?.lidMapping;
  const uniqueLids = [...new Set(pendingLids.values())];
  let mappings = [];
  if (uniqueLids.length && typeof mapping?.getPNsForLIDs === 'function') {
    try {
      mappings = await mapping.getPNsForLIDs(uniqueLids) || [];
    } catch (error) {
      console.warn('[TOSTATUS] Résolution des numéros LID impossible:', error?.message || error);
    }
  } else if (uniqueLids.length && typeof mapping?.getPNForLID === 'function') {
    mappings = (await Promise.all(uniqueLids.map(async lid => {
      try {
        const pn = await mapping.getPNForLID(lid);
        return pn ? { lid, pn } : null;
      } catch {
        return null;
      }
    }))).filter(Boolean);
  }

  const phoneByLid = new Map();
  for (const item of mappings) {
    const lid = normalizedUserJid(item?.lid);
    const pn = normalizedUserJid(item?.pn);
    if (isLidJid(lid) && isPhoneNumberJid(pn)) {
      phoneByLid.set(lid, pn.split('@')[0]);
    }
  }

  for (const lid of pendingLids.values()) {
    const number = phoneByLid.get(lid);
    if (!number) {
      unresolvedParticipants += 1;
      continue;
    }
    if (!seenNumbers.has(number)) {
      seenNumbers.add(number);
      numbers.push(number);
    }
  }

  return { numbers, participantCount: participants.length, unresolvedParticipants };
}

async function appendGroupParticipantsToStatusAudience(socket, groupJid, currentInput = []) {
  if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
    throw new Error('Le groupe sélectionné possède un JID invalide.');
  }
  if (typeof socket?.groupMetadata !== 'function') {
    throw new Error('Les membres du groupe sont indisponibles sur cette session.');
  }

  let metadata;
  try {
    metadata = await socket.groupMetadata(groupJid);
  } catch (error) {
    throw new Error(`Impossible de lire les membres du groupe : ${error?.message || error}`);
  }
  if (!Array.isArray(metadata?.participants)) {
    throw new Error('WhatsApp n’a pas renvoyé la liste des membres de ce groupe.');
  }

  const groupAudience = await getGroupParticipantNumbers(socket, metadata.participants);
  if (!groupAudience.numbers.length) {
    throw new Error(groupAudience.unresolvedParticipants
      ? 'Aucun numéro de téléphone résolvable dans ce groupe. Les identifiants LID sans correspondance ont été ignorés.'
      : 'Ce groupe ne contient aucun numéro à ajouter.');
  }
  const merged = mergeStatusViewerNumbers(currentInput, groupAudience.numbers);
  return {
    ...merged,
    participantCount: groupAudience.participantCount,
    unresolvedParticipants: groupAudience.unresolvedParticipants,
    groupSubject: String(metadata.subject || '').trim()
  };
}

function groupEntries(groups) {
  if (groups instanceof Map) return [...groups.values()];
  return Object.values(groups || {});
}

function contactEntries(contacts) {
  if (contacts instanceof Map) {
    return [...contacts.entries()].map(([jid, contact]) => ({
      ...(contact && typeof contact === 'object' ? contact : {}),
      id: contact?.id || jid
    }));
  }
  return Object.entries(contacts || {}).map(([jid, contact]) => ({
    ...(contact && typeof contact === 'object' ? contact : {}),
    id: contact?.id || jid
  }));
}

async function getStatusJidList(socket, configuredViewers = []) {
  if (!socket) throw new Error('Socket WhatsApp indisponible.');
  const ownJid = normalizedUserJid(socket.authState?.creds?.me?.id || socket.user?.id);
  const hasCustomAudience = Array.isArray(configuredViewers)
    ? configuredViewers.length > 0
    : typeof configuredViewers === 'string' && Boolean(configuredViewers.trim());

  if (hasCustomAudience) {
    const recipients = new Set();
    const { numbers, invalid } = parseStatusViewerNumbers(configuredViewers);
    if (invalid.length || numbers.length === 0) {
      throw new Error('La liste STATUS_VIEWERS contient un numéro invalide. Corrige-la avec .setstatusviewers.');
    }
    if (numbers.length > MAX_STATUS_VIEWERS) {
      throw new Error(`La liste de destinataires est limitée à ${MAX_STATUS_VIEWERS} numéros.`);
    }
    for (const number of numbers) {
      const recipient = `${number}@s.whatsapp.net`;
      if (recipient !== ownJid) recipients.add(recipient);
    }
    return [...recipients];
  }

  const cached = defaultAudienceCache.get(socket);
  if (cached && cached.expiresAt > Date.now()) return [...cached.jids];

  const recipients = new Set();
  const addContact = (contact, fallbackJid) => {
    const jid = contact && typeof contact === 'object'
      ? normalizedUserJid(contact) || normalizedUserJid(contact.id || contact.jid || fallbackJid)
      : normalizedUserJid(fallbackJid);
    if (jid && jid !== ownJid) recipients.add(jid);
  };
  const contacts = socket.store?.contacts;
  if (contacts instanceof Map) {
    for (const [jid, contact] of contacts) addContact(contact, jid);
  } else if (contacts && typeof contacts === 'object') {
    for (const jid in contacts) {
      if (Object.prototype.hasOwnProperty.call(contacts, jid)) addContact(contacts[jid], jid);
    }
  }

  // Ce bot n’installe pas de store Baileys par défaut. Si aucun carnet de
  // contacts n’est attaché, les participants des groupes fournissent le fallback.
  if (recipients.size === 0 && typeof socket.groupFetchAllParticipating === 'function') {
    try {
      const groups = await socket.groupFetchAllParticipating();
      const addGroupParticipants = group => {
        for (const participant of group?.participants || []) {
          const jid = normalizedUserJid(participant);
          if (jid && jid !== ownJid) recipients.add(jid);
        }
      };
      if (groups instanceof Map) {
        for (const group of groups.values()) addGroupParticipants(group);
      } else if (groups && typeof groups === 'object') {
        for (const groupJid in groups) {
          if (Object.prototype.hasOwnProperty.call(groups, groupJid)) addGroupParticipants(groups[groupJid]);
        }
      }
    } catch (error) {
      console.warn('[TOSTATUS] Récupération des groupes pour l’audience impossible:', error?.message || error);
    }
  }

  const jids = [...recipients];
  if (jids.some(jid => jid !== ownJid)) {
    defaultAudienceCache.set(socket, {
      jids,
      expiresAt: Date.now() + DEFAULT_AUDIENCE_CACHE_TTL_MS
    });
  } else {
    // Ne pas mémoriser un fallback vide ou en erreur : le prochain essai doit
    // pouvoir retenter la récupération des groupes.
    defaultAudienceCache.delete(socket);
  }
  return [...jids];
}

module.exports = {
  MAX_STATUS_VIEWERS,
  DEFAULT_AUDIENCE_CACHE_TTL_MS,
  normalizeSessionId(value) {
    return String(value || '').replace(/[^0-9]/g, '') || 'session';
  },
  normalizedUserJid,
  parseStatusViewerNumbers,
  mergeStatusViewerNumbers,
  getGroupParticipantNumbers,
  appendGroupParticipantsToStatusAudience,
  getStatusJidList,
  resolveStatusRelayAudience,
  _test: { groupEntries, contactEntries, participantLids, participantPhoneNumber, defaultAudienceCache }
};
