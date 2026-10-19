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
  alias: ['autochat'],
  category: 'owner',
  description: 'Active ou désactive le chatbot Kaido pour cette session WhatsApp',
  usage: '.chatbot on|off|status|clear',
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
      return send(socket, from, msg, '❌ Seul le propriétaire de la session, le propriétaire du bot, un administrateur Mongo ou un sudo peut gérer le chatbot.');
    }

    const action = String(args[0] || '').toLowerCase();
    if (!action || !['on', 'off', 'status', 'clear'].includes(action)) {
      return send(socket, from, msg, [
        '🐉 *Contrôle du chatbot Kaido*',
        `• ${prefix}chatbot on`,
        `• ${prefix}chatbot off`,
        `• ${prefix}chatbot status`,
        `• ${prefix}chatbot clear`
      ].join('\n'));
    }

    const session = cleanNumber(sessionNumber);
    if (!session) return send(socket, from, msg, '❌ Numéro de session introuvable.');

    if (action === 'status') {
      const state = getStatus();
      const enabled = configEnabled(sessionCfg.CHATBOT_ENABLED, false);
      const providers = state.providers.length ? state.providers.join(', ') : 'aucun (ajoute une clé API dans .env)';
      return send(socket, from, msg, [
        `🐉 Chatbot Kaido : *${enabled ? 'ON' : 'OFF'}*`,
        `API configurées : ${providers}`,
        `Mémoire en RAM : ${state.memory.conversations}/${state.memory.maxConversations} conversations`,
        `File IA : ${state.queue.active} active(s), ${state.queue.queued} en attente`
      ].join('\n'));
    }

    if (action === 'clear') {
      try {
        const cleared = clearConversation(session, from);
        return send(socket, from, msg, cleared
          ? '✅ La mémoire de cette conversation a été effacée.'
          : 'ℹ️ Aucune mémoire active pour cette conversation.');
      } catch (_) {
        return send(socket, from, msg, '❌ Impossible de résoudre cette conversation.');
      }
    }

    if (action === 'on' && !getStatus().providers.length) {
      return send(socket, from, msg,
        '❌ Aucune API IA n’est configurée. Ajoute au moins une clé — GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY — dans .env, puis redémarre le bot. Un endpoint compatible accepte aussi AI_COMPAT_BASE_URL + AI_COMPAT_API_KEY + AI_COMPAT_MODEL.');
    }

    if (typeof setUserConfigInMongo !== 'function') {
      return send(socket, from, msg, '❌ Le stockage de configuration est indisponible.');
    }

    const next = { ...sessionCfg, CHATBOT_ENABLED: action === 'on' };
    let saved;
    try {
      saved = await setUserConfigInMongo(session, next);
    } catch (_) {
      saved = false;
    }
    if (saved === false) return send(socket, from, msg, '❌ Le réglage du chatbot n’a pas pu être enregistré.');

    if (action === 'off') clearSession(session);
    return send(socket, from, msg, action === 'on'
      ? '✅ Chatbot Kaido activé pour cette session. Les messages ordinaires des conversations autorisées seront envoyés aux API configurées; les commandes du bot restent prioritaires. La mémoire est limitée et conservée uniquement en RAM.'
      : '✅ Chatbot désactivé pour cette session; sa mémoire en RAM a été effacée.');
  },
  _test: { cleanNumber, canManageChatbot }
};
