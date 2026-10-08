'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalisePrefix,
  resolveSessionPrefix,
  parseCommandInput,
  extractLegacyCommands,
  extractMainCommandNames,
  formatPrefix
} = require('../src/services/command-routing');

const known = new Set(['menu', 'config', 'playvideo', 'ping']);
const isKnown = (command) => known.has(command);

test('mode préfixé: accepte le préfixe configuré et extrait les arguments', () => {
  assert.deepEqual(parseCommandInput('!playvideo https://youtu.be/test', '!', isKnown), {
    command: 'playvideo',
    args: ['https://youtu.be/test'],
    prefix: '!',
    prefixless: false,
    commandText: 'playvideo https://youtu.be/test'
  });
  assert.equal(parseCommandInput('.menu', '!', isKnown), null);
  assert.equal(parseCommandInput('salut', '!', isKnown), null);
});

test('mode prefixless: exécute uniquement un premier mot répertorié comme commande', () => {
  const parsed = parseCommandInput('menu', '', isKnown);
  assert.equal(parsed.command, 'menu');
  assert.equal(parsed.prefixless, true);

  assert.deepEqual(parseCommandInput('config setprefix .', '', isKnown)?.args, ['setprefix', '.']);
  assert.equal(parseCommandInput('salut', '', isKnown), null);
  assert.equal(parseCommandInput('salut menu', '', isKnown), null);
  assert.equal(parseCommandInput('menu du restaurant', '', isKnown)?.command, 'menu');
});

test('setprefix off est normalisé en préfixe vide sans perdre la valeur', () => {
  assert.equal(normalisePrefix('off'), '');
  assert.equal(normalisePrefix('none'), '');
  assert.equal(resolveSessionPrefix({ PREFIX: '' }), '');
  assert.equal(resolveSessionPrefix({ PREFIX: '!' }), '!');
  assert.equal(resolveSessionPrefix({}), '.');
  assert.equal(formatPrefix(''), 'off');
});

test('les commandes historiques du switch sont détectées automatiquement', () => {
  const commands = extractLegacyCommands("case 'config': {}\ncase \"welcome\": {}\ncase 'play-video': {}");
  assert.deepEqual([...commands], ['config', 'welcome', 'play-video']);
});

test('le registre prefixless réel contient les commandes historiques mais pas les sous-options config', () => {
  const pairSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pair.js'), 'utf8');
  const commands = extractMainCommandNames(pairSource, [
    'alwaysonline', 'autoview', 'autolike', 'autorec', 'setemoji', 'setprefix', 'show', 'get'
  ]);

  for (const name of ['config', 'menu', 'playvideo', 'ttt', 'welcome']) {
    assert.equal(commands.has(name), true, `${name} doit être reconnu`);
  }
  for (const subcommand of ['alwaysonline', 'setprefix', 'show']) {
    assert.equal(commands.has(subcommand), false, `${subcommand} ne doit pas être une commande autonome`);
  }
  assert.ok(commands.size > 100, 'le registre historique ne doit pas être vide ou tronqué');
});
