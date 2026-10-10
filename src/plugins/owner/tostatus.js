'use strict';

const {
  normalizeSessionId: normalizeStatusSessionId,
  getStatusJidList,
  normalizedUserJid,
  parseStatusViewerNumbers,
  MAX_STATUS_VIEWERS
} = require('../../services/status-audience');
const statusLog = require('../../services/status-log');
const { persistSessionPatch } = require('../../services/session-preferences');
const {
  unwrapMessage,
  quotedText,
  streamToBuffer
} = require('../../services/group-status-content');
const { BRANDING, DESIGN } = require('../../services/group-status-audio');

const PERSONAL_STATUS_BRANDING = Object.freeze({
  title: 'LE SEIGNEUR DES APPAREILS',
  subtitle: 'PÈRE FONDATEUR DE TOUMAÏ MD',
  tags: "EXPERT EN IA  •  PASSIONNÉ D'INFORMATIQUE"
});

const PERSONAL_STATUS_DESIGN = Object.freeze({
  ...DESIGN,
  background: '0x0B1020',
  panel: '0x151F30',
  track: '0x1F2937',
  gold: '0x25D366',
  cyan: '0x25D366',
  violet: '0x25D366',
  muted: '0x9CA3AF'
});

const STATUS_JID = 'status@broadcast';
let nyxDownloadPromise = null;

function loadNyxDownloader() {
  if (!nyxDownloadPromise) {
    nyxDownloadPromise = import('@nyxcore/nyxcoresocket')
      .then(module => module.downloadContentFromMessage);
  }
  return nyxDownloadPromise;
}

function canManagePersonalStatus(context = {}) {
  return Boolean(context.isOwner || context.isSessionOwner);
}

function commandCaptionText(caption, prefix = '', command = 'tostatus') {
  const raw = String(caption || '').trim();
  const safePrefix = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeCommand = String(command || 'tostatus').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`^\\s*${safePrefix}${safeCommand}(?:\\s+|$)`, 'i');
  return raw.replace(expression, '').trim();
}

function labelForAudio(audio) {
  return audio?.ptt
    ? '🎙️ Note vocale (convertie en vidéo)'
    : '🔊 Audio (converti en vidéo)';
}

function mediaCaption(media, isOwnMessage, statusText, prefix, command) {
  const original = String(media?.caption || '').trim();
  const fallback = isOwnMessage
    ? commandCaptionText(original, prefix, command)
    : original;
  return statusText || fallback;
}

function renderStatusViewers(viewers, prefix) {
  if (!viewers.length) {
    return [
      '👁️ Aucun public personnalisé.',
      'Par défaut, le bot choisit les contacts connus, puis les membres des groupes.',
      `Pour contrôler exactement qui voit tes statuts : ${prefix}setstatusviewers 509XXXXXXXX, 509YYYYYYYY.`
    ].join('\n');
  }
  return [
    `👁️ *PUBLIC PERSONNALISÉ (${viewers.length})*`,
    ...viewers.map((number, index) => `${index + 1}. +${number}`),
    '',
    `Remplacer : ${prefix}setstatusviewers <numéros séparés par des espaces ou virgules>`,
    `Réinitialiser le fallback automatique : ${prefix}setstatusviewers clear`
  ].join('\n');
}

function replyJid(from, msg) {
  if (!String(from || '').endsWith('@g.us')) return from;
  const participant = msg?.key?.participantAlt || msg?.key?.participant;
  return participant && !String(participant).endsWith('@g.us') ? participant : null;
}

async function sendReply(socket, from, msg, text) {
  const target = replyJid(from, msg);
  if (!target) return null;
  return socket.sendMessage(target, { text }, target === from && msg ? { quoted: msg } : undefined);
}

async function reactToCommand(socket, from, msg, text) {
  if (String(from || '').endsWith('@g.us')) return;
  return socket.sendMessage(from, { react: { text, key: msg.key } }).catch(() => {});
}

