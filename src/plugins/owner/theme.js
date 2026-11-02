'use strict';

const {
  FONT_THEME_OPTIONS,
  DEFAULT_FONT_THEME,
  setSessionFontTheme
} = require('../../features/translation');

const FALLBACK_FONT_THEME_OPTIONS = Object.freeze({
  a: Object.freeze({ style: 'small-caps', label: 'Small Caps' }),
  b: Object.freeze({ style: 'sans-bold', label: 'Sans Bold' }),
  c: Object.freeze({ style: 'serif-bold', label: 'Serif Bold' }),
  d: Object.freeze({ style: 'typewriter', label: 'Typewriter' })
});

function cleanNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function resolveThemeOptions(value = FONT_THEME_OPTIONS) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : FALLBACK_FONT_THEME_OPTIONS;
}

function themeMenu(prefix, selected, options = FONT_THEME_OPTIONS) {
  const rows = Object.entries(resolveThemeOptions(options)).map(([code, option]) =>
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
    const themeOptions = resolveThemeOptions();
    const defaultTheme = themeOptions[DEFAULT_FONT_THEME]
      ? DEFAULT_FONT_THEME
      : (Object.keys(themeOptions)[0] || 'b');
    const currentSessionCfg = sessionCfg && typeof sessionCfg === 'object' ? sessionCfg : {};
    if (!session) {
      return socket.sendMessage(from, { text: '❌ Numéro de session introuvable.' }, { quoted: msg });
    }

    const code = String(args[0] || '').trim().toLowerCase();
    if (!code) {
      const selected = Object.prototype.hasOwnProperty.call(themeOptions, String(currentSessionCfg.FONT_THEME || '').toLowerCase())
        ? String(currentSessionCfg.FONT_THEME).toLowerCase()
        : defaultTheme;
      return socket.sendMessage(from, { text: themeMenu(prefix, selected, themeOptions) }, { quoted: msg });
    }
    if (!Object.prototype.hasOwnProperty.call(themeOptions, code)) {
      return socket.sendMessage(from, {
        text: `❌ Code inconnu.\n\n${themeMenu(prefix, defaultTheme, themeOptions)}`
      }, { quoted: msg });
    }
    if (typeof setUserConfigInMongo !== 'function') {
      return socket.sendMessage(from, { text: '❌ Le stockage de configuration est indisponible.' }, { quoted: msg });
    }

    const next = { ...currentSessionCfg, FONT_THEME: code };
    const saved = await setUserConfigInMongo(session, next);
    if (saved === false) {
      return socket.sendMessage(from, { text: '❌ Le thème n’a pas pu être enregistré.' }, { quoted: msg });
    }
    setSessionFontTheme(session, code);
    const selected = themeOptions[code];
    return socket.sendMessage(from, {
      text: `✅ Thème enregistré : ${code} — ${selected.label}.\nToutes les réponses textuelles et légendes statiques de cette session utiliseront ce style.`
    }, { quoted: msg });
  },
  _test: { cleanNumber, resolveThemeOptions, themeMenu, FALLBACK_FONT_THEME_OPTIONS }
};
