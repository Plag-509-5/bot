'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAnimeQuizService,
  formatQuizVerdict,
  hashPollOption
} = require('../src/services/anime-quiz');
const quizPlugin = require('../src/plugins/general/quiz');

function fakeRouter() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async complete(messages) {
      calls += 1;
      const prompt = messages.find(message => message.role === 'user').content;
      const direct = prompt.includes('mode est réponse directe');
      const n = calls;
      return {
        text: JSON.stringify(direct
          ? { question: `Question directe ${n} ?`, options: [], answer: 'Luffy', acceptedAnswers: ['Monkey D. Luffy'], explanation: 'Il est le héros.' }
          : { question: `Question QCM ${n} ?`, options: ['Luffy', 'Zoro', 'Nami', 'Sanji'], answer: 'Luffy', explanation: 'Il est le héros.' })
      };
    }
  };
}

function createService(options = {}) {
  const timers = [];
  const service = createAnimeQuizService({
    router: fakeRouter(),
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; },
    ...options
  });
  return { service, timers };
}

test('quiz starts with an AI-generated QCM and does not expose its answer in the public snapshot', async () => {
  const { service } = createService();
  const state = await service.start({ sessionNumber: '15550001111', chatJid: '120363@g.us' });
  assert.ok(state.topic);
  assert.equal(state.question.mode, 'multiple_choice');
  assert.equal(state.question.options.length, 4);
  assert.equal('answer' in state.question, false);
  assert.equal('correctIndex' in state.question, false);
  assert.equal(service.getState('15550001111', '120363@g.us').question.poll, false);
});

test('text answers accept the correct option letter and mention/score the winner in the verdict', async () => {
  const { service } = createService();
  await service.start({ sessionNumber: '1', chatJid: 'group@g.us', topic: 'One Piece' });
  const result = service.submitTextAnswer('1', 'group@g.us', '111@s.whatsapp.net', 'A');
  assert.equal(result.handled, true);
  assert.equal(result.correct, true);
  assert.deepEqual(result.verdict.winners, ['111@s.whatsapp.net']);
  const formatted = formatQuizVerdict(result.verdict);
  assert.match(formatted.text, /@111/);
  assert.deepEqual(formatted.mentions, ['111@s.whatsapp.net']);
});

test('wrong QCM letter is not accepted as correct and duplicate wrong answers are not spammed', async () => {
  const { service } = createService();
  await service.start({ sessionNumber: '2', chatJid: 'group@g.us', topic: 'Naruto' });
  const wrong = service.submitTextAnswer('2', 'group@g.us', '222@s.whatsapp.net', 'B');
  const duplicate = service.submitTextAnswer('2', 'group@g.us', '222@s.whatsapp.net', 'C');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.notify, true);
  assert.equal(duplicate.notify, false);
  assert.equal(service.hasActiveQuestion('2', 'group@g.us'), true);
});

test('question types alternate and the third question is a native-poll question', async () => {
  const { service } = createService();
  const session = '3';
  const group = 'group@g.us';
  let state = await service.start({ sessionNumber: session, chatJid: group, topic: 'Bleach' });
  assert.equal(state.question.mode, 'multiple_choice');
  service.submitTextAnswer(session, group, 'a@s.whatsapp.net', 'A');
  state = await service.next(session, group);
  assert.equal(state.question.mode, 'direct');
  service.submitTextAnswer(session, group, 'b@s.whatsapp.net', 'Luffy');
  state = await service.next(session, group);
  assert.equal(state.question.mode, 'multiple_choice');
  assert.equal(state.question.poll, true);
});

test('poll votes are mapped by Baileys option hashes and the verdict lists every correct voter', async () => {
  const { service } = createService();
  const session = '4';
  const group = 'group@g.us';
  await service.start({ sessionNumber: session, chatJid: group, topic: 'One Piece' });
  service.submitTextAnswer(session, group, 'a@s.whatsapp.net', 'A');
  await service.next(session, group);
  service.submitTextAnswer(session, group, 'a@s.whatsapp.net', 'Luffy');
  const poll = await service.next(session, group);
  assert.equal(poll.question.poll, true);
  assert.equal(service.submitPollVote(session, group, 'b@s.whatsapp.net', [hashPollOption('Luffy')]), true);
  assert.equal(service.submitPollVote(session, group, 'c@s.whatsapp.net', [hashPollOption('Zoro')]), true);
  const verdict = service.closeQuestion(session, group, { timedOut: true });
  assert.deepEqual(verdict.winners, ['b@s.whatsapp.net']);
  assert.equal(service.hasActiveQuestion(session, group), false);
});

test('plugin formats QCM, direct-answer and poll instructions without leaking the answer', () => {
  const base = { topic: 'Frieren', questionIndex: 2 };
  const qcm = quizPlugin._test.renderQuestion({
    ...base,
    question: { mode: 'multiple_choice', poll: false, question: 'Qui est Frieren ?', options: ['Mage', 'Roi', 'Chevalier', 'Dragon'] }
  }, '!');
  assert.match(qcm, /A\. Mage/);
  assert.match(qcm, /!quiz stop/);
  assert.doesNotMatch(qcm, /Réponse\s*:/);

  const direct = quizPlugin._test.renderQuestion({
    ...base,
    question: { mode: 'direct', poll: false, question: 'Quel est son nom ?', options: [] }
  });
  assert.match(direct, /réponse directe/i);

  const poll = quizPlugin._test.renderQuestion({
    ...base,
    question: { mode: 'multiple_choice', poll: true, question: 'Choisis la réponse', options: ['A', 'B', 'C', 'D'] }
  });
  assert.match(poll, /Vote dans le sondage/);
});

test('plugin scoreboard includes participant mentions', () => {
  const result = quizPlugin._test.renderScoreboard('Naruto', [
    { jid: '333@s.whatsapp.net', score: 2 }
  ]);
  assert.match(result.text, /@333/);
  assert.deepEqual(result.mentions, ['333@s.whatsapp.net']);
});

test('failed AI generation does not leave a phantom active quiz', async () => {
  const service = createAnimeQuizService({ router: { async complete() { throw new Error('offline'); } } });
  await assert.rejects(service.start({ sessionNumber: '5', chatJid: 'group@g.us' }), /offline/);
  assert.equal(service.getState('5', 'group@g.us'), null);
});
