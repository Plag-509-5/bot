'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createPairingCodeUrl,
  resolvePort
} = require('../src/services/pairing-code-url');

test('la commande .code utilise loopback et le port configuré du serveur', () => {
  const url = new URL(createPairingCodeUrl('+509 4744-0869', { PORT: '48127' }));
  assert.equal(url.origin, 'http://127.0.0.1:48127');
  assert.equal(url.pathname, '/code');
  assert.equal(url.searchParams.get('number'), '50947440869');
});

test('une requête .code rejoint en local un serveur lié sur un port éphémère', async (t) => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    response.end(JSON.stringify({ path: url.pathname, number: url.searchParams.get('number') }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = createPairingCodeUrl('50947440869', { PORT: String(address.port) });
  const result = await new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { path: '/code', number: '50947440869' });
});

test('l’hôte du site est configurable et le port est résolu dynamiquement', () => {
  const url = new URL(createPairingCodeUrl('50912345678', {
    SITE_IP: '192.0.2.24',
    PORT: '8765'
  }));
  assert.equal(url.origin, 'http://192.0.2.24:8765');
  assert.equal(url.searchParams.get('number'), '50912345678');
});

test('un SITE_URL HTTPS conserve son protocole et IPv6 est correctement encadré', () => {
  const url = new URL(createPairingCodeUrl('50912345678', {
    SITE_URL: 'https://[2001:db8::1]/',
    PORT: '9443'
  }));
  assert.equal(url.origin, 'https://[2001:db8::1]:9443');
});

test('la résolution du port retombe sur le port Express par défaut si PORT est invalide', () => {
  assert.equal(resolvePort('not-a-port'), DEFAULT_PORT);
  assert.equal(resolvePort('0'), DEFAULT_PORT);
  assert.equal(new URL(createPairingCodeUrl('50912345678', {})).hostname, DEFAULT_HOST);
});
