'use strict';

// Tests du VRAI fork et des payloads du bot, avec transport serveur simulé.
// Aucun compte WhatsApp n'est requis, aucune authentification réseau testée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baileys = require('@whiskeysockets/baileys');
const pkg = require('@whiskeysockets/baileys/package.json');
const { auditBaileysSurface, jsFiles } = require('../scripts/baileys-surface');
const { parseCommandInput, extractMainCommandNames } = require('../src/services/command-routing');
const { makeOfflineSocket } = require('./helpers/baileys-socket');
const { groupStatus } = require('../src/handlers/status');

const surface = auditBaileysSurface();

test('chaque export Baileys importé par le bot existe dans le package installé', () => {
  assert.equal(pkg.name, 'xzcbailz');
  assert.equal(pkg.version, '1.0.6');
  for (const [name, callers] of surface.exports) {
    assert.notEqual(baileys[name], undefined, `export ${name} manquant : ${callers.join(', ')}`);
  }
  assert.equal(typeof baileys.default, 'function');
  assert.ok(surface.exports.size >= 13, 'l’inventaire doit couvrir aussi les imports imbriqués');
});

test('chaque méthode socket appelée est disponible ou possède un fallback explicite', t => {
  const { socket } = makeOfflineSocket(t);
  const optional = {
    copyNForward: ['sendMessage'],
    getNewsletterMetadata: ['newsletterMetadata'],
    groupUpdateProfilePicture: ['updateProfilePicture', 'query'],
    updateProfilePictureFull: ['updateProfilePicture', 'query']
  };
  for (const [method, callers] of surface.methods) {
    if (method === 'downloadMediaMessage' && surface.assignedMethods.has(method)) continue; // helper du bot
    if (typeof socket[method] === 'function') continue;
    assert.ok(optional[method], `API ${method} absente : ${callers.join(', ')}`);
    for (const fallback of optional[method]) assert.equal(typeof socket[fallback], 'function');
    for (const caller of callers) {
      const file = caller.slice(0, caller.lastIndexOf(':'));
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      assert.match(source, new RegExp(`typeof socket\\.${method} === ['\"]function['\"]`), `${method} doit rester protégé`);
    }
  }
});

