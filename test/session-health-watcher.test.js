'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_HEALTH_CHECK_INTERVAL_MS,
  SESSION_STALE_AFTER_MS,
  getSocketOpenState,
  forceCloseSessionSocket,
  createSessionHealthWatcher
} = require('../src/services/session-health-watcher');

test('reconnaît le getter isOpen du wrapper WebSocketClient utilisé par Baileys', () => {
  assert.equal(getSocketOpenState({ ws: { isOpen: true } }), true);
  assert.equal(getSocketOpenState({ ws: { isOpen: false, readyState: 1 } }), false);
  assert.equal(getSocketOpenState({ ws: { readyState: 1 } }), true);
  assert.equal(getSocketOpenState({ ws: { socket: { readyState: 3 } } }), false);
  assert.equal(getSocketOpenState({ ws: {} }), null);
  assert.ok(SESSION_KEEPALIVE_INTERVAL_MS >= 10_000 && SESSION_KEEPALIVE_INTERVAL_MS <= 120_000);
  assert.ok(SESSION_HEALTH_CHECK_INTERVAL_MS > 0);
  assert.ok(SESSION_STALE_AFTER_MS >= 60_000);
  if (!process.env.SESSION_KEEPALIVE_INTERVAL_MS) assert.equal(SESSION_KEEPALIVE_INTERVAL_MS, 30_000);
  if (!process.env.SESSION_STALE_AFTER_MS) assert.equal(SESSION_STALE_AFTER_MS, 90_000);
});

test('signale une session seulement après la fenêtre de panne, une fois, puis réarme si elle récupère', async () => {
  let time = 10_000;
  const socket = { ws: { isOpen: false } };
  const sessions = new Map([['50911111111', socket]]);
  const stale = [];
  const watcher = createSessionHealthWatcher({
    getSessions: () => sessions,
    intervalMs: 1_000,
    staleAfterMs: 60_000,
    now: () => time,
    async onStale(number, unhealthySocket, health) {
      stale.push({ number, unhealthySocket, health });
    }
  });

  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 1, stale: 0 });
  time = 69_999;
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 1, stale: 0 });
  time = 70_000;
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 1, stale: 1 });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].number, '50911111111');
  assert.equal(stale[0].unhealthySocket, socket);
  assert.equal(stale[0].health.unhealthyForMs, 60_000);

  time = 80_000;
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 1, stale: 0 });
  assert.equal(stale.length, 1, 'un socket déjà signalé ne doit pas être redémarré à chaque tick');

  socket.ws.isOpen = true;
  time = 81_000;
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 0, stale: 0 });
  socket.ws.isOpen = false;
  time = 90_000;
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 1, stale: 0 });
  time = 150_000;
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 1, stale: 1 });
  assert.equal(stale.length, 2, 'une nouvelle panne après récupération doit être signalée');

  sessions.delete('50911111111');
  assert.deepEqual(await watcher.checkNow(), { skipped: false, tracked: 0, stale: 0 });
  watcher.stop();
});

test('le timer est idempotent, non bloquant et peut être arrêté', async () => {
  let tick;
  let cleared;
  let unrefCalled = false;
  const sessions = new Map([['active', { ws: { isOpen: true } }]]);
  const handle = { unref() { unrefCalled = true; } };
  const watcher = createSessionHealthWatcher({
    getSessions: () => sessions,
    intervalMs: 250,
    setIntervalFn(callback, ms) {
      assert.equal(ms, 250);
      tick = callback;
      return handle;
    },
    clearIntervalFn(timer) { cleared = timer; }
  });

  assert.equal(watcher.start(), true);
  assert.equal(watcher.start(), false);
  assert.equal(watcher.isRunning(), true);
  assert.equal(unrefCalled, true);
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(watcher.getTrackedSessions(), 0, 'les sockets ouverts ne sont pas marqués comme défaillants');
  watcher.stop();
  assert.equal(cleared, handle);
  assert.equal(watcher.isRunning(), false);
});

test('termine le WebSocket sous-jacent de Baileys sans toucher aux autres sockets', () => {
  let terminated = 0;
  const socket = { ws: { socket: { terminate() { terminated += 1; } } } };
  assert.equal(forceCloseSessionSocket(socket), 'terminated');
  assert.equal(terminated, 1);
  assert.equal(forceCloseSessionSocket({ ws: {} }), 'unavailable');
});

test('pair.js configure le ping Baileys natif et relie le watchdog au reconnect scheduler', () => {
  const pairSource = fs.readFileSync(path.join(__dirname, '../src/core/pair.js'), 'utf8');
  assert.match(pairSource, /keepAliveIntervalMs:\s*SESSION_KEEPALIVE_INTERVAL_MS/);
  assert.match(pairSource, /getSessions:\s*\(\)\s*=>\s*activeSockets/);
  assert.match(pairSource, /forceCloseSessionSocket\(socket/);
  assert.match(pairSource, /reconnectScheduler\.schedule\(number/);
});
