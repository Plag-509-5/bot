const { jidNormalizedUser } = require('@whiskeysockets/baileys');

module.exports = {
  name: 'save',
  alias: ['sauvegarder', 'vv', 'rvo', 'readviewonce'],
  category: 'tools',
  description: 'Sauvegarde et renvoie un média éphémère (Vue Unique) ou un message cité dans votre chat privé',
  usage: '.save (en répondant à un média ou statut)',
  async execute({ socket, msg, from, sender, senderNumber, isOwner, quotedMsg, contextInfo }) {
    const quoted = quotedMsg 
      || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      || msg.message?.stickerMessage?.contextInfo?.quotedMessage
      || msg.quoted?.msg;

    if (!quoted) {
      return await socket.sendMessage(from, {
        text: '❌ *Veuillez répondre à un média (photo, vidéo, audio, statut ou vue unique) avec .save*'
      }, { quoted: msg });
    }

    try {
      // Déterminer le destinataire (le compte connecté du bot ou l'envoyeur en privé)
      const userJid = jidNormalizedUser(socket.user.id);
      const recipientJid = from.endsWith('@g.us') ? sender : from;

      // Déballer les conteneurs (Vue Unique, Éphémère, etc.)
      let m = { ...quoted };
      let isViewOnce = false;

      while (m && (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage)) {
        if (m.viewOnceMessage || m.viewOnceMessageV2) isViewOnce = true;
        m = m.ephemeralMessage?.message 
          || m.viewOnceMessage?.message 
          || m.viewOnceMessageV2?.message 
          || m.documentWithCaptionMessage?.message;
      }

      // Désactiver le drapeau viewOnce
      if (m.imageMessage) m.imageMessage.viewOnce = false;
      if (m.videoMessage) m.videoMessage.viewOnce = false;

      // Envoi du média déballé dans le chat privé de l'utilisateur
      await socket.sendMessage(recipientJid, {
        forward: {
          key: {
            remoteJid: from,
            fromMe: false,
            id: msg.key?.id || `SAVE_${Date.now()}`
          },
          message: m
        }
      });

      // Réaction de confirmation
      if (msg.key && msg.key.remoteJid) {
        try {
          await socket.sendMessage(from, {
            react: { text: '💾', key: msg.key }
          });
        } catch (e) {}
      }

    } catch (err) {
      console.error('[SAVE PLUGIN ERROR]', err);
      await socket.sendMessage(from, { text: `❌ Impossible de sauvegarder le message : ${err.message}` }, { quoted: msg });
    }
  }
};
