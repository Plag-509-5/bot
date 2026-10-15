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
const { BRANDING } = require('../../services/group-status-audio');

function groupStatusConfirmation(type, subject) {
  const labels = {
    text: 'texte',
    image: 'image',
    video: 'vidéo',
    audio: 'audio',
    styledAudio: 'audio stylisé en vidéo'
  };
  return `Statut ${labels[type] || type} posté sur : ${subject}`;
}

function formatRawAudioStatusCaption(originalCaption, addedText) {
  const original = String(originalCaption || '').trim();
  const added = String(addedText || '').trim();
  const watermark = `\n\n━━━━━━━━━━━━━━\n✨ *Publié par* ✨\n🐉 *${BRANDING.title} — ${BRANDING.subtitle}* 🐉`;
  if (original && added) {
    return `📝 *Caption originale* 📝\n❝ ${original} ❞\n\n💬 *Texte ajouté* 💬\n❝ ${added} ❞${watermark}`;
  }
  if (original) return `📝 *Caption* 📝\n❝ ${original} ❞${watermark}`;
  if (added) return `💬 *Texte* 💬\n❝ ${added} ❞${watermark}`;
  return `✨ *Statut audio du groupe* ✨${watermark}`;
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

async function executeGroupStatus(context, dependencies = {}, mode = {}) {
  const commandName = mode.commandName || 'swgc';
  const selectionPurpose = mode.selectionPurpose || 'swgc';
  const audioMode = mode.audioMode || 'raw';
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
      : getSelectedGroup(sessionNumber, actorId, selectionPurpose);

    // En privé, la commande choisit son groupe cible dans le contexte de cette session.
    if (!isGroupCommand && !quotedMsg && !textInput) {
      const groups = await listUserGroups(socket, identifiers);
      if (!groups.length) {
        return sendContextReply(context, {
          text: '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.'
        });
      }
      beginGroupSelection(sessionNumber, actorId, groups, Date.now(), selectionPurpose);
      return sendContextReply(context, {
        text: renderGroupSelectionList(groups, prefix, commandName)
      });
    }

    if (!target && !isGroupCommand) {
      const groups = await listUserGroups(socket, identifiers);
      if (!groups.length) {
        return sendContextReply(context, {
          text: '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.'
        });
      }
      beginGroupSelection(sessionNumber, actorId, groups, Date.now(), selectionPurpose);
      const instruction = commandName === 'style'
        ? `Choisis un groupe, puis réponds à l’audio avec ${prefix}style.`
        : `Choisis d’abord le groupe, puis renvoie ta publication avec ${prefix}swgc.`;
      return sendContextReply(context, {
        text: `⚠️ ${instruction}\n\n${renderGroupSelectionList(groups, prefix, commandName)}`
      });
    }

    const targetMetadata = await getGroupStatusMetadata(socket, target.jid);
    ensureBotCanPublishStatus(targetMetadata, socket);

    if (!isGroupCommand) {
      const stillMember = await ensureMembership(socket, target, identifiers, targetMetadata);
      if (!stillMember) {
        clearSelectedGroup(sessionNumber, actorId, selectionPurpose);
        return sendContextReply(context, {
          text: `❌ Tu ne fais plus partie de « ${target.subject} ». Relance ${prefix}${commandName} pour choisir un autre groupe.`
        });
      }
    }

    let downloadContent = dependencies.downloadContent;
    if (!downloadContent) {
      downloadContent = async (...parameters) => {
        const nyxBaileys = await import('@nyxcore/nyxcoresocket');
        return nyxBaileys.downloadContentFromMessage(...parameters);
      };
    }
    builtStatus = await buildGroupStatusPayload({
      quotedMessage: quotedMsg,
      textInput,
      audioMode,
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

    if (builtStatus.type === 'audio') {
      await sendContextReply(context, {
        text: formatRawAudioStatusCaption(builtStatus.originalCaption, builtStatus.textInput)
      });
    }

    return sendContextReply(context, {
      text: groupStatusConfirmation(builtStatus.type, target.subject)
    });
  } catch (error) {
    console.error(`[${commandName.toUpperCase()} ERROR]`, error);
    return sendContextReply(context, {
      text: `❌ Publication impossible : ${error?.message || error}`
    });
  } finally {
    try { builtStatus?.payload?.video?.stream?.destroy?.(); } catch {}
    if (typeof builtStatus?.cleanup === 'function') {
      try { await builtStatus.cleanup(); }
      catch (error) { console.warn(`[${commandName.toUpperCase()}] Nettoyage du média temporaire échoué:`, error?.message || error); }
    }
  }
}

async function executeSwgc(context, dependencies = {}) {
  return executeGroupStatus(context, dependencies, {
    commandName: 'swgc',
    selectionPurpose: 'swgc',
    audioMode: 'raw'
  });
}

async function executeStyledAudioStatus(context, dependencies = {}) {
  return executeGroupStatus(context, dependencies, {
    commandName: 'style',
    selectionPurpose: 'style',
    audioMode: 'stylized'
  });
}

module.exports = {
  name: 'swgc',
  alias: ['groupstatus', 'statusgroup', 'gcstatus'],
  category: 'group',
  description: 'Publie un statut dans le groupe courant ou choisit un groupe en privé',
  usage: '.swgc [texte][, couleur] | répondre à un média avec .swgc',
  execute: executeSwgc,
  executeStyledAudioStatus,
  quotedMessageFromContext,
  _test: {
    groupStatusConfirmation,
    formatRawAudioStatusCaption,
    sendContextReply,
    quotedMessageFromContext,
    ensureMembership,
    getGroupStatusMetadata,
    ensureBotCanPublishStatus,
    executeGroupStatus,
    executeSwgc,
    executeStyledAudioStatus
  }
};
