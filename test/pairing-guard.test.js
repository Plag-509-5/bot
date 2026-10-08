'use strict';

/**
 * Tests du verrou d'appairage.
 *
 * Le bug « code indisponible » venait de là : le verrou posé par
 * `connectingSessions.add()` n'était relâché que par un minuteur de 90 s,
 * jamais par les chemins d'échec. Une nouvelle demande dans la foulée recevait
 * une réponse sans champ `code`.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createPairingGuard, DEFAULT_LOCK_TTL_MS } = require('../src/auth/pairing-guard');

/** Horloge contrôlable : le TTL ne se déclenche que si on avance le temps. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms) { current += ms; }
  };
}

test('un verrou libre peut être pris', () => {
  const guard = createPairingGuard();
  const result = guard.acquire('50947440869');
  assert.deepEqual(result, { ok: true });
  assert.equal(guard.isLocked('50947440869'), true);
});

test('un second acquire sur le même numéro est refusé', () => {
  const guard = createPairingGuard();
  guard.acquire('50947440869');
  const second = guard.acquire('50947440869');
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'appairage-en-cours');
});

test('release libère immédiatement — c’est le correctif du « code indisponible »', () => {
  const guard = createPairingGuard({ lockTtlMs: 60_000 });
  guard.acquire('50947440869');
  guard.release('50947440869');

  assert.equal(guard.isLocked('50947440869'), false);
  // Le retry immédiat doit passer, sans attendre la fin du TTL.
  assert.deepEqual(guard.acquire('50947440869'), { ok: true });
});

test('release sur un numéro jamais verrouillé ne fait rien', () => {
  const guard = createPairingGuard();
  assert.doesNotThrow(() => guard.release('50900000000'));
  assert.equal(guard.isLocked('50900000000'), false);
});

test('deux numéros ont des verrous indépendants', () => {
  const guard = createPairingGuard();
  guard.acquire('50911111111');
  assert.deepEqual(guard.acquire('50922222222'), { ok: true });
  assert.deepEqual(guard.lockedNumbers().sort(), ['50911111111', '50922222222']);
});

test('le TTL ne sert que de filet : le verrou expire tout seul', () => {
  const clock = fakeClock();
  const guard = createPairingGuard({ lockTtlMs: 90_000, now: clock.now });

  guard.acquire('50933333333');
  clock.advance(89_999);
  assert.equal(guard.isLocked('50933333333'), true, 'encore valide juste avant échéance');

  clock.advance(2);
  assert.equal(guard.isLocked('50933333333'), false, 'le verrou doit expirer');
  assert.deepEqual(guard.acquire('50933333333'), { ok: true });
});

test('refresh prolonge le verrou pendant la saisie du code', () => {
  const clock = fakeClock();
  const guard = createPairingGuard({ lockTtlMs: 60_000, now: clock.now });

  guard.acquire('50944444444');
  clock.advance(50_000);
  guard.refresh('50944444444');
  clock.advance(50_000);
  assert.equal(guard.isLocked('50944444444'), true, 'refresh doit repousser l’échéance');
});

test('refresh sur un verrou absent n’en crée pas', () => {
  const guard = createPairingGuard();
  guard.refresh('50955555555');
  assert.equal(guard.isLocked('50955555555'), false);
});

test('reacquire force un nouveau verrou : « recommencer tout de suite »', () => {
  const guard = createPairingGuard({ lockTtlMs: 60_000 });
  guard.acquire('50966666666');
  assert.equal(guard.acquire('50966666666').ok, false);

  assert.deepEqual(guard.reacquire('50966666666'), { ok: true });
  assert.equal(guard.isLocked('50966666666'), true);
});

test('lockedNumbers nettoie les verrous expirés', () => {
  const clock = fakeClock();
  const guard = createPairingGuard({ lockTtlMs: 10_000, now: clock.now });

  guard.acquire('50977777777');
  guard.acquire('50988888888');
  clock.advance(20_000);
  guard.acquire('50999999999');

  assert.deepEqual(guard.lockedNumbers(), ['50999999999']);
});

test('le TTL par défaut laisse le temps de saisir le code', () => {
  assert.equal(DEFAULT_LOCK_TTL_MS, 180_000);
  assert.equal(createPairingGuard().lockTtlMs, DEFAULT_LOCK_TTL_MS);
});
