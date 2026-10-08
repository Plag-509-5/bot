module.exports = {
  name: 'tagall',
  alias: ['everyone', 'tous'],
  category: 'group',
  description: 'Mentionne tous les participants du groupe avec un message',
  usage: '.tagall [votre message]',
  isGroup: true,
  isAdmin: true,
  async execute({ socket, msg, from, args }) {
    const metadata = await socket.groupMetadata(from).catch(() => null);
    if (!metadata) return;

    const participants = metadata.participants || [];
    const messageText = args.join(' ') || 'Attentions à tous !';

    const mentions = participants.map(p => p.id);
    let tagList = '';

    participants.forEach((p, idx) => {
      const num = p.id.split('@')[0];
      tagList += `│ ${idx + 1}. @${num}\n`;
    });

    const fullMessage = `╭───「 📢 *TAG ALL* 」───
│ 👥 *Groupe :* ${metadata.subject}
│ 💬 *Message :* ${messageText}
│ 📊 *Membres :* ${participants.length}
├───「 📋 *LISTE DES MEMBRES* 」
${tagList}╰─────────────────────────☉
> 𝐊𝐀𝐈𝐃𝐎-𝐌𝐃 🐉`;

    await socket.sendMessage(from, {
      text: fullMessage,
      mentions
    }, { quoted: msg });
  }
};
