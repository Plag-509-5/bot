'use strict';

const crypto = require('node:crypto');
const { waitForReady } = require('../lib/safe-send');
const { resolveStatusRelayAudience } = require('../services/status-audience');

const PERSONAL_STATUS_JID = 'status@broadcast';
const STATUS_ACK_GRACE_MS = 750;
let nyxHelpersPromise = null;

function createStatusAckMonitor(socket, messageId, graceMs = STATUS_ACK_GRACE_MS) {
  const eventEmitter = socket?.ev;
  if (!eventEmitter || typeof eventEmitter.on !== 'function') {
    return { wait: async () => null, close() {} };
  }

  let resolveAck;
  let waitPromise = null;
  let timer = null;
  let closed = false;
  const ackPromise = new Promise(resolve => { resolveAck = resolve; });
  const listener = updates => {
    for (const item of Array.isArray(updates) ? updates : [updates]) {
      if (item?.key?.id !== messageId) continue;
      const status = item?.update?.status;
      const code = item?.update?.messageStubParameters?.[0];
      if (status === 0 || String(status).toUpperCase() === 'ERROR' || code !== undefined) {
        resolveAck({ code: code === undefined ? '' : String(code) });
        return;
      }
    }
  };

  eventEmitter.on('messages.update', listener);
  return {
    wait() {
      if (!waitPromise) {
        waitPromise = new Promise(resolve => {
          timer = setTimeout(() => resolve(null), Math.max(0, Number(graceMs) || 0));
          ackPromise.then(result => {
            if (timer) clearTimeout(timer);
            timer = null;
            resolve(result);
          });
        });
      }
      return waitPromise;
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof eventEmitter.off === 'function') {
        eventEmitter.off('messages.update', listener);
      } else if (typeof eventEmitter.removeListener === 'function') {
        eventEmitter.removeListener('messages.update', listener);
      }
    }
  };
}

function loadNyxHelpers() {
  if (!nyxHelpersPromise) nyxHelpersPromise = import('@nyxcore/nyxcoresocket');
  return nyxHelpersPromise;
}

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

/**
 * Publie un statut personnel avec le sendMessage standard du socket
 * Baileys/NYXCORE de la session et son option statusJidList, sans ouvrir une
 * autre connexion WhatsApp.
 */
