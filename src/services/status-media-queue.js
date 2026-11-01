'use strict';

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUED = 4;

function positiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createSemaphore({ maxConcurrent = 1, maxQueued = 0, busyMessage = 'Le traitement média est déjà occupé.' } = {}) {
  const concurrency = positiveInteger(maxConcurrent, 1, 1, 16);
  const queueLimit = positiveInteger(maxQueued, 0, 0, 100);
  let active = 0;
  const waiting = [];

  function createRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiting.shift();
      if (next) {
        next.resolve(createRelease());
      } else {
        active = Math.max(0, active - 1);
      }
    };
  }

  function acquire() {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve(createRelease());
    }
    if (waiting.length >= queueLimit) {
      return Promise.reject(new Error(busyMessage));
    }
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  }

  function stats() {
    return { active, waiting: waiting.length, maxConcurrent: concurrency, maxQueued: queueLimit };
  }

  return { acquire, stats };
}

const mediaSemaphore = createSemaphore({
  maxConcurrent: positiveInteger(process.env.TOSTATUS_MEDIA_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT, 1, 8),
  maxQueued: positiveInteger(process.env.TOSTATUS_MEDIA_MAX_QUEUE, DEFAULT_MAX_QUEUED, 0, 32),
  busyMessage: 'Les publications média sont trop occupées. Réessaie dans un instant.'
});

async function acquireStatusMediaSlot() {
  return mediaSemaphore.acquire();
}

function getStatusMediaQueueStats() {
  return mediaSemaphore.stats();
}

module.exports = {
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_QUEUED,
  acquireStatusMediaSlot,
  getStatusMediaQueueStats,
  _test: { createSemaphore, positiveInteger }
};
