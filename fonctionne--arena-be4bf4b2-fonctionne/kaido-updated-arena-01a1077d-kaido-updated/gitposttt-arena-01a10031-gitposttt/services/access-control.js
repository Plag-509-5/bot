'use strict';

function rawIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function phoneNumberFromIdentifier(value) {
  const raw = rawIdentifier(value);
  if (!raw || raw.includes('@lid') || raw.endsWith('@g.us') || raw.endsWith('@newsletter')) return '';
  const local = raw.split('@')[0].split(':')[0];
  const number = local.replace(/[^0-9]/g, '');
  return /^\d{6,15}$/.test(number) ? number : '';
}

function canonicalAdmin(value) {
  const source = value && typeof value === 'object'
    ? (value.number || value.phone || value.phoneNumber || value.jid || value.id || '')
    : value;
  const raw = rawIdentifier(source);
  const number = phoneNumberFromIdentifier(source);
  return {
    raw,
    number,
    jid: number ? `${number}@s.whatsapp.net` : raw
  };
}

function addIdentifierCandidates(target, value) {
  if (Array.isArray(value)) {
    for (const item of value) addIdentifierCandidates(target, item);
    return target;
  }
  if (value && typeof value === 'object') {
    for (const key of ['id', 'jid', 'lid', 'number', 'phone', 'phoneNumber', 'pn']) {
      addIdentifierCandidates(target, value[key]);
    }
    return target;
  }

  const raw = rawIdentifier(value);
  if (!raw) return target;
  target.add(raw);

  const local = raw.split('@')[0].split(':')[0];
  if (local && raw.includes('@')) target.add(`${local}${raw.slice(raw.indexOf('@'))}`);

  const number = phoneNumberFromIdentifier(raw);
  if (number) {
    target.add(number);
    target.add(`${number}@s.whatsapp.net`);
  }
  return target;
}

function collectMessageIdentifiers(msg, ...extraIdentifiers) {
  const candidates = new Set();
  const key = msg?.key || {};
  for (const value of [
    key.participant,
    key.participantAlt,
    key.remoteJidAlt,
    key.senderPn,
    key.participantPn,
    key.remoteJid,
    ...extraIdentifiers
  ]) {
    addIdentifierCandidates(candidates, value);
  }
  return candidates;
}

function ownerNumbers(ownerValue) {
  if (Array.isArray(ownerValue)) return ownerValue.flatMap(ownerNumbers);
  return String(ownerValue || '')
    .split(/[,;|]+/)
    .map(phoneNumberFromIdentifier)
    .filter(Boolean);
}

function candidatesContain(candidates, value) {
  const identity = canonicalAdmin(value);
  return Boolean(
    (identity.raw && candidates.has(identity.raw)) ||
    (identity.number && (candidates.has(identity.number) || candidates.has(identity.jid)))
  );
}

function resolveAccess({ identifiers, ownerValue, adminEntries = [], sudoEntries = [], sessionNumber }) {
  const candidates = identifiers instanceof Set
    ? identifiers
    : addIdentifierCandidates(new Set(), identifiers);
  const owners = ownerNumbers(ownerValue);
  const session = phoneNumberFromIdentifier(sessionNumber);

  const isConfiguredOwner = owners.some(number => candidates.has(number) || candidates.has(`${number}@s.whatsapp.net`));
  const isSessionOwner = Boolean(session && (candidates.has(session) || candidates.has(`${session}@s.whatsapp.net`)));
  const isMongoAdmin = adminEntries.some(entry => candidatesContain(candidates, entry));
  const isSudo = sudoEntries.some(entry => candidatesContain(candidates, entry));

  return {
    isOwner: isConfiguredOwner || isSessionOwner,
    isConfiguredOwner,
    isSessionOwner,
    isMongoAdmin,
    isSudo,
    isPrivileged: isConfiguredOwner || isSessionOwner || isMongoAdmin || isSudo,
    candidates
  };
}

module.exports = {
  rawIdentifier,
  phoneNumberFromIdentifier,
  canonicalAdmin,
  addIdentifierCandidates,
  collectMessageIdentifiers,
  ownerNumbers,
  candidatesContain,
  resolveAccess
};
