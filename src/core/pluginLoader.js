const fs = require('fs');
const path = require('path');
const {
  isBotAdmin: isBotGroupAdmin,
  isGroupAdmin
} = require('../services/group-admins');

let pluginsMap = new Map();
let uniquePlugins = new Map();
let isWatching = false;
let debounceTimer = null;

/**
 * Scan a directory recursively for .js plugin files
 */
function getPluginFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getPluginFiles(fullPath));
      } else if (file.endsWith('.js')) {
        results.push(fullPath);
      }
    } catch (e) {}
  }
  return results;
}

/**
 * Setup automatic hot-reloading file watcher on plugins folder
 */
function setupAutoWatcher(pluginDir) {
  if (isWatching) return;
  isWatching = true;

  try {
    fs.watch(pluginDir, { recursive: true }, (eventType, filename) => {
      if (filename && !filename.endsWith('.js')) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`🔄 [Auto-Reload] Modification détectée (${filename || 'plugin'}). Rechargement automatique des plugins...`);
        loadPlugins(false);
      }, 300);
    });
    console.log('👀 [Auto-Reload] Surveillance en temps réel active sur le dossier plugins/.');
  } catch (err) {
    console.warn('⚠️ Impossible d\'activer fs.watch récursif, surveillance manuelle:', err.message);
  }
}

/**
 * Load all plugins from the ./plugins directory
 * @param {boolean} [initWatcher=true] Whether to initialize the watcher
 */
function loadPlugins(initWatcher = true) {
  const newPluginsMap = new Map();
  const newUniquePlugins = new Map();
  const pluginDir = path.join(__dirname, '..', 'plugins');

  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
    console.log('📁 Dossier plugins créé.');
  }

  const files = getPluginFiles(pluginDir);
  let loadedCount = 0;

  for (const filePath of files) {
    try {
      // Clear require cache for hot reloading
      try {
        delete require.cache[require.resolve(filePath)];
      } catch (e) {}

      const plugin = require(filePath);

      if (plugin && plugin.name && typeof plugin.execute === 'function') {
        const primaryName = Array.isArray(plugin.name) ? plugin.name[0] : plugin.name;
        const aliases = Array.isArray(plugin.name) 
          ? plugin.name 
          : [plugin.name, ...(Array.isArray(plugin.alias) ? plugin.alias : plugin.alias ? [plugin.alias] : [])];

        const pluginMeta = {
          name: primaryName.toLowerCase(),
          aliases: aliases.map(a => a.toLowerCase()),
          category: plugin.category || 'general',
          description: plugin.description || 'Aucune description',
          usage: plugin.usage || `.${primaryName}`,
          isOwner: Boolean(plugin.isOwner),
          isGroup: Boolean(plugin.isGroup),
          isAdmin: Boolean(plugin.isAdmin),
          isBotAdmin: Boolean(plugin.isBotAdmin),
          execute: plugin.execute,
          filePath
        };

        newUniquePlugins.set(pluginMeta.name, pluginMeta);

        for (const alias of pluginMeta.aliases) {
          newPluginsMap.set(alias.toLowerCase(), pluginMeta);
        }
        loadedCount++;
      }
    } catch (err) {
      console.error(`❌ Erreur chargement plugin (${path.basename(filePath)}):`, err.message || err);
    }
  }

  pluginsMap = newPluginsMap;
  uniquePlugins = newUniquePlugins;

  console.log(`✅ ${loadedCount} plugins chargés avec succès (${pluginsMap.size} commandes/alias).`);

  if (initWatcher && !isWatching) {
    setupAutoWatcher(pluginDir);
  }

  return pluginsMap;
}

/**
 * Get all unique plugins grouped by category
 */
function getPluginsByCategory() {
  const categories = {
    general: [],
    tools: [],
    ai: [],
    download: [],
    group: [],
    owner: []
  };

  for (const plugin of uniquePlugins.values()) {
    const cat = (plugin.category || 'general').toLowerCase();
    if (!categories[cat]) {
      categories[cat] = [];
    }
    categories[cat].push(plugin);
  }

  return categories;
}

/**
 * Get all unique loaded plugins
 */
function getAllPluginsList() {
  return Array.from(uniquePlugins.values());
}

