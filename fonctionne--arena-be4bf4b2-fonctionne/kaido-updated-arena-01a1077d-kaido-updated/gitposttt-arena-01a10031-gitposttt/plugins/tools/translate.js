const axios = require('axios');

async function translateText(text, targetLang = 'fr') {
  // Option 1 : Google Translate GTX
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { timeout: 10000 });
    if (res.data && res.data[0]) {
      const translated = res.data[0].map(item => item[0]).join('');
      const detectedLang = res.data[2] || 'auto';
      return { text: translated, from: detectedLang, to: targetLang };
    }
  } catch (e) {}

  // Option 2 : MyMemory Translate API Fallback
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`;
    const res = await axios.get(url, { timeout: 10000 });
    if (res.data && res.data.responseData?.translatedText) {
      return { text: res.data.responseData.translatedText, from: 'auto', to: targetLang };
    }
  } catch (e) {}

  return null;
}

module.exports = {
  name: 'translate',
  alias: ['tr', 'trt', 'trad', 'traduction'],
  category: 'tools',
  description: 'Traduit un texte dans la langue spécifiée',
  usage: '.tr <code_langue> <texte> ou répondre à un message avec .tr <code_langue>',
  async execute({ socket, msg, from, args, quotedMsg }) {
    const quoted = quotedMsg || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message?.stickerMessage?.contextInfo?.quotedMessage;
    let targetLang = 'fr';
    let textToTranslate = '';

    if (quoted) {
      targetLang = (args[0] || 'fr').toLowerCase();
      textToTranslate = quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || quoted.videoMessage?.caption || '';
    } else {
      if (!args.length) {
        return await socket.sendMessage(from, {
          text: '📝 *Usage :* `.tr <langue> <texte>` ou répondre à un message avec `.tr <langue>`\n\n*Exemples :*\n• `.tr en Bonjour le monde`\n• `.tr es Comment ça va ?`'
        }, { quoted: msg });
      }

      if (args[0].length === 2 || args[0].length === 3) {
        targetLang = args[0].toLowerCase();
        textToTranslate = args.slice(1).join(' ');
      } else {
        targetLang = 'fr';
        textToTranslate = args.join(' ');
      }
    }

    if (!textToTranslate.trim()) {
      return await socket.sendMessage(from, { text: '❌ Aucun texte à traduire.' }, { quoted: msg });
    }

    const result = await translateText(textToTranslate, targetLang);
    if (!result || !result.text) {
      return await socket.sendMessage(from, { text: '❌ Échec de la traduction. Vérifiez le code langue.' }, { quoted: msg });
    }

    const response = `🌐 *TRADUCTION [${result.from.toUpperCase()} ➔ ${result.to.toUpperCase()}]*\n\n${result.text}`;
    await socket.sendMessage(from, { text: response }, { quoted: msg });
  }
};
