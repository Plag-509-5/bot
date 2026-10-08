module.exports = {
  name: 'broadcast',
  alias: ['bc', 'diffusion', 'bcall'],
  category: 'owner',
  description: 'Diffuse une annonce à toutes les sessions actives ou tous les groupes',
  usage: '.broadcast <votre annonce>',
  isOwner: true,
  async execute({ socket, msg, from, args, activeSockets }) {
    const text = args.join(' ');
    if (!text) {
      return await socket.sendMessage(from, { text: '📢 *Usage :* `.broadcast Bonjour à tous !`' }, { quoted: msg });
    }

    const broadcastMessage = `📢 *DIFFUSION OFFICIELLE — KAIDO-MD* 👑\n\n${text}\n\n> © Mugiwara no plag`;

    let count = 0;
    if (activeSockets && activeSockets.size > 0) {
      for (const [number, sock] of activeSockets.entries()) {
        try {
          const userJid = `${number}@s.whatsapp.net`;
          await sock.sendMessage(userJid, { text: broadcastMessage });
          count++;
        } catch (e) {}
      }
    }

    await socket.sendMessage(from, {
      text: `✅ *Diffusion envoyée avec succès à ${count} session(s) active(s).*`
    }, { quoted: msg });
  }
};
