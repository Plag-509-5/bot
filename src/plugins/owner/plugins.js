const { loadPlugins, getAllPluginsList } = require('../../core/pluginLoader');

module.exports = {
  name: 'plugins',
  alias: ['pluginlist', 'modules', 'reload'],
  category: 'owner',
  description: 'Affiche la liste des plugins chargés (Rechargement automatique actif)',
  usage: '.plugins ou .reload',
  isOwner: true,
  async execute({ socket, msg, from, command }) {
    if (command === 'reload') {
      const start = Date.now();
      loadPlugins(false);
      const time = Date.now() - start;
      const count = getAllPluginsList().length;
      return await socket.sendMessage(from, {
        text: `🔄 *Rechargement forcé terminé !*\n✅ *${count}* plugins rechargés en ${time} ms.\n\n_Note : Le rechargement est déjà 100% automatique lors de l'enregistrement d'un fichier._`
      }, { quoted: msg });
    }

    const list = getAllPluginsList();
    let text = `📦 *PLUGINS INSTALLÉS (${list.length}) :*\n⚡ *Mode Auto-Reload :* ACTIF\n\n`;
    list.forEach((p, i) => {
      text += `${i + 1}. *${p.name}* [${p.category}] - ${p.description}\n`;
    });

    await socket.sendMessage(from, { text }, { quoted: msg });
  }
};
