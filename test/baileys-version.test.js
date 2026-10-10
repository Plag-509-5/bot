'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseWaVersion,
  formatWaVersion,
  createBaileysVersionResolver
} = require('../src/services/baileys-version');

test('parseWaVersion accepte les formats documentés et refuse les valeurs ambiguës', () => {
  assert.deepEqual(parseWaVersion('2.3000.1045716975'), [2, 3000, 1045716975]);
  assert.deepEqual(parseWaVersion('2,3000,1045716975'), [2, 3000, 1045716975]);
  assert.deepEqual(parseWaVersion([2, 3000, 1045716975]), [2, 3000, 1045716975]);
  assert.equal(parseWaVersion('2.3000'), null);
  assert.equal(parseWaVersion('latest'), null);
  assert.equal(formatWaVersion([2, 3000, 123]), '2.3000.123');
});

test('la version live est partagée par toutes les sessions pendant le TTL', async () => {
  let calls = 0;
  const resolver = createBaileysVersionResolver({
    fetchLatestWaWebVersion: async () => {
      calls += 1;
      return { version: [2, 3000, 1045716975], isLatest: true };
    }
  });

  const [first, second, third] = await Promise.all([
    resolver.resolve(),
    resolver.resolve(),
    resolver.resolve()
  ]);

  assert.equal(calls, 1, 'une seule requête live doit être en vol');
  assert.deepEqual(first.version, [2, 3000, 1045716975]);
  assert.deepEqual(second.version, first.version);
  assert.equal(third.source, 'whatsapp-web-live');

  await resolver.resolve();
  assert.equal(calls, 1, 'une reconnexion ne doit pas refetch/downgrader la version');
});

test('un échec de refresh ne remplace jamais la dernière version live par le fallback', async () => {
  let clock = 1_000;
  let calls = 0;
  const resolver = createBaileysVersionResolver({
    now: () => clock,
    cacheTtlMs: 60_000,
    failureRetryMs: 5_000,
    fetchLatestWaWebVersion: async () => {
      calls += 1;
      if (calls === 1) return { version: [2, 3000, 200], isLatest: true };
      return {
        version: [2, 3000, 100],
        isLatest: false,
        error: new Error('sw.js indisponible')
      };
    }
  });

  const live = await resolver.resolve();
  assert.deepEqual(live.version, [2, 3000, 200]);

  clock += 60_001;
  const cached = await resolver.resolve();
  assert.deepEqual(cached.version, [2, 3000, 200], 'interdiction de redescendre à 100');
  assert.equal(cached.source, 'whatsapp-web-cache');
  assert.equal(cached.stale, true);
  assert.match(cached.warning, /sw\.js indisponible/);
});

test('sans version live, le fallback officiel reste utilisable mais est signalé stale', async () => {
  const resolver = createBaileysVersionResolver({
    fetchLatestWaWebVersion: async () => ({
      version: [2, 3000, 1043857760],
      isLatest: false,
      error: new Error('timeout')
    })
  });

  const result = await resolver.resolve();
  assert.equal(result.source, 'baileys-bundled-fallback');
  assert.equal(result.stale, true);
  assert.deepEqual(result.version, [2, 3000, 1043857760]);
});

test('WA_WEB_VERSION explicite évite tout accès réseau', async () => {
  let calls = 0;
  const resolver = createBaileysVersionResolver({
    override: '2.3000.9999999999',
    fetchLatestWaWebVersion: async () => {
      calls += 1;
      throw new Error('ne doit pas être appelé');
    }
  });

  const result = await resolver.resolve({ force: true });
  assert.equal(calls, 0);
  assert.equal(result.source, 'environment');
  assert.deepEqual(result.version, [2, 3000, 9999999999]);
});

test('un override mal formé échoue explicitement au démarrage', () => {
  assert.throws(
    () => createBaileysVersionResolver({
      override: 'auto',
      fetchLatestWaWebVersion: async () => ({})
    }),
    /WA_WEB_VERSION invalide/
  );
});
