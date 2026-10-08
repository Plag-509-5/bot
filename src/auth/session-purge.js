'use strict';

/**
 * session-purge.js — effacement de TOUTES les traces persistantes d'une session.
 *
 * Pourquoi ce module existe
 * -------------------------
 * Un appairage raté laissait derrière lui :
 *   - `sessions/<numéro>/creds.json` sur disque,
 *   - un document dans la collection `sessions` (écrit par `creds.update`),
 *   - d'éventuelles clés dans `session_keys`,
 *   - le numéro dans la collection `numbers`.
 *
 * À la demande suivante, `creds.registered` pouvait valoir `true` : le bloc de
 * demande de code était sauté, aucune réponse n'était envoyée, et le dashboard
 * affichait « Indisponible ». Il faut donc tout effacer, **y compris MongoDB**.
 *
 * Les dépendances sont injectées pour que le nettoyage puisse être testé sans
 * MongoDB ni WhatsApp.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const defaultStore = require('./session-store');

function createSessionPurger(options = {}) {
  const {
    sessionStore = defaultStore,
    authBackend = null,
    removeSession = null,
    removeNumber = null,
    tmpDir = os.tmpdir(),
    removeSync = (target) => fs.rmSync(target, { recursive: true, force: true }),
    logger = console
  } = options;

  function warn(message, err) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(message, err && err.message ? err.message : err);
    }
  }

  /**
   * @param {string} number
   * @param {{ auth?: object, reason?: string }} context
   *   `auth` : état d'authentification à JETER. On appelle `discard()` et non
   *   `close()` : `close()` vide les écritures en attente sur disque et dans
   *   MongoDB, ce qui ressusciterait la session qu'on est en train d'effacer.
   * @returns {Promise<{ok: boolean, number: string, traces: string[]}>}
   */
  async function purge(number, context = {}) {
    const { auth = null, reason = 'session ratée' } = context;
    const sanitized = sessionStore.sanitizeNumber(number);
    if (!sanitized) {
      return { ok: false, number: '', traces: [], reason: 'numéro invalide' };
    }

    const traces = [];

    // 1) État d'authentification : jeté sans écriture.
    if (auth) {
      try {
        if (typeof auth.discard === 'function') auth.discard();
        traces.push('état-auth');
      } catch (err) {
        warn(`[PURGE ${sanitized}] discard de l'état d'auth :`, err);
      }
    }

    // 2) Disque : dossier persistant, puis ancien dossier temporaire hérité des
    //    versions qui stockaient les sessions dans tmp.
    try {
      await sessionStore.removeAuthDir(sessionStore.sessionDir(sanitized));
      traces.push(`sessions/${sanitized}`);
    } catch (err) {
      warn(`[PURGE ${sanitized}] dossier de session :`, err);
    }
    try {
      removeSync(path.join(tmpDir, `session_${sanitized}`));
      traces.push('tmp');
    } catch (err) {
      // Absent la plupart du temps : rien à signaler.
    }

    // 3) MongoDB : clés Signal + creds d'abord (authBackend gère les deux
    //    collections), puis les collections historiques.
    if (authBackend && typeof authBackend.remove === 'function') {
      try {
        await authBackend.remove(sanitized);
        traces.push('mongo:sessions+session_keys');
      } catch (err) {
        warn(`[PURGE ${sanitized}] authBackend.remove :`, err);
      }
    }
    if (typeof removeSession === 'function') {
      try {
        await removeSession(sanitized);
        traces.push('mongo:sessions');
      } catch (err) {
        warn(`[PURGE ${sanitized}] removeSession :`, err);
      }
    }
    if (typeof removeNumber === 'function') {
      try {
        await removeNumber(sanitized);
        traces.push('mongo:numbers');
      } catch (err) {
        warn(`[PURGE ${sanitized}] removeNumber :`, err);
      }
    }

    return { ok: true, number: sanitized, traces, reason };
  }

  return { purge };
}

module.exports = { createSessionPurger };
