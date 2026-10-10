'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOP_DIVIDER,
  bold,
  italic,
  spacedTitle,
  commandText,
  genericCommandResponse,
  withCommandTheme,
  activateCommandTheme,
  createMetaQuote,
  setupCommandThemeWrapper
} = require('../src/services/oni-theme');

const menuPlugin = require('../src/plugins/general/menu');
const pingPlugin = require('../src/plugins/general/ping');

test('produit les caractères exacts du thème Onigashima', () => {
  assert.equal(bold('KAIDO 2026'), '𝗞𝗔𝗜𝗗𝗢 𝟮𝟬𝟮𝟲');
  assert.equal(italic('menu'), '𝙢𝙚𝙣𝙪');
  assert.equal(commandText('.menu'), '.𝙢𝙚𝙣𝙪');
  assert.equal(spacedTitle('PING'), '𝗣 𝗜 𝗡 𝗚');
});

test('unifie automatiquement les réponses des commandes sans doubler un thème existant', async () => {
  const sent = [];
  const socket = {
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: String(sent.length) } };
    }
  };
  setupCommandThemeWrapper(socket);

  await socket.sendMessage('chat', { text: 'hors commande' });
  await withCommandTheme(async () => {
    activateCommandTheme('classic', false);
    await socket.sendMessage('chat', { text: 'thème désactivé' });
  });
  await withCommandTheme(async () => {
    activateCommandTheme('alive');
    await socket.sendMessage('chat', { text: 'Le bot fonctionne.' });
    const themed = genericCommandResponse('alive', 'Déjà stylé');
    await socket.sendMessage('chat', { text: themed });
    await socket.sendMessage('status@broadcast', { text: 'Statut fourni par l’utilisateur' });
    await socket.sendMessage('chat', { text: 'Contenu brut', _skipOniTheme: true });
    await socket.sendMessage('chat', { image: Buffer.from('x'), caption: 'A'.repeat(1000) });
  });

  assert.equal(sent[0].content.text, 'hors commande');
  assert.equal(sent[0].options.quoted, undefined);
  assert.equal(sent[1].content.text, 'thème désactivé');
  assert.equal(sent[1].options.quoted.message.contactMessage.displayName, 'Meta AI', 'le thème classique utilise aussi Meta quoted');
  assert.match(sent[2].content.text, /𝗔 𝗟 𝗜 𝗩 𝗘\s+𝗥 𝗘 𝗦 𝗨 𝗟 𝗧/);
  assert.match(sent[2].content.text, /Le bot fonctionne\./);
  assert.equal(sent[2].options.quoted.key.id, 'META_AI_ALIVE');
  assert.equal(sent[3].content.text.split(TOP_DIVIDER).length, 5, 'le thème ne doit pas être imbriqué');
  assert.equal(sent[4].content.text, 'Statut fourni par l’utilisateur');
  assert.equal(sent[4].options.quoted, undefined, 'le contenu publié en statut ne doit jamais être habillé');
  assert.deepEqual(sent[5].content, { text: 'Contenu brut' });
  assert.equal(sent[5].options.quoted.key.id, 'META_AI_ALIVE');
  assert.equal(sent[6].content.caption.length, 1000, 'une longue caption média doit rester intacte');
  assert.equal(sent[6].options.quoted.message.contactMessage.displayName, 'Meta AI');
});

test('applique Meta quoted à toutes les réponses de commande sauf opérations techniques', async () => {
  const sent = [];
  const relayed = [];
  const socket = {
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
    },
    async relayMessage(jid, message, options) {
      relayed.push({ jid, message, options });
    }
  };
  setupCommandThemeWrapper(socket);

  await withCommandTheme(async () => {
    activateCommandTheme('menu', false);
    await socket.sendMessage('chat', { text: 'Menu' }, { quoted: { key: { id: 'ORIGINAL' } } });
    await socket.sendMessage('chat', { react: { text: '✅', key: { id: '1' } } });
    await socket.sendMessage('chat', { delete: { id: '1' } });
    await socket.sendMessage('chat', { text: 'Interne', _skipMetaQuote: true });
    await socket.sendMessage('120363@newsletter', { text: 'Chaîne' });
    await socket.sendMessage('123@g.us', {
      image: Buffer.from('statut'),
      caption: 'Caption originale',
      groupStatus: true
    });
    await socket.relayMessage('chat', {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: 'Menu interactif' },
            contextInfo: { mentionedJid: ['509@s.whatsapp.net'] }
          }
        }
      }
    }, { messageId: 'interactive-1' });
    await socket.relayMessage('123@g.us', {
      groupStatusMessageV2: { message: { conversation: 'Statut de groupe' } }
    }, { messageId: 'status-1' });
  });

  assert.deepEqual(sent[0].options.quoted, createMetaQuote('menu'));
  assert.equal(sent[1].options.quoted, undefined);
  assert.equal(sent[2].options.quoted, undefined);
  assert.deepEqual(sent[3].content, { text: 'Interne' });
  assert.equal(sent[3].options.quoted, undefined);
  assert.equal(sent[4].options.quoted, undefined);
  assert.equal(sent[5].content.caption, 'Caption originale');
  assert.equal(sent[5].content.groupStatus, true);
  assert.equal(sent[5].options.quoted, undefined, 'un statut de groupe ne reçoit aucun habillage');
  const relayContext = relayed[0].message.viewOnceMessage.message.interactiveMessage.contextInfo;
  assert.equal(relayContext.stanzaId, 'META_AI_MENU');
  assert.equal(relayContext.quotedMessage.contactMessage.displayName, 'Meta AI');
  assert.deepEqual(relayContext.mentionedJid, ['509@s.whatsapp.net']);
  assert.equal(relayed[0].options._skipMetaQuote, undefined);
  assert.equal(relayed[1].message.groupStatusMessageV2.message.conversation, 'Statut de groupe');
  assert.equal(relayed[1].message.groupStatusMessageV2.contextInfo, undefined);
});

