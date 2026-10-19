'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractStatusViewerNumbers,
  extractVCardNumbers,
  MAX_STATUS_IMPORT_BYTES
} = require('../src/services/status-audience-import');

test('extrait les numéros d’un texte, accepte les séparateurs et déduplique', () => {
  const numbers = extractStatusViewerNumbers([
    'Contacts à ajouter :',
    '1. +509 (1234) 5678',
    '509-876-54321, 50987654321',
    'Téléphone: 00 509 1111 2222'
  ].join('\n'));

  assert.deepEqual(numbers, ['50912345678', '50987654321', '50911112222']);
});

test('n’importe que les propriétés TEL d’une vCard et déplie les lignes', () => {
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Jean Téléphone 2026',
    'item1.TEL;TYPE=CELL;waid=50912345678:+509-1234-5678',
    'TEL;TYPE=HOME:509 8765 4321',
    'TEL;TYPE=WORK:tel:+509-1111-2222;ext=99',
    'END:VCARD'
  ].join('\r\n');

  assert.deepEqual(extractStatusViewerNumbers(vcard), [
    '50912345678', '50987654321', '50911112222'
  ]);
});

test('une vCard sans propriété téléphone et un texte sans numéro ne produisent rien', () => {
  assert.deepEqual(extractVCardNumbers('BEGIN:VCARD\nFN:Année 2026\nEND:VCARD'), []);
  assert.deepEqual(extractStatusViewerNumbers('Aucun contact dans ce message.'), []);
});

test('la limite des fichiers importés est bornée à un mégaoctet', () => {
  assert.equal(MAX_STATUS_IMPORT_BYTES, 1024 * 1024);
});
