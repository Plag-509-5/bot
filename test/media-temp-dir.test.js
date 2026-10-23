'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureWhatsAppMediaTempDir } = require('../src/services/media-temp-dir');

test('Baileys media temporary files can target a writable SSD mount without an application quota', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-media-test-'));
  const mediaDir = path.join(root, 'ssd-volume', 'whatsapp');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { WHATSAPP_MEDIA_TEMP_DIR: mediaDir };

  const result = configureWhatsAppMediaTempDir({ env });
  assert.deepEqual(result, { configured: true, directory: mediaDir });
  assert.ok(fs.statSync(mediaDir).isDirectory());
  assert.equal(env.TMPDIR, mediaDir);
  assert.equal(env.TMP, mediaDir);
  assert.equal(env.TEMP, mediaDir);
});

test('sans chemin dédié, conserve le chemin temporaire défini par le système', () => {
  const env = {};
  const result = configureWhatsAppMediaTempDir({ env });
  assert.deepEqual(result, { configured: false, directory: os.tmpdir() });
  assert.equal(env.TMPDIR, undefined);
});
