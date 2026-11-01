'use strict';

const chain = require('../../services/word-chain');

module.exports = {
  name: 'wordchain',
  alias: ['chaindemots'],
  category: 'games',
  description: 'Jeu de chaîne de mots : commence par la dernière lettre du mot précédent',
  usage: '.wordchain [start|mot|stop]',
  async execute({ socket, msg, from, args = [], prefix = '.', sessionNumber, sender }) {
    const value = args.join(' ').trim();
    const normalized = value.toLowerCase();
    if (!value || ['start', 'début', 'debut', 'aide', 'help'].includes(normalized)) {
      const state = chain.start(sessionNumber, from);
      return socket.sendMessage(from, {
        text: `🔗 *KAIDO — CHAÎNE DE MOTS*\nLe mot de départ est *${state.current}*.\nÀ toi : propose un mot commençant par *${chain.normalizeWord(state.current).slice(-1).toUpperCase()}*.\n\nUtilise ${prefix}wordchain <mot> pour jouer et ${prefix}wordchain stop pour terminer.`,
      }, { quoted: msg });
    }
    if (['stop', 'arrêter', 'arreter'].includes(normalized)) {
      const state = chain.stop(sessionNumber, from);
      if (!state) return socket.sendMessage(from, { text: 'Aucune partie de chaîne de mots en cours.' }, { quoted: msg });
      const scores = [...state.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const scoreboard = scores.length ? `\n\n🏆 Scores :\n${scores.map(([player, score], index) => `${index + 1}. ${player.split('@')[0]} — ${score}`).join('\n')}` : '';
      return socket.sendMessage(from, { text: `🏴‍☠️ Partie terminée après ${state.turns} tours.${scoreboard}` }, { quoted: msg });
    }

    const result = chain.play(sessionNumber, from, sender || msg?.key?.participant || 'joueur', value);
    if (result.error === 'no_game') {
      return socket.sendMessage(from, { text: `Aucune partie en cours. Lance-en une avec ${prefix}wordchain start.` }, { quoted: msg });
    }
    if (result.error === 'invalid_word') {
      return socket.sendMessage(from, { text: '❌ Entre un mot de 2 lettres ou plus, sans espace ni chiffre.' }, { quoted: msg });
    }
    if (result.error === 'used_word') {
      return socket.sendMessage(from, { text: '❌ Ce mot a déjà été joué dans cette partie.' }, { quoted: msg });
    }
    if (result.error === 'wrong_letter') {
      return socket.sendMessage(from, { text: `❌ Le mot doit commencer par *${result.needed.toUpperCase()}* (dernière lettre de *${result.state.current}*).` }, { quoted: msg });
    }
    const nextLetter = chain.normalizeWord(result.state.current).slice(-1).toUpperCase();
    return socket.sendMessage(from, {
      text: `✅ *${value}* accepté ! +1 point.\nÀ qui le tour : mot commençant par *${nextLetter}* ?`,
    }, { quoted: msg });
  },
  _test: chain
};
