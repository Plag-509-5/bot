'use strict';

const QRCode = require('qrcode');
const jsQR = require('jsqr');
const sharp = require('sharp');
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function createQr(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Le texte ou l’URL ne peut pas être vide.');
  if (text.length > 4000) throw new Error('Le contenu est trop long pour un QR WhatsApp.');
  return QRCode.toBuffer(text.trim(), {
    type: 'png',
    width: 1000,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#111827', light: '#FFFFFF' },
    ...options
  });
}

async function readQr(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) throw new Error('Le fichier image fourni est vide ou invalide.');
  if (imageBuffer.length > MAX_IMAGE_BYTES) throw new Error('L’image dépasse la limite de sécurité de 20 Mo.');
  let decoded;
  try {
    decoded = await sharp(imageBuffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new Error(`Impossible de lire cette image : ${error.message || error}`);
  }
  const { data, info } = decoded;
  const result = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: 'attemptBoth' });
  if (!result?.data) throw new Error('Aucun QR lisible n’a été trouvé dans l’image.');
  return result.data;
}

module.exports = { createQr, readQr, MAX_IMAGE_BYTES };
