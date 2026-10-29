'use strict';

const COLLECTION_NAME = 'bot_update_settings';
const SETTINGS_ID = 'active';

let initMongoProvider = null;
let getDbProvider = null;

function configureGitHubUpdateSettings({ initMongo, getDb } = {}) {
  initMongoProvider = typeof initMongo === 'function' ? initMongo : null;
  getDbProvider = typeof getDb === 'function' ? getDb : null;
}

async function settingsCollection() {
  if (!initMongoProvider || !getDbProvider) {
    throw new Error('Stockage MongoDB des mises à jour non configuré.');
  }
  await initMongoProvider();
  const db = getDbProvider();
  if (!db) throw new Error('MongoDB indisponible pour les paramètres de mise à jour.');
  return db.collection(COLLECTION_NAME);
}

async function getUpdateSettings() {
  const collection = await settingsCollection();
  const doc = await collection.findOne({ _id: SETTINGS_ID });
  return {
    repository: String(doc?.repository || ''),
    branch: String(doc?.branch || ''),
    updatedAt: doc?.updatedAt || null
  };
}

async function setUpdateSettings(patch = {}) {
  const repository = patch.repository === undefined ? undefined : String(patch.repository || '').trim();
  const branch = patch.branch === undefined ? undefined : String(patch.branch || '').trim();
  if (repository === undefined && branch === undefined) {
    throw new Error('Aucun paramètre de mise à jour à enregistrer.');
  }

  const values = { updatedAt: new Date() };
  if (repository !== undefined) values.repository = repository;
  if (branch !== undefined) values.branch = branch;

  const collection = await settingsCollection();
  await collection.updateOne(
    { _id: SETTINGS_ID },
    { $set: values },
    { upsert: true }
  );
  return getUpdateSettings();
}

async function clearUpdateSettings() {
  const collection = await settingsCollection();
  await collection.deleteOne({ _id: SETTINGS_ID });
  return { repository: '', branch: '', updatedAt: null };
}

module.exports = {
  COLLECTION_NAME,
  SETTINGS_ID,
  configureGitHubUpdateSettings,
  getUpdateSettings,
  setUpdateSettings,
  clearUpdateSettings
};
