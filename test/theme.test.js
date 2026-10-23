'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const themePlugin = require('../src/plugins/owner/theme');
const { _test: translationTest, FONT_THEME_OPTIONS } = require('../src/features/translation');

test('.theme sans argument liste les codes et le thème Small Caps', async () => {
  const sent = [];
  await themePlugin.execute({
    socket: { async sendMessage(jid, content) { sent.push(content.text); } },
    from: 'owner@s.whatsapp.net',
    msg: {},
    prefix: '.',
    args: [],
    sessionNumber: '50912345678',
    sessionCfg: { FONT_THEME: 'a' }
  });
  assert.match(sent[0], /a — Small Caps/);
  assert.match(sent[0], /b — Sans Bold/);
  assert.match(sent[0], /✅ a — Small Caps/);
});

test('.theme a persiste le code et met à jour le thème du cache de session', async () => {
  translationTest.clearCache();
  let saved;
  const sent = [];
  await themePlugin.execute({
    socket: { async sendMessage(jid, content) { sent.push(content.text); } },
    from: 'owner@s.whatsapp.net',
    msg: {},
    args: ['a'],
    sessionNumber: '50912345678',
    sessionCfg: { MODE: 'public' },
    async setUserConfigInMongo(session, next) { saved = { session, next }; return true; }
  });
  assert.equal(saved.session, '50912345678');
  assert.equal(saved.next.FONT_THEME, 'a');
  assert.equal(saved.next.MODE, 'public');
  assert.equal(translationTest.getCachedFontTheme('50912345678'), 'a');
  assert.match(sent[0], /a — Small Caps/);
  assert.ok(FONT_THEME_OPTIONS.a);
  translationTest.clearCache();
});
