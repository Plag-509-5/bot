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
const { isBotAdmin } = require('../../services/group-admins');

function groupStatusConfirmation(type, subject) {
  const labels = {
    text: 'texte',
    image: 'image',
    video: 'vidéo',
    audio: 'audio stylisé en vidéo'
  };
  return `Statut ${labels[type] || type} posté sur : ${subject}`;
}

async function sendContextReply(context, content) {
  const { socket, msg, from } = context;
  if (!from) return null;
  const isGroupCommand = String(from).endsWith('@g.us');
  try {
    return await socket.sendMessage(from, content, msg ? { quoted: msg } : undefined);
  } catch (error) {
    console.warn(
      isGroupCommand ? '[SWGC] Réponse dans le groupe impossible:' : '[SWGC] Réponse privée impossible:',
      error?.message || error
    );
    return null;
  }
}

function quotedMessageFromContext(context = {}) {
  const { msg } = context;
  return context.quotedMsg
    || context.quoted
    || msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage
    || msg?.message?.imageMessage?.contextInfo?.quotedMessage
    || msg?.message?.videoMessage?.contextInfo?.quotedMessage
    || msg?.message?.audioMessage?.contextInfo?.quotedMessage
    || null;
}

async function ensureMembership(socket, group, identifiers, metadataOverride) {
  if (!group?.jid || typeof socket?.groupMetadata !== 'function') return false;
  const metadata = metadataOverride === undefined
    ? await socket.groupMetadata(group.jid).catch(() => null)
    : metadataOverride;
  if (!metadata) return false;
  const tokens = identityTokens(identifiers);
  return (metadata.participants || []).some(participant => participantMatches(participant, tokens));
}

async function getGroupStatusMetadata(socket, jid) {
  if (typeof socket?.groupMetadata !== 'function') return null;
  try {
    return await socket.groupMetadata(jid);
  } catch (error) {
    console.warn('[SWGC] Impossible de lire les paramètres du groupe:', error?.message || error);
    throw new Error('Impossible de vérifier les paramètres du groupe. Réessaie dans un instant.');
  }
}

function ensureBotCanPublishStatus(metadata, socket) {
  if (metadata?.announce && !isBotAdmin(metadata, socket)) {
    throw new Error(
      'Ce groupe est en mode admin-only : le compte WhatsApp connecté au bot doit être administrateur pour publier un statut. Promeus le bot dans ce groupe, puis réessaie.'
    );
  }
}

async function executeSwgc(context, dependencies = {}) {
  const {
    socket,
    msg,
    from,
    sender,
    senderNumber,
    sessionNumber,
    args = [],
    prefix = '.',
    isOwner,
    isSessionOwner,
    isSudo
  } = context;
  const isGroupCommand = String(from || '').endsWith('@g.us');
  const actorId = actorIdFromMessage(socket, msg, from);
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
  const quotedMsg = quotedMessageFromContext(context);

  // En privé, le sélecteur reste une fonction de gestion du propriétaire.
  // Dans un groupe, chaque membre peut publier sur le statut de ce groupe.
  if (!isGroupCommand && !(isOwner || isSessionOwner || isSudo)) {
    return sendContextReply(context, {
      text: '🚫 En privé, cette commande est réservée au propriétaire de la session.'
    });
  }

  let builtStatus = null;
  try {
    const target = isGroupCommand
      ? { jid: from, subject: 'ce groupe' }
      : getSelectedGroup(sessionNumber, actorId);

    // En privé, `.swgc` seul ouvre le sélecteur et permet aussi de changer un
    // groupe déjà mémorisé. La réponse reste dans cette conversation privée.
    if (!isGroupCommand && !quotedMsg && !textInput) {
      const groups = await listUserGroups(socket, identifiers);
      if (!groups.length) {
        return sendContextReply(context, {
          text: '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.'
        });
      }
      beginGroupSelection(sessionNumber, actorId, groups);
      return sendContextReply(context, {
        text: renderGroupSelectionList(groups, prefix)
      });
    }

    if (!target && !isGroupCommand) {
      const groups = await listUserGroups(socket, identifiers);
      if (!groups.length) {
        return sendContextReply(context, {
          text: '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.'
        });
      }
      beginGroupSelection(sessionNumber, actorId, groups);
      return sendContextReply(context, {
        text: `⚠️ Choisis d’abord le groupe, puis renvoie ta publication.\n\n${renderGroupSelectionList(groups, prefix)}`
      });
    }

    const targetMetadata = await getGroupStatusMetadata(socket, target.jid);
    ensureBotCanPublishStatus(targetMetadata, socket);

    if (!isGroupCommand) {
      const stillMember = await ensureMembership(socket, target, identifiers, targetMetadata);
      if (!stillMember) {
        clearSelectedGroup(sessionNumber, actorId);
        return sendContextReply(context, {
          text: `❌ Tu ne fais plus partie de « ${target.subject} ». Relance ${prefix}swgc pour choisir un autre groupe.`
        });
      }
    }

    let downloadContent = dependencies.downloadContent;
    if (!downloadContent) {
      const nyxBaileys = await import('@nyxcore/nyxcoresocket');
      downloadContent = nyxBaileys.downloadContentFromMessage;
    }
    builtStatus = await buildGroupStatusPayload({
      quotedMessage: quotedMsg,
      textInput,
      downloadContent,
      audioToStatusVideo: dependencies.audioToStatusVideo,
      audioToStatusVideoFile: dependencies.audioToStatusVideoFile
    });

    let sendGroupStatus;
    if (dependencies.publishGroupStatus) {
      sendGroupStatus = (jid, payload, options) => dependencies.publishGroupStatus(socket, jid, payload, options);
    } else {
      const { installGroupStatusMethod } = require('../../handlers/status');
      const adapter = installGroupStatusMethod(socket);
      sendGroupStatus = typeof socket.sendGroupStatus === 'function'
        ? socket.sendGroupStatus.bind(socket)
        : adapter;
    }
    const sendOptions = targetMetadata?.announce ? { useCachedGroupMetadata: false } : undefined;
    await sendGroupStatus(target.jid, builtStatus.payload, sendOptions);

    return sendContextReply(context, {
      text: groupStatusConfirmation(builtStatus.type, target.subject)
    });
  } catch (error) {
    console.error('[SWGC ERROR]', error);
    return sendContextReply(context, {
      text: `❌ Publication impossible : ${error?.message || error}`
    });
  } finally {
    try { builtStatus?.payload?.video?.stream?.destroy?.(); } catch {}
    if (typeof builtStatus?.cleanup === 'function') {
      try { await builtStatus.cleanup(); }
      catch (error) { console.warn('[SWGC] Nettoyage du média temporaire échoué:', error?.message || error); }
    }
  }
}

module.exports = {
  name: 'swgc',
  alias: ['groupstatus', 'statusgroup', 'gcstatus'],
  category: 'group',
  description: 'Publie un statut dans le groupe courant ou choisit un groupe en privé',
  usage: '.swgc [texte][, couleur] | répondre à un média avec .swgc',
  execute: executeSwgc,
  _test: {
    groupStatusConfirmation,
    sendContextReply,
    quotedMessageFromContext,
    ensureMembership,
    getGroupStatusMetadata,
    ensureBotCanPublishStatus,
    executeSwgc
  }
};
