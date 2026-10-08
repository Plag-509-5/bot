'use strict';

/**
 * pairing-guard.js — verrou d'appairage par numéro.
 *
 * Le bug « code indisponible »
 * ----------------------------
 * L'ancien code faisait :
 *
 *   connectingSessions.add(number);
 *   setTimeout(() => connectingSessions.delete(number), 90_000).unref?.();
 *
 * Le verrou n'était donc **jamais** relâché en cas d'échec : il restait posé
 * 90 secondes. Une nouvelle demande de code dans la foulée retombait sur
 * `res.send({ status: 'already_connected_or_connecting' })`, réponse qui ne
 * contient aucun champ `code` — et le dashboard affichait « Indisponible ».
 *
 * Ce verrou est à **libération explicite** : chaque chemin de sortie (succès,
 * échec, socket fermé) le relâche. Le TTL ne sert plus que de filet pour un
 * processus qui mourrait au milieu d'un appairage.
 */

const DEFAULT_LOCK_TTL_MS = 3 * 60 * 1000;

function createPairingGuard(options = {}) {
  const { lockTtlMs = DEFAULT_LOCK_TTL_MS, now = Date.now } = options;
  const locks = new Map(); // number -> échéance

  function key(number) {
    return String(number);
  }

  function isLocked(number) {
    const expiry = locks.get(key(number));
    if (expiry === undefined) return false;
    if (expiry <= now()) {
      locks.delete(key(number));
      return false;
    }
    return true;
  }

  /**
   * Pose le verrou s'il est libre.
   * @returns {{ok: true} | {ok: false, reason: 'appairage-en-cours'}}
   */
  function acquire(number) {
    if (isLocked(number)) return { ok: false, reason: 'appairage-en-cours' };
    locks.set(key(number), now() + lockTtlMs);
    return { ok: true };
  }

  /** Relâche le verrou. Toujours sûr à appeler, même s'il n'existe pas. */
  function release(number) {
    locks.delete(key(number));
  }

  /** Prolonge le verrou (pendant que l'utilisateur saisit le code). */
  function refresh(number) {
    const k = key(number);
    if (locks.has(k)) locks.set(k, now() + lockTtlMs);
  }

  /** Force la libération puis repose le verrou : pour « recommencer tout de suite ». */
  function reacquire(number) {
    release(number);
    return acquire(number);
  }

  function lockedNumbers() {
    for (const [number, expiry] of Array.from(locks.entries())) {
      if (expiry <= now()) locks.delete(number);
    }
    return Array.from(locks.keys());
  }

  return { acquire, release, refresh, reacquire, isLocked, lockedNumbers, lockTtlMs };
}

module.exports = { createPairingGuard, DEFAULT_LOCK_TTL_MS };
