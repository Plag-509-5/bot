'use strict';

// Les parties et les scores sont isolés par compte WhatsApp, puis par salon.
// La clé du compte permet de garder une partie si Baileys recrée le socket.
const sessionStates = new Map();
const socketStates = new WeakMap();
const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
const EMPTY_SCORE = Object.freeze({ wins: 0, losses: 0, draws: 0, games: 0 });

/** Normalise un JID en gardant son domaine (notamment @lid). */
function normalizeJid(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';

  const at = raw.lastIndexOf('@');
  if (at < 0) {
    const number = raw.replace(/\D/g, '');
    return number ? `${number}@s.whatsapp.net` : '';
  }

  const user = raw.slice(0, at).trim().replace(/:\d+$/, '');
  let server = raw.slice(at + 1).trim().toLowerCase();
  if (server === 'c.us') server = 's.whatsapp.net';
  if (!user || !server) return '';
  return `${user}@${server}`;
}

function normalizeLid(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  if (raw.includes('@')) return normalizeJid(raw);
  const local = raw.replace(/:\d+$/, '').replace(/[^\da-z_-]/gi, '');
  return local ? `${local}@lid` : '';
}

function isUserJid(jid) {
  if (!jid) return false;
  const server = jid.slice(jid.lastIndexOf('@') + 1).toLowerCase();
  return !['g.us', 'broadcast', 'newsletter'].includes(server);
}

function normalizeChatJid(value) {
  return normalizeJid(value);
}

function flattenJidCandidates(values, result = []) {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      flattenJidCandidates(value, result);
      continue;
    }
    if (typeof value === 'object') {
      flattenJidCandidates([
        value.jid,
        value.id,
        value.phoneNumber,
        value.pn,
        value.lid
      ], result);
      continue;
    }
    const jid = normalizeJid(value);
    if (isUserJid(jid) && !result.includes(jid)) result.push(jid);
  }
  return result;
}

function getSelfJids(socket) {
  const creds = socket?.authState?.creds || {};
  return flattenJidCandidates([
    socket?.user?.id,
    normalizeLid(socket?.user?.lid),
    socket?.user?.jid,
    creds.me?.id,
    normalizeLid(creds.me?.lid)
  ]);
}

function createSessionState() {
  return { games: new Map(), scores: new Map() };
}

function getSessionState(socket) {
  const selfJid = getSelfJids(socket)[0];
  if (selfJid) {
    let state = sessionStates.get(selfJid);
    if (!state) {
      state = createSessionState();
      sessionStates.set(selfJid, state);
    }
    return state;
  }

  if (!socket || (typeof socket !== 'object' && typeof socket !== 'function')) {
    throw new TypeError('Un socket Baileys est requis pour gérer une partie.');
  }
  let state = socketStates.get(socket);
  if (!state) {
    state = createSessionState();
    socketStates.set(socket, state);
  }
  return state;
}

function makePlayer(values) {
  const aliases = flattenJidCandidates(values);
  if (!aliases.length) return null;
  // Préférer le JID téléphonique pour afficher une mention lisible; sinon garder le LID.
  const jid = aliases.find(value => value.endsWith('@s.whatsapp.net')) || aliases[0];
  return { jid, aliases };
}

function getCommandContextInfo(msg) {
  const message = msg?.message || {};
  const types = [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'stickerMessage'
  ];
  for (const type of types) {
    const contextInfo = message[type]?.contextInfo;
    if (contextInfo) return contextInfo;
  }
  return message.ephemeralMessage?.message?.extendedTextMessage?.contextInfo || {};
}

function getCurrentSessionPlayer(socket, msg, sender) {
  const fromMessage = msg?.key || {};
  const selfJids = fromMessage.fromMe ? getSelfJids(socket) : [];
  const aliases = flattenJidCandidates([
    sender,
    fromMessage.participant,
    fromMessage.participantAlt,
    ...selfJids
  ]);
  return makePlayer(aliases);
}

function playersMatch(first, second) {
  if (!first || !second) return false;
  const aliases = new Set(first.aliases);
  return second.aliases.some(jid => aliases.has(jid));
}

function playerTag(player) {
  return player?.jid?.split('@')[0] || 'joueur';
}

function mentionJids(players) {
  return [...new Set(players.map(player => player?.jid).filter(Boolean))];
}

