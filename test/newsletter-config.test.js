'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normaliseNewsletterJid,
  normaliseEmojiList,
  resolveNewsletterEmojis,
  formatBReactSummary,
  parseNewsletterMessageReference,
  parseNewsletterChannelReference,
  parseReactionEmojiList,
  parseBReactInput,
  resolveNewsletterJid,
  extractNewsletterServerId,
  reactToNewsletterMessage,
  reactAcrossNewsletterSockets,
  syncNewsletterSockets
} = require('../src/services/newsletter-config');

test('normalise le même JID pour le dashboard et la commande cfn', () => {
  assert.equal(normaliseNewsletterJid(' 120363402094635383@newsletter '), '120363402094635383@newsletter');
  assert.equal(normaliseNewsletterJid('120363402094635383'), '120363402094635383@newsletter');
  assert.equal(normaliseNewsletterJid('0029Vb761O39mrGTZvQ8UQ02'), '0029Vb761O39mrGTZvQ8UQ02@newsletter');
  assert.equal(normaliseNewsletterJid('0029Vb761O39mrGTZvQ8UQ02@newsletter'), '0029Vb761O39mrGTZvQ8UQ02@newsletter');
  assert.equal(normaliseNewsletterJid('https://whatsapp.com/channel/test'), '');
});

test('analyse les références de publication depuis un lien ou un JID de chaîne', () => {
  assert.deepEqual(
    parseNewsletterMessageReference('https://whatsapp.com/channel/0029Vb761O39mrGTZvQ8UQ02/175?text=hello'),
    { jid: '0029Vb761O39mrGTZvQ8UQ02@newsletter', serverId: '175', channelKey: '0029Vb761O39mrGTZvQ8UQ02' }
  );
  assert.deepEqual(
    parseNewsletterMessageReference('120363402094635383@newsletter/987654'),
    { jid: '120363402094635383@newsletter', serverId: '987654', channelKey: '120363402094635383@newsletter' }
  );
  assert.equal(parseNewsletterMessageReference('https://whatsapp.com/channel/invalid'), null);
  assert.equal(parseNewsletterMessageReference('https://example.com/channel/0029Vb761O39mrGTZvQ8UQ02/175'), null);
});

test('analyse breact lien | emojis, préserve les répétitions et le lien chr sans message id', () => {
  assert.deepEqual(parseBReactInput('https://whatsapp.com/channel/0029Vb761O39mrGTZvQ8UQ02/175 | 😂 , 🔥 , 😂'), {
    jid: '0029Vb761O39mrGTZvQ8UQ02@newsletter',
    serverId: '175',
    channelKey: '0029Vb761O39mrGTZvQ8UQ02',
    emojis: ['😂', '🔥', '😂']
  });
  assert.deepEqual(parseNewsletterChannelReference('https://whatsapp.com/channel/0029Vb761O39mrGTZvQ8UQ02'), {
    jid: '0029Vb761O39mrGTZvQ8UQ02@newsletter',
    channelKey: '0029Vb761O39mrGTZvQ8UQ02'
  });
  assert.deepEqual(parseReactionEmojiList('🤫 , 🪥 ,🥱'), ['🤫', '🪥', '🥱']);
  assert.equal(parseBReactInput('https://whatsapp.com/channel/0029Vb761O39mrGTZvQ8UQ02/175 | 😂, bad'), null);
});

test('lit le server_id officiel depuis la clé NYXCORE et utilise newsletterReactMessage', async () => {
  const message = {
    key: { id: 'stanza-id', server_id: 'newsletter-server-id' }
  };
  assert.equal(extractNewsletterServerId(message), 'newsletter-server-id');
  assert.equal(extractNewsletterServerId({ key: { id: 'not-the-server-id' } }), '');

  const calls = [];
  const socket = {
    async newsletterReactMessage(...args) { calls.push(['reaction', ...args]); },
    async newsletterFollow(...args) { calls.push(['follow', ...args]); }
  };
  const result = await reactToNewsletterMessage(
    socket,
    '0029Vb761O39mrGTZvQ8UQ02',
    message.key.server_id,
    '🔥'
  );

  assert.deepEqual(result, {
    jid: '0029Vb761O39mrGTZvQ8UQ02@newsletter',
    serverId: 'newsletter-server-id',
    reaction: '🔥'
  });
  assert.deepEqual(calls, [[
    'reaction', '0029Vb761O39mrGTZvQ8UQ02@newsletter', 'newsletter-server-id', '🔥'
  ]]);
});

