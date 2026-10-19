'use strict';

const VIEW_ONCE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage'
];

const MEDIA_FIELDS = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker']
];

/**
 * Locate media inside Baileys' nested ephemeral/view-once wrappers.
 * The returned source content is not mutated so it can also be used by
 * reaction-command aliases which receive the original quoted message.
 */
function extractViewOnceMedia(message) {
  let current = message;
  let isViewOnce = false;
  const wrappers = [];

  for (let depth = 0; depth < 16 && current && typeof current === 'object'; depth += 1) {
    let next = null;
    let usedWrapper = '';
    for (const wrapper of VIEW_ONCE_WRAPPERS) {
      const wrappedMessage = current?.[wrapper]?.message;
      if (!wrappedMessage || typeof wrappedMessage !== 'object' || wrappedMessage === current) continue;
      usedWrapper = wrapper;
      next = wrappedMessage;
      break;
    }
    if (!next) break;
    if (usedWrapper.startsWith('viewOnce')) isViewOnce = true;
    wrappers.push(usedWrapper);
    current = next;
  }

  for (const [field, type] of MEDIA_FIELDS) {
    const content = current?.[field];
    if (!content || typeof content !== 'object') continue;
    if (content.viewOnce === true) isViewOnce = true;
    return {
      field,
      type,
      content,
      message: current,
      isViewOnce,
      wrappers
    };
  }

  return null;
}

module.exports = {
  VIEW_ONCE_WRAPPERS,
  MEDIA_FIELDS,
  extractViewOnceMedia
};
