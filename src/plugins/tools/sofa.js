'use strict';

const { createClient } = require('../../services/sofascore');
const sofa = createClient();

module.exports = {
  name: 'sofa',
  alias: ['sofascore'],
  category: 'tools',
  description: 'Recherche des fiches SofaScore de joueurs, équipes et compétitions',
  usage: '.sofa player|team|tournament <nom>',
  async execute({ socket, msg, from, args = [], prefix = '.' }) {
    const type = String(args[0] || '').toLowerCase();
    const query = args.slice(1).join(' ').trim();
    if (!['player', 'joueur', 'team', 'equipe', 'équipe', 'tournament', 'competition', 'compétition'].includes(type) || !query) {
      return socket.sendMessage(from, {
        text: `⚽ *KAIDO SOFA*\n${prefix}sofa player <joueur>\n${prefix}sofa team <équipe>\n${prefix}sofa tournament <compétition>\n\nExemple : ${prefix}sofa player Kylian Mbappé`
      }, { quoted: msg });
    }
    const kind = ({ joueur: 'player', equipe: 'team', 'équipe': 'team', competition: 'tournament', 'compétition': 'tournament' })[type] || type;
    await socket.sendMessage(from, { react: { text: '⚽', key: msg.key } }).catch(() => {});
    try {
      const text = await sofa.search(kind, query);
      return socket.sendMessage(from, { text }, { quoted: msg });
    } catch (error) {
      console.warn('[SOFA API]', error?.message || error);
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      return socket.sendMessage(from, {
        text: `❌ Le service SofaScore ne répond pas pour le moment. Réessaie plus tard.\n_Détail : ${String(error?.message || error).slice(0, 250)}_`
      }, { quoted: msg });
    }
  },
  _test: { sofa }
};
