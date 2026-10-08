'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baileys = require('@whiskeysockets/baileys');
const { makeOfflineSocket } = require('./helpers/baileys-socket');
const {
  normaliseServerId,
  newsletterServerId,
  resolveNewsletterPost,
  createNewsletterReactionHandler
} = require('../src/services/newsletter-reactions');

const JID = '120363421675697127@newsletter';
const OTHER = '120363421675697128@newsletter';
const logger = { warn() {}, error() {} };
const post = (id, jid = JID) => ({ key: { remoteJid: jid, id, fromMe: false }, message: { conversation: 'Publication' } });

function fixture(overrides = {}) {
  const sent = [];
  const saved = [];
  const waits = [];
  const socket = { async newsletterReactMessage(...args) { sent.push(args); } };
  const handler = createNewsletterReactionHandler(socket, {
    sessionNumber: '50990000001',
    listNewsletters: async () => [{ jid: JID, emojis: ['🔥', '❤️'] }],
    listReactionConfigs: async () => [],
    async saveReaction(...args) { saved.push(args); },
    async delay(ms) { waits.push(ms); },
    logger,
    ...overrides
  });
  return { sent, saved, waits, socket, handler };
}

test('sélectionne le server_id numérique du fork sans utiliser un ID local ni arrondir un grand ID', () => {
  assert.equal(newsletterServerId({ key: { server_id: '175', id: '3EB0LOCAL' } }), '175');
  assert.equal(newsletterServerId({ newsletterServerId: 176, key: { id: 'local' } }), '176');
  assert.equal(newsletterServerId({ server_id: '177' }), '177');
  assert.equal(newsletterServerId(post('178')), '178');
  assert.equal(normaliseServerId('9007199254740993'), '9007199254740993');
  assert.equal(normaliseServerId(9007199254740993), '');
  for (const id of ['3EB0LOCAL', '-1', '0', '', null, undefined, '12.5']) assert.equal(normaliseServerId(id), '');
});

test('breact résout les liens/invitations en vrai JID au lieu de fabriquer invite@newsletter', async () => {
  const calls = [];
  const socket = { async newsletterMetadata(...args) { calls.push(args); return { id: JID }; } };
  for (const ref of [`${JID}/175`, '120363421675697127/175']) {
    assert.deepEqual(await resolveNewsletterPost(socket, ref), { channelJid: JID, messageId: '175' });
  }
  assert.equal(calls.length, 0);
  for (const ref of [
    '0029TestInvite/175',
    'https://whatsapp.com/channel/0029TestInvite/175',
    'https://www.whatsapp.com/channel/0029TestInvite/175/?utm_source=test',
    'whatsapp.com/channel/0029TestInvite/175'
  ]) assert.deepEqual(await resolveNewsletterPost(socket, ref), { channelJid: JID, messageId: '175' });
  assert.deepEqual(calls, Array(4).fill(['invite', '0029TestInvite']));
});

test('breact rejette les faux liens, les IDs non numériques et les chaînes non résolues', async () => {
  for (const ref of [
    'https://evil.example/whatsapp.com/channel/0029Test/175',
    'https://whatsapp.com.evil.example/channel/0029Test/175',
    'https://user@whatsapp.com/channel/0029Test/175',
    'https://whatsapp.com:8080/channel/0029Test/175',
    'https://whatsapp.com/channel/0029Test',
    `${JID}/3EB0LOCAL`, `${JID}/0`, '1234@newsletter/175', '1234/175'
  ]) await assert.rejects(resolveNewsletterPost({}, ref));
  await assert.rejects(resolveNewsletterPost({}, '0029Test/175'), /indisponible/);
  await assert.rejects(resolveNewsletterPost({ newsletterMetadata: async () => null }, '0029Test/175'), /accessible/);
  await assert.rejects(resolveNewsletterPost({ newsletterMetadata: async () => ({ id: '0029Invite@newsletter' }) }, '0029Test/175'), /accessible/);
});

test('traite tous les posts du lot et conserve la priorité des emojis du dashboard', async () => {
  const f = fixture({
    listReactionConfigs: async () => [{ jid: JID, emojis: ['❌'] }, { jid: OTHER, emojis: ['🐉'] }]
  });
  const result = await f.handler({ messages: [post('175'), post('176'), post('177', OTHER), post('178', '120363999999999999@newsletter')] });
  assert.deepEqual(f.sent, [[JID, '175', '🔥'], [JID, '176', '❤️'], [OTHER, '177', '🐉']]);
  assert.equal(result.length, 3);
  assert.deepEqual(f.saved[0], [JID, '175', '🔥', '50990000001']);
});

