'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReactionTargetCache } = require('../src/services/reaction-target-cache');

test('reaction target cache records media independently of reaction aliases and preserves wrappers', () => {
  const cache = createReactionTargetCache({ maxMessagesPerSession: 2 });
  const original = {
    key: { id: 'view-once-1', remoteJid: '246454467731604@lid' },
    message: {
      ephemeralMessage: {
        message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } }
      }
    }
  };
  assert.equal(cache.record('50900000000', original), true);
  original.message = original.message.ephemeralMessage.message;
  const cached = cache.get('50900000000', 'view-once-1');
  assert.ok(cached.message.ephemeralMessage.message.viewOnceMessageV2);
  assert.equal(cache.get('50900000001', 'view-once-1'), null);
});

test('reaction target cache retains media hydrated from Baileys history for later reactions', () => {
  const cache = createReactionTargetCache();
  const historicalMessage = {
    key: { id: 'history-view-once', remoteJid: '246454467731604@lid' },
    message: {
      viewOnceMessageV2Extension: {
        message: { videoMessage: { mimetype: 'video/mp4', viewOnce: true } }
      }
    }
  };

  // La réception `append` appelle le même record() que `notify`; l'event
  // handler ne rejoue pas ce message comme une commande.
  assert.equal(cache.record('50900000000', historicalMessage), true);
  assert.equal(cache.get('50900000000', 'history-view-once').key.id, 'history-view-once');
});

test('reaction target cache includes album parents and evicts oldest entries at its per-session bound', () => {
  let clock = 1000;
  const cache = createReactionTargetCache({ maxMessagesPerSession: 2, ttlMs: 100, now: () => clock });
  const album = (id, content) => ({ key: { id }, message: content });
  cache.record('50900000000', album('album-1', { albumMessage: { expectedImageCount: 2 } }));
  clock += 1;
  cache.record('50900000000', album('image-1', { imageMessage: { mimetype: 'image/jpeg' } }));
  clock += 1;
  cache.record('50900000000', album('image-2', { imageMessage: { mimetype: 'image/jpeg' } }));
  assert.equal(cache.get('50900000000', 'album-1'), null);
  assert.equal(cache.get('50900000000', 'image-1').key.id, 'image-1');
  clock += 101;
  assert.equal(cache.get('50900000000', 'image-1'), null);
});
