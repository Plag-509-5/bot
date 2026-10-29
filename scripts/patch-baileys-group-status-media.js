'use strict';

/**
 * Baileys 7.0.0-rc14 detects `<enc mediatype="…">` from the outer message.
 * Group statuses wrap the payload in groupStatusMessageV2, so rc14 misses
 * image/video/audio unless it normalizes the envelope first. The sendMessage
 * wrapper also drops caller-provided relay attributes/cache policy, which is
 * needed when revoking LID-addressed personal statuses. Keep both changes
 * narrowly scoped and idempotent for the pinned Baileys release.
 */

const fs = require('node:fs');
const path = require('node:path');

const NORMALIZE_LINE = 'message = normalizeMessageContent(message) || message;';
const GET_MEDIA_TYPE_SIGNATURE = 'const getMediaType = (message) => {';
const IMAGE_BRANCH = 'if (message.imageMessage) {';
const SEND_MESSAGE_RELAY_SIGNATURE = 'await relayMessage(jid, fullMsg.message, {';
const RELAY_ADDITIONAL_ATTRIBUTES_LINE = 'additionalAttributes: { ...(options.additionalAttributes || {}), ...additionalAttributes },';
const RELAY_DEVICE_CACHE_LINE = 'useUserDevicesCache: options.useUserDevicesCache,';

function patchMediaTypeRelay(source) {
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

function patchPersonalStatusRelayOptions(source) {
  const input = String(source || '');
  const callStart = input.indexOf(SEND_MESSAGE_RELAY_SIGNATURE);
  if (callStart < 0) {
    throw new Error('Baileys relay patch: appel sendMessage → relayMessage introuvable.');
  }
  const callEnd = input.indexOf('});', callStart);
  if (callEnd < 0) {
    throw new Error('Baileys relay patch: options de sendMessage → relayMessage incomplètes.');
  }
  const callSource = input.slice(callStart, callEnd);
  if (callSource.includes(RELAY_ADDITIONAL_ATTRIBUTES_LINE)
      && callSource.includes(RELAY_DEVICE_CACHE_LINE)) {
    return { source: input, changed: false };
  }

  const attributeLine = callSource.match(/^(\s*)additionalAttributes,\s*$/m);
  if (!attributeLine) {
    throw new Error('Baileys relay patch: option additionalAttributes de sendMessage introuvable.');
  }
  const newline = input.includes('\r\n') ? '\r\n' : '\n';
  const indent = attributeLine[1];
  const replacement = [
    `${indent}${RELAY_ADDITIONAL_ATTRIBUTES_LINE}`,
    `${indent}${RELAY_DEVICE_CACHE_LINE}`
  ].join(newline);
  const absoluteLineStart = callStart + attributeLine.index;
  const absoluteLineEnd = absoluteLineStart + attributeLine[0].length;

  return {
    source: input.slice(0, absoluteLineStart)
      + replacement
      + input.slice(absoluteLineEnd),
    changed: true
  };
}

function patchRelaySource(source) {
  const mediaPatch = patchMediaTypeRelay(source);
  const optionsPatch = patchPersonalStatusRelayOptions(mediaPatch.source);
  return {
    source: optionsPatch.source,
    changed: mediaPatch.changed || optionsPatch.changed
  };
}

function patchInstalledBaileys() {
  const entry = require.resolve('@whiskeysockets/baileys');
  const sourcePath = path.join(path.dirname(entry), 'Socket', 'messages-send.js');
  const original = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchRelaySource(original);

  if (patched.changed) {
    fs.writeFileSync(sourcePath, patched.source, 'utf8');
    console.log('[postinstall] Baileys: compatibilité groupStatusMessageV2 et relay LID des statuts activées.');
  }
}

if (require.main === module) {
  try {
    patchInstalledBaileys();
  } catch (error) {
    console.error('[postinstall] Impossible de corriger le relay Baileys:', error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  patchRelaySource,
  patchMediaTypeRelay,
  patchPersonalStatusRelayOptions,
  patchInstalledBaileys
};
