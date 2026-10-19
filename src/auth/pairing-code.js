'use strict';

/**
 * Émet un code sur le socket Baileys existant, puis confirme sa persistance.
 * La promesse `readiness` est créée dès l'ouverture du socket afin de ne pas
 * manquer la première trame entrante pendant l'installation des handlers.
 */
async function issuePairingCode({
  socket,
  number,
  auth,
  readiness,
  onReady = () => {},
  onRequest = () => {},
  onIssued = () => {}
} = {}) {
  if (!socket || typeof socket.requestPairingCode !== 'function') {
    throw new TypeError('Socket Baileys invalide pour demander un code d’appairage');
  }
  if (!auth || typeof auth.saveCreds !== 'function') {
    throw new TypeError('État MongoDB invalide pour persister les identifiants');
  }

  const ready = await readiness;
  if (ready?.ok === false) {
    throw ready.error || new Error('WhatsApp n’est pas prêt pour l’appairage');
  }

  onReady();
  onRequest();

  // Baileys construit et envoie le stanza `link_code_companion_reg` ici. Il
  // n'attend pas `connection.update.qr` : l'attente de disponibilité est gérée
  // avant cet appel par pairing-lifecycle.js.
  const code = await socket.requestPairingCode(String(number));
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('Baileys n’a renvoyé aucun code d’appairage');
  }

  // Ne pas afficher un code dont les creds ne sont pas durablement en MongoDB.
  await auth.saveCreds();
  if (typeof auth.flush === 'function') await auth.flush();
  onIssued();

  return code.trim();
}

module.exports = { issuePairingCode };
