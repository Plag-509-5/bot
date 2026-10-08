'use strict';

function unwrapMessage(message) {
  let current = message || {};
  for (let depth = 0; depth < 5; depth += 1) {
    const wrapped = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    current = wrapped;
  }
  return current;
}

function quotedText(message) {
  const unwrapped = unwrapMessage(message);
  return String(unwrapped.conversation || unwrapped.extendedTextMessage?.text || '').trim();
}

function randomStatusColor(random = Math.random) {
  return `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function buildGroupStatusPayload({ quotedMessage, textInput = '', downloadContent, random = Math.random }) {
  const quoted = unwrapMessage(quotedMessage);
  const requestedText = String(textInput || '').trim();
  const mediaTypes = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio']
  ];

  for (const [messageKey, downloadType] of mediaTypes) {
    const media = quoted[messageKey];
    if (!media) continue;
    if (typeof downloadContent !== 'function') throw new Error('Téléchargement média indisponible');
    const stream = await downloadContent(media, downloadType);
    const buffer = await streamToBuffer(stream);
    if (!buffer.length) throw new Error('Le média cité est vide');

    if (downloadType === 'image') {
      const caption = String(media.caption || '').trim() || requestedText;
      return {
        type: 'image',
        payload: {
          image: buffer,
          mimetype: media.mimetype || 'image/jpeg',
          ...(caption ? { caption } : {})
        }
      };
    }
    if (downloadType === 'video') {
      const caption = String(media.caption || '').trim() || requestedText;
      return {
        type: 'video',
        payload: {
          video: buffer,
          mimetype: media.mimetype || 'video/mp4',
          ...(caption ? { caption } : {})
        }
      };
    }
    return {
      type: 'audio',
      payload: {
        audio: buffer,
        mimetype: media.mimetype || 'audio/mp4',
        ptt: Boolean(media.ptt)
      }
    };
  }

  const text = requestedText || quotedText(quoted);
  if (text) {
    return {
      type: 'text',
      payload: { text, backgroundColor: randomStatusColor(random), font: 3 }
    };
  }
  if (Object.keys(quoted).length) throw new Error('Ce type de média n’est pas pris en charge par le statut de groupe');
  throw new Error('Écris un texte ou réponds à une image, une vidéo ou un audio');
}

module.exports = {
  unwrapMessage,
  quotedText,
  randomStatusColor,
  streamToBuffer,
  buildGroupStatusPayload
};
