'use strict';

const fs = require('node:fs');
const { Readable } = require('node:stream');
const { acquireStatusMediaSlot } = require('../../services/status-media-queue');
const {
  normalizeSessionId: normalizeStatusSessionId,
  getStatusJidList,
  normalizedUserJid,
  resolveStatusRelayAudience,
  parseStatusViewerNumbers,
  mergeStatusViewerNumbers,
  appendGroupParticipantsToStatusAudience,
  MAX_STATUS_VIEWERS
} = require('../../services/status-audience');
const {
  listUserGroups,
  beginGroupSelection,
  actorIdFromMessage
} = require('../../services/group-status-selector');
const {
  MAX_STATUS_IMPORT_BYTES,
  extractStatusViewerNumbers
} = require('../../services/status-audience-import');
const statusLog = require('../../services/status-log');
const { persistSessionPatch } = require('../../services/session-preferences');
const {
  unwrapMessage,
  quotedText,
  streamToBuffer
} = require('../../services/group-status-content');
const {
  BRANDING,
  DESIGN,
  formatTime,
  audioToStatusVideoFile
} = require('../../services/group-status-audio');
const { personalStatus } = require('../../handlers/status');

// Les statuts personnels et de groupe partagent le même cadre Kaido et la même marque.
const PERSONAL_STATUS_BRANDING = BRANDING;
const PERSONAL_STATUS_DESIGN = DESIGN;

function positiveLimitFromEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

const TOSTATUS_MAX_MEDIA_BYTES = positiveLimitFromEnv(
  'TOSTATUS_MAX_MEDIA_BYTES', 64 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024
);
const TOSTATUS_MAX_AUDIO_BYTES = positiveLimitFromEnv(
  'TOSTATUS_MAX_AUDIO_BYTES', 32 * 1024 * 1024, 1024 * 1024, TOSTATUS_MAX_MEDIA_BYTES
);
const TOSTATUS_MAX_AUDIO_SECONDS = positiveLimitFromEnv('TOSTATUS_MAX_AUDIO_SECONDS', 180, 30, 1800);
const STATUS_JID = 'status@broadcast';
const STATUS_AUDIENCE_SELECTION_PURPOSE = 'tostatus-audience';
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

function declaredMediaSize(media) {
  const raw = media?.fileLength;
  const size = Number(typeof raw?.toString === 'function' ? raw.toString() : raw);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function unwrapMediaSource(source) {
  return source && typeof source === 'object' && source.stream ? source.stream : source;
}

async function closeMediaSource(source) {
  const raw = unwrapMediaSource(source);
  if (!raw || Buffer.isBuffer(raw)) return;
  if (typeof raw.destroy === 'function') {
    if (!raw.destroyed) raw.destroy();
    return;
  }
  if (typeof raw.cancel === 'function') return raw.cancel();
  if (typeof raw.return === 'function') return raw.return();
  if (typeof raw[Symbol.asyncIterator] === 'function') {
    const iterator = raw[Symbol.asyncIterator]();
    if (typeof iterator?.return === 'function') return iterator.return();
  }
}

function mediaUploadStream(source, label, maxBytes = TOSTATUS_MAX_MEDIA_BYTES) {
  const raw = unwrapMediaSource(source);
  const input = Buffer.isBuffer(raw) ? Readable.from([raw]) : raw;
  if (!input || typeof input[Symbol.asyncIterator] !== 'function') {
    throw new Error(`${label} indisponible ou illisible.`);
  }

  const bounded = Readable.from((async function* () {
    let bytesRead = 0;
    try {
      for await (const chunk of input) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesRead += buffer.length;
        if (bytesRead > maxBytes) {
          throw new Error(`${label} dépasse la limite de ${maxBytes} octets.`);
        }
        yield buffer;
      }
      if (!bytesRead) throw new Error(`${label} vide ou indisponible.`);
    } finally {
      if (typeof input.destroy === 'function' && !input.destroyed) input.destroy();
    }
  })());
  return { stream: bounded };
}

async function downloaderToBuffer(source) {
  const raw = unwrapMediaSource(source);
  if (Buffer.isBuffer(raw)) return raw;
  return streamToBuffer(raw);
}

