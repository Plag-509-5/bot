'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');

test('.code renvoie un texte universel au lieu d’un bouton relay non pris en charge', () => {
  const start = source.indexOf("case 'code': {");
  const end = source.indexOf("case 'deleteme': {", start);
  const block = source.slice(start, end);
  assert.match(block, /socket\.sendMessage\(codeChat,\s*\{\s*text:/);
  assert.match(block, /__kaidoSkipLocalFormatting/);
  assert.doesNotMatch(block, /socket\.relayMessage|nativeFlowMessage|cta_copy/);
});

test('.breact ne consulte pas Mongo avant l’envoi et n’attend pas un follow', () => {
  const start = source.indexOf("case 'breact': {");
  const end = source.indexOf("case 'getpp': {", start);
  const block = source.slice(start, end);
  assert.match(block, /reactAcrossNewsletterSockets\(/);
  assert.match(block, /Réaction lancée immédiatement/);
  assert.doesNotMatch(block, /getAllNumbersFromMongo|ensureFollow|newsletterFollow|delay\(1000\)|\{\s*react:\s*\{/);
});
