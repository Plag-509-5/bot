module.exports = {
  name: 'kick',
  alias: ['expulser', 'promote', 'demote', 'mute', 'unmute', 'grouplink', 'linkgc', 'admins'],
  category: 'group',
  description: 'Commandes administratives de groupe (kick, promote, demote, mute, unmute, grouplink, admins)',
  usage: '.kick @user, .promote @user, .demote @user, .mute, .unmute, .grouplink, .admins',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  async execute({ socket, msg, from, args, command, quotedSender, quotedMsg }) {
    const quoted = quotedSender 
      || msg.message?.extendedTextMessage?.contextInfo?.participant
      || msg.message?.stickerMessage?.contextInfo?.participant
      || msg.message?.imageMessage?.contextInfo?.participant
      || msg.quoted?.sender;

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      || msg.message?.stickerMessage?.contextInfo?.mentionedJid?.[0];

    const targetUser = quoted || mentioned;

    const groupMeta = await socket.groupMetadata(from).catch(() => null);
    if (!groupMeta) return;

    if (command === 'mute' || command === 'fermer') {
      await socket.groupSettingUpdate(from, 'announcement');
      return await socket.sendMessage(from, { text: '🔒 *Le groupe a été fermé.* Seuls les administrateurs peuvent envoyer des messages.' }, { quoted: msg });
    }

    if (command === 'unmute' || command === 'ouvrir') {
      await socket.groupSettingUpdate(from, 'not_announcement');
      return await socket.sendMessage(from, { text: '🔓 *Le groupe a été ouvert.* Tous les membres peuvent envoyer des messages.' }, { quoted: msg });
    }

    if (command === 'grouplink' || command === 'linkgc') {
      const code = await socket.groupInviteCode(from);
      return await socket.sendMessage(from, { text: `🔗 *Lien du groupe :*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
    }

    if (command === 'admins') {
      const admins = groupMeta.participants.filter(p => p.admin).map(p => p.id);
      let text = `👑 *ADMINISTRATEURS DU GROUPE (${admins.length}) :*\n\n`;
      admins.forEach((a, i) => text += `${i + 1}. @${a.split('@')[0]}\n`);
      return await socket.sendMessage(from, { text, mentions: admins }, { quoted: msg });
    }

    // Action requiring a target user
    if (!targetUser) {
      return await socket.sendMessage(from, {
        text: `❌ *Veuillez mentionner un utilisateur ou répondre à son message.* (Ex: .${command} @user)`
      }, { quoted: msg });
    }

    const botNum = socket.user?.id ? socket.user.id.split(':')[0].split('@')[0] : '';
    const botJid = botNum ? `${botNum}@s.whatsapp.net` : null;

    if (targetUser === botJid) {
      return await socket.sendMessage(from, { text: '❌ *Je ne peux pas exécuter cette action sur moi-même.*' }, { quoted: msg });
    }

    const userNum = targetUser.split('@')[0];

    if (command === 'kick' || command === 'expulser') {
      await socket.groupParticipantsUpdate(from, [targetUser], 'remove');
      await socket.sendMessage(from, { text: `👋 @${userNum} a été retiré du groupe.`, mentions: [targetUser] }, { quoted: msg });
    } else if (command === 'promote') {
      await socket.groupParticipantsUpdate(from, [targetUser], 'promote');
      await socket.sendMessage(from, { text: `👑 @${userNum} est désormais administrateur du groupe.`, mentions: [targetUser] }, { quoted: msg });
    } else if (command === 'demote') {
      await socket.groupParticipantsUpdate(from, [targetUser], 'demote');
      await socket.sendMessage(from, { text: `📉 @${userNum} n'est plus administrateur.`, mentions: [targetUser] }, { quoted: msg });
    }
  }
};
