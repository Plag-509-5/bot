'use strict';

const { configEnabled } = require('../../services/presence-mode');
const { clearConversation, clearSession, getStatus } = require('../../services/ai-chatbot');
const {
  collectHostIdentities,
  cleanHostName,
  createPendingHostName,
  normalizeWatchSamples
} = require('../../services/chatbot-watch');

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

function buildHelp(prefix) {
  return [
    '🐉 *Kaido — commandes IA*',
    `• ${prefix}kaido on — activer (demande le nom de l’hôte si absent)`,
    `• ${prefix}kaido off — désactiver sans effacer son profil`,
    `• ${prefix}kaido watch [on|off|status|clear] — apprendre le style de l’hôte`,
    `• ${prefix}kaido name <nom> — définir ou modifier le nom de l’hôte`,
    `• ${prefix}kaido status`,
    `• ${prefix}kaido clear — effacer la mémoire de conversation`,
    'Les exemples Watch sont limités et stockés dans MongoDB; `watch clear` les supprime.'
  ].join('\n');
}

module.exports = {
  name: 'chatbot',
  alias: ['autochat', 'kaido'],
  category: 'owner',
  description: 'Contrôle Kaido, son mode Watch et le profil de son hôte',
  usage: '.kaido on|off|watch [on|off|status|clear]|name <nom>|status|clear',
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
      return send(socket, from, msg, '❌ Seul l’hôte, le propriétaire du bot, un administrateur Mongo ou un sudo peut gérer Kaido.');
    }

    const action = String(args[0] || '').toLowerCase();
    if (!action || !['on', 'off', 'status', 'clear', 'watch', 'name'].includes(action)) {
      return send(socket, from, msg, buildHelp(prefix));
    }

    const session = cleanNumber(sessionNumber);
    if (!session) return send(socket, from, msg, '❌ Numéro de session introuvable.');
    if (typeof setUserConfigInMongo !== 'function') {
      return send(socket, from, msg, '❌ Le stockage MongoDB de la configuration est indisponible.');
    }

    const hostIdentities = collectHostIdentities(context);
    const currentSamples = normalizeWatchSamples(sessionCfg.CHATBOT_WATCH_SAMPLES);
    const currentName = cleanHostName(sessionCfg.CHATBOT_HOST_NAME);
    const watchEnabled = configEnabled(sessionCfg.CHATBOT_WATCH_ENABLED, false);

    const saveConfig = async next => {
      try { return await setUserConfigInMongo(session, next); } catch (_) { return false; }
    };

    if (action === 'status') {
      const state = getStatus();
      const enabled = configEnabled(sessionCfg.CHATBOT_ENABLED, false);
      const providers = state.providers.length ? state.providers.join(', ') : 'aucun (configure JINA_API_KEY ou une autre clé IA)';
      return send(socket, from, msg, [
        `🐉 Kaido : *${enabled ? 'ON' : 'OFF'}*`,
        `Hôte : *${currentName || 'non défini'}*`,
        `Watch : *${watchEnabled ? 'ON' : 'OFF'}* (${currentSamples.length} exemple(s))`,
        `API configurées : ${providers}`,
        `Mémoire RAM : ${state.memory.conversations}/${state.memory.maxConversations} conversations`,
        `File IA : ${state.queue.active} active(s), ${state.queue.queued} en attente`
      ].join('\n'));
    }

    if (action === 'clear') {
      try {
        const cleared = clearConversation(session, from);
        return send(socket, from, msg, cleared
          ? '✅ La mémoire IA de cette conversation a été effacée. Le nom de l’hôte et son profil Watch sont conservés.'
          : 'ℹ️ Aucune mémoire IA active pour cette conversation.');
      } catch (_) {
        return send(socket, from, msg, '❌ Impossible de résoudre cette conversation.');
      }
    }

    if (action === 'name') {
      const name = cleanHostName(args.slice(1).join(' '));
      if (name) {
        const next = {
          ...sessionCfg,
          CHATBOT_HOST_NAME: name,
          CHATBOT_HOST_IDENTITIES: hostIdentities.length ? hostIdentities : sessionCfg.CHATBOT_HOST_IDENTITIES || [],
          CHATBOT_PENDING_HOST_NAME: null
        };
        const saved = await saveConfig(next);
        return send(socket, from, msg, saved === false
          ? '❌ Impossible d’enregistrer ce nom dans MongoDB.'
          : `✅ Nom de l’hôte enregistré dans MongoDB : *${name}*.`);
      }

      const pending = createPendingHostName({ chatJid: from, identities: hostIdentities });
      if (!pending) return send(socket, from, msg, '❌ Je n’ai pas pu identifier l’hôte; réessaie depuis un chat privé avec ce compte.');
      const saved = await saveConfig({
        ...sessionCfg,
        CHATBOT_HOST_IDENTITIES: hostIdentities,
        CHATBOT_PENDING_HOST_NAME: pending
      });
      if (saved === false) return send(socket, from, msg, '❌ Impossible d’enregistrer la demande de nom dans MongoDB.');
      return send(socket, from, msg, '🐉 Comment dois-je t’appeler dans les conversations ? Réponds simplement à ce message avec ton nom ou ton pseudo.');
    }

    if (action === 'watch') {
      const subAction = String(args[1] || 'on').toLowerCase();
      if (!['on', 'off', 'status', 'clear'].includes(subAction)) {
        return send(socket, from, msg, `Usage : ${prefix}kaido watch [on|off|status|clear]`);
      }
      if (subAction === 'status') {
        return send(socket, from, msg,
          `👁️ Watch est *${watchEnabled ? 'ON' : 'OFF'}*. ${currentSamples.length} exemple(s) de style conservé(s) dans MongoDB.`);
      }
      if (subAction === 'clear') {
        const saved = await saveConfig({
          ...sessionCfg,
          CHATBOT_WATCH_SAMPLES: [],
          CHATBOT_HOST_IDENTITIES: hostIdentities.length ? hostIdentities : sessionCfg.CHATBOT_HOST_IDENTITIES || []
        });
        return send(socket, from, msg, saved === false
          ? '❌ Impossible d’effacer les exemples Watch dans MongoDB.'
          : '✅ Les exemples appris ont été supprimés. Watch reste ' + (watchEnabled ? 'actif.' : 'inactif.'));
      }

      const enabled = subAction === 'on';
      const saved = await saveConfig({
        ...sessionCfg,
        CHATBOT_WATCH_ENABLED: enabled,
        CHATBOT_HOST_IDENTITIES: hostIdentities.length ? hostIdentities : sessionCfg.CHATBOT_HOST_IDENTITIES || []
      });
      return send(socket, from, msg, saved === false
        ? '❌ Impossible d’enregistrer le réglage Watch dans MongoDB.'
        : enabled
          ? `✅ Watch activé. J’observerai uniquement tes messages textuels pour apprendre le ton, la longueur et les habitudes d’écriture. Jusqu’à 20 exemples sont conservés dans MongoDB; désactive avec ${prefix}kaido watch off ou efface-les avec ${prefix}kaido watch clear.`
          : '✅ Watch désactivé. Le profil déjà appris est conservé; utilise `watch clear` pour le supprimer.');
    }

    if (action === 'on' && !getStatus().providers.length) {
      return send(socket, from, msg,
        '❌ Aucune API IA n’est configurée. Ajoute JINA_API_KEY ou JINA_API_KEYS (liste séparée par virgules) dans les variables d’environnement, puis redémarre le bot.');
    }

    if (action === 'on' && !currentName) {
      const pending = createPendingHostName({ chatJid: from, identities: hostIdentities, enableAfterName: true });
      if (!pending) return send(socket, from, msg, '❌ Je n’ai pas pu identifier l’hôte; configure le nom depuis un chat privé.');
      const saved = await saveConfig({
        ...sessionCfg,
        CHATBOT_ENABLED: false,
        CHATBOT_HOST_IDENTITIES: hostIdentities,
        CHATBOT_PENDING_HOST_NAME: pending
      });
      if (saved === false) return send(socket, from, msg, '❌ Impossible d’enregistrer la demande de nom dans MongoDB.');
      return send(socket, from, msg, '🐉 Avant d’activer Kaido, comment dois-je t’appeler dans les conversations ? Réponds simplement à ce message avec ton nom ou ton pseudo.');
    }

    const enabled = action === 'on';
    const next = {
      ...sessionCfg,
      CHATBOT_ENABLED: enabled,
      CHATBOT_PENDING_HOST_NAME: null,
      ...(hostIdentities.length ? { CHATBOT_HOST_IDENTITIES: hostIdentities } : {})
    };
    const saved = await saveConfig(next);
    if (saved === false) return send(socket, from, msg, '❌ Le réglage de Kaido n’a pas pu être enregistré dans MongoDB.');

    if (!enabled) clearSession(session);
    return send(socket, from, msg, enabled
      ? `✅ Kaido est activé pour cette session. Il répondra sous le nom de *${currentName || 'Kaido'}*; les commandes restent prioritaires. Watch est ${watchEnabled ? 'actif' : 'inactif'}.`
      : '✅ Kaido est désactivé et sa mémoire de conversation en RAM a été effacée; le nom de l’hôte et le profil Watch restent enregistrés dans MongoDB.');
  },
  _test: { cleanNumber, canManageChatbot, buildHelp }
};
