module.exports = {
  name: 'hidetag',
  alias: ['h', 'htag', 'notify'],
  category: 'group',
  description: 'Envoie un message en mentionnant tout le monde de manière invisible',
  usage: '.hidetag <votre message>',
  isGroup: true,
  isAdmin: true,
  async execute({ socket, msg, from, args }) {
    const text = args.join(' ');
    if (!text) {
      return await socket.sendMessage(from, { text: '📝 *Usage :* `.hidetag Réunion importante ce soir !`' }, { quoted: msg });
    }

    const metadata = await socket.groupMetadata(from).catch(() => null);
    if (!metadata) return;

    const participants = metadata.participants || [];
    const mentions = participants.map(p => p.id);

    await socket.sendMessage(from, {
      text,
      mentions
    });
  }
};