test('resolve un code de lien WhatsApp en JID canonique avec newsletterMetadata', async () => {
  const calls = [];
  const socket = {
    async newsletterMetadata(type, key) {
      calls.push([type, key]);
      return { id: '120363402094635383@newsletter' };
    }
  };
  const reference = parseNewsletterMessageReference('https://whatsapp.com/channel/0029Vb761O39mrGTZvQ8UQ02/175');
  assert.equal(await resolveNewsletterJid(socket, reference), '120363402094635383@newsletter');
  assert.deepEqual(calls, [['invite', '0029Vb761O39mrGTZvQ8UQ02']]);
  assert.equal(await resolveNewsletterJid(socket, '120363402094635383@newsletter'), '120363402094635383@newsletter');
  assert.equal(calls.length, 1, 'un JID numérique ne nécessite pas de lookup invite');
  await resolveNewsletterJid(socket, parseNewsletterMessageReference('00291234567890/175'));
  assert.deepEqual(calls[1], ['invite', '00291234567890']);
});

test('le follow optionnel est mémorisé par socket et précède la réaction', async () => {
  const calls = [];
  const socket = {
    async newsletterFollow(jid) { calls.push(['follow', jid]); },
    async newsletterReactMessage(jid, serverId, emoji) { calls.push(['reaction', jid, serverId, emoji]); }
  };
  await reactToNewsletterMessage(socket, '120363402094635383', '175', '👍', { ensureFollow: true });
  await reactToNewsletterMessage(socket, '120363402094635383', '176', '🔥', { ensureFollow: true });
  assert.deepEqual(calls, [
    ['follow', '120363402094635383@newsletter'],
    ['reaction', '120363402094635383@newsletter', '175', '👍'],
    ['reaction', '120363402094635383@newsletter', '176', '🔥']
  ]);
});

test('breact réagit sur les sessions uniques sans imposer d’abonnement', async () => {
  const calls = [];
  const createSocket = id => ({
    user: { id: `${id}@s.whatsapp.net` },
    async newsletterFollow() { throw new Error('breact ne doit pas suivre le canal'); },
    async newsletterReactMessage(jid, serverId, emoji) {
      calls.push([id, 'reaction', jid, serverId, emoji]);
    }
  });
  const first = createSocket('bot-1');
  const second = createSocket('bot-2');
  const results = await reactAcrossNewsletterSockets([
    { session: '5091', socket: first },
    { session: '5092', socket: second },
    { session: '5091-duplicate', socket: first }
  ], '120363402094635383', '175', '🔥');
  assert.equal(results.filter(result => result.ok).length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call[0]).sort(), ['bot-1', 'bot-2']);
  assert.ok(calls.every(call => call[1] === 'reaction'));
});

test('breact répartit les emojis de façon cyclique et équilibrée sur les sessions uniques', async () => {
  const calls = [];
  const sessions = Array.from({ length: 5 }, (_, index) => ({
    session: `session-${index}`,
    socket: {
      async newsletterReactMessage(_jid, _serverId, emoji) { calls.push([index, emoji]); }
    }
  }));
  const results = await reactAcrossNewsletterSockets(sessions, '120363402094635383', '175', ['😂', '🔥', '😂']);
  assert.equal(results.filter(result => result.ok).length, 5);
  assert.deepEqual(calls, [[0, '😂'], [1, '🔥'], [2, '😂'], [3, '😂'], [4, '🔥']]);
  assert.deepEqual(results.map(result => result.reaction), ['😂', '🔥', '😂', '😂', '🔥']);
});

