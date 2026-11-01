'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sendPlugin = require('../src/plugins/owner/send');

function makeContext(args, sessionCfg = {}, overrides = {}) {
  const sent = [];
  const context = {
    socket: {
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: String(sent.length) } };
      }
    },
    msg: { key: { remoteJid: '50900000000@s.whatsapp.net', id: `send-${args.join('-')}` } },
    from: '50900000000@s.whatsapp.net',
    sender: '50900000000@s.whatsapp.net',
    senderNumber: '50900000000',
    sessionNumber: '50900000000',
    sessionCfg,
    prefix: '.',
    args,
    isOwner: true,
    isSessionOwner: false,
    ...overrides
  };
  return { context, sent };
}

test('.send ajoute plusieurs mots-clés, active/désactive et conserve les réglages de session', async () => {
  const persisted = [];
  const save = async (_session, config) => {
    persisted.push(config);
    return true;
  };

  const first = makeContext(['set', 'voye'], {}, { setUserConfigInMongo: save });
  await sendPlugin.execute(first.context);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, ['voye']);

  const second = makeContext(['set', 'envoie'], persisted.at(-1), { setUserConfigInMongo: save });
  await sendPlugin.execute(second.context);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, ['voye', 'envoie']);

  const on = makeContext(['on'], persisted.at(-1), { setUserConfigInMongo: save });
  await sendPlugin.execute(on.context);
  assert.equal(persisted.at(-1).STATUS_REPLY_FORWARD_ENABLED, true);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, ['voye', 'envoie']);
  assert.match(on.sent.at(-1).content.text, /activé/i);

  const status = makeContext(['status'], persisted.at(-1));
  await sendPlugin.execute(status.context);
  assert.match(status.sent.at(-1).content.text, /ACTIVÉ/);
  assert.match(status.sent.at(-1).content.text, /voye/);
  assert.match(status.sent.at(-1).content.text, /envoie/);

  const off = makeContext(['off'], persisted.at(-1), { setUserConfigInMongo: save });
  await sendPlugin.execute(off.context);
  assert.equal(persisted.at(-1).STATUS_REPLY_FORWARD_ENABLED, false);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, ['voye', 'envoie']);
});

test('.send déduplique, retire ou efface les mots-clés', async () => {
  const persisted = [];
  const save = async (_session, config) => { persisted.push(config); return true; };
  const initial = { STATUS_REPLY_KEYWORDS: ['voye'] };

  const duplicate = makeContext(['set', 'VOYE', 'envoie'], initial, { setUserConfigInMongo: save });
  await sendPlugin.execute(duplicate.context);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, ['voye', 'envoie']);

  const remove = makeContext(['remove', 'voye'], persisted.at(-1), { setUserConfigInMongo: save });
  await sendPlugin.execute(remove.context);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, ['envoie']);

  const clear = makeContext(['clear'], persisted.at(-1), { setUserConfigInMongo: save });
  await sendPlugin.execute(clear.context);
  assert.deepEqual(persisted.at(-1).STATUS_REPLY_KEYWORDS, []);
});

test('.send refuse la configuration par un utilisateur sans droits de session', async () => {
  const unauthorized = makeContext(['on'], {}, {
    isOwner: false,
    isSessionOwner: false,
    isSudo: false
  });
  await sendPlugin.execute(unauthorized.context);
  assert.match(unauthorized.sent.at(-1).content.text, /Seul le propriétaire/);
});
