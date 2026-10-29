'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  areSameIdentity,
  findGroupParticipant,
  getBotJids,
  getGroupAdminJids,
  getGroupAdminNumbers,
  getParticipantId,
  getParticipantMentionJid,
  isBotAdmin,
  isBotIdentity,
  isGroupAdmin,
  isGroupSuperAdmin,
  normalizeJid
} = require('../src/services/group-admins');
const { createLidMapping, isAdmin: isMappedAdmin } = require('../src/lib/normalize');
const { loadPlugins, executePlugin } = require('../src/core/pluginLoader');

before(() => loadPlugins(false));

const GROUP = '120363000000000000@g.us';
const ADMIN_LID = '300000000000001@lid';
const BOT_LID = '300000000000002@lid';
const MEMBER_LID = '300000000000003@lid';
const ADMIN_PN = '50944444444@s.whatsapp.net';
const BOT_PN = '50955555555@s.whatsapp.net';
const MEMBER_PN = '50966666666@s.whatsapp.net';

function makeMetadata({ botRole = 'superadmin', memberRole = null } = {}) {
  return {
    subject: 'Test group',
    participants: [
      {
        id: `${ADMIN_LID.split('@')[0]}:4@lid`,
        phoneNumber: '50944444444:2@s.whatsapp.net',
        admin: 'admin'
      },
      {
        id: `${BOT_LID.split('@')[0]}:6@lid`,
        phoneNumber: '50955555555:3@s.whatsapp.net',
        admin: botRole
      },
      {
        id: `${MEMBER_LID.split('@')[0]}:1@lid`,
        phoneNumber: `${MEMBER_PN.split('@')[0]}:8@s.whatsapp.net`,
        admin: memberRole
      }
    ]
  };
}

function makeSocket(metadata) {
  const sent = [];
  const updates = [];
  return {
    sent,
    updates,
    user: { id: '50955555555:11@s.whatsapp.net', lid: `${BOT_LID.split('@')[0]}:9@lid` },
    groupMetadata: async () => metadata,
    sendMessage: async (...args) => { sent.push(args); },
    groupParticipantsUpdate: async (...args) => { updates.push(args); }
  };
}

test('normalise les JID avec appareil sans confondre les domaines PN et LID', () => {
  assert.equal(normalizeJid('50955555555:11@s.whatsapp.net'), BOT_PN);
  assert.equal(normalizeJid('300000000000002:6@lid'), BOT_LID);
  assert.equal(normalizeJid('50955555555:11@c.us'), BOT_PN);
  assert.equal(areSameIdentity('50955555555:11@s.whatsapp.net', BOT_PN), true);
  assert.equal(areSameIdentity(BOT_LID, BOT_PN), false);
});

test('rapproche PN et LID depuis les métadonnées et distingue admin/superadmin', () => {
  const metadata = makeMetadata();

  assert.equal(isGroupAdmin(metadata, ADMIN_PN), true);
  assert.equal(isGroupAdmin(metadata, ADMIN_LID), true);
  assert.equal(isGroupSuperAdmin(metadata, ADMIN_PN), false);
  assert.equal(isGroupSuperAdmin(metadata, BOT_LID), true);
  assert.equal(getParticipantId(findGroupParticipant(metadata, ADMIN_PN)), ADMIN_LID);

  const member = findGroupParticipant(metadata, MEMBER_PN);
  assert.equal(getParticipantId(member), MEMBER_LID);
  assert.equal(getParticipantMentionJid(member), MEMBER_PN);
  assert.deepEqual(getGroupAdminNumbers(metadata), ['50944444444', '50955555555']);
  assert.deepEqual(getGroupAdminJids(metadata), [ADMIN_PN, BOT_PN]);
});

test('les mappings LID réutilisent les alias PN sans convertir un LID en numéro', () => {
  const mapping = createLidMapping(makeMetadata().participants);

  assert.equal(mapping.lidToInfo[ADMIN_LID].number, '50944444444');
  assert.equal(mapping.numberToInfo['50944444444'].lid, ADMIN_LID);
  assert.equal(isMappedAdmin(mapping, ADMIN_PN), true);
  assert.equal(isMappedAdmin(mapping, ADMIN_LID), true);
  assert.equal(isMappedAdmin(mapping, `${MEMBER_LID.split('@')[0]}@lid`), false);
  assert.equal(mapping.numberToInfo[MEMBER_LID.split('@')[0]], undefined);
});

test('reconnaît le bot admin par ses identités PN/LID, même avec un JID à appareil', () => {
  const socket = makeSocket(makeMetadata());
  const metadata = makeMetadata();

  assert.deepEqual(getBotJids(socket), [BOT_PN, BOT_LID]);
  assert.equal(isBotAdmin(metadata, socket), true);
  assert.equal(isBotIdentity(socket, `${BOT_LID.split('@')[0]}:12@lid`), true);

  const nonAdminSocket = makeSocket(makeMetadata({ botRole: null }));
  assert.equal(isBotAdmin(makeMetadata({ botRole: null }), nonAdminSocket), false);
});

test('le plugin kick accepte les alias du demandeur et de la cible, puis agit sur le JID réel', async () => {
  const socket = makeSocket(makeMetadata());
  const msg = {
    key: {
      remoteJid: GROUP,
      participant: `${ADMIN_LID.split('@')[0]}:4@lid`,
      participantAlt: `${ADMIN_PN.split('@')[0]}:2@s.whatsapp.net`
    },
    message: {
      extendedTextMessage: {
        contextInfo: {
          mentionedJid: [`${MEMBER_PN.split('@')[0]}:8@s.whatsapp.net`],
          mentionedJidAlt: [`${MEMBER_LID.split('@')[0]}:1@lid`]
        }
      }
    }
  };

  const handled = await executePlugin('kick', {
    socket,
    msg,
    from: GROUP,
    sender: `${ADMIN_LID.split('@')[0]}:4@lid`,
    args: [],
    command: 'kick',
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });

  assert.equal(handled, true);
  assert.deepEqual(socket.updates, [[GROUP, [MEMBER_LID], 'remove']]);
  assert.deepEqual(socket.sent.at(-1)[1].mentions, [MEMBER_PN]);
});

test('le plugin refuse une cible administratrice et un bot sans rôle superadmin', async () => {

  const adminTargetSocket = makeSocket(makeMetadata({ memberRole: 'admin' }));
  const kickMsg = {
    key: { participant: ADMIN_PN },
    message: { extendedTextMessage: { contextInfo: { mentionedJid: [MEMBER_PN] } } }
  };
  await executePlugin('kick', {
    socket: adminTargetSocket,
    msg: kickMsg,
    from: GROUP,
    sender: ADMIN_PN,
    args: [],
    command: 'kick',
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });
  assert.deepEqual(adminTargetSocket.updates, []);
  assert.match(adminTargetSocket.sent.at(-1)[1].text, /administrateur/i);

  const regularBotSocket = makeSocket(makeMetadata({ botRole: 'admin' }));
  const promoteMsg = {
    key: { participant: ADMIN_PN },
    message: { extendedTextMessage: { contextInfo: { mentionedJid: [MEMBER_PN] } } }
  };
  await executePlugin('promote', {
    socket: regularBotSocket,
    msg: promoteMsg,
    from: GROUP,
    sender: ADMIN_PN,
    args: [],
    command: 'promote',
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });
  assert.deepEqual(regularBotSocket.updates, []);
  assert.match(regularBotSocket.sent.at(-1)[1].text, /super-administrateur/i);
});

test('refuse un demandeur non-admin ou un bot qui n\'est pas admin', async () => {
  const nonAdminSocket = makeSocket(makeMetadata());
  await executePlugin('kick', {
    socket: nonAdminSocket,
    msg: {
      key: { participant: MEMBER_PN },
      message: { extendedTextMessage: { contextInfo: { mentionedJid: [ADMIN_PN] } } }
    },
    from: GROUP,
    sender: MEMBER_PN,
    args: [],
    command: 'kick',
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });
  assert.deepEqual(nonAdminSocket.updates, []);
  assert.match(nonAdminSocket.sent.at(-1)[1].text, /Seuls les administrateurs/i);

  const nonAdminBotSocket = makeSocket(makeMetadata({ botRole: null }));
  await executePlugin('kick', {
    socket: nonAdminBotSocket,
    msg: {
      key: { participant: ADMIN_PN },
      message: { extendedTextMessage: { contextInfo: { mentionedJid: [MEMBER_PN] } } }
    },
    from: GROUP,
    sender: ADMIN_PN,
    args: [],
    command: 'kick',
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });
  assert.deepEqual(nonAdminBotSocket.updates, []);
  assert.match(nonAdminBotSocket.sent.at(-1)[1].text, /bot doit être administrateur/i);
});

test('le contrôle de permission échoue en sécurité si les métadonnées manquent', async () => {
  const sent = [];
  const updates = [];
  const socket = {
    user: { id: `${BOT_PN}:11` },
    groupMetadata: async () => { throw new Error('offline'); },
    sendMessage: async (...args) => { sent.push(args); },
    groupParticipantsUpdate: async (...args) => { updates.push(args); }
  };
  const handled = await executePlugin('kick', {
    socket,
    msg: { key: { participant: ADMIN_PN }, message: {} },
    from: GROUP,
    sender: ADMIN_PN,
    args: [],
    command: 'kick',
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });

  assert.equal(handled, true);
  assert.equal(updates.length, 0);
  assert.match(sent.at(-1)[1].text, /Impossible de vérifier/i);
});
