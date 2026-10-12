'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_STATUS_VIEWERS,
  mergeStatusViewerNumbers,
  getGroupParticipantNumbers,
  appendGroupParticipantsToStatusAudience
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
