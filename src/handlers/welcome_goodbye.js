// welcome_goodbye.js
// Gestion des messages de bienvenue et d'au revoir par groupe
// Thème stylé "Kaido" — mentionne l'utilisateur et le nom du groupe
// Les messages par défaut sont construits dynamiquement (pas de placeholders dans les constantes)

/**
 * Builders par défaut (Kaido theme)
 * Ces fonctions reçoivent les valeurs et retournent le texte final.
 */
function buildDefaultWelcome(userJid, userName, groupName) {
  return [
    "🐉 *KAIDO WELCOME* 🔥",
    "",
    `Bienvenue @${userName} dans *${groupName}* !`,
    "Pose ton ancre, présente-toi et amuse-toi.",
    "",
    "— *Kaido Crew* ⚓"
  ].join("\n");
}

function buildDefaultGoodbye(userJid, userName, groupName) {
  return [
    "💀 *KAIDO FAREWELL* ⚓",
    "",
    `@${userName} a quitté *${groupName}*.`,
    "Que les vents te soient favorables, pirate.",
    "",
    "— *Kaido Crew* 🔥"
  ].join("\n");
}

/**
 * Helpers MongoDB pour récupérer et stocker la configuration de chaque groupe.
 * Utilise la collection 'group_welcome_goodbye'.
 */
async function getGroupSettings(groupId) {
  try {
    // initMongo() doit être accessible globalement ou importé si nécessaire.
    if (typeof initMongo === 'function') await initMongo(); 
    
    const col = mongoDB.collection('group_welcome_goodbye');
    const doc = await col.findOne({ groupId: groupId });
    
    return doc || { 
      groupId: groupId, 
      welcomeEnabled: false, 
      goodbyeEnabled: false, 
      welcomeTemplate: null, 
      goodbyeTemplate: null 
    };
  } catch (e) {
    console.error('Erreur getGroupSettings MongoDB:', e);
    return { 
      groupId: groupId, 
      welcomeEnabled: false, 
      goodbyeEnabled: false, 
      welcomeTemplate: null, 
      goodbyeTemplate: null 
    };
  }
}

async function updateGroupSetting(groupId, field, value) {
  try {
    if (typeof initMongo === 'function') await initMongo();
    
    const col = mongoDB.collection('group_welcome_goodbye');
    await col.updateOne(
      { groupId: groupId },
      { $set: { [field]: value, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.error(`Erreur updateGroupSetting pour ${field}:`, e);
  }
}

/**
 * Toggle functions persistées sur MongoDB
 */
async function toggleWelcome(from, state) {
  await updateGroupSetting(from, 'welcomeEnabled', !!state);
}

async function toggleGoodbye(from, state) {
  await updateGroupSetting(from, 'goodbyeEnabled', !!state);
}

async function isWelcomeEnabled(from) {
  const settings = await getGroupSettings(from);
  return !!settings.welcomeEnabled;
}

async function isGoodbyeEnabled(from) {
  const settings = await getGroupSettings(from);
  return !!settings.goodbyeEnabled;
}

/**
 * Personnaliser les messages (optionnel)
 * Les templates personnalisés peuvent contenir {user}, {userName}, {group}
 */
async function setWelcomeTemplate(from, template) {
  const val = (typeof template === 'string' && template.trim()) ? template.trim() : null;
  await updateGroupSetting(from, 'welcomeTemplate', val);
}

async function setGoodbyeTemplate(from, template) {
  const val = (typeof template === 'string' && template.trim()) ? template.trim() : null;
  await updateGroupSetting(from, 'goodbyeTemplate', val);
}

/**
 * Remplace les placeholders dans un template string (si template custom fourni)
 */
function renderTemplateString(template, vars = {}) {
  return template
    .replace(/{user}/g, vars.user || '')
    .replace(/{userName}/g, vars.userName || '')
    .replace(/{group}/g, vars.group || '');
}

/**
 * Handler pour les événements de participants (add/remove)
 * update: objet Baileys group-participants.update
 */
async function handleParticipantUpdate(socket, from, update) {
  try {
    if (!update || !update.action) return;

    // Normaliser participants (compatibilité versions)
    const participants = Array.isArray(update.participants)
      ? update.participants
      : (update.participant ? [update.participant] : []);

    if (!participants.length) return;

    // Récupérer la configuration complète du groupe depuis MongoDB d'un coup seul coup
    const settings = await getGroupSettings(from);

    // Récupérer le nom du groupe (subject) si possible
    let groupName = '';
    try {
      const meta = await socket.groupMetadata(from);
      groupName = meta?.subject || from.split('@')[0];
    } catch (e) {
      groupName = from.split('@')[0];
    }

    for (const participant of participants) {
      const userJid = participant;
      const userName = (participant || '').split('@')[0];

      // JOIN (Vérification via MongoDB)
      if (update.action === 'add' && settings.welcomeEnabled) {
        // Si template custom string défini -> render, sinon utiliser builder par défaut
        const tpl = settings.welcomeTemplate;
        const text = tpl
          ? renderTemplateString(tpl, { user: `@${userName}`, userName, group: groupName })
          : buildDefaultWelcome(userJid, userName, groupName);

        await socket.sendMessage(from, {
          text,
          mentions: [userJid]
        });
      }

      // LEAVE / REMOVE (Vérification via MongoDB)
      if ((update.action === 'remove' || update.action === 'leave') && settings.goodbyeEnabled) {
        const tpl = settings.goodbyeTemplate;
        const text = tpl
          ? renderTemplateString(tpl, { user: `@${userName}`, userName, group: groupName })
          : buildDefaultGoodbye(userJid, userName, groupName);

        await socket.sendMessage(from, {
          text,
          mentions: [userJid]
        });
      }
    }
  } catch (err) {
    console.error('WELCOME_GOODBYE HANDLER ERROR', err);
  }
}

module.exports = {
  getGroupSettings,     // Ajouté aux exports au cas où vous en auriez besoin dans votre switch principal
  updateGroupSetting,   // Ajouté aux exports
  toggleWelcome,
  toggleGoodbye,
  isWelcomeEnabled,
  isGoodbyeEnabled,
  setWelcomeTemplate,
  setGoodbyeTemplate,
  handleParticipantUpdate
};