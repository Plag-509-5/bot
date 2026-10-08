'use strict';

const { phoneNumberFromIdentifier } = require('../../services/access-control');
const {
  cleanNumber,
  normaliseSudoUsers,
  canManageSudo,
  persistSessionPatch
} = require('../../services/session-preferences');

function mentionedNumber(msg) {
  const contexts = [
    msg?.message?.extendedTextMessage?.contextInfo,
    msg?.message?.imageMessage?.contextInfo,
    msg?.message?.videoMessage?.contextInfo
  ];
  for (const context of contexts) {
    const value = context?.mentionedJid?.[0] || context?.participant;
    const number = phoneNumberFromIdentifier(value);
    if (number) return number;
  }
  return '';
}

function renderSudoList(users, prefix) {
  if (!users.length) return `📭 Aucun sudo enregistré pour cette session.\nUsage : ${prefix}sudo <numéro>`;
  return [
    '🛡️ *SUDOS DE CETTE SESSION*',
    '',
    ...users.map((number, index) => `${index + 1}. +${number}`),
    '',
    `Suppression : ${prefix}delsudo <numéro>`
  ].join('\n');
}

module.exports = {
  name: 'sudo',
  alias: ['delsudo', 'listsudo'],
  category: 'owner',
  description: 'Ajoute, retire ou liste les opérateurs sudo propres à la session',
  usage: '.sudo <numéro> | .delsudo <numéro>',
  async execute(context) {
    const { socket, from, msg, command, args, prefix, sessionCfg = {} } = context;
    if (!canManageSudo(context)) {
      return socket.sendMessage(from, {
        text: '❌ Seul le propriétaire du bot ou de cette session peut gérer les sudo.'
      }, { quoted: msg });
    }

    const current = normaliseSudoUsers(sessionCfg.SUDO_USERS);
    if (command === 'listsudo' || (!args.length && !mentionedNumber(msg))) {
      return socket.sendMessage(from, { text: renderSudoList(current, prefix) }, { quoted: msg });
    }

    const rawTarget = args.join(' ').trim();
    const target = mentionedNumber(msg) || (rawTarget.includes('@')
      ? phoneNumberFromIdentifier(rawTarget)
      : cleanNumber(rawTarget));
    if (!/^\d{6,15}$/.test(target)) {
      return socket.sendMessage(from, {
        text: `❌ Numéro invalide.\nUsage : ${prefix}${command === 'delsudo' ? 'delsudo' : 'sudo'} 509XXXXXXXX`
      }, { quoted: msg });
    }

    if (command === 'delsudo') {
      const next = current.filter(number => number !== target);
      if (next.length === current.length) {
        return socket.sendMessage(from, { text: `❌ +${target} n’est pas sudo dans cette session.` }, { quoted: msg });
      }
      await persistSessionPatch(context, { SUDO_USERS: next });
      return socket.sendMessage(from, {
        text: `✅ +${target} a été retiré des sudo de la session ${context.sessionNumber}.`
      }, { quoted: msg });
    }

    if (current.includes(target)) {
      return socket.sendMessage(from, { text: `ℹ️ +${target} est déjà sudo dans cette session.` }, { quoted: msg });
    }
    await persistSessionPatch(context, { SUDO_USERS: [...current, target] });
    return socket.sendMessage(from, {
      text: `✅ +${target} est maintenant sudo uniquement pour la session ${context.sessionNumber}.\n` +
        'L’accès restera enregistré après redémarrage.'
    }, { quoted: msg });
  },
  _test: { mentionedNumber, renderSudoList }
};
