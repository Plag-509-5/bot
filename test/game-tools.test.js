'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const chain = require('../src/services/word-chain');
const geo = require('../src/services/geography-games');
const sofa = require('../src/services/sofascore');
const qr = require('../src/services/qr-code');
const logo = require('../src/services/kaido-logo');
const github = require('../src/plugins/tools/github');

test('wordchain exige la dernière lettre, rejette doublons et suit les scores par partie', () => {
  const state = chain.start('509', '120@g.us', () => 0);
  assert.equal(state.current, 'pirate');
  assert.equal(chain.play('509', '120@g.us', 'alice@s.whatsapp.net', 'école').ok, true);
  assert.equal(chain.play('509', '120@g.us', 'bob@s.whatsapp.net', 'orage').error, 'wrong_letter');
  assert.equal(chain.play('509', '120@g.us', 'bob@s.whatsapp.net', 'école').error, 'used_word');
  assert.equal(chain.play('509', '120@g.us', 'bob@s.whatsapp.net', 'eau').ok, true);
  assert.equal(state.turns, 2);
  assert.equal(state.scores.get('alice@s.whatsapp.net'), 1);
  assert.notEqual(chain._games.get('510:120@g.us'), state);
  assert.equal(chain.stop('509', '120@g.us'), state);
});

test('guesscapital et guesscountry acceptent les réponses françaises accentuées', () => {
  const capital = geo.start({ sessionNumber: '501', chatJid: 'chat', kind: 'capital', random: () => 0 });
  assert.match(capital.prompt, /Haïti/);
  const capitalResult = geo.answer({ sessionNumber: '501', chatJid: 'chat', kind: 'capital', answer: 'Port-au-Prince', sender: 'alice', random: () => 0 });
  assert.equal(capitalResult.correct, true);
  assert.equal(capitalResult.state.scores.get('alice'), 1);

  const country = geo.start({ sessionNumber: '502', chatJid: 'chat', kind: 'country', random: () => 0 });
  assert.match(country.prompt, /🇭🇹/);
  assert.equal(geo.answer({ sessionNumber: '502', chatJid: 'chat', kind: 'country', answer: 'haiti', random: () => 0 }).correct, true);
  assert.equal(geo.answer({ sessionNumber: '503', chatJid: 'chat', kind: 'country', answer: 'Haïti' }).error, 'no_game');
});

test('SofaScore normalise les résultats et rend les fiches avec des libellés français', async () => {
  const requests = [];
  const client = sofa.createClient({
    async get(url, options) {
      requests.push({ url, options });
      if (url.endsWith('/search/all')) return { data: { results: [{ type: 'player', entity: { id: 1, name: 'Joueur test' } }] } };
      return { data: { player: {
        id: 1, name: 'Joueur test', position: 'F', preferredFoot: 'Right', dateOfBirthTimestamp: 0,
        team: { name: 'Kaido FC', tournament: { name: 'Ligue test' } }, country: { name: 'Haïti' }
      } } };
    }
  });
  const text = await client.search('player', 'joueur test');
  assert.match(text, /Attaquant/);
  assert.match(text, /Pied fort : Droit/);
  assert.match(text, /Équipe : Kaido FC/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.params.q, 'joueur test');
  assert.equal(sofa.formatDate(0), '—');
  await assert.rejects(() => client.search('player', ''), /Ajoute un nom/);
});

test('QR local se crée puis se décode sans API externe', async () => {
  const expected = 'https://kaido.example/bonjour?x=1';
  const image = await qr.createQr(expected);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(await qr.readQr(image), expected);
  await assert.rejects(() => qr.createQr('   '), /vide/);
  await assert.rejects(() => qr.readQr(Buffer.alloc(0)), /invalide/);
});

test('logo KAIDO produit un PNG local, échappe le SVG et comprend les styles aliases', async () => {
  const svg = logo.buildSvg('gfx1', '<Pirate> & crew');
  assert.match(svg, /&lt;Pirate&gt; &amp; crew/);
  assert.equal(logo.normalizeStyle('logo2')[0], logo.PRESETS.glitch[0]);
  const image = await logo.createKaidoLogo('glow', 'Kaido;Mugiwara');
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('profil GitHub est présenté en français et gère les champs absents', () => {
  const text = github._test.renderProfile({ login: 'octocat', id: 583231, public_repos: 8, followers: 2 });
  assert.match(text, /PROFIL GITHUB/);
  assert.match(text, /Identifiant : @octocat/);
  assert.match(text, /Courriel public : —/);
});
