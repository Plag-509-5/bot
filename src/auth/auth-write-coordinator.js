'use strict';

/**
 * Préserve l'ordre des écritures d'une même clé Signal, tout en laissant les
 * écritures de clés distinctes et les creds progresser en parallèle. Baileys
 * attend toujours l'acquittement MongoDB avant de considérer les clés durables;
 * on retire seulement le verrou global qui sérialisait sans raison tout le
 * trafic auth d'une session.
 */
function createAuthWriteCoordinator({ writeKeys, writeCreds } = {}) {
  if (typeof writeKeys !== 'function' || typeof writeCreds !== 'function') {
    throw new TypeError('writeKeys et writeCreds doivent être des fonctions.');
  }

  const keyTails = new Map();
  const pendingTasks = new Set();
  let credsTail = Promise.resolve();
  let pending = 0;

  function track(promise, after = () => {}) {
    pending += 1;
    let tracked;
    tracked = Promise.resolve(promise).finally(() => {
      pending = Math.max(0, pending - 1);
      after(tracked);
    });
    pendingTasks.add(tracked);
    tracked.finally(() => pendingTasks.delete(tracked)).catch(() => {});
    return tracked;
  }

  function enqueueKeys(changes) {
    const refs = [...new Set((changes || []).map(change => String(change.ref)))];
    if (!refs.length) return Promise.resolve();
    const dependencies = [...new Set(refs.map(ref => keyTails.get(ref)).filter(Boolean))];
    const operation = Promise.all(dependencies.map(task => task.catch(() => {})))
      .then(() => writeKeys(changes));
    let tracked;
    tracked = track(operation, () => {
      for (const ref of refs) {
        if (keyTails.get(ref) === tracked) keyTails.delete(ref);
      }
    });
    for (const ref of refs) keyTails.set(ref, tracked);
    return tracked;
  }

  function enqueueCreds(snapshot) {
    const operation = credsTail.catch(() => {}).then(() => writeCreds(snapshot));
    const tracked = track(operation);
    credsTail = tracked.catch(() => {});
    return tracked;
  }

  async function flush() {
    // Les opérations en attente peuvent elles-mêmes en programmer d'autres;
    // relire la Set jusqu'à ce qu'elle soit vide avant d'autoriser la fermeture.
    while (pendingTasks.size) {
      await Promise.all([...pendingTasks].map(task => task.catch(() => {})));
    }
  }

  return {
    enqueueKeys,
    enqueueCreds,
    flush,
    pendingWrites: () => pending
  };
}

module.exports = { createAuthWriteCoordinator };
