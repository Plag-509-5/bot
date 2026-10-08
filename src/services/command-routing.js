'use strict';

const DEFAULT_PREFIX = '.';
const PREFIXLESS_LABEL = 'off';

function normalisePrefix(value, fallback = DEFAULT_PREFIX) {
  if (value === null || value === false) return '';
  if (value === undefined) return fallback;

  const raw = String(value).trim();
  if (!raw || /^(?:off|none|false)$/i.test(raw)) return '';
  return raw;
}

function resolveSessionPrefix(sessionConfig, fallback = DEFAULT_PREFIX) {
  if (sessionConfig && Object.prototype.hasOwnProperty.call(sessionConfig, 'PREFIX')) {
    return normalisePrefix(sessionConfig.PREFIX, fallback);
  }
  return normalisePrefix(fallback, DEFAULT_PREFIX);
}

function parseCommandInput(body, prefix, isKnownCommand = () => true) {
  if (typeof body !== 'string') return null;
  const configuredPrefix = normalisePrefix(prefix, DEFAULT_PREFIX);
  const original = body.trim();
  if (!original) return null;

  let commandText;
  const prefixless = configuredPrefix === '';
  if (prefixless) {
    commandText = original;
  } else {
    if (!original.startsWith(configuredPrefix)) return null;
    commandText = original.slice(configuredPrefix.length).trim();
  }
  if (!commandText) return null;

  const tokens = commandText.split(/\s+/);
  const command = String(tokens.shift() || '').toLowerCase();
  if (!command) return null;

  // En mode sans préfixe, un texte ordinaire doit être ignoré silencieusement.
  if (prefixless && !isKnownCommand(command)) return null;

  return {
    command,
    args: tokens,
    prefix: configuredPrefix,
    prefixless,
    commandText
  };
}

function extractLegacyCommands(source) {
  const commands = new Set();
  const text = String(source || '');
  for (const match of text.matchAll(/\bcase\s+(['"])([^'"\s]+)\1\s*:/g)) {
    commands.add(match[2].toLowerCase());
  }
  return commands;
}

function extractMainCommandNames(source, excluded = []) {
  const text = String(source || '');
  const handlerStart = text.indexOf('function setupCommandHandlers');
  const switchStart = text.indexOf('switch (command)', handlerStart);
  const handlerEnd = text.indexOf('// ---------------- message handlers', switchStart);
  if (handlerStart < 0 || switchStart < 0 || handlerEnd < 0) return new Set();

  const commands = extractLegacyCommands(text.slice(switchStart, handlerEnd));
  for (const name of excluded) commands.delete(String(name).toLowerCase());
  return commands;
}

function formatPrefix(prefix) {
  return normalisePrefix(prefix, DEFAULT_PREFIX) || PREFIXLESS_LABEL;
}

module.exports = {
  DEFAULT_PREFIX,
  PREFIXLESS_LABEL,
  normalisePrefix,
  resolveSessionPrefix,
  parseCommandInput,
  extractLegacyCommands,
  extractMainCommandNames,
  formatPrefix
};