function renderStatusViewers(viewers, prefix) {
  const actions = [
    `Ajouter un groupe : ${prefix}tostatus new group`,
    `Importer une liste ou une vCard (en répondant au message/fichier) : ${prefix}tostatus add`,
    `Exporter la liste : ${prefix}tostatus export`
  ];
  if (!viewers.length) {
    return [
      '👁️ Aucun public personnalisé.',
      'Par défaut, le bot choisit les contacts connus, puis les membres des groupes.',
      `Pour contrôler exactement qui voit tes statuts : ${prefix}setstatusviewers 509XXXXXXXX, 509YYYYYYYY.`,
      ...actions
    ].join('\n');
  }
  return [
    `👁️ *PUBLIC PERSONNALISÉ (${viewers.length})*`,
    ...viewers.map((number, index) => `${index + 1}. +${number}`),
    '',
    `Remplacer : ${prefix}setstatusviewers <numéros séparés par des espaces ou virgules>`,
    `Réinitialiser le fallback automatique : ${prefix}setstatusviewers clear`,
    ...actions
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

  const revokeOptions = { statusJidList: latest.statusJidList };
  if (latest.addressingMode === 'lid') {
    revokeOptions.additionalAttributes = { addressing_mode: 'lid' };
  }
  await socket.sendMessage(STATUS_JID, { delete: latest.key }, revokeOptions);
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
      || msg?.message?.audioMessage?.contextInfo?.quotedMessage
      || msg?.message?.documentMessage?.contextInfo?.quotedMessage
      || msg?.message?.contactMessage?.contextInfo?.quotedMessage
  );
}

function statusSelectionActorIds(context = {}) {
  const { socket, msg, from, sender, senderNumber } = context;
  const candidates = [
    actorIdFromMessage(socket, msg, from),
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.key?.remoteJidAlt,
    msg?.key?.remoteJid,
    sender,
    senderNumber
  ];
  if (!String(from || '').endsWith('@g.us')) candidates.push(from);
  return [...new Set(candidates.map(value => String(value || '').trim()).filter(Boolean))];
}

async function expandStatusSelectionActorIds(socket, actorIds = []) {
  const expanded = new Set(actorIds.map(value => String(value || '').trim()).filter(Boolean));
  const lids = [...new Set([...expanded]
    .map(normalizedUserJid)
    .filter(jid => jid.endsWith('@lid')))];
  const mapping = socket?.signalRepository?.lidMapping;
  if (!lids.length || !mapping) return [...expanded];

  let resolved = [];
  try {
    if (typeof mapping.getPNsForLIDs === 'function') {
      resolved = await mapping.getPNsForLIDs(lids) || [];
    } else if (typeof mapping.getPNForLID === 'function') {
      resolved = (await Promise.all(lids.map(async lid => {
        try {
          const pn = await mapping.getPNForLID(lid);
          return pn ? { lid, pn } : null;
        } catch {
          return null;
        }
      }))).filter(Boolean);
    }
  } catch (error) {
    console.warn('[TOSTATUS] Résolution de l’identité de sélection impossible:', error?.message || error);
  }
  for (const item of resolved) {
    const pn = normalizedUserJid(item?.pn);
    if (pn.endsWith('@s.whatsapp.net')) expanded.add(pn);
  }
  return [...expanded];
}

function renderStatusGroupSelection(groups, prefix = '.') {
  return [
    '👥 *GROUPES DISPONIBLES POUR LE PUBLIC DU STATUT*',
    '',
    ...groups.map((group, index) => `${index + 1}. ${group.subject} — ${group.size} membre(s)`),
    '',
    'Réponds avec le numéro du groupe à ajouter.',
    'Les numéros trouvés seront ajoutés au public actuel, sans retirer les précédents.',
    `Pour importer une liste ou exporter le public : ${prefix}tostatus add / ${prefix}tostatus export`
  ].join('\n');
}

async function beginStatusAudienceGroupSelection(context) {
  const { socket, from, msg, prefix = '.', sessionNumber } = context;
  const actorIds = await expandStatusSelectionActorIds(socket, statusSelectionActorIds(context));
  let groups;
  try {
    groups = await listUserGroups(socket, actorIds);
  } catch (error) {
    return sendReply(socket, from, msg,
      `❌ Impossible de charger les groupes : ${error?.message || error}`);
  }
  if (!groups.length) {
    return sendReply(socket, from, msg,
      '❌ Aucun groupe commun n’a été trouvé entre cette session et ton compte.');
  }

  beginGroupSelection(
    sessionNumber || socket.user?.id,
    actorIds,
    groups,
    Date.now(),
    STATUS_AUDIENCE_SELECTION_PURPOSE
  );
  return sendReply(socket, from, msg, renderStatusGroupSelection(groups, prefix));
}

