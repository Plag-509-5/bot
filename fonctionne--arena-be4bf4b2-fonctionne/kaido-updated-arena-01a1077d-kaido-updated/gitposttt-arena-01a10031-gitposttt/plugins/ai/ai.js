const axios = require('axios');

async function askAI(query) {
  // Option 1 : Free public AI endpoint
  try {
    const res = await axios.get(`https://api.giftedtech.web.id/api/ai/gpt?apikey=gifted&q=${encodeURIComponent(query)}`, { timeout: 15000 });
    if (res.data && res.data.result) return res.data.result;
  } catch (e) {}

  // Option 2 : Free backup AI endpoint
  try {
    const res = await axios.get(`https://api.nexoracle.com/ai/chatgpt?prompt=${encodeURIComponent(query)}&apikey=free_key`, { timeout: 15000 });
    if (res.data && res.data.result) return res.data.result;
  } catch (e) {}

  // Option 3 : Pollinations AI
  try {
    const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, { timeout: 15000 });
    if (res.data && typeof res.data === 'string') return res.data;
  } catch (e) {}

  throw new Error('Les serveurs IA sont temporairement indisponibles.');
}

module.exports = {
  name: 'ai',
  alias: ['gpt', 'chat', 'botia', 'ia', 'ask'],
  category: 'ai',
  description: 'Posez n\'importe quelle question à l\'Intelligence Artificielle',
  usage: '.ai <votre question>',
  async execute({ socket, msg, from, args, prefix }) {
    const query = args.join(' ');
    if (!query) {
      return await socket.sendMessage(from, {
        text: `🧠 *Usage :* \`${prefix}ai Quelle est la capitale d'Haïti ?\` ou \`${prefix}gpt Écris-moi une fonction en JavaScript\``
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { text: '🧠 *Réflexion en cours...*' }, { quoted: msg });

    try {
      const answer = await askAI(query);
      const text = `🤖 *KAIDO AI ASSISTANT* 🧠\n\n${answer}\n\n> 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐛𝐲 𝐊𝐚𝐢𝐝𝐨-𝐌𝐃`;
      await socket.sendMessage(from, { text }, { quoted: msg });
    } catch (err) {
      console.error('[AI ERROR]', err);
      await socket.sendMessage(from, { text: `❌ Erreur IA : ${err.message}` }, { quoted: msg });
    }
  }
};
