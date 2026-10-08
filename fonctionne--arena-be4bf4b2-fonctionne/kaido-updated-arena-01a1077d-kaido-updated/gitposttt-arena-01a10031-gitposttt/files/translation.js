const { MongoClient } = require('mongodb');

// Configuration de la connexion MongoDB
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://MUGIWARA:adminplag@kaidomd.yev7rzt.mongodb.net/?appName=Kaidomd";
const DB_NAME = "MUGIWARA_NO_PLAG"; // Modifiez si votre base de données a un autre nom
const COLLECTION_NAME = "session_languages";

/**
 * Sauvegarde la langue d'une session dans MongoDB
 */
async function saveSessionLanguage(sessionId, langCode) {
  let client;
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    await collection.updateOne(
      { sessionId: sessionId.toString() },
      { $set: { lang: langCode.toLowerCase().trim(), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.error("[MONGO LANG SAVE ERROR]", err);
    throw err;
  } finally {
    if (client) await client.close();
  }
}

/**
 * Récupère la langue d'une session depuis MongoDB
 */
async function getSessionLanguage(sessionId) {
  let client;
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const doc = await collection.findOne({ sessionId: sessionId.toString() });
    return doc ? doc.lang : 'fr'; // 'fr' par défaut si non configuré
  } catch (err) {
    console.error("[MONGO LANG GET ERROR]", err);
    return 'fr'; // Fallback sur le français en cas d'erreur
  } finally {
    if (client) await client.close();
  }
}

/**
 * Injecte le wrapper de traduction sur l'envoi de messages du socket
 */
async function setupTranslationWrapper(socket, number) {
  if (!socket || !socket.sendMessage) {
    console.error("[TRANSLATION WRAPPER] L'instance socket est invalide.");
    return;
  }

  // Sauvegarde de la méthode originale de Baileys
  const originalSendMessage = socket.sendMessage.bind(socket);

  // Surcharge/Interception de sendMessage
  socket.sendMessage = async (jid, content, options = {}) => {
    try {
      const { translate } = require('@vitalets/google-translate-api');
      const sessionId = number || socket.user?.id?.split(':')[0];
      
      // Récupération asynchrone de la langue ciblée
      const targetLang = await getSessionLanguage(sessionId);

      // On ne traduit que si la langue demandée n'est pas le français
      if (targetLang !== 'fr') {
        
        // 1. Traduction du texte brut (content.text)
        if (content && typeof content.text === 'string' && content.text.trim().length > 0) {
          const translated = await translate(content.text, { to: targetLang, autoCorrect: true });
          if (translated?.text) content.text = translated.text;
        }
        
        // 2. Traduction de la légende de médias (content.caption)
        if (content && typeof content.caption === 'string' && content.caption.trim().length > 0) {
          const translated = await translate(content.caption, { to: targetLang, autoCorrect: true });
          if (translated?.text) content.caption = translated.text;
        }
      }
    } catch (transErr) {
      console.error('[AUTOMATIC TRANSLATION ERROR]:', transErr.message || transErr);
    }

    // Exécution de l'envoi original Baileys
    return await originalSendMessage(jid, content, options);
  };
}

// Exportation des fonctions pour les utiliser dans pair.js
module.exports = {
  saveSessionLanguage,
  getSessionLanguage,
  setupTranslationWrapper
};