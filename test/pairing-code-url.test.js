'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createPairingCodeUrl,
  detectLocalHost,
  resolvePort
} = require('../src/services/pairing-code-url');

const LOCAL_INTERFACES = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
};

test('la commande .code utilise la route API /code et le port dynamique configuré', () => {
  const url = new URL(createPairingCodeUrl('+509 4744-0869', {
    PAIRING_HOST: '127.0.0.1',
    PORT: '48127'
  }));
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
  const url = createPairingCodeUrl('50947440869', {
    PAIRING_HOST: '127.0.0.1',
    PORT: String(address.port)
  });
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

test('l’IP locale est détectée automatiquement et combinée au port courant', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [
      { address: '169.254.2.10', family: 'IPv4', internal: false },
      { address: '10.10.0.8', family: 'IPv4', internal: false }
    ],
    wlan0: [{ address: '192.168.1.4', family: 'IPv4', internal: false }]
  };
  assert.equal(detectLocalHost(interfaces), '10.10.0.8');

  const url = new URL(createPairingCodeUrl('50912345678', { PORT: '8765' }, interfaces));
  assert.equal(url.origin, 'http://10.10.0.8:8765');
  assert.equal(url.searchParams.get('number'), '50912345678');
});

test('un hôte explicite et un SITE_URL HTTPS conservent le protocole et le port dynamique', () => {
  const siteIp = new URL(createPairingCodeUrl('50912345678', {
    SITE_IP: '192.0.2.24',
    PORT: '8765'
  }, LOCAL_INTERFACES));
  assert.equal(siteIp.origin, 'http://192.0.2.24:8765');

  const siteUrl = new URL(createPairingCodeUrl('50912345678', {
    SITE_URL: 'https://[2001:db8::1]/',
    PORT: '9443'
  }, LOCAL_INTERFACES));
  assert.equal(siteUrl.origin, 'https://[2001:db8::1]:9443');
});

test('PAIRING_HOST peut inclure un port explicite qui prévaut sur PORT', () => {
  const url = new URL(createPairingCodeUrl('50912345678', {
    PAIRING_HOST: '192.0.2.24:8877',
    PORT: '3000'
  }, LOCAL_INTERFACES));
  assert.equal(url.origin, 'http://192.0.2.24:8877');
  assert.equal(url.pathname, '/code');
});

test('PAIRING_API_URL conserve son URL complète et ajoute la route pairing', () => {
  const url = new URL(createPairingCodeUrl('50912345678', {
    PAIRING_API_URL: 'https://pair.example.test:8443/service/',
    PORT: '3000'
  }, LOCAL_INTERFACES));
  assert.equal(url.origin, 'https://pair.example.test:8443');
  assert.equal(url.pathname, '/service/code');
  assert.equal(url.searchParams.get('number'), '50912345678');
});

test('une URL publique de plateforme utilise le port HTTP(S) externe, pas le PORT interne', () => {
  const url = new URL(createPairingCodeUrl('50912345678', {
    RAILWAY_PUBLIC_DOMAIN: 'kaido-production.up.railway.app',
    PORT: '32768'
  }, LOCAL_INTERFACES));
  assert.equal(url.origin, 'https://kaido-production.up.railway.app');
  assert.equal(url.pathname, '/code');
});

test('la résolution du port retombe sur le port Express par défaut si PORT est invalide', () => {
  assert.equal(resolvePort('not-a-port'), DEFAULT_PORT);
  assert.equal(resolvePort('0'), DEFAULT_PORT);
  assert.equal(new URL(createPairingCodeUrl('50912345678', {}, {})).hostname, DEFAULT_HOST);
});
