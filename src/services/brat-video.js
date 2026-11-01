'use strict';

const crypto = require('node:crypto');
const WIDTH = 512;
const HEIGHT = 512;
const FRAME_COUNT = 12;
const MAX_TEXT_LENGTH = 240;
const MAX_STICKER_BYTES = 500 * 1024;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function wrapText(value, maxCharacters = 13) {
  const paragraphs = String(value).split(/\r?\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (!line) {
        if (word.length > maxCharacters) {
          for (let index = 0; index < word.length; index += maxCharacters) {
            lines.push(word.slice(index, index + maxCharacters));
          }
        } else line = word;
      } else if (`${line} ${word}`.length <= maxCharacters) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (!paragraph.trim()) lines.push('');
  }
  return lines.length ? lines : [''];
}

function renderBratSvg(text, frame = 0) {
  const normalized = String(text || '').normalize('NFKC').trim();
  if (!normalized) throw new Error('Ajoute le texte à afficher sur le sticker bratvid.');
  if (Array.from(normalized).length > MAX_TEXT_LENGTH) {
    throw new Error(`Le texte bratvid est limité à ${MAX_TEXT_LENGTH} caractères.`);
  }

  const lines = wrapText(normalized);
  const maxChars = Math.max(1, ...lines.map(line => Array.from(line).length));
  const fontSize = Math.max(25, Math.min(82, Math.floor(455 / (maxChars * 0.68))));
  const lineHeight = Math.round(fontSize * 0.91);
  const totalHeight = lineHeight * lines.length;
  if (totalHeight > 450) throw new Error('Le texte est trop long pour tenir dans un sticker bratvid lisible.');
  const startY = (HEIGHT - totalHeight) / 2 + fontSize * 0.78;
  const jitterX = [0, 1, -1, 2, -2, 1, 0, -1, 2, -2, 1, 0][frame % FRAME_COUNT];
  const jitterY = [0, -1, 1, 0, 1, -1, 0, 1, -1, 0, -1, 1][frame % FRAME_COUNT];
  const svgLines = lines.map((line, index) =>
    `<text x="${WIDTH / 2 + jitterX}" y="${startY + index * lineHeight + jitterY}" ` +
    `text-anchor="middle" textLength="${Math.min(464, Math.max(fontSize, Array.from(line).length * fontSize * 0.62))}" ` +
    `lengthAdjust="spacingAndGlyphs">${escapeXml(line)}</text>`
  ).join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<defs><filter id="soft"><feGaussianBlur stdDeviation="0.38"/></filter></defs>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#8ACE00"/>` +
    `<g fill="#050505" font-family="Arial Narrow, Arial, sans-serif" font-size="${fontSize}" ` +
    `font-weight="700" letter-spacing="-1.1" filter="url(#soft)">${svgLines}</g></svg>`
  );
}

function makeExifBuffer(packName, authorName) {
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': String(packName || 'bratvid').slice(0, 128),
    'sticker-pack-publisher': String(authorName || 'KAIDO-MD').slice(0, 128),
    emojis: ['🟩']
  }), 'utf8');
  const prefix = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  prefix.writeUIntLE(json.length, 14, 4);
  return Buffer.concat([prefix, json]);
}

async function createBratVideoSticker(text, options = {}) {
  const sharp = options.sharp || require('sharp');
  const webpmux = options.webpmux || require('node-webpmux');

  const frames = [];
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const buffer = await sharp(renderBratSvg(text, frame))
      .webp({ quality: 48, effort: 5 })
      .toBuffer();
    frames.push({ buffer, delay: 125, x: 0, y: 0, blend: false, dispose: false });
  }

  let buffer = await webpmux.Image.save(null, {
    width: WIDTH,
    height: HEIGHT,
    frames,
    bgColor: [138, 206, 0, 255],
    loops: 0
  });
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Impossible de construire le WebP animé bratvid.');
  if (buffer.length > MAX_STICKER_BYTES) {
    throw new Error(`Le sticker animé généré dépasse la taille WhatsApp de ${MAX_STICKER_BYTES} octets.`);
  }

  const image = new webpmux.Image();
  await image.load(buffer);
  if (!image.hasAnim || image.frames?.length !== FRAME_COUNT) {
    throw new Error('Le WebP généré n’est pas reconnu comme un sticker animé.');
  }
  image.exif = makeExifBuffer(text, 'KAIDO-MD');
  buffer = await image.save(null);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Impossible de finaliser le sticker WebP animé.');
  if (buffer.length > MAX_STICKER_BYTES) {
    throw new Error(`Le sticker final dépasse la taille WhatsApp de ${MAX_STICKER_BYTES} octets.`);
  }
  return buffer;
}

module.exports = {
  createBratVideoSticker,
  renderBratSvg,
  wrapText,
  MAX_TEXT_LENGTH,
  MAX_STICKER_BYTES,
  _test: { escapeXml, makeExifBuffer, WIDTH, HEIGHT, FRAME_COUNT }
};