test('tous les plugins et leurs alias se chargent et toutes les commandes sont reconnues', t => {
  const loader = require('../src/core/pluginLoader');
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const plugins = loader.loadPlugins(false); // aucun watcher ni chargement de pair.js
  assert.deepEqual(errors, [], `chargement des plugins : ${errors.join('\n')}`);
  const pluginFiles = jsFiles(path.join(__dirname, '..', 'src', 'plugins'));
  assert.equal(loader.getAllPluginsList().length, pluginFiles.length, 'aucun fichier plugin ignoré');
  for (const plugin of loader.getAllPluginsList()) {
    assert.equal(typeof plugin.execute, 'function');
    for (const alias of plugin.aliases) assert.equal(plugins.get(alias), plugin);
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  const excluded = ['alwaysonline', 'autoonline', 'online', 'autoview', 'autolike', 'autorec', 'setemoji', 'setlikeemoji', 'setprefix', 'show', 'get'];
  const registeredLegacy = extractMainCommandNames(source, excluded);
  // Le registre utilisé en production ne doit pas oublier un case principal.
  for (const name of surface.legacyCommands) assert.ok(registeredLegacy.has(name), `case ${name} absent du registre`);
  const commands = new Set([...surface.legacyCommands, ...plugins.keys()]);
  for (const command of commands) {
    for (const prefix of ['.', '!', '']) {
      const parsed = parseCommandInput(`${prefix}${command} argument`, prefix, value => commands.has(value));
      assert.equal(parsed?.command, command);
      assert.deepEqual(parsed.args, ['argument']);
    }
  }
  t.diagnostic(`${pluginFiles.length} plugins, ${plugins.size} noms/alias de plugins, ${surface.legacyCommands.size} case principaux, ${commands.size} noms de commandes au total. Chargement/routage uniquement, pas exécution réseau de chaque commande.`);
});

test('requestPairingCode génère huit caractères, les persiste et construit la demande md', async t => {
  const { socket, state, nodes } = makeOfflineSocket(t);
  const updates = [];
  socket.ev.on('creds.update', update => updates.push(update));
  const code = await socket.requestPairingCode('50990000001');
  assert.match(code, /^[1-9A-HJ-NP-TV-Z]{8}$/);
  assert.equal(state.creds.pairingCode, code);
  assert.equal(state.creds.me.id, '50990000001@s.whatsapp.net');
  assert.ok(updates.some(update => update.pairingCode === code));
  const stanza = nodes.at(-1);
  assert.equal(stanza.tag, 'iq');
  assert.equal(stanza.attrs.xmlns, 'md');
  const registration = baileys.getBinaryNodeChild(stanza, 'link_code_companion_reg');
  assert.equal(registration.attrs.jid, state.creds.me.id);
  assert.equal(registration.attrs.stage, 'companion_hello');
  const wrapped = Buffer.from(baileys.getBinaryNodeChild(registration, 'link_code_pairing_wrapped_companion_ephemeral_pub').content);
  assert.equal(wrapped.length, 80); // salt 32 + IV 16 + clé publique chiffrée 32
  const key = await baileys.derivePairingCodeKey(code, wrapped.subarray(0, 32));
  const publicKey = baileys.aesDecryptCTR(wrapped.subarray(48), key, wrapped.subarray(32, 48));
  assert.deepEqual(Buffer.from(publicKey), Buffer.from(state.creds.pairingEphemeralKeyPair.public));
  const next = await socket.requestPairingCode('50990000001');
  assert.match(next, /^[1-9A-HJ-NP-TV-Z]{8}$/);
  assert.notEqual(next, code, 'pas de code fixe par défaut');
});

test('un code personnalisé invalide et une connexion fermée ne retournent pas un faux succès', async t => {
  const { socket, state, transport, nodes } = makeOfflineSocket(t);
  await assert.rejects(socket.requestPairingCode('50990000001', 'court'), /exactly 8/);
  assert.equal(nodes.length, 0);
  const code = await socket.requestPairingCode('50990000001', 'KAIDO123');
  assert.equal(code, 'KAIDO123');
  transport.readyState = 3;
  await assert.rejects(socket.requestPairingCode('50990000001'), /Connection Closed/);
  // Un code stocké n'est pas la preuve que WhatsApp l'a accepté.
  assert.equal(state.creds.registered, false);
});

test('newsletterReactMessage utilise le server_id et supporte aussi le retrait de réaction', async t => {
  const { socket, nodes } = makeOfflineSocket(t);
  const jid = '120363421675697127@newsletter';
  await socket.newsletterReactMessage(jid, '175', '🔥');
  let stanza = nodes.at(-1);
  assert.equal(stanza.tag, 'message');
  assert.equal(stanza.attrs.to, jid);
  assert.equal(stanza.attrs.type, 'reaction');
  assert.equal(stanza.attrs.server_id, '175');
  assert.equal(baileys.getBinaryNodeChild(stanza, 'reaction').attrs.code, '🔥');
  await socket.newsletterReactMessage(jid, '175', '');
  stanza = nodes.at(-1);
  assert.equal(stanza.attrs.edit, '7');
  assert.deepEqual(baileys.getBinaryNodeChild(stanza, 'reaction').attrs, {});
});

test('newsletterFollow, newsletterUnfollow et newsletterMetadata construisent leurs requêtes mex', async t => {
  const jid = '120363421675697127@newsletter';
  const metadata = { id: jid, name: 'Test local', subscribers: 1 };
  const { socket, nodes } = makeOfflineSocket(t, {
    respond(node) {
      const query = baileys.getBinaryNodeChild(node, 'query');
      const dataPath = query.attrs.query_id === baileys.QueryIds.METADATA
        ? baileys.XWAPaths.xwa2_newsletter_metadata
        : query.attrs.query_id === baileys.QueryIds.FOLLOW
          ? baileys.XWAPaths.xwa2_newsletter_follow
          : baileys.XWAPaths.xwa2_newsletter_unfollow;
      return {
        tag: 'iq', attrs: { id: node.attrs.id, type: 'result' },
        content: [{ tag: 'result', attrs: {}, content: Buffer.from(JSON.stringify({ data: { [dataPath]: metadata } })) }]
      };
    }
  });
  await socket.newsletterFollow(jid);
  await socket.newsletterUnfollow(jid);
  assert.deepEqual(await socket.newsletterMetadata('invite', '0029LocalInvite'), metadata);
  const queries = nodes.map(node => baileys.getBinaryNodeChild(node, 'query'));
  assert.deepEqual(queries.map(query => query.attrs.query_id), [baileys.QueryIds.FOLLOW, baileys.QueryIds.UNFOLLOW, baileys.QueryIds.METADATA]);
  assert.deepEqual(JSON.parse(queries[0].content.toString()).variables, { newsletter_id: jid });
  assert.deepEqual(JSON.parse(queries[2].content.toString()).variables.input, { key: '0029LocalInvite', type: 'INVITE' });
});

test('le vrai relayMessage chiffre le statut de groupe et conserve le nœud meta (pas un message texte ordinaire)', async t => {
  const patched = [];
  const { socket, state, nodes, keys } = makeOfflineSocket(t, {
    cachedGroupMetadata: async jid => ({ id: jid, participants: [], addressingMode: 'pn' }),
    patchMessageBeforeSending(message) { patched.push(message); return message; }
  });
  state.creds.me = { id: '50990000001:1@s.whatsapp.net' };
  state.creds.registered = true;
  const wrapped = await groupStatus(socket, '120363000000001@g.us', {
    text: 'Statut sans watermark', backgroundColor: '#123456', font: 3
  });
  const stanza = nodes.at(-1);
  assert.equal(stanza.attrs.to, '120363000000001@g.us');
  assert.equal(stanza.attrs.id, wrapped.key.id);
  assert.equal(baileys.getBinaryNodeChild(stanza, 'meta').attrs.is_group_status, 'true');
  const encrypted = baileys.getBinaryNodeChild(stanza, 'enc');
  assert.equal(encrypted.attrs.type, 'skmsg');
  assert.ok(encrypted.content.length > 32);
  assert.ok([...keys.data.keys()].some(key => key.startsWith('sender-key:')), 'clé de groupe créée par le vrai Signal');
  const inner = patched.at(-1).groupStatusMessageV2.message;
  assert.equal(inner.extendedTextMessage.contextInfo.isGroupStatus, true);
  assert.equal(inner.extendedTextMessage.text, 'Statut sans watermark');
  assert.equal(inner.extendedTextMessage.backgroundArgb, 0xff123456);
  assert.deepEqual(inner.messageContextInfo.messageSecret, wrapped.message.messageContextInfo.messageSecret);
  // Round-trip proto réel : le wrapper et les marqueurs ne doivent pas disparaître.
  const decoded = baileys.proto.Message.decode(baileys.proto.Message.encode(wrapped.message).finish());
  assert.equal(decoded.groupStatusMessageV2.message.extendedTextMessage.contextInfo.isGroupStatus, true);
});

test('safe-send voit réellement la fermeture du WebSocketClient de xzcbailz', async t => {
  const { socket, state, transport, nodes } = makeOfflineSocket(t);
  const { socketReadiness, installSafeSend } = require('../src/lib/safe-send');
  state.creds.registered = true;
  assert.equal(socketReadiness(socket).ready, true);
  transport.readyState = 3;
  assert.equal(socketReadiness(socket).ready, false);
  installSafeSend(socket, { readyTimeoutMs: 0, retries: 0, logger: { error() {} } });
  await assert.rejects(socket.sendMessage('50990000002@s.whatsapp.net', { text: 'ne doit pas partir' }), /Connexion WhatsApp indisponible/);
  assert.equal(nodes.length, 0);
});
