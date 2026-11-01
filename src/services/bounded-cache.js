'use strict';

const CACHE_MARKER = Symbol.for('kaido.bounded-cache');

function positiveLimit(value, fallback, min = 1, max = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createBoundedCache({ maxEntries = 128, maxAgeMs = 0, now = Date.now } = {}) {
  const limit = positiveLimit(maxEntries, 128, 1, 1000);
  const ttl = Math.max(0, Number(maxAgeMs) || 0);
  const entries = new Map();

  const cache = {
    [CACHE_MARKER]: true,

    set(key, value, storedAt = now()) {
      const normalizedKey = String(key);
      const timestamp = Number(storedAt);
      entries.delete(normalizedKey);
      entries.set(normalizedKey, {
        value,
        storedAt: Number.isFinite(timestamp) ? timestamp : now()
      });
      cache.pruneExpired();
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return cache;
    },

    get(key) {
      const normalizedKey = String(key);
      const entry = entries.get(normalizedKey);
      if (!entry) return undefined;
      if (ttl && now() - entry.storedAt >= ttl) {
        entries.delete(normalizedKey);
        return undefined;
      }
      entries.delete(normalizedKey);
      entries.set(normalizedKey, entry);
      return entry.value;
    },

    has(key) {
      return this.get(key) !== undefined;
    },

    delete(key) {
      return entries.delete(String(key));
    },

    clear() {
      entries.clear();
    },

    pruneExpired(at = now()) {
      if (!ttl) return 0;
      let removed = 0;
      for (const [key, entry] of entries) {
        if (at - entry.storedAt < ttl) continue;
        entries.delete(key);
        removed += 1;
      }
      return removed;
    },

    keys() {
      return entries.keys();
    },

    *values() {
      for (const entry of entries.values()) yield entry.value;
    },

    *entries() {
      for (const [key, entry] of entries) yield [key, entry.value];
    },

    forEach(callback, thisArg) {
      for (const [key, entry] of entries) callback.call(thisArg, entry.value, key, cache);
    },

    get size() {
      return entries.size;
    },

    get maxEntries() {
      return limit;
    },

    get maxAgeMs() {
      return ttl;
    }
  };

  return cache;
}

function isBoundedCache(value) {
  return Boolean(value && value[CACHE_MARKER] === true);
}

module.exports = { createBoundedCache, isBoundedCache };
