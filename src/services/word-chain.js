'use strict';

const games = new Map();
const START_WORDS = Object.freeze(['pirate', 'équipage', 'aventure', 'océan', 'navire', 'trésor']);
const normalizeWord = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^a-z]/g, '');
const keyFor = (session, chat) => `${String(session || 'default').replace(/\D/g, '')}:${chat}`;

function start(session, chat, random = Math.random) {
  const key = keyFor(session, chat);
  const index = Math.min(START_WORDS.length - 1, Math.floor(random() * START_WORDS.length));
  const state = { current: START_WORDS[index], used: new Set(), scores: new Map(), turns: 0 };
  state.used.add(normalizeWord(state.current));
  games.set(key, state);
  return state;
}

function play(session, chat, sender, input) {
  const state = games.get(keyFor(session, chat));
  if (!state) return { error: 'no_game' };
  const word = String(input || '').trim();
  const normalized = normalizeWord(word);
  if (!normalized || normalized.length < 2 || !/^[\p{L}'’-]+$/u.test(word)) return { error: 'invalid_word', state };
  if (state.used.has(normalized)) return { error: 'used_word', state };
  const needed = normalizeWord(state.current).slice(-1);
  if (normalized[0] !== needed) return { error: 'wrong_letter', needed, state };
  state.used.add(normalized);
  state.current = word;
  state.turns += 1;
  const player = String(sender || 'joueur');
  state.scores.set(player, (state.scores.get(player) || 0) + 1);
  return { ok: true, state, score: state.scores.get(player) };
}

function stop(session, chat) {
  const key = keyFor(session, chat);
  const state = games.get(key);
  games.delete(key);
  return state || null;
}

module.exports = { START_WORDS, normalizeWord, start, play, stop, _games: games };
