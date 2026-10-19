'use strict';

const DEFAULT_SESSION_STARTUP_CONCURRENCY = 4;
const MAX_SESSION_STARTUP_CONCURRENCY = 16;

function resolveSessionStartupConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_SESSION_STARTUP_CONCURRENCY;
  return Math.min(parsed, MAX_SESSION_STARTUP_CONCURRENCY);
}

/**
 * Launch independent session startup tasks concurrently, but keep a hard cap
 * so MongoDB, CPU, and WhatsApp do not get overwhelmed during a process restart.
 * Each task settles independently; one bad session never blocks the rest.
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Array.isArray(items) || typeof mapper !== 'function') return [];
  const limit = Math.min(resolveSessionStartupConcurrency(concurrency), items.length);
  if (!limit) return [];

  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

module.exports = {
  DEFAULT_SESSION_STARTUP_CONCURRENCY,
  MAX_SESSION_STARTUP_CONCURRENCY,
  resolveSessionStartupConcurrency,
  mapWithConcurrency
};
