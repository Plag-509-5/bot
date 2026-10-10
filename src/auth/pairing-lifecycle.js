'use strict';

/**
 * Cycle de vie d'un appairage/connexion Baileys.
 *
 * WhatsApp termine volontairement le premier socket par 515 après `pair-success`.
 * Ce n'est pas un échec : les creds doivent être vidées vers MongoDB, puis un
 * nouveau socket doit être ouvert immédiatement avec ces creds. Ce module garde
 * cette décision testable, loin des handlers métier très volumineux de pair.js.
 */

const CLOSE_ACTION = Object.freeze({
  RESTART_REQUIRED: 'restart-required',
  RECONNECT: 'reconnect',
  PURGE_PAIRING: 'purge-pairing',
  DELETE_SESSION: 'delete-session',
  STOP_REPLACED: 'stop-replaced',
  IGNORE_INTENTIONAL: 'ignore-intentional'
});

const STATUS = Object.freeze({
  LOGGED_OUT: 401,
  FORBIDDEN: 403,
  STALE_CLIENT: 405,
  TIMED_OUT: 408,
  MULTIDEVICE_MISMATCH: 411,
  AUTH_EXPIRED: 419,
  CONNECTION_CLOSED: 428,
  CONNECTION_REPLACED: 440,
  BAD_SESSION: 500,
  RESTART_REQUIRED: 515
});

const STATUS_NAMES = new Map([
  [STATUS.LOGGED_OUT, 'logged-out'],
  [STATUS.FORBIDDEN, 'forbidden'],
  [STATUS.STALE_CLIENT, 'stale-client'],
  [STATUS.TIMED_OUT, 'timed-out'],
  [STATUS.MULTIDEVICE_MISMATCH, 'multidevice-mismatch'],
  [STATUS.AUTH_EXPIRED, 'auth-expired'],
  [STATUS.CONNECTION_CLOSED, 'connection-closed'],
  [STATUS.CONNECTION_REPLACED, 'connection-replaced'],
  [STATUS.BAD_SESSION, 'bad-session'],
  [STATUS.RESTART_REQUIRED, 'restart-required']
]);

