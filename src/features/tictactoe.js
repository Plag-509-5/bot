// Stockage des parties de Morpion en mémoire vive
const activeGames = new Map();

/**
 * Nettoie de manière ultra-stricte un JID WhatsApp.
 * Enlève les espaces, les symboles "+", les identifiants d'appareils (:1, :2) 
 * et ne garde que les chiffres purs suivis de @s.whatsapp.net.
 */
function cleanJid(jid) {
  if (!jid) return '';
  // Si c'est déjà une chaîne, on extrait uniquement les chiffres
  const rawNumber = jid.split('@')[0].replace(/[^0-9]/g, '');
  return `${rawNumber}@s.whatsapp.net`;
}

/**
 * Génère le rendu visuel textuel de la grille (Style Rétro)
 */
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

/**
 * Vérifie s'il y a un gagnant ou match nul
 */
function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (let line of lines) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every(cell => cell !== null)) return 'tie';
  return null;
}

/**
 * GESTIONNAIRE SANS PRÉFIXE DES COUPS (1-9)
 */
async function handleTicTacToeMove(socket, msg, from, sender, text) {
  // Nettoyage complet du texte reçu (on ne garde que le chiffre)
  const cleanText = text.toString().trim().replace(/[^1-9]/g, '');
  if (!/^[1-9]$/.test(cleanText)) return false; 
  const move = parseInt(cleanText);

  const game = activeGames.get(from);
  if (!game) return false;

  // NETTOYAGE ULTRA-STRICT POUR LA COMPARAISON
  const playerXClean = cleanJid(game.playerX);
  const playerOClean = cleanJid(game.playerO);
  const currentTurnClean = cleanJid(game.currentTurn);
  const senderClean = cleanJid(sender);

  // Vérification stricte du tour
  if (senderClean !== currentTurnClean) {
    await socket.sendMessage(from, { text: `⚠️ Ce n'est pas votre tour ! Attendez votre adversaire.` }, { quoted: msg });
    return true; 
  }

  const index = move - 1;
  if (game.board[index] !== null) {
    await socket.sendMessage(from, { text: `🚫 Cette case est déjà occupée ! Choisissez un chiffre visible.` }, { quoted: msg });
    return true;
  }

  // Enregistrement du coup
  game.board[index] = game.turnSymbol;
  const result = checkWinner(game.board);
  
  const p1Tag = playerXClean.split('@')[0];
  const p2Tag = playerOClean.split('@')[0];

  if (result) {
    let finalMessage = `🎮 *RETRO TIC-TAC-TOE* 🎮\n\n${renderBoard(game.board)}\n\n`;
    if (result === 'tie') {
      finalMessage += `🤝 *Match nul !* Bien joué à tous les deux.`;
    } else {
      const winnerJid = result === 'X' ? playerXClean : playerOClean;
      finalMessage += `🎉 *Félicitations !* @${winnerJid.split('@')[0]} a gagné la partie ! 🏆`;
    }
    
    await socket.sendMessage(from, { text: finalMessage, mentions: [playerXClean, playerOClean] }, { quoted: msg });
    activeGames.delete(from);
    return true;
  }

  // Changement de tour
  game.currentTurn = currentTurnClean === playerXClean ? playerOClean : playerXClean;
  game.turnSymbol = game.turnSymbol === 'X' ? 'O' : 'X';

  const nextGameTemplate = 
    `🎮 *RETRO TIC-TAC-TOE* 🎮\n\n` +
    `${renderBoard(game.board)}\n\n` +
    `❌ *Joueur 1 :* @${p1Tag}\n` +
    `⭕ *Joueur 2 :* @${p2Tag}\n\n` +
    `👉 *À toi de jouer :* @${game.currentTurn.split('@')[0]}\n` +
    `📌 _Envoie simplement le chiffre de ton choix (1-9)._`;

  await socket.sendMessage(from, { text: nextGameTemplate, mentions: [playerXClean, playerOClean] }, { quoted: msg });
  return true;
}

/**
 * INITIALISATION D'UNE PARTIE
 */
async function startTicTacToe(socket, msg, from, sender, opponentJid) {
  if (!opponentJid) {
    return await socket.sendMessage(from, { 
      text: `❌ *Sélection de l'adversaire incorrecte.*\n\n📌 Mentionnez un joueur: *.ttt @user*\n📌 Ou répondez directement au message de votre adversaire avec *.ttt*` 
    }, { quoted: msg });
  }

  const finalSender = cleanJid(sender);
  const finalOpponent = cleanJid(opponentJid);

  if (finalOpponent === finalSender) {
    return await socket.sendMessage(from, { text: `🍁 Vous ne pouvez pas jouer contre vous-même !` }, { quoted: msg });
  }

  if (activeGames.has(from)) {
    return await socket.sendMessage(from, { text: `❌ Une partie est déjà active ici. Faites *.delttt* pour l'annuler.` }, { quoted: msg });
  }

  activeGames.set(from, {
    board: Array(9).fill(null),
    playerX: finalSender,       
    playerO: finalOpponent,  
    currentTurn: finalSender,   
    turnSymbol: 'X'
  });

  const p1Tag = finalSender.split('@')[0];
  const p2Tag = finalOpponent.split('@')[0];

  const startTemplate = 
    `🎮 *RETRO TIC-TAC-TOE — JEU LANCÉ !* 🎮\n\n` +
    `❌ *Joueur 1 :* @${p1Tag}\n` +
    `⭕ *Joueur 2 :* @${p2Tag}\n\n` +
    `${renderBoard(Array(9).fill(null))}\n\n` +
    `👉 @${p1Tag} commence ! Envoie un chiffre entre *1 et 9* directement sans préfixe.`;

  await socket.sendMessage(from, { text: startTemplate, mentions: [finalSender, finalOpponent] }, { quoted: msg });
}

function deleteGame(from) {
  if (activeGames.has(from)) {
    activeGames.delete(from);
    return true;
  }
  return false;
}

module.exports = {
  handleTicTacToeMove,
  startTicTacToe,
  deleteGame
};