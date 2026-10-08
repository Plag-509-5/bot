'use strict';

// Sérialisation indépendante du fork. Compatible avec BufferJSON (base64),
// les anciens JSON natifs de Buffer ({ type, data: [...] }) et BSON Binary.
// Ne pas transformer toutes les chaînes base64 ou tous les objets numériques :
// les JID, compteurs et tables de clés Signal doivent rester des objets.
const LEGACY_BYTE_FIELDS = new Set([
  'private', 'public', 'signature', 'keyData', 'mediaKey', 'rootKey', 'chainKey',
  'baseKey', 'ephemeralKeyPair', 'indexMac', 'snapshotMac', 'valueMac'
]);

function authJsonReplacer(key, value) {
  // JSON appelle Buffer.toJSON avant le replacer, d'où la seconde condition.
  if (value instanceof Uint8Array) {
    return { type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return { type: 'Buffer', data: Buffer.from(value.data).toString('base64') };
  }
  return value;
}

function authJsonReviver(key, value) {
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'Buffer' && (typeof value.data === 'string' || Array.isArray(value.data))) {
    return Buffer.from(value.data, typeof value.data === 'string' ? 'base64' : undefined);
  }
  // Anciennes Uint8Array écrites sans replacer : { "0": 1, "1": 2, ... }.
  if (LEGACY_BYTE_FIELDS.has(key) && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length && keys.every((name, index) => name === String(index))
      && keys.every(name => Number.isInteger(value[name]) && value[name] >= 0 && value[name] <= 255)) {
      return Buffer.from(Object.values(value));
    }
  }
  return value;
}

/** Normalise aussi les valeurs d'un backend (Mongo renvoie BSON Binary). */
function reviveAuthValue(value, key = '') {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value._bsontype === 'Binary' && typeof value.value === 'function') {
    return Buffer.from(value.value(true));
  }
  if (value instanceof Date) return value;
  const binary = authJsonReviver(key, value);
  if (Buffer.isBuffer(binary)) return binary;
  if (Array.isArray(value)) return value.map(item => reviveAuthValue(item));
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, reviveAuthValue(item, name)]));
}

module.exports = { authJsonReplacer, authJsonReviver, reviveAuthValue };
