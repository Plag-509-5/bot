'use strict';

const { areSameIdentity, getBotJid, getIdentityJids } = require('./group-admins');

function getContextInfo(msg) {
  const message = msg?.message || {};
  return message.extendedTextMessage?.contextInfo
    || message.imageMessage?.contextInfo
    || message.videoMessage?.contextInfo
    || message.documentMessage?.contextInfo
    || {};
}

function resolveGroupCreationParticipant(msg, socket) {
  const context = getContextInfo(msg);
  const fromMe = Boolean(msg?.key?.fromMe);
  const candidates = fromMe
    ? [context.mentionedJid, context.mentionedJidAlt, context.participantAlt, context.participant]
    : [msg?.key?.participantAlt, msg?.key?.participant, msg?.key?.remoteJidAlt, msg?.key?.remoteJid];
  const botJid = getBotJid(null, socket);
  const identities = [];
  for (const candidate of candidates) {
    for (const jid of getIdentityJids(candidate)) {
      const server = jid.slice(jid.lastIndexOf('@') + 1);
      if (!['s.whatsapp.net', 'lid'].includes(server)) continue;
      if (areSameIdentity(jid, botJid)) continue;
      if (!identities.includes(jid)) identities.push(jid);
    }
  }
  return identities.find(jid => jid.endsWith('@s.whatsapp.net')) || identities[0] || '';
}

module.exports = { getContextInfo, resolveGroupCreationParticipant };
