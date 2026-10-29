const {
  findGroupParticipant,
  getAdminParticipants,
  getParticipantId,
  getParticipantMentionJid,
  isBotAdmin,
  isBotIdentity,
  isGroupAdmin,
  isGroupSuperAdmin
} = require('../../services/group-admins');

function getContextInfo(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.stickerMessage?.contextInfo
    || msg?.message?.imageMessage?.contextInfo
    || msg?.message?.videoMessage?.contextInfo
    || {};
}

module.exports = {
  name: 'kick',
  alias: ['expulser', 'promote', 'demote', 'mute', 'unmute', 'grouplink', 'linkgc', 'admins'],
  category: 'group',
  description: 'Commandes administratives de groupe (kick, promote, demote, mute, unmute, grouplink, admins)',
  usage: '.kick @user, .promote @user, .demote @user, .mute, .unmute, .grouplink, .admins',
  isGroup: true,
  isAdmin: true,
  isBotAdmin: true,
  async execute({ socket, msg, from, args = [], command, quotedSender }) {
    let groupMeta;
    try {
      groupMeta = await socket.groupMetadata(from);
    } catch (error) {
      await socket.sendMessage(from, {
        text: '⚠️ Impossible de vérifier les administrateurs du groupe. Réessayez dans un instant.'
      }, { quoted: msg });
      return;
    }

    if (!Array.isArray(groupMeta?.participants)) {
      await socket.sendMessage(from, {
        text: '⚠️ Impossible de vérifier les administrateurs du groupe. Réessayez dans un instant.'
      }, { quoted: msg });
      return;
    }
    if (!isBotAdmin(groupMeta, socket)) {
      await socket.sendMessage(from, {
        text: '⚠️ Le bot doit être administrateur du groupe pour effectuer cette action.'
      }, { quoted: msg });
      return;
    }

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
      const admins = getAdminParticipants(groupMeta).map(getParticipantMentionJid).filter(Boolean);
      let text = `👑 *ADMINISTRATEURS DU GROUPE (${admins.length}) :*\n\n`;
      admins.forEach((jid, index) => {
        text += `${index + 1}. @${jid.split('@')[0]}\n`;
      });
      return await socket.sendMessage(from, { text, mentions: admins }, { quoted: msg });
    }

    const contextInfo = getContextInfo(msg);
    const toArray = value => Array.isArray(value) ? value : value ? [value] : [];
    const mentioned = toArray(contextInfo.mentionedJid);
    const mentionedAlt = toArray(contextInfo.mentionedJidAlt);
    const targetIdentifiers = [
      quotedSender,
      contextInfo.participant,
      contextInfo.participantAlt,
      ...mentioned,
      ...mentionedAlt,
      msg?.quoted?.sender
    ].filter(Boolean);

    if (!targetIdentifiers.length) {
      return await socket.sendMessage(from, {
        text: `❌ *Veuillez mentionner un utilisateur ou répondre à son message.* (Ex: .${command} @user)`
      }, { quoted: msg });
    }

    const targetParticipant = findGroupParticipant(groupMeta, targetIdentifiers);
    if (!targetParticipant) {
      return await socket.sendMessage(from, {
        text: '❌ *Cette personne ne fait pas partie de ce groupe.*'
      }, { quoted: msg });
    }

    const targetJid = getParticipantId(targetParticipant);
    const targetMentionJid = getParticipantMentionJid(targetParticipant) || targetJid;
    if (!targetJid || isBotIdentity(socket, targetParticipant)) {
      return await socket.sendMessage(from, {
        text: '❌ *Je ne peux pas exécuter cette action sur le compte du bot.*'
      }, { quoted: msg });
    }

    const userNum = targetMentionJid.split('@')[0];

    if (command === 'kick' || command === 'expulser') {
      if (isGroupAdmin(groupMeta, targetParticipant)) {
        return await socket.sendMessage(from, { text: '❌ Impossible de retirer un administrateur avec cette commande.' }, { quoted: msg });
      }
      await socket.groupParticipantsUpdate(from, [targetJid], 'remove');
      await socket.sendMessage(from, { text: `👋 @${userNum} a été retiré du groupe.`, mentions: [targetMentionJid] }, { quoted: msg });
    } else if (command === 'promote') {
      if (isGroupAdmin(groupMeta, targetParticipant)) {
        return await socket.sendMessage(from, { text: '❌ Cette personne est déjà administratrice.' }, { quoted: msg });
      }
      if (!isGroupSuperAdmin(groupMeta, socket)) {
        return await socket.sendMessage(from, { text: '❌ Le bot doit être super-administrateur pour promouvoir un membre.' }, { quoted: msg });
      }
      await socket.groupParticipantsUpdate(from, [targetJid], 'promote');
      await socket.sendMessage(from, { text: `👑 @${userNum} est désormais administrateur du groupe.`, mentions: [targetMentionJid] }, { quoted: msg });
    } else if (command === 'demote') {
      if (!isGroupAdmin(groupMeta, targetParticipant)) {
        return await socket.sendMessage(from, { text: '❌ Cette personne n\'est pas administratrice.' }, { quoted: msg });
      }
      if (!isGroupSuperAdmin(groupMeta, socket)) {
        return await socket.sendMessage(from, { text: '❌ Le bot doit être super-administrateur pour rétrograder un membre.' }, { quoted: msg });
      }
      await socket.groupParticipantsUpdate(from, [targetJid], 'demote');
      await socket.sendMessage(from, { text: `📉 @${userNum} n'est plus administrateur.`, mentions: [targetMentionJid] }, { quoted: msg });
    }
  }
};
