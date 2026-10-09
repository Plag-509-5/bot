'use strict';

/**
 * Alias sticker : un sticker déclenche la commande associée, par session.
 * Le test charge le cache en mémoire (cacheSticker) et n'écrit JAMAIS sur le
 * disque, pour ne pas modifier config/data/sticker_commands.json.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const sticker = require('../src/features/sticker_cmd');

// Forme exacte d'un stickerMessage reçu de Baileys : hachages en Buffer.
const received = {
  fileSha256: Buffer.from('ABCDEF0123456789abcdef', 'hex'),
  mediaKey: Buffer.from([1, 2, 3, 4]),
  fileEncSha256: Buffer.from([9, 8, 7, 6]),
  mimetype: 'image/webp'
};

test('un hachage de sticker reçu en Buffer donne une clé stable', () => {
  const hash = sticker.getPrimaryStickerHash(received);
  assert.equal(typeof hash, 'string');
  assert.equal(sticker.getPrimaryStickerHash({ fileSha256: new Uint8Array(received.fileSha256) }), hash);
});

test('un sticker enregistré déclenche sa commande dans la même session seulement', () => {
  const hash = sticker.getPrimaryStickerHash(received);
  sticker._test.cacheSticker({ hash, command: 'ping', sessionId: '50947440869' });

  assert.equal(sticker.findStickerCommand(received, '50947440869')?.command, 'ping');
  assert.equal(sticker.findStickerCommand(received, '50990000000'), null, 'autre session : pas de déclenchement');
});

test('un sticker inconnu ne déclenche rien', () => {
  const other = { fileSha256: Buffer.from('0000000000000000', 'hex') };
  assert.equal(sticker.findStickerCommand(other, '50947440869'), null);
});