async function completeStatusAudienceGroupSelection(context, group, dependencies = {}) {
  const { socket, sessionCfg = {} } = context;
  const addParticipants = dependencies.appendGroupParticipantsToStatusAudience
    || appendGroupParticipantsToStatusAudience;
  const result = await addParticipants(
    socket,
    group?.jid,
    sessionCfg.STATUS_VIEWERS || []
  );
  await persistSessionPatch(context, { STATUS_VIEWERS: result.numbers });
  return result;
}

function quotedVCardText(quoted) {
  const cards = [];
  if (typeof quoted?.contactMessage?.vcard === 'string') cards.push(quoted.contactMessage.vcard);
  const contacts = quoted?.contactsArrayMessage?.contacts;
  if (Array.isArray(contacts)) {
    for (const contact of contacts) {
      if (typeof contact?.vcard === 'string') cards.push(contact.vcard);
    }
  }
  return cards.join('\n');
}

function quotedImportText(quoted) {
  return [
    quoted?.conversation,
    quoted?.extendedTextMessage?.text,
    quoted?.documentMessage?.caption,
    quoted?.imageMessage?.caption,
    quoted?.videoMessage?.caption,
    quoted?.audioMessage?.caption,
    quotedText(quoted)
  ].map(value => String(value || '').trim()).filter(Boolean).join('\n');
}

function isSupportedStatusNumberFile(document) {
  const fileName = String(document?.fileName || '').trim().toLowerCase();
  const mimetype = String(document?.mimetype || '').trim().toLowerCase();
  return /\.(?:txt|vcf)$/.test(fileName)
    || mimetype === 'text/plain'
    || mimetype === 'text/vcard'
    || mimetype === 'text/x-vcard'
    || mimetype === 'text/directory';
}

