'use strict';

function cleanNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normaliseMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['public', 'private'].includes(mode) ? mode : '';
}

function normaliseSudoUsers(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/[,;|\s]+/);
  return [...new Set(source.map(cleanNumber).filter(number => /^\d{6,15}$/.test(number)))];
}

function canManageSession({ isOwner, isSessionOwner, isSudo }) {
  return Boolean(isOwner || isSessionOwner || isSudo);
}

function canManageSudo({ isOwner, isSessionOwner }) {
  return Boolean(isOwner || isSessionOwner);
}

async function persistSessionPatch({ sessionNumber, sessionCfg, setUserConfigInMongo }, patch) {
  const number = cleanNumber(sessionNumber);
  if (!number) throw new Error('Numéro de session invalide');
  if (typeof setUserConfigInMongo !== 'function') {
    throw new Error('Le stockage persistant de la session est indisponible');
  }
  const next = { ...(sessionCfg || {}), ...(patch || {}) };
  if (Object.prototype.hasOwnProperty.call(next, 'SUDO_USERS')) {
    next.SUDO_USERS = normaliseSudoUsers(next.SUDO_USERS);
  }
  const saved = await setUserConfigInMongo(number, next);
  if (saved === false) throw new Error('La configuration de la session n’a pas pu être enregistrée');
  return next;
}

module.exports = {
  cleanNumber,
  normaliseMode,
  normaliseSudoUsers,
  canManageSession,
  canManageSudo,
  persistSessionPatch
};
