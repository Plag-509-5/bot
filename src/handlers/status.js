// status.js
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

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
 * Le paquet `wileys` fournit les helpers de construction de messages utilisés
 * pour les statuts de groupe (generateWAMessageContent / generateWAMessageFromContent).
 * Il est chargé à la demande : sa bannière de démarrage est masquée pendant le
 * `require`, qui est synchrone, donc aucun autre code ne peut écrire entre-temps.
 */
let wileysHelpers = null;
function loadWileysHelpers() {
  if (wileysHelpers) return wileysHelpers;
  const originalLog = console.log;
  console.log = () => {};
  try {
    wileysHelpers = require("wileys");
  } finally {
    console.log = originalLog;
  }
  return wileysHelpers;
}

/**
 * wileys transmet le média chiffré sous forme de flux, alors que le
 * `waUploadToServer` du socket attend un chemin de fichier. On écrit donc le
 * flux dans un fichier temporaire, on le téléverse, puis on le supprime.
 */
function uploadEncryptedStreamWithSocket(socket) {
  return async (encryptedStream, metadata) => {
    if (typeof socket.waUploadToServer !== "function") {
      throw new Error("Téléversement média indisponible sur ce socket.");
    }
    const tmpPath = path.join(
      os.tmpdir(),
      `kaido-groupstatus-${crypto.randomBytes(8).toString("hex")}.enc`
    );
    try {
      await pipeline(encryptedStream, fs.createWriteStream(tmpPath));
      return await socket.waUploadToServer(tmpPath, metadata);
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  };
}

/**
 * La construction du message passe par wileys ; l'envoi reste sur le socket
 * de la session (relayMessage) avec les deux marqueurs attendus par WhatsApp :
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

  const { generateWAMessageContent, generateWAMessageFromContent } = loadWileysHelpers();
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
      upload: uploadEncryptedStreamWithSocket(socket),
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
