'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normaliseNewsletterJid,
  normaliseEmojiList,
  resolveNewsletterEmojis,
  syncNewsletterSockets
} = require('../services/newsletter-config');

test('normalise le même JID pour le dashboard et la commande cfn', () => {
  assert.equal(normaliseNewsletterJid(' 120363402094635383@newsletter '), '120363402094635383@newsletter');
  assert.equal(normaliseNewsletterJid('120363402094635383'), '120363402094635383@newsletter');
  assert.equal(normaliseNewsletterJid('https://whatsapp.com/channel/test'), '');
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
  const source = fs.readFileSync(path.join(__dirname, '..', 'pair.js'), 'utf8');
  const block = source.slice(source.indexOf("case 'cfn':"), source.indexOf("case 'chr':"));
  assert.match(block, /socket\.sendMessage\(from/);
  assert.doesNotMatch(block, /imagePayload|headerType|buttonId|META_AI_CFN/);
});
