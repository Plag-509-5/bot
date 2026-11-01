'use strict';

const COUNTRIES = Object.freeze([
  { name: 'Haïti', aliases: ['haiti'], capital: 'Port-au-Prince', flag: '🇭🇹' },
  { name: 'France', aliases: [], capital: 'Paris', flag: '🇫🇷' },
  { name: 'Canada', aliases: [], capital: 'Ottawa', flag: '🇨🇦' },
  { name: 'États-Unis', aliases: ['etats-unis', 'usa', 'états unis', 'united states'], capital: 'Washington', flag: '🇺🇸' },
  { name: 'Mexique', aliases: ['mexico'], capital: 'Mexico', flag: '🇲🇽' },
  { name: 'Brésil', aliases: ['bresil', 'brazil'], capital: 'Brasilia', flag: '🇧🇷' },
  { name: 'Argentine', aliases: ['argentina'], capital: 'Buenos Aires', flag: '🇦🇷' },
  { name: 'Chili', aliases: ['chile'], capital: 'Santiago', flag: '🇨🇱' },
  { name: 'Colombie', aliases: ['colombia'], capital: 'Bogota', flag: '🇨🇴' },
  { name: 'Pérou', aliases: ['perou', 'peru'], capital: 'Lima', flag: '🇵🇪' },
  { name: 'Jamaïque', aliases: ['jamaique', 'jamaica'], capital: 'Kingston', flag: '🇯🇲' },
  { name: 'République dominicaine', aliases: ['republique dominicaine', 'dominican republic'], capital: 'Saint-Domingue', flag: '🇩🇴' },
  { name: 'Cuba', aliases: [], capital: 'La Havane', flag: '🇨🇺' },
  { name: 'Royaume-Uni', aliases: ['royaume uni', 'uk', 'united kingdom'], capital: 'Londres', flag: '🇬🇧' },
  { name: 'Espagne', aliases: ['spain'], capital: 'Madrid', flag: '🇪🇸' },
  { name: 'Portugal', aliases: [], capital: 'Lisbonne', flag: '🇵🇹' },
  { name: 'Allemagne', aliases: ['germany'], capital: 'Berlin', flag: '🇩🇪' },
  { name: 'Italie', aliases: ['italy'], capital: 'Rome', flag: '🇮🇹' },
  { name: 'Pays-Bas', aliases: ['pays bas', 'netherlands', 'hollande'], capital: 'Amsterdam', flag: '🇳🇱' },
  { name: 'Belgique', aliases: ['belgium'], capital: 'Bruxelles', flag: '🇧🇪' },
  { name: 'Suisse', aliases: ['switzerland'], capital: 'Berne', flag: '🇨🇭' },
  { name: 'Pologne', aliases: ['poland'], capital: 'Varsovie', flag: '🇵🇱' },
  { name: 'Ukraine', aliases: [], capital: 'Kyiv', flag: '🇺🇦' },
  { name: 'Russie', aliases: ['russia'], capital: 'Moscou', flag: '🇷🇺' },
  { name: 'Japon', aliases: ['japan'], capital: 'Tokyo', flag: '🇯🇵' },
  { name: 'Chine', aliases: ['china'], capital: 'Pékin', flag: '🇨🇳' },
  { name: 'Corée du Sud', aliases: ['coree du sud', 'south korea'], capital: 'Séoul', flag: '🇰🇷' },
  { name: 'Inde', aliases: ['india'], capital: 'New Delhi', flag: '🇮🇳' },
  { name: 'Thaïlande', aliases: ['thailande', 'thailand'], capital: 'Bangkok', flag: '🇹🇭' },
  { name: 'Vietnam', aliases: ['viêt nam'], capital: 'Hanoï', flag: '🇻🇳' },
  { name: 'Indonésie', aliases: ['indonesie', 'indonesia'], capital: 'Jakarta', flag: '🇮🇩' },
  { name: 'Australie', aliases: ['australia'], capital: 'Canberra', flag: '🇦🇺' },
  { name: 'Nouvelle-Zélande', aliases: ['nouvelle zelande', 'new zealand'], capital: 'Wellington', flag: '🇳🇿' },
  { name: 'Égypte', aliases: ['egypte', 'egypt'], capital: 'Le Caire', flag: '🇪🇬' },
  { name: 'Maroc', aliases: ['morocco'], capital: 'Rabat', flag: '🇲🇦' },
  { name: 'Nigéria', aliases: ['nigeria'], capital: 'Abuja', flag: '🇳🇬' },
  { name: 'Kenya', aliases: [], capital: 'Nairobi', flag: '🇰🇪' },
  { name: 'Afrique du Sud', aliases: ['south africa'], capital: 'Pretoria', flag: '🇿🇦' },
  { name: 'Turquie', aliases: ['turkey'], capital: 'Ankara', flag: '🇹🇷' },
  { name: 'Arabie saoudite', aliases: ['arabie saoudite', 'saudi arabia'], capital: 'Riyad', flag: '🇸🇦' },
  { name: 'Émirats arabes unis', aliases: ['emirats arabes unis', 'uae'], capital: 'Abou Dabi', flag: '🇦🇪' },
  { name: 'Grèce', aliases: ['grece', 'greece'], capital: 'Athènes', flag: '🇬🇷' },
  { name: 'Suède', aliases: ['suede', 'sweden'], capital: 'Stockholm', flag: '🇸🇪' },
  { name: 'Norvège', aliases: ['norvege', 'norway'], capital: 'Oslo', flag: '🇳🇴' },
  { name: 'Irlande', aliases: ['ireland'], capital: 'Dublin', flag: '🇮🇪' },
  { name: 'Islande', aliases: ['iceland'], capital: 'Reykjavik', flag: '🇮🇸' }
]);

