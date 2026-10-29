'use strict';

const fs = require('fs');
const path = require('path');

const LOCAL_STORE_FILE = path.join(__dirname, '..', '..', 'config', 'data', 'reaction_commands.json');
// Map<sessionId::emojiKey, { emoji, emojiKey, command, creator, sessionId, createdAt }>
const reactionCmds = new Map();
const reactionCountsBySession = new Map();
let mongoCol = null;

function normalizeSessionId(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits || 'global';
}

function normalizeEmoji(emoji) {
  if (!emoji || typeof emoji !== 'string') return '';
  return emoji.trim().replace(/[\uFE0E\uFE0F]/g, '');
}

function scopedKey(sessionId, emoji) {
  return `${normalizeSessionId(sessionId)}::${normalizeEmoji(emoji)}`;
}

function adjustSessionReactionCount(sessionId, difference) {
  const normalizedSession = normalizeSessionId(sessionId);
  const next = Math.max(0, (reactionCountsBySession.get(normalizedSession) || 0) + difference);
  if (next) reactionCountsBySession.set(normalizedSession, next);
  else reactionCountsBySession.delete(normalizedSession);
}

function clearReactionCache() {
  reactionCmds.clear();
  reactionCountsBySession.clear();
}

function cacheReaction(doc) {
  if (!doc?.emoji || !doc?.command) return;
  const sessionId = normalizeSessionId(doc.sessionId);
  const emojiKey = normalizeEmoji(doc.emojiKey || doc.emoji);
  const key = scopedKey(sessionId, emojiKey);
  if (!reactionCmds.has(key)) adjustSessionReactionCount(sessionId, 1);
  reactionCmds.set(key, { ...doc, sessionId, emojiKey });
}

function isEmoji(value) {
  if (!value || typeof value !== 'string') return false;
  return /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u.test(value);
}

async function initReactionDb(mongoDB) {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, 'utf8'));
      if (Array.isArray(data)) data.forEach(cacheReaction);
    }
  } catch (error) {
    console.warn('[REACTION-CMD] Erreur lecture JSON local:', error.message);
  }

  try {
    if (mongoDB) {
      mongoCol = mongoDB.collection('reaction_commands');
      await mongoCol.updateMany(
        { $or: [{ sessionId: { $exists: false } }, { sessionId: null }, { sessionId: '' }] },
        { $set: { sessionId: 'global' } }
      );
      try { await mongoCol.dropIndex('emojiKey_1'); } catch (error) {
        if (!['IndexNotFound', 27].includes(error?.codeName) && error?.code !== 27) {
          console.warn('[REACTION-CMD] Suppression ancien index:', error.message);
        }
      }
      await mongoCol.createIndex({ sessionId: 1, emojiKey: 1 }, { unique: true });
      const docs = await mongoCol.find({}).toArray();
      docs.forEach(cacheReaction);
    }
  } catch (error) {
    console.warn('[REACTION-CMD] Erreur initialisation MongoDB:', error.message);
  }

  console.log(`✨ [REACTION-CMD] ${reactionCmds.size} commande(s) réaction chargée(s) en mémoire.`);
}

async function persistReactionCmds() {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(Array.from(reactionCmds.values()), null, 2));
  } catch (error) {
    console.error('[REACTION-CMD] Erreur écriture JSON:', error);
  }
}

async function setReactionCommand(emoji, command, creator = '', sessionId = 'global') {
  if (!emoji || !command) return false;
  const normalizedSession = normalizeSessionId(sessionId);
  const rawEmoji = String(emoji).trim();
  const emojiKey = normalizeEmoji(rawEmoji);
  const cleanCmd = String(command).trim().replace(/^[./!#]/, '');
  if (!emojiKey || !cleanCmd) return false;

  const doc = {
    emoji: rawEmoji,
    emojiKey,
    command: cleanCmd,
    creator: String(creator || ''),
    sessionId: normalizedSession,
    createdAt: Date.now()
  };
  cacheReaction(doc);
  await persistReactionCmds();

  if (mongoCol) {
    try {
      await mongoCol.updateOne(
        { sessionId: normalizedSession, emojiKey },
        { $set: doc },
        { upsert: true }
      );
    } catch (error) {
      console.warn('[REACTION-CMD] Erreur upsert Mongo:', error.message);
    }
  }
  return true;
}

function findReactionCommand(emoji, sessionId = 'global') {
  const emojiKey = normalizeEmoji(emoji);
  if (!emojiKey) return null;
  return reactionCmds.get(scopedKey(sessionId, emojiKey)) || null;
}

async function deleteReactionCommand(emojiOrCommand, sessionId = 'global') {
  if (!emojiOrCommand) return false;
  const normalizedSession = normalizeSessionId(sessionId);
  const directKey = scopedKey(normalizedSession, emojiOrCommand);
  let targetKey = reactionCmds.has(directKey) ? directKey : null;

  if (!targetKey) {
    const search = String(emojiOrCommand).toLowerCase().trim().replace(/^[./!#]/, '');
    for (const [key, item] of reactionCmds.entries()) {
      if (item.sessionId === normalizedSession && String(item.command).toLowerCase() === search) {
        targetKey = key;
        break;
      }
    }
  }
  if (!targetKey) return false;

  const target = reactionCmds.get(targetKey);
  reactionCmds.delete(targetKey);
  adjustSessionReactionCount(normalizedSession, -1);
  await persistReactionCmds();
  if (mongoCol) {
    try {
      await mongoCol.deleteOne({ sessionId: normalizedSession, emojiKey: target.emojiKey });
    } catch (error) {
      console.warn('[REACTION-CMD] Erreur suppression Mongo:', error.message);
    }
  }
  return true;
}

function hasReactionCommands(sessionId = 'global') {
  return (reactionCountsBySession.get(normalizeSessionId(sessionId)) || 0) > 0;
}

function getAllReactionCommands(sessionId = 'global') {
  const normalizedSession = normalizeSessionId(sessionId);
  return Array.from(reactionCmds.values()).filter(item => item.sessionId === normalizedSession);
}

initReactionDb().catch(() => {});

module.exports = {
  initReactionDb,
  normalizeSessionId,
  normalizeEmoji,
  scopedKey,
  isEmoji,
  setReactionCommand,
  findReactionCommand,
  deleteReactionCommand,
  hasReactionCommands,
  getAllReactionCommands,
  _test: { cacheReaction, clearReactionCache, reactionCmds }
};
