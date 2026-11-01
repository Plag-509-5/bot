'use strict';

const {
  animeQuiz,
  DEFAULT_QUESTION_TIMEOUT_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  formatQuizVerdict
} = require('../../services/anime-quiz');
const { getSessionLanguage, SKIP_FORMATTING_OPTION } = require('../../features/translation');

const QUIZ_UI = Object.freeze({
  fr: {
    title: 'QUIZ ANIME', question: 'Question', poll: 'Vote dans le sondage ci-dessous. Le vote se ferme dans 30 secondes.',
    pollWait: 'Vote dans le sondage ci-dessous.', qcm: 'Réponds par A, B, C, D ou le texte d’une option. Tu as 45 secondes.',
    direct: 'Réponse directe : écris ta réponse dans le groupe. Tu as 45 secondes.', quit: 'Pour quitter :',
    noScores: 'Aucun score pour le moment.', score: 'Scores', final: 'Résultat final',
    helpTitle: 'Quiz anime', random: 'anime aléatoire', choose: 'choisir un anime', next: 'question suivante', stop: 'terminer'
  },
  en: {
    title: 'ANIME QUIZ', question: 'Question', poll: 'Vote in the poll below. Voting closes in 30 seconds.',
    pollWait: 'Vote in the poll below.', qcm: 'Reply with A, B, C, D, or the option text. You have 45 seconds.',
    direct: 'Open answer: type your answer in the group. You have 45 seconds.', quit: 'To stop: ',
    noScores: 'No scores yet.', score: 'Scores', final: 'Final result',
    helpTitle: 'Anime quiz', random: 'random anime', choose: 'choose an anime', next: 'next question', stop: 'finish'
  },
  es: {
    title: 'CUESTIONARIO DE ANIME', question: 'Pregunta', poll: 'Vota en la encuesta. La votación se cierra en 30 segundos.',
    pollWait: 'Vota en la encuesta.', qcm: 'Responde A, B, C, D o escribe el texto de una opción. Tienes 45 segundos.',
    direct: 'Respuesta abierta: escribe tu respuesta en el grupo. Tienes 45 segundos.', quit: 'Para salir: ',
    noScores: 'Todavía no hay puntuaciones.', score: 'Puntuaciones', final: 'Resultado final',
    helpTitle: 'Cuestionario de anime', random: 'anime aleatorio', choose: 'elegir un anime', next: 'siguiente pregunta', stop: 'terminar'
  },
  ht: {
    title: 'TÈS ANIME', question: 'Kesyon', poll: 'Vote nan sondaj la. Vòt la ap fèmen nan 30 segonn.',
    pollWait: 'Vote nan sondaj la.', qcm: 'Reponn A, B, C, D, oswa ekri opsyon an. Ou gen 45 segonn.',
    direct: 'Repons dirèk: ekri repons ou nan gwoup la. Ou gen 45 segonn.', quit: 'Pou kite: ',
    noScores: 'Poko gen okenn pwen.', score: 'Pwen', final: 'Rezilta final',
    helpTitle: 'Tès anime', random: 'anime o aza', choose: 'chwazi yon anime', next: 'pwochen kesyon', stop: 'fini'
  }
});

function quizCopy(language) {
  return QUIZ_UI[String(language || 'fr').toLowerCase()] || QUIZ_UI.fr;
}

function renderHelp(prefix = '.', language = 'fr') {
  const copy = quizCopy(language);
  return `🎌 *${copy.helpTitle}*\\n${prefix}quiz — ${copy.random}\\n${prefix}quiz <anime> — ${copy.choose}\\n${prefix}quiz next — ${copy.next}\\n${prefix}quiz score — ${copy.score.toLowerCase()}\\n${prefix}quiz stop — ${copy.stop}`;
}

function renderQuestion(state, prefix = '.') {
  const question = state.question;
  const copy = quizCopy(state.language);
  const header = `🎌 *${copy.title} — ${state.topic}*\n${copy.question} ${state.questionIndex + 1}`;
  if (question.poll) {
    return `${header}\n\n📊 *${question.question}*\n${copy.poll}`;
  }
  if (question.mode === 'multiple_choice') {
    const choices = question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n');
    return `${header}\n\n❓ ${question.question}\n\n${choices}\n\n${copy.qcm}\n${copy.quit} ${prefix}quiz stop`;
  }
  return `${header}\n\n❓ ${question.question}\n\n✍️ ${copy.direct}\n${copy.quit} ${prefix}quiz stop`;
}

