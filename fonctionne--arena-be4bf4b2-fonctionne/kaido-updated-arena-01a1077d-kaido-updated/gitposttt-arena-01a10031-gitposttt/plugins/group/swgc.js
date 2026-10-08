'use strict';

const {
  identityTokens,
  participantMatches,
  listUserGroups,
  beginGroupSelection,
  getSelectedGroup,
  clearSelectedGroup,
  renderGroupSelectionList,
  actorIdFromMessage
} = require('../../services/group-status-selector');
const { buildGroupStatusPayload } = require('../../services/group-status-content');

function groupStatusConfirmation(type, subject) {
  const label = type === 'text' ? 'texte' : type;
  return `Statut ${label} posté sur : ${subject}`;
}

async function sendPrivate(socket, jid, content, options) {
  if (!jid || jid.endsWith('@g.us')) return null;
  try {
    return await socket.sendMessage(jid, content, options);
  } catch (error) {
    console.warn('[SWGC] Réponse privée impossible:', error?.message || error);
    return null;
  }
}

async function ensureMembership(socket, group, identifiers) {
  if (!group?.jid || typeof socket?.groupMetadata !== 'function') return false;
  const metadata = await socket.groupMetadata(group.jid).catch(() => null);
  if (!metadata) return false;
  const tokens = identityTokens(identifiers);
  return (metadata.participants || []).some(participant => participantMatches(participant, tokens));
}

async function executeSwgc(context, dependencies = {}) {
  const {
    socket,
    msg,
    from,
    sender,
    senderNumber,
    sessionNumber,
    args,
    prefix,
    quotedMsg
  } = context;
  const isGroupCommand = String(from || '').endsWith('@g.us');
  const actorId = actorIdFromMessage(socket, msg, from);
  const privateJid = isGroupCommand
    ? (msg?.key?.participantAlt || sender)
    : from;
  const identifiers = [
    actorId,
    sender,
    senderNumber,
    msg?.key?.participant,
    msg?.key?.participantAlt,
    msg?.key?.remoteJid,
    msg?.key?.remoteJidAlt
  ];
  const textInput = args.join(' ').trim();

  try {
    let target = isGroupCommand
      ? { jid: from, subject: 'ce groupe' }
      : getSelectedGroup(sessionNumber, actorId);

    // En privé, `.swgc` seul ouvre toujours le sélecteur et permet aussi de
    // changer un groupe déjà mémorisé. Une commande avec contenu utilise la
    // cible précédemment sélectionnée.
    if (!isGroupCommand && !quotedMsg && !textInput) {
      const groups = await listUserGroups(socket, identifiers);
      if (!groups.length) {
        return sendPrivate(socket, privateJid, {
          text: '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.'
        }, { quoted: msg });
      }
      beginGroupSelection(sessionNumber, actorId, groups);
      return sendPrivate(socket, privateJid, {
        text: renderGroupSelectionList(groups, prefix)
      }, { quoted: msg });
    }

    if (!target && !isGroupCommand) {
      const groups = await listUserGroups(socket, identifiers);
      if (!groups.length) {
        return sendPrivate(socket, privateJid, {
          text: '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.'
        }, { quoted: msg });
      }
      beginGroupSelection(sessionNumber, actorId, groups);
      return sendPrivate(socket, privateJid, {
        text: `⚠️ Choisis d’abord le groupe, puis renvoie ta publication.\n\n${renderGroupSelectionList(groups, prefix)}`
      }, { quoted: msg });
    }

    if (!isGroupCommand) {
      const stillMember = await ensureMembership(socket, target, identifiers);
      if (!stillMember) {
        clearSelectedGroup(sessionNumber, actorId);
        return sendPrivate(socket, privateJid, {
          text: `❌ Tu ne fais plus partie de « ${target.subject} ». Relance ${prefix}swgc pour choisir un autre groupe.`
        }, { quoted: msg });
      }
    }

    const downloadContent = dependencies.downloadContent
      || require('@whiskeysockets/baileys').downloadContentFromMessage;
    const publishGroupStatus = dependencies.publishGroupStatus
      || require('../../status').groupStatus;
    const built = await buildGroupStatusPayload({
      quotedMessage: quotedMsg,
      textInput,
      downloadContent
    });
    await publishGroupStatus(socket, target.jid, built.payload);

    // Important : aucune réaction, confirmation ou texte n’est envoyé dans
    // le groupe. Le seul envoi vers le JID du groupe est groupStatusMessageV2.
    return sendPrivate(socket, privateJid, {
      text: groupStatusConfirmation(built.type, target.subject)
    }, isGroupCommand ? undefined : { quoted: msg });
  } catch (error) {
    console.error('[SWGC ERROR]', error);
    return sendPrivate(socket, privateJid, {
      text: `❌ Publication impossible : ${error?.message || error}`
    }, isGroupCommand ? undefined : { quoted: msg });
  }
}

module.exports = {
  name: 'swgc',
  alias: ['groupstatus', 'statusgroup'],
  category: 'group',
  description: 'Choisit en privé un groupe puis y publie un statut sans message dans le chat',
  usage: '.swgc | .swgc <texte> | répondre à un média avec .swgc',
  execute: executeSwgc,
  _test: { groupStatusConfirmation, sendPrivate, ensureMembership, executeSwgc }
};
