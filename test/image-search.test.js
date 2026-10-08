'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchImages, _test } = require('../src/services/image-search');

const openversePayload = {
  results: [
    {
      id: 'less-relevant',
      title: 'Une promenade dans les Caraïbes',
      url: 'https://images.example/caribbean.jpg',
      thumbnail: 'https://api.openverse.org/thumb/caribbean',
      foreign_landing_url: 'https://source.example/caribbean',
      filetype: 'jpg',
      mature: false,
      tags: [{ name: 'haiti' }]
    },
    {
      id: 'exact',
      title: 'Palais Sans Souci Haiti',
      url: 'https://images.example/palais.png',
      thumbnail: 'https://api.openverse.org/thumb/palais',
      foreign_landing_url: 'https://source.example/palais',
      filetype: 'png',
      mature: false,
      creator: 'Photographe',
      license: 'by-sa',
      license_version: '4.0',
      attribution: 'Palais Sans Souci Haiti par Photographe'
    },
    {
      id: 'mature',
      title: 'Palais Sans Souci Haiti',
      url: 'https://images.example/rejected.jpg',
      filetype: 'jpg',
      mature: true
    }
  ]
};

test('Openverse filtre le contenu mature et remonte le titre exact', () => {
  const images = _test.normaliseOpenverseResponse(openversePayload, 'palais sans souci haiti', 5);
  assert.equal(images.length, 2);
  assert.equal(images[0].title, 'Palais Sans Souci Haiti');
  assert.equal(images[0].url, 'https://api.openverse.org/thumb/palais');
  assert.equal(images[0].license, 'BY-SA 4.0');
});

test('normalise les résultats haute qualité de Pexels', () => {
  const images = _test.normalisePexelsResponse({ photos: [{
    id: 42,
    alt: 'Chat noir sur un canapé',
    photographer: 'Alice',
    url: 'https://www.pexels.com/photo/42',
    src: { large2x: 'https://images.pexels.com/42-large.jpg', original: 'https://images.pexels.com/42.jpg' }
  }] }, 4);
  assert.equal(images[0].provider, 'Pexels');
  assert.equal(images[0].creator, 'Alice');
  assert.match(images[0].attribution, /Alice/);
});

test('utilise Openverse sans clé et envoie les paramètres de pertinence/sécurité', async () => {
  let request;
  const http = {
    async get(url, config) {
      request = { url, config };
      return { data: openversePayload };
    }
  };
  const images = await searchImages('palais sans souci haiti', 4, http, { pexelsApiKey: '' });
  assert.match(request.url, /api\.openverse\.org/);
  assert.equal(request.config.params.q, 'palais sans souci haiti');
  assert.equal(request.config.params.mature, 'false');
  assert.equal(images[0].title, 'Palais Sans Souci Haiti');
});

test('utilise Pexels en priorité lorsqu’une clé est configurée', async () => {
  const calls = [];
  const http = {
    async get(url, config) {
      calls.push({ url, config });
      return { data: { photos: [{ id: 1, alt: 'Montagne', src: { large: 'https://images.pexels.com/mountain.jpg' } }] } };
    }
  };
  const images = await searchImages('montagne', 2, http, { pexelsApiKey: 'secret' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.pexels\.com/);
  assert.equal(calls[0].config.headers.Authorization, 'secret');
  assert.equal(images[0].provider, 'Pexels');
});

test('bascule sur Openverse si Pexels échoue', async () => {
  const calls = [];
  const http = {
    async get(url) {
      calls.push(url);
      if (url.includes('pexels')) throw new Error('quota');
      return { data: openversePayload };
    }
  };
  const images = await searchImages('palais sans souci haiti', 2, http, { pexelsApiKey: 'secret' });
  assert.equal(calls.length, 2);
  assert.equal(images[0].provider, 'Openverse');
});

test('searchImages rejette une recherche vide', async () => {
  await assert.rejects(() => searchImages('   '), /vide/i);
});
