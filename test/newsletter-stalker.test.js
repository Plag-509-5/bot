'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REFRESH_INTERVAL_MS,
  subscribeNewsletterStalker,
  stopNewsletterStalker,
  stopAllNewsletterStalkers,
  isLiveNewsletterPost
} = require('../src/services/newsletter-stalker');

test('active des mises à jour live sans appeler newsletterFollow et évite les doublons', async () => {
  const calls = [];
  const socket = {
    async newsletterFollow() { throw new Error('le stalker ne doit pas suivre la chaîne'); },
    async subscribeNewsletterUpdates(jid) {
      calls.push(jid);
      return { duration: '90' };
    }
  };
  const first = await subscribeNewsletterStalker(socket, '120363123456789');
  const second = await subscribeNewsletterStalker(socket, '120363123456789@newsletter');
  assert.deepEqual(first, {
    jid: '120363123456789@newsletter',
    alreadyActive: false,
    response: { duration: '90' }
  });
  assert.equal(second.alreadyActive, true);
  assert.deepEqual(calls, ['120363123456789@newsletter']);
  assert.equal(stopNewsletterStalker(socket, '120363123456789'), true);
});

test('renouvelle un abonnement live et arrête les timers au close ou à la suppression', async () => {
  const calls = [];
  const socket = {
    async subscribeNewsletterUpdates(jid) {
      calls.push(jid);
      return { duration: '90' };
    }
  };
  await subscribeNewsletterStalker(socket, '120363123456789', { refreshIntervalMs: 10_000 });
  await subscribeNewsletterStalker(socket, '120363123456789', { force: true, refreshIntervalMs: 10_000 });
  assert.ok(REFRESH_INTERVAL_MS >= 60_000);
  assert.equal(stopAllNewsletterStalkers(socket), 1);
  assert.equal(stopAllNewsletterStalkers(socket), 0);
  assert.equal(calls.length, 2);
});

test('ne traite que les notifications live postérieures au démarrage du stalker', () => {
  const startedAt = new Date(1_800_000_000_000);
  assert.equal(isLiveNewsletterPost({ messageTimestamp: 1_800_000_005 }, 'append', startedAt), true);
  assert.equal(isLiveNewsletterPost({ messageTimestamp: 1_799_999_900 }, 'append', startedAt), false);
  assert.equal(isLiveNewsletterPost({ messageTimestamp: 1_800_000_005 }, 'notify', startedAt), true);
  assert.equal(isLiveNewsletterPost({ messageTimestamp: 1_800_000_005 }, 'append', startedAt), true);
  assert.equal(isLiveNewsletterPost({ messageTimestamp: 1_800_000_005 }, 'history', startedAt), false);
});

test('signale proprement si le socket ne possède pas l’API de mise à jour live', async () => {
  await assert.rejects(
    subscribeNewsletterStalker({}, '120363123456789'),
    /subscribeNewsletterUpdates indisponible/
  );
});
