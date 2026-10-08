'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getTelegramStickerEntries, _test } = require('../services/telegram-stickers');

test('extrait le nom des liens Telegram addstickers et addemoji', () => {
  assert.equal(_test.getStickerSetName('https://t.me/addstickers/AnimatedEmojies'), 'AnimatedEmojies');
  assert.equal(_test.getStickerSetName('https://telegram.me/addemoji/My_Emoji_2?start=1'), 'My_Emoji_2');
  assert.throws(() => _test.getStickerSetName('https://example.com/addstickers/Test'), /t\.me/i);
});

test('utilise getStickerSet puis getFile au lieu de scraper la page HTML', async () => {
  const methods = [];
  const http = {
    async get(url, config) {
      const method = url.split('/').pop();
      methods.push(method);
      if (method === 'getStickerSet') {
        assert.equal(config.params.name, 'AnimatedEmojies');
        return {
          data: {
            ok: true,
            result: {
              title: 'Animated Emoji',
              name: 'AnimatedEmojies',
              stickers: [
                { file_id: 'one', is_animated: true, is_video: false },
                { file_id: 'two', is_animated: false, is_video: true }
              ]
            }
          }
        };
      }
      const suffix = config.params.file_id === 'one' ? 'stickers/one.tgs' : 'stickers/two.webm';
      return { data: { ok: true, result: { file_path: suffix } } };
    }
  };

  const result = await getTelegramStickerEntries(
    'https://t.me/addstickers/AnimatedEmojies',
    { token: '123:secret', http }
  );

  assert.deepEqual(methods, ['getStickerSet', 'getFile', 'getFile']);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].extension, 'tgs');
  assert.equal(result.entries[1].extension, 'webm');
  assert.match(result.entries[0].url, /\/file\/bot123:secret\/stickers\/one\.tgs$/);
});

test('accepte encore un lien direct .tgs sans token', async () => {
  const result = await getTelegramStickerEntries('https://cdn.example/sticker.tgs');
  assert.equal(result.entries[0].extension, 'tgs');
});

test('explique la configuration requise si le token Telegram manque', async () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    await assert.rejects(
      () => getTelegramStickerEntries('https://t.me/addstickers/TestPack', { token: '' }),
      /TELEGRAM_BOT_TOKEN/
    );
  } finally {
    if (previous !== undefined) process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});

test('ne divulgue pas le token dans les erreurs Telegram', async () => {
  const secret = '123:TOP_SECRET';
  const http = {
    async get() {
      const error = new Error(`request to ${secret} failed`);
      throw error;
    }
  };
  await assert.rejects(
    () => _test.telegramMethod(secret, 'getStickerSet', { name: 'x' }, http),
    (error) => !error.message.includes(secret) && error.message.includes('[TOKEN]')
  );
});
