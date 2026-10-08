'use strict';

const axios = require('axios');
const path = require('path');

function getStickerSetName(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Lien Telegram manquant.');
  if (/\.tgs(?:[?#]|$)/i.test(input)) return null;

  let parsed;
  try {
    parsed = new URL(input);
  } catch (_) {
    throw new Error('Lien Telegram invalide. Exemple : https://t.me/addstickers/NomDuPack');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!['t.me', 'telegram.me'].includes(hostname)) {
    throw new Error('Le lien doit venir de t.me ou telegram.me.');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const actionIndex = parts.findIndex((part) => ['addstickers', 'addemoji'].includes(part.toLowerCase()));
  const name = actionIndex >= 0 ? parts[actionIndex + 1] : null;
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('Lien de pack Telegram invalide. Exemple : https://t.me/addstickers/NomDuPack');
  }
  return name;
}

function telegramApiBase(token) {
  return `https://api.telegram.org/bot${token}`;
}

async function telegramMethod(token, method, params, http = axios) {
  try {
    const response = await http.get(`${telegramApiBase(token)}/${method}`, {
      params,
      timeout: 20_000,
      headers: { Accept: 'application/json' }
    });
    if (!response.data?.ok) {
      throw new Error(response.data?.description || `Telegram ${method} a échoué`);
    }
    return response.data.result;
  } catch (error) {
    // Never bubble the Axios config: its URL contains the Telegram bot token.
    const reason = error.response?.data?.description || error.message || `Telegram ${method} a échoué`;
    throw new Error(String(reason).replace(String(token), '[TOKEN]'));
  }
}

function extensionFromFile(sticker, filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext) return ext.slice(1);
  if (sticker?.is_animated) return 'tgs';
  if (sticker?.is_video) return 'webm';
  return 'webp';
}

async function getTelegramStickerEntries(packUrl, options = {}) {
  const directUrl = String(packUrl || '').trim();
  if (/^https?:\/\/.+\.tgs(?:[?#]|$)/i.test(directUrl)) {
    return {
      title: 'Telegram Sticker',
      name: 'Telegram Pack',
      entries: [{ url: directUrl, extension: 'tgs', animated: true, video: false }]
    };
  }

  const setName = getStickerSetName(directUrl);
  const token = String(options.token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN est absent. Ajoute le token gratuit créé avec @BotFather dans le fichier .env, puis redémarre le bot.'
    );
  }

  const http = options.http || axios;
  const max = Math.min(Math.max(Number(options.limit) || 30, 1), 50);
  const stickerSet = await telegramMethod(token, 'getStickerSet', { name: setName }, http);
  const stickers = Array.isArray(stickerSet?.stickers) ? stickerSet.stickers.slice(0, max) : [];
  if (!stickers.length) throw new Error('Ce pack Telegram est vide ou inaccessible.');

  const entries = [];
  for (const sticker of stickers) {
    if (!sticker?.file_id) continue;
    const file = await telegramMethod(token, 'getFile', { file_id: sticker.file_id }, http);
    if (!file?.file_path) continue;
    entries.push({
      url: `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      extension: extensionFromFile(sticker, file.file_path),
      animated: Boolean(sticker.is_animated),
      video: Boolean(sticker.is_video)
    });
  }

  if (!entries.length) throw new Error('Telegram n’a retourné aucun fichier pour ce pack.');
  return {
    title: stickerSet.title || setName,
    name: stickerSet.name || setName,
    entries
  };
}

module.exports = {
  getTelegramStickerEntries,
  _test: { getStickerSetName, extensionFromFile, telegramMethod }
};