async function setStatusViewers(context) {
  const { socket, from, msg, args = [], prefix = '.', sessionCfg = {} } = context;
  const raw = args.join(' ').trim();
  const current = parseStatusViewerNumbers(sessionCfg.STATUS_VIEWERS || []).numbers;
  if (!raw) {
    return sendReply(socket, from, msg, renderStatusViewers(current, prefix));
  }

  if (/^(?:clear|reset|off|auto)$/i.test(raw)) {
    try {
      await persistSessionPatch(context, { STATUS_VIEWERS: [] });
    } catch (error) {
      return sendReply(socket, from, msg, `❌ Impossible d’enregistrer le public : ${error?.message || error}`);
    }
    return sendReply(socket, from, msg,
      '✅ Liste personnalisée supprimée. Le bot utilisera les contacts connus, puis les membres de ses groupes.');
  }

  const parsed = parseStatusViewerNumbers(raw);
  if (parsed.invalid.length) {
    return sendReply(socket, from, msg,
      `❌ Numéro(s) invalide(s) : ${parsed.invalid.join(', ')}\n` +
      `Utilise des numéros internationaux de 6 à 15 chiffres, séparés par des espaces ou des virgules.`);
  }
  if (!parsed.numbers.length) {
    return sendReply(socket, from, msg, `Usage : ${prefix}setstatusviewers 509XXXXXXXX, 509YYYYYYYY`);
  }
  if (parsed.numbers.length > MAX_STATUS_VIEWERS) {
    return sendReply(socket, from, msg, `❌ La liste est limitée à ${MAX_STATUS_VIEWERS} numéros.`);
  }

  try {
    await persistSessionPatch(context, { STATUS_VIEWERS: parsed.numbers });
  } catch (error) {
    return sendReply(socket, from, msg, `❌ Impossible d’enregistrer le public : ${error?.message || error}`);
  }
  return sendReply(socket, from, msg,
    `✅ Public de statut enregistré pour cette session : ${parsed.numbers.length} contact(s) + le compte du bot.`);
}

async function deleteLatestStatus(context) {
  const { socket, from, msg, sessionNumber } = context;
  const sessionId = normalizeStatusSessionId(sessionNumber || socket.user?.id);
  const latest = statusLog.getLatest(sessionId);
  if (!latest) {
    return sendReply(socket, from, msg,
      '📭 Aucun statut récent de cette session n’est disponible pour suppression. Les statuts journalisés expirent après 24 h et le journal est en mémoire.');
  }

  await socket.sendMessage(STATUS_JID, { delete: latest.key }, {
    statusJidList: latest.statusJidList
  });
  statusLog.removeLatest(sessionId, latest.key.id);
  return sendReply(socket, from, msg, `✅ Dernier statut supprimé (${latest.label || 'publication'}).`);
}

async function getQuotedMessage(context) {
  const { msg, quotedMsg } = context;
  return unwrapMessage(
    quotedMsg
      || msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage
      || msg?.message?.imageMessage?.contextInfo?.quotedMessage
      || msg?.message?.videoMessage?.contextInfo?.quotedMessage
  );
}

