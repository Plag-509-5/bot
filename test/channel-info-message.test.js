'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.cid affiche l’ID en texte avant de proposer le bouton de copie', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  const start = source.indexOf("case 'cid': {");
  const end = source.indexOf("case 'addadmin':", start);
  const block = source.slice(start, end);
  const idTextIndex = block.indexOf('ID à copier');
  const interactiveIndex = block.indexOf('socket.relayMessage(sender');
  assert.ok(idTextIndex >= 0, 'le texte contenant l’ID est présent');
  assert.ok(interactiveIndex > idTextIndex, 'le bouton interactif arrive après le texte lisible');
  assert.match(block, /buildChannelInfoInteractiveMessage/);
  assert.match(block, /socket\.sendMessage\(sender,\s*\{\s*text:/);
});
