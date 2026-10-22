'use strict';

const SECTIONS = [
  { key: 'download', title: '𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃', categories: ['download'] },
  { key: 'ai', title: '𝐀𝐈 & 𝐒𝐄𝐀𝐑𝐂𝐇', categories: ['ai'] },
  { key: 'group', title: '𝐆𝐑𝐎𝐔𝐏', categories: ['group'] },
  { key: 'owner', title: '𝐎𝐖𝐍𝐄𝐑', categories: ['owner'] },
  { key: 'bot', title: '𝐁𝐎𝐓', categories: ['general'] },
  { key: 'tools', title: '𝐓𝐎𝐎𝐋𝐒', categories: ['tools'] },
  { key: 'games', title: '𝐅𝐔𝐍 & 𝐆𝐀𝐌𝐄𝐒', categories: [] }
];

const NAME_SECTION_OVERRIDES = Object.freeze({ img: 'ai', lyrics: 'ai' });

const LEGACY_CATEGORIES = {
  download: new Set([
    'play', 'playaudio', 'playvideo', 'playptt', 'song', 'facebook', 'ig', 'tiktok',
    'apk', 'modapk', 'mediafire', 'movie', 'sm', 'smsubs'
  ]),
  ai: new Set(['wiki', 'define', 'image', 'lyrics', 'wallpaper', 'bibleai', 'detect', 'shazam']),
  group: new Set([
    'admin', 'unadmin', 'admins', 'promote', 'demote', 'kick', 'kickall', 'mute', 'unmute',
    'tagall', 'hidetag', 'creategroup', 'grouplist', 'groupjid', 'welcome', 'goodbye',
    'leave', 'setgpp', 'style', 'antilink', 'antistatusmention', 'antidelete', 'antitag',
    'checkban', 'revokeall', 'acceptall'
  ]),
  owner: new Set([
    'addadmin', 'deladmin', 'firstadmin', 'listadmin', 'admininfo', 'plaglist', 'breact',
    'cfn', 'unfollow', 'deletemenumber', 'delsession', 'broadcast', 'eval', 'sh', 'sr',
    'fullpp', 'setpp', 'setppfull', 'getpp', 'deleteme', 'setpath', 'getpath'
  ]),
  tools: new Set([
    'tourl', 'sticker', 'take', 'save', 'rvo', 'img', 'fancy', 'translate', 'ssweb',
    'upscale', 'setlang', 'jid', 'cid', 'chr', 'bible', 'verset', 'bratvid', 'tovn',
    'tostatus', 'status', 'post'
  ]),
  games: new Set(['ttt', 'joke', 'quote', 'fact', 'eightball', 'roll', 'coinflip', 'number', 'reverse', 'binary', 'b64', 'morse', 'cocktail', 'password']),
  bot: new Set([
    'menu', 'ping', 'owner', 'alive', 'active', 'bots', 'code', 'config', 'getconfig', 'setconfig',
    'resetconfig', 'showconfig', 'showconfig2', 'setprefix', 'setemoji', 'mode', 'silent',
    'alwaysonline', 'autoview', 'autolike', 'autorec', 'testgrp', 'update', 'version', 'status'
  ])
};

const LEGACY_ALIAS_NAMES = new Set([
  'aide', 'help', 'commands', 'list', 'p', 'speed', 'latency', 'pong',
  'tictactoe', 'delttt', 'removettt', 'ad', 'autoonline', 'online',
  'app', 'mod', 'playstore', 'playaudio', 'playvideo', 'playptt', 'fb', 'fbdl', 'bratvideo', 'tolink', 'upload',
  'whatmusic', 'findmusic', 'quemusica', 'fancytext', 'tr', 'tl', 'trt',
  'h', 'cgroup', 'readviewonce', 'vv', 'wm', 'mf', 'mfdl', 'dlmovie',
  'downloadmovie', 'antistatusmention_on', 'antistatusmention_off', '🌹', '😍', '❤️'
]);

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

function classifyLegacy(name) {
  for (const [category, names] of Object.entries(LEGACY_CATEGORIES)) {
    if (names.has(name)) return category;
  }
  return 'tools';
}

