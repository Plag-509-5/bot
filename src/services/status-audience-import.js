'use strict';

const { parseStatusViewerNumbers } = require('./status-audience');

// Import large vCards without imposing an unexpectedly small upload ceiling.
const MAX_STATUS_IMPORT_BYTES = 50 * 1024 * 1024;

function normalizeCandidate(value) {
  let compact = String(value || '').replace(/[^0-9]/g, '');
  if (compact.startsWith('00')) compact = compact.slice(2);
  const parsed = parseStatusViewerNumbers([compact]);
  return parsed.numbers[0] || '';
}

function addCandidate(numbers, value) {
  const number = normalizeCandidate(value);
  if (number && !numbers.includes(number)) numbers.push(number);
}

function unfoldVCardLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function extractVCardNumbers(text) {
  const numbers = [];
  const lines = unfoldVCardLines(text).split('\n');
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const property = line.slice(0, separator).trim();
    if (!/^(?:item\d+\.)?TEL(?:;|$)/i.test(property)) continue;

    const parameters = property.slice(property.indexOf('TEL') + 3);
    for (const match of parameters.matchAll(/(?:^|[;=])waid=([^;]+)/ig)) {
      addCandidate(numbers, match[1]);
    }
    const phoneValue = line.slice(separator + 1).trim().replace(/^tel:/i, '').split(/[;,]/, 1)[0];
    addCandidate(numbers, phoneValue);
  }
  return numbers;
}

function extractPlainTextNumbers(text) {
  const numbers = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/[\n,;|]+/);

  for (let line of lines) {
    line = line.trim().replace(/^(?:[-*•]\s*)?\d{1,3}[.)]\s*/, '');
    if (!line || /\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(line)) continue;

    const lineNumbers = [];
    const international = [...line.matchAll(/(?:\+|00)\s*\d(?:[\d().\s-]*\d)?/g)];
    let remaining = line;
    for (const match of international) {
      addCandidate(lineNumbers, match[0]);
      remaining = remaining.replace(match[0], ' ');
    }

    const contiguous = remaining.match(/(?<![A-Za-z0-9])\d{6,15}(?![A-Za-z0-9])/g) || [];
    for (const candidate of contiguous) addCandidate(lineNumbers, candidate);

    // Accepte aussi une ligne du type « Nom: 509 1234 5678 » sans indicatif +.
    // Si des numéros contigus ont déjà été trouvés, ne concatène pas d’autres chiffres
    // (numéro de ligne, identifiant ou extension) avec eux.
    if (!lineNumbers.length) {
      const digits = line.replace(/\D/g, '');
      addCandidate(lineNumbers, digits);
    }

    for (const number of lineNumbers) {
      if (!numbers.includes(number)) numbers.push(number);
    }
  }
  return numbers;
}

function extractStatusViewerNumbers(text, options = {}) {
  const content = String(text || '');
  const isVCard = options.vcard === true
    || /BEGIN:VCARD/i.test(content)
    || /^\s*(?:item\d+\.)?TEL(?:;[^:]*)?:/im.test(content);
  return isVCard ? extractVCardNumbers(content) : extractPlainTextNumbers(content);
}

module.exports = {
  MAX_STATUS_IMPORT_BYTES,
  extractStatusViewerNumbers,
  extractVCardNumbers,
  extractPlainTextNumbers,
  unfoldVCardLines,
  _test: { normalizeCandidate, addCandidate }
};
