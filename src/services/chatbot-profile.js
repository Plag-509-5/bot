'use strict';

const { cleanHostName, normalizeWatchSamples } = require('./chatbot-watch');

const PROFILE_FORMAT = 'kaido-chatbot-profile';
const PROFILE_VERSION = 1;
const MAX_PROFILE_BYTES = 24 * 1024;

function buildChatbotProfileText({ hostName, watchEnabled, watchSamples } = {}) {
  const profile = {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    hostName: cleanHostName(hostName),
    watchEnabled: Boolean(watchEnabled),
    watchSamples: normalizeWatchSamples(watchSamples)
  };
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function parseChatbotProfileText(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) {
    throw new Error('Fichier vide ou trop volumineux.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (_) {
    throw new Error('Le fichier TXT n’est pas un profil Kaido valide.');
  }

  if (!parsed || parsed.format !== PROFILE_FORMAT || parsed.version !== PROFILE_VERSION) {
    throw new Error('Format de profil Kaido inconnu.');
  }
  if (typeof parsed.hostName !== 'string' || !Array.isArray(parsed.watchSamples)) {
    throw new Error('Le profil TXT ne contient pas les champs attendus.');
  }

  return {
    hostName: cleanHostName(parsed.hostName),
    watchEnabled: parsed.watchEnabled === true,
    watchSamples: normalizeWatchSamples(parsed.watchSamples)
  };
}

module.exports = {
  PROFILE_FORMAT,
  PROFILE_VERSION,
  MAX_PROFILE_BYTES,
  buildChatbotProfileText,
  parseChatbotProfileText
};
