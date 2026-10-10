'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMongoConnection,
  MongoConfigurationError,
  positiveInteger
} = require('../src/db/mongo-connection');

function fakeClientFactory(options = {}) {
  const clients = [];
  const factory = (uri, clientOptions) => {
    const db = {
      name: null,
      commands: [],
      async command(command) {
        this.commands.push(command);
        if (options.failPing) throw new Error('ping refusé');
        return { ok: 1 };
      }
    };
    const client = {
      uri,
      clientOptions,
      dbInstance: db,
      connectCalls: 0,
      closeCalls: 0,
      async connect() {
        this.connectCalls += 1;
        if (options.failConnect) throw new Error('connexion refusée');
      },
      db(name) {
        db.name = name;
        return db;
      },
      async close() { this.closeCalls += 1; }
    };
    clients.push(client);
    return client;
  };
  return { factory, clients };
}

test('MONGO_URI est obligatoire et aucun fallback local n’existe', async () => {
  const fake = fakeClientFactory();
  const connection = createMongoConnection({ uri: '', clientFactory: fake.factory });

  await assert.rejects(connection.connect(), (error) => {
    assert.ok(error instanceof MongoConfigurationError);
    assert.match(error.message, /MONGO_URI est obligatoire/);
    return true;
  });
  assert.equal(fake.clients.length, 0);
});

test('une URI non MongoDB est rejetée avant toute connexion', async () => {
  const fake = fakeClientFactory();
  const connection = createMongoConnection({ uri: 'https://example.test', clientFactory: fake.factory });
  await assert.rejects(connection.connect(), /mongodb:\/\//);
  assert.equal(fake.clients.length, 0);
});

test('connect effectue un ping réel et réutilise la même connexion', async () => {
  const fake = fakeClientFactory();
  const connection = createMongoConnection({
    uri: 'mongodb://localhost:27017',
    dbName: 'kaido_test',
    clientFactory: fake.factory
  });

  const [first, second] = await Promise.all([connection.connect(), connection.connect()]);
  assert.equal(first, second);
  assert.equal(fake.clients.length, 1);
  assert.equal(fake.clients[0].connectCalls, 1);
  assert.deepEqual(first.commands, [{ ping: 1 }]);
  assert.equal(first.name, 'kaido_test');
  assert.equal(connection.isConnected(), true);

  await connection.close();
  assert.equal(fake.clients[0].closeCalls, 1);
  assert.equal(connection.isConnected(), false);
});

test('un ping raté ferme le client et permet une nouvelle tentative', async () => {
  const fake = fakeClientFactory({ failPing: true });
  const connection = createMongoConnection({
    uri: 'mongodb://localhost:27017',
    clientFactory: fake.factory
  });

  await assert.rejects(connection.connect(), /ping refusé/);
  await assert.rejects(connection.connect(), /ping refusé/);
  assert.equal(fake.clients.length, 2);
  assert.ok(fake.clients.every((client) => client.closeCalls === 1));
});

test('les paramètres numériques invalides gardent une valeur sûre', () => {
  assert.equal(positiveInteger('2500', 10), 2500);
  assert.equal(positiveInteger('0', 10), 10);
  assert.equal(positiveInteger('abc', 10), 10);
});