function hasOwnerCommandAccess(context = {}) {
  return Boolean(context.isOwner || context.isSessionOwner || context.isSudo);
}

/**
 * Helper to execute a plugin with permission checks
 */
async function executePlugin(commandName, context) {
  const cmd = (commandName || '').toLowerCase().trim();
  const plugin = pluginsMap.get(cmd);
  if (!plugin) return false;

  const { socket, msg, from, sender, isOwner, isSessionOwner, isSudo } = context;

  // Un sudo est un opérateur délégué uniquement pour sa session. Les admins
  // Mongo ne deviennent pas implicitement propriétaires de toutes les commandes.
  const ownerCommandAccess = hasOwnerCommandAccess({ isOwner, isSessionOwner, isSudo });

  // 1. Check Owner Only
  if (plugin.isOwner && !ownerCommandAccess) {
    await socket.sendMessage(from, { text: '⛔ *Cette commande est réservée au propriétaire ou à un sudo de cette session.*' }, { quoted: msg });
    return true;
  }

  // 2. Check Group Only
  const isGroup = from && from.endsWith('@g.us');
  if (plugin.isGroup && !isGroup) {
    await socket.sendMessage(from, { text: '👥 *Cette commande doit être utilisée dans un groupe WhatsApp.*' }, { quoted: msg });
    return true;
  }

  // 3. Check Group Admin Permissions. Fail closed: without fresh metadata, never
  // execute a command whose permissions could not be verified.
  if (isGroup && (plugin.isAdmin || plugin.isBotAdmin)) {
    let groupMetadata = null;
    try {
      groupMetadata = await socket.groupMetadata(from);
    } catch (error) {
      console.warn('[PLUGIN PERMISSION CHECK ERROR]', error?.message || error);
    }

    if (!Array.isArray(groupMetadata?.participants)) {
      await socket.sendMessage(from, {
        text: '⚠️ *Impossible de vérifier les administrateurs du groupe. Réessayez dans un instant.*'
      }, { quoted: msg });
      return true;
    }

    const senderIds = [
      sender,
      msg?.key?.participant,
      msg?.key?.participantAlt,
      msg?.key?.remoteJidAlt
    ].filter(Boolean);
    const userIsAdmin = isGroupAdmin(groupMetadata, senderIds);
    const botIsAdmin = isBotGroupAdmin(groupMetadata, socket);

    if (plugin.isAdmin && !userIsAdmin && !ownerCommandAccess) {
      await socket.sendMessage(from, {
        text: '❌ *Seuls les administrateurs du groupe peuvent exécuter cette commande.*'
      }, { quoted: msg });
      return true;
    }

    if (plugin.isBotAdmin && !botIsAdmin) {
      await socket.sendMessage(from, {
        text: '⚠️ *Le bot doit être administrateur du groupe pour effectuer cette action.*'
      }, { quoted: msg });
      return true;
    }
  }

  // Extract quoted message context if available across message types
  const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    || msg.message?.stickerMessage?.contextInfo?.quotedMessage
    || msg.message?.imageMessage?.contextInfo?.quotedMessage
    || msg.message?.videoMessage?.contextInfo?.quotedMessage
    || msg.quoted?.msg
    || null;

  const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant
    || msg.message?.stickerMessage?.contextInfo?.participant
    || msg.message?.imageMessage?.contextInfo?.participant
    || msg.quoted?.sender
    || null;

  // Execute
  try {
    await plugin.execute({
      ...context,
      quoted: quotedMsg,
      quotedMsg,
      quotedSender,
      plugin,
      plugins: pluginsMap,
      getPluginsByCategory,
      getAllPluginsList
    });
    return true;
  } catch (err) {
    console.error(`❌ Erreur dans le plugin ${cmd}:`, err);
    await socket.sendMessage(from, {
      text: `❌ *Une erreur est survenue lors de l'exécution de la commande (${cmd}) :*\n_${err.message || err}_`
    }, { quoted: msg });
    return true;
  }
}

module.exports = {
  loadPlugins,
  getPlugins: () => pluginsMap,
  getAllPluginsList,
  getPluginsByCategory,
  executePlugin,
  _test: { hasOwnerCommandAccess }
};
