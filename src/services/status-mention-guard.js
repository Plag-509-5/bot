'use strict';

const VALID_ANTI_STATUS_MODES = new Set(['off', 'delete', 'remove']);

function resolveAntiStatusMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return VALID_ANTI_STATUS_MODES.has(mode) ? mode : 'off';
}

function formatKaidoStatusMention(title, details = []) {
  const safeTitle = String(title || 'Mention de statut détectée').trim();
  const lines = [
    '╭━━━〔 🐉 𝐊𝐀𝐈𝐃𝐎 𝐌𝐃 〕━━━',
    `┃ ⚡ *${safeTitle}*`,
    ...details.map(detail => `┃ ${String(detail || '').trim()}`),
    '╰━━━━━━━━━━━━━━━━━━━━',
    '> KAIDO MD • GARDIEN D’ONIGASHIMA'
  ];
  return lines.join('\n');
}

module.exports = {
  VALID_ANTI_STATUS_MODES,
  resolveAntiStatusMode,
  formatKaidoStatusMention
};
