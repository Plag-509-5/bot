const {
  getPrimaryStickerHash,
  setStickerCommand,
  deleteStickerCommand,
  getAllStickerCommands
} = require('../../features/sticker_cmd');

const {
  isEmoji,
  setReactionCommand,
  deleteReactionCommand,
  getAllReactionCommands
} = require('../../features/reaction_cmd');

module.exports = {
  name: 'setcmd',
  alias: ['setsticker', 'setreact', 'stickercmd', 'reactcmd', 'delcmd', 'delreact', 'listcmd', 'cmdlist'],
  category: 'tools',
  description: 'Associe un sticker OU une réaction emoji à une commande (ex: .setcmd save, ✅ ou en répondant à un sticker)',
  usage: '.setcmd <commande>, <emoji> | .setcmd <commande> (en répondant à un sticker) | .delcmd | .listcmd',
  async execute({ socket, msg, from, sender, senderNumber, sessionNumber, args, command, prefix, quotedMsg }) {
    const quoted = quotedMsg 
      || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      || msg.message?.stickerMessage?.contextInfo?.quotedMessage;

    const stickerMsg = quoted?.stickerMessage 
      || (quoted?.viewOnceMessage?.message?.stickerMessage) 
      || msg.message?.stickerMessage;

    const rawArgs = args.join(' ').trim();

    // ── 1. COMMANDE DE LISTING (.listcmd / .cmdlist) ──
    if (command === 'listcmd' || command === 'cmdlist') {
      const stickerList = getAllStickerCommands(sessionNumber);
      const reactList = getAllReactionCommands(sessionNumber);

      if (!stickerList.length && !reactList.length) {
        return await socket.sendMessage(from, {
          text: `📭 *Aucun alias enregistré.*\n\n💡 *Pour en créer :*\n• *Réaction Emoji :* \`${prefix}setcmd save, ✅\`\n• *Sticker :* Répondez à un sticker avec \`${prefix}setcmd ping\``
        }, { quoted: msg });
      }

      let text = `╭───「 🧩 *ALIAS & RACCOURCIS DU BOT* 」───\n`;

      if (reactList.length > 0) {
        text += `│\n├──「 ✨ *RÉACTIONS EMOJIS (${reactList.length})* 」\n`;
        reactList.forEach((item, idx) => {
          text += `│ ${idx + 1}. Réaction ${item.emoji} ➔ \`${prefix}${item.command}\`\n`;
        });
      }

      if (stickerList.length > 0) {
        text += `│\n├──「 🎨 *STICKERS COMMANDES (${stickerList.length})* 」\n`;
        stickerList.forEach((item, idx) => {
          text += `│ ${idx + 1}. Sticker \`${item.hash.substring(0, 10)}...\` ➔ \`${prefix}${item.command}\`\n`;
        });
      }

      text += `│\n╰─────────────────────────☉\n> Tapez \`${prefix}delcmd <emoji|nom>\` pour supprimer un alias.`;

      return await socket.sendMessage(from, { text }, { quoted: msg });
    }

    // ── 2. COMMANDE DE SUPPRESSION (.delcmd / .delreact) ──
    if (command === 'delcmd' || command === 'delreact') {
      // Cas 1 : Suppression d'un sticker cité
      if (stickerMsg) {
        const hash = getPrimaryStickerHash(stickerMsg);
        if (hash) {
          const deleted = await deleteStickerCommand(hash, sessionNumber);
          if (deleted) {
            return await socket.sendMessage(from, { text: '🗑️ *Sticker commande supprimé avec succès !*' }, { quoted: msg });
          }
        }
      }

      // Cas 2 : Suppression par argument (Emoji ou nom de commande)
      const target = rawArgs.trim();
      if (!target) {
        return await socket.sendMessage(from, {
          text: `❌ *Usage :* \`${prefix}delcmd ✅\` ou \`${prefix}delcmd save\` ou répondez au sticker avec \`${prefix}delcmd\``
        }, { quoted: msg });
      }

      let deletedEmoji = false;
      let deletedSticker = false;

      if (isEmoji(target)) {
        deletedEmoji = await deleteReactionCommand(target, sessionNumber);
      } else {
        deletedEmoji = await deleteReactionCommand(target, sessionNumber);
        deletedSticker = await deleteStickerCommand(target, sessionNumber);
      }

      if (deletedEmoji || deletedSticker) {
        return await socket.sendMessage(from, {
          text: `🗑️ *Alias "${target}" supprimé avec succès !*`
        }, { quoted: msg });
      } else {
        return await socket.sendMessage(from, {
          text: `❌ Aucun alias trouvé pour "${target}".`
        }, { quoted: msg });
      }
    }

    // ── 3. COMMANDE D'ENREGISTREMENT (.setcmd / .setreact) ──

    // SCÉNARIO A : Association par STICKER (en répondant à un sticker)
    if (stickerMsg) {
      const targetCmd = rawArgs.replace(/^[./!#]/, '').trim();
      if (!targetCmd) {
        return await socket.sendMessage(from, {
          text: `❌ *Veuillez spécifier la commande à associer au sticker.* (Ex: \`${prefix}setcmd ping\`)`
        }, { quoted: msg });
      }

      const hash = getPrimaryStickerHash(stickerMsg);
      if (!hash) {
        return await socket.sendMessage(from, { text: '❌ Impossible d\'extraire l\'identifiant de ce sticker.' }, { quoted: msg });
      }

      await setStickerCommand(hash, targetCmd, senderNumber, sessionNumber);

      return await socket.sendMessage(from, {
        text: `╭───「 🎨 *STICKER COMMANDE ACTIVÉ* 」───
│ 🎯 *Commande liée :* \`${prefix}${targetCmd}\`
│ 🔑 *Hash :* \`${hash.substring(0, 16)}...\`
│ 👤 *Configuré par :* @${senderNumber}
╰─────────────────────────☉

🎉 *Envoyez ce sticker dans n'importe quel chat pour déclencher .${targetCmd} !*`,
        mentions: [sender]
      }, { quoted: msg });
    }

    // SCÉNARIO B : Association par RÉACTION EMOJI (.setcmd save, ✅ ou .setcmd save ✅)
    let targetEmoji = null;
    let targetCommand = null;

    if (rawArgs.includes(',')) {
      const parts = rawArgs.split(',').map(s => s.trim());
      if (isEmoji(parts[1])) {
        targetCommand = parts[0];
        targetEmoji = parts[1];
      } else if (isEmoji(parts[0])) {
        targetCommand = parts[1];
        targetEmoji = parts[0];
      }
    } else if (args.length >= 2) {
      // Recherche de l'emoji parmi les arguments
      for (let i = 0; i < args.length; i++) {
        if (isEmoji(args[i])) {
          targetEmoji = args[i];
          targetCommand = args.filter((_, idx) => idx !== i).join(' ');
          break;
        }
      }
    }

    if (targetEmoji && targetCommand) {
      targetCommand = targetCommand.replace(/^[./!#]/, '').trim();
      await setReactionCommand(targetEmoji, targetCommand, senderNumber, sessionNumber);

      return await socket.sendMessage(from, {
        text: `╭───「 ✨ *RÉACTION COMMANDE ACTIVÉE* 」───
│ 🔘 *Emoji Réaction :* ${targetEmoji}
│ 🎯 *Commande liée :* \`${prefix}${targetCommand}\`
│ 👤 *Configuré par :* @${senderNumber}
╰─────────────────────────☉

🎉 *C'est magique !* Réagissez désormais à *n'importe quel message* avec ${targetEmoji} pour exécuter automatiquement la commande \`${prefix}${targetCommand}\` en réponse à ce message !`,
        mentions: [sender]
      }, { quoted: msg });
    }

    // Guide d'aide si arguments invalides
    return await socket.sendMessage(from, {
      text: `╭───「 💡 *GUIDE D'UTILISATION SETCMD* 」───
│
│ 1️⃣ *Associer une Réaction Emoji :*
│    \`${prefix}setcmd save, ✅\`
│    \`${prefix}setcmd tourl, 📤\`
│    \`${prefix}setcmd s, 🎨\`
│    \`${prefix}setcmd tr en, 🌐\`
│
│ 2️⃣ *Associer un Sticker :*
│    Répondez à un sticker avec \`${prefix}setcmd ping\`
│
│ 3️⃣ *Consulter la liste :*
│    \`${prefix}listcmd\`
│
╰─────────────────────────☉`
    }, { quoted: msg });
  }
};