function buildCommandSections(categories = {}, legacyCommands = [], prefix = '.') {
  const lists = Object.fromEntries(SECTIONS.map(section => [section.key, new Set()]));
  const pluginAliases = new Set();

  for (const [pluginCategory, plugins] of Object.entries(categories || {})) {
    for (const plugin of plugins || []) {
      const name = String(plugin.name || '').trim().toLowerCase();
      if (!name) continue;
      const destination = NAME_SECTION_OVERRIDES[name] || String(pluginCategory).toLowerCase();
      const section = SECTIONS.find(item => item.categories.includes(destination));
      if (section) lists[section.key].add(name);
      for (const alias of plugin.aliases || []) {
        const normalized = String(alias || '').trim().toLowerCase();
        if (normalized && normalized !== name) pluginAliases.add(normalized);
      }
    }
  }

  const allPluginNames = new Set(Object.values(lists).flatMap(set => [...set]));
  for (const value of legacyCommands || []) {
    const name = String(value || '').trim().toLowerCase();
    if (!name || allPluginNames.has(name) || pluginAliases.has(name) || LEGACY_ALIAS_NAMES.has(name)) continue;
    lists[classifyLegacy(name)].add(name);
  }

  return {
    total: Object.values(lists).reduce((sum, names) => sum + names.size, 0),
    sections: SECTIONS.map(section => ({
      key: section.key,
      title: section.title,
      commands: [...lists[section.key]].sort()
    })).filter(section => section.commands.length)
  };
}

function buildMenuText({ prefix = '.', userTag = 'Utilisateur', uptime, version = '2.0.0', activeCount = 1, categories = {}, legacyCommands = [] } = {}) {
  const menu = buildCommandSections(categories, legacyCommands, prefix);
  const sections = menu.sections.map(section => [
    `╭───༼   \`${section.title}\`  ༽───`,
    ...section.commands.map(name => `> ❦︎ ${prefix}${name}`),
    '╰──────────────────⏣'
  ].join('\n')).join('\n\n');

  return [
    '⛩️  𝐊𝐀𝐈𝐃𝐎 - 𝐌𝐃  ⛩️',
    '                  ─── ᵇʸ ᑭ𝗹𝖺𝘨 ───',
    '',
    '`❦︎ ᴀᴛ 1ꪜᦓ1 𝑎𝑙𝑤𝑎𝑦𝑠 ᵇᵉ𝑡 ᵒⁿ ᵏᵃⁱᵈᵒ ❦︎`',
    '',
    '`❈` 𝐎𝐰𝐧𝐞𝐫 : 𝐊𝐚𝐢𝐝𝐨',
    `\`❈\` 𝐕𝐞𝐫𝐬𝐢𝐨𝐧 : ${version}`,
    `\`❈\` 𝐑𝐮𝐧 𝐓𝐢𝐦𝐞 : ${uptime || formatUptime(process.uptime())}`,
    `\`❈\` 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬 : ${menu.total}`,
    `\`❈\` 𝐔𝐭𝐢𝐥𝐢𝐬𝐚𝐭𝐞𝐮𝐫𝐬 : ${activeCount}`,
    '',
    sections,
    '',
    `> 𝐔𝐭𝐢𝐥𝐢𝐬𝐚𝐭𝐞𝐮𝐫 : ${userTag}`
  ].filter(Boolean).join('\n');
}

module.exports = {
  name: 'menu',
  alias: ['help', 'aide', 'commands', 'list'],
  category: 'general',
  description: 'Affiche le menu Kaido et les commandes disponibles, sans alias',
  usage: '.menu',
  async execute({
    socket, msg, from, sender, senderNumber, prefix, config, activeSockets,
    getPluginsByCategory, legacyCommands
  }) {
    const text = buildMenuText({
      prefix,
      userTag: `@${senderNumber || (typeof sender === 'string' ? sender.split('@')[0] : 'user')}`,
      uptime: formatUptime(process.uptime()),
      version: config?.BOT_VERSION || '2.0.0',
      activeCount: activeSockets?.size || 1,
      categories: getPluginsByCategory ? getPluginsByCategory() : {},
      legacyCommands: Array.isArray(legacyCommands) ? legacyCommands : []
    });
    await socket.sendMessage(from, { text, mentions: sender ? [sender] : [] }, { quoted: msg });
  },
  _test: { classifyLegacy, buildCommandSections, buildMenuText, formatUptime }
};
