'use strict';

const { getGroupSettings, updateGroupSetting } = require('../handlers/welcome_goodbye');

function createWelcomeGoodbyeCommand(goodbye = false) {
  return async function execute({ socket, msg, from, args = [], prefix = '.' }) {
    const title = goodbye ? 'Au revoir' : 'Bienvenue';
    const field = goodbye ? 'goodbyeEnabled' : 'welcomeEnabled';
    const templateField = goodbye ? 'goodbyeTemplate' : 'welcomeTemplate';
    const featureCommand = goodbye ? 'goodbye' : 'welcome';
    const action = String(args[0] || '').toLowerCase();
    try {
      if (action === 'on' || action === 'off') {
        await updateGroupSetting(from, field, action === 'on');
        return socket.sendMessage(from, { text: `${action === 'on' ? '✅' : '❌'} Messages « ${title} » ${action === 'on' ? 'activés' : 'désactivés'} pour ce groupe.` }, { quoted: msg });
      }
      if (action === 'status' || action === 'état' || action === 'etat') {
        const settings = await getGroupSettings(from);
        const enabled = Boolean(settings[field]);
        return socket.sendMessage(from, { text: `🐉 *KAIDO — ${title.toUpperCase()}*\nÉtat : ${enabled ? 'activé ✅' : 'désactivé ❌'}\nMessage personnalisé : ${settings[templateField] ? 'oui' : 'non'}` }, { quoted: msg });
      }
      if (action === 'set' || action === 'message') {
        const template = args.slice(1).join(' ').trim();
        if (!template) {
          return socket.sendMessage(from, { text: `Indique un modèle : ${prefix}${featureCommand} set Bienvenue {user} dans {group} !\nVariables : {user}, {userName}, {group}` }, { quoted: msg });
        }
        await updateGroupSetting(from, templateField, template);
        return socket.sendMessage(from, { text: `✅ Message personnalisé « ${title} » enregistré.` }, { quoted: msg });
      }
      if (action === 'reset' || action === 'réinitialiser' || action === 'reinitialiser') {
        await updateGroupSetting(from, templateField, null);
        return socket.sendMessage(from, { text: `♻️ Message « ${title} » rétabli au modèle Kaido.` }, { quoted: msg });
      }
      return socket.sendMessage(from, { text: `🐉 *KAIDO — ${title.toUpperCase()}*\n${prefix}${featureCommand} on|off\n${prefix}${featureCommand} status\n${prefix}${featureCommand} set <message>\n${prefix}${featureCommand} reset` }, { quoted: msg });
    } catch (error) {
      console.error(`[${featureCommand.toUpperCase()} COMMAND ERROR]`, error?.message || error);
      return socket.sendMessage(from, { text: `❌ Impossible de modifier les messages « ${title} ». Vérifie la connexion MongoDB puis réessaie.` }, { quoted: msg });
    }
  };
}

module.exports = { createWelcomeGoodbyeCommand };
