'use strict';

/**
 * auth-serializer.js — sérialisation fidèle des creds et clés Signal.
 *
 * Pourquoi ce module existe
 * -------------------------
 * Les creds et les clés Signal de Baileys/Wileys contiennent des `Buffer`
 * (clés publiques/privées, signatures, identifiants…). Un `JSON.stringify`
 * « nu » transforme chaque Buffer en `{ "type": "Buffer", "data": [...] }`, et
 * un `JSON.parse` « nu » ne le retransforme jamais en Buffer. Après un
 * redémarrage, Baileys se retrouvait donc avec des objets à la place des clés :
 * impossible de déchiffrer / signer correctement, d'où les messages bloqués
 * « en attente » et les sessions « corrompues ».
 *
 * MongoDB a le même problème : le driver renvoie les champs binaires sous forme
 * d'objets `Binary` (et non de `Buffer`).
 *
 * Ce module applique donc le même encodage que Baileys (`BufferJSON`) :
 *   - à l'écriture : Buffer -> { type: 'Buffer', data: <base64> } (sans rien
 *     tronquer ni modifier d'autre) ;
 *   - à la lecture : { type: 'Buffer' } ou Binary -> Buffer, récursivement.
 *
 * Les anciennes données (écrites avant ce correctif) restent lisibles : elles
 * utilisent déjà la forme `{ type: 'Buffer', data }` ou `Binary`.
 */

const { BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Valeur prête à être stockée (JSON pur / documents MongoDB), Buffers encodés
 * de la même façon que Baileys. `undefined`/`null` sont rendus tels quels.
 */
function toStorable(value) {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value, BufferJSON.replacer);
  return json === undefined ? undefined : JSON.parse(json);
}

/** Convertit un objet BSON `Binary` en Buffer Node.js. */
function binaryToBuffer(binary) {
  const raw = binary.buffer;
  if (!raw) return Buffer.alloc(0);
  const size = typeof binary.position === 'number' ? binary.position : raw.length;
  return Buffer.from(raw).subarray(0, size);
}

/** Parcourt récursivement une valeur relue depuis MongoDB ou le disque. */
function reviveDeep(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return value;
  if (value._bsontype === 'Binary') return binaryToBuffer(value);
  if (Array.isArray(value)) return value.map(reviveDeep);
  if (value.type === 'Buffer' && (Array.isArray(value.data) || typeof value.data === 'string')) {
    return BufferJSON.reviver('', value);
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = reviveDeep(child);
  return out;
}

/**
 * Restaure une valeur stockée en valeur Baileys fidèle.
 * Accepte : chaîne JSON, objet JSON (avec `{type:'Buffer'}`) ou objet BSON.
 */
function fromStored(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value, BufferJSON.reviver);
    } catch (err) {
      return value;
    }
  }
  return reviveDeep(value);
}

module.exports = {
  toStorable,
  fromStored,
  binaryToBuffer
};
