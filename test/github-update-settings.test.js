'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../src/services/github-update-settings');

function fakeDatabase() {
  const documents = new Map();
  const collection = {
    async findOne(query) {
      return documents.get(query._id) || null;
    },
    async updateOne(query, update, options = {}) {
      const current = documents.get(query._id);
      if (!current && !options.upsert) return { matchedCount: 0, modifiedCount: 0 };
      documents.set(query._id, { ...(current || { _id: query._id }), ...update.$set });
      return { matchedCount: current ? 1 : 0, modifiedCount: 1, upsertedCount: current ? 0 : 1 };
    },
    async deleteOne(query) {
      const deletedCount = documents.delete(query._id) ? 1 : 0;
      return { deletedCount };
    }
  };
  return { documents, collectionName: null, collection(name) { this.collectionName = name; return collection; } };
}

test('persiste le dépôt et la branche choisis dans un unique document MongoDB', async () => {
  const db = fakeDatabase();
  let initialized = 0;
  settings.configureGitHubUpdateSettings({
    async initMongo() { initialized += 1; },
    getDb: () => db
  });

  assert.deepEqual(await settings.getUpdateSettings(), {
    repository: '', branch: '', updatedAt: null
  });
  await settings.setUpdateSettings({ repository: 'owner/repo', branch: 'stable' });
  assert.equal(db.collectionName, 'bot_update_settings');
  assert.equal(initialized, 3);
  const saved = await settings.getUpdateSettings();
  assert.equal(saved.repository, 'owner/repo');
  assert.equal(saved.branch, 'stable');
  assert.ok(saved.updatedAt instanceof Date);
  assert.equal(db.documents.size, 1);

  const next = await settings.setUpdateSettings({ branch: 'next' });
  assert.equal(next.repository, 'owner/repo');
  assert.equal(next.branch, 'next');
  assert.ok(next.updatedAt instanceof Date);
  assert.deepEqual(await settings.clearUpdateSettings(), {
    repository: '', branch: '', updatedAt: null
  });
  assert.equal(db.documents.size, 0);
});

test('échoue explicitement si le stockage MongoDB des réglages n’est pas configuré', async () => {
  settings.configureGitHubUpdateSettings({});
  await assert.rejects(settings.getUpdateSettings(), /non configuré/);
});
