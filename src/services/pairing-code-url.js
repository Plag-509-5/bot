'use strict';

const os = require('node:os');
const net = require('node:net');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const VIEW_ROUTE = '/code';

function resolvePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_PORT;
}

function isUsableIpv4(address) {
  if (!address || typeof address !== 'string' || address === '127.0.0.1') return false;
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  // Loopback, unspecified, broadcast and link-local addresses are not reliable
  // targets here. Private RFC1918 addresses work on the local NIC.
  return ![0, 127, 255].includes(octets[0])
    && !(octets[0] === 169 && octets[1] === 254);
}

/** Pick a local IPv4 address when a hosting platform has not supplied a URL. */
function detectLocalHost(networkInterfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [interfaceName, addresses] of Object.entries(networkInterfaces || {})) {
    for (const entry of Array.isArray(addresses) ? addresses : []) {
      const family = entry?.family;
      const isIpv4 = family === 'IPv4' || family === 4 || !family && String(entry?.address || '').includes('.');
      if (isIpv4 && !entry?.internal && isUsableIpv4(entry?.address)) {
        candidates.push({ interfaceName, address: entry.address });
      }
    }
  }

  // Prefer a primary Ethernet/Wi-Fi interface over virtual/tunnel interfaces;
  // the OS order is retained as the tie-breaker for other interface names.
  const preferred = candidates.find(({ interfaceName }) => /^(eth|en|wlan|wifi)/i.test(interfaceName));
  return (preferred || candidates[0])?.address || DEFAULT_HOST;
}

function addIpv6Brackets(host) {
  const raw = String(host || '').trim();
  if (/^\[[^\]]+\](?::\d+)?$/.test(raw)) return raw;
  if (net.isIP(raw) === 6) return `[${raw}]`;
  return raw;
}

function resolveHost(value, protocolOverride) {
  const raw = String(value || DEFAULT_HOST).trim();
  const protocol = protocolOverride === 'https' ? 'https:' : 'http:';
  let parsed;
  try {
    if (/^https?:\/\//i.test(raw)) {
      parsed = new URL(raw);
    } else {
      const hostValue = raw.startsWith('//') ? raw.slice(2) : raw;
      parsed = new URL(`${protocol}//${addIpv6Brackets(hostValue)}`);
    }
  } catch {
    return { host: raw || DEFAULT_HOST, protocol };
  }

  let host = parsed.hostname;
  let resolvedProtocol = protocolOverride === 'https' ? 'https:' : parsed.protocol;
  // 0.0.0.0/:: are bind addresses, not client destinations.
  if (host === '0.0.0.0' || host === '::' || host === '[::]') host = DEFAULT_HOST;
  return { host, protocol: resolvedProtocol };
}

function firstConfiguredValue(env, keys) {
  for (const key of keys) {
    const value = String(env?.[key] || '').trim();
    if (value) return { key, value };
  }
  return null;
}

function parseConfiguredUrl(value, protocolOverride) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const hasScheme = /^https?:\/\//i.test(raw);
  const defaultProtocol = protocolOverride === 'https' ? 'https:' : 'http:';
  let parsed = null;
  try {
    if (hasScheme) {
      parsed = new URL(raw);
    } else {
      const hostValue = raw.startsWith('//') ? raw.slice(2) : raw;
      parsed = new URL(`${defaultProtocol}//${addIpv6Brackets(hostValue)}`);
    }
  } catch {
    return null;
  }

  let host = parsed.hostname;
  if (host === '0.0.0.0' || host === '::' || host === '[::]') host = DEFAULT_HOST;
  const prefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return {
    host,
    protocol: protocolOverride === 'https' ? 'https:' : parsed.protocol,
    port: parsed.port ? Number(parsed.port) : null,
    prefix
  };
}

/**
 * Resolve the app's pairing endpoint in this order:
 *   1. A complete PAIRING_API_URL/PAIRING_BASE_URL (including public HTTPS URL).
 *   2. Explicit app/host settings and hosting-provider public domains.
 *   3. The first usable local IPv4 interface, then loopback.
 *
 * The Express port remains dynamic for local/interface hosts; public provider
 * URLs use the platform's external 80/443 port instead of the private PORT.
 */
function resolvePairingTarget(env = process.env, networkInterfaces = os.networkInterfaces()) {
  const completeApiUrl = firstConfiguredValue(env, ['PAIRING_API_URL', 'PAIRING_BASE_URL']);
  if (completeApiUrl) {
    return {
      ...parseConfiguredUrl(completeApiUrl.value, env.PAIRING_PROTOCOL),
      // A complete URL already identifies the externally reachable origin; the
      // platform's private PORT must not be appended to it.
      usesPlatformPort: true,
      source: completeApiUrl.key
    };
  }

  const explicitHost = firstConfiguredValue(env, [
    'PAIRING_HOST',
    'SITE_IP',
    'SITE_URL',
    'PAIRING_API_HOST',
    'SERVER_IP',
    'HOST_IP'
  ]);
  if (explicitHost) {
    return {
      ...parseConfiguredUrl(explicitHost.value, env.PAIRING_PROTOCOL),
      usesPlatformPort: false,
      source: explicitHost.key
    };
  }

  const providerUrl = firstConfiguredValue(env, [
    'RENDER_EXTERNAL_URL',
    'RAILWAY_STATIC_URL',
    'RAILWAY_PUBLIC_DOMAIN',
    'REPLIT_DEV_DOMAIN',
    'REPLIT_DOMAINS',
    'VERCEL_URL',
    'KOYEB_PUBLIC_DOMAIN'
  ]);
  if (providerUrl) {
    let value = providerUrl.value.split(',')[0].trim();
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    return {
      ...parseConfiguredUrl(value, env.PAIRING_PROTOCOL),
      usesPlatformPort: true,
      source: providerUrl.key
    };
  }

  const bindHost = firstConfiguredValue(env, ['HOST', 'BIND_HOST']);
  const usableBindHost = bindHost && !['0.0.0.0', '::', '[::]'].includes(bindHost.value)
    ? bindHost.value
    : detectLocalHost(networkInterfaces);
  return {
    ...parseConfiguredUrl(usableBindHost, env.PAIRING_PROTOCOL),
    usesPlatformPort: false,
    source: bindHost ? bindHost.key : 'network-interface'
  };
}

/**
 * Build the URL called by `.code` to ask the existing Express `/code` API to
 * issue a Baileys pairing code. The local port is taken from the live PORT env.
 */
function createPairingCodeUrl(number, env = process.env, networkInterfaces = os.networkInterfaces()) {
  const target = resolvePairingTarget(env, networkInterfaces);
  if (!target?.host || !target?.protocol) {
    throw new Error('Impossible de déterminer l’adresse du serveur de pairing.');
  }

  const url = new URL(`${target.protocol}//${target.host}`);
  if (target.port) {
    url.port = String(target.port);
  } else if (!target.usesPlatformPort) {
    url.port = String(resolvePort(env.PAIRING_PORT || env.PORT));
  }

  const prefix = target.prefix || '';
  const path = prefix.endsWith(VIEW_ROUTE) ? prefix : `${prefix}${VIEW_ROUTE}`;
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  url.searchParams.set('number', String(number || '').replace(/[^0-9]/g, ''));
  return url.toString();
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST,
  VIEW_ROUTE,
  resolvePort,
  resolveHost,
  detectLocalHost,
  resolvePairingTarget,
  createPairingCodeUrl
};
