'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedCache, isBoundedCache } = require('../src/services/bounded-cache');

test('le cache garde les entrées récemment utilisées et respecte son plafond', () => {
  const cache = createBoundedCache({ maxEntries: 2 });
  cache.set('a', 1).set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);

  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size, 2);
  assert.equal(isBoundedCache(cache), true);
});

test('les métadonnées expirées sont retirées à la lecture et lors du nettoyage', () => {
  let now = 1000;
  const cache = createBoundedCache({ maxEntries: 3, maxAgeMs: 100, now: () => now });
  cache.set('a', 'expire bientôt');
  cache.set('b', 'garde-le', now);
  now = 1050;
  cache.set('c', 'autre');
  now = 1201;

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.pruneExpired(), 2);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.size, 0);
});
