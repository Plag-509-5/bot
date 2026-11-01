'use strict';

const logo = require('../../services/kaido-logo');
const STYLE_NAMES = new Set([...Object.keys(logo.PRESETS), ...Object.keys(logo.STYLE_ALIASES), 'grafiti', 'grafiti2', 'grafiti3', 'grafiti4']);

module.exports = {
  name: ['logo', ...logo.COMMAND_ALIASES],
  category: 'tools',
  description: 'Crée des logos et effets de texte KAIDO localement, sans API tierce',
  usage: '.logo <style> <texte> ou .glow <texte>',
  async execute({ socket, msg, from, args = [], command = 'logo', prefix = '.' }) {
    let style = command === 'logo' || command === 'gfx' ? 'glow' : command;
    let textArgs = args;
    if ((command === 'logo' || command === 'gfx') && STYLE_NAMES.has(String(args[0] || '').toLowerCase())) {
      style = String(args[0]).toLowerCase();
      textArgs = args.slice(1);
    }
    const text = textArgs.join(' ').trim();
    if (!text || ['help', 'aide', 'menu'].includes(text.toLowerCase())) {
      return socket.sendMessage(from, {
        text: `🎨 *KAIDO LOGO STUDIO*\n${prefix}logo <style> <texte>\n${prefix}glow <texte> · ${prefix}glitch <texte> · ${prefix}pixel <texte>\n${prefix}grafiti <texte> · ${prefix}gradient <texte> · ${prefix}avenger <texte>\nPour deux lignes : sépare les textes avec « ; ».\n_Génération locale : aucune API externe n’est utilisée._`
      }, { quoted: msg });
    }
    try {
      const image = await logo.createKaidoLogo(style, text);
      return socket.sendMessage(from, {
        image,
        mimetype: 'image/png',
        caption: `🎨 *KAIDO LOGO* · ${String(style).toUpperCase()}\n${text.slice(0, 180)}`
      }, { quoted: msg });
    } catch (error) {
      return socket.sendMessage(from, { text: `❌ Création du logo impossible : ${error.message || error}` }, { quoted: msg });
    }
  },
  _test: logo
};
