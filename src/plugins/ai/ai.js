'use strict';

const axios = require('axios');

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini officiel. La clé part dans un en-tête (jamais dans l'URL), donc elle
 * n'apparaît ni dans les journaux ni dans les erreurs affichées.
 */
async function askGemini(query, {
  http = axios,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY non configurée');
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const res = await http.post(url, {
    contents: [{ role: 'user', parts: [{ text: query }] }]
  }, {
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    timeout: 30000
  });
  const text = (res.data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('réponse Gemini vide');
  return text;
}

/** Endpoints gratuits de secours (sans clé officielle). */
async function askFreeEndpoints(query, http = axios) {
  const attempts = [
    () => http.get(`https://api.giftedtech.web.id/api/ai/gpt?apikey=gifted&q=${encodeURIComponent(query)}`, { timeout: 15000 })
      .then((res) => res.data?.result),
    () => http.get(`https://api.nexoracle.com/ai/chatgpt?prompt=${encodeURIComponent(query)}&apikey=free_key`, { timeout: 15000 })
      .then((res) => res.data?.result),
    () => http.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, { timeout: 15000 })
      .then((res) => (typeof res.data === 'string' ? res.data : null))
  ];
  for (const attempt of attempts) {
    try {
      const answer = await attempt();
      if (answer) return answer;
    } catch (_) { /* on passe au fournisseur suivant */ }
  }
  return null;
}

/**
 * Réponse à une question : Gemini si une clé est configurée, sinon (ou si Gemini
 * échoue) les endpoints gratuits.
 */
async function askAI(query, { http = axios, apiKey, model } = {}) {
  const failures = [];
  if (apiKey || process.env.GEMINI_API_KEY) {
    try {
      return { answer: await askGemini(query, { http, apiKey, model }), provider: 'gemini' };
    } catch (err) {
      failures.push(`gemini: ${err.message || err}`);
    }
  }
  const free = await askFreeEndpoints(query, http);
  if (free) return { answer: free, provider: 'gratuit' };
  failures.push('endpoints gratuits: indisponibles');
  throw new Error(`Les serveurs IA sont temporairement indisponibles (${failures.join(' ; ')}).`);
}

module.exports = {
  name: 'ai',
  alias: ['gpt', 'chat', 'botia', 'ia', 'ask'],
  category: 'ai',
  description: 'Posez n\'importe quelle question à l\'Intelligence Artificielle',
  usage: '.ai <votre question>',
  async execute({ socket, msg, from, args, prefix, dependencies = {} }) {
    const query = args.join(' ').trim();
    if (!query) {
      return await socket.sendMessage(from, {
        text: `🧠 *Usage :* \`${prefix}ia Quelle est la capitale d'Haïti ?\` ou \`${prefix}gpt Écris-moi une fonction en JavaScript\``
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { text: '🧠 *Réflexion en cours...*' }, { quoted: msg });

    try {
      const { answer } = await askAI(query, { http: dependencies.http || axios });
      const text = `🤖 *KAIDO AI ASSISTANT* 🧠\n\n${answer}\n\n> 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐛𝐲 𝐊𝐚𝐢𝐝𝐨-𝐌𝐃`;
      await socket.sendMessage(from, { text }, { quoted: msg });
    } catch (err) {
      console.error('[AI ERROR]', err.message || err);
      await socket.sendMessage(from, { text: `❌ Erreur IA : ${err.message}` }, { quoted: msg });
    }
  },
  _test: { askGemini, askFreeEndpoints, askAI }
};
