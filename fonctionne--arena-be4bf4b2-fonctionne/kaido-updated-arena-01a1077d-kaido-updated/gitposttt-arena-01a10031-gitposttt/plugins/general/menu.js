'use strict';

const {
  TOP_DIVIDER,
  bold,
  italic,
  commandText,
  sectionHeader,
  isOniThemeEnabled
} = require('../../services/oni-theme');

const SECTION_META = {
  principal: { order: 1, icon: '⚔', title: 'MENU PRINCIPAL' },
  download: { order: 2, icon: '📥', title: 'TELECHARGEMENTS' },
  tools: { order: 3, icon: '🛠', title: 'OUTILS ET MEDIA' },
  ai: { order: 4, icon: '🧠', title: 'INTELLIGENCE IA' },
  group: { order: 5, icon: '👥', title: 'GESTION GROUPES' },
  security: { order: 6, icon: '🛡', title: 'SECURITE' },
  admin: { order: 7, icon: '☠', title: 'MENU ADMIN' },
  system: { order: 8, icon: '⚙', title: 'MENU SYSTEME' },
  games: { order: 9, icon: '🎮', title: 'JEUX' },
  extras: { order: 10, icon: '⛩', title: 'COMMANDES CLASSIQUES' }
};

const LEGACY_GROUPS = {
  games: new Set(['ttt', 'tictactoe', 'delttt', 'removettt']),
  security: new Set([
    'ad', 'antidelete', 'antitag', 'antilink', 'antistatusmention',
    'antistatusmention_on', 'antistatusmention_off', 'checkban', 'revokeall'
  ]),
  admin: new Set([
    'addadmin', 'deladmin', 'firstadmin', 'listadmin', 'admininfo', 'plaglist',
    'breact', 'cfn', 'unfollow', 'deletemenumber', 'delsession', 'acceptall',
    'broadcast', 'bc', 'eval', 'sh', 'sr'
  ]),
  system: new Set([
    'active', 'bots', 'code', 'config', 'getconfig', 'setconfig', 'resetconfig',
    'showconfig', 'showconfig2', 'setpath', 'getpath', 'mode', 'silent',
    'alwaysonline', 'autoonline', 'online', 'autoview', 'autolike', 'autorec',
    'setprefix', 'setemoji', 'get', 'show', 'testgrp'
  ]),
  group: new Set([
    'admin', 'unadmin', 'admins', 'promote', 'demote', 'kick', 'kickall',
    'mute', 'unmute', 'tagall', 'hidetag', 'cgroup', 'creategroup', 'grouplist',
    'groupjid', 'gjid', 'welcome', 'goodbye', 'leave', 'fullpp', 'setgpp'
  ]),
  download: new Set([
    'play', 'playaudio', 'playvideo', 'playptt', 'song', 'facebook', 'fb', 'fbdl',
    'ig', 'tiktok', 'apk', 'app', 'mod', 'modapk', 'playstore', 'mediafire',
    'mf', 'mfdl', 'movie', 'dlmovie', 'downloadmovie', 'sm', 'smsubs'
  ]),
  tools: new Set([
    'tourl', 'tolink', 'upload', 'tovn', 'sticker', 's', 'take', 'save', 'vv',
    'rvo', 'readviewonce', 'img', 'fancy', 'fancytext', 'style', 'translate',
    'tr', 'trt', 'ssweb', 'upscale', 'lyrics', 'shazam', 'whatmusic',
    'findmusic', 'quemusica', 'detect', 'getpp', 'setpp', 'setppfull', 'setlang',
    'jid', 'cid', 'chr', 'bible', 'verset', 'bibleai', 'bratvid', 'bratvideo'
  ]),
  principal: new Set([
    'menu', 'help', 'aide', 'ping', 'owner', 'alive', 'status', 'device',
    'get-id', 'check', 'post', 'add'
  ])
};

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d ? `${d}j` : '', h ? `${h}h` : '', m ? `${m}m` : '', `${Math.floor(seconds % 60)}s`]
    .filter(Boolean)
    .join(' ');
}

function cleanDisplayName(value, fallback) {
  return String(value || fallback || 'Utilisateur')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 60);
}

