'use strict';

const {
  animeQuiz,
  DEFAULT_QUESTION_TIMEOUT_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  formatQuizVerdict
} = require('../../services/anime-quiz');

function renderQuestion(state, prefix = '.') {
  const question = state.question;
  const header = `🎌 *ANIME QUIZ — ${state.topic}*\nQuestion ${state.questionIndex + 1}`;
  if (question.poll) {
    return `${header}\n\n📊 *${question.question}*\nVote dans le sondage ci-dessous. Le vote se ferme dans 30 secondes.`;
  }
  if (question.mode === 'multiple_choice') {
    const choices = question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n');
    return `${header}\n\n❓ ${question.question}\n\n${choices}\n\nRéponds par A, B, C, D ou le texte d’une option. Tu as 45 secondes.\nPour quitter : ${prefix}quiz stop`;
  }
  return `${header}\n\n❓ ${question.question}\n\n✍️ Réponse directe : écris ta réponse dans le groupe. Tu as 45 secondes.\nPour quitter : ${prefix}quiz stop`;
}

function sendVerdict(socket, chatJid, verdict, quoted) {
  const message = formatQuizVerdict(verdict);
  return socket.sendMessage(chatJid, {
    text: message.text,
    mentions: message.mentions
  }, quoted ? { quoted } : undefined);
}

function renderScoreboard(topic, scores, heading = '🏆 Scores') {
  const topScores = (Array.isArray(scores) ? scores : []).slice(0, 5);
  const mentions = [...new Set(topScores.map(item => item.jid).filter(Boolean))];
  if (!topScores.length) return { text: `🎌 ${topic}\nAucun score pour le moment.`, mentions: [] };
  return {
    text: `🎌 *${topic}*\n${heading}\n${topScores.map((item, index) => `${index + 1}. @${String(item.jid).split('@')[0]} — ${item.score}`).join('\n')}`,
    mentions
  };
}

async function postQuestion({ socket, from, sessionNumber, state, prefix, msg }) {
  const question = state.question;
  if (question.poll) {
    await socket.sendMessage(from, { text: renderQuestion(state, prefix) }, { quoted: msg });
    try {
      const pollMessage = await socket.sendMessage(from, {
        poll: {
          name: question.question,
          values: question.options,
          selectableCount: 1
        }
      });
      animeQuiz.attachPoll(sessionNumber, from, pollMessage);
      animeQuiz.armTimeout(sessionNumber, from, verdict => sendVerdict(socket, from, verdict), DEFAULT_POLL_TIMEOUT_MS);
    } catch (error) {
      console.warn('[ANIME QUIZ] Sondage indisponible, repli en QCM texte :', error?.message || error);
      const current = animeQuiz.getState(sessionNumber, from);
      if (!current?.question || current.question.resolved) return;
      current.question.poll = false;
      await socket.sendMessage(from, { text: renderQuestion({ ...state, question: current.question }, prefix) }, { quoted: msg });
      animeQuiz.armTimeout(sessionNumber, from, verdict => sendVerdict(socket, from, verdict), DEFAULT_QUESTION_TIMEOUT_MS);
    }
    return;
  }
  await socket.sendMessage(from, { text: renderQuestion(state, prefix) }, { quoted: msg });
  animeQuiz.armTimeout(sessionNumber, from, verdict => sendVerdict(socket, from, verdict), DEFAULT_QUESTION_TIMEOUT_MS);
}

module.exports = {
  name: 'quiz',
  category: 'general',
  description: 'Lance un quiz anime avec questions IA, réponses directes et sondages',
  usage: '.quiz [anime | next | score | stop]',
  async execute({ socket, msg, from, args = [], prefix = '.', sessionNumber }) {
    const action = String(args[0] || '').toLowerCase();
    if (['help', 'aide'].includes(action)) {
      return socket.sendMessage(from, {
        text: `🎌 *Quiz anime*\n${prefix}quiz — anime aléatoire\n${prefix}quiz <anime> — choisir un anime\n${prefix}quiz next — question suivante\n${prefix}quiz score — scores\n${prefix}quiz stop — terminer`
      }, { quoted: msg });
    }

    if (action === 'stop' || action === 'quit' || action === 'quitter') {
      const result = animeQuiz.stop(sessionNumber, from);
      if (!result) return socket.sendMessage(from, { text: 'Aucun quiz n’est en cours dans ce salon.' }, { quoted: msg });
      const formatted = renderScoreboard(`Quiz terminé — ${result.topic}`, result.scores, '🏆 Résultat final');
      return socket.sendMessage(from, { text: formatted.text, mentions: formatted.mentions }, { quoted: msg });
    }

    if (action === 'score' || action === 'scores') {
      const state = animeQuiz.getState(sessionNumber, from);
      if (!state) return socket.sendMessage(from, { text: 'Aucun quiz n’est en cours dans ce salon.' }, { quoted: msg });
      const formatted = renderScoreboard(state.topic, animeQuiz.snapshot(state).scores);
      return socket.sendMessage(from, { text: formatted.text, mentions: formatted.mentions }, { quoted: msg });
    }

    if (action === 'next' || action === 'suivant') {
      try {
        const state = await animeQuiz.next(sessionNumber, from);
        if (state.error === 'no_quiz') return socket.sendMessage(from, { text: 'Aucun quiz en cours. Lance-en un avec .quiz.' }, { quoted: msg });
        if (state.error === 'question_pending') return socket.sendMessage(from, { text: 'La question actuelle est toujours ouverte. Attends le verdict avant de continuer.' }, { quoted: msg });
        await postQuestion({ socket, from, sessionNumber, state, prefix, msg });
      } catch (error) {
        await socket.sendMessage(from, { text: `❌ Impossible de générer la question : ${error?.message || 'erreur IA'}` }, { quoted: msg });
      }
      return;
    }

    const topic = args.join(' ').trim();
    try {
      const state = await animeQuiz.start({ sessionNumber, chatJid: from, topic });
      await postQuestion({ socket, from, sessionNumber, state, prefix, msg });
    } catch (error) {
      await socket.sendMessage(from, { text: `❌ Impossible de générer le quiz : ${error?.message || 'erreur IA'}` }, { quoted: msg });
    }
  },
  _test: { renderQuestion, sendVerdict, renderScoreboard }
};
