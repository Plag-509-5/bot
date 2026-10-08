'use strict';

const { normaliseTheme, genericCommandResponse } = require('../../services/oni-theme');
const { canManageSession, persistSessionPatch } = require('../../services/session-preferences');

function themeList(prefix, currentTheme) {
  const selected = normaliseTheme(currentTheme);
  return [
    '🎨 *THÈMES DISPONIBLES*',
    '',
    `1 — Aucun thème${selected === 'none' ? ' ✅' : ''}`,
    '    Conserve les réponses classiques du bot.',
    '',
    `2 — Onigashima Theme${selected === 'onigashima' ? ' ✅' : ''}`,
    '    Active le menu et les réponses KAIDO MD.',
    '',
    `Utilisation : ${prefix}changetheme 1 ou ${prefix}changetheme 2`
  ].join('\n');
}

module.exports = {
  name: 'changetheme',
  alias: ['theme'],
  category: 'owner',
  description: 'Choisit le thème visuel persistant de la session',
  usage: '.changetheme 1|2',
  async execute(context) {
    const { socket, from, msg, args, prefix, sessionCfg = {} } = context;
    if (!canManageSession(context)) {
      return socket.sendMessage(from, {
        text: '❌ Seul le propriétaire ou un sudo de cette session peut changer son thème.'
      }, { quoted: msg });
    }

    const choice = String(args[0] || '').trim().toLowerCase();
    if (!choice) {
      return socket.sendMessage(from, { text: themeList(prefix, sessionCfg.THEME) }, { quoted: msg });
    }
    if (!['1', '2', 'none', 'off', 'classic', 'onigashima', 'oni'].includes(choice)) {
      return socket.sendMessage(from, {
        text: `❌ Choix invalide. Utilise ${prefix}changetheme 1 ou ${prefix}changetheme 2.`
      }, { quoted: msg });
    }

    const theme = ['1', 'none', 'off', 'classic'].includes(choice) ? 'none' : 'onigashima';
    await persistSessionPatch(context, { THEME: theme });
    const confirmation = theme === 'none'
      ? '✅ Aucun thème activé pour cette session. Les commandes utilisent maintenant leur présentation classique.'
      : '✅ Onigashima Theme activé pour cette session. Le choix restera actif après redémarrage.';

    // Le changement doit être visible immédiatement, y compris dans la réponse
    // qui active ou désactive le thème actuellement sélectionné.
    return socket.sendMessage(from, {
      text: theme === 'none' ? confirmation : genericCommandResponse('changetheme', confirmation),
      ...(theme === 'none' ? { _skipOniTheme: true } : {})
    }, { quoted: msg });
  },
  _test: { themeList }
};
