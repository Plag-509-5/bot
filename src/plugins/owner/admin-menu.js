'use strict';

const ADMIN_MENU_COMMANDS = Object.freeze([
  ['active', 'Afficher les sessions actives'],
  ['deladmin', 'Retirer un administrateur du bot'],
  ['plaglist', 'Lister les chaînes sauvegardées'],
  ['cfn', 'Gérer la réaction aux nouveaux posts'],
  ['unfollow', 'Ne plus suivre une chaîne'],
  ['force', 'Forcer une action de gestion'],
  ['madmin', 'Afficher ce menu admin']
]);

module.exports = {
  name: 'madmin',
  category: 'owner',
  description: 'Affiche le menu spécial administrateur',
  usage: '.madmin',
  async execute({ socket, msg, from, prefix, isPrivileged, isOwner, isSessionOwner, isMongoAdmin, isSudo }) {
    if (!(isPrivileged || isOwner || isSessionOwner || isMongoAdmin || isSudo)) {
      return socket.sendMessage(from, {
        text: '⛔ Cette commande est réservée aux propriétaires et administrateurs autorisés.'
      }, { quoted: msg });
    }

    const lines = [
      '╭━━━〔 🔐 MENU ADMIN 〕━━━',
      ...ADMIN_MENU_COMMANDS.map(([name, description]) => `┃ ${prefix}${name} — ${description}`),
      '╰━━━━━━━━━━━━━━━━━━━━━━'
    ];
    return socket.sendMessage(from, { text: lines.join('\n') }, { quoted: msg });
  },
  _test: { ADMIN_MENU_COMMANDS }
};
