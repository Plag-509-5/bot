'use strict';

const DEFAULT_MESSAGE_PROCESSING_CONCURRENCY = 2;
const DEFAULT_MESSAGE_QUEUE_LIMIT = 100;
const DEFAULT_GLOBAL_MESSAGE_PROCESSING_CONCURRENCY = 32;
const DEFAULT_GLOBAL_MESSAGE_QUEUE_LIMIT = 2048;

function positiveLimit(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/** One fair FIFO worker pool shared by every WhatsApp session in this process. */
function createMessageProcessingPool({
  concurrency = DEFAULT_GLOBAL_MESSAGE_PROCESSING_CONCURRENCY,
  maxQueued = DEFAULT_GLOBAL_MESSAGE_QUEUE_LIMIT
} = {}) {
  const workerLimit = positiveLimit(concurrency, DEFAULT_GLOBAL_MESSAGE_PROCESSING_CONCURRENCY, 512);
  const queueLimit = Number.isInteger(Number(maxQueued)) && Number(maxQueued) >= 0
    ? Math.min(Number(maxQueued), 100_000)
    : DEFAULT_GLOBAL_MESSAGE_QUEUE_LIMIT;
  const queue = [];
  let inFlight = 0;
  let rejected = 0;

  function run(entry) {
    inFlight += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        drain();
      });
  }

  function drain() {
    while (inFlight < workerLimit && queue.length) run(queue.shift());
  }

  function submit(task) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'));
    if (inFlight < workerLimit) {
      return new Promise((resolve, reject) => run({ task, resolve, reject }));
    }
    if (queue.length >= queueLimit) {
      rejected += 1;
      const error = new Error(`File globale des messages pleine (${queueLimit}); message refusé pour protéger le processus.`);
      error.code = 'GLOBAL_MESSAGE_QUEUE_FULL';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
    });
  }

  function getStats() {
    return {
      inFlight,
      queued: queue.length,
      concurrency: workerLimit,
      maxQueued: queueLimit,
      rejected
    };
  }

  return { submit, getStats };
}

/**
 * Traite chaque message d'un `messages.upsert` Baileys. Une mise à jour peut
 * regrouper plusieurs messages; une erreur sur l'un ne doit ni en perdre les
 * suivants ni devenir un rejet de promesse non géré.
 */
async function processMessageBatch(messages, processMessage, onError = () => {}, onProcessed = () => {}) {
  if (!Array.isArray(messages) || typeof processMessage !== 'function') return [];

  const results = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    try {
      const result = await processMessage(message, index);
      results.push(result);
      try {
        await onProcessed(result, { index, message });
      } catch (_) {
        // La télémétrie ne doit pas interrompre la gestion des prochains messages.
      }
    } catch (error) {
      results.push(undefined);
      try {
        await onError(error, { index, message });
      } catch (_) {
        // Une défaillance du logger ne doit pas arrêter le traitement du lot.
      }
    }
  }
  return results;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * Files FIFO indépendantes par chat : un traitement lent dans un groupe ou une
 * commande média ne bloque plus les messages privés/autres groupes de la même
 * session. Le parallélisme global et la file sont bornés pour protéger le
 * processus quand plusieurs sessions reçoivent une rafale.
 */