test('isole le thème de deux commandes concurrentes avec AsyncLocalStorage', async () => {
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, text: content.text });
    }
  };
  setupCommandThemeWrapper(socket);

  await Promise.all([
    withCommandTheme(async () => {
      activateCommandTheme('ping');
      await new Promise(resolve => setTimeout(resolve, 15));
      await socket.sendMessage('chat-ping', { text: 'réponse ping' });
    }),
    withCommandTheme(async () => {
      activateCommandTheme('alive');
      await socket.sendMessage('chat-alive', { text: 'réponse alive' });
    })
  ]);

  const ping = sent.find(entry => entry.jid === 'chat-ping').text;
  const alive = sent.find(entry => entry.jid === 'chat-alive').text;
  assert.match(ping, /𝗣 𝗜 𝗡 𝗚\s+𝗥 𝗘 𝗦 𝗨 𝗟 𝗧/);
  assert.match(alive, /𝗔 𝗟 𝗜 𝗩 𝗘\s+𝗥 𝗘 𝗦 𝗨 𝗟 𝗧/);
});

test('le menu répertorie les commandes et alias réels sans reprendre les exemples fictifs', () => {
  const categories = {
    general: [
      { name: 'menu', aliases: ['menu', 'help', 'aide'] },
      { name: 'ping', aliases: ['ping', 'latency'] }
    ],
    tools: [{ name: 'tourl', aliases: ['tourl', 'upload'] }],
    owner: [{ name: 'config', aliases: ['config', 'settings'] }]
  };
  const legacyCommands = ['menu', 'ping', 'ad', 'cfn', 'playvideo', 'ttt', 'delsession'];
  const catalog = menuPlugin._test.buildCommandSections(categories, legacyCommands, '.');
  const output = catalog.sections.flatMap(section => section.lines).join('\n');

  for (const command of ['.𝙢𝙚𝙣𝙪', '.𝙝𝙚𝙡𝙥', '.𝙥𝙞𝙣𝙜', '.𝙩𝙤𝙪𝙧𝙡', '.𝙖𝙙', '.𝙘𝙛𝙣', '.𝙥𝙡𝙖𝙮𝙫𝙞𝙙𝙚𝙤', '.𝙩𝙩𝙩', '.𝙙𝙚𝙡𝙨𝙚𝙨𝙨𝙞𝙤𝙣']) {
    assert.match(output, new RegExp(command.replace('.', '\\.')));
  }
  assert.doesNotMatch(output, /𝙨𝙪𝙙𝙤|𝙯𝙖𝙮/);
  assert.equal(catalog.total, 14);
});

test('le menu complet reprend le texte KAIDO-MD validé pour le thème par défaut', () => {
  const text = menuPlugin._test.buildMenuText({
    userTag: '@50912345678',
    prefix: '!',
    uptime: '1h 2m 3s',
    version: '2.0.0',
    footer: 'PIED DE PAGE',
    activeCount: 3,
    categories: { general: [{ name: 'menu', aliases: ['menu', 'help'] }] },
    legacyCommands: ['ping', 'swgc']
  });

  assert.match(text, /⛩️  𝐊𝐀𝐈𝐃𝐎 - 𝐌𝐃  ⛩️/);
  assert.match(text, /─── ᵇʸ ᑭ𝗹𝖺𝘨 ───/);
  assert.match(text, /｢ 👤 𝐔𝐭𝐢𝐥𝐢𝐬𝐚𝐭𝐞𝐮𝐫 : @50912345678 ｣/);
  assert.match(text, /｢ 🔰 𝐒𝐞𝐬𝐬𝐢𝐨𝐧𝐬 𝐚𝐜𝐭𝐢𝐯𝐞𝐬 : 3 ｣/);
  assert.match(text, /｢ 📜 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐞𝐬 : 4 ｣/);
  assert.match(text, /> ・ !menu\n> ・ !ping/);
  assert.match(text, /> ・ !swgc/);
  assert.match(text, /🐉-𝑲𝒊𝒏𝒈 𝒐𝒇 𝒕𝒉𝒆 𝒃𝒆𝒂𝒔𝒕 -🐉/);
  assert.match(text, /• Uptime: 1h 2m 3s\n• Prefix: !\n• Version: 2\.0\.0/);
  assert.match(text, /PIED DE PAGE$/);
  assert.doesNotMatch(text, /&gt;|\$\{/, 'pas d’entité HTML ni d’interpolation brute');
});

test('ping utilise exactement le nouveau style sans ancien cadre', () => {
  const text = pingPlugin._test.buildPingText(474);
  assert.match(text, /𝗣 𝗜 𝗡 𝗚\s+𝗥 𝗘 𝗦 𝗨 𝗟 𝗧/);
  assert.match(text, /𝗟 𝗔 𝗧 𝗘 𝗡 𝗖 𝗘/);
  assert.match(text, /𝟰𝟳𝟰𝗺𝘀/);
  assert.match(text, /𝙊𝙉𝙇𝙄𝙉𝙀/);
  assert.match(text, /𝗞𝗔𝗜𝗗𝗢 𝗠𝗗/);
  assert.doesNotMatch(text, /KAIDO SPEED|╭───/);
});
