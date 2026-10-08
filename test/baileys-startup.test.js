'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { jsFiles } = require('../scripts/baileys-surface');

// Charger vraiment index.js et pair.js (CJS), tous les plugins et le fork ESM.
// Mongo et listen sont neutralisés AVANT l'import : pas de base réelle, pas
// de serveur ni de session WhatsApp et aucun watcher persistant dans ce test.
test('le démarrage CommonJS du bot charge xzcbailz et tous les plugins sans ERR_REQUIRE_ESM', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-startup-'));
  const code = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    fs.watch = () => ({ close() {}, unref() {} });
    const { MongoClient } = require('mongodb');
    const cursor = { async toArray() { return []; }, sort() { return this; } };
    const collection = {
      async createIndex() {}, async dropIndex() {}, async updateMany() {},
      async updateOne() {}, async deleteOne() {}, async deleteMany() {},
      async findOne() { return null; }, find() { return cursor; }
    };
    MongoClient.prototype.connect = async function() { return this; };
    MongoClient.prototype.db = () => ({ collection: () => collection });
    const express = require('express');
    let started = false;
    express.application.listen = function(port, host, done) {
      assert.equal(host, '0.0.0.0');
      started = true;
      done();
      return { close() {} };
    };
    require('./index.js');
    assert.ok(started);
    setImmediate(() => console.log('STARTUP_COMPAT_OK'));
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', code], {
      cwd: path.join(__dirname, '..'),
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, SESSIONS_DIR: sandbox, MONGO_URI: 'mongodb://127.0.0.1:1/test', PORT: '0' }
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /STARTUP_COMPAT_OK/);
    const count = jsFiles(path.join(__dirname, '..', 'src', 'plugins')).length;
    assert.match(result.stdout, new RegExp(`${count} plugins chargés avec succès`));
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|Erreur chargement plugin|Uncaught exception|Mongo init failed/);
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
});