async function personalStatus(socket, content, options = {}) {
  if (!socket || typeof socket.sendMessage !== 'function') {
    throw new Error('Socket WhatsApp invalide.');
  }
  if (!content || typeof content !== 'object') {
    throw new Error('Contenu de statut invalide.');
  }

  const userJid = socket.authState?.creds?.me?.id || socket.user?.id;
  if (!userJid) {
    throw new Error('Le socket doit être connecté avant de publier un statut personnel.');
  }
  const statusJidList = [...new Set((Array.isArray(options.statusJidList) ? options.statusJidList : [])
    .map(jid => String(jid || '').trim())
    .filter(Boolean))];
  if (!statusJidList.length) {
    throw new Error('La liste des destinataires du statut est vide.');
  }

  const readiness = await waitForReady(socket);
  if (!readiness.ready) {
    throw new Error(`Connexion WhatsApp indisponible (${readiness.reason}).`);
  }

  const { backgroundColor: contentBackgroundColor, font: contentFont, ...payload } = content;
  const upload = typeof socket.waUploadToServer === 'function'
    ? socket.waUploadToServer.bind(socket)
    : undefined;
  const hasMedia = ['image', 'video', 'audio', 'document', 'sticker']
    .some(mediaType => Object.hasOwn(payload, mediaType));
  if (hasMedia && !upload) {
    throw new Error('Téléversement média indisponible sur ce socket WhatsApp.');
  }

  const {
    sourceStatusJidList = [],
    ackGraceMs,
    resolveStatusRelayAudience: resolveAudienceOverride,
    ...messageOptions
  } = options;
  const { generateMessageIDV2 } = await loadNyxHelpers();

  const requestedRelayAttributes = messageOptions.additionalAttributes && typeof messageOptions.additionalAttributes === 'object'
    ? messageOptions.additionalAttributes
    : {};
  const statusRelayAttributes = { ...requestedRelayAttributes };
  delete statusRelayAttributes.addressing_mode;
  const relayAttributes = Object.keys(statusRelayAttributes).length ? statusRelayAttributes : undefined;
  const sendOptions = { ...messageOptions };
  delete sendOptions.additionalAttributes;
  const sendStatusWithAck = async (messageId, audience, additionalAttributes) => {
    const monitor = createStatusAckMonitor(socket, messageId, ackGraceMs);
    try {
      // Utilise le chemin officiel NYXCORE/Baileys de l’application, comme
      // sendMessage('status@broadcast', payload, { statusJidList }). Il construit
      // le message, relaie l’audience puis l’inscrit au flux local.
      const sent = await socket.sendMessage(PERSONAL_STATUS_JID, payload, {
        ...sendOptions,
        messageId,
        statusJidList: audience,
        useCachedGroupMetadata: false,
        // Reuse Baileys' per-JID device cache to avoid a fresh USync round-trip
        // for every status, especially for audiences with hundreds of contacts.
        useUserDevicesCache: true,
        ...(additionalAttributes ? { additionalAttributes } : {})
      });
      return { sent, ackError: await monitor.wait() };
    } finally {
      monitor.close();
    }
  };

  let usedAudience = statusJidList;
  let usedAddressingMode = socket.authState?.creds?.me?.lid || socket.user?.lid ? 'lid' : 'pn';
  let attempt = await sendStatusWithAck(generateMessageIDV2(userJid), usedAudience, relayAttributes);
  let sent = attempt.sent;
  let ackError = attempt.ackError;

  // WhatsApp peut encore refuser un fanout même quand les mappings locaux sont
  // cohérents. Sur un ACK 479 seulement, retenter une fois dans l’autre espace
  // d’adressage, après résolution complète; un rejet explicite évite le risque
  // d’un double envoi, contrairement à un timeout réseau.
  if (ackError?.code === '479' && Array.isArray(sourceStatusJidList) && sourceStatusJidList.length) {
    const alternateMode = usedAddressingMode === 'lid' ? 'pn' : 'lid';
    socket.logger?.warn?.({ addressingMode: usedAddressingMode }, 'Status ACK 479; trying alternate PN/LID addressing once');
    try {
      const resolveAudience = resolveAudienceOverride || resolveStatusRelayAudience;
      const alternate = await resolveAudience(socket, sourceStatusJidList, { addressingMode: alternateMode });
      if (alternate.unresolvedJids?.length || !alternate.statusJidList?.length) {
        throw new Error('les destinataires ne sont pas tous résolus dans l’espace alternatif');
      }
      attempt = await sendStatusWithAck(
        generateMessageIDV2(userJid),
        alternate.statusJidList,
        undefined
      );
      sent = attempt.sent;
      ackError = attempt.ackError;
      if (!ackError) {
        usedAudience = alternate.statusJidList;
        usedAddressingMode = alternateMode;
      }
    } catch (fallbackError) {
      throw new Error(
        `WhatsApp a rejeté le statut (code 479); le repli ${alternateMode.toUpperCase()} est impossible : ` +
        `${fallbackError?.message || fallbackError}`
      );
    }
  }

  if (ackError) {
    const code = ackError.code ? ` (code ${ackError.code})` : '';
    const hint = ackError.code === '479'
      ? ` Les modes PN et LID ont été tentés sans ACK positif; vérifie les destinataires résolus.`
      : '';
    throw new Error(`WhatsApp a rejeté le statut${code}.${hint}`);
  }
  if (!sent?.key?.id) {
    throw new Error('WhatsApp n’a pas renvoyé la clé du statut; la publication n’est pas confirmée.');
  }

  return {
    ...sent,
    statusJidList: [...usedAudience],
    statusAddressingMode: usedAddressingMode
  };
}

/**
 * Publie un statut de groupe avec le socket Baileys déjà authentifié par la
 * session MongoDB. Le wrapper est le même que celui utilisé par NYXCORE;
 * surtout, les paquets média doivent rester identifiables par le relay Baileys.
 */
