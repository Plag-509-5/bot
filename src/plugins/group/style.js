'use strict';

const swgc = require('./swgc');
const fancyText = require('../tools/fancy');
const { unwrapMessage } = require('../../services/group-status-content');

function quotedAudioFromContext(context = {}) {
  const quoted = swgc.quotedMessageFromContext(context);
  return unwrapMessage(quoted).audioMessage || null;
}

async function sendStyleUsage(context) {
  const { socket, from, msg, prefix = '.' } = context;
  return socket.sendMessage(from, {
    text: `🎧 Réponds à un audio avec ${prefix}style pour publier sa version vidéo stylisée sur le statut du groupe.`
  }, msg ? { quoted: msg } : undefined);
}

async function executeStyle(context, dependencies = {}) {
  const from = String(context.from || '');
  const isGroup = from.endsWith('@g.us');
  const textInput = (Array.isArray(context.args) ? context.args : []).join(' ').trim();
  const quotedAudio = quotedAudioFromContext(context);
  const quoted = swgc.quotedMessageFromContext(context);

  if (quotedAudio) {
    return swgc.executeStyledAudioStatus(context, dependencies);
  }

  if (!textInput && !quoted && !isGroup) {
    return swgc.executeStyledAudioStatus(context, dependencies);
  }

  if (!textInput && isGroup) {
    return sendStyleUsage(context);
  }

  // `.style <texte>` reste compatible avec l’ancien alias Fancy Text.
  return fancyText.execute(context);
}

module.exports = {
  name: 'style',
  category: 'group',
  description: 'Publie un audio comme vidéo stylisée sur un statut de groupe; garde le mode texte Fancy',
  usage: '.style [texte] | répondre à un audio avec .style',
  execute: executeStyle,
  _test: { quotedAudioFromContext, executeStyle, sendStyleUsage }
};
