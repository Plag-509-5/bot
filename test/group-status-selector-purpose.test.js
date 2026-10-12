'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const selector = require('../src/services/group-status-selector');

function clearPending() {
  selector._test.pendingSelections.clear();
  selector._test.selectedGroups.clear();
}

test('les réponses aliasées au sélecteur de public ne changent pas la sélection swgc', () => {
  clearPending();
  selector.beginGroupSelection(
    'session-5091',
    ['123456:4@s.whatsapp.net', '123456@lid', '123456'],
    [{ jid: '111@g.us', subject: 'Audience', size: 5 }],
    1000,
    'tostatus-audience'
  );

  const selection = selector.resolveGroupSelection('5091', '123456@s.whatsapp.net', '1', { now: 1001 });
  assert.equal(selection.status, 'selected');
  assert.equal(selection.purpose, 'tostatus-audience');
  assert.equal(selector.getSelectedGroup('5091', '123456:4@s.whatsapp.net'), null);
  assert.equal(selector._test.pendingSelections.size, 0);
});

test('le sélecteur swgc conserve son comportement historique par défaut', () => {
  clearPending();
  selector.beginGroupSelection('5091', 'user-a', [{ jid: '222@g.us', subject: 'Deux' }], 1000);
  const selection = selector.resolveGroupSelection('5091', 'user-a', '1', { now: 1001 });

  assert.equal(selection.purpose, 'swgc');
  assert.equal(selector.getSelectedGroup('5091', 'user-a').jid, '222@g.us');
});
