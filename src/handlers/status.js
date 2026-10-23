'use strict';

const crypto = require('node:crypto');
const { waitForReady } = require('../lib/safe-send');

const PERSONAL_STATUS_JID = 'status@broadcast';
const STATUS_ACK_GRACE_MS = 1500;
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

function queueOwnMessageUpsert(socket, message) {
  if (typeof socket?.upsertMessage !== 'function') return;
  process.nextTick(() => {
    Promise.resolve().then(() => {
      const upsert = () => socket.upsertMessage(message, 'append');
      return typeof socket.messageMutex?.mutex === 'function'
        ? socket.messageMutex.mutex(upsert)
        : upsert();
    }).catch(error => {
      socket.logger?.warn?.({ error, messageId: message?.key?.id }, 'Failed to add relayed status to the local message stream');
    });
  });
}

/**
 * Publie un statut personnel via le relay du socket Baileys de la session.
 * NYXCORE construit le WAMessage; le JID status@broadcast et l'audience sont
 * ensuite remis explicitement à relayMessage, qui chiffre et distribue le
 * statut sans ouvrir une autre connexion WhatsApp.
 */
async function personalStatus(socket, content, options = {}) {
  if (!socket || typeof socket.relayMessage !== 'function') {
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

  const { generateWAMessage, generateMessageIDV2 } = await loadNyxHelpers();
  const generated = await generateWAMessage(PERSONAL_STATUS_JID, payload, {
    logger: options.logger || socket.logger,
    userJid,
    upload,
    backgroundColor: options.backgroundColor ?? contentBackgroundColor,
    font: options.font ?? contentFont,
    messageId: generateMessageIDV2(userJid),
    ...options
  });

  if (!generated?.message || !generated?.key?.id) {
    throw new Error('NYXCORE n’a pas pu construire le statut personnel.');
  }

  const ackMonitor = createStatusAckMonitor(socket, generated.key.id);
  try {
    await socket.relayMessage(PERSONAL_STATUS_JID, generated.message, {
      messageId: generated.key.id,
      statusJidList,
      useCachedGroupMetadata: false,
      // A stale PN/LID device cache is a known cause of Baileys 7 smax-invalid
      // (479) acknowledgements. Status fanout must resolve the current devices.
      useUserDevicesCache: false,
      ...(options.additionalAttributes && typeof options.additionalAttributes === 'object'
        ? { additionalAttributes: options.additionalAttributes }
        : {}),
      ...(typeof options.useUserDevicesCache === 'boolean'
        ? { useUserDevicesCache: options.useUserDevicesCache }
        : {})
    });
    const ackError = await ackMonitor.wait();
    if (ackError) {
      const code = ackError.code ? ` (code ${ackError.code})` : '';
      const hint = ackError.code === '479'
        ? ' Vérifie la résolution PN/LID et les destinataires du statut.'
        : '';
      throw new Error(`WhatsApp a rejeté le statut${code}.${hint}`);
    }
  } finally {
    ackMonitor.close();
  }
  // Baileys sendMessage ajoute aussi les messages sortants au flux local. Le
  // relay direct ne le fait pas, donc reproduire cet append sans bloquer l’envoi.
  queueOwnMessageUpsert(socket, generated);
  return generated;
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
