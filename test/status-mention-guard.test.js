'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  resolveAntiStatusMode,
  formatKaidoStatusMention
} = require('../src/services/status-mention-guard');

test('les modes de modération des mentions sont désactivés par défaut et rejettent les anciennes valeurs booléennes', () => {
  assert.equal(resolveAntiStatusMode(undefined), 'off');
  assert.equal(resolveAntiStatusMode(true), 'off');
  assert.equal(resolveAntiStatusMode(false), 'off');
  assert.equal(resolveAntiStatusMode('false'), 'off');
  assert.equal(resolveAntiStatusMode('DELETE'), 'delete');
  assert.equal(resolveAntiStatusMode('remove'), 'remove');
  assert.equal(resolveAntiStatusMode('unexpected'), 'off');
});

test('les avertissements sont brandés Kaido MD et restent lisibles en français', () => {
  const message = formatKaidoStatusMention('Mention de statut détectée', [
    'Administrateur : @50912345678',
    'Les administrateurs sont exemptés de sanction.'
  ]);

  assert.match(message, /𝐊𝐀𝐈𝐃𝐎 𝐌𝐃/);
  assert.match(message, /@50912345678/);
  assert.match(message, /exemptés de sanction/);
  assert.doesNotMatch(message, /TOXIC-MD|xh_?clinton/i);
});

test('la configuration du bot démarre avec les deux protections de mentions désactivées', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  assert.match(source, /ANTI_TAG_MODE:\s*'off'/);
  assert.match(source, /antistatusmention:\s*false/);
  assert.match(source, /resolveAntiStatusMode\(cfg\.ANTI_TAG_MODE\)/);
  assert.doesNotMatch(source, /TOXIC-MD|xh_?clinton/i);
});
