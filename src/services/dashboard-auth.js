'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'kaido_dashboard';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signPayload(payload, password) {
  return crypto.createHmac('sha256', password).update(payload).digest('base64url');
}

function createSessionToken(password, now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!password) throw new Error('ADMIN_PASS non configuré');
  const payload = Buffer.from(JSON.stringify({
    exp: now + ttlSeconds * 1000,
    nonce: crypto.randomBytes(12).toString('base64url')
  })).toString('base64url');
  return `${payload}.${signPayload(payload, password)}`;
}

function verifySessionToken(token, password, now = Date.now()) {
  if (!token || !password) return false;
  const [payload, signature, extra] = String(token).split('.');
  if (!payload || !signature || extra || !safeEqual(signature, signPayload(payload, password))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(data.exp) && data.exp > now;
  } catch (_) {
    return false;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function safeReturnTo(value) {
  const path = String(value || '');
  if (!path.startsWith('/dashboard') || path.startsWith('//') || /[\r\n]/.test(path)) return '/dashboard';
  return path;
}

function isProtectedDashboardPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  if (path === '/dashboard/login' || path === '/dashboard/logout') return false;
  if (path === '/dashboard' || path.startsWith('/dashboard/')) return true;
  if (path.startsWith('/api/')) return true;
  if (path.startsWith('/admin/') || path.startsWith('/newsletter/')) return true;
  return ['/active', '/connect-all', '/reconnect', '/update-config', '/verify-otp', '/getabout', '/delete'].includes(path);
}

function createDashboardAuth(options = {}) {
  const getPassword = options.getPassword || (() => process.env.ADMIN_PASS || '');
  const ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SECONDS;
  const attempts = new Map();
  const maxAttempts = options.maxAttempts || 5;
  const blockMs = options.blockMs || 15 * 60 * 1000;

  function clientIp(req) {
    return String(req.ip || req.socket?.remoteAddress || 'unknown');
  }

  function setAuthCookie(req, res, token) {
    const secure = Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${ttlSeconds}`
    ];
    if (secure) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  function clearAuthCookie(req, res) {
    const secure = Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
  }

  function isAuthenticated(req) {
    const password = getPassword();
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return verifySessionToken(token, password);
  }

  function requireAuth(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    if (isAuthenticated(req)) return next();
    const acceptsHtml = req.method === 'GET' && String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      return res.redirect(`/dashboard/login?returnTo=${encodeURIComponent(safeReturnTo(req.originalUrl || req.url))}`);
    }
    return res.status(401).json({ ok: false, error: 'Mot de passe du dashboard requis.' });
  }

  function protectDashboardRequests(req, res, next) {
    return isProtectedDashboardPath(req.path || req.url) ? requireAuth(req, res, next) : next();
  }

  function login(req, res) {
    const password = getPassword();
    if (!password) return res.status(503).json({ ok: false, error: 'ADMIN_PASS doit être défini dans le fichier .env.' });

    const ip = clientIp(req);
    const state = attempts.get(ip);
    if (state?.blockedUntil > Date.now()) {
      return res.status(429).json({ ok: false, error: 'Trop de tentatives. Réessayez plus tard.' });
    }

    if (!safeEqual(req.body?.password, password)) {
      const failures = (state?.failures || 0) + 1;
      attempts.set(ip, {
        failures,
        blockedUntil: failures >= maxAttempts ? Date.now() + blockMs : 0
      });
      return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
    }

    attempts.delete(ip);
    setAuthCookie(req, res, createSessionToken(password, Date.now(), ttlSeconds));
    return res.json({ ok: true, redirect: safeReturnTo(req.body?.returnTo) });
  }

  function logout(req, res) {
    clearAuthCookie(req, res);
    return res.redirect('/dashboard/login');
  }

  return {
    isAuthenticated,
    requireAuth,
    protectDashboardRequests,
    login,
    logout
  };
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  safeEqual,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  safeReturnTo,
  isProtectedDashboardPath,
  createDashboardAuth
};
