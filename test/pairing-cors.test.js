'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPairingCors, parseAllowedOrigins } = require('../src/services/pairing-cors');

function response() {
  const headers = {};
  return { headers, setHeader(name, value) { headers[name] = value; } };
}

test('pairing API autorise le fetch public d’une page hébergée à l’extérieur', () => {
  const res = response();
  assert.equal(applyPairingCors({ headers: { origin: 'https://kaido-pair.vercel.app' } }, res, {}), true);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('PAIRING_ALLOWED_ORIGINS restreint le navigateur aux origines configurées', () => {
  assert.deepEqual(parseAllowedOrigins('https://a.example, https://b.example/'), ['https://a.example', 'https://b.example']);
  const res = response();
  assert.equal(applyPairingCors({ headers: { origin: 'https://allowed.example' } }, res, {
    PAIRING_ALLOWED_ORIGINS: 'https://allowed.example'
  }), true);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://allowed.example');
  const denied = response();
  assert.equal(applyPairingCors({ headers: { origin: 'https://other.example' } }, denied, {
    PAIRING_ALLOWED_ORIGINS: 'https://allowed.example'
  }), false);
  assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
});
