'use strict';

const { configEnabled } = require('../../services/presence-mode');
const { clearConversation, clearSession, getStatus } = require('../../services/ai-chatbot');

function cleanNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function canManageChatbot(context = {}) {
  const sender = cleanNumber(context.senderNumber);
  const session = cleanNumber(context.sessionNumber);
  return Boolean(
    context.isOwner
    || context.isSessionOwner
    || context.isMongoAdmin
    || context.isSudo
    || context.isPrivileged
    || (sender && session && sender === session)
  );
}

async function send(socket, from, msg, text) {
  return socket.sendMessage(from, { text }, { quoted: msg });
}

module.exports = {
  name: 'chatbot',
  alias: ['autochat', 'kaido'],
  category: 'owner',
  description: 'Active, désactive ou affiche le statut du chatbot Kaido',
  usage: '.kaido on|off|status|clear',
  async execute(context) {
    const {
      socket,
      msg,
      from,
      args = [],
      prefix = '.',
      sessionCfg = {},
      sessionNumber,
      setUserConfigInMongo
    } = context;

    if (!canManageChatbot(context)) {
      return send(socket, from, msg, '❌ Seul le propriétaire, le propriétaire de session ou un sudo peut gérer Kaido.');
    }

    const action = String(args[0] || '').toLowerCase();
    if (!['on', 'off', 'status', 'clear'].includes(action)) {
      return send(socket, from, msg, [
        '🐉 *Kaido — chatbot*',
        `• ${prefix}kaido on — activer`,
        `• ${prefix}kaido off — désactiver`,
        `• ${prefix}kaido status — afficher le statut`,
        `• ${prefix}kaido clear — effacer la mémoire de conversation`
      ].join('\n'));
    }

    const session = cleanNumber(sessionNumber);
    if (!session) return send(socket, from, msg, '❌ Numéro de session introuvable.');
    if (typeof setUserConfigInMongo !== 'function') {
      return send(socket, from, msg, '❌ Le stockage MongoDB de la configuration est indisponible.');
    }

    if (action === 'status') {
      const state = getStatus();
      const providers = state.providers.length ? state.providers.join(', ') : 'aucun';
      return send(socket, from, msg, [
        `🐉 Kaido : *${configEnabled(sessionCfg.CHATBOT_ENABLED, false) ? 'ON' : 'OFF'}*`,
        `API configurées : ${providers}`,
        `Mémoire : ${state.memory.conversations}/${state.memory.maxConversations} conversations`,
        `File IA : ${state.queue.active} active(s), ${state.queue.queued} en attente`
      ].join('\n'));
    }

    if (action === 'clear') {
      const cleared = clearConversation(session, from);
      return send(socket, from, msg, cleared
        ? '✅ Mémoire IA de cette conversation effacée.'
        : 'ℹ️ Aucune mémoire IA active pour cette conversation.');
    }

    const enabled = action === 'on';
    if (enabled && !getStatus().providers.length) {
      return send(socket, from, msg,
        '❌ Aucune API IA n’est configurée. Renseigne JINA_API_KEY ou JINA_API_KEYS, GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY dans les variables d’environnement.');
    }

    const next = { ...sessionCfg, CHATBOT_ENABLED: enabled };
    let saved = false;
    try { saved = await setUserConfigInMongo(session, next); } catch (_) {}
    if (saved === false) return send(socket, from, msg, '❌ Le réglage de Kaido n’a pas pu être enregistré dans MongoDB.');

    if (!enabled) clearSession(session);
    return send(socket, from, msg, enabled
      ? '✅ Chatbot Kaido activé. Les réponses gardent la personnalité Kaido standard.'
      : '✅ Chatbot Kaido désactivé; sa mémoire de conversation en RAM a été effacée.');
  },
  _test: { cleanNumber, canManageChatbot }
};
