'use strict';

const idleTimers = new WeakMap();

function configEnabled(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (/^(?:true|on|1|yes)$/i.test(value.trim())) return true;
    if (/^(?:false|off|0|no)$/i.test(value.trim())) return false;
  }
  return fallback;
}

async function setSessionPresence(socket, online, jid) {
  if (!socket || typeof socket.sendPresenceUpdate !== 'function') return;
  await socket.sendPresenceUpdate(online ? 'available' : 'unavailable', jid).catch(() => {});
}

function clearIdleTimer(socket) {
  const current = idleTimers.get(socket);
  if (current) clearTimeout(current);
  idleTimers.delete(socket);
}

function scheduleOffline(socket, jid, delayMs = 30_000) {
  clearIdleTimer(socket);
  const timer = setTimeout(() => {
    setSessionPresence(socket, false, jid).catch(() => {});
    idleTimers.delete(socket);
  }, delayMs);
  timer.unref?.();
  idleTimers.set(socket, timer);
}

async function handleIgnoredMessage(socket, msg, sessionConfig = {}) {
  if (configEnabled(sessionConfig.AUTO_ONLINE, false)) return;
  await setSessionPresence(socket, false, msg?.key?.remoteJid);
}

async function wakeForCommand(socket, msg, sessionConfig = {}, options = {}) {
  const alwaysOnline = configEnabled(sessionConfig.AUTO_ONLINE, false);
  const autoRecording = configEnabled(sessionConfig.AUTO_RECORDING, false);
  const jid = msg?.key?.remoteJid;

  if (!alwaysOnline && !msg?.key?.fromMe && msg?.key) {
    // Une commande est le seul message explicitement marqué comme lu par ce handler.
    await socket.readMessages?.([msg.key]).catch(() => {});
  }

  if (autoRecording) {
    await socket.sendPresenceUpdate?.('recording', jid).catch(() => {});
  } else {
    await setSessionPresence(socket, true, jid);
  }

  if (!alwaysOnline) scheduleOffline(socket, jid, options.sleepAfterMs || 30_000);
}

async function applyAlwaysOnlineSetting(socket, enabled, jid) {
  const online = configEnabled(enabled, false);
  clearIdleTimer(socket);
  await setSessionPresence(socket, online, jid);
  return online;
}

module.exports = {
  configEnabled,
  setSessionPresence,
  handleIgnoredMessage,
  wakeForCommand,
  applyAlwaysOnlineSetting,
  _test: { clearIdleTimer, scheduleOffline }
};
