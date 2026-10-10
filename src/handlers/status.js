'use strict';

const crypto = require('node:crypto');

const GROUP_STATUS_MESSAGE_TYPES = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage'
];

let nyxHelpersPromise = null;

function loadNyxHelpers() {
  if (!nyxHelpersPromise) nyxHelpersPromise = import('@nyxcore/nyxcoresocket');
  return nyxHelpersPromise;
}

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

function markInnerMessageAsGroupStatus(message) {
  const next = { ...(message || {}) };
  const messageType = GROUP_STATUS_MESSAGE_TYPES.find(type => next[type]);
  if (!messageType) return next;
  next[messageType] = {
    ...next[messageType],
    contextInfo: {
      ...(next[messageType].contextInfo || {}),
      isGroupStatus: true
    }
  };
  return next;
}

/**
 * Generate with NYXCORE's Baileys utilities, but keep the project's authenticated
 * session socket for media upload and relay. This lets the plugin use
 * sendGroupStatus() without opening a second WhatsApp connection.
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
  const { backgroundColor: optionBackgroundColor, font: optionFont, ...relayOptions } = options || {};
  const backgroundColor = optionBackgroundColor ?? contentBackgroundColor;
  const font = optionFont ?? contentFont;
  const upload = typeof socket.waUploadToServer === 'function'
    ? socket.waUploadToServer.bind(socket)
    : undefined;
  const hasMedia = ['image', 'video', 'audio', 'document', 'sticker']
    .some(mediaType => Object.hasOwn(payload, mediaType));
  if (hasMedia && !upload) {
    throw new Error('Téléversement média indisponible sur ce socket WhatsApp.');
  }

  const generated = await generateWAMessage(
    jid,
    {
      ...payload,
      contextInfo: {
        ...(payload.contextInfo || {}),
        isGroupStatus: true
      }
    },
    {
      logger: options?.logger || socket.logger,
      userJid: socket.user.id,
      upload,
      backgroundColor,
      font,
      messageId: generateMessageIDV2(socket.user.id),
      ...relayOptions
    }
  );

  if (!generated?.message || !generated?.key?.id) {
    throw new Error('NYXCORE n’a pas pu construire le statut de groupe.');
  }

  const messageSecret = crypto.randomBytes(32);
  const inside = markInnerMessageAsGroupStatus(generated.message);
  const wrappedMessage = {
    groupStatusMessageV2: { message: inside },
    messageContextInfo: {
      ...(inside.messageContextInfo || {}),
      messageSecret
    }
  };

  await socket.relayMessage(jid, wrappedMessage, {
    messageId: generated.key.id,
    ...relayOptions,
    additionalNodes: [{
      tag: 'meta',
      attrs: { is_group_status: 'true' },
      content: undefined
    }]
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
  groupStatus,
  installGroupStatusMethod,
  buildStatusContent,
  isGroupJid,
  markInnerMessageAsGroupStatus
};
