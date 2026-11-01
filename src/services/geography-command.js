'use strict';

const games = require('./geography-games');

function createGeographyCommand(kind) {
  return async function execute({ socket, msg, from, args = [], prefix = '.', sessionNumber, sender, command }) {
    const answer = args.join(' ').trim();
    if (['stop', 'arrêter', 'arreter'].includes(answer.toLowerCase())) {
      const stopped = games.stop({ sessionNumber, chatJid: from, kind });
      return socket.sendMessage(from, { text: stopped ? '🏴‍☠️ Quiz terminé. Relance-le quand tu veux !' : 'Aucun quiz en cours dans ce salon.' }, { quoted: msg });
    }
    if (!answer || ['start', 'début', 'debut', 'aide', 'help'].includes(answer.toLowerCase())) {
      const { prompt } = games.start({ sessionNumber, chatJid: from, kind });
      return socket.sendMessage(from, { text: `${prompt}\n\nPour terminer : ${prefix}${command} stop` }, { quoted: msg });
    }
    const result = games.answer({ sessionNumber, chatJid: from, kind, answer, sender: sender || msg?.key?.participant || 'joueur' });
    if (result.error === 'no_game') {
      const { prompt } = games.start({ sessionNumber, chatJid: from, kind });
      return socket.sendMessage(from, { text: `Aucun quiz n’était en cours : j’en lance un !\n\n${prompt}` }, { quoted: msg });
    }
    if (!result.correct) return socket.sendMessage(from, { text: '❌ Pas tout à fait. Essaie encore !' }, { quoted: msg });
    const nextPrompt = kind === 'capital'
      ? `Quel est le nom de la capitale de *${result.state.country.name}* ?`
      : `À quel pays appartient ce drapeau ?\n\n${result.state.country.flag}`;
    return socket.sendMessage(from, {
      text: `✅ Bonne réponse, @${String(sender || '').split('@')[0] || 'pirate'} ! +1 point.\n\n${nextPrompt}\nRéponds avec ${prefix}${command} <réponse>.`,
      mentions: sender ? [sender] : []
    }, { quoted: msg });
  };
}

module.exports = { createGeographyCommand };
