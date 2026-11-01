'use strict';

const os = require('os');

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${days ? `${days}j ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${secs}s`;
}

function buildPingText(latency, activeCount = 1) {
  const usedRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const totalRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  return `╭───「 ⚡ *KAIDO SPEED* 」───\n` +
    `│ ⏱️ *Vitesse :* ${latency} ms\n` +
    `│ ⏱️ *Uptime :* ${formatUptime(process.uptime())}\n` +
    `│ 📊 *RAM :* ${usedRam} MB / ${totalRam} GB\n` +
    `│ 🤖 *Sessions actives :* ${activeCount}\n` +
    `│ 🖥️ *OS :* ${os.platform()} (${os.arch()})\n` +
    `│ 🌐 *Node :* ${process.version}\n` +
    '╰─────────────────────────☉';
}

module.exports = {
  name: 'ping',
  alias: ['p', 'speed', 'latency', 'pong'],
  category: 'general',
  description: 'Affiche la vitesse et l’état du bot',
  usage: '.ping',
  async execute({ socket, msg, from, activeSockets }) {
    const startedAt = process.hrtime.bigint();
    const sentMessage = await socket.sendMessage(from, { text: '⚡ Calcul de la vitesse…' }, { quoted: msg });
    const latency = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    const text = buildPingText(latency, activeSockets?.size || 1);
    if (sentMessage?.key) await socket.sendMessage(from, { text, edit: sentMessage.key });
    else await socket.sendMessage(from, { text }, { quoted: msg });
  },
  _test: { buildPingText, formatUptime }
};