function createMessageDispatcher({
  concurrency = DEFAULT_MESSAGE_PROCESSING_CONCURRENCY,
  maxPending = DEFAULT_MESSAGE_QUEUE_LIMIT,
  keyFor = message => message?.key?.remoteJid || '__unknown__',
  processingPool = null,
  now = Date.now
} = {}) {
  const workerLimit = boundedInteger(concurrency, DEFAULT_MESSAGE_PROCESSING_CONCURRENCY, 1, 64);
  const queueLimit = boundedInteger(maxPending, DEFAULT_MESSAGE_QUEUE_LIMIT, 1, 100_000);
  const queues = new Map();
  const readyChats = [];
  const activeChats = new Set();
  let queued = 0;
  let inFlight = 0;
  let completed = 0;
  let failed = 0;
  let rejected = 0;
  let totalQueueDelayMs = 0;
  let maxQueueDelayMs = 0;
  let lastQueueDelayMs = null;
  let totalProcessingMs = 0;
  let maxProcessingMs = 0;
  let lastProcessingMs = null;

  function safeCallback(callback, ...args) {
    if (typeof callback !== 'function') return;
    try {
      const result = callback(...args);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  }

  function runTask(chat, task) {
    const startedAt = now();
    const queueDelayMs = Math.max(0, startedAt - task.receivedAt);
    queued = Math.max(0, queued - 1);
    inFlight += 1;
    totalQueueDelayMs += queueDelayMs;
    maxQueueDelayMs = Math.max(maxQueueDelayMs, queueDelayMs);
    lastQueueDelayMs = queueDelayMs;

    const processing = processingPool && typeof processingPool.submit === 'function'
      ? processingPool.submit(() => task.processMessage(task.message))
      : Promise.resolve().then(() => task.processMessage(task.message));

    processing.then(result => {
        completed += 1;
        safeCallback(task.onProcessed, result, {
          message: task.message,
          index: task.index,
          chat,
          queueDelayMs,
          processingDurationMs: Math.max(0, now() - startedAt)
        });
        task.resolve(result);
      }, error => {
        const wasRejected = error?.code === 'GLOBAL_MESSAGE_QUEUE_FULL';
        if (wasRejected) rejected += 1;
        else failed += 1;
        safeCallback(task.onError, error, {
          message: task.message,
          index: task.index,
          chat,
          queueDelayMs,
          processingDurationMs: Math.max(0, now() - startedAt),
          rejected: wasRejected
        });
        task.resolve(undefined);
      })
      .finally(() => {
        const processingDurationMs = Math.max(0, now() - startedAt);
        totalProcessingMs += processingDurationMs;
        maxProcessingMs = Math.max(maxProcessingMs, processingDurationMs);
        lastProcessingMs = processingDurationMs;
        inFlight = Math.max(0, inFlight - 1);
        activeChats.delete(chat);
        const next = queues.get(chat);
        if (next?.length) readyChats.push(chat);
        else queues.delete(chat);
        drain();
      });
  }

  function drain() {
    while (inFlight < workerLimit && readyChats.length) {
      const chat = readyChats.shift();
      if (activeChats.has(chat)) continue;
      const queue = queues.get(chat);
      if (!queue?.length) {
        queues.delete(chat);
        continue;
      }
      activeChats.add(chat);
      runTask(chat, queue.shift());
    }
  }

  function processBatch(messages, processMessage, onError = () => {}, onProcessed = () => {}) {
    if (!Array.isArray(messages) || typeof processMessage !== 'function') return Promise.resolve([]);
    const results = messages.map((message, index) => new Promise(resolve => {
      if (queued >= queueLimit) {
        rejected += 1;
        let rejectedChat = '__unknown__';
        try { rejectedChat = String(keyFor(message) || rejectedChat); } catch (_) {}
        safeCallback(onError, new Error(`File de messages pleine (${queueLimit}); message refusé pour protéger la session.`), {
          message,
          chat: rejectedChat,
          queueDelayMs: 0,
          processingDurationMs: 0,
          index,
          rejected: true
        });
        resolve(undefined);
        return;
      }

      let chat;
      try { chat = String(keyFor(message) || '__unknown__'); }
      catch (_) { chat = '__unknown__'; }
      let queue = queues.get(chat);
      if (!queue) {
        queue = [];
        queues.set(chat, queue);
      }
      const wasIdle = queue.length === 0 && !activeChats.has(chat);
      queue.push({ message, index, processMessage, onError, onProcessed, resolve, receivedAt: now() });
      queued += 1;
      if (wasIdle) readyChats.push(chat);
      drain();
    }));
    drain();
    return Promise.all(results);
  }

  function getStats() {
    const processed = completed + failed;
    return {
      queued,
      inFlight,
      chatsEnAttente: queues.size,
      concurrency: workerLimit,
      maxPending: queueLimit,
      completed,
      failed,
      rejected,
      lastQueueDelayMs,
      averageQueueDelayMs: processed ? Math.round(totalQueueDelayMs / processed) : 0,
      maxQueueDelayMs,
      lastProcessingMs,
      averageProcessingMs: processed ? Math.round(totalProcessingMs / processed) : 0,
      maxProcessingMs
    };
  }

  return { processBatch, getStats };
}

module.exports = {
  DEFAULT_MESSAGE_PROCESSING_CONCURRENCY,
  DEFAULT_MESSAGE_QUEUE_LIMIT,
  DEFAULT_GLOBAL_MESSAGE_PROCESSING_CONCURRENCY,
  DEFAULT_GLOBAL_MESSAGE_QUEUE_LIMIT,
  processMessageBatch,
  createMessageProcessingPool,
  createMessageDispatcher
};
