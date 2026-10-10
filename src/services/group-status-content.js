'use strict';

const DEFAULT_TEXT_STATUS_FONT = 2;
const STATUS_BACKGROUND_PALETTE = Object.freeze([
  '#12002B', // améthyste profond
  '#101C35', // bleu nuit
  '#102A34', // pétrole
  '#211331', // prune
  '#14243A', // indigo nuit
  '#1B1D32'  // ardoise violette
]);

const STATUS_COLORS = Object.freeze({
  nuit: '#12002B',
  noir: '#10111A',
  blanc: '#F5F7FF',
  rouge: '#B4233C',
  vert: '#146C55',
  bleu: '#2458A6',
  jaune: '#B8860B',
  violet: '#5537A8',
  orange: '#B85C19',
  rose: '#B23A72',
  gris: '#465064',
  cyan: '#087F8C',
  turquoise: '#087F8C',
  'bleu nuit': '#14213D',
  'violet profond': '#24123D',
  'vert emeraude': '#075E54',
  'rose profond': '#8E285B',
  'or': '#8A6416',
  dore: '#8A6416'
});

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

function normalizeColorName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/** Accepte les couleurs de la palette française et les hexadécimaux #rrggbb. */
function parseStatusColor(input) {
  const value = String(input || '').trim();
  if (!value) return null;

  const name = normalizeColorName(value);
  if (Object.hasOwn(STATUS_COLORS, name)) return STATUS_COLORS[name];

  const hexMatch = value.match(/^#?([0-9a-f]{6})$/i);
  return hexMatch ? `#${hexMatch[1].toUpperCase()}` : null;
}

/**
 * Seule la dernière virgule est considérée comme séparateur si son suffixe
 * correspond à une couleur connue. Les virgules ordinaires du texte restent.
 */
function splitTextAndColor(input) {
  const text = String(input || '').trim();
  const lastComma = text.lastIndexOf(',');
  if (lastComma < 0) return { text, color: null, colorName: '' };

  const candidateText = text.slice(0, lastComma).trim();
  const candidateColor = text.slice(lastComma + 1).trim();
  const color = parseStatusColor(candidateColor);
  if (!candidateText || !color) return { text, color: null, colorName: '' };
  return { text: candidateText, color, colorName: candidateColor };
}

function randomStatusColor(random = Math.random) {
  const value = Number(random());
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, 0.999999999)) : 0;
  return STATUS_BACKGROUND_PALETTE[Math.floor(safeValue * STATUS_BACKGROUND_PALETTE.length)];
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function buildGroupStatusPayload({
  quotedMessage,
  textInput = '',
  colorInput = '',
  downloadContent,
  audioToStatusVideo,
  random = Math.random
}) {
  const quoted = unwrapMessage(quotedMessage);
  const parsedText = splitTextAndColor(textInput);
  const requestedText = parsedText.text;
  const textColor = parseStatusColor(colorInput) || parsedText.color;
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

    const caption = String(media.caption || '').trim() || requestedText;
    if (downloadType === 'image') {
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
      return {
        type: 'video',
        payload: {
          video: buffer,
          mimetype: media.mimetype || 'video/mp4',
          ...(caption ? { caption } : {})
        }
      };
    }

    const convertAudio = audioToStatusVideo
      || require('./group-status-audio').audioToStatusVideo;
    const video = await convertAudio(buffer, {
      durationSeconds: Number(media.seconds) || 0
    });
    if (!Buffer.isBuffer(video) || video.length === 0) {
      throw new Error('La conversion audio → vidéo a produit un fichier vide.');
    }
    return {
      type: 'audio',
      payload: {
        video,
        mimetype: 'video/mp4',
        ...(caption ? { caption } : {})
      }
    };
  }

  const text = requestedText || quotedText(quoted);
  if (text) {
    return {
      type: 'text',
      payload: {
        text,
        backgroundColor: textColor || randomStatusColor(random),
        font: DEFAULT_TEXT_STATUS_FONT
      }
    };
  }
  if (Object.keys(quoted).length) throw new Error('Ce type de média n’est pas pris en charge par le statut de groupe');
  throw new Error('Écris un texte (optionnellement suivi de , couleur) ou réponds à une image, une vidéo ou un audio');
}

module.exports = {
  DEFAULT_TEXT_STATUS_FONT,
  STATUS_BACKGROUND_PALETTE,
  STATUS_COLORS,
  unwrapMessage,
  quotedText,
  normalizeColorName,
  parseStatusColor,
  splitTextAndColor,
  randomStatusColor,
  streamToBuffer,
  buildGroupStatusPayload
};