/** Génère le rendu de la grille; les cases libres correspondent aux coups 1 à 9. */
function renderBoard(board) {
  const emojis = board.map((cell, index) => {
    if (cell === 'X') return '❌';
    if (cell === 'O') return '⭕';
    return ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][index];
  });

  return `       ${emojis[0]} | ${emojis[1]} | ${emojis[2]}\n` +
    `      ────┼────┼────\n` +
    `       ${emojis[3]} | ${emojis[4]} | ${emojis[5]}\n` +
    `      ────┼────┼────\n` +
    `       ${emojis[6]} | ${emojis[7]} | ${emojis[8]}`;
}

/** Renvoie X, O, tie ou null. */
function checkWinner(board) {
  if (!Array.isArray(board) || board.length !== 9) return null;
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.every(cell => cell !== null) ? 'tie' : null;
}

function minimax(board, maximizing, depth = 0, botSymbol = 'O', humanSymbol = 'X') {
  const outcome = checkWinner(board);
  if (outcome === botSymbol) return 10 - depth;
  if (outcome === humanSymbol) return depth - 10;
  if (outcome === 'tie') return 0;

  let best = maximizing ? -Infinity : Infinity;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    board[index] = maximizing ? botSymbol : humanSymbol;
    const score = minimax(board, !maximizing, depth + 1, botSymbol, humanSymbol);
    board[index] = null;
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

function chooseAiMove(board, botSymbol = 'O', humanSymbol = 'X') {
  if (!Array.isArray(board) || board.length !== 9 || checkWinner(board)) return null;
  let bestScore = -Infinity;
  let bestIndex = null;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    board[index] = botSymbol;
    const score = minimax(board, false, 1, botSymbol, humanSymbol);
    board[index] = null;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function parseMove(text) {
  const value = String(text || '').trim();
  // Accepte aussi le chiffre-clé emoji (ex. 1️⃣) affiché sur le plateau.
  const match = value.match(/^([1-9])(?:\uFE0F?\u20E3)?$/u);
  return match ? Number(match[1]) : null;
}

function isNumericMoveAttempt(text) {
  return /^\d+$/u.test(String(text || '').trim());
}

function findScoreRecord(state, chat, player, create = false) {
  let chatScores = state.scores.get(chat);
  if (!chatScores && create) {
    chatScores = [];
    state.scores.set(chat, chatScores);
  }
  if (!chatScores) return null;

  let record = chatScores.find(candidate => playersMatch(candidate.player, player));
  if (!record && create) {
    record = {
      player: { jid: player.jid, aliases: [...player.aliases] },
      wins: 0,
      losses: 0,
      draws: 0,
      games: 0
    };
    chatScores.push(record);
  } else if (record) {
    record.player.aliases = [...new Set([...record.player.aliases, ...player.aliases])];
  }
  return record;
}

function getTicTacToeStats(socket, from, playerJid) {
  const chat = normalizeChatJid(from);
  const player = makePlayer(flattenJidCandidates([playerJid]));
  if (!chat || !player) return { ...EMPTY_SCORE };
  const record = findScoreRecord(getSessionState(socket), chat, player);
  return record
    ? { wins: record.wins, losses: record.losses, draws: record.draws, games: record.games }
    : { ...EMPTY_SCORE };
}

function recordOutcome(state, chat, game, outcome) {
  const playerXScore = findScoreRecord(state, chat, game.players.X, true);
  const playerOScore = findScoreRecord(state, chat, game.players.O, true);
  playerXScore.games += 1;
  playerOScore.games += 1;

  if (outcome === 'tie') {
    playerXScore.draws += 1;
    playerOScore.draws += 1;
    return { X: playerXScore, O: playerOScore };
  }

  const winnerSymbol = outcome;
  const loserSymbol = winnerSymbol === 'X' ? 'O' : 'X';
  const scores = { X: playerXScore, O: playerOScore };
  scores[winnerSymbol].wins += 1;
  scores[loserSymbol].losses += 1;
  return scores;
}

function scoreLine(symbol, player, score) {
  const wins = `victoire${score.wins === 1 ? '' : 's'}`;
  const losses = `défaite${score.losses === 1 ? '' : 's'}`;
  const draws = `nul${score.draws === 1 ? '' : 's'}`;
  return `${symbol} @${playerTag(player)} — ${score.wins} ${wins}, ${score.losses} ${losses}, ${score.draws} ${draws}`;
}

function playerLabel(game, symbol) {
  if (game.mode === 'solo' && symbol === 'O') return '🤖 Kaido IA';
  return `@${playerTag(game.players[symbol])}`;
}

function gameMentions(game) {
  return game.mode === 'solo'
    ? mentionJids([game.players.X])
    : mentionJids([game.players.X, game.players.O]);
}

function buildStartMessage(game) {
  const xTag = playerTag(game.players.X);
  return [
    game.mode === 'solo' ? '🤖 *TIC-TAC-TOE SOLO — CONTRE KAIDO IA* 🤖' : '🎮 *TIC-TAC-TOE — PARTIE LANCÉE !* 🎮',
    '',
    `❌ *Joueur X :* @${xTag}`,
    `⭕ *Joueur O :* ${playerLabel(game, 'O')}`,
    '',
    renderBoard(game.board),
    '',
    `👉 C’est au tour de ❌ @${xTag}.`,
    '📌 Réponds avec le numéro de la case (1 à 9).'
  ].join('\n');
}

function buildTurnMessage(game) {
  const current = game.players[game.turn];
  const symbol = game.turn === 'X' ? '❌' : '⭕';
  return [
    game.mode === 'solo' ? '🤖 *TIC-TAC-TOE SOLO* 🤖' : '🎮 *TIC-TAC-TOE* 🎮',
    '',
    renderBoard(game.board),
    '',
    `❌ *Joueur X :* ${playerLabel(game, 'X')}`,
    `⭕ *Joueur O :* ${playerLabel(game, 'O')}`,
    '',
    `👉 C’est au tour de ${symbol} ${playerLabel(game, game.turn)}.`,
    '📌 Réponds avec le numéro de la case (1 à 9).'
  ].join('\n');
}

function buildFinalMessage(game, outcome, scores) {
  const winner = outcome === 'tie' ? null : outcome;
  const lines = [
    game.mode === 'solo' ? '🤖 *TIC-TAC-TOE SOLO — FIN DE LA PARTIE* 🤖' : '🎮 *TIC-TAC-TOE — FIN DE LA PARTIE* 🎮',
    '',
    renderBoard(game.board),
    ''
  ];
  if (outcome === 'tie') lines.push('🤝 *Match nul !* Bien joué.');
  else lines.push(`🏆 *Victoire de ${playerLabel(game, winner)} !*`);
  const scoreLineFor = (symbol, score) => {
    if (game.mode !== 'solo' || symbol !== 'O') return scoreLine(symbol === 'X' ? '❌' : '⭕', game.players[symbol], score);
    const wins = `victoire${score.wins === 1 ? '' : 's'}`;
    const losses = `défaite${score.losses === 1 ? '' : 's'}`;
    const draws = `nul${score.draws === 1 ? '' : 's'}`;
    return `⭕ 🤖 Kaido IA — ${score.wins} ${wins}, ${score.losses} ${losses}, ${score.draws} ${draws}`;
  };
  lines.push('', '📊 *Bilan des joueurs*', scoreLineFor('X', scores.X), scoreLineFor('O', scores.O));
  return lines.join('\n');
}

async function startTicTacToe(socket, msg, from, sender, opponentJid) {
  const chat = normalizeChatJid(from);
  const contextInfo = getCommandContextInfo(msg);
  const playerX = getCurrentSessionPlayer(socket, msg, sender);
  const playerO = makePlayer(flattenJidCandidates([
    opponentJid,
    contextInfo.participant,
    contextInfo.participantAlt,
    contextInfo.mentionedJid,
    contextInfo.mentionedJidAlt
  ]));

  if (!chat || !playerX || !playerO) {
    return socket.sendMessage(from, {
      text: '❌ *Adversaire introuvable.* Mentionnez un joueur avec *.ttt @joueur* ou répondez à son message avec *.ttt*.'
    }, { quoted: msg });
  }

  if (playersMatch(playerX, playerO)) {
    return socket.sendMessage(from, {
      text: '🍁 Vous ne pouvez pas jouer contre vous-même !'
    }, { quoted: msg });
  }

  const botPlayer = makePlayer(getSelfJids(socket));
  if (playersMatch(playerX, botPlayer) || playersMatch(playerO, botPlayer)) {
    return socket.sendMessage(from, {
      text: '🤖 Le compte du bot ne peut pas participer à une partie.'
    }, { quoted: msg });
  }

  const state = getSessionState(socket);
  if (state.games.has(chat)) {
    return socket.sendMessage(from, {
      text: '❌ Une partie est déjà active dans ce salon. Utilisez *.delttt* pour l’annuler.'
    }, { quoted: msg });
  }

  const game = {
    board: Array(9).fill(null),
    players: { X: playerX, O: playerO },
    turn: 'X'
  };
  state.games.set(chat, game);

  try {
    return await socket.sendMessage(from, {
      text: buildStartMessage(game),
      mentions: gameMentions(game)
    }, { quoted: msg });
  } catch (error) {
    state.games.delete(chat);
    throw error;
  }
}

async function startSoloTicTacToe(socket, msg, from, sender) {
  const chat = normalizeChatJid(from);
  const playerX = getCurrentSessionPlayer(socket, msg, sender);
  if (!chat || !playerX) {
    return socket.sendMessage(from, { text: '❌ Impossible d’identifier le propriétaire de la session.' }, { quoted: msg });
  }
  // Identité interne fictive : le compte de session est aussi celui que la
  // personne contrôle sur son appareil lié, les rôles ne doivent donc pas se confondre.
  const botJid = `kaido-ai-${getSelfJids(socket)[0]?.split('@')[0] || 'session'}@s.whatsapp.net`;
  const botPlayer = { jid: botJid, aliases: [botJid] };

  const state = getSessionState(socket);
  if (state.games.has(chat)) {
    return socket.sendMessage(from, {
      text: '❌ Une partie est déjà active dans ce salon. Utilisez *.delttt* pour l’annuler.'
    }, { quoted: msg });
  }

  const game = {
    board: Array(9).fill(null),
    players: { X: playerX, O: botPlayer },
    turn: 'X',
    mode: 'solo'
  };
  state.games.set(chat, game);
  try {
    return await socket.sendMessage(from, {
      text: buildStartMessage(game),
      mentions: gameMentions(game)
    }, { quoted: msg });
  } catch (error) {
    state.games.delete(chat);
    throw error;
  }
}

async function handleTicTacToeMove(socket, msg, from, sender, text) {
  const chat = normalizeChatJid(from);
  if (!chat) return false;

  const state = getSessionState(socket);
  const game = state.games.get(chat);
  if (!game) return false;

  const actor = getCurrentSessionPlayer(socket, msg, sender);
  const actorSymbol = actor && ['X', 'O'].find(symbol => playersMatch(actor, game.players[symbol]));
  // Les chiffres des autres membres du groupe ne doivent pas interrompre leur conversation.
  if (!actorSymbol) return false;

  const move = parseMove(text);
  if (!move) {
    if (!isNumericMoveAttempt(text)) return false;
    await socket.sendMessage(from, {
      text: '🚫 Choisissez une case numérotée de *1 à 9*.'
    }, { quoted: msg });
    return true;
  }

  if (actorSymbol !== game.turn) {
    const current = game.players[game.turn];
    await socket.sendMessage(from, {
      text: `⚠️ Ce n’est pas votre tour. C’est à @${playerTag(current)} de jouer.`,
      mentions: [current.jid]
    }, { quoted: msg });
    return true;
  }

  const index = move - 1;
  if (game.board[index] !== null) {
    await socket.sendMessage(from, {
      text: '🚫 Cette case est déjà occupée. Choisissez une autre case visible.'
    }, { quoted: msg });
    return true;
  }

  game.board[index] = game.turn;
  let outcome = checkWinner(game.board);
  if (outcome) {
    const scores = recordOutcome(state, chat, game, outcome);
    state.games.delete(chat);
    await socket.sendMessage(from, {
      text: buildFinalMessage(game, outcome, scores),
      mentions: gameMentions(game)
    }, { quoted: msg });
    return true;
  }

  if (game.mode === 'solo') {
    game.turn = 'O';
    const aiMove = chooseAiMove(game.board, 'O', 'X');
    if (aiMove === null) return false;
    game.board[aiMove] = 'O';
    outcome = checkWinner(game.board);
    if (outcome) {
      const scores = recordOutcome(state, chat, game, outcome);
      state.games.delete(chat);
      await socket.sendMessage(from, {
        text: buildFinalMessage(game, outcome, scores),
        mentions: gameMentions(game)
      }, { quoted: msg });
      return true;
    }
    game.turn = 'X';
  } else {
    game.turn = game.turn === 'X' ? 'O' : 'X';
  }
  await socket.sendMessage(from, {
    text: buildTurnMessage(game),
    mentions: gameMentions(game)
  }, { quoted: msg });
  return true;
}

function deleteGame(socket, from) {
  const chat = normalizeChatJid(from);
  if (!chat) return false;
  return getSessionState(socket).games.delete(chat);
}

module.exports = {
  checkWinner,
  chooseAiMove,
  deleteGame,
  getTicTacToeStats,
  handleTicTacToeMove,
  normalizeJid,
  parseMove,
  renderBoard,
  startSoloTicTacToe,
  startTicTacToe
};
