module.exports = {
  name: 'alive',
  alias: ['bot', 'botstatus', 'statusbot'],
  category: 'general',
  description: 'Vérifie si le bot fonctionne correctement',
  usage: '.alive',
  async execute({ socket, msg, from, config, sessionCfg, prefix }) {
    const botName = sessionCfg?.botName || config?.BOT_NAME || 'KAIDO-MD';
    const ownerName = config?.OWNER_NAME || 'Mugiwara no plag';
    const version = config?.BOT_VERSION || '2.0.0';

    const text = `╭───「 🌟 *STATUS : EN LIGNE* 」───
│ 🤖 *Bot :* ${botName}
│ 🏷️ *Version :* v${version}
│ 👑 *Owner :* ${ownerName}
│ ⚡ *Statut :* Opérationnel & 100% Fonctionnel
│ 💬 *Tapez :* \`${prefix}menu\` pour afficher les commandes
╰─────────────────────────☉
> ${config?.BOT_FOOTER || 'Kaido-MD'}`;

    const imageUrl = sessionCfg?.logo || config?.IMAGE_PATH || 'https://files.catbox.moe/l1lzbx.png';

    try {
      if (imageUrl && imageUrl.startsWith('http')) {
        await socket.sendMessage(from, { image: { url: imageUrl }, caption: text }, { quoted: msg });
      } else {
        await socket.sendMessage(from, { text }, { quoted: msg });
      }
    } catch (e) {
      await socket.sendMessage(from, { text }, { quoted: msg });
    }
  }
};
