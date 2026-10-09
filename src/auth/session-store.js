'use strict';

/**
 * session-store.js — couche disque de l'état d'authentification WhatsApp.
 *
 * Pourquoi ce module existe
 * -------------------------
 * Avant, les sessions vivaient dans `os.tmpdir()/session_<numéro>` et étaient
 * supprimées par `process.on('exit')`. Seule `creds.json` était sauvegardée
 * dans MongoDB : les clés Signal (pre-key, session, sender-key,
 * app-state-sync-key) écrites par Baileys dans `keys/` n'étaient JAMAIS
 * persistées. Après un redémarrage le bot retrouvait donc une identité valide
 * mais plus aucune clé — le téléphone, lui, croit toujours les avoir.
 * Résultat : ratchet désynchronisé, messages qui restent « en attente » et
 * session corrompue.
 *
 * Ce module garantit trois choses :
 *   1. les sessions vivent dans un dossier PERSISTANT (`sessions/`), jamais tmp ;
 *   2. chaque écriture JSON est ATOMIQUE (tmp + fsync + rename) : un crash en
 *      pleine écriture laisse l'ancien fichier intact, jamais un fichier tronqué ;
 *   3. on sait faire un instantané complet (creds + TOUTES les clés) et le
 *      restaurer, ce qui permet la sauvegarde dans MongoDB.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BufferJSON } = require('@whiskeysockets/baileys');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SESSIONS_ROOT = path.resolve(
  process.env.SESSIONS_DIR || path.join(PROJECT_ROOT, 'sessions')
);

/** Ne garde que les chiffres d'un numéro (50947440869, +509 474-408-69, …). */
function sanitizeNumber(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[^0-9]/g, '');
}

/** Dossier persistant d'une session. */
function sessionDir(number) {
  const sanitized = sanitizeNumber(number);
  if (!sanitized) throw new Error('Numéro de session invalide');
  return path.join(SESSIONS_ROOT, sanitized);
}

function credsPath(dir) {
  return path.join(dir, 'creds.json');
}

function keysDir(dir) {
  return path.join(dir, 'keys');
}

/**
 * Nom de fichier sûr pour une clé Signal.
 * Les identifiants contiennent `@`, `:` et parfois `.` — encodés en base64url
 * pour rester valables sur tous les systèmes de fichiers, sans collision.
 */
function keyFileName(type, id) {
  const encoded = Buffer.from(String(id), 'utf8').toString('base64url');
  return `${type}--${encoded}.json`;
}

function parseKeyFileName(fileName) {
  const match = /^(.+?)--([A-Za-z0-9_-]+)\.json$/.exec(fileName);
  if (!match) return null;
  const id = Buffer.from(match[2], 'base64url').toString('utf8');
  if (!id) return null;
  return { type: match[1], id };
}

/** Identifiant unique d'une clé, utilisé côté MongoDB. */
function keyRef(type, id) {
  return `${type}/${id}`;
}

/**
 * Écriture JSON atomique : fichier temporaire + fsync + rename.
 * `rename` remplace la cible de façon atomique sur POSIX comme sur Windows,
 * donc un lecteur ne voit jamais un JSON à moitié écrit.
 *
 * Les Buffers sont encodés avec `BufferJSON` (comme Baileys le fait dans
 * useMultiFileAuthState) : sans cela, ils seraient relus comme des objets.
 */
async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, BufferJSON.replacer), 'utf8');
    await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }
  try {
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Lecture JSON tolérante.
 * @returns {Promise<any>} la valeur, `undefined` si le fichier est absent,
 *          `null` s'il existe mais est illisible/corrompu.
 */
async function readJsonSafe(file) {
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    return null;
  }
  if (!raw || !raw.trim()) return null;
  try {
    // BufferJSON.reviver recrée les Buffers ({ type: 'Buffer', data } -> Buffer),
    // y compris pour les fichiers écrits par les anciennes versions.
    return JSON.parse(raw, BufferJSON.reviver);
  } catch (err) {
    return null;
  }
}

