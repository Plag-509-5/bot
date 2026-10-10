'use strict';

const { MongoClient } = require('mongodb');

const DEFAULT_DB_NAME = 'MUGIWARA_NO_PLAG';

class MongoConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MongoConfigurationError';
    this.code = 'MONGODB_CONFIGURATION_ERROR';
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function createMongoConnection(options = {}) {
  const uri = String(options.uri ?? process.env.MONGO_URI ?? '').trim();
  const dbName = String(options.dbName ?? process.env.MONGO_DB ?? DEFAULT_DB_NAME).trim() || DEFAULT_DB_NAME;
  const clientFactory = options.clientFactory || ((mongoUri, mongoOptions) => new MongoClient(mongoUri, mongoOptions));
  const clientOptions = {
    appName: 'kaido-md',
    maxPoolSize: positiveInteger(process.env.MONGO_MAX_POOL_SIZE, 20),
    minPoolSize: 0,
    serverSelectionTimeoutMS: positiveInteger(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10_000),
    connectTimeoutMS: positiveInteger(process.env.MONGO_CONNECT_TIMEOUT_MS, 10_000),
    socketTimeoutMS: positiveInteger(process.env.MONGO_SOCKET_TIMEOUT_MS, 45_000),
    retryReads: true,
    retryWrites: true,
    writeConcern: { w: 'majority' },
    ...(options.clientOptions || {})
  };

  let client = null;
  let db = null;
  let connecting = null;

  function validate() {
    if (!uri) {
      throw new MongoConfigurationError(
        'MONGO_URI est obligatoire : les sessions WhatsApp sont stockées uniquement dans MongoDB.'
      );
    }
    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
      throw new MongoConfigurationError('MONGO_URI doit commencer par mongodb:// ou mongodb+srv://.');
    }
  }

  async function connect() {
    if (db) return db;
    if (connecting) return connecting;
    validate();

    connecting = (async () => {
      const nextClient = clientFactory(uri, clientOptions);
      try {
        await nextClient.connect();
        const nextDb = nextClient.db(dbName);
        // Un `connect()` peut réussir avant la première sélection de serveur.
        // Le ping garantit que la connexion est réellement utilisable.
        await nextDb.command({ ping: 1 });
        client = nextClient;
        db = nextDb;
        return db;
      } catch (error) {
        try { await nextClient.close(); } catch (_) {}
        throw error;
      } finally {
        connecting = null;
      }
    })();

    return connecting;
  }

  async function close() {
    if (connecting) {
      try { await connecting; } catch (_) {}
    }
    const current = client;
    client = null;
    db = null;
    if (current) await current.close();
  }

  return {
    connect,
    close,
    getDb: () => db,
    isConnected: () => Boolean(db),
    databaseName: dbName,
    clientOptions: { ...clientOptions }
  };
}

module.exports = {
  createMongoConnection,
  MongoConfigurationError,
  DEFAULT_DB_NAME,
  positiveInteger
};
