'use strict';

const sharp = require('sharp');

const PRESETS = Object.freeze({
  glow: ['#39e6ff', '#8e59ff'],
  glitch: ['#ff285d', '#22efff'],
  pixel: ['#b5ff3b', '#2ad69a'],
  graffiti: ['#ff8a00', '#ff2e89'],
  graffiti2: ['#ffca3a', '#f72585'],
  graffiti3: ['#00f5d4', '#9b5de5'],
  graffiti4: ['#ff5d8f', '#ffd166'],
  gradient: ['#7357ff', '#00d4ff'],
  wtone: ['#ffffff', '#9bb7d4'],
  phub: ['#ff9e00', '#ffffff'],
  avenger: ['#ff3b30', '#75baff'],
  marvel: ['#ff2b2b', '#f4f4f4'],
  sea: ['#27e0d0', '#2f71ff'],
  horror: ['#ff3030', '#650000'],
  whitebear: ['#ffffff', '#b8d8ff'],
  joker: ['#c64cff', '#65ff9a'],
  metallic: ['#f2f6ff', '#6685b5'],
  steel: ['#cad7ea', '#62748b'],
  harrypotter: ['#f5d27a', '#813d19'],
  underwater: ['#62e7ff', '#1c64c8'],
  luxury: ['#ffe7a0', '#b98624'],
  glue: ['#c6fff5', '#4b99a0'],
  fabric: ['#ffd6ed', '#9662a3'],
  toxic: ['#c8ff35', '#298b56'],
  ancient: ['#ffe0a6', '#a05b28'],
  cloud: ['#ffffff', '#93a9d3'],
  transformer: ['#ffc857', '#eb3a35'],
  matrix: ['#80ff72', '#00b800'],
  lion: ['#ffca6a', '#9e4d1a']
});

const STYLE_ALIASES = Object.freeze({
  logo1: 'glow', logo2: 'glitch', logo3: 'pixel', logo4: 'graffiti', logo5: 'graffiti2',
  logo6: 'graffiti3', logo7: 'graffiti4', logo8: 'gradient', logo9: 'metallic', logo10: 'avenger',
  logo11: 'marvel', logo12: 'luxury', gfx1: 'glow', gfx2: 'graffiti3', gfx3: 'horror', gfx4: 'matrix',
  gfx5: 'joker', gfx6: 'lion', gfx7: 'glitch', gfx8: 'horror', gfx9: 'pixel', gfx10: 'avenger',
  gfx11: 'transformer', gfx12: 'toxic', gfx13: 'horror', gfx14: 'glow'
});
const COMMAND_ALIASES = Object.freeze([
  ...Object.keys(STYLE_ALIASES), ...Object.keys(PRESETS), 'grafiti', 'grafiti2', 'grafiti3', 'grafiti4', 'gradient',
  'wtone', 'phub', 'avenger', 'marvel', 'whitebear', 'harrypotter', 'underwater', 'luxury', 'glue', 'fabric',
  'toxic', 'ancient', 'cloud', 'transformer', 'gfx'
].filter((name, index, all) => name !== 'logo' && all.indexOf(name) === index));

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}
function normalizeStyle(style) {
  const value = String(style || 'glow').toLowerCase();
  const resolved = STYLE_ALIASES[value] || ({ grafiti: 'graffiti', grafiti2: 'graffiti2', grafiti3: 'graffiti3', grafiti4: 'graffiti4' })[value] || value;
  return PRESETS[resolved] || ['#ffd166', '#ef476f'];
}
function normalizeText(value) {
  const parts = String(value || '').split(/[;:]/).map(item => item.trim()).filter(Boolean).slice(0, 2);
  return parts.map(item => [...item].slice(0, 34).join(''));
}
function buildSvg(style, text) {
  const [first, second] = normalizeText(text);
  if (!first) throw new Error('Ajoute un texte à transformer en logo.');
  const colors = normalizeStyle(style);
  const text1Size = Math.min(104, Math.max(48, 970 / Math.max(first.length, 1)));
  const text2Size = second ? Math.min(58, Math.max(34, 920 / second.length)) : 0;
  const text1Y = second ? 270 : 300;
  const text2Y = 366;
  const text1 = escapeXml(first);
  const text2 = second ? escapeXml(second) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#070a12"/></linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient>
      <filter id="shadow" x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="9" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1024" height="512" rx="44" fill="url(#bg)"/>
    <path d="M55 90h914M55 422h914" stroke="url(#ink)" stroke-opacity=".55" stroke-width="3"/>
    <circle cx="90" cy="90" r="7" fill="${colors[0]}"/><circle cx="934" cy="422" r="7" fill="${colors[1]}"/>
    <text x="512" y="${text1Y}" text-anchor="middle" dominant-baseline="middle" fill="url(#ink)" stroke="#10131c" stroke-width="2" paint-order="stroke" font-family="Arial, sans-serif" font-size="${text1Size}" font-weight="900" filter="url(#shadow)">${text1}</text>
    ${text2 ? `<text x="512" y="${text2Y}" text-anchor="middle" dominant-baseline="middle" fill="#f8fafc" font-family="Arial, sans-serif" font-size="${text2Size}" font-weight="800" letter-spacing="2">${text2}</text>` : ''}
    <text x="512" y="475" text-anchor="middle" fill="#8f9bb1" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="5">KAIDO • MUGIWARA</text>
  </svg>`;
}
async function createKaidoLogo(style, text) {
  const svg = Buffer.from(buildSvg(style, text));
  return sharp(svg).png().toBuffer();
}

module.exports = { PRESETS, STYLE_ALIASES, COMMAND_ALIASES, escapeXml, normalizeStyle, normalizeText, buildSvg, createKaidoLogo };
