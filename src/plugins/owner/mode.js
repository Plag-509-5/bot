'use strict';

const {
  normaliseMode,
  canManageSession,
  persistSessionPatch
} = require('../../services/session-preferences');

async function send(socket, from, msg, text) {
  return socket.sendMessage(from, { text }, { quoted: msg });
}

module.exports = {
  name: 'mode',
  alias: ['self', 'private', 'public'],
  category: 'owner',
  description: 'Définit le mode public ou privé uniquement pour la session courante',
  usage: '.mode public|private',
  async execute(context) {
    const { socket, from, msg, command, args, prefix, sessionCfg = {} } = context;
    if (!canManageSession(context)) {
      return send(socket, from, msg, '❌ Seul le propriétaire ou un sudo de cette session peut modifier son mode.');
    }

    const requested = ['self', 'private'].includes(command)
      ? 'private'
      : command === 'public'
        ? 'public'
        : normaliseMode(args[0]);

    if (!requested) {
      return send(socket, from, msg,
        `⚙️ Mode actuel de cette session : *${normaliseMode(sessionCfg.MODE) || 'public'}*\n` +
        `Usage : ${prefix}mode public|private`);
    }

    await persistSessionPatch(context, { MODE: requested });
    return send(socket, from, msg,
      `✅ Mode *${requested}* enregistré uniquement pour la session *${context.sessionNumber}*.\n` +
      'Ce réglage sera restauré après chaque redémarrage.');
  }
};
