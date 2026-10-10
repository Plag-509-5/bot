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
  const labels = {
    text: 'texte',
    image: 'image',
    video: 'vidéo',
    audio: 'audio stylisé en vidéo'
  };
  return `Statut ${labels[type] || type} posté sur : ${subject}`;
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
    quotedMsg,
    isOwner,
    isSessionOwner,
    isSudo
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

  // Même garde d’accès que les autres commandes propriétaire; les refus restent
  // privés, y compris quand la commande a été lancée depuis un groupe.
  if (!(isOwner || isSessionOwner || isSudo)) {
    return sendPrivate(socket, privateJid, {
      text: '🚫 Cette commande est réservée au propriétaire de la session.'
    }, isGroupCommand ? undefined : { quoted: msg });
  }

  try {
    let target = isGroupCommand
      ? { jid: from, subject: 'ce groupe' }
      : getSelectedGroup(sessionNumber, actorId);

    // En privé, `.swgc` seul ouvre toujours le sélecteur et permet aussi de
    // changer un groupe déjà mémorisé. La publication reste indépendante du chat.
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

    let downloadContent = dependencies.downloadContent;
    if (!downloadContent) {
      const nyxBaileys = await import('@nyxcore/nyxcoresocket');
      downloadContent = nyxBaileys.downloadContentFromMessage;
    }
    const built = await buildGroupStatusPayload({
      quotedMessage: quotedMsg,
      textInput,
      downloadContent,
      audioToStatusVideo: dependencies.audioToStatusVideo
    });

    let sendGroupStatus;
    if (dependencies.publishGroupStatus) {
      sendGroupStatus = (jid, payload) => dependencies.publishGroupStatus(socket, jid, payload);
    } else {
      const { installGroupStatusMethod } = require('../../handlers/status');
      const adapter = installGroupStatusMethod(socket);
      sendGroupStatus = typeof socket.sendGroupStatus === 'function'
        ? socket.sendGroupStatus.bind(socket)
        : adapter;
    }
    await sendGroupStatus(target.jid, built.payload);

    // Aucune réaction, confirmation ou texte n’est envoyé dans le groupe. Le
    // seul envoi à la cible est le statut groupStatusMessageV2 lui-même.
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
  alias: ['groupstatus', 'statusgroup', 'gcstatus'],
  category: 'group',
  description: 'Choisit en privé un groupe puis y publie texte ou média sans message dans le chat',
  usage: '.swgc / .gcstatus | .swgc <texte>[, couleur] | répondre à un média avec .swgc',
  execute: executeSwgc,
  _test: { groupStatusConfirmation, sendPrivate, ensureMembership, executeSwgc }
};
