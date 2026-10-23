'use strict';

const {
  FONT_THEME_OPTIONS,
  DEFAULT_FONT_THEME,
  setSessionFontTheme
} = require('../../features/translation');

function cleanNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function themeMenu(prefix, selected) {
  const rows = Object.entries(FONT_THEME_OPTIONS).map(([code, option]) =>
    `${selected === code ? '✅' : '▫️'} ${code} — ${option.label}`
  );
  return [
    '🎨 *Thème des réponses du bot*',
    '',
    ...rows,
    '',
    `Choix : ${prefix}theme <code>`,
    `Exemple : ${prefix}theme a — Small Caps`
  ].join('\n');
}

module.exports = {
  name: 'theme',
  category: 'owner',
  description: 'Choisit la police persistante des réponses de cette session',
  usage: '.theme [a|b|c|d]',
  isOwner: true,
  async execute(context) {
    const {
      socket,
      msg,
      from,
      args = [],
      prefix = '.',
      sessionNumber,
      sessionCfg = {},
      setUserConfigInMongo
    } = context;
    const session = cleanNumber(sessionNumber);
    if (!session) {
      return socket.sendMessage(from, { text: '❌ Numéro de session introuvable.' }, { quoted: msg });
    }

    const code = String(args[0] || '').trim().toLowerCase();
    if (!code) {
      const selected = Object.prototype.hasOwnProperty.call(FONT_THEME_OPTIONS, String(sessionCfg.FONT_THEME || '').toLowerCase())
        ? String(sessionCfg.FONT_THEME).toLowerCase()
        : DEFAULT_FONT_THEME;
      return socket.sendMessage(from, { text: themeMenu(prefix, selected) }, { quoted: msg });
    }
    if (!Object.prototype.hasOwnProperty.call(FONT_THEME_OPTIONS, code)) {
      return socket.sendMessage(from, {
        text: `❌ Code inconnu.\n\n${themeMenu(prefix, DEFAULT_FONT_THEME)}`
      }, { quoted: msg });
    }
    if (typeof setUserConfigInMongo !== 'function') {
      return socket.sendMessage(from, { text: '❌ Le stockage de configuration est indisponible.' }, { quoted: msg });
    }

    const next = { ...sessionCfg, FONT_THEME: code };
    const saved = await setUserConfigInMongo(session, next);
    if (saved === false) {
      return socket.sendMessage(from, { text: '❌ Le thème n’a pas pu être enregistré.' }, { quoted: msg });
    }
    setSessionFontTheme(session, code);
    const selected = FONT_THEME_OPTIONS[code];
    return socket.sendMessage(from, {
      text: `✅ Thème enregistré : ${code} — ${selected.label}.\nToutes les réponses textuelles et légendes statiques de cette session utiliseront ce style.`
    }, { quoted: msg });
  },
  _test: { cleanNumber, themeMenu }
};
