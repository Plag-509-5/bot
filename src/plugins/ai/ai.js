'use strict';

const { respond, formatAiError } = require('../../services/ai-chatbot');

module.exports = {
  name: 'ai',
  alias: ['gpt', 'chat', 'botia', 'ia', 'ask'],
  category: 'ai',
  description: 'Discute avec Kaido à l’aide des API IA configurées; mémoire partagée entre fournisseurs',
  usage: '.ai <votre question>',
  async execute({ socket, msg, from, args, prefix, sessionNumber }) {
    const query = args.join(' ').trim();
    if (!query) {
      return socket.sendMessage(from, {
        text: `🐉 *Usage :* \`${prefix}ai Quelle est la capitale d'Haïti ?\` ou \`${prefix}gpt Écris-moi une fonction en JavaScript\``
      }, { quoted: msg });
    }

    await socket.sendMessage(from, { text: '🐉 *Kaido rassemble ses idées…*' }, { quoted: msg });
    let presenceStarted = false;
    try {
      const result = await respond({
        sessionNumber,
        chatJid: from,
        senderName: String(from || '').endsWith('@g.us') ? msg?.pushName : '',
        text: query,
        onStart: async () => {
          presenceStarted = true;
          if (typeof socket.sendPresenceUpdate === 'function') {
            await socket.sendPresenceUpdate('composing', from).catch(() => {});
          }
        }
      });
      if (result.cancelled) return;
      await socket.sendMessage(from, {
        text: `🐉 *Kaido*\n\n${result.text}\n\n> Kaido-MD — PlagTech`
      }, { quoted: msg });
    } catch (error) {
      console.warn('[AI] Requête indisponible :', error?.code || error?.name || 'erreur');
      await socket.sendMessage(from, { text: `❌ ${formatAiError(error)}` }, { quoted: msg });
    } finally {
      if (presenceStarted && typeof socket.sendPresenceUpdate === 'function') {
        await socket.sendPresenceUpdate('paused', from).catch(() => {});
      }
    }
  }
};
