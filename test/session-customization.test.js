'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stickerStore = require('../src/features/sticker_cmd');
const reactionStore = require('../src/features/reaction_cmd');
const modePlugin = require('../src/plugins/owner/mode');
const sudoPlugin = require('../src/plugins/owner/sudo');
const menuPlugin = require('../src/plugins/general/menu');
const pingPlugin = require('../src/plugins/general/ping');
const pluginLoader = require('../src/core/pluginLoader');
const {
  normaliseSudoUsers,
  persistSessionPatch
} = require('../src/services/session-preferences');

function commandContext(overrides = {}) {
  const sent = [];
  const saved = [];
  return {
    sent,
    saved,
    context: {
      socket: {
        async sendMessage(jid, content, options) {
          sent.push({ jid, content, options });
          return { key: { id: String(sent.length) } };
        }
      },
      msg: { key: { id: 'message-1' }, message: {} },
      from: 'chat@s.whatsapp.net',
      sender: '50911111111@s.whatsapp.net',
      senderNumber: '50911111111',
      sessionNumber: '50999999999',
      sessionCfg: { MODE: 'public', SUDO_USERS: [] },
      args: [],
      command: '',
      prefix: '.',
      isOwner: false,
      isSessionOwner: true,
      async setUserConfigInMongo(number, config) {
        saved.push({ number, config });
        return true;
      },
      ...overrides
    }
  };
}

test('les alias sticker sont isolés par numéro de session', () => {
  stickerStore._test.stickerCmds.clear();
  const hash = Buffer.from('sticker-hash').toString('base64');
  stickerStore._test.cacheSticker({ hash, command: 'ping', sessionId: '50911111111' });
  stickerStore._test.cacheSticker({ hash, command: 'menu', sessionId: '50922222222' });
  const sticker = { fileSha256: Buffer.from('sticker-hash') };

  assert.equal(stickerStore.findStickerCommand(sticker, '50911111111').command, 'ping');
  assert.equal(stickerStore.findStickerCommand(sticker, '50922222222').command, 'menu');
  assert.equal(stickerStore.findStickerCommand(sticker, '50933333333'), null);
  assert.equal(stickerStore.getAllStickerCommands('50911111111').length, 1);
});

test('les alias emoji sont isolés par numéro de session', () => {
  reactionStore._test.clearReactionCache();
  reactionStore._test.cacheReaction({ emoji: '🔥', command: 'ping', sessionId: '50911111111' });
  reactionStore._test.cacheReaction({ emoji: '🔥', command: 'menu', sessionId: '50922222222' });

  assert.equal(reactionStore.findReactionCommand('🔥', '50911111111').command, 'ping');
  assert.equal(reactionStore.findReactionCommand('🔥', '50922222222').command, 'menu');
  assert.equal(reactionStore.findReactionCommand('🔥', '50933333333'), null);
  assert.equal(reactionStore.getAllReactionCommands('50922222222').length, 1);
  assert.equal(reactionStore.hasReactionCommands('50911111111'), true);
  assert.equal(reactionStore.hasReactionCommands('50933333333'), false);
});

test('les index Mongo des alias sont composés avec la session et rechargent les documents', async () => {
  const indexes = [];
  const makeCollection = docs => ({
    async updateMany() {},
    async dropIndex() { const error = new Error('absent'); error.code = 27; throw error; },
    async createIndex(spec, options) { indexes.push({ spec, options }); },
    find() { return { async toArray() { return docs; } }; }
  });
  const collections = {
    sticker_commands: makeCollection([{ hash: 'mongo-hash', command: 'alive', sessionId: '50944444444' }]),
    reaction_commands: makeCollection([{ emoji: '✅', emojiKey: '✅', command: 'menu', sessionId: '50944444444' }])
  };
  const db = { collection(name) { return collections[name]; } };

  await stickerStore.initStickerDb(db);
  await reactionStore.initReactionDb(db);

  assert.deepEqual(indexes[0].spec, { sessionId: 1, hash: 1 });
  assert.deepEqual(indexes[1].spec, { sessionId: 1, emojiKey: 1 });
  assert.equal(stickerStore.findStickerCommand({ fileSha256: 'mongo-hash' }, '50944444444').command, 'alive');
  assert.equal(reactionStore.findReactionCommand('✅', '50944444444').command, 'menu');
});