function sendVerdict(socket, chatJid, verdict, quoted) {
  const message = formatQuizVerdict(verdict, verdict?.language);
  return socket.sendMessage(chatJid, {
    text: message.text,
    mentions: message.mentions
  }, { ...(quoted ? { quoted } : {}), [SKIP_FORMATTING_OPTION]: true });
}

function renderScoreboard(topic, scores, heading, language = 'fr') {
  const copy = quizCopy(language);
  const topScores = (Array.isArray(scores) ? scores : []).slice(0, 5);
  const mentions = [...new Set(topScores.map(item => item.jid).filter(Boolean))];
  if (!topScores.length) return { text: `🎌 ${topic}\n${copy.noScores}`, mentions: [] };
  const title = /final/i.test(String(heading || '')) ? copy.final : copy.score;
  return {
    text: `🎌 *${topic}*\n🏆 *${title}*\n${topScores.map((item, index) => `${index + 1}. @${String(item.jid).split('@')[0]} — ${item.score}`).join('\n')}`,
    mentions
  };
}

async function postQuestion({ socket, from, sessionNumber, state, prefix, msg }) {
  const question = state.question;
  if (question.poll) {
    await socket.sendMessage(from, { text: renderQuestion(state, prefix) }, { quoted: msg, [SKIP_FORMATTING_OPTION]: true });
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
      await socket.sendMessage(from, { text: renderQuestion({ ...state, question: current.question }, prefix) }, { quoted: msg, [SKIP_FORMATTING_OPTION]: true });
      animeQuiz.armTimeout(sessionNumber, from, verdict => sendVerdict(socket, from, verdict), DEFAULT_QUESTION_TIMEOUT_MS);
    }
    return;
  }
  await socket.sendMessage(from, { text: renderQuestion(state, prefix) }, { quoted: msg, [SKIP_FORMATTING_OPTION]: true });
  animeQuiz.armTimeout(sessionNumber, from, verdict => sendVerdict(socket, from, verdict), DEFAULT_QUESTION_TIMEOUT_MS);
}

module.exports = {
  name: 'quiz',
  category: 'general',
  description: 'Lance un quiz anime avec questions IA, réponses directes et sondages',
  usage: '.quiz [anime | next | score | stop]',
  async execute({ socket, msg, from, args = [], prefix = '.', sessionNumber }) {
    const language = await getSessionLanguage(sessionNumber);
    const action = String(args[0] || '').toLowerCase();
    if (['help', 'aide'].includes(action)) {
      return socket.sendMessage(from, {
        text: renderHelp(prefix, language)
      }, { quoted: msg });
    }

    if (action === 'stop' || action === 'quit' || action === 'quitter') {
      const result = animeQuiz.stop(sessionNumber, from);
      if (!result) return socket.sendMessage(from, { text: 'Aucun quiz n’est en cours dans ce salon.' }, { quoted: msg });
      const formatted = renderScoreboard(`Quiz terminé — ${result.topic}`, result.scores, '🏆 Résultat final', result.language);
      return socket.sendMessage(from, { text: formatted.text, mentions: formatted.mentions }, { quoted: msg });
    }

    if (action === 'score' || action === 'scores') {
      const state = animeQuiz.getState(sessionNumber, from);
      if (!state) return socket.sendMessage(from, { text: 'Aucun quiz n’est en cours dans ce salon.' }, { quoted: msg });
      const formatted = renderScoreboard(state.topic, animeQuiz.snapshot(state).scores, '🏆 Scores', state.language);
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
      const state = await animeQuiz.start({ sessionNumber, chatJid: from, topic, language });
      await postQuestion({ socket, from, sessionNumber, state, prefix, msg });
    } catch (error) {
      await socket.sendMessage(from, { text: `❌ Impossible de générer le quiz : ${error?.message || 'erreur IA'}` }, { quoted: msg });
    }
  },
  _test: { renderHelp, renderQuestion, sendVerdict, renderScoreboard, quizCopy, QUIZ_UI }
};