function classifyLegacy(name) {
  for (const [category, names] of Object.entries(LEGACY_GROUPS)) {
    if (names.has(name)) return category;
  }
  return 'extras';
}

function pluginCategoryToSection(category) {
  return ({ general: 'principal', owner: 'admin' })[category] || category || 'extras';
}

function commandWithPrefix(prefix, name) {
  return commandText(`${prefix || ''}${name}`);
}

function pluginLine(prefix, plugin) {
  const names = [...new Set([plugin.name, ...(plugin.aliases || [])].filter(Boolean))];
  const primary = names.shift();
  const aliases = names.map(name => commandWithPrefix(prefix, name));
  return `   ❈  ${commandWithPrefix(prefix, primary)}${aliases.length ? `   ⌘   ${aliases.join('   ⌘   ')}` : ''}`;
}

function simpleCommandLine(prefix, name) {
  return `   ❈  ${commandWithPrefix(prefix, name)}`;
}

function buildCommandSections(categories = {}, legacyCommands = [], prefix = '.') {
  const sections = Object.fromEntries(Object.keys(SECTION_META).map(key => [key, []]));
  const registeredNames = new Set();

  for (const [pluginCategory, plugins] of Object.entries(categories)) {
    const destination = sections[pluginCategoryToSection(pluginCategory)] || sections.extras;
    for (const plugin of plugins || []) {
      const allNames = [...new Set([plugin.name, ...(plugin.aliases || [])].filter(Boolean).map(name => String(name).toLowerCase()))];
      allNames.forEach(name => registeredNames.add(name));
      destination.push({ sort: allNames[0], line: pluginLine(prefix, plugin) });
    }
  }

  for (const nameValue of legacyCommands || []) {
    const name = String(nameValue || '').toLowerCase().trim();
    if (!name || registeredNames.has(name)) continue;
    registeredNames.add(name);
    const category = classifyLegacy(name);
    sections[category].push({ sort: name, line: simpleCommandLine(prefix, name) });
  }

  return {
    total: registeredNames.size,
    sections: Object.entries(sections)
      .filter(([, entries]) => entries.length)
      .sort(([left], [right]) => SECTION_META[left].order - SECTION_META[right].order)
      .map(([key, entries]) => ({
        key,
        ...SECTION_META[key],
        lines: entries.sort((a, b) => a.sort.localeCompare(b.sort)).map(entry => entry.line)
      }))
  };
}

function buildClassicMenuText({ botName, ownerName, userName, prefix, mode, uptime, categories, legacyCommands }) {
  const groups = Object.fromEntries(Object.keys(SECTION_META).map(key => [key, []]));
  const registered = new Set();

  for (const [pluginCategory, plugins] of Object.entries(categories || {})) {
    const section = pluginCategoryToSection(pluginCategory);
    for (const plugin of plugins || []) {
      const names = [...new Set([plugin.name, ...(plugin.aliases || [])]
        .filter(Boolean)
        .map(name => String(name).toLowerCase()))];
      names.forEach(name => registered.add(name));
      if (names.length) {
        groups[section]?.push(`${prefix}${names[0]}${names.length > 1 ? ` (${names.slice(1).map(name => `${prefix}${name}`).join(', ')})` : ''}`);
      }
    }
  }

  for (const value of legacyCommands || []) {
    const name = String(value || '').trim().toLowerCase();
    if (!name || registered.has(name)) continue;
    registered.add(name);
    groups[classifyLegacy(name)].push(`${prefix}${name}`);
  }

  const lines = [
    `╔══════════════════════╗`,
    `║     🐉 ${botName} 🐉`,
    `╚══════════════════════╝`,
    '',
    `👤 Utilisateur : ${userName}`,
    `👑 Créateur : ${ownerName}`,
    `⚙️ Mode : ${String(mode || 'public').toUpperCase()}`,
    `⏱️ Uptime : ${uptime}`,
    `📌 Préfixe : ${prefix || 'aucun (prefixless)'}`,
    `📊 Commandes et alias : ${registered.size}`,
    ''
  ];

  for (const [key, commands] of Object.entries(groups)
    .filter(([, entries]) => entries.length)
    .sort(([left], [right]) => SECTION_META[left].order - SECTION_META[right].order)) {
    lines.push(`┌───「 ${SECTION_META[key].icon} ${SECTION_META[key].title} 」`);
    commands.sort().forEach(command => lines.push(`│ • ${command}`));
    lines.push('└───', '');
  }
  lines.push('> POWERED BY PLAG TECH');
  return lines.join('\n');
}

