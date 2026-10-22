'use strict';

function parseAllowedOrigins(value) {
  return [...new Set(String(value || '')
    .split(/[\s,;]+/)
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean))];
}

function applyPairingCors(req, res, env = process.env) {
  const origin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  const allowedOrigins = parseAllowedOrigins(env?.PAIRING_ALLOWED_ORIGINS);
  const allowOrigin = allowedOrigins.length
    ? (allowedOrigins.includes(origin) ? origin : '')
    : '*';
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  if (allowOrigin !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return Boolean(allowOrigin);
}

module.exports = { applyPairingCors, parseAllowedOrigins };
