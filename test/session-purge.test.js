'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initAuthCreds } = require('@whiskeysockets/baileys');

const { createSessionPurger } = require('../src/auth/session-purge');
const { createMongoAuthBackend } = require('../src/auth/mongo-auth-backend');
const { createFakeDb } = require('./helpers/fake-mongo');

function creds(number) {
  const value = initAuthCreds();
  value.registered = true;
  value.me = { id: `${number}@s.whatsapp.net` };
  return value;
}

function fixture() {
  const db = createFakeDb();
  const backend = createMongoAuthBackend({
    initMongo: async () => {},
    getDb: () => db
  });
  const removeNumber = async (number) => {
    await db.collection('numbers').deleteOne({ number });
  };
  return {
    db,
    backend,
    purger: createSessionPurger({
      authBackend: backend,
      removeNumber,
      logger: { warn() {} }
    })
  };
}

async function seed(ctx, number) {
  await ctx.backend.saveCreds(number, creds(number));
  await ctx.backend.saveKeys(number, [
    { ref: 'pre-key/1', value: { private: Buffer.from('a') } },
    { ref: `session/${number}:3@s.whatsapp.net`, value: { ratchet: Buffer.from('b') } }
  ]);
  await ctx.db.collection('numbers').updateOne(
    { number },
    { $set: { number } },
    { upsert: true }
  );
}

test('la purge retire creds, clés Signal et numéro uniquement de MongoDB', async () => {
  const ctx = fixture();
  const target = '50910000001';
  const other = '50910000002';
  await seed(ctx, target);
  await seed(ctx, other);

  const result = await ctx.purger.purge(target, { reason: 'test' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.traces.includes('mongodb:sessions+session_keys'));
  assert.ok(result.traces.includes('mongodb:numbers'));
  assert.equal(await ctx.backend.load(target), null);
  assert.equal(await ctx.backend.exists(other), true);
  assert.ok(ctx.db.collection('numbers').docs.some((doc) => doc.number === other));
});

test('discard est attendu avant la suppression pour empêcher une résurrection', async () => {
  const events = [];
  const purger = createSessionPurger({
    authBackend: {
      async remove() { events.push('remove'); }
    },
    removeNumber: async () => { events.push('number'); },
    logger: { warn() {} }
  });
  const auth = {
    async discard() {
      await new Promise((resolve) => setImmediate(resolve));
      events.push('discard');
    }
  };

  const result = await purger.purge('50910000003', { auth, reason: 'test' });
  assert.equal(result.ok, true);
  assert.equal(events[0], 'discard');
  assert.deepEqual(events, ['discard', 'remove', 'number']);
});

test('une panne MongoDB rend la purge explicitement incomplète', async () => {
  const warnings = [];
  const purger = createSessionPurger({
    authBackend: { async remove() { throw new Error('base hors ligne'); } },
    removeNumber: async () => { throw new Error('base hors ligne'); },
    logger: { warn(...args) { warnings.push(args); } }
  });

  const result = await purger.purge('50910000004', { reason: 'test' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join(' '), /base hors ligne/);
  assert.equal(warnings.length, 2);
});

test('un backend absent ne peut pas produire un faux succès', async () => {
  const purger = createSessionPurger({
    removeNumber: async () => {},
    logger: { warn() {} }
  });
  const result = await purger.purge('50910000005');
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('backend MongoDB absent'));
});

test('un numéro invalide est refusé sans appeler MongoDB', async () => {
  let called = false;
  const purger = createSessionPurger({
    authBackend: { async remove() { called = true; } },
    logger: { warn() {} }
  });
  const result = await purger.purge('   ');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'numéro invalide');
  assert.equal(called, false);
});

test('purger une session déjà absente reste idempotent', async () => {
  const ctx = fixture();
  await assert.doesNotReject(ctx.purger.purge('50910000006'));
  assert.equal((await ctx.purger.purge('50910000006')).ok, true);
});
