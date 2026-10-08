'use strict';

const DEFAULT_SELECTION_TTL_MS = 5 * 60 * 1000;
const pendingSelections = new Map();
const selectedGroups = new Map();

function normalizeSessionId(value) {
  return String(value || '').replace(/[^0-9]/g, '') || 'session';
}

function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function selectionKey(sessionId, actorId) {
  return `${normalizeSessionId(sessionId)}::${normalizeActorId(actorId)}`;
}

function identityTokens(...values) {
  const tokens = new Set();
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') {
      for (const key of ['id', 'jid', 'lid', 'pn', 'phoneNumber', 'participantAlt', 'remoteJidAlt']) {
        visit(value[key]);
      }
      return;
    }
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return;
    tokens.add(raw);
    const local = raw.split('@')[0].split(':')[0];
    if (local) tokens.add(local);
    if (!raw.includes('@lid')) {
      const number = local.replace(/[^0-9]/g, '');
      if (number) {
        tokens.add(number);
        tokens.add(`${number}@s.whatsapp.net`);
      }
    }
  };
  values.forEach(visit);
  return tokens;
}

function participantMatches(participant, userTokens) {
  const participantTokens = identityTokens(participant);
  return [...participantTokens].some(token => userTokens.has(token));
}

function cleanGroupName(value) {
  return String(value || 'Groupe sans nom').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) || 'Groupe sans nom';
}

async function listUserGroups(socket, userIdentifiers = []) {
  if (typeof socket?.groupFetchAllParticipating !== 'function') {
    throw new Error('La liste des groupes est indisponible sur cette session');
  }
  const all = await socket.groupFetchAllParticipating();
  const entries = all instanceof Map ? [...all.entries()] : Object.entries(all || {});
  const userTokens = identityTokens(userIdentifiers);
  const candidates = await Promise.all(entries.map(async ([fallbackJid, partial]) => {
    const jid = String(partial?.id || fallbackJid || '');
    if (!jid.endsWith('@g.us')) return null;
    let metadata = partial || {};
    let participants = Array.isArray(metadata.participants) ? metadata.participants : [];
    let matches = participants.some(participant => participantMatches(participant, userTokens));

    // Selon la version de Baileys, groupFetchAllParticipating peut fournir des
    // participants LID incomplets. Une métadonnée fraîche expose souvent le PN
    // alternatif et évite d’écarter à tort un groupe commun.
    if (!matches && typeof socket.groupMetadata === 'function') {
      const refreshed = await socket.groupMetadata(jid).catch(() => null);
      if (refreshed) {
        metadata = refreshed;
        participants = Array.isArray(refreshed.participants) ? refreshed.participants : [];
        matches = participants.some(participant => participantMatches(participant, userTokens));
      }
    }
    if (!matches) return null;
    return {
      jid,
      subject: cleanGroupName(metadata.subject || partial?.subject),
      size: participants.length
    };
  }));

  return candidates
    .filter(Boolean)
    .sort((left, right) => left.subject.localeCompare(right.subject, 'fr', { sensitivity: 'base' }));
}

function beginGroupSelection(sessionId, actorId, groups, now = Date.now()) {
  const safeGroups = (groups || []).map(group => ({
    jid: String(group.jid || ''),
    subject: cleanGroupName(group.subject),
    size: Number(group.size || 0)
  })).filter(group => group.jid.endsWith('@g.us'));
  pendingSelections.set(selectionKey(sessionId, actorId), { groups: safeGroups, createdAt: now });
  return safeGroups;
}

function resolveGroupSelection(sessionId, actorId, input, options = {}) {
  const key = selectionKey(sessionId, actorId);
  const pending = pendingSelections.get(key);
  if (!pending) return { status: 'none' };

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_SELECTION_TTL_MS;
  if (now - pending.createdAt > ttlMs) {
    pendingSelections.delete(key);
    return { status: 'expired' };
  }

  const raw = String(input || '').trim();
  if (!/^\d+$/.test(raw)) return { status: 'waiting' };
  const index = Number(raw) - 1;
  if (!Number.isSafeInteger(index) || index < 0 || index >= pending.groups.length) {
    return { status: 'invalid', min: 1, max: pending.groups.length };
  }

  const group = pending.groups[index];
  pendingSelections.delete(key);
  selectedGroups.set(key, group);
  return { status: 'selected', group };
}

function getSelectedGroup(sessionId, actorId) {
  return selectedGroups.get(selectionKey(sessionId, actorId)) || null;
}

function clearSelectedGroup(sessionId, actorId) {
  return selectedGroups.delete(selectionKey(sessionId, actorId));
}

function renderGroupSelectionList(groups, prefix = '.') {
  const lines = [
    '👥 *CHOISIS LE GROUPE CIBLE*',
    '',
    ...groups.map((group, index) => `${index + 1}. ${cleanGroupName(group.subject)}${group.size ? ` — ${group.size} membres` : ''}`),
    '',
    'Réponds simplement avec le numéro du groupe.',
    `Après la sélection : ${prefix}swgc <texte> ou réponds à un média avec ${prefix}swgc.`
  ];
  return lines.join('\n');
}

function actorIdFromMessage(socket, msg, remoteJid) {
  if (msg?.key?.fromMe) {
    const botNumber = String(socket?.user?.id || '').split(':')[0].replace(/[^0-9]/g, '');
    return botNumber || socket?.user?.id || remoteJid;
  }
  return msg?.key?.participantAlt || msg?.key?.participant || msg?.key?.remoteJidAlt || remoteJid;
}

module.exports = {
  DEFAULT_SELECTION_TTL_MS,
  normalizeSessionId,
  normalizeActorId,
  selectionKey,
  identityTokens,
  participantMatches,
  cleanGroupName,
  listUserGroups,
  beginGroupSelection,
  resolveGroupSelection,
  getSelectedGroup,
  clearSelectedGroup,
  renderGroupSelectionList,
  actorIdFromMessage,
  _test: { pendingSelections, selectedGroups }
};
