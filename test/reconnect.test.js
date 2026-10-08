'use strict';

/**
 * Tests de l'ordonnanceur de reconnexion.
 *
 * L'invariant critique : deux gestionnaires `connection.update` qui appellent
 * `schedule()` pour le même numéro ne doivent produire qu'UNE reconnexion.
 * C'est ce qui empêchait deux sockets de tourner sur la même identité.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createReconnectScheduler } = require('../src/auth/reconnect');

/** Minuterie factice : rien ne part tant qu'on ne déclenche pas manuellement. */
function fakeClock() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimeoutFn(fn, delayMs) {
      id += 1;
      timers.set(id, { fn, delayMs });
      return id;
    },
    clearTimeoutFn(handle) {
      timers.delete(handle);
    },
    async runAll() {
      const pending = Array.from(timers.values());
      timers.clear();
      for (const timer of pending) await timer.fn();
    },
    delays() {
      return Array.from(timers.values()).map((t) => t.delayMs);
    }
  };
}

test('deux appels schedule pour le même numéro ne programment qu’une reconnexion', () => {
  const clock = fakeClock();
  const launched = [];
  const scheduler = createReconnectScheduler({
    baseMs: 1000,
    maxMs: 60000,
    jitterMs: 0,
    random: () => 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async (number) => { launched.push(number); }
  });

  const first = scheduler.schedule('50947440869');
  const second = scheduler.schedule('50947440869');
  const third = scheduler.schedule('50947440869');

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);
  assert.equal(second.reason, 'deja-programmee');
  assert.equal(third.scheduled, false);
  assert.equal(clock.timers.size, 1, 'un seul temporisateur doit exister');
});

test('deux numéros différents sont programmés indépendamment', () => {
  const clock = fakeClock();
  const scheduler = createReconnectScheduler({
    jitterMs: 0,
    random: () => 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async () => {}
  });

  assert.equal(scheduler.schedule('50911111111').scheduled, true);
  assert.equal(scheduler.schedule('50922222222').scheduled, true);
  assert.equal(clock.timers.size, 2);
});

test('le délai suit un backoff exponentiel borné par maxMs', () => {
  const scheduler = createReconnectScheduler({
    baseMs: 5000,
    maxMs: 120000,
    jitterMs: 0,
    random: () => 0
  });
  assert.equal(scheduler.computeDelay(1), 5000);
  assert.equal(scheduler.computeDelay(2), 10000);
  assert.equal(scheduler.computeDelay(3), 20000);
  assert.equal(scheduler.computeDelay(8), 120000, 'le délai doit plafonner à maxMs');
  assert.equal(scheduler.computeDelay(20), 120000);
});

test('le jitter reste dans les bornes annoncées', () => {
  const scheduler = createReconnectScheduler({
    baseMs: 5000,
    maxMs: 120000,
    jitterMs: 1000,
    random: () => 0.999
  });
  const delay = scheduler.computeDelay(1);
  assert.ok(delay >= 5000 && delay < 6000, `délai hors bornes : ${delay}`);
});

test('onReconnect reçoit le numéro et le compteur de tentatives', async () => {
  const clock = fakeClock();
  const received = [];
  const scheduler = createReconnectScheduler({
    jitterMs: 0,
    random: () => 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async (number, ctx) => { received.push({ number, attempt: ctx.attempt }); }
  });

  scheduler.schedule('50933333333');
  await clock.runAll();
  assert.deepEqual(received, [{ number: '50933333333', attempt: 1 }]);

  // Après exécution, une nouvelle programmation est possible (tentative 2).
  const again = scheduler.schedule('50933333333');
  assert.equal(again.attempt, 2);
});

test('reset annule la reconnexion en attente et remet le compteur à zéro', async () => {
  const clock = fakeClock();
  const launched = [];
  const scheduler = createReconnectScheduler({
    jitterMs: 0,
    random: () => 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async (n) => { launched.push(n); }
  });

  scheduler.schedule('50944444444');
  assert.equal(scheduler.isPending('50944444444'), true);
  scheduler.reset('50944444444');
  assert.equal(scheduler.isPending('50944444444'), false);
  assert.equal(scheduler.getAttempts('50944444444'), 0);

  await clock.runAll();
  assert.deepEqual(launched, [], 'rien ne doit partir après un reset');
});

test('cancel supprime uniquement le temporisateur du numéro visé', () => {
  const clock = fakeClock();
  const scheduler = createReconnectScheduler({
    jitterMs: 0,
    random: () => 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async () => {}
  });

  scheduler.schedule('50955555555');
  scheduler.schedule('50966666666');
  scheduler.cancel('50955555555');

  assert.equal(scheduler.isPending('50955555555'), false);
  assert.equal(scheduler.isPending('50966666666'), true);
});

test('au-delà de maxAttempts, on abandonne et on prévient au lieu de boucler', async () => {
  const clock = fakeClock();
  const givenUp = [];
  const scheduler = createReconnectScheduler({
    jitterMs: 0,
    random: () => 0,
    maxAttempts: 2,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async () => {},
    onGiveUp: (number, ctx) => { givenUp.push({ number, attempt: ctx.attempt }); }
  });

  assert.equal(scheduler.schedule('50977777777').scheduled, true);
  scheduler.cancel('50977777777');
  assert.equal(scheduler.schedule('50977777777').scheduled, true);
  scheduler.cancel('50977777777');

  const refused = scheduler.schedule('50977777777');
  assert.equal(refused.scheduled, false);
  assert.equal(refused.reason, 'tentatives-epuisees');

  // onGiveUp est notifié de façon asynchrone pour ne jamais bloquer l'appelant.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(givenUp.length, 1);
  assert.equal(givenUp[0].number, '50977777777');
});

test('une erreur dans onReconnect ne casse pas l’ordonnanceur', async () => {
  const clock = fakeClock();
  const scheduler = createReconnectScheduler({
    jitterMs: 0,
    random: () => 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onReconnect: async () => { throw new Error('mongo ko'); }
  });

  scheduler.schedule('50988888888');
  await assert.doesNotReject(clock.runAll());
  assert.equal(scheduler.isPending('50988888888'), false);
});