test('le mode est sauvegardé uniquement dans la configuration de la session courante', async () => {
  const state = commandContext({ command: 'mode', args: ['private'] });
  await modePlugin.execute(state.context);

  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].number, '50999999999');
  assert.equal(state.saved[0].config.MODE, 'private');
  assert.match(state.sent.at(-1).content.text, /après chaque redémarrage/);
});

test('le menu utilise le style Kaido fourni et n’affiche pas les alias', () => {
  const categories = {
    general: [{ name: 'menu', aliases: ['menu', 'help'] }],
    download: [{ name: 'facebook', aliases: ['facebook', 'fb'] }],
    ai: [{ name: 'ai', aliases: ['ai', 'gpt'] }],
    tools: [{ name: 'save', aliases: ['save', 'vv'] }]
  };
  const catalog = menuPlugin._test.buildCommandSections(categories, ['ttt', 'tictactoe', 'ping', 'play', 'playaudio'], '.');
  assert.equal(catalog.sections.some(section => section.commands.includes('help')), false);
  assert.equal(catalog.sections.some(section => section.commands.includes('fb')), false);
  assert.equal(catalog.sections.some(section => section.commands.includes('vv')), false);
  assert.equal(catalog.sections.some(section => section.commands.includes('tictactoe')), false);
  assert.equal(catalog.sections.some(section => section.commands.includes('playaudio')), false);
  assert.equal(catalog.sections.some(section => section.commands.includes('menu')), true);

  const text = menuPlugin._test.buildMenuText({
    prefix: '.', userTag: '@test', uptime: '0h 1m 0s', version: '2.0.0', activeCount: 3,
    categories, legacyCommands: ['ttt', 'tictactoe', 'ping', 'play', 'playaudio']
  });
  assert.match(text, /𝐊𝐀𝐈𝐃𝐎 - 𝐌𝐃/);
  assert.match(text, /𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃/);
  assert.match(text, /𝐀𝐈 & 𝐒𝐄𝐀𝐑𝐂𝐇/);
  assert.match(text, /𝐅𝐔𝐍 & 𝐆𝐀𝐌𝐄𝐒/);
  assert.doesNotMatch(text, /\.help|\.fb|\.vv|\.tictactoe/);
  assert.match(pingPlugin._test.buildPingText(42, 2), /KAIDO SPEED/);
});

test('sudo est individuel, dédupliqué et persistant dans la configuration de session', async () => {
  assert.deepEqual(normaliseSudoUsers(['+509 11 11 1111', '50911111111', 'incorrect']), ['50911111111']);
  assert.equal(pluginLoader._test.hasOwnerCommandAccess({ isSudo: true }), true);
  assert.equal(pluginLoader._test.hasOwnerCommandAccess({ isMongoAdmin: true }), false);

  const added = commandContext({ command: 'sudo', args: ['50912345678'] });
  await sudoPlugin.execute(added.context);
  assert.deepEqual(added.saved[0].config.SUDO_USERS, ['50912345678']);

  const delegated = commandContext({
    command: 'sudo',
    args: ['50987654321'],
    isSessionOwner: false,
    isSudo: true
  });
  await sudoPlugin.execute(delegated.context);
  assert.equal(delegated.saved.length, 0, 'un sudo ne doit pas pouvoir nommer un autre sudo');

  const lid = commandContext({ command: 'sudo', args: ['123456789012345@lid'] });
  await sudoPlugin.execute(lid.context);
  assert.equal(lid.saved.length, 0, 'un identifiant LID ne doit pas être enregistré comme numéro');

  const persisted = await persistSessionPatch({
    sessionNumber: '50999999999',
    sessionCfg: { MODE: 'private', SUDO_USERS: ['50912345678'] },
    async setUserConfigInMongo(number, config) {
      assert.equal(number, '50999999999');
      assert.equal(config.MODE, 'private');
      return true;
    }
  }, { MODE: 'private' });
  assert.equal(persisted.MODE, 'private');
});
