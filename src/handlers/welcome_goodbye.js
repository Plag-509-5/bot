// welcome_goodbye.js
// Gestion des messages de bienvenue et d'au revoir par groupe
// Thème stylé "Kaido" — mentionne l'utilisateur et le nom du groupe
// Les messages par défaut sont construits dynamiquement (pas de placeholders dans les constantes)

const { getParticipantId, getParticipantMentionJid } = require('../services/group-admins');

let initMongoProvider = null;
let getDbProvider = null;

function configureWelcomeGoodbyeStorage({ initMongo, getDb } = {}) {
  initMongoProvider = typeof initMongo === 'function' ? initMongo : null;
  getDbProvider = typeof getDb === 'function' ? getDb : null;
}

async function getSettingsCollection() {
  if (!initMongoProvider || !getDbProvider) {
    throw new Error('Le stockage MongoDB Welcome/Goodbye n’est pas configuré.');
  }
  await initMongoProvider();
  const db = getDbProvider();
  if (!db) throw new Error('La base MongoDB Welcome/Goodbye n’est pas disponible.');
  return db.collection('group_welcome_goodbye');
}

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
  const col = await getSettingsCollection();
  const doc = await col.findOne({ groupId });
  return doc || {
    groupId,
    welcomeEnabled: false,
    goodbyeEnabled: false,
    welcomeTemplate: null,
    goodbyeTemplate: null
  };
}

async function updateGroupSetting(groupId, field, value) {
  const allowedFields = new Set(['welcomeEnabled', 'goodbyeEnabled', 'welcomeTemplate', 'goodbyeTemplate']);
  if (!allowedFields.has(field)) throw new Error(`Réglage Welcome/Goodbye inconnu : ${field}`);
  const col = await getSettingsCollection();
  await col.updateOne(
    { groupId },
    { $set: { [field]: value, updatedAt: new Date() } },
    { upsert: true }
  );
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
      const userJid = typeof participant === 'string'
        ? participant
        : (getParticipantMentionJid(participant) || getParticipantId(participant));
      if (!userJid) continue;
      const userName = userJid.split('@')[0];

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
  configureWelcomeGoodbyeStorage,
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