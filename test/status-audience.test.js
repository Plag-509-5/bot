'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_STATUS_VIEWERS,
  mergeStatusViewerNumbers,
  getGroupParticipantNumbers,
  appendGroupParticipantsToStatusAudience,
  resolveStatusRelayAudience
} = require('../src/services/status-audience');

test('fusionne les listes sans remplacer ni dupliquer les numéros déjà enregistrés', () => {
  const result = mergeStatusViewerNumbers(
    ['50911111111', '50922222222'],
    ['50922222222', '50933333333', '50933333333']
  );

  assert.deepEqual(result, {
    numbers: ['50911111111', '50922222222', '50933333333'],
    added: 1,
    alreadyPresent: 1,
    total: 3
  });
});

test('résout les LID via le mapping Baileys et compte ceux qui restent inconnus', async () => {
  const socket = {
    groupMetadata: async () => ({
      subject: 'Groupe test',
      participants: [
        { id: '50912345678@s.whatsapp.net' },
        { id: 'member-lid@lid' },
        { id: 'missing-lid@lid' },
        { phoneNumber: '+509 1234 5678' }
      ]
    }),
    signalRepository: {
      lidMapping: {
        getPNsForLIDs: async lids => {
          assert.deepEqual(lids, ['member-lid@lid', 'missing-lid@lid']);
          return [{ lid: 'member-lid@lid', pn: '50987654321:0@s.whatsapp.net' }];
        }
      }
    }
  };

  const groupNumbers = await getGroupParticipantNumbers(socket, (await socket.groupMetadata()).participants);
  assert.deepEqual(groupNumbers, {
    numbers: ['50912345678', '50987654321'],
    participantCount: 4,
    unresolvedParticipants: 1
  });

  const merged = await appendGroupParticipantsToStatusAudience(socket, '123@g.us', ['50911111111']);
  assert.equal(merged.groupSubject, 'Groupe test');
  assert.deepEqual(merged.numbers, ['50911111111', '50912345678', '50987654321']);
  assert.equal(merged.added, 2);
  assert.equal(merged.unresolvedParticipants, 1);
});

test('refuse un ajout qui dépasserait la limite de 1 000 destinataires', () => {
  const current = Array.from({ length: MAX_STATUS_VIEWERS }, (_, index) => String(10000000000 + index));
  assert.throws(
    () => mergeStatusViewerNumbers(current, ['50999999999']),
    /limitée à 1000/,
  );
});

test('route tous les destinataires vers les LID du compte émetteur sans liste mixte', async () => {
  const socket = {
    user: { id: '50900000000:7@s.whatsapp.net' },
    authState: {
      creds: {
        me: {
          id: '50900000000:0@s.whatsapp.net',
          lid: 'self-lid:4@lid'
        }
      }
    },
    signalRepository: {
      lidMapping: {
        getLIDsForPNs: async pns => {
          assert.deepEqual(pns, [
            '50922222222@s.whatsapp.net',
            '50933333333@s.whatsapp.net'
          ]);
          return [
            { pn: '50922222222:0@s.whatsapp.net', lid: 'contact-222:3@lid' },
            { pn: '50933333333@s.whatsapp.net', lid: 'contact-333@lid' }
          ];
        }
      }
    }
  };

  const result = await resolveStatusRelayAudience(socket, [
    '50900000000@s.whatsapp.net',
    '50922222222:2@s.whatsapp.net',
    '50933333333@s.whatsapp.net',
    '50922222222@s.whatsapp.net',
    'already-lid@lid'
  ]);

  assert.deepEqual(result, {
    statusJidList: ['self-lid@lid', 'contact-222@lid', 'contact-333@lid', 'already-lid@lid'],
    ownJid: 'self-lid@lid',
    addressingMode: 'lid',
    unresolvedJids: []
  });
});

test('exclut et signale les numéros sans mapping LID au lieu de publier une audience mélangée', async () => {
  const socket = {
    user: { id: '50900000000@s.whatsapp.net' },
    authState: { creds: { me: { id: '50900000000@s.whatsapp.net', lid: 'self-lid@lid' } } },
    signalRepository: {
      lidMapping: {
        getLIDsForPNs: async () => [
          { pn: '50922222222@s.whatsapp.net', lid: 'contact-222@lid' }
        ]
      }
    }
  };

  const result = await resolveStatusRelayAudience(socket, [
    '50900000000@s.whatsapp.net',
    '50922222222@s.whatsapp.net',
    '50933333333@s.whatsapp.net'
  ]);
  assert.deepEqual(result.statusJidList, ['self-lid@lid', 'contact-222@lid']);
  assert.deepEqual(result.unresolvedJids, ['50933333333@s.whatsapp.net']);
  assert.equal(result.addressingMode, 'lid');
});

test('convertit les LID en PN pour un émetteur non migré et déduplique la liste', async () => {
  const socket = {
    user: { id: '50900000000:4@s.whatsapp.net' },
    signalRepository: {
      lidMapping: {
        getPNsForLIDs: async lids => {
          assert.deepEqual(lids, ['contact-222@lid', 'unknown-lid@lid']);
          return [{ lid: 'contact-222:3@lid', pn: '50922222222:0@s.whatsapp.net' }];
        }
      }
    }
  };

  const result = await resolveStatusRelayAudience(socket, [
    '50900000000@s.whatsapp.net',
    'contact-222@lid',
    '50922222222@s.whatsapp.net',
    'unknown-lid@lid'
  ]);
  assert.deepEqual(result.statusJidList, ['50900000000@s.whatsapp.net', '50922222222@s.whatsapp.net']);
  assert.equal(result.ownJid, '50900000000@s.whatsapp.net');
  assert.equal(result.addressingMode, null);
  assert.deepEqual(result.unresolvedJids, ['unknown-lid@lid']);
});
