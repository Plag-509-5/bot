'use strict';

/**
 * ssweb — capture d'écran d'un site web.
 *
 * Reprend les bons points de l'ancienne commande (taille `LxH`, page complète,
 * bornes de sécurité) et ajoute :
 *   - deux fournisseurs avec secours (le premier qui renvoie une vraie image gagne) ;
 *   - téléchargement de l'image puis envoi en binaire, au lieu de laisser
 *     WhatsApp télécharger une URL externe (échecs fréquents et imprévisibles) ;
 *   - aucune restriction de type de chat : la commande fonctionne en privé
 *     comme dans un groupe (on répond toujours à `from`, la conversation courante).
 */

const axios = require('axios');

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MIN_SIZE = 200;
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;
const API_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 25000;
const MIN_IMAGE_BYTES = 1024;

/** Normalise une URL saisie par l'utilisateur. Renvoie null si elle est inexploitable. */
function normaliseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    // Refuse « hello » ou « ssweb » seuls : il faut un nom de domaine réel.
    if (!parsed.hostname.includes('.')) return null;
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

/** Taille demandée (`1920x1080`), bornée. Valeurs par défaut sinon. */
function parseSize(input) {
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(String(input || '').trim());
  if (!match) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const width = Math.min(Math.max(parseInt(match[1], 10), MIN_SIZE), MAX_WIDTH);
  const height = Math.min(Math.max(parseInt(match[2], 10), MIN_SIZE), MAX_HEIGHT);
  return { width, height };
}

/** Détecte le format d'image à partir des premiers octets (PNG, JPEG, WEBP). */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Fournisseurs essayés dans l'ordre. Chacun renvoie un Buffer image, ou lève une erreur. */
function buildProviders(url, { width, height }) {
  return [
    {
      name: 'movanest',
      async run(http) {
        const apiUrl = `https://www.movanest.xyz/v2/ssweb?url=${encodeURIComponent(url)}` +
          `&width=${width}&height=${height}&full_page=true`;
        const res = await http.get(apiUrl, {
          headers: { Accept: 'application/json' },
          timeout: API_TIMEOUT_MS
        });
        const imageUrl = res.data?.result || res.data?.url || res.data?.data || null;
        if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
          throw new Error('réponse inattendue');
        }
        return downloadImage(http, imageUrl);
      }
    },
    {
      name: 'thum.io',
      async run(http) {
        const apiUrl = `https://image.thum.io/get/width/${width}/crop/${height}/noanimate/${url}`;
        return downloadImage(http, apiUrl);
      }
    }
  ];
}

async function downloadImage(http, imageUrl) {
  const res = await http.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const buffer = Buffer.from(res.data);
  if (buffer.length < MIN_IMAGE_BYTES || !detectImageType(buffer)) {
    throw new Error('le fichier reçu n’est pas une image valide');
  }
  return buffer;
}

/**
 * Capture l'écran. Lève une erreur listant les raisons si tous les fournisseurs échouent.
 * @returns {Promise<{ buffer: Buffer, provider: string }>}
 */
async function captureScreenshot(url, size, http = axios) {
  const failures = [];
  for (const provider of buildProviders(url, size)) {
    try {
      const buffer = await provider.run(http);
      return { buffer, provider: provider.name };
    } catch (err) {
      failures.push(`${provider.name}: ${err.message || err}`);
    }
  }
  throw new Error(`capture impossible (${failures.join(' ; ')})`);
}

module.exports = {
  name: 'ssweb',
  alias: ['ss', 'screenshot', 'capture'],
  category: 'tools',
  description: 'Prend une capture d\'écran d\'un site web (en privé comme en groupe)',
  usage: '.ssweb <url> [LxH]   ex: .ssweb google.com 1920x1080',
  async execute({ socket, msg, from, args, prefix, dependencies = {} }) {
    const cmdPrefix = prefix || '.';
    const url = normaliseUrl(args[0]);
    if (!url) {
      return socket.sendMessage(from, {
        text: `📝 *Usage :* \`${cmdPrefix}ssweb https://google.com\` ou \`${cmdPrefix}ssweb google.com 1920x1080\``
      }, { quoted: msg });
    }

    const size = parseSize(args[1]);
    const http = dependencies.http || axios;

    try { await socket.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}
    try {
      const { buffer } = await captureScreenshot(url, size, http);
      await socket.sendMessage(from, {
        image: buffer,
        caption: `🌐 *Capture d'écran de :* ${url}\n📐 ${size.width}x${size.height}`
      }, { quoted: msg });
      try { await socket.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}
    } catch (err) {
      console.error('[SSWEB ERROR]', err);
      try { await socket.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}
      await socket.sendMessage(from, {
        text: `❌ Impossible de capturer le site : ${err.message || err}\n💡 Réessaie plus tard ou avec une autre URL.`
      }, { quoted: msg });
    }
  },
  _test: {
    normaliseUrl,
    parseSize,
    detectImageType,
    captureScreenshot,
    buildProviders
  }
};
