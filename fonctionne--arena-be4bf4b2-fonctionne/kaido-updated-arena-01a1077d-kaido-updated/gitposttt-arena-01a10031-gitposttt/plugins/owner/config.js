'use strict';

const { normalisePrefix, formatPrefix } = require('../../services/command-routing');
const { applyAlwaysOnlineSetting, configEnabled } = require('../../services/presence-mode');

function cleanNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function canManageConfig({ senderNumber, sessionNumber, config, isOwner, isSessionOwner, isMongoAdmin, isSudo }) {
  const sender = cleanNumber(senderNumber);
  const session = cleanNumber(sessionNumber);
  const owners = String(config?.OWNER_NUMBER || '')
    .split(/[,;|]+/)
    .map(cleanNumber)
    .filter(Boolean);
  return Boolean(isOwner || isSessionOwner || isMongoAdmin || isSudo || (sender && (sender === session || owners.includes(sender))));
}

async function send(socket, from, msg, text) {
  return socket.sendMessage(from, { text }, { quoted: msg });
}

module.exports = {
  name: 'config',
  alias: ['settings'],
  category: 'owner',
  description: 'Configure le préfixe, la présence et les automatismes de la session',
  usage: '.config <option>',
  async execute(context) {
    const {
      socket,
      msg,
      from,
      args,
      prefix,
      sessionCfg = {},
      sessionNumber,
      setUserConfigInMongo
    } = context;

    if (!canManageConfig(context)) {
      return send(socket, from, msg, '❌ Seuls le propriétaire de la session, le propriétaire du bot ou un admin Mongo peuvent modifier cette configuration.');
    }
    if (typeof setUserConfigInMongo !== 'function') {
      throw new Error('Le stockage de configuration est indisponible.');
    }

    const sub = String(args[0] || '').toLowerCase();
    const next = { ...sessionCfg };
    const persist = async () => {
      const saved = await setUserConfigInMongo(cleanNumber(sessionNumber), next);
      if (saved === false) throw new Error('La configuration n’a pas pu être enregistrée.');
    };

    if (sub === 'setprefix') {
      const requested = args[1];
      if (requested === undefined) {
        return send(socket, from, msg, `Usage : ${prefix}config setprefix <préfixe|off>`);
      }

      const newPrefix = /^(?:on|default)$/i.test(requested)
        ? '.'
        : normalisePrefix(requested, '.');
      if (newPrefix && (newPrefix.length > 5 || /\s/.test(newPrefix))) {
        return send(socket, from, msg, '❌ Le préfixe doit contenir entre 1 et 5 caractères, sans espace, ou être `off`.');
      }

      next.PREFIX = newPrefix;
      await persist();
      if (!newPrefix) {
        return send(socket, from, msg,
          '✅ Mode *prefixless* activé.\nUtilise maintenant les commandes sans préfixe, par exemple `menu`.\nPour réactiver le point : `config setprefix .`');
      }
      return send(socket, from, msg, `✅ Préfixe défini sur : *${newPrefix}*\nExemple : ${newPrefix}menu`);
    }

    if (['alwaysonline', 'autoonline', 'online'].includes(sub)) {
      const value = String(args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) {
        return send(socket, from, msg, `Usage : ${prefix}config alwaysonline on|off`);
      }
      next.AUTO_ONLINE = value === 'on';
      await persist();
      await applyAlwaysOnlineSetting(socket, next.AUTO_ONLINE, from);
      return send(socket, from, msg, next.AUTO_ONLINE
        ? '✅ Always online activé : le compte du bot restera disponible.'
        : '✅ Always online désactivé : présence hors ligne et lecture des messages ordinaires uniquement lorsqu’une commande reconnue arrive.');
    }

    const booleanOptions = {
      autoview: 'AUTO_VIEW_STATUS',
      autolike: 'AUTO_LIKE_STATUS',
      autorec: 'AUTO_RECORDING'
    };
    if (booleanOptions[sub]) {
      const value = String(args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) {
        return send(socket, from, msg, `Usage : ${prefix}config ${sub} on|off`);
      }
      next[booleanOptions[sub]] = value === 'on';
      await persist();
      return send(socket, from, msg, `✅ ${booleanOptions[sub]} : ${value.toUpperCase()}`);
    }

    if (sub === 'setemoji' || sub === 'setlikeemoji') {
      const emojis = args.slice(1).filter(Boolean).slice(0, 50);
      if (!emojis.length) return send(socket, from, msg, `Usage : ${prefix}config setemoji 🐉 🔥 ❤️`);
      next.AUTO_LIKE_EMOJI = emojis;
      await persist();
      return send(socket, from, msg, `✅ Emojis mis à jour : ${emojis.join(' ')}`);
    }

    if (sub === 'show' || sub === 'get') {
      const currentPrefix = Object.prototype.hasOwnProperty.call(next, 'PREFIX') ? next.PREFIX : '.';
      return send(socket, from, msg, [
        '🔧 *Configuration de la session*',
        `• ALWAYS_ONLINE : ${configEnabled(next.AUTO_ONLINE, false) ? 'ON' : 'OFF'}`,
        `• AUTO_VIEW_STATUS : ${configEnabled(next.AUTO_VIEW_STATUS, true) ? 'ON' : 'OFF'}`,
        `• AUTO_LIKE_STATUS : ${configEnabled(next.AUTO_LIKE_STATUS, true) ? 'ON' : 'OFF'}`,
        `• AUTO_RECORDING : ${configEnabled(next.AUTO_RECORDING, false) ? 'ON' : 'OFF'}`,
        `• PREFIX : ${formatPrefix(currentPrefix)}`,
        `• MODE : ${next.MODE || 'public'}`,
        `• THEME : ${next.THEME || 'onigashima'}`,
        `• SUDO_USERS : ${Array.isArray(next.SUDO_USERS) ? next.SUDO_USERS.length : 0}`
      ].join('\n'));
    }

    return send(socket, from, msg, [
      '⚙️ *Commandes de configuration*',
      `• ${prefix}config alwaysonline on|off`,
      `• ${prefix}config setprefix <préfixe|off>`,
      `• ${prefix}config autoview on|off`,
      `• ${prefix}config autolike on|off`,
      `• ${prefix}config autorec on|off`,
      `• ${prefix}config setemoji 🐉 🔥 ❤️`,
      `• ${prefix}config show`
    ].join('\n'));
  },
  _test: { cleanNumber, canManageConfig }
};
