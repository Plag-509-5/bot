'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeFilename,
  validHttpUrl,
  uploadBuffer,
  uploadUguu,
  uploadCatbox,
  upload0x0,
  uploadTmpFiles
} = require('../services/file-upload');

const FILE = Buffer.from('fichier de test');

test('valide les noms et URLs de sortie', () => {
  assert.equal(safeFilename('../../mauvais nom?.jpg'), '.._.._mauvais_nom_.jpg');
  assert.equal(validHttpUrl('javascript:alert(1)'), '');
  assert.equal(validHttpUrl('https://cdn.example.test/file.jpg'), 'https://cdn.example.test/file.jpg');
});

test('le statut HTTP 412 déclenche un fallback au lieu de faire échouer .tourl', async () => {
  const calls = [];
  const providers = [
    {
      name: 'Hébergeur-412',
      async upload() {
        calls.push('412');
        const error = new Error('Request failed with status code 412');
        error.response = { status: 412 };
        throw error;
      }
    },
    {
      name: 'Secours',
      async upload(buffer, filename, mimetype) {
        calls.push('secours');
        assert.deepEqual(buffer, FILE);
        assert.equal(filename, 'photo.jpg');
        assert.equal(mimetype, 'image/jpeg');
        return 'https://cdn.example.test/photo.jpg';
      }
    }
  ];

  const result = await uploadBuffer(FILE, {
    filename: 'photo.jpg',
    mimetype: 'image/jpeg',
    providers
  });

  assert.deepEqual(calls, ['412', 'secours']);
  assert.equal(result.url, 'https://cdn.example.test/photo.jpg');
  assert.equal(result.provider, 'Secours');
  assert.deepEqual(result.failures, [{ provider: 'Hébergeur-412', error: 'HTTP 412' }]);
});

test('la chaîne réelle continue après un HTTP 412 de Catbox', async () => {
  const calls = [];
  const http = {
    async post(url) {
      calls.push(url);
      if (url.includes('uguu.se')) {
        const error = new Error('indisponible');
        error.response = { status: 503 };
        throw error;
      }
      if (url.includes('catbox.moe')) {
        const error = new Error('precondition failed');
        error.response = { status: 412 };
        throw error;
      }
      if (url === 'https://0x0.st') return { data: 'https://0x0.st/secours.jpg\n' };
      throw new Error(`appel inattendu: ${url}`);
    }
  };

  const result = await uploadBuffer(FILE, {
    filename: 'photo.jpg',
    mimetype: 'image/jpeg',
    http
  });
  assert.equal(result.provider, '0x0.st');
  assert.equal(result.url, 'https://0x0.st/secours.jpg');
  assert.equal(result.failures[1].error, 'HTTP 412');
  assert.deepEqual(calls, [
    'https://uguu.se/upload',
    'https://catbox.moe/user/api.php',
    'https://0x0.st'
  ]);
});

test('normalise les réponses des quatre hébergeurs configurés', async () => {
  const responses = new Map([
    ['https://uguu.se/upload', { files: [{ url: 'https://a.uguu.se/test.jpg' }] }],
    ['https://catbox.moe/user/api.php', 'https://files.catbox.moe/test.jpg\n'],
    ['https://0x0.st', 'https://0x0.st/test.jpg\n'],
    ['https://tmpfiles.org/api/v1/upload', { data: { url: 'https://tmpfiles.org/test.jpg' } }]
  ]);
  const http = {
    async post(url) {
      assert.equal(responses.has(url), true, `endpoint inattendu: ${url}`);
      return { status: 200, data: responses.get(url) };
    }
  };

  assert.equal(await uploadUguu(FILE, 'test.jpg', 'image/jpeg', http), 'https://a.uguu.se/test.jpg');
  assert.equal(await uploadCatbox(FILE, 'test.jpg', 'image/jpeg', http), 'https://files.catbox.moe/test.jpg');
  assert.equal(await upload0x0(FILE, 'test.jpg', 'image/jpeg', http), 'https://0x0.st/test.jpg');
  assert.equal(await uploadTmpFiles(FILE, 'test.jpg', 'image/jpeg', http), 'https://tmpfiles.org/dl/test.jpg');
});

test('retourne un diagnostic utile si tous les hébergeurs échouent', async () => {
  const providers = ['A', 'B'].map(name => ({
    name,
    async upload() { throw new Error('réseau indisponible'); }
  }));
  await assert.rejects(
    uploadBuffer(FILE, { filename: 'x.bin', providers }),
    /Tous les hébergeurs sont indisponibles.*A: réseau indisponible.*B: réseau indisponible/
  );
});
