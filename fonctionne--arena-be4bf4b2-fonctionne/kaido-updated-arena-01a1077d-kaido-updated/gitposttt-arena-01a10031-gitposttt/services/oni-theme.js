'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const TOP_DIVIDER = '༺═────────────⛩────────────═༻';
const BOX_TOP = '╔══════════════════════════════╗';
const BOX_BOTTOM = '╚══════════════════════════════╝';
const THEME_CONTEXT = new AsyncLocalStorage();
const WRAPPED_SOCKET = Symbol('kaidoOniThemeWrapped');
const MAX_SAFE_CAPTION_LENGTH = 1024;
const META_QUOTE_JID = '0@s.whatsapp.net';
const META_QUOTE_EXCLUDED_CONTENT = new Set(['react', 'delete', 'edit', 'pin', 'keepInChat']);
const RELAY_CONTEXT_MESSAGE_TYPES = [
  'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage',
  'documentMessage', 'stickerMessage', 'contactMessage', 'interactiveMessage',
  'buttonsMessage', 'listMessage', 'templateMessage'
];
const RELAY_WRAPPER_TYPES = ['viewOnceMessage', 'viewOnceMessageV2', 'ephemeralMessage', 'documentWithCaptionMessage'];

const BOLD_MAP = Object.fromEntries([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((char, index) => [char, String.fromCodePoint(0x1D5D4 + index)]),
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((char, index) => [char, String.fromCodePoint(0x1D5EE + index)]),
  ...'0123456789'.split('').map((char, index) => [char, String.fromCodePoint(0x1D7EC + index)])
]);

const ITALIC_MAP = Object.fromEntries([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((char, index) => [char, String.fromCodePoint(0x1D63C + index)]),
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((char, index) => [char, String.fromCodePoint(0x1D656 + index)]),
  ...'0123456789'.split('').map((char, index) => [char, String.fromCodePoint(0x1D7EC + index)])
]);

function mapCharacters(value, map) {
  return [...String(value || '')].map(char => map[char] || char).join('');
}

function bold(value) {
  return mapCharacters(value, BOLD_MAP);
}

function italic(value) {
  return mapCharacters(value, ITALIC_MAP);
}

function spacedTitle(value) {
  return String(value || '')
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => [...word].map(char => bold(char)).join(' '))
    .join('  ');
}

function commandText(value) {
  const raw = String(value || '');
  const prefixMatch = raw.match(/^([^a-z0-9]*)(.*)$/i);
  return `${prefixMatch?.[1] || ''}${italic(prefixMatch?.[2] || raw)}`;
}

function sectionHeader(title, icon = '⛩') {
  return `${BOX_TOP}\n║  ${icon}  ${spacedTitle(title)}  ${icon}\n${BOX_BOTTOM}`;
}

function oniHeader(title) {
  return `${TOP_DIVIDER}\n\n     ⟅ 雷 ⟆  ${spacedTitle(title)}  ⟅ 雷 ⟆\n\n${TOP_DIVIDER}`;
}

function oniFooter(label = 'KAIDO MD') {
  return `${TOP_DIVIDER}\n        ❖  ${bold(label.toUpperCase())}  ❖\n${TOP_DIVIDER}`;
}

function isOniThemed(text) {
  return String(text || '').includes(TOP_DIVIDER);
}

function genericCommandResponse(command, text) {
  if (!text || isOniThemed(text)) return text;
  const title = `${String(command || 'KAIDO').replace(/[-_]+/g, ' ')} RESULT`;
  return `${oniHeader(title)}\n\n${sectionHeader('RESPONSE', '⛩')}\n\n${String(text).trim()}\n\n${oniFooter()}`;
}

function normaliseTheme(value) {
  const theme = String(value ?? 'onigashima').trim().toLowerCase();
  return ['none', 'off', 'classic', '1'].includes(theme) ? 'none' : 'onigashima';
}

function isOniThemeEnabled(value) {
  return normaliseTheme(value) === 'onigashima';
}

function withCommandTheme(callback) {
  return THEME_CONTEXT.run({ enabled: false, command: '' }, callback);
}

function activateCommandTheme(command, enabled = true) {
  const state = THEME_CONTEXT.getStore();
  if (!state) return;
  state.command = String(command || 'kaido').toLowerCase();
  state.enabled = Boolean(enabled);
}

function styleContentForCurrentCommand(content, jid = '') {
  const state = THEME_CONTEXT.getStore();
  if (!content || typeof content !== 'object') return content;
  const next = { ...content };
  if (Object.prototype.hasOwnProperty.call(next, '_skipOniTheme')) {
    delete next._skipOniTheme;
    return next;
  }
  // Une commande peut publier le contenu fourni par l'utilisateur sur un
  // statut ou une chaîne. Ce contenu n'est pas une réponse du bot.
  const target = String(jid || '');
  if (
    !state?.enabled
    || target === 'status@broadcast'
    || target.endsWith('@newsletter')
    || content.groupStatus === true
    || content.groupStatusMessageV2
  ) return content;

  let changed = false;
  if (typeof content.text === 'string' && content.text.trim() && !isOniThemed(content.text)) {
    next.text = genericCommandResponse(state.command, content.text);
    changed = true;
  }
  if (typeof content.caption === 'string' && content.caption.trim() && !isOniThemed(content.caption)) {
    const themedCaption = genericCommandResponse(state.command, content.caption);
    // Ne jamais faire échouer l'envoi d'un média pour l'esthétique. Les
    // anciennes versions de WhatsApp limitent encore les captions à 1 024.
    if (themedCaption.length <= MAX_SAFE_CAPTION_LENGTH) {
      next.caption = themedCaption;
      changed = true;
    }
  }
  return changed ? next : content;
}

