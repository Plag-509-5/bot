'use strict';

const crypto = require('node:crypto');
const META_AI_JID = '0@s.whatsapp.net';
const META_AI_PHONE = '13135550002';
const WRAPPED = Symbol('kaidoMetaAiFakeQuoteWrapped');

function createMetaAiFakeQuote(displayName = 'Meta AI') {
  const name = String(displayName || 'Meta AI').replace(/[\r\n]+/g, ' ').slice(0, 80);
  return {
    key: {
      remoteJid: 'status@broadcast',
      participant: META_AI_JID,
      fromMe: false,
      id: `META_AI_FAKE_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    },
    message: {
      contactMessage: {
        displayName: name,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=${META_AI_PHONE}:+1 313 555 0002\nEND:VCARD`
      }
    }
  };
}

function isControlPayload(content) {
  if (!content || typeof content !== 'object') return false;
  return Boolean(content.react || content.delete || content.edit || content.event);
}

function isFakeEventQuote(quoted) {
  return Boolean(quoted?.message?.eventMessage);
}

function setupMetaAiFakeQuote(socket) {
  if (!socket || typeof socket.sendMessage !== 'function' || socket.sendMessage[WRAPPED]) return false;
  const original = socket.sendMessage;

  async function sendMessageWithMetaAiQuote(jid, content, options = {}) {
    if (String(jid || '') !== 'status@broadcast' && !isControlPayload(content)
      && !isFakeEventQuote(options?.quoted)) {
      options = { ...(options || {}), quoted: createMetaAiFakeQuote() };
    }
    return original.call(this, jid, content, options);
  }

  Object.defineProperty(sendMessageWithMetaAiQuote, WRAPPED, { value: true });
  socket.sendMessage = sendMessageWithMetaAiQuote;
  return true;
}

module.exports = {
  META_AI_JID,
  createMetaAiFakeQuote,
  isControlPayload,
  isFakeEventQuote,
  setupMetaAiFakeQuote
};
