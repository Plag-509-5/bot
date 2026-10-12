'use strict';

/**
 * Baileys 7.0.0-rc14 detects the `<enc mediatype="…">` value from the outer
 * message object. A group status wraps that object in groupStatusMessageV2, so
 * rc14 misses image/video/audio unless it normalizes the envelope first.
 * NYXCORE's relay does this normalization already. Keep the official socket's
 * relay equivalent with this narrowly scoped, idempotent postinstall patch.
 */

const fs = require('node:fs');
const path = require('node:path');

const NORMALIZE_LINE = 'message = normalizeMessageContent(message) || message;';
const GET_MEDIA_TYPE_SIGNATURE = 'const getMediaType = (message) => {';
const IMAGE_BRANCH = 'if (message.imageMessage) {';

function patchRelaySource(source) {
  const input = String(source || '');
  const functionStart = input.indexOf(GET_MEDIA_TYPE_SIGNATURE);
  if (functionStart < 0) {
    throw new Error('Baileys relay patch: getMediaType() introuvable.');
  }

  const functionEnd = input.indexOf('\n    };', functionStart);
  if (functionEnd < 0) {
    throw new Error('Baileys relay patch: fin de getMediaType() introuvable.');
  }

  const functionSource = input.slice(functionStart, functionEnd);
  if (functionSource.includes(NORMALIZE_LINE)) {
    return { source: input, changed: false };
  }

  const imageBranchIndex = input.indexOf(IMAGE_BRANCH, functionStart);
  if (imageBranchIndex < 0 || imageBranchIndex >= functionEnd) {
    throw new Error('Baileys relay patch: branche image de getMediaType() introuvable.');
  }

  const lineStart = input.lastIndexOf('\n', imageBranchIndex) + 1;
  const indent = input.slice(lineStart, imageBranchIndex);
  if (!/^\s*$/.test(indent)) {
    throw new Error('Baileys relay patch: indentation de getMediaType() inattendue.');
  }

  const newline = input.includes('\r\n') ? '\r\n' : '\n';
  const replacement = `${indent}${NORMALIZE_LINE}${newline}${indent}${IMAGE_BRANCH}`;
  return {
    source: input.slice(0, lineStart)
      + replacement
      + input.slice(imageBranchIndex + IMAGE_BRANCH.length),
    changed: true
  };
}

function patchInstalledBaileys() {
  const entry = require.resolve('@whiskeysockets/baileys');
  const sourcePath = path.join(path.dirname(entry), 'Socket', 'messages-send.js');
  const original = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchRelaySource(original);

  if (patched.changed) {
    fs.writeFileSync(sourcePath, patched.source, 'utf8');
    console.log('[postinstall] Baileys: compatibilité mediaType groupStatusMessageV2 activée.');
  }
}

if (require.main === module) {
  try {
    patchInstalledBaileys();
  } catch (error) {
    console.error('[postinstall] Impossible de corriger le relay média Baileys:', error.message);
    process.exitCode = 1;
  }
}

module.exports = { patchRelaySource, patchInstalledBaileys };
