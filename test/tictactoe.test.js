'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../src/features/tictactoe');

const chat = '120363000000000000@g.us';
const playerX = '50911111111@s.whatsapp.net';
const playerO = '50922222222@s.whatsapp.net';

function createSocket(number) {
  const sent = [];
  return {
    sent,
    socket: {
      user: { id: `${number}:3@s.whatsapp.net` },
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: `out-${sent.length}` } };
      }
    }
  };
}

function incoming(from, id, participant, participantAlt) {
  return {
    key: {
      remoteJid: from,
      id,
      fromMe: false,
      participant,
      ...(participantAlt ? { participantAlt } : {})
    },
    message: { conversation: '' }
  };
}

async function start(socket, { from = chat, x = playerX, o = playerO } = {}) {
  const msg = incoming(from, 'command-start', x);
  await startTicTacToe(socket, msg, from, x, o);
}

async function move(socket, actor, text, { from = chat, id = `move-${text}`, participantAlt } = {}) {
  return handleTicTacToeMove(
    socket,
    incoming(from, id, actor, participantAlt),
    from,
    actor,
    text
  );
}

test('normalise les JID sans confondre les numéros, LID et appareils', () => {
  assert.equal(normalizeJid('50911111111:17@s.whatsapp.net'), playerX);
  assert.equal(normalizeJid('123456789:2@lid'), '123456789@lid');
  assert.equal(normalizeJid('+509 111 111 11'), playerX);
  assert.equal(parseMove('7'), 7);
  assert.equal(parseMove('7️⃣'), 7);
  assert.equal(parseMove('case 7'), null);
  assert.equal(parseMove('17'), null);
});

test('la partie annonce les deux joueurs, les mentionne et affiche les cases numérotées', async () => {
  const { socket, sent } = createSocket('50900000000');
  await start(socket);

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].content.mentions, [playerX, playerO]);
  assert.match(sent[0].content.text, /Joueur X :\* @50911111111/);
  assert.match(sent[0].content.text, /Joueur O :\* @50922222222/);
  assert.match(sent[0].content.text, /C’est au tour de ❌ @50911111111/);
  assert.match(sent[0].content.text, /numéro de la case \(1 à 9\)/);
  assert.match(renderBoard(Array(9).fill(null)), /1️⃣ \| 2️⃣ \| 3️⃣/);
});

test('le mode solo démarre avec le bot et joue automatiquement après le propriétaire', async () => {
  const { socket, sent } = createSocket('50933333400');
  await startSoloTicTacToe(socket, incoming(chat, 'solo-start', playerX), chat, playerX);
  assert.match(sent[0].content.text, /CONTRE KAIDO IA/);
  assert.deepEqual(sent[0].content.mentions, [playerX]);

  assert.equal(await move(socket, playerX, '1'), true);
  assert.equal(sent.length, 2);
  assert.match(sent[1].content.text, /🤖 Kaido IA/);
  assert.match(sent[1].content.text, /C’est au tour de ❌ @50911111111/);
  assert.equal(sent[1].content.mentions.includes('50933333400@s.whatsapp.net'), false);
});

test('le propriétaire peut jouer même depuis le compte lié de la session', async () => {
  const { socket, sent } = createSocket('50933333401');
  const ownerJid = '50933333401@s.whatsapp.net';
  await startSoloTicTacToe(socket, {
    key: { remoteJid: ownerJid, id: 'from-me-solo', fromMe: true },
    message: { conversation: '.ttt solo' }
  }, ownerJid, ownerJid);
  assert.match(sent[0].content.text, /CONTRE KAIDO IA/);
  assert.deepEqual(sent[0].content.mentions, [ownerJid]);
  assert.equal(await move(socket, ownerJid, '5', { from: ownerJid }), true);
  assert.equal(sent.length, 2);
});

test('l’IA prend une victoire immédiate et ne peut pas être forcée à perdre', () => {
  assert.equal(chooseAiMove(['X', 'X', null, 'O', 'O', null, null, null, null]), 5);
  const board = Array(9).fill(null);
  for (let turn = 0; turn < 9 && checkWinner(board) === null; turn += 1) {
    const symbol = turn % 2 === 0 ? 'X' : 'O';
    const moveIndex = symbol === 'O' ? chooseAiMove(board, 'O', 'X') : board.findIndex(cell => cell === null);
    board[moveIndex] = symbol;
  }
  assert.notEqual(checkWinner(board), 'X');
});

test('refuse les parties sans adversaire, contre soi-même ou contre le compte du bot', async () => {
  const { socket, sent } = createSocket('50933333333');
  await startTicTacToe(socket, incoming(chat, 'missing', playerX), chat, playerX, '');
  assert.match(sent.at(-1).content.text, /Adversaire introuvable/);

  await startTicTacToe(socket, incoming(chat, 'self', playerX), chat, playerX, '50911111111:8@s.whatsapp.net');
  assert.match(sent.at(-1).content.text, /vous-même/);

  await startTicTacToe(socket, incoming(chat, 'bot', playerX), chat, playerX, '50933333333@s.whatsapp.net');
  assert.match(sent.at(-1).content.text, /compte du bot/);

  const { socket: lidSocket, sent: lidSent } = createSocket('50933333334');
  lidSocket.user.lid = '188811111111:4';
  await startTicTacToe(lidSocket, incoming(chat, 'bot-lid', playerX), chat, playerX, '188811111111@lid');
  assert.match(lidSent.at(-1).content.text, /compte du bot/);
});

