'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBPollInput,
  allocateBPollVotes,
  getPollOptionNames,
  resolveBPollTarget,
  hashPollOption,
  buildNewsletterPollVoteNode,
  sendNewsletterPollVote,
  voteAcrossNewsletterSockets
} = require('../src/services/newsletter-poll');

const options = ['First choice', 'Second choice', 'Third choice'];

test('parses a single option as a 100 percent vote', () => {
  assert.deepEqual(parseBPollInput('1'), { choices: [{ option: 1, percent: 100 }] });
});

test('parses percentage assignments, optional percent signs and decimals', () => {
  assert.deepEqual(parseBPollInput('1 (75), 3 (25%)'), {
    choices: [{ option: 1, percent: 75 }, { option: 3, percent: 25 }]
  });
  assert.deepEqual(parseBPollInput('1 (62.5%), 2 (37.5)'), {
    choices: [{ option: 1, percent: 62.5 }, { option: 2, percent: 37.5 }]
  });
});

test('rejects malformed, duplicate, out-of-range, or non-100 percent splits', () => {
  for (const raw of ['', '0', '1 (0), 2 (100)', '1 (70), 2 (20)', '1 (101)', '1 (75), 1 (25)', '1 (75.333), 2 (24.667)', '1, 2 (100)']) {
    assert.equal(parseBPollInput(raw), null, raw);
  }
});

test('allocates the exact session count with largest-remainder rounding', () => {
  assert.deepEqual(allocateBPollVotes(4, [{ option: 1, percent: 75 }, { option: 3, percent: 25 }]), [1, 1, 1, 3]);
  assert.deepEqual(allocateBPollVotes(3, [{ option: 1, percent: 75 }, { option: 3, percent: 25 }]), [1, 1, 3]);
  assert.deepEqual(allocateBPollVotes(7, [{ option: 1, percent: 75 }, { option: 3, percent: 25 }]), [1, 1, 1, 1, 1, 3, 3]);
  assert.deepEqual(allocateBPollVotes(1, [{ option: 2, percent: 50 }, { option: 1, percent: 50 }]), [2]);
  assert.deepEqual(allocateBPollVotes(0, [{ option: 1, percent: 100 }]), []);
});

test('reads options from poll creation or result snapshot messages', () => {
  assert.deepEqual(getPollOptionNames({ pollCreationMessageV3: { options: options.map(optionName => ({ optionName })) } }), options);
  assert.deepEqual(getPollOptionNames({ pollResultSnapshotMessage: { pollVotes: options.map(optionName => ({ optionName, optionVoteCount: 2 })) } }), options);
  assert.deepEqual(getPollOptionNames({ conversation: 'not a poll' }), []);
});

test('resolves a forwarded newsletter poll to its original channel and server id', () => {
  const pollMessage = {
    pollResultSnapshotMessage: {
      pollVotes: [{ optionName: 'Yes' }, { optionName: 'No' }],
      contextInfo: {
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363123456789012@newsletter',
          serverMessageId: 777
        }
      }
    }
  };
  assert.deepEqual(resolveBPollTarget({ pollMessage, chatJid: '12345@lid' }), {
    jid: '120363123456789012@newsletter',
    serverId: '777'
  });
});

test('does not mistake a private LID chat for the source newsletter', () => {
  assert.equal(resolveBPollTarget({
    pollMessage: { pollResultSnapshotMessage: { pollVotes: [{ optionName: 'Yes' }] } },
    quotedContext: { remoteJid: '123456789@lid', stanzaId: 'LOCAL_FORWARD_ID' },
    chatJid: '123456789@lid'
  }), null);
});

test('hashes exact UTF-8 option text and builds the newsletter poll-vote stanza', () => {
  const expected = require('node:crypto').createHash('sha256').update('Été ☀️').digest();
  assert.deepEqual(hashPollOption('Été ☀️'), expected);
  const node = buildNewsletterPollVoteNode({
    jid: '120363123456789012@newsletter',
    serverId: '777',
    optionNames: ['Été ☀️', 'Yes'],
    messageId: 'MSG123'
  });
  assert.deepEqual(node.attrs, {
    to: '120363123456789012@newsletter',
    id: 'MSG123',
    type: 'poll',
    server_id: '777'
  });
  assert.deepEqual(node.content.map(item => item.tag), ['meta', 'votes']);
  assert.deepEqual(node.content[0].attrs, { polltype: 'vote' });
  assert.deepEqual(node.content[1].content.map(item => item.content), [hashPollOption('Été ☀️'), hashPollOption('Yes')]);
});

test('sends via Baileys query and handles session-specific results independently', async () => {
  const sent = [];
  const sock = {
    user: { id: '111@s.whatsapp.net' },
    generateMessageTag: () => 'TAG1',
    query: async node => sent.push(node)
  };
  await sendNewsletterPollVote(sock, { jid: '120363123456789012@newsletter', serverId: '7' }, ['Yes']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].attrs.server_id, '7');
  assert.equal(sent[0].content[1].content.length, 1);

  const failSock = { user: { id: '222@s.whatsapp.net' }, generateMessageTag: () => 'TAG2', query: async () => { throw new Error('rejected'); } };
  const results = await voteAcrossNewsletterSockets([
    { session: '111', socket: sock },
    { session: '222', socket: failSock }
  ], { jid: '120363123456789012@newsletter', serverId: '7' }, [['Yes'], ['No']]);
  assert.deepEqual(results.map(result => result.ok), [true, false]);
  assert.equal(results[1].error, 'rejected');
});