async function groupStatus(socket, jid, content, options = {}) {
  if (!socket || typeof socket.relayMessage !== 'function') {
    throw new Error('Socket WhatsApp invalide.');
  }
  if (!isGroupJid(jid)) {
    throw new Error('Le statut de groupe exige un JID @g.us.');
  }
  if (!content || typeof content !== 'object') {
    throw new Error('Contenu de statut invalide.');
  }
  if (!socket.user?.id) {
    throw new Error('Le socket doit être connecté avant de publier un statut de groupe.');
  }

  const { generateWAMessage, generateMessageIDV2 } = await loadNyxHelpers();
  const {
    backgroundColor: contentBackgroundColor,
    font: contentFont,
    ...payload
  } = content;
  const upload = typeof socket.waUploadToServer === 'function'
    ? socket.waUploadToServer.bind(socket)
    : undefined;
  const hasMedia = ['image', 'video', 'audio', 'document', 'sticker']
    .some(mediaType => Object.hasOwn(payload, mediaType));
  if (hasMedia && !upload) {
    throw new Error('Téléversement média indisponible sur ce socket WhatsApp.');
  }

  const generated = await generateWAMessage(jid, payload, {
    logger: options?.logger || socket.logger,
    userJid: socket.user.id,
    upload,
    backgroundColor: options?.backgroundColor ?? contentBackgroundColor,
    font: options?.font ?? contentFont,
    messageId: generateMessageIDV2(socket.user.id),
    ...options
  });

  if (!generated?.message || !generated?.key?.id) {
    throw new Error('NYXCORE n’a pas pu construire le statut de groupe.');
  }

  // groupStatusMessageV2 transporte l’image/vidéo/audio original dans le corps
  // chiffré. Les drapeaux `isGroupStatus` et le nœud XML `meta` ajoutés par
  // l’ancienne version ne font pas partie de l’enveloppe NYXCORE et n’aident pas
  // à classifier le média.
  const wrappedMessage = {
    groupStatusMessageV2: { message: generated.message },
    messageContextInfo: {
      ...(generated.message.messageContextInfo || {}),
      messageSecret: crypto.randomBytes(32)
    }
  };

  await socket.relayMessage(jid, wrappedMessage, {
    messageId: generated.key.id,
    useCachedGroupMetadata: options?.useCachedGroupMetadata
  });
  return { ...generated, message: wrappedMessage };
}

/**
 * The active project socket is still created by @whiskeysockets/baileys and
 * therefore has no NYXCORE-only method. Install a small adapter on that socket;
 * real NYXCORE sockets already provide sendGroupStatus natively.
 */
function installGroupStatusMethod(socket) {
  if (!socket || typeof socket !== 'object') {
    throw new Error('Socket WhatsApp invalide.');
  }
  if (typeof socket.sendGroupStatus === 'function') {
    return socket.sendGroupStatus.bind(socket);
  }

  const adapter = (jid, content, options) => groupStatus(socket, jid, content, options);
  try {
    Object.defineProperty(socket, 'sendGroupStatus', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: adapter
    });
    return socket.sendGroupStatus;
  } catch {
    // Keep the publishing path usable even if a socket object is non-extensible.
    return adapter;
  }
}

async function buildStatusContent(m, socket, prefix, command) {
  const quoted = m.quoted ? m.quoted : m;
  const mime = (quoted.msg || quoted).mimetype || '';
  const textToParse = m.text || m.body || '';
  const caption = textToParse.replace(new RegExp(`^\\${prefix}${command}\\s*`, 'i'), '').trim();

  if (/image/.test(mime)) {
    const buffer = await quoted.download();
    return { image: buffer, caption };
  } else if (/video/.test(mime)) {
    const buffer = await quoted.download();
    return { video: buffer, caption };
  } else if (/audio/.test(mime)) {
    const buffer = await quoted.download();
    return { audio: buffer, mimetype: 'audio/mp4' };
  } else if (caption) {
    return { text: caption };
  } else {
    throw new Error('no_content');
  }
}

module.exports = {
  personalStatus,
  groupStatus,
  installGroupStatusMethod,
  buildStatusContent,
  isGroupJid,
  PERSONAL_STATUS_JID,
  STATUS_ACK_GRACE_MS,
  createStatusAckMonitor
};
