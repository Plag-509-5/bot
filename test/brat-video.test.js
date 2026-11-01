'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBratVideoSticker, renderBratSvg, wrapText, MAX_TEXT_LENGTH, MAX_STICKER_BYTES } = require('../src/services/brat-video');

test('rend un sticker animé brat en SVG sans appeler une API tierce', () => {
  const svg = renderBratSvg('kaido & plag', 3).toString();
  assert.match(svg, /#8ACE00/i);
  assert.match(svg, /kaido &amp; plag/);
  assert.match(svg, /width="512" height="512"/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org\/)/);
});

test('génère un WebP animé valide avec 12 images et les métadonnées du pack', async () => {
  const sticker = await createBratVideoSticker('KAIDO MD');
  const WebP = require('node-webpmux');
  const image = new WebP.Image();
  await image.load(sticker);
  assert.ok(image.hasAnim);
  assert.equal(image.frames.length, 12);
  assert.ok(image.exif);
  assert.ok(sticker.length < MAX_STICKER_BYTES);
});

test('retourne une erreur utile pour un texte vide, trop long ou illisible', () => {
  assert.throws(() => renderBratSvg('  '), /Ajoute le texte/i);
  assert.throws(() => renderBratSvg('x'.repeat(MAX_TEXT_LENGTH + 1)), /limité/i);
  assert.throws(() => renderBratSvg('un '.repeat(75)), /trop long/i);
});

test('retourne des lignes brèves et conserve les retours à la ligne explicites', () => {
  assert.deepEqual(wrapText('brat video très sympa', 8), ['brat', 'video', 'très', 'sympa']);
  assert.deepEqual(wrapText('brat\nvideo', 13), ['brat', 'video']);
});
