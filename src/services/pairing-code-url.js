'use strict';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

function resolvePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_PORT;
}

function resolveHost(value, protocolOverride) {
  const raw = String(value || DEFAULT_HOST).trim();
  let host = raw;
  let protocol = protocolOverride === 'https' ? 'https:' : 'http:';

  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    host = parsed.hostname;
    if (!protocolOverride) protocol = parsed.protocol;
  }

  // `URL.hostname` retains brackets for IPv6 in Node. Add them only when the
  // caller supplied an unbracketed IPv6 literal.
  if (host.includes(':') && !(host.startsWith('[') && host.endsWith(']'))) {
    host = `[${host}]`;
  }
  return { host, protocol };
}

/**
 * Adresse interne du serveur de pairing : hôte configurable (IP du site) ou
 * loopback par défaut, et port du déploiement (`PORT`) plutôt qu'un domaine fixe.
 */
function createPairingCodeUrl(number, env = process.env) {
  const configuredHost = env.PAIRING_HOST || env.SITE_IP || env.SITE_URL || DEFAULT_HOST;
  const { host, protocol } = resolveHost(configuredHost, env.PAIRING_PROTOCOL);
  const port = resolvePort(env.PORT);
  const url = new URL(`${protocol}//${host}:${port}/code`);
  url.searchParams.set('number', String(number || '').replace(/[^0-9]/g, ''));
  return url.toString();
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  resolvePort,
  resolveHost,
  createPairingCodeUrl
};
