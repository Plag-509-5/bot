'use strict';

const { canManageSession, persistSessionPatch } = require('../../services/session-preferences');
const {
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  normalizeKeyword,
  parseKeywords
} = require('../../services/status-reply-forwarder');

function currentKeywords(value) {
  return parseKeywords(Array.isArray(value) ? value : []).keywords.slice(0, MAX_KEYWORDS);
}

function renderStatus(context) {
  const { sessionCfg = {}, prefix = '.' } = context;
  const enabled = Boolean(sessionCfg.STATUS_REPLY_FORWARD_ENABLED);
  const keywords = currentKeywords(sessionCfg.STATUS_REPLY_KEYWORDS);
  return [
    '📨 *TRANSFERT AUTOMATIQUE DES RÉPONSES AUX STATUTS*',
    `État : *${enabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}*`,
    `Mots-clés : ${keywords.length ? keywords.map(keyword => `*${keyword}*`).join(', ') : 'aucun'}`,
    '',
    `Activer : ${prefix}send on`,
    `Désactiver : ${prefix}send off`,
    `Ajouter un mot : ${prefix}send set <mot>`,
    `Supprimer un mot : ${prefix}send remove <mot>`,
    `Effacer les mots : ${prefix}send clear`
  ].join('\n');
}

async function sendReply(context, text) {
  return context.socket.sendMessage(context.from, { text }, context.msg ? { quoted: context.msg } : undefined);
}

async function executeSend(context) {
  const { args = [], sessionCfg = {}, prefix = '.' } = context;
  if (!canManageSession(context)) {
    return sendReply(context, '🚫 Seul le propriétaire ou un opérateur autorisé de cette session peut configurer .send.');
  }

  const action = String(args[0] || 'status').toLowerCase();
  try {
    if (action === 'on' || action === 'off') {
      const enabled = action === 'on';
      await persistSessionPatch(context, { STATUS_REPLY_FORWARD_ENABLED: enabled });
      const keywords = currentKeywords(sessionCfg.STATUS_REPLY_KEYWORDS);
      return sendReply(context, enabled
        ? `✅ Transfert automatique activé.${keywords.length
          ? ` Mots surveillés : ${keywords.join(', ')}.`
          : ` Aucun mot-clé n’est configuré : ajoute-en avec ${prefix}send set <mot>.`}`
        : '✅ Transfert automatique désactivé. Les mots-clés enregistrés sont conservés.');
    }

    if (action === 'set' || action === 'add') {
      const parsed = parseKeywords(args.slice(1));
      if (parsed.invalid.length) {
        return sendReply(context,
          `❌ Un mot-clé dépasse la limite de ${MAX_KEYWORD_LENGTH} caractères.`);
      }
      if (!parsed.keywords.length) {
        return sendReply(context, `Usage : ${prefix}send set <mot> (ex. ${prefix}send set voye)`);
      }
      const combined = parseKeywords([...currentKeywords(sessionCfg.STATUS_REPLY_KEYWORDS), ...parsed.keywords]).keywords;
      if (combined.length > MAX_KEYWORDS) {
        return sendReply(context, `❌ La liste est limitée à ${MAX_KEYWORDS} mots-clés.`);
      }
      await persistSessionPatch(context, { STATUS_REPLY_KEYWORDS: combined });
      return sendReply(context, `✅ Mot(s)-clé(s) enregistré(s) : ${combined.join(', ')}.`);
    }

    if (action === 'remove' || action === 'delete') {
      const parsed = parseKeywords(args.slice(1));
      if (!parsed.keywords.length) {
        return sendReply(context, `Usage : ${prefix}send remove <mot>`);
      }
      const toRemove = new Set(parsed.keywords.map(normalizeKeyword));
      const current = currentKeywords(sessionCfg.STATUS_REPLY_KEYWORDS);
      const next = current.filter(keyword => !toRemove.has(normalizeKeyword(keyword)));
      await persistSessionPatch(context, { STATUS_REPLY_KEYWORDS: next });
      return sendReply(context, next.length === current.length
        ? 'ℹ️ Aucun de ces mots-clés n’était enregistré.'
        : `✅ Mots-clés restants : ${next.length ? next.join(', ') : 'aucun'}.`);
    }

    if (action === 'clear' || action === 'reset') {
      await persistSessionPatch(context, { STATUS_REPLY_KEYWORDS: [] });
      return sendReply(context, '✅ Tous les mots-clés ont été supprimés.');
    }

    if (action === 'status' || action === 'list' || !args.length) {
      return sendReply(context, renderStatus(context));
    }

    return sendReply(context, renderStatus(context));
  } catch (error) {
    console.error('[SEND STATUS CONFIG ERROR]', error?.message || error);
    return sendReply(context, `❌ Impossible d’enregistrer la configuration : ${error?.message || error}`);
  }
}

module.exports = {
  name: 'send',
  alias: ['sendstatus'],
  category: 'owner',
  description: 'Configure le transfert automatique du statut lorsqu’un mot-clé est reçu en réponse',
  usage: '.send on|off|set <mot>|remove <mot>|clear',
  execute: executeSend,
  _test: { currentKeywords, renderStatus, executeSend, MAX_KEYWORDS, MAX_KEYWORD_LENGTH }
};
