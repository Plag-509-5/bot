'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Binary } = require('mongodb');
const { authJsonReplacer, authJsonReviver, reviveAuthValue } = require('../src/auth/auth-json');

const roundTrip = value => JSON.parse(JSON.stringify(value, authJsonReplacer), authJsonReviver);

test('Buffer et Uint8Array restent des octets au lieu de devenir des objets JSON', () => {
  const original = { private: Buffer.from([0, 1, 255]), public: new Uint8Array([2, 3, 4]), nested: [Buffer.alloc(0)] };
  const restored = roundTrip(original);
  assert.ok(Buffer.isBuffer(restored.private));
  assert.ok(Buffer.isBuffer(restored.public));
  assert.deepEqual(restored.private, original.private);
  assert.deepEqual(restored.public, Buffer.from(original.public));
  assert.deepEqual(restored.nested, [Buffer.alloc(0)]);
});

test('les anciens JSON de Buffer (tableaux) et BufferJSON (base64) sont lisibles', () => {
  const legacy = { private: { type: 'Buffer', data: [0, 1, 255] }, public: { type: 'Buffer', data: 'AgME' } };
  const restored = JSON.parse(JSON.stringify(legacy), authJsonReviver);
  assert.deepEqual(restored.private, Buffer.from([0, 1, 255]));
  assert.deepEqual(restored.public, Buffer.from([2, 3, 4]));
});

test('les anciennes Uint8Array JSON sont restaurées seulement dans les champs binaires', () => {
  const restored = reviveAuthValue({
    noiseKey: { private: { 0: 1, 1: 255 }, public: { 0: 2, 1: 3 } },
    table: { 0: 4, 1: 5 }, id: '120363421675697127', advSecretKey: 'YWJj',
    private: { 0: 1, 2: 3 }
  });
  assert.deepEqual(restored.noiseKey.private, Buffer.from([1, 255]));
  assert.deepEqual(restored.noiseKey.public, Buffer.from([2, 3]));
  assert.deepEqual(restored.table, { 0: 4, 1: 5 });
  assert.equal(restored.advSecretKey, 'YWJj');
  assert.deepEqual(restored.private, { 0: 1, 2: 3 });
});

test('les BSON Binary de MongoDB sont restaurés en Buffer, dates préservées', () => {
  const date = new Date('2026-10-08T00:00:00Z');
  const restored = reviveAuthValue({ private: new Binary(Buffer.from([1, 2, 3])), createdAt: date });
  assert.deepEqual(restored.private, Buffer.from([1, 2, 3]));
  assert.equal(restored.createdAt, date);
});
