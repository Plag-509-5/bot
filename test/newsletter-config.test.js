'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normaliseNewsletterJid,
  normaliseEmojiList,
  resolveNewsletterEmojis,
  parseNewsletterMessageReference,
  extractNewsletterServerId,
  reactToNewsletterMessage,
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
    { jid: '0029Vb761O39mrGTZvQ8UQ02@newsletter', serverId: '175' }
  );
  assert.deepEqual(
    parseNewsletterMessageReference('120363402094635383@newsletter/987654'),
    { jid: '120363402094635383@newsletter', serverId: '987654' }
  );
  assert.equal(parseNewsletterMessageReference('https://whatsapp.com/channel/invalid'), null);
  assert.equal(parseNewsletterMessageReference('https://example.com/channel/0029Vb761O39mrGTZvQ8UQ02/175'), null);
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

test('le helper de réaction peut suivre le canal avant d’utiliser l’API NYXCORE', async () => {
  const calls = [];
  const socket = {
    async newsletterFollow(jid) { calls.push(['follow', jid]); },
    async newsletterReactMessage(jid, serverId, emoji) { calls.push(['reaction', jid, serverId, emoji]); }
  };
  await reactToNewsletterMessage(socket, '0029Vb761O39mrGTZvQ8UQ02', '175', '👍', { ensureFollow: true });
  assert.deepEqual(calls, [
    ['follow', '0029Vb761O39mrGTZvQ8UQ02@newsletter'],
    ['reaction', '0029Vb761O39mrGTZvQ8UQ02@newsletter', '175', '👍']
  ]);
});

test('refuse de réagir sans server_id au lieu d’utiliser le stanza id', async () => {
  const message = { key: { id: 'stanza-id' } };
  assert.equal(extractNewsletterServerId(message), '');
  await assert.rejects(
    reactToNewsletterMessage({ newsletterReactMessage: async () => {} }, '0029Vb761O39mrGTZvQ8UQ02', '', '🔥'),
    /server_id de publication manquant/
  );
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