test('un vrai message décodé par xzcbailz déclenche une réaction avec son key.server_id', async t => {
  const { socket, nodes } = makeOfflineSocket(t);
  const stanza = {
    tag: 'message',
    attrs: { from: JID, id: '3EB0LOCAL', server_id: '175', t: '1700000000', type: 'text' },
    content: [{ tag: 'plaintext', attrs: {}, content: baileys.proto.Message.encode({ conversation: 'Post test' }).finish() }]
  };
  const decoded = baileys.decryptMessageNode(stanza, '50990000001@s.whatsapp.net', undefined, socket.signalRepository, require('./helpers/baileys-socket').logger);
  await decoded.decrypt();
  assert.equal(decoded.fullMessage.key.server_id, '175');
  const handler = createNewsletterReactionHandler(socket, {
    sessionNumber: '50990000001',
    listNewsletters: async () => [{ jid: JID, emojis: ['🔥'] }],
    listReactionConfigs: async () => [],
    logger
  });
  assert.equal((await handler({ messages: [decoded.fullMessage] }))[0].ok, true);
  assert.equal(nodes.at(-1).attrs.server_id, '175');
  assert.equal(baileys.getBinaryNodeChild(nodes.at(-1), 'reaction').attrs.code, '🔥');
});

test('ignore les propres messages, réactions, protocoles et posts dépourvus de server_id', async () => {
  const f = fixture();
  await f.handler({ messages: [
    { ...post('175'), key: { ...post('175').key, fromMe: true } },
    { ...post('176'), message: { reactionMessage: { text: '🔥' } } },
    { ...post('177'), message: { protocolMessage: {} } },
    post('3EB0LOCAL'), post('178', '50990000001@s.whatsapp.net')
  ] });
  assert.equal(f.sent.length, 0);
});

test('sérialise les upserts concurrents et ne réagit pas deux fois au même post', async () => {
  const f = fixture();
  await Promise.all([
    f.handler({ messages: [post('175')] }),
    f.handler({ messages: [post('175'), post('176')] })
  ]);
  assert.deepEqual(f.sent, [[JID, '175', '🔥'], [JID, '176', '❤️']]);
});

test('réessaie le même emoji trois fois au maximum et continue les autres posts', async () => {
  const f = fixture();
  const attempts = [];
  f.socket.newsletterReactMessage = async (...args) => {
    attempts.push(args);
    if (args[1] === '175') throw new Error('Échec transport');
  };
  const result = await f.handler({ messages: [post('175'), post('176')] });
  assert.equal(result[0].ok, false);
  assert.equal(result[1].ok, true);
  assert.deepEqual(attempts, [[JID, '175', '🔥'], [JID, '175', '🔥'], [JID, '175', '🔥'], [JID, '176', '🔥']]);
  assert.deepEqual(f.waits, [1200, 1200]);
  assert.equal(f.saved.length, 1);
});

test('un échec du journal Mongo ne provoque pas une deuxième réaction déjà envoyée', async () => {
  const f = fixture({ saveReaction: async () => { throw new Error('Mongo indisponible'); } });
  await f.handler({ messages: [post('175')] });
  await f.handler({ messages: [post('175'), post('176')] });
  assert.equal(f.sent.length, 2);
  assert.equal(f.waits.length, 0);
});

test('une erreur de lecture config ne casse pas la file des événements suivants', async () => {
  let reads = 0;
  const f = fixture({ listNewsletters: async () => {
    if (++reads === 1) throw new Error('Mongo temporairement indisponible');
    return [{ jid: JID, emojis: ['🔥'] }];
  } });
  assert.deepEqual(await f.handler({ messages: [post('175')] }), []);
  await f.handler({ messages: [post('175')] });
  assert.equal(f.sent.length, 1);
});

test('la déduplication est bornée en mémoire', async () => {
  const f = fixture({ maxRemembered: 2 });
  await f.handler({ messages: [post('175'), post('176'), post('177'), post('175')] });
  assert.equal(f.sent.length, 4, 'le premier post est sorti du cache borné');
});

test('pair.js câble le handler testé et breact utilise le résolveur de lien', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  const handler = source.slice(source.indexOf('function setupNewsletterHandlers'), source.indexOf('// Assure-toi d\'avoir importé'));
  assert.match(handler, /createNewsletterReactionHandler\(socket/);
  assert.match(handler, /socket\.ev\.on\('messages.upsert', handleUpsert\)/);
  const breact = source.slice(source.indexOf("case 'breact':"), source.indexOf("case 'getpp':"));
  assert.match(breact, /resolveNewsletterPost\(socket, channelRef\)/);
  assert.doesNotMatch(breact, /`\$\{urlMatch\[1\]\}@newsletter`/);
});
