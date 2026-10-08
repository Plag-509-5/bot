'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../src/plugins/owner/config');

function createContext(args, overrides = {}) {
  const sent = [];
  const saved = [];
  const presence = [];
  const socket = {
    async sendMessage(jid, content) { sent.push({ jid, content }); },
    async sendPresenceUpdate(value, jid) { presence.push({ value, jid }); }
  };
  return {
    sent,
    saved,
    presence,
    context: {
      socket,
      msg: { key: { id: 'm1' } },
      from: 'chat@s.whatsapp.net',
      args,
      prefix: '.',
      senderNumber: '50911111111',
      sessionNumber: '50911111111',
      isOwner: false,
      config: { OWNER_NUMBER: '50999999999' },
      sessionCfg: { PREFIX: '.', AUTO_ONLINE: false, AUTO_VIEW_STATUS: true },
      async setUserConfigInMongo(number, config) {
        saved.push({ number, config });
        return true;
      },
      ...overrides
    }
  };
}

test('.config setprefix off persiste une chaîne vide et annonce le mode prefixless', async () => {
  const fixture = createContext(['setprefix', 'off']);
  await plugin.execute(fixture.context);
  assert.equal(fixture.saved.length, 1);
  assert.equal(fixture.saved[0].config.PREFIX, '');
  assert.match(fixture.sent.at(-1).content.text, /prefixless/i);
  assert.match(fixture.sent.at(-1).content.text, /config setprefix \./i);
});

test('en mode prefixless, config setprefix . réactive immédiatement le point', async () => {
  const fixture = createContext(['setprefix', '.'], {
    prefix: '',
    sessionCfg: { PREFIX: '', AUTO_ONLINE: false }
  });
  await plugin.execute(fixture.context);
  assert.equal(fixture.saved[0].config.PREFIX, '.');
  assert.match(fixture.sent.at(-1).content.text, /\.menu/);
});

test('.config alwaysonline on/off persiste et applique la présence', async () => {
  const on = createContext(['alwaysonline', 'on']);
  await plugin.execute(on.context);
  assert.equal(on.saved[0].config.AUTO_ONLINE, true);
  assert.equal(on.presence[0].value, 'available');

  const off = createContext(['alwaysonline', 'off']);
  await plugin.execute(off.context);
  assert.equal(off.saved[0].config.AUTO_ONLINE, false);
  assert.equal(off.presence[0].value, 'unavailable');
});

test('un utilisateur non propriétaire ne peut pas changer la configuration', async () => {
  const fixture = createContext(['setprefix', 'off'], { senderNumber: '50922222222' });
  await plugin.execute(fixture.context);
  assert.equal(fixture.saved.length, 0);
  assert.match(fixture.sent[0].content.text, /propriétaire/i);
});

test('un admin défini dans Mongo peut modifier la configuration', async () => {
  const fixture = createContext(['setprefix', '!'], {
    senderNumber: '50922222222',
    isMongoAdmin: true
  });
  await plugin.execute(fixture.context);
  assert.equal(fixture.saved[0].config.PREFIX, '!');
});

test('un propriétaire de session résolu depuis une identité LID peut modifier la configuration', async () => {
  const fixture = createContext(['setprefix', '#'], {
    senderNumber: '123456789012345',
    isSessionOwner: true
  });
  await plugin.execute(fixture.context);
  assert.equal(fixture.saved[0].config.PREFIX, '#');
});

test('un sudo de la session peut modifier sa configuration', async () => {
  const fixture = createContext(['setprefix', '!'], {
    senderNumber: '50922222222',
    isSudo: true
  });
  await plugin.execute(fixture.context);
  assert.equal(fixture.saved[0].config.PREFIX, '!');
});
