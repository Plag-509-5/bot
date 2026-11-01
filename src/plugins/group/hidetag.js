const { getParticipantMentionJid } = require('../../services/group-admins');

module.exports = {
  name: 'hidetag',
  alias: ['h', 'htag', 'notify'],
  category: 'group',
  description: 'Envoie un message en mentionnant tout le monde de manière invisible',
  usage: '.hidetag <votre message>',
  isGroup: true,
  isAdmin: true,
  async execute({ socket, msg, from, args = [] }) {
    const text = args.join(' ');
    if (!text) {
      return await socket.sendMessage(from, { text: '📝 *Usage :* `.hidetag Réunion importante ce soir !`' }, { quoted: msg });
    }

    const metadata = await socket.groupMetadata(from).catch(() => null);
    if (!Array.isArray(metadata?.participants)) {
      await socket.sendMessage(from, {
        text: '⚠️ Impossible de récupérer les participants du groupe. Réessayez dans un instant.'
      }, { quoted: msg });
      return;
    }

    const mentions = metadata.participants.map(getParticipantMentionJid).filter(Boolean);
    await socket.sendMessage(from, {
      text,
      mentions
    }, { quoted: msg });
  }
};
