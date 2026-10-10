// status.js
const crypto = require("crypto");
const {
  generateWAMessageContent,
  generateWAMessageFromContent
} = require("@whiskeysockets/baileys");

const GROUP_STATUS_MESSAGE_TYPES = [
  "extendedTextMessage",
  "imageMessage",
  "videoMessage",
  "audioMessage"
];

function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
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
 * Baileys transmet au callback upload le chemin temporaire du média déjà
 * chiffré. Le socket officiel sait téléverser directement ce fichier; Baileys
 * se charge ensuite de supprimer ses fichiers temporaires.
 */
function uploadWithSocket(socket) {
  return async (encryptedFilePath, metadata) => {
    if (typeof socket.waUploadToServer !== "function") {
      throw new Error("Téléversement média indisponible sur ce socket Baileys.");
    }
    return socket.waUploadToServer(encryptedFilePath, metadata);
  };
}

/**
 * La construction et le relay passent tous deux par le Baileys officiel du
 * projet, avec les marqueurs de statut attendus par WhatsApp :
 * contextInfo.isGroupStatus et <meta is_group_status="true"/>.
 */
async function groupStatus(socket, jid, content) {
  if (!socket || typeof socket.relayMessage !== "function") {
    throw new Error("Socket WhatsApp invalide.");
  }
  if (!isGroupJid(jid)) {
    throw new Error("Le statut de groupe exige un JID @g.us.");
  }
  if (!content || typeof content !== "object") {
    throw new Error("Contenu de statut invalide.");
  }

  const { backgroundColor, font, ...payload } = content;
  const generated = await generateWAMessageContent(
    {
      ...payload,
      contextInfo: {
        ...(payload.contextInfo || {}),
        isGroupStatus: true
      }
    },
    {
      upload: uploadWithSocket(socket),
      backgroundColor,
      font,
      jid
    }
  );

  const messageSecret = crypto.randomBytes(32);
  const inside = markInnerMessageAsGroupStatus(generated);
  const wrapped = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret },
      groupStatusMessageV2: {
        message: {
          ...inside,
          messageContextInfo: {
            ...(inside.messageContextInfo || {}),
            messageSecret
          }
        }
      }
    },
    { userJid: socket.user?.id }
  );

  await socket.relayMessage(jid, wrapped.message, {
    messageId: wrapped.key.id,
    additionalNodes: [{
      tag: "meta",
      attrs: { is_group_status: "true" },
      content: undefined
    }]
  });
  return wrapped;
}

async function buildStatusContent(m, socket, prefix, command) {
  const quoted = m.quoted ? m.quoted : m;
  const mime = (quoted.msg || quoted).mimetype || "";
  const textToParse = m.text || m.body || "";
  const caption = textToParse.replace(new RegExp(`^\\${prefix}${command}\\s*`, "i"), "").trim();

  if (/image/.test(mime)) {
    const buffer = await quoted.download();
    return { image: buffer, caption };
  } else if (/video/.test(mime)) {
    const buffer = await quoted.download();
    return { video: buffer, caption };
  } else if (/audio/.test(mime)) {
    const buffer = await quoted.download();
    return { audio: buffer, mimetype: "audio/mp4" };
  } else if (caption) {
    return { text: caption };
  } else {
    throw new Error("no_content");
  }
}

module.exports = {
  groupStatus,
  buildStatusContent,
  isGroupJid,
  markInnerMessageAsGroupStatus
};
