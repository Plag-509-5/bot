'use strict';

const os = require('os');
const {
  bold,
  italic,
  oniHeader,
  oniFooter,
  sectionHeader,
  isOniThemeEnabled
} = require('../../services/oni-theme');

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${days ? `${days}j ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${secs}s`;
}

function buildClassicPingText(latency, activeCount = 1) {
  const usedRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const totalRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  return `╭───「 ⚡ *KAIDO SPEED* 」───\n` +
    `│ ⏱️ *Vitesse :* ${latency} ms\n` +
    `│ ⏱️ *Uptime :* ${formatUptime(process.uptime())}\n` +
    `│ 📊 *RAM :* ${usedRam} MB / ${totalRam} GB\n` +
    `│ 🤖 *Sessions Actives :* ${activeCount}\n` +
    `│ 🖥️ *OS :* ${os.platform()} (${os.arch()})\n` +
    `│ 🌐 *Node :* ${process.version}\n` +
    '╰─────────────────────────☉';
}

function buildPingText(latency) {
  return `${oniHeader('PING RESULT')}\n\n` +
    `${sectionHeader('LATENCE', '⛩')}\n\n` +
    `   ❈  ${bold('RESPONSE')}  ⟿   ${bold(`${latency}ms`)}\n` +
    `   ❈  ${bold('STATUS')}    ⟿   ⧉ ${italic('ONLINE')} ⧉\n\n` +
    `${oniFooter('KAIDO MD')}`;
}

module.exports = {
  name: 'ping',
  alias: ['p', 'speed', 'latency', 'pong'],
  category: 'general',
  description: 'Affiche le temps de réponse dans le thème Onigashima',
  usage: '.ping',
  async execute({ socket, msg, from, sessionCfg = {}, activeSockets }) {
    const oniEnabled = isOniThemeEnabled(sessionCfg.THEME);
    const start = process.hrtime.bigint();
    const waitingText = oniEnabled
      ? `${oniHeader('PING ANALYSE')}\n\n${sectionHeader('LATENCE', '⛩')}\n\n   ❈  ${italic('CALCUL EN COURS')}...`
      : '⚡ *Calcul de la vitesse...*';
    const sentMessage = await socket.sendMessage(from, { text: waitingText }, { quoted: msg });
    const latency = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const text = oniEnabled
      ? buildPingText(latency)
      : buildClassicPingText(latency, activeSockets?.size || 1);

    if (sentMessage?.key) {
      await socket.sendMessage(from, { text, edit: sentMessage.key });
    } else {
      await socket.sendMessage(from, { text }, { quoted: msg });
    }
  },
  _test: { buildPingText, buildClassicPingText, formatUptime }
};
