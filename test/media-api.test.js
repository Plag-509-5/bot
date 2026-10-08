'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requestCobalt,
  downloadFacebook,
  _test
} = require('../src/services/media-api');

const IG_URL = 'https://www.instagram.com/reel/ABC_123/';

test('normalise une réponse Cobalt redirect', () => {
  const result = _test.normaliseCobaltResponse({
    status: 'redirect',
    url: 'https://cdn.example/video.mp4',
    filename: 'reel.mp4'
  }, 'https://cobalt.example', 'video');

  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].type, 'video');
  assert.equal(result.media[0].url, 'https://cdn.example/video.mp4');
});

test('normalise un carrousel Cobalt image + vidéo', () => {
  const result = _test.normaliseCobaltResponse({
    status: 'picker',
    picker: [
      { type: 'photo', url: 'https://cdn.example/photo.jpg' },
      { type: 'video', url: 'https://cdn.example/reel.mp4' }
    ]
  }, 'https://cobalt.example', 'video');

  assert.deepEqual(result.media.map((item) => item.type), ['image', 'video']);
});

test('requestCobalt essaie le serveur de secours', async () => {
  const calls = [];
  const http = {
    async post(url) {
      calls.push(url);
      if (calls.length === 1) {
        const error = new Error('indisponible');
        error.response = { status: 503 };
        throw error;
      }
      return { data: { status: 'redirect', url: 'https://cdn.example/result.mp4' } };
    }
  };

  const result = await requestCobalt(IG_URL, {
    endpoints: ['https://one.example', 'https://two.example']
  }, http);
  assert.deepEqual(calls, ['https://one.example', 'https://two.example']);
  assert.equal(result.provider, 'https://two.example');
});

test('normalise la réponse de l’API Facebook documentée', () => {
  const result = _test.normaliseFacebookResponse({
    status: 'success',
    download_url: '/stream/abc?url=x',
    video_info: { title: 'Ma vidéo', thumbnail: 'https://cdn.example/thumb.jpg' }
  }, 'https://facebook-api.example');

  assert.equal(result.title, 'Ma vidéo');
  assert.equal(result.media[0].url, 'https://facebook-api.example/stream/abc?url=x');
});

test('downloadFacebook bascule sur l’API dédiée si Cobalt échoue', async () => {
  let count = 0;
  const http = {
    async post(url) {
      count += 1;
      if (!url.includes('/download')) throw new Error('Cobalt hors ligne');
      return {
        data: {
          status: 'success',
          download_url: 'https://cdn.example/facebook.mp4',
          video_info: { title: 'Facebook secours' }
        }
      };
    }
  };
  const previous = process.env.COBALT_API_URLS;
  process.env.COBALT_API_URLS = 'https://primary.example';
  try {
    const result = await downloadFacebook('https://www.facebook.com/reel/123', http);
    assert.equal(count, 2);
    assert.equal(result.title, 'Facebook secours');
    assert.equal(result.media[0].url, 'https://cdn.example/facebook.mp4');
  } finally {
    if (previous === undefined) delete process.env.COBALT_API_URLS;
    else process.env.COBALT_API_URLS = previous;
  }
});

test('rejette les liens non HTTP et les réponses sans média', () => {
  assert.equal(_test.absoluteUrl('javascript:alert(1)', 'https://example.com'), null);
  assert.throws(
    () => _test.normaliseCobaltResponse({ status: 'redirect' }, 'https://example.com'),
    /aucun lien/i
  );
});
