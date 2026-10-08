'use strict';

/**
 * safe-send.js — envoi de messages qui ne « disparaît » plus en silence.
 *
 * Le symptôme : le bot traite la commande, appelle `socket.sendMessage()`,
 * l'appel résout sans erreur… et le destinataire ne voit jamais rien. Côté
 * compte WhatsApp, le message reste affiché avec l'horloge « en attente ».
 *
 * Cause : Baileys remet la stanza au websocket sans attendre d'accusé de
 * réception du serveur. Si la connexion est fermée, en cours de fermeture, ou
 * à moitié morte, l'envoi est accepté localement puis perdu.
 *
 * Ce module attend que la websocket soit réellement ouverte avant d'envoyer,
 * réessaie, et lève une erreur explicite si l'envoi échoue vraiment — au lieu
 * de faire croire au code que la réponse est partie.
 */

const WEBSOCKET_OPEN = 1;

const SAFE_SEND_MARK = Symbol.for('kaido.safeSend');
const SEND_STATS = Symbol.for('kaido.sendStats');

const DEFAULTS = {
  retries: 1,
  retryDelayMs: 1500,
  readyTimeoutMs: 8000,
  pollIntervalMs: 250
};

function defaultDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/** État de la connexion d'un socket, sans effet de bord. */
function socketReadiness(socket) {
  if (!socket || typeof socket.sendMessage !== 'function') {
    return { ready: false, reason: 'socket-absent' };
  }
  const ws = socket.ws;
  if (ws && typeof ws.readyState === 'number' && ws.readyState !== WEBSOCKET_OPEN) {
    return { ready: false, reason: `websocket-fermee-${ws.readyState}` };
  }
  const creds = socket.authState && socket.authState.creds;
  if (creds && creds.registered === false) {
    return { ready: false, reason: 'session-non-enregistree' };
  }
  return { ready: true, reason: 'ok' };
}

/** Attend que le socket soit prêt, au plus `timeoutMs`. */
async function waitForReady(socket, timeoutMs = DEFAULTS.readyTimeoutMs, delay = defaultDelay, pollIntervalMs = DEFAULTS.pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  let readiness = socketReadiness(socket);
  while (!readiness.ready && Date.now() < deadline) {
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    readiness = socketReadiness(socket);
  }
  return readiness;
}

function statsFor(socket) {
  if (!socket) return { ok: 0, failed: 0, waitedForConnection: 0 };
  if (!socket[SEND_STATS]) {
    Object.defineProperty(socket, SEND_STATS, {
      value: { ok: 0, failed: 0, waitedForConnection: 0 },
      enumerable: false
    });
  }
  return socket[SEND_STATS];
}

function getSendStats(socket) {
  return { ...statsFor(socket) };
}

/**
 * Envoi fiable.
 * @param {Function} sendFn fonction d'envoi brute (le `sendMessage` d'origine)
 * @param {object}   socket socket à inspecter pour l'état de connexion
 */
async function safeSend(sendFn, socket, jid, content, options = {}) {
  const {
    retries = DEFAULTS.retries,
    retryDelayMs = DEFAULTS.retryDelayMs,
    readyTimeoutMs = DEFAULTS.readyTimeoutMs,
    delay = defaultDelay,
    logger = console
  } = options;

  const stats = statsFor(socket);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let readiness = socketReadiness(socket);
    if (!readiness.ready) {
      stats.waitedForConnection += 1;
      readiness = await waitForReady(socket, readyTimeoutMs, delay);
      if (!readiness.ready) {
        lastError = new Error(`Connexion WhatsApp indisponible (${readiness.reason})`);
        if (attempt < retries) await delay(retryDelayMs);
        continue;
      }
    }

    try {
      const sent = await sendFn(jid, content, options);
      stats.ok += 1;
      return sent;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  stats.failed += 1;
  const label = typeof jid === 'string' ? jid : String(jid);
  // Message volontairement explicite : c'est le cas « réponse invisible ».
  if (logger && typeof logger.error === 'function') {
    logger.error(
      `[ENVOI ÉCHOUÉ] ${label} — le destinataire ne recevra pas ce message. ` +
      `Raison : ${lastError && lastError.message ? lastError.message : lastError}`
    );
  }
  throw lastError || new Error(`Envoi impossible vers ${label}`);
}

/**
 * Enveloppe `socket.sendMessage` pour que tous les appels du bot passent par
 * la vérification de connexion. À installer AVANT tout autre wrapper
 * (notamment celui du thème) pour rester au plus près de l'envoi réel.
 */
function installSafeSend(socket, options = {}) {
  if (!socket || typeof socket.sendMessage !== 'function') return socket;
  if (socket[SAFE_SEND_MARK]) return socket;

  const original = socket.sendMessage.bind(socket);
  socket.sendMessage = (jid, content, opts = {}) => {
    // Échappatoire pour les envois internes qui ne doivent jamais attendre.
    if (opts && opts._unsafeSend) return original(jid, content, opts);
    return safeSend(original, socket, jid, content, { ...options, ...(opts || {}) });
  };

  Object.defineProperty(socket, SAFE_SEND_MARK, { value: true, enumerable: false });
  return socket;
}

module.exports = {
  safeSend,
  installSafeSend,
  socketReadiness,
  waitForReady,
  getSendStats,
  WEBSOCKET_OPEN,
  DEFAULTS
};