const games = new Map();
const normalizeAnswer = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr').replace(/[’']/g, ' ').replace(/\s+/g, ' ');
function gameKey(sessionNumber, chatJid, kind) {
  return `${String(sessionNumber || 'default').replace(/\D/g, '')}:${chatJid}:${kind}`;
}
function isCorrect(country, kind, answer) {
  const candidates = kind === 'capital' ? [country.capital] : [country.name, ...(country.aliases || [])];
  const normalized = normalizeAnswer(answer);
  return candidates.some(candidate => normalizeAnswer(candidate) === normalized);
}
function selectCountry(kind, previous, random = Math.random) {
  const eligible = COUNTRIES.filter(country => country !== previous);
  const index = Math.min(eligible.length - 1, Math.floor(random() * eligible.length));
  return eligible[index];
}

function start({ sessionNumber, chatJid, kind, random = Math.random }) {
  if (!['capital', 'country'].includes(kind)) throw new Error('Type de quiz géographique invalide.');
  const key = gameKey(sessionNumber, chatJid, kind);
  const country = selectCountry(kind, null, random);
  const state = { kind, country, attempts: 0, scores: new Map() };
  games.set(key, state);
  return { key, state, prompt: kind === 'capital'
    ? `🏴‍☠️ *KAIDO — CAPITALE À DEVINER*\nQuel est le nom de la capitale de *${country.name}* ?\nRéponds avec ${kind === 'capital' ? '.guesscapital <réponse>' : '.guesscountry <réponse>'}.`
    : `🏴‍☠️ *KAIDO — DRAPEAU MYSTÈRE*\nÀ quel pays appartient ce drapeau ?\n\n${country.flag}\n\nRéponds avec .guesscountry <pays>.` };
}

function answer({ sessionNumber, chatJid, kind, answer, sender, random = Math.random }) {
  const key = gameKey(sessionNumber, chatJid, kind);
  const state = games.get(key);
  if (!state) return { error: 'no_game' };
  state.attempts += 1;
  if (!isCorrect(state.country, kind, answer)) return { correct: false, state };
  const senderKey = String(sender || 'joueur');
  state.scores.set(senderKey, (state.scores.get(senderKey) || 0) + 1);
  const previous = state.country;
  state.country = selectCountry(kind, previous, random);
  state.attempts = 0;
  return { correct: true, previous, state };
}

function stop({ sessionNumber, chatJid, kind }) {
  return games.delete(gameKey(sessionNumber, chatJid, kind));
}

module.exports = { COUNTRIES, normalizeAnswer, isCorrect, start, answer, stop, _games: games };
