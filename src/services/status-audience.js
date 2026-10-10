'use strict';

const MAX_STATUS_VIEWERS = 1000;

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

  const match = withoutDevice.match(/^([^@]+)@(s\.whatsapp\.net|lid)$/);
  if (!match) return '';
  if (match[2] === 's.whatsapp.net' && !/^\d{6,15}$/.test(match[1])) return '';
  return `${match[1]}@${match[2]}`;
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
  const recipients = new Set();
  const ownJid = normalizedUserJid(socket.user?.id);
  const hasCustomAudience = Array.isArray(configuredViewers)
    ? configuredViewers.length > 0
    : typeof configuredViewers === 'string' && Boolean(configuredViewers.trim());

  if (hasCustomAudience) {
    const { numbers, invalid } = parseStatusViewerNumbers(configuredViewers);
    if (invalid.length || numbers.length === 0) {
      throw new Error('La liste STATUS_VIEWERS contient un numéro invalide. Corrige-la avec .setstatusviewers.');
    }
    if (numbers.length > MAX_STATUS_VIEWERS) {
      throw new Error(`La liste de destinataires est limitée à ${MAX_STATUS_VIEWERS} numéros.`);
    }
    for (const number of numbers) recipients.add(`${number}@s.whatsapp.net`);
  } else {
    for (const contact of contactEntries(socket.store?.contacts)) {
      const jid = normalizedUserJid(contact);
      if (jid && jid !== ownJid) recipients.add(jid);
    }

    // Ce bot n’installe pas de store Baileys par défaut. Si aucun carnet de
    // contacts n’est attaché, les participants des groupes fournissent le
    // fallback, comme demandé par `.tostatus`.
    if (recipients.size === 0 && typeof socket.groupFetchAllParticipating === 'function') {
      try {
        const groups = await socket.groupFetchAllParticipating();
        for (const group of groupEntries(groups)) {
          for (const participant of group?.participants || []) {
            const jid = normalizedUserJid(participant);
            if (jid) recipients.add(jid);
          }
        }
      } catch (error) {
        console.warn('[TOSTATUS] Récupération des groupes pour l’audience impossible:', error?.message || error);
      }
    }
  }

  if (ownJid) recipients.add(ownJid);
  return [...recipients];
}

module.exports = {
  MAX_STATUS_VIEWERS,
  normalizeSessionId(value) {
    return String(value || '').replace(/[^0-9]/g, '') || 'session';
  },
  normalizedUserJid,
  parseStatusViewerNumbers,
  getStatusJidList,
  _test: { groupEntries, contactEntries }
};