async function executeToStatus(context, dependencies = {}) {
  const {
    socket,
    msg,
    from,
    args = [],
    prefix = '.',
    command = 'tostatus',
    sessionCfg = {},
    sessionNumber
  } = context;

  if (!canManagePersonalStatus(context)) {
    return sendReply(socket, from, msg, '🚫 Seul le propriétaire du bot ou de cette session peut publier un statut.');
  }

  if (command === 'setstatusviewers' || command === 'statusviewers') {
    return setStatusViewers(context);
  }
  if (command === 'delstatus') {
    try {
      return await deleteLatestStatus(context);
    } catch (error) {
      console.error('[DELSTATUS ERROR]', error);
      return sendReply(socket, from, msg, `❌ Suppression impossible : ${error?.message || error}`);
    }
  }

  const statusText = args.join(' ').trim();
  const ownMessage = unwrapMessage(msg?.message);
  const quoted = await getQuotedMessage(context);
  const image = ownMessage.imageMessage || quoted.imageMessage;
  const video = ownMessage.videoMessage || quoted.videoMessage;
  const audio = ownMessage.audioMessage || quoted.audioMessage;
  const quotedBody = quotedText(quoted);

  if (!image && !video && !audio && !statusText && !quotedBody) {
    return sendReply(socket, from, msg,
      `📤 *${prefix}tostatus* publie sur ton statut WhatsApp.\n\n` +
      `📝 Texte : ${prefix}tostatus Mon texte\n` +
      `🖼️ Photo / 🎬 vidéo : réponds au média avec la commande\n` +
      `🎙️ Audio : réponds à un audio (conversion en vidéo stylisée)\n` +
      `👁️ Public : ${prefix}setstatusviewers <numéros>\n` +
      `🗑️ Suppression : ${prefix}delstatus`);
  }

  try {
    await reactToCommand(socket, from, msg, '⏳');

    const statusJidList = await (dependencies.getStatusJidList || getStatusJidList)(
      socket,
      sessionCfg.STATUS_VIEWERS || []
    );
    const ownJid = normalizedUserJid(socket.user?.id);
    if (!statusJidList.length || statusJidList.every(jid => jid === ownJid)) {
      throw new Error('Aucun autre destinataire trouvé. Utilise .setstatusviewers pour en ajouter.');
    }

    let content;
    let label;
    if (image) {
      const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
      const buffer = await streamToBuffer(await downloader(image, 'image'));
      if (!buffer.length) throw new Error('Photo vide ou indisponible. Transfère-la à nouveau puis réessaie.');
      content = {
        image: buffer,
        mimetype: image.mimetype || 'image/jpeg',
        caption: mediaCaption(image, image === ownMessage.imageMessage, statusText, prefix, command)
      };
      label = '🖼️ Image';
    } else if (video) {
      const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
      const buffer = await streamToBuffer(await downloader(video, 'video'));
      if (!buffer.length) throw new Error('Vidéo vide ou indisponible. Transfère-la à nouveau puis réessaie.');
      content = {
        video: buffer,
        mimetype: video.mimetype || 'video/mp4',
        caption: mediaCaption(video, video === ownMessage.videoMessage, statusText, prefix, command)
      };
      label = '🎬 Vidéo';
    } else if (audio) {
      const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
      const audioBuffer = await streamToBuffer(await downloader(audio, 'audio'));
      if (!audioBuffer.length) throw new Error('Audio vide ou indisponible. Transfère-le à nouveau puis réessaie.');

      const seconds = Number(audio.seconds) || 0;
      if (seconds > 120) {
        await sendReply(socket, from, msg,
          `🎞️ Conversion en cours (audio de ${require('../../services/group-status-audio').formatTime(seconds)})… cela peut prendre quelques minutes.`);
      }
      const convert = dependencies.audioToStatusVideo
        || require('../../services/group-status-audio').audioToStatusVideo;
      const videoBuffer = await convert(audioBuffer, {
        durationSeconds: seconds,
        branding: PERSONAL_STATUS_BRANDING,
        design: PERSONAL_STATUS_DESIGN
      });
      if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
        throw new Error('La conversion audio → vidéo stylisée n’a rien produit.');
      }
      content = {
        video: videoBuffer,
        mimetype: 'video/mp4',
        caption: mediaCaption(audio, audio === ownMessage.audioMessage, statusText, prefix, command)
      };
      label = labelForAudio(audio);
    } else {
      content = { text: statusText || quotedBody };
      label = '📝 Texte';
    }

    const messageOptions = { statusJidList };
    if (content.text) {
      messageOptions.backgroundColor = '#000000';
      messageOptions.font = 0;
    }
    const sent = await socket.sendMessage(STATUS_JID, content, messageOptions);
    if (!sent?.key?.id) {
      throw new Error('WhatsApp n’a pas renvoyé la clé du statut; la publication n’est pas confirmée.');
    }

    const preview = String(content.caption || content.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30);
    statusLog.add(sessionIdOrSocket(sessionNumber, socket), {
      key: {
        remoteJid: STATUS_JID,
        fromMe: true,
        id: sent.key.id
      },
      statusJidList,
      label,
      preview
    });

    await reactToCommand(socket, from, msg, '✅');
    return sendReply(socket, from, msg,
      `✅ Statut ${label} publié, visible par ${statusJidList.length} destinataire(s).\n` +
      `Pour le retirer : ${prefix}delstatus`);
  } catch (error) {
    console.error('[TOSTATUS ERROR]', error);
    await reactToCommand(socket, from, msg, '❌');
    return sendReply(socket, from, msg, `❌ Erreur : ${error?.message || error}`);
  }
}

function sessionIdOrSocket(sessionNumber, socket) {
  return normalizeStatusSessionId(sessionNumber || socket?.user?.id);
}

module.exports = {
  name: 'tostatus',
  alias: ['setstatusviewers', 'statusviewers', 'delstatus'],
  category: 'owner',
  description: 'Publie un texte ou un média sur le statut personnel WhatsApp',
  usage: '.tostatus <texte> | répondre à une photo, vidéo ou audio | .setstatusviewers <numéros>',
  execute: executeToStatus,
  _test: {
    canManagePersonalStatus,
    replyJid,
    commandCaptionText,
    labelForAudio,
    mediaCaption,
    renderStatusViewers,
    setStatusViewers,
    deleteLatestStatus,
    getQuotedMessage,
    executeToStatus,
    PERSONAL_STATUS_BRANDING,
    PERSONAL_STATUS_DESIGN
  }
};