test('un coup ne peut être joué que par le joueur attendu et sur une case libre', async () => {
  const { socket, sent } = createSocket('50900000001');
  await start(socket);
  const initialMessages = sent.length;

  assert.equal(await move(socket, playerX, '0'), true);
  assert.match(sent.at(-1).content.text, /de \*1 à 9\*/);
  assert.equal(await move(socket, playerO, '1'), true);
  assert.match(sent.at(-1).content.text, /Ce n’est pas votre tour/);
  assert.deepEqual(sent.at(-1).content.mentions, [playerX]);

  assert.equal(await move(socket, playerX, '1'), true);
  assert.match(sent.at(-1).content.text, /❌ \| 2️⃣ \| 3️⃣/);
  assert.match(sent.at(-1).content.text, /C’est au tour de ⭕ @50922222222/);

  assert.equal(await move(socket, playerX, '2'), true);
  assert.match(sent.at(-1).content.text, /Ce n’est pas votre tour/);
  assert.equal(await move(socket, playerO, '1'), true);
  assert.match(sent.at(-1).content.text, /déjà occupée/);
  assert.equal(await move(socket, playerO, '5'), true);
  assert.equal(sent.length, initialMessages + 6);
});

test('détecte le gagnant, mentionne les deux joueurs et met à jour victoires/défaites', async () => {
  const { socket, sent } = createSocket('50900000002');
  await start(socket);

  for (const [actor, cell] of [
    [playerX, '1'],
    [playerO, '4'],
    [playerX, '2'],
    [playerO, '5'],
    [playerX, '3']
  ]) {
    assert.equal(await move(socket, actor, cell), true);
  }

  const result = sent.at(-1);
  assert.match(result.content.text, /Victoire de @50911111111/);
  assert.match(result.content.text, /❌ @50911111111 — 1 victoire/);
  assert.match(result.content.text, /⭕ @50922222222 — 0 victoires, 1 défaite/);
  assert.deepEqual(result.content.mentions, [playerX, playerO]);
  assert.deepEqual(getTicTacToeStats(socket, chat, playerX), { wins: 1, losses: 0, draws: 0, games: 1 });
  assert.deepEqual(getTicTacToeStats(socket, chat, playerO), { wins: 0, losses: 1, draws: 0, games: 1 });
  assert.equal(checkWinner(['X', 'X', 'X', null, null, null, null, null, null]), 'X');
  assert.equal(await move(socket, playerO, '6'), false);
});

test('détecte le match nul et incrémente les nuls pour les deux joueurs', async () => {
  const { socket, sent } = createSocket('50900000003');
  await start(socket);

  for (const [actor, cell] of [
    [playerX, '1'], [playerO, '2'],
    [playerX, '3'], [playerO, '5'],
    [playerX, '4'], [playerO, '7'],
    [playerX, '6'], [playerO, '9'],
    [playerX, '8']
  ]) {
    assert.equal(await move(socket, actor, cell), true);
  }

  assert.equal(checkWinner(['X', 'O', 'X', 'X', 'O', 'X', 'O', 'X', 'O']), 'tie');
  assert.match(sent.at(-1).content.text, /Match nul/);
  assert.match(sent.at(-1).content.text, /1 nul/);
  assert.deepEqual(getTicTacToeStats(socket, chat, playerX), { wins: 0, losses: 0, draws: 1, games: 1 });
  assert.deepEqual(getTicTacToeStats(socket, chat, playerO), { wins: 0, losses: 0, draws: 1, games: 1 });
});

test('accepte les JID alternatifs, isole les salons et sessions et annule uniquement le bon jeu', async () => {
  const { socket: firstSocket } = createSocket('50900000004');
  const { socket: secondSocket, sent: secondSent } = createSocket('50900000005');
  const playerXLid = '188811111111@lid';

  await startTicTacToe(
    firstSocket,
    incoming(chat, 'start-lid', playerX, playerXLid),
    chat,
    playerX,
    playerO
  );
  assert.equal(await move(firstSocket, playerXLid, '1'), true);

  // Le même compte Baileys recréé garde l’état de la partie.
  const reconnectedSocket = { user: { id: '50900000004:12@s.whatsapp.net' }, sent: [], async sendMessage(jid, content, options) {
    this.sent.push({ jid, content, options });
    return { key: { id: `reconnected-${this.sent.length}` } };
  } };
  assert.equal(await move(reconnectedSocket, playerO, '5'), true);

  // Une autre session peut jouer dans le même groupe indépendamment.
  await start(secondSocket);
  assert.equal(secondSent.length, 1);
  assert.equal(deleteGame(firstSocket, chat), true);
  assert.equal(deleteGame(firstSocket, chat), false);
  assert.equal(await move(secondSocket, playerX, '1'), true);
});

test('les nombres envoyés par une personne qui ne joue pas restent des messages ordinaires', async () => {
  const { socket, sent } = createSocket('50900000006');
  await start(socket);
  const before = sent.length;
  assert.equal(await move(socket, '50999999999@s.whatsapp.net', '4'), false);
  assert.equal(sent.length, before);
});
