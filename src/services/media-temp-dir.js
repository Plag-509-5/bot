'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Baileys 7 streams media to encrypted files under os.tmpdir(). VPS /tmp may
 * be a small tmpfs even when the attached SSD is much larger. Point all Node
 * temp-file users at an explicitly configured persistent/mounted volume.
 * No disk quota is enforced here; the operating system remains authoritative.
 * Without an override, use the bot's own tmp volume instead of a small /tmp tmpfs.
 */
function configureWhatsAppMediaTempDir(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fs || fs;
  const requested = String(
    options.directory
    || env.WHATSAPP_MEDIA_TEMP_DIR
    || env.BAILEYS_MEDIA_TEMP_DIR
    || env.TMPDIR
    || env.TMP
    || env.TEMP
    || path.join(options.cwd || process.cwd(), 'tmp', 'whatsapp-media')
  ).trim();

  if (!requested) {
    return { configured: false, directory: os.tmpdir() };
  }

  const directory = path.resolve(requested);
  fsImpl.mkdirSync(directory, { recursive: true });
  fsImpl.accessSync(directory, fs.constants.W_OK);

  // Baileys calls os.tmpdir() at upload time; it honors these environment
  // variables. Setting them before socket construction also covers media
  // thumbnails and sends initiated from plugins.
  env.TMPDIR = directory;
  env.TMP = directory;
  env.TEMP = directory;
  return { configured: true, directory };
}

module.exports = { configureWhatsAppMediaTempDir };
