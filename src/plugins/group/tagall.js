const { getParticipantMentionJid } = require('../../services/group-admins');

module.exports = {
  name: 'tagall',
  alias: ['everyone', 'tous'],
  category: 'group',
  description: 'Mentionne tous les participants du groupe avec un message',
  usage: '.tagall [votre message]',
  isGroup: true,
  isAdmin: true,
  async execute({ socket, msg, from, args = [] }) {
    const metadata = await socket.groupMetadata(from).catch(() => null);
    if (!Array.isArray(metadata?.participants)) {
      await socket.sendMessage(from, {
        text: '⚠️ Impossible de récupérer les participants du groupe. Réessayez dans un instant.'
      }, { quoted: msg });
      return;
    }

    const mentions = metadata.participants.map(getParticipantMentionJid).filter(Boolean);
    const messageText = args.join(' ') || 'Attentions à tous !';
    const tagList = mentions
      .map((jid, index) => `│ ${index + 1}. @${jid.split('@')[0]}`)
      .join('\n');

    const fullMessage = `╭───「 📢 *TAG ALL* 」───
│ 👥 *Groupe :* ${metadata.subject || 'Sans nom'}
│ 💬 *Message :* ${messageText}
│ 📊 *Membres :* ${mentions.length}
├───「 📋 *LISTE DES MEMBRES* 」
${tagList}
╰─────────────────────────☉
> 𝐊𝐀𝐈𝐃𝐎-𝐌𝐃 🐉`;

    await socket.sendMessage(from, {
      text: fullMessage,
      mentions
    }, { quoted: msg });
  }
};
