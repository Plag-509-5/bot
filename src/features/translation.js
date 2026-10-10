'use strict';

const COLLECTION_NAME = 'session_languages';

let initMongoProvider = null;
let getDbProvider = null;

/** Réutilise la connexion MongoDB centrale du bot (aucun second pool/client). */
function configureTranslationStorage({ initMongo, getDb } = {}) {
  initMongoProvider = typeof initMongo === 'function' ? initMongo : null;
  getDbProvider = typeof getDb === 'function' ? getDb : null;
}

async function translationCollection() {
  if (!initMongoProvider || !getDbProvider) {
    throw new Error('Stockage de traduction MongoDB non configuré');
  }
  await initMongoProvider();
  const db = getDbProvider();
  if (!db) throw new Error('MongoDB indisponible pour les langues de session');
  return db.collection(COLLECTION_NAME);
}

/** Sauvegarde la langue d'une session dans le MongoDB central. */
async function saveSessionLanguage(sessionId, langCode) {
  const collection = await translationCollection();
  await collection.updateOne(
    { sessionId: String(sessionId) },
    { $set: { lang: String(langCode).toLowerCase().trim(), updatedAt: new Date() } },
    { upsert: true }
  );
}

/** Récupère la langue d'une session depuis MongoDB. */
async function getSessionLanguage(sessionId) {
  try {
    const collection = await translationCollection();
    const doc = await collection.findOne({ sessionId: String(sessionId) });
    return doc ? doc.lang : 'fr';
  } catch (error) {
    console.error('[MONGO LANG GET ERROR]', error?.message || error);
    return 'fr';
  }
}

/** Injecte le wrapper de traduction sur l'envoi de messages du socket. */
async function setupTranslationWrapper(socket, number) {
  if (!socket || !socket.sendMessage) {
    console.error("[TRANSLATION WRAPPER] L'instance socket est invalide.");
    return;
  }

  const originalSendMessage = socket.sendMessage.bind(socket);
  socket.sendMessage = async (jid, content, options = {}) => {
    try {
      const { translate } = require('@vitalets/google-translate-api');
      const sessionId = number || socket.user?.id?.split(':')[0];
      const targetLang = await getSessionLanguage(sessionId);

      if (targetLang !== 'fr') {
        if (content && typeof content.text === 'string' && content.text.trim()) {
          const translated = await translate(content.text, { to: targetLang, autoCorrect: true });
          if (translated?.text) content.text = translated.text;
        }
        if (content && typeof content.caption === 'string' && content.caption.trim()) {
          const translated = await translate(content.caption, { to: targetLang, autoCorrect: true });
          if (translated?.text) content.caption = translated.text;
        }
      }
    } catch (error) {
      console.error('[AUTOMATIC TRANSLATION ERROR]:', error?.message || error);
    }
    return originalSendMessage(jid, content, options);
  };
}

module.exports = {
  configureTranslationStorage,
  saveSessionLanguage,
  getSessionLanguage,
  setupTranslationWrapper
};