test('refuse de réagir sans server_id au lieu d’utiliser le stanza id', async () => {
  const message = { key: { id: 'stanza-id' } };
  assert.equal(extractNewsletterServerId(message), '');
  await assert.rejects(
    reactToNewsletterMessage({ newsletterReactMessage: async () => {} }, '0029Vb761O39mrGTZvQ8UQ02', '', '🔥'),
    /server_id de publication manquant/
  );
});

test('résume la tâche breact avec uniquement les totaux demandés', () => {
  assert.equal(
    formatBReactSummary(8, 2),
    '✅ Tâche accomplie.\nRéactions envoyées : 8\nÉchecs : 2'
  );
  assert.equal(formatBReactSummary(-1, Number.NaN), '✅ Tâche accomplie.\nRéactions envoyées : 0\nÉchecs : 0');
});

test('normalise les emojis venant du textarea ou de cfn sans doublons', () => {
  assert.deepEqual(normaliseEmojiList('🔥, ❤️,😂,🔥'), ['🔥', '❤️', '😂']);
  assert.deepEqual(normaliseEmojiList(['🔥,❤️', '😂', '']), ['🔥', '❤️', '😂']);
  assert.deepEqual(normaliseEmojiList('👨‍👩‍👧‍👦 ❤️'), ['👨‍👩‍👧‍👦', '❤️']);
});

test('utilise les emojis synchronisés puis un fallback non vide', () => {
  assert.deepEqual(resolveNewsletterEmojis(['🔥'], ['❤️']), ['🔥']);
  assert.deepEqual(resolveNewsletterEmojis([], '❤️,😂'), ['❤️', '😂']);
  assert.ok(resolveNewsletterEmojis([], []).length > 0);
});

test('synchronise follow et unfollow sur toutes les sessions actives', async () => {
  const events = [];
  const first = {
    user: { id: '5091:1@s.whatsapp.net' },
    async newsletterFollow(jid) { events.push(['follow', 'one', jid]); },
    async newsletterUnfollow(jid) { events.push(['unfollow', 'one', jid]); }
  };
  const second = {
    user: { id: '5092:1@s.whatsapp.net' },
    async newsletterFollow(jid) { events.push(['follow', 'two', jid]); },
    async newsletterUnfollow(jid) { events.push(['unfollow', 'two', jid]); }
  };
  const sockets = new Map([['one', first], ['two', second]]);

  const followed = await syncNewsletterSockets(sockets, '120363402094635383', 'follow');
  const unfollowed = await syncNewsletterSockets(sockets, '120363402094635383@newsletter', 'unfollow');
  assert.equal(followed.filter(result => result.ok).length, 2);
  assert.equal(unfollowed.filter(result => result.ok).length, 2);
  assert.equal(events.length, 4);
});

test('la synchronisation cfn tolère un socket sans identifiant utilisateur', async () => {
  const socket = {
    async newsletterFollow(jid) {
      assert.equal(jid, '120363402094635383@newsletter');
    }
  };
  const result = await syncNewsletterSockets(new Map(), '120363402094635383', 'follow', [socket]);
  assert.equal(result[0].session, 'session-inconnue');
  assert.equal(result[0].ok, true);
});

test('cfn répond avec un payload texte sûr sans ancien bouton/image fragile', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  const block = source.slice(source.indexOf("case 'cfn':"), source.indexOf("case 'chr':"));
  assert.match(block, /socket\.sendMessage\(from/);
  assert.doesNotMatch(block, /imagePayload|headerType|buttonId|META_AI_CFN/);
});

test('le moteur auto-réaction lit le server_id NYXCORE et appelle l’API newsletter dédiée', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  const start = source.indexOf('async function setupNewsletterHandlers');
  const end = source.indexOf('// Assure-toi d\'avoir importé ton helper', start);
  const block = source.slice(start, end);
  assert.match(block, /extractNewsletterServerId\(message\)/);
  assert.match(block, /reactToNewsletterMessage\(socket, normalizedJid, serverId, emoji\)/);
  assert.doesNotMatch(block, /message\.newsletterServerId\s*\|\|\s*message\.key\.id/);
  assert.doesNotMatch(block, /sendMessage\(normalizedJid,\s*\{\s*react:/);
});
