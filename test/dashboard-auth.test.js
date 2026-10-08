'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  safeReturnTo,
  isProtectedDashboardPath
} = require('../src/services/dashboard-auth');

test('crée un cookie signé qui expire et refuse toute modification', () => {
  const now = 1_700_000_000_000;
  const token = createSessionToken('mot-de-passe-fort', now, 60);
  assert.equal(verifySessionToken(token, 'mot-de-passe-fort', now + 30_000), true);
  assert.equal(verifySessionToken(token, 'mauvais-mot-de-passe', now + 30_000), false);
  assert.equal(verifySessionToken(`${token}x`, 'mot-de-passe-fort', now + 30_000), false);
  assert.equal(verifySessionToken(token, 'mot-de-passe-fort', now + 61_000), false);
});

test('parse le cookie sans dépendance et sécurise les redirections', () => {
  assert.deepEqual(parseCookies('foo=bar; kaido_dashboard=abc.def'), {
    foo: 'bar', kaido_dashboard: 'abc.def'
  });
  assert.equal(safeReturnTo('/dashboard/newsletters.html'), '/dashboard/newsletters.html');
  assert.equal(safeReturnTo('//evil.test'), '/dashboard');
  assert.equal(safeReturnTo('https://evil.test'), '/dashboard');
});

test('protège pages, API et mutations du dashboard mais laisse pairing/login publics', () => {
  for (const path of [
    '/dashboard',
    '/dashboard/admins.html',
    '/api/admins',
    '/admin/add',
    '/newsletter/add',
    '/active',
    '/connect-all',
    '/reconnect',
    '/update-config',
    '/verify-otp',
    '/getabout',
    '/delete'
  ]) {
    assert.equal(isProtectedDashboardPath(path), true, `${path} doit être protégé`);
  }
  for (const path of ['/dashboard/login', '/pair', '/code', '/']) {
    assert.equal(isProtectedDashboardPath(path), false, `${path} doit rester public`);
  }
});
