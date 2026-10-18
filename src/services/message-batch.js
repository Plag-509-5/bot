'use strict';

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

module.exports = { processMessageBatch };
