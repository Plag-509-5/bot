'use strict';

const fs = require('fs');
const path = require('path');

const LOCAL_STORE_FILE = path.join(__dirname, '..', '..', 'config', 'data', 'sticker_commands.json');
// Map<sessionId::hash, { hash, command, creator, createdAt, sessionId }>
const stickerCmds = new Map();
let mongoCol = null;

function normalizeSessionId(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits || 'global';
}

function scopedKey(sessionId, hash) {
  return `${normalizeSessionId(sessionId)}::${String(hash || '')}`;
}

function cacheSticker(doc) {
  if (!doc?.hash || !doc?.command) return;
  const sessionId = normalizeSessionId(doc.sessionId);
  stickerCmds.set(scopedKey(sessionId, doc.hash), { ...doc, sessionId });
}

async function initStickerDb(mongoDB) {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, 'utf8'));
      if (Array.isArray(data)) data.forEach(cacheSticker);
    }
  } catch (error) {
    console.warn('[STICKER-CMD] Impossible de lire le fichier JSON local:', error.message);
  }

  try {
    if (mongoDB) {
      mongoCol = mongoDB.collection('sticker_commands');
      await mongoCol.updateMany(
        { $or: [{ sessionId: { $exists: false } }, { sessionId: null }, { sessionId: '' }] },
        { $set: { sessionId: 'global' } }
      );
      // L'ancien index interdisait qu'un même sticker ait une commande différente
      // dans deux sessions. Il est remplacé par un index composé par session.
      try { await mongoCol.dropIndex('hash_1'); } catch (error) {
        if (!['IndexNotFound', 27].includes(error?.codeName) && error?.code !== 27) {
          console.warn('[STICKER-CMD] Suppression ancien index:', error.message);
        }
      }
      await mongoCol.createIndex({ sessionId: 1, hash: 1 }, { unique: true });
      const docs = await mongoCol.find({}).toArray();
      docs.forEach(cacheSticker);
    }
  } catch (error) {
    console.warn('[STICKER-CMD] Erreur d’initialisation MongoDB:', error.message);
  }

  console.log(`🧩 [STICKER-CMD] ${stickerCmds.size} commande(s) sticker chargée(s) en mémoire.`);
}

async function persistStickerCmds() {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(Array.from(stickerCmds.values()), null, 2));
  } catch (error) {
    console.error('[STICKER-CMD] Erreur écriture JSON:', error);
  }
}

function extractStickerHashes(stickerMessage) {
  if (!stickerMessage) return [];
  const hashes = [];
  const addValue = value => {
    if (!value) return;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      hashes.push(Buffer.from(value).toString('base64'));
      hashes.push(Buffer.from(value).toString('hex'));
    } else if (typeof value === 'string') {
      hashes.push(value);
    }
  };
  addValue(stickerMessage.fileSha256);
  addValue(stickerMessage.mediaKey);
  addValue(stickerMessage.fileEncSha256);
  return [...new Set(hashes)].filter(Boolean);
}

function getPrimaryStickerHash(stickerMessage) {
  if (!stickerMessage) return null;
  for (const value of [stickerMessage.fileSha256, stickerMessage.mediaKey, stickerMessage.fileEncSha256]) {
    if (!value) continue;
    return Buffer.isBuffer(value) || value instanceof Uint8Array
      ? Buffer.from(value).toString('base64')
      : String(value);
  }
  return null;
}

async function setStickerCommand(hash, command, creator = '', sessionId = 'global') {
  if (!hash || !command) return false;
  const normalizedSession = normalizeSessionId(sessionId);
  const cleanCmd = String(command).trim().replace(/^[./!#]/, '');
  if (!cleanCmd) return false;
  const doc = {
    hash: String(hash),
    command: cleanCmd,
    creator: String(creator || ''),
    sessionId: normalizedSession,
    createdAt: Date.now()
  };

  stickerCmds.set(scopedKey(normalizedSession, doc.hash), doc);
  await persistStickerCmds();
  if (mongoCol) {
    try {
      await mongoCol.updateOne(
        { sessionId: normalizedSession, hash: doc.hash },
        { $set: doc },
        { upsert: true }
      );
    } catch (error) {
      console.warn('[STICKER-CMD] Erreur upsert Mongo:', error.message);
    }
  }
  return true;
}

function findStickerCommand(stickerMessage, sessionId = 'global') {
  const normalizedSession = normalizeSessionId(sessionId);
  for (const hash of extractStickerHashes(stickerMessage)) {
    const command = stickerCmds.get(scopedKey(normalizedSession, hash));
    if (command) return command;
  }
  return null;
}

async function deleteStickerCommand(hashOrCommand, sessionId = 'global') {
  if (!hashOrCommand) return false;
  const normalizedSession = normalizeSessionId(sessionId);
  const directKey = scopedKey(normalizedSession, hashOrCommand);
  let targetKey = stickerCmds.has(directKey) ? directKey : null;

  if (!targetKey) {
    const search = String(hashOrCommand).toLowerCase().trim().replace(/^[./!#]/, '');
    for (const [key, item] of stickerCmds.entries()) {
      if (item.sessionId === normalizedSession && String(item.command).toLowerCase() === search) {
        targetKey = key;
        break;
      }
    }
  }
  if (!targetKey) return false;

  const target = stickerCmds.get(targetKey);
  stickerCmds.delete(targetKey);
  await persistStickerCmds();
  if (mongoCol) {
    try {
      await mongoCol.deleteOne({ sessionId: normalizedSession, hash: target.hash });
    } catch (error) {
      console.warn('[STICKER-CMD] Erreur suppression Mongo:', error.message);
    }
  }
  return true;
}

function getAllStickerCommands(sessionId = 'global') {
  const normalizedSession = normalizeSessionId(sessionId);
  return Array.from(stickerCmds.values()).filter(item => item.sessionId === normalizedSession);
}

initStickerDb().catch(() => {});

module.exports = {
  initStickerDb,
  normalizeSessionId,
  scopedKey,
  extractStickerHashes,
  getPrimaryStickerHash,
  setStickerCommand,
  findStickerCommand,
  deleteStickerCommand,
  getAllStickerCommands,
  _test: { cacheSticker, stickerCmds }
};