function declaredFileSize(document) {
  const value = document?.fileLength;
  const size = Number(typeof value?.toString === 'function' ? value.toString() : value);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

async function readLimitedStream(stream, maxBytes = MAX_STATUS_IMPORT_BYTES) {
  if (Buffer.isBuffer(stream)) {
    if (stream.length > maxBytes) throw new Error(`Le fichier dépasse la limite de ${maxBytes} octets.`);
    return stream;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of stream || []) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error(`Le fichier dépasse la limite de ${maxBytes} octets.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

async function readStatusNumberFile(context, document, dependencies = {}) {
  if (!isSupportedStatusNumberFile(document)) {
    throw new Error('Seuls les fichiers .txt et .vcf (vCard) peuvent être importés.');
  }
  const declaredSize = declaredFileSize(document);
  if (declaredSize > MAX_STATUS_IMPORT_BYTES) {
    throw new Error(`Le fichier dépasse la limite de ${MAX_STATUS_IMPORT_BYTES} octets.`);
  }
  const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
  const stream = await downloader(document, 'document');
  const buffer = await readLimitedStream(stream);
  if (!buffer.length) throw new Error('Le fichier cité est vide.');
  return buffer.toString('utf8');
}

async function extractQuotedStatusNumbers(context, dependencies = {}) {
  const quoted = await getQuotedMessage(context);
  const numbers = [];
  const contactText = quotedVCardText(quoted);
  if (contactText) numbers.push(...extractStatusViewerNumbers(contactText, { vcard: true }));

  const document = quoted?.documentMessage;
  if (document) {
    const fileText = await readStatusNumberFile(context, document, dependencies);
    const isVCard = /\.vcf$/i.test(String(document.fileName || ''))
      || /vcard|directory/i.test(String(document.mimetype || ''));
    numbers.push(...extractStatusViewerNumbers(fileText, { vcard: isVCard }));
  } else {
    const text = quotedImportText(quoted);
    if (text) numbers.push(...extractStatusViewerNumbers(text));
  }
  return [...new Set(numbers)];
}

async function addStatusViewerNumbers(context, numbers) {
  const current = context.sessionCfg?.STATUS_VIEWERS || [];
  const result = mergeStatusViewerNumbers(current, numbers);
  await persistSessionPatch(context, { STATUS_VIEWERS: result.numbers });
  return result;
}

async function addStatusViewers(context, dependencies = {}) {
  const { socket, from, msg, args = [], prefix = '.' } = context;
  const inlineText = args.slice(1).join(' ').trim();
  let numbers = inlineText ? extractStatusViewerNumbers(inlineText) : [];
  try {
    numbers.push(...await extractQuotedStatusNumbers(context, dependencies));
    numbers = [...new Set(numbers)];
    if (!numbers.length) {
      return sendReply(socket, from, msg,
        `❌ Aucun numéro trouvé. Réponds à un texte, un fichier .txt/.vcf ou une vCard avec ${prefix}tostatus add.`);
    }
    const result = await addStatusViewerNumbers(context, numbers);
    return sendReply(socket, from, msg,
      `✅ Public de statut agrandi : ${result.added} numéro(s) ajouté(s), ${result.alreadyPresent} déjà présent(s), ${result.total} au total.`);
  } catch (error) {
    return sendReply(socket, from, msg, `❌ Import impossible : ${error?.message || error}`);
  }
}

function sortStatusNumbers(numbers) {
  return [...new Set(numbers)].sort((left, right) => {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

async function exportStatusViewers(context) {
  const { socket, from, msg, sessionCfg = {}, prefix = '.' } = context;
  const numbers = sortStatusNumbers(parseStatusViewerNumbers(sessionCfg.STATUS_VIEWERS || []).numbers);
  if (!numbers.length) {
    return sendReply(socket, from, msg,
      `📭 Aucun numéro enregistré. Ajoute des groupes avec ${prefix}tostatus new group ou importe une liste avec ${prefix}tostatus add.`);
  }

  const content = Buffer.from(
    `PUBLIC DU STATUT — ${numbers.length} numéro(s)\n${numbers.map(number => `+${number}`).join('\n')}\n`,
    'utf8'
  );
  const target = replyJid(from, msg);
  if (!target) return null;
  const session = normalizeStatusSessionId(context.sessionNumber || socket.user?.id);
  const fileName = `public-statut-${session}.txt`;
  return socket.sendMessage(target, {
    document: content,
    mimetype: 'text/plain',
    fileName,
    caption: `✅ Public du statut exporté : ${numbers.length} numéro(s), triés par ordre numérique.`
  }, target === from && msg ? { quoted: msg } : undefined);
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

  const action = String(args[0] || '').toLowerCase();
  if (command === 'tostatus' && action === 'new') {
    if (String(args[1] || '').toLowerCase() !== 'group') {
      return sendReply(socket, from, msg, `Usage : ${prefix}tostatus new group`);
    }
    return beginStatusAudienceGroupSelection(context);
  }
  if (command === 'tostatus' && action === 'add') {
    return addStatusViewers(context, dependencies);
  }
  if (command === 'tostatus' && action === 'export') {
    return exportStatusViewers(context);
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
      `👥 Ajouter les membres d’un groupe : ${prefix}tostatus new group\n` +
      `📥 Importer depuis un texte, .txt ou vCard : réponds avec ${prefix}tostatus add\n` +
      `📤 Exporter les numéros : ${prefix}tostatus export\n` +
      `🗑️ Suppression : ${prefix}delstatus`);
  }

  let releaseMediaSlot = null;
  let cleanupTemporaryMedia = null;
  let mediaDownloadSourceRef = null;
  let mediaUploadStreamRef = null;
  try {
    await reactToCommand(socket, from, msg, '⏳');

    const configuredStatusJidList = await (dependencies.getStatusJidList || getStatusJidList)(
      socket,
      sessionCfg.STATUS_VIEWERS || []
    );
    const relayAudience = await (dependencies.resolveStatusRelayAudience || resolveStatusRelayAudience)(
      socket,
      configuredStatusJidList
    );
    const {
      statusJidList,
      ownJid,
      addressingMode,
      unresolvedJids = []
    } = relayAudience;
    const recipientCount = statusJidList.filter(jid => jid !== ownJid).length;
    if (unresolvedJids.length) {
      const examples = unresolvedJids.slice(0, 5).map(jid => jid.split('@')[0]).join(', ');
      const more = unresolvedJids.length > 5 ? ', …' : '';
      throw new Error(
        `Publication annulée : ${unresolvedJids.length} destinataire(s) n’ont pas de correspondance PN/LID fiable` +
        `${examples ? ` (${examples}${more})` : ''}. Aucun statut n’a été envoyé. ` +
        'Corrige la liste avec .setstatusviewers ou réimporte les membres du groupe.'
      );
    }
    if (!statusJidList.length || recipientCount === 0) {
      throw new Error('Aucun autre destinataire résolvable. Utilise .setstatusviewers pour corriger la liste.');
    }

    // Vérifier l’audience avant de réserver la file média, afin que les recherches
    // PN/LID n’occupent pas un slot de rendu si la publication doit être annulée.
    if (image || video || audio) releaseMediaSlot = await acquireStatusMediaSlot();

    let content;
    let label;
    if (image) {
      const size = declaredMediaSize(image);
      if (size > TOSTATUS_MAX_MEDIA_BYTES) {
        throw new Error(`La photo dépasse la limite de ${TOSTATUS_MAX_MEDIA_BYTES} octets.`);
      }
      const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
      const downloaded = await downloader(image, 'image');
      mediaDownloadSourceRef = downloaded;
      content = {
        image: mediaUploadStream(downloaded, 'La photo', TOSTATUS_MAX_MEDIA_BYTES),
        mimetype: image.mimetype || 'image/jpeg',
        caption: mediaCaption(image, image === ownMessage.imageMessage, statusText, prefix, command)
      };
      mediaUploadStreamRef = content.image.stream;
      label = '🖼️ Image';
    } else if (video) {
      const size = declaredMediaSize(video);
      if (size > TOSTATUS_MAX_MEDIA_BYTES) {
        throw new Error(`La vidéo dépasse la limite de ${TOSTATUS_MAX_MEDIA_BYTES} octets.`);
      }
      const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
      const downloaded = await downloader(video, 'video');
      mediaDownloadSourceRef = downloaded;
      content = {
        video: mediaUploadStream(downloaded, 'La vidéo', TOSTATUS_MAX_MEDIA_BYTES),
        mimetype: video.mimetype || 'video/mp4',
        caption: mediaCaption(video, video === ownMessage.videoMessage, statusText, prefix, command)
      };
      mediaUploadStreamRef = content.video.stream;
      label = '🎬 Vidéo';
    } else if (audio) {
      const seconds = Number(audio.seconds) || 0;
      if (seconds > TOSTATUS_MAX_AUDIO_SECONDS) {
        throw new Error(`L’audio dure ${formatTime(seconds)}; la limite .tostatus est ${formatTime(TOSTATUS_MAX_AUDIO_SECONDS)}.`);
      }
      if (seconds > 120) {
        await sendReply(socket, from, msg,
          `🎞️ Conversion en cours (audio de ${formatTime(seconds)})… le bot limite le traitement à une conversion à la fois.`);
      }

      const downloader = dependencies.downloadContentFromMessage || await loadNyxDownloader();
      const audioSource = await downloader(audio, 'audio');
      mediaDownloadSourceRef = audioSource;
      let videoUpload;
      if (typeof dependencies.audioToStatusVideo === 'function') {
        // Compatibilité des tests et des intégrations qui fournissent déjà un convertisseur Buffer.
        const audioBuffer = await downloaderToBuffer(audioSource);
        if (!audioBuffer.length) throw new Error('Audio vide ou indisponible. Transfère-le à nouveau puis réessaie.');
        const videoBuffer = await dependencies.audioToStatusVideo(audioBuffer, {
          durationSeconds: seconds,
          maxDurationSeconds: TOSTATUS_MAX_AUDIO_SECONDS,
          maxInputBytes: TOSTATUS_MAX_AUDIO_BYTES,
          maxOutputBytes: TOSTATUS_MAX_MEDIA_BYTES,
          branding: PERSONAL_STATUS_BRANDING,
          design: PERSONAL_STATUS_DESIGN
        });
        if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
          throw new Error('La conversion audio → vidéo stylisée n’a rien produit.');
        }
        videoUpload = mediaUploadStream(videoBuffer, 'La vidéo convertie', TOSTATUS_MAX_MEDIA_BYTES);
      } else {
        const convertToFile = dependencies.audioToStatusVideoFile || audioToStatusVideoFile;
        const converted = await convertToFile(audioSource, {
          durationSeconds: seconds,
          maxDurationSeconds: TOSTATUS_MAX_AUDIO_SECONDS,
          maxInputBytes: TOSTATUS_MAX_AUDIO_BYTES,
          branding: PERSONAL_STATUS_BRANDING,
          design: PERSONAL_STATUS_DESIGN
        });
        if (!converted?.path) {
          if (typeof converted?.cleanup === 'function') {
            try { await converted.cleanup(); } catch {}
          }
          throw new Error('La conversion audio → vidéo stylisée n’a rien produit.');
        }
        cleanupTemporaryMedia = typeof converted.cleanup === 'function'
          ? converted.cleanup.bind(converted)
          : null;
        const videoStream = fs.createReadStream(converted.path);
        videoUpload = { stream: videoStream };
      }

      content = {
        video: videoUpload,
        mimetype: 'video/mp4',
        caption: mediaCaption(audio, audio === ownMessage.audioMessage, statusText, prefix, command)
      };
      mediaUploadStreamRef = content.video.stream;
      label = labelForAudio(audio);
    } else {
      content = { text: statusText || quotedBody };
      label = '📝 Texte';
    }

    const messageOptions = { statusJidList, broadcast: true, useUserDevicesCache: false };
    if (addressingMode === 'lid') {
      messageOptions.additionalAttributes = { addressing_mode: 'lid' };
    }
    if (content.text) {
      messageOptions.backgroundColor = '#000000';
      messageOptions.font = 0;
    }
    const publishStatus = dependencies.publishPersonalStatus || personalStatus;
    const sent = await publishStatus(socket, content, messageOptions);
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
      addressingMode,
      label,
      preview
    });

    await reactToCommand(socket, from, msg, '✅');
    return sendReply(socket, from, msg,
      `✅ Statut ${label} publié, visible par ${recipientCount} destinataire(s).\n` +
      `Pour le retirer : ${prefix}delstatus`);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (/^(?:Les publications média|Les conversions audio) sont/i.test(errorMessage)) {
      console.warn('[TOSTATUS BUSY]', errorMessage);
    } else {
      console.error('[TOSTATUS ERROR]', error);
    }
    await reactToCommand(socket, from, msg, '❌');
    return sendReply(socket, from, msg, `❌ Erreur : ${errorMessage}`);
  } finally {
    try { mediaUploadStreamRef?.destroy?.(); } catch {}
    try { await closeMediaSource(mediaDownloadSourceRef); }
    catch (error) { console.warn('[TOSTATUS] Fermeture du flux téléchargé échouée:', error?.message || error); }
    if (cleanupTemporaryMedia) {
      try { await cleanupTemporaryMedia(); }
      catch (error) { console.warn('[TOSTATUS] Nettoyage temporaire échoué:', error?.message || error); }
    }
    releaseMediaSlot?.();
  }
}

function sessionIdOrSocket(sessionNumber, socket) {
  return normalizeStatusSessionId(sessionNumber || socket?.user?.id);
}

module.exports = {
  name: 'tostatus',
  alias: ['setstatusviewers', 'statusviewers', 'delstatus'],
  category: 'owner',
  description: 'Publie un statut WhatsApp personnel et gère son audience',
  usage: '.tostatus <texte> | new group | add | export | .setstatusviewers <numéros>',
  execute: executeToStatus,
  completeStatusAudienceGroupSelection,
  STATUS_AUDIENCE_SELECTION_PURPOSE,
  _test: {
    canManagePersonalStatus,
    replyJid,
    commandCaptionText,
    labelForAudio,
    mediaCaption,
    declaredMediaSize,
    mediaUploadStream,
    downloaderToBuffer,
    TOSTATUS_MAX_MEDIA_BYTES,
    TOSTATUS_MAX_AUDIO_BYTES,
    TOSTATUS_MAX_AUDIO_SECONDS,
    renderStatusViewers,
    renderStatusGroupSelection,
    statusSelectionActorIds,
    expandStatusSelectionActorIds,
    setStatusViewers,
    deleteLatestStatus,
    getQuotedMessage,
    extractQuotedStatusNumbers,
    addStatusViewerNumbers,
    addStatusViewers,
    exportStatusViewers,
    beginStatusAudienceGroupSelection,
    completeStatusAudienceGroupSelection,
    isSupportedStatusNumberFile,
    readLimitedStream,
    sortStatusNumbers,
    executeToStatus,
    PERSONAL_STATUS_BRANDING,
    PERSONAL_STATUS_DESIGN
  }
};
