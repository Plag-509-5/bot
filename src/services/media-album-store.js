'use strict';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ALBUMS = 40;
const DEFAULT_MAX_MESSAGES_PER_ALBUM = 30;

function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const next = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message
      || current.editedMessage?.message;
    if (!next) break;
    current = next;
  }
  return current || {};
}

function getImageMessage(message) {
  const content = unwrapMessage(message?.message || message);
  return content.imageMessage || null;
}

function albumAssociation(message) {
  const content = unwrapMessage(message?.message || message);
  const parentMessageKey = content.messageContextInfo?.messageAssociation?.parentMessageKey;
  return parentMessageKey?.id ? parentMessageKey : null;
}

function createMediaAlbumStore({
  ttlMs = DEFAULT_TTL_MS,
  maxAlbums = DEFAULT_MAX_ALBUMS,
  maxMessagesPerAlbum = DEFAULT_MAX_MESSAGES_PER_ALBUM,
  now = Date.now
} = {}) {
  const albums = new Map();

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [key, album] of albums) {
      if (album.updatedAt <= cutoff) albums.delete(key);
    }
    while (albums.size > maxAlbums) albums.delete(albums.keys().next().value);
  }

  function record(remoteJid, message) {
    if (!remoteJid || !message?.key?.id || !message.message) return false;
    const content = unwrapMessage(message.message);
    const association = albumAssociation(message);
    const isAlbumParent = Boolean(content.albumMessage);
    const parentId = association?.id || (isAlbumParent ? message.key.id : null);
    if (!parentId || (!isAlbumParent && !getImageMessage(message))) return false;

    prune();
    const key = `${remoteJid}\u0000${parentId}`;
    let album = albums.get(key);
    if (!album) {
      album = { remoteJid, parentId, messages: new Map(), expectedImageCount: 0, updatedAt: now() };
      albums.set(key, album);
    } else {
      // Refresh insertion order for bounded LRU eviction.
      albums.delete(key);
      albums.set(key, album);
    }
    if (isAlbumParent) {
      const expected = Number(content.albumMessage.expectedImageCount) || 0;
      album.expectedImageCount = Math.max(album.expectedImageCount, expected);
    } else if (getImageMessage(message)) {
      album.messages.delete(message.key.id);
      album.messages.set(message.key.id, message);
      while (album.messages.size > maxMessagesPerAlbum) {
        album.messages.delete(album.messages.keys().next().value);
      }
    }
    album.updatedAt = now();
    prune();
    return true;
  }

  function getImages(remoteJid, parentId, quotedMessage = null) {
    prune();
    if (!remoteJid || !parentId) return { messages: [], expectedImageCount: 0 };
    const album = albums.get(`${remoteJid}\u0000${parentId}`);
    const byId = new Map(album?.messages || []);
    if (quotedMessage?.key?.id && getImageMessage(quotedMessage)) byId.set(quotedMessage.key.id, quotedMessage);
    const messages = [...byId.values()].sort((a, b) => {
      const at = Number(a.messageTimestamp) || 0;
      const bt = Number(b.messageTimestamp) || 0;
      return at - bt || String(a.key.id).localeCompare(String(b.key.id));
    });
    return { messages, expectedImageCount: album?.expectedImageCount || 0 };
  }

  return { record, getImages, prune, size: () => albums.size };
}

module.exports = {
  createMediaAlbumStore,
  unwrapMessage,
  getImageMessage,
  albumAssociation
};