/** Toutes les clés Signal présentes sur disque, sous forme [{ type, id, value }]. */
async function readKeysFromDisk(dir) {
  const dirPath = keysDir(dir);
  let entries;
  try {
    entries = await fsp.readdir(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const keys = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const parsed = parseKeyFileName(name);
    if (!parsed) continue;
    // readJsonSafe : une clé corrompue est ignorée plutôt que de tout faire échouer.
    const value = await readJsonSafe(path.join(dirPath, name));
    if (value === undefined || value === null) continue;
    keys.push({ type: parsed.type, id: parsed.id, value });
  }
  return keys;
}

/** Écrit (ou supprime si `value` vaut null) une clé sur disque. */
async function writeKeyToDisk(dir, type, id, value) {
  const file = path.join(keysDir(dir), keyFileName(type, id));
  if (value === null || value === undefined) {
    await fsp.rm(file, { force: true });
    return;
  }
  await writeJsonAtomic(file, value);
}

/** Instantané complet : creds + toutes les clés. */
async function snapshotAuthDir(dir) {
  const creds = await readJsonSafe(credsPath(dir));
  const keys = await readKeysFromDisk(dir);
  return { creds: creds === undefined ? null : creds, keys };
}

/** Restaure un instantané complet (creds + clés) de façon atomique. */
async function restoreAuthDir(dir, snapshot) {
  await fsp.mkdir(keysDir(dir), { recursive: true });
  for (const key of snapshot?.keys || []) {
    await writeKeyToDisk(dir, key.type, key.id, key.value);
  }
  if (snapshot?.creds) await writeJsonAtomic(credsPath(dir), snapshot.creds);
}

/**
 * Déplace un dossier corrompu dans `sessions/_corrompu/<numéro>-<horodatage>`
 * au lieu de le supprimer : on garde la matière pour diagnostic.
 */
async function quarantineAuthDir(dir, reason = 'inconnue') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(SESSIONS_ROOT, '_corrompu', `${path.basename(dir)}-${stamp}`);
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(dir, target);
    await writeJsonAtomic(path.join(target, 'RAISON.json'), {
      raison: String(reason),
      date: new Date().toISOString()
    });
    return target;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('quarantineAuthDir:', err.message || err);
    return null;
  }
}

async function removeAuthDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

/** Liste les numéros de session présents sur disque. */
async function listLocalSessions() {
  let entries;
  try {
    entries = await fsp.readdir(SESSIONS_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const numbers = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sanitized = sanitizeNumber(entry.name);
    if (sanitized && sanitized === entry.name) numbers.push(sanitized);
  }
  return numbers;
}

/**
 * Contrôle structurel des creds.
 *
 * Un `creds.json` tronqué ou à moitié écrit passe `JSON.parse` dans certains
 * cas (objet vide, champs manquants) : Baileys part alors d'une identité
 * bancale et le téléphone rejette la session. On refuse explicitement ces
 * creds plutôt que de les utiliser.
 */
function credsLooksValid(creds) {
  if (!creds || typeof creds !== 'object') return false;
  if (!creds.noiseKey || typeof creds.noiseKey !== 'object') return false;
  if (!creds.noiseKey.private || !creds.noiseKey.public) return false;
  if (!creds.signedIdentityKey || !creds.signedIdentityKey.private) return false;
  if (!creds.signedPreKey || !creds.signedPreKey.keyPair || !creds.signedPreKey.signature) return false;
  if (!Number.isFinite(creds.registrationId)) return false;
  // Une session « enregistrée » sans identité connue est inutilisable.
  if (creds.registered && !(creds.me && creds.me.id)) return false;
  return true;
}

module.exports = {
  PROJECT_ROOT,
  SESSIONS_ROOT,
  sanitizeNumber,
  sessionDir,
  credsPath,
  keysDir,
  keyFileName,
  parseKeyFileName,
  keyRef,
  writeJsonAtomic,
  readJsonSafe,
  readKeysFromDisk,
  writeKeyToDisk,
  snapshotAuthDir,
  restoreAuthDir,
  quarantineAuthDir,
  removeAuthDir,
  listLocalSessions,
  credsLooksValid
};
