const util = require('util');
const { exec } = require('child_process');

module.exports = {
  name: 'eval',
  alias: ['ev', 'js', 'sh', 'exec'],
  category: 'owner',
  description: 'Évalue du code JavaScript ou exécute une commande système (Owner Only)',
  usage: '.eval <code javascript> ou .sh <commande>',
  isOwner: true,
  async execute({ socket, msg, from, args, body, command }) {
    if (command === 'sh' || command === 'exec') {
      const cmd = args.join(' ');
      if (!cmd) return await socket.sendMessage(from, { text: '💻 *Usage :* `.sh ls -la`' }, { quoted: msg });

      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          return socket.sendMessage(from, { text: `❌ *Erreur :*\n\`\`\`${err.message}\`\`\`` }, { quoted: msg });
        }
        if (stderr) {
          return socket.sendMessage(from, { text: `⚠️ *Stderr :*\n\`\`\`${stderr}\`\`\`` }, { quoted: msg });
        }
        socket.sendMessage(from, { text: `🖥️ *Résultat :*\n\`\`\`${stdout || 'Commande exécutée sans sortie.'}\`\`\`` }, { quoted: msg });
      });
      return;
    }

    // JS Eval
    const code = args.join(' ');
    if (!code) return await socket.sendMessage(from, { text: '💻 *Usage :* `.eval 2 + 2`' }, { quoted: msg });

    try {
      let evaled = await eval(code);
      if (typeof evaled !== 'string') evaled = util.inspect(evaled, { depth: 2 });
      await socket.sendMessage(from, { text: `💻 *Résultat :*\n\`\`\`javascript\n${evaled}\n\`\`\`` }, { quoted: msg });
    } catch (err) {
      await socket.sendMessage(from, { text: `❌ *Erreur Eval :*\n\`\`\`${err.message || err}\`\`\`` }, { quoted: msg });
    }
  }
};