function numericStatus(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function disconnectStatusCode(lastDisconnect) {
  const error = lastDisconnect?.error;
  return numericStatus(error?.output?.statusCode)
    ?? numericStatus(error?.statusCode)
    ?? numericStatus(lastDisconnect?.reason)
    ?? (String(error || '').includes('401') ? STATUS.LOGGED_OUT : undefined);
}

function disconnectMessage(lastDisconnect) {
  const error = lastDisconnect?.error;
  return String(
    error?.output?.payload?.message
      || error?.output?.message
      || error?.message
      || error
      || ''
  );
}

function isAuthenticationLogout(lastDisconnect, statusCode) {
  const error = lastDisconnect?.error;
  const message = disconnectMessage(lastDisconnect).toLowerCase();
  return statusCode === STATUS.LOGGED_OUT
    || error?.code === 'AUTHENTICATION'
    || message.includes('logged out')
    || message.includes('device_removed');
}

function pairingFailureReason(statusCode, message) {
  if (statusCode === STATUS.TIMED_OUT && /qr refs|timed?\s*out|timeout|expired/i.test(message)) {
    return 'délai du code expiré';
  }
  if (statusCode === STATUS.LOGGED_OUT || statusCode === STATUS.FORBIDDEN) {
    return `appairage refusé (${statusCode})`;
  }
  if (statusCode) return `socket d’appairage fermé (${statusCode})`;
  return 'socket d’appairage fermé avant confirmation';
}

/**
 * Décide quoi faire d'un `connection.update { connection: "close" }`.
 * La présence de `pairingAccepted` protège le court intervalle entre
 * `isNewLogin` et la mise à jour observable de `creds.registered`.
 */
function classifyConnectionClose({ lastDisconnect, registered = false, pairingAccepted = false } = {}) {
  const statusCode = disconnectStatusCode(lastDisconnect);
  const message = disconnectMessage(lastDisconnect);
  const authenticated = Boolean(registered || pairingAccepted);
  const statusName = STATUS_NAMES.get(statusCode) || (statusCode ? `status-${statusCode}` : 'unknown');

  // 515 est le redémarrage normal qui finalise le premier appairage. Il doit
  // toujours gagner sur un éventuel instantané `registered=false` en retard.
  if (statusCode === STATUS.RESTART_REQUIRED) {
    return {
      action: CLOSE_ACTION.RESTART_REQUIRED,
      statusCode,
      statusName,
      reason: 'redémarrage obligatoire après appairage',
      immediate: true,
      countAttempt: false,
      refreshVersion: false,
      authenticated
    };
  }

  // Sans pair-success/open, le socket fermé ne peut plus recevoir la réponse au
  // code affiché. La tentative est donc définitivement inutilisable et doit
  // être purgée plutôt que reconnectée en générant silencieusement un autre code.
  if (!authenticated) {
    return {
      action: CLOSE_ACTION.PURGE_PAIRING,
      statusCode,
      statusName,
      reason: pairingFailureReason(statusCode, message),
      immediate: false,
      countAttempt: false,
      refreshVersion: statusCode === STATUS.STALE_CLIENT,
      authenticated: false
    };
  }

  if (isAuthenticationLogout(lastDisconnect, statusCode)
      || [STATUS.FORBIDDEN, STATUS.MULTIDEVICE_MISMATCH, STATUS.AUTH_EXPIRED, STATUS.BAD_SESSION].includes(statusCode)) {
    return {
      action: CLOSE_ACTION.DELETE_SESSION,
      statusCode,
      statusName,
      reason: `session WhatsApp invalide (${statusName})`,
      immediate: false,
      countAttempt: false,
      refreshVersion: false,
      authenticated: true
    };
  }

  // Une autre instance possède désormais la connexion. Ne pas combattre cette
  // instance en boucle et ne pas effacer les creds MongoDB pour autant.
  if (statusCode === STATUS.CONNECTION_REPLACED) {
    return {
      action: CLOSE_ACTION.STOP_REPLACED,
      statusCode,
      statusName,
      reason: 'connexion remplacée par une autre instance',
      immediate: false,
      countAttempt: false,
      refreshVersion: false,
      authenticated: true
    };
  }

  return {
    action: CLOSE_ACTION.RECONNECT,
    statusCode,
    statusName,
    reason: `déconnexion transitoire (${statusName})`,
    immediate: false,
    countAttempt: true,
    // 405 indique explicitement un client obsolète. Un 408 peut être réseau ou
    // version ; le cache de version stable empêche déjà le downgrade en boucle.
    refreshVersion: statusCode === STATUS.STALE_CLIENT,
    authenticated: true
  };
}

function safeCallback(callback, payload, onError) {
  if (typeof callback !== 'function') return;
  try {
    const result = callback(payload);
    if (result && typeof result.catch === 'function') result.catch(onError);
  } catch (error) {
    onError(error);
  }
}

function createPairingLifecycle(options = {}) {
  const {
    number,
    socket,
    auth,
    initiallyRegistered = false,
    now = Date.now,
    isIntentionalClose = () => false,
    onPairingAccepted,
    onReconnect,
    onPairingFailure,
    onSessionInvalid,
    onConnectionReplaced,
    onDiagnostic,
    onError = () => {}
  } = options;

  const sessionNumber = String(number || '');
  const startedAt = now();
  const history = [];
  let phase = initiallyRegistered ? 'reconnecting' : 'socket-created';
  let pairingAccepted = Boolean(initiallyRegistered);
  let closePromise = null;

  function record(nextPhase, details = {}) {
    phase = nextPhase;
    const entry = {
      number: sessionNumber,
      phase: nextPhase,
      at: now(),
      elapsedMs: Math.max(0, now() - startedAt),
      ...details
    };
    history.push(entry);
    if (history.length > 20) history.shift();
    safeCallback(onDiagnostic, entry, onError);
    return entry;
  }

  async function persistBeforeReconnect() {
    if (typeof auth?.close === 'function') {
      await auth.close();
      return;
    }
    if (typeof auth?.saveCreds === 'function') await auth.saveCreds();
    if (typeof auth?.flush === 'function') await auth.flush();
  }

  async function handleClose(update) {
    if (isIntentionalClose(socket)) {
      const decision = {
        action: CLOSE_ACTION.IGNORE_INTENTIONAL,
        statusCode: disconnectStatusCode(update?.lastDisconnect),
        statusName: 'intentional',
        reason: 'fermeture demandée par le bot',
        immediate: false,
        countAttempt: false,
        refreshVersion: false,
        authenticated: Boolean(pairingAccepted || socket?.authState?.creds?.registered)
      };
      record('closed-intentionally', { action: decision.action, statusCode: decision.statusCode });
      return decision;
    }

    const decision = classifyConnectionClose({
      lastDisconnect: update?.lastDisconnect,
      registered: Boolean(socket?.authState?.creds?.registered),
      pairingAccepted
    });
    record('connection-closed', {
      action: decision.action,
      statusCode: decision.statusCode,
      statusName: decision.statusName,
      registered: Boolean(socket?.authState?.creds?.registered),
      pairingAccepted
    });

    if (decision.action === CLOSE_ACTION.PURGE_PAIRING) {
      await onPairingFailure?.(decision);
      return decision;
    }

    if (decision.action === CLOSE_ACTION.DELETE_SESSION) {
      await onSessionInvalid?.(decision);
      return decision;
    }

    let persistenceError = null;
    try {
      await persistBeforeReconnect();
      record('auth-flushed', { action: decision.action });
    } catch (error) {
      persistenceError = error;
      record('auth-flush-failed', {
        action: decision.action,
        error: error?.message || String(error)
      });
      onError(error);
    }

    if (decision.action === CLOSE_ACTION.STOP_REPLACED) {
      await onConnectionReplaced?.({ ...decision, persistenceError });
      return decision;
    }

    // Si MongoDB n'a pas acquitté les creds du pair-success, ne pas effectuer le
    // redémarrage 515 à zéro délai : la reconnexion normale réessaiera d'abord
    // close()/saveCreds() via EmpirePair quand la base reviendra.
    const reconnectDecision = persistenceError
      ? { ...decision, immediate: false, countAttempt: true, persistenceError }
      : { ...decision, persistenceError: null };
    await onReconnect?.(reconnectDecision);
    return reconnectDecision;
  }

  function handleConnectionUpdate(update = {}) {
    if (update.isNewLogin) {
      pairingAccepted = true;
      record('pair-success', {
        registered: Boolean(socket?.authState?.creds?.registered)
      });
      // La transition doit être visible synchroniquement : WhatsApp peut
      // émettre le close 515 immédiatement après cet événement.
      safeCallback(onPairingAccepted, { update }, onError);
    }

    if (update.connection === 'connecting') {
      record('connecting', { registered: Boolean(socket?.authState?.creds?.registered) });
    } else if (update.connection === 'open') {
      pairingAccepted = true;
      record('open', { registered: Boolean(socket?.authState?.creds?.registered) });
      safeCallback(onPairingAccepted, { update }, onError);
    } else if (update.connection === 'close') {
      if (!closePromise) {
        closePromise = handleClose(update).catch((error) => {
          onError(error);
          throw error;
        });
      }
      return closePromise;
    }

    return Promise.resolve(null);
  }

  function snapshot() {
    return {
      number: sessionNumber,
      phase,
      startedAt,
      elapsedMs: Math.max(0, now() - startedAt),
      pairingAccepted,
      registered: Boolean(socket?.authState?.creds?.registered),
      history: history.map((entry) => ({ ...entry }))
    };
  }

  record(phase, { registered: Boolean(initiallyRegistered) });

  return {
    handleConnectionUpdate,
    markPairingReady: () => record('pairing-ready'),
    markCodeRequested: () => record('pairing-code-requested'),
    markCodeIssued: () => record('pairing-code-issued'),
    markInternalReconnect: () => record('internal-reconnect'),
    snapshot,
    pairingAccepted: () => pairingAccepted
  };
}

class PairingReadyError extends Error {
  constructor(message, { code = 'PAIRING_NOT_READY', statusCode } = {}) {
    super(message);
    this.name = 'PairingReadyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Attend le stanza `pair-device` (exposé par Baileys comme update.qr). */
function waitForPairingReady(socket, options = {}) {
  const {
    timeoutMs = 45_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = options;

  if (!socket?.ev?.on || !socket?.ev?.off) {
    return Promise.reject(new PairingReadyError('Socket Baileys invalide pour l’appairage'));
  }

  if (socket?.authState?.creds?.registered) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const cleanup = () => {
      if (timer !== undefined) clearTimeoutFn(timer);
      socket.ev.off('connection.update', onUpdate);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onUpdate = (update = {}) => {
      if (update.qr) {
        finish(resolve);
        return;
      }
      if (update.connection === 'close') {
        const statusCode = disconnectStatusCode(update.lastDisconnect);
        finish(
          reject,
          new PairingReadyError(
            `Connexion fermée avant que WhatsApp soit prêt pour le code${statusCode ? ` (${statusCode})` : ''}`,
            { code: 'PAIRING_SOCKET_CLOSED', statusCode }
          )
        );
      }
    };

    socket.ev.on('connection.update', onUpdate);
    timer = setTimeoutFn(() => {
      finish(
        reject,
        new PairingReadyError(
          `WhatsApp n’a pas préparé l’appairage dans les ${timeoutMs} ms`,
          { code: 'PAIRING_READY_TIMEOUT', statusCode: STATUS.TIMED_OUT }
        )
      );
    }, timeoutMs);
    timer?.unref?.();
  });
}

module.exports = {
  CLOSE_ACTION,
  STATUS,
  PairingReadyError,
  disconnectStatusCode,
  disconnectMessage,
  classifyConnectionClose,
  createPairingLifecycle,
  waitForPairingReady
};
