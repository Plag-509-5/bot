'use strict';

require('dotenv').config();

const { createMongoConnection } = require('../src/db/mongo-connection');
const { createMongoAuthBackend } = require('../src/auth/mongo-auth-backend');

async function main() {
  const connection = createMongoConnection();
  const backend = createMongoAuthBackend({
    initMongo: () => connection.connect(),
    getDb: () => connection.getDb()
  });
  const startedAt = Date.now();

  try {
    await backend.ping();
    console.log(
      `✅ MongoDB accessible — base « ${connection.databaseName} », ` +
      `index des sessions prêts (${Date.now() - startedAt} ms).`
    );
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(`❌ Test MongoDB échoué : ${error?.message || error}`);
  process.exitCode = 1;
});
