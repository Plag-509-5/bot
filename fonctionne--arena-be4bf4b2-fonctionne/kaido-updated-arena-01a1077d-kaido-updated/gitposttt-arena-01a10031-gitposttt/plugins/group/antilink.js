const { toggleAntiLink, isAntiLinkEnabled } = require('../../antilink');

module.exports = {
  name: 'antilink',
  alias: ['antilinks', 'anti-link'],
  category: 'group',
  description: 'Active ou désactive la protection contre les liens dans le groupe',
  usage: '.antilink on / .antilink off / .antilink status',
  isGroup: true,
  isAdmin: true,
  async execute({ socket, msg, from, args, prefix }) {
    const action = (args[0] || '').toLowerCase();

    if (action === 'on' || action === 'enable' || action === '1') {
      toggleAntiLink(from, true);
      return await socket.sendMessage(from, {
        text: '🛡️ *Anti-Link ACTIVÉ !* Tout message contenant un lien externe sera automatiquement supprimé.'
      }, { quoted: msg });
    }

    if (action === 'off' || action === 'disable' || action === '0') {
      toggleAntiLink(from, false);
      return await socket.sendMessage(from, {
        text: '🔓 *Anti-Link DÉSACTIVÉ !* Les membres peuvent désormais partager des liens.'
      }, { quoted: msg });
    }

    const currentStatus = isAntiLinkEnabled(from);
    return await socket.sendMessage(from, {
      text: `🛡️ *Statut Anti-Link pour ce groupe :* ${currentStatus ? '✅ ACTIVÉ' : '❌ DÉSACTIVÉ'}\n\n*Utilisation :*\n• \`${prefix}antilink on\`\n• \`${prefix}antilink off\``
    }, { quoted: msg });
  }
};