function createMetaQuote(command = 'kaido') {
  const safeCommand = String(command || 'kaido').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 32) || 'KAIDO';
  return {
    key: {
      remoteJid: 'status@broadcast',
      participant: META_QUOTE_JID,
      fromMe: false,
      id: `META_AI_${safeCommand}`
    },
    message: {
      contactMessage: {
        displayName: 'Meta AI',
        vcard: [
          'BEGIN:VCARD',
          'VERSION:3.0',
          'N:AI;Meta;;;',
          'FN:Meta AI',
          'ORG:Meta Platforms',
          'TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002',
          'END:VCARD'
        ].join('\n')
      }
    }
  };
}

function shouldAttachMetaQuote(jid, content) {
  const state = THEME_CONTEXT.getStore();
  const target = String(jid || '');
  if (!state?.command || !content || typeof content !== 'object') return false;
  if (
    target === 'status@broadcast'
    || target.endsWith('@newsletter')
    || content.groupStatus === true
    || content.groupStatusMessageV2
  ) return false;
  return ![...META_QUOTE_EXCLUDED_CONTENT].some(key => Object.prototype.hasOwnProperty.call(content, key));
}

function styleOptionsForCurrentCommand(options = {}, jid = '', content = {}) {
  const next = { ...(options || {}) };
  if (Object.prototype.hasOwnProperty.call(next, '_skipMetaQuote')) {
    delete next._skipMetaQuote;
    return next;
  }
  if (!shouldAttachMetaQuote(jid, content)) return next;
  return { ...next, quoted: createMetaQuote(THEME_CONTEXT.getStore()?.command) };
}

function addMetaQuoteToRelayMessage(message, quote) {
  if (!message || typeof message !== 'object') return message;
  if (message.groupStatusMessage || message.groupStatusMessageV2 || message.protocolMessage) return message;

  for (const wrapperType of RELAY_WRAPPER_TYPES) {
    const wrapper = message[wrapperType];
    if (!wrapper?.message) continue;
    return {
      ...message,
      [wrapperType]: {
        ...wrapper,
        message: addMetaQuoteToRelayMessage(wrapper.message, quote)
      }
    };
  }

  for (const messageType of RELAY_CONTEXT_MESSAGE_TYPES) {
    const payload = message[messageType];
    if (!payload || typeof payload !== 'object') continue;
    return {
      ...message,
      [messageType]: {
        ...payload,
        contextInfo: {
          ...(payload.contextInfo || {}),
          stanzaId: quote.key.id,
          participant: quote.key.participant,
          remoteJid: quote.key.remoteJid,
          quotedMessage: quote.message
        }
      }
    };
  }
  return message;
}

function styleRelayMessageForCurrentCommand(jid, message, options = {}) {
  const state = THEME_CONTEXT.getStore();
  const target = String(jid || '');
  if (!state?.command || target === 'status@broadcast' || target.endsWith('@newsletter')) return message;
  if (message?.groupStatusMessage || message?.groupStatusMessageV2 || options?._skipMetaQuote) return message;
  return addMetaQuoteToRelayMessage(message, createMetaQuote(state.command));
}

function setupCommandThemeWrapper(socket) {
  if (!socket?.sendMessage || socket[WRAPPED_SOCKET]) return;
  const originalSendMessage = socket.sendMessage.bind(socket);
  socket.sendMessage = (jid, content, options = {}) => {
    const skipMetaQuote = Boolean(content?._skipMetaQuote);
    let cleanContent = content;
    if (content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, '_skipMetaQuote')) {
      cleanContent = { ...content };
      delete cleanContent._skipMetaQuote;
    }
    const styledContent = styleContentForCurrentCommand(cleanContent, jid);
    const styledOptions = styleOptionsForCurrentCommand(
      skipMetaQuote ? { ...options, _skipMetaQuote: true } : options,
      jid,
      styledContent
    );
    return originalSendMessage(jid, styledContent, styledOptions);
  };
  if (typeof socket.relayMessage === 'function') {
    const originalRelayMessage = socket.relayMessage.bind(socket);
    socket.relayMessage = (jid, message, options = {}) => {
      const skipMetaQuote = Boolean(options?._skipMetaQuote);
      const cleanOptions = { ...(options || {}) };
      delete cleanOptions._skipMetaQuote;
      const styledMessage = styleRelayMessageForCurrentCommand(
        jid,
        message,
        skipMetaQuote ? { ...cleanOptions, _skipMetaQuote: true } : cleanOptions
      );
      return originalRelayMessage(jid, styledMessage, cleanOptions);
    };
  }
  Object.defineProperty(socket, WRAPPED_SOCKET, { value: true });
}

module.exports = {
  TOP_DIVIDER,
  BOX_TOP,
  BOX_BOTTOM,
  bold,
  italic,
  spacedTitle,
  commandText,
  sectionHeader,
  oniHeader,
  oniFooter,
  isOniThemed,
  genericCommandResponse,
  normaliseTheme,
  isOniThemeEnabled,
  withCommandTheme,
  activateCommandTheme,
  styleContentForCurrentCommand,
  createMetaQuote,
  shouldAttachMetaQuote,
  styleOptionsForCurrentCommand,
  addMetaQuoteToRelayMessage,
  styleRelayMessageForCurrentCommand,
  setupCommandThemeWrapper
};
