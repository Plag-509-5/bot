'use strict';

/** Ne conserve que les chiffres d'un numéro WhatsApp. */
function sanitizeNumber(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[^0-9]/g, '');
}

/**
 * Vérification structurelle minimale des identifiants générés par Baileys.
 *
 * On refuse un document MongoDB tronqué avant de l'envoyer à Signal. Une
 * session enregistrée doit aussi avoir une identité (`me.id`).
 */
function credsLooksValid(creds) {
  if (!creds || typeof creds !== 'object') return false;
  if (!creds.noiseKey?.private || !creds.noiseKey?.public) return false;
  if (!creds.signedIdentityKey?.private || !creds.signedIdentityKey?.public) return false;
  if (!creds.signedPreKey?.keyPair?.private || !creds.signedPreKey?.keyPair?.public) return false;
  if (!creds.signedPreKey?.signature) return false;
  if (!Number.isFinite(creds.registrationId)) return false;
  if (creds.registered && !creds.me?.id) return false;
  return true;
}

function identityOf(creds) {
  const id = creds?.me?.id;
  return id ? String(id).split(':')[0] : '';
}

module.exports = {
  sanitizeNumber,
  credsLooksValid,
  identityOf
};
