'use strict';

/**
 * Purge MongoDB d'une session WhatsApp.
 *
 * Il n'y a aucun dossier local à nettoyer. L'ordre est important : on attend
 * d'abord les écritures auth déjà parties, puis on supprime creds, clés Signal
 * et numéro. Ainsi, aucune écriture tardive ne peut ressusciter la session.
 */

const { sanitizeNumber } = require('./auth-utils');

function createSessionPurger(options = {}) {
  const {
    authBackend,
    removeNumber = null,
    logger = console
  } = options;

  function warn(message, error) {
    if (typeof logger?.warn === 'function') {
      logger.warn(message, error?.message || error);
    }
  }

  async function purge(number, context = {}) {
    const { auth = null, reason = 'session ratée' } = context;
    const sanitized = sanitizeNumber(number);
    if (!sanitized) {
      return { ok: false, number: '', traces: [], errors: ['numéro invalide'], reason: 'numéro invalide' };
    }

    const traces = [];
    const errors = [];

    if (auth) {
      try {
        if (typeof auth.discard === 'function') await auth.discard();
        traces.push('mémoire-auth');
      } catch (error) {
        errors.push(`discard auth: ${error?.message || error}`);
        warn(`[PURGE ${sanitized}] abandon de l'état auth :`, error);
      }
    }

    if (!authBackend || typeof authBackend.remove !== 'function') {
      errors.push('backend MongoDB absent');
    } else {
      try {
        await authBackend.remove(sanitized);
        traces.push('mongodb:sessions+session_keys');
      } catch (error) {
        errors.push(`sessions MongoDB: ${error?.message || error}`);
        warn(`[PURGE ${sanitized}] suppression de l'auth MongoDB :`, error);
      }
    }

    if (typeof removeNumber === 'function') {
      try {
        await removeNumber(sanitized);
        traces.push('mongodb:numbers');
      } catch (error) {
        errors.push(`numéro MongoDB: ${error?.message || error}`);
        warn(`[PURGE ${sanitized}] suppression du numéro MongoDB :`, error);
      }
    }

    return {
      ok: errors.length === 0,
      number: sanitized,
      traces,
      errors,
      reason
    };
  }

  return { purge };
}

module.exports = { createSessionPurger };