function buildMenuText({ botName, ownerName, userName, prefix, mode, uptime, year, categories, legacyCommands }) {
  const prefixLabel = prefix ? `[ ${prefix} ]` : '[ PREFIXLESS ]';
  const commandSections = buildCommandSections(categories, legacyCommands, prefix);
  const headerBotName = bold(String(botName || 'KAIDO MD').replace(/[-_]+/g, ' ').toUpperCase());

  let text = `${TOP_DIVIDER}\n\n` +
    '```\n' +
    `       ⛩  ${headerBotName} ⛩\n\n` +
    '    ❖   ᵇʸ 𝑷 𝐥 ᗩ 𝗚 ❖\n\n' +
    `     ⛩  ${bold('ONIGASHIMA THEME')}  ⛩\n` +
    '```\n\n' +
    `${TOP_DIVIDER}\n\n` +
    `${sectionHeader('INFORMATIONS', '⛩')}\n\n` +
    `   ❈  ${italic('OWNER')}   ⟿   ${bold(ownerName)}\n` +
    `   ❈  ${italic('USER')}    ⟿   ${bold(userName)}\n` +
    `   ❈  ${italic('PREFIX')}  ⟿   ${prefixLabel}\n` +
    `   ❈  ${bold('MODE')}    ⟿   ${italic(String(mode || 'public').toUpperCase())}\n` +
    `   ❈  ${bold('UPTIME')}  ⟿   ${uptime}\n` +
    `   ❈  ${bold('STATUS')}  ⟿   ⧉ ${italic('ONLINE')} ⧉\n` +
    `   ❈  ${bold('COMMANDS')} ⟿   ${commandSections.total}\n\n`;

  for (const section of commandSections.sections) {
    text += `${sectionHeader(section.title, section.icon)}\n\n${section.lines.join('\n')}\n\n`;
  }

  text += `${TOP_DIVIDER}\n\n` +
    '```\n' +
    ` ⟅ 雷 ⟆  ${italic('POWERED BY')}  ⟅ 雷 ⟆\n\n` +
    `       ❖  ${bold('PLAG TECH')}  ❖\n\n` +
    `    ⛩  雷 ${bold('KAIDO MD')} @${year} 雷  ⛩\n` +
    '```\n\n' +
    `${TOP_DIVIDER}`;
  return text;
}

module.exports = {
  name: 'menu',
  alias: ['help', 'aide', 'commands', 'list'],
  category: 'general',
  description: 'Affiche toutes les vraies commandes dans le thème Onigashima',
  usage: '.menu',
  async execute({
    socket,
    msg,
    from,
    sender,
    senderNumber,
    pushName,
    prefix,
    config,
    sessionCfg,
    legacyCommands,
    getPluginsByCategory
  }) {
    const year = new Intl.DateTimeFormat('en', {
      timeZone: 'America/Port-au-Prince',
      year: 'numeric'
    }).format(new Date());
    const menuData = {
      botName: sessionCfg?.botName || config?.BOT_NAME || 'KAIDO MD',
      ownerName: cleanDisplayName(config?.OWNER_NAME, 'PLAG'),
      userName: cleanDisplayName(pushName, `@${senderNumber}`),
      prefix,
      mode: sessionCfg?.MODE || 'public',
      uptime: formatUptime(process.uptime()),
      year,
      categories: getPluginsByCategory ? getPluginsByCategory() : {},
      legacyCommands: Array.isArray(legacyCommands) ? legacyCommands : []
    };
    const menuText = isOniThemeEnabled(sessionCfg?.THEME)
      ? buildMenuText(menuData)
      : buildClassicMenuText(menuData);

    await socket.sendMessage(from, {
      text: menuText,
      mentions: sender ? [sender] : []
    }, { quoted: msg });
  },
  _test: {
    classifyLegacy,
    commandWithPrefix,
    pluginLine,
    buildCommandSections,
    buildClassicMenuText,
    buildMenuText,
    formatUptime
  }
};
