'use strict';

// Le vrai makeWASocket / Signal / encodeur du fork, mais AUCUN accès réseau.
// Seul le client WebSocket est remplacé. Pas de handshake Noise : les stanzas
// pré-transport sont décodées localement et les réponses serveur sont simulées.
// Ce banc ne peut donc pas prouver l'acceptation d'un message par WhatsApp.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');
const { WebSocketClient } = require(path.join(
  path.dirname(require.resolve('@whiskeysockets/baileys')),
  'Socket', 'Client', 'websocket.js'
));

const logger = pino({ level: 'silent' });

function memoryKeys() {
  const data = new Map();
  return {
    data,
    async get(type, ids) {
      const result = {};
      for (const id of ids) {
        const key = `${type}:${id}`;
        if (data.has(key)) result[id] = data.get(key);
      }
      return result;
    },
    async set(update) {
      for (const [type, entries] of Object.entries(update)) {
        for (const [id, value] of Object.entries(entries)) {
          const key = `${type}:${id}`;
          if (value === null || value === undefined) data.delete(key);
          else data.set(key, value);
        }
      }
    }
  };
}

function makeOfflineSocket(t, { auth, respond, ...options } = {}) {
  const nodes = [];
  let transport;
  const connectionMock = t.mock.method(WebSocketClient.prototype, 'connect', function () {
    const client = this;
    let firstFrame = true;
    transport = new EventEmitter();
    transport.readyState = 1;
    transport.send = (data, callback) => {
      // La première trame inclut le préambule WA, puis chaque trame contient
      // trois octets de longueur. Ne jamais émettre `open` : pas de handshake.
      const frame = Buffer.from(data);
      const offset = firstFrame ? baileys.NOISE_WA_HEADER.length : 0;
      firstFrame = false;
      const length = frame.readUIntBE(offset, 3);
      assert.equal(frame.length, offset + 3 + length);
      Promise.resolve(baileys.decodeBinaryNode(frame.subarray(offset + 3)))
        .then(async node => {
          nodes.push(node);
          const reply = respond ? await respond(node) : {
            tag: 'iq',
            attrs: { id: node.attrs.id, type: 'result', from: 's.whatsapp.net' },
            content: []
          };
          callback(null);
          if (reply) queueMicrotask(() => client.emit(`TAG:${node.attrs.id}`, reply));
        })
        .catch(callback);
    };
    transport.close = () => {
      transport.readyState = 3;
      transport.emit('close');
      client.emit('close');
    };
    this.socket = transport;
  });

  const keys = memoryKeys();
  const state = auth || { creds: baileys.initAuthCreds(), keys };
  const socket = baileys.default({
    auth: state,
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    // Défense supplémentaire : même sans le mock, aucune URL WhatsApp.
    waWebSocketUrl: 'ws://127.0.0.1:1',
    connectTimeoutMs: 500,
    defaultQueryTimeoutMs: 500,
    fireInitQueries: false,
    markOnlineOnConnect: false,
    emitOwnEvents: false,
    ...options
  });

  t.after(async () => {
    // makeSocket initialise son buffer dans un nextTick. Le laisser s'exécuter
    // avant end(), sinon il réactive un timer après la destruction du buffer.
    await new Promise(resolve => setImmediate(resolve));
    await socket.end();
    connectionMock.mock.restore();
  });
  return { socket, nodes, state, keys, transport };
}

module.exports = { makeOfflineSocket, memoryKeys, logger };
