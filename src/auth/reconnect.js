'use strict';

/**
 * reconnect.js — ordonnanceur de reconnexion UNIQUE par session.
 *
 * Avant, deux gestionnaires `connection.update` distincts (setupAutoRestart et
 * celui écrit en ligne dans EmpirePair) programmaient chacun leur propre
 * reconnexion, avec des temporisations différentes. Deux sockets pouvaient donc
 * se retrouver actifs sur la même identité : chacun avance son ratchet Signal de
 * son côté, l'autre devient obsolète, et les messages partent dans le vide —
 * exactement le symptôme « réponse invisible / en attente ».
 *
 * Cet ordonnanceur garantit qu'il n'y a JAMAIS plus d'une reconnexion en
 * attente pour un numéro donné, quel que soit le nombre d'appelants.
 */

const DEFAULT_BASE_MS = 5000;
const DEFAULT_MAX_MS = 120000;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_JITTER_MS = 1000;

function createReconnectScheduler(options = {}) {
  const {
    baseMs = Number(process.env.SESSION_RECONNECT_BASE_MS) || DEFAULT_BASE_MS,
    maxMs = Number(process.env.SESSION_RECONNECT_MAX_MS) || DEFAULT_MAX_MS,
    maxAttempts = Number(process.env.SESSION_RECONNECT_MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS,
    jitterMs = DEFAULT_JITTER_MS,
    onReconnect = async () => {},
    onGiveUp = null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    random = Math.random
  } = options;

  const timers = new Map();   // number -> timer
  const attempts = new Map(); // number -> count

  function computeDelay(attempt) {
    const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(attempt - 1, 6));
    const jitter = Math.floor(random() * jitterMs);
    return exponential + jitter;
  }

  function isPending(number) {
    return timers.has(String(number));
  }

  function cancel(number) {
    const key = String(number);
    const timer = timers.get(key);
    if (timer) {
      clearTimeoutFn(timer);
      timers.delete(key);
    }
  }

  function reset(number) {
    cancel(number);
    attempts.delete(String(number));
  }

  function getAttempts(number) {
    return attempts.get(String(number)) || 0;
  }

  /**
   * Programme une reconnexion. Idempotent : si une reconnexion est déjà en
   * attente pour ce numéro, l'appel ne fait rien.
   * @returns {{scheduled: boolean, reason?: string, attempt?: number, delayMs?: number}}
   */
  function schedule(number, context = {}) {
    const key = String(number);
    if (timers.has(key)) {
      return { scheduled: false, reason: 'deja-programmee', attempt: attempts.get(key) || 0 };
    }
    const attempt = (attempts.get(key) || 0) + 1;
    if (attempt > maxAttempts) {
      attempts.set(key, attempt - 1);
      if (typeof onGiveUp === 'function') {
        void Promise.resolve()
          .then(() => onGiveUp(key, { attempt: attempt - 1, ...context }))
          .catch(() => {});
      }
      return { scheduled: false, reason: 'tentatives-epuisees', attempt: attempt - 1 };
    }

    attempts.set(key, attempt);
    const delayMs = computeDelay(attempt);
    const timer = setTimeoutFn(async () => {
      timers.delete(key);
      try {
        await onReconnect(key, { attempt, ...context });
      } catch (err) {
        console.error(`[RECONNECT ${key}] échec :`, err && err.message ? err.message : err);
      }
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    timers.set(key, timer);
    return { scheduled: true, attempt, delayMs };
  }

  return { schedule, cancel, reset, isPending, getAttempts, computeDelay };
}

module.exports = { createReconnectScheduler };
