'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const updatePlugin = require('../src/plugins/owner/update');

const targetSha = '2'.repeat(40);

function context(args) {
  const sent = [];
  const value = {
    socket: {
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: String(sent.length) } };
      }
    },
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: `update-${args.join('-')}` },
      message: { conversation: `.update ${args.join(' ')}` }
    },
    from: '50911111111@s.whatsapp.net',
    sender: '50911111111@s.whatsapp.net',
    args,
    prefix: '.',
    command: 'update',
    isOwner: true,
    isSessionOwner: false
  };
  return { value, sent };
}

test('liste, sélectionne et persiste un dépôt/branche puis les affiche lors de check', async () => {
  const token = 'ghp_do-not-display-this-token';
  const saved = {};
  const calls = [];
  const dependencies = {
    getSettings: async () => ({ ...saved }),
    setSettings: async patch => Object.assign(saved, patch),
    clearSettings: async () => { for (const key of Object.keys(saved)) delete saved[key]; },
    getOriginRepository: async () => ({ repository: 'Plag-509-5/bot' }),
    getToken: () => token,
    listRepositories: async options => {
      assert.equal(options.token, token);
      return [{ fullName: 'Plag-509-5/private-bot', private: true, defaultBranch: 'stable' }];
    },
    getRepositoryInfo: async ({ repository, token: actualToken }) => {
      assert.equal(repository, 'Plag-509-5/private-bot');
      assert.equal(actualToken, token);
      return { fullName: repository, defaultBranch: 'stable', private: true, archived: false };
    },
    listBranches: async ({ repository, token: actualToken }) => {
      calls.push({ type: 'branches', repository, token: actualToken });
      return ['stable', 'main', 'release/v2'];
    },
    checkForUpdates: async options => {
      calls.push({ type: 'check', ...options });
      return {
        repository: options.repository,
        branch: options.branch,
        currentSha: '1'.repeat(40),
        currentBranch: 'main',
        targetSha,
        shortSha: targetSha.slice(0, 7),
        commitSummary: 'latest safe commit',
        ahead: 0,
        behind: 0,
        files: [],
        hasUpdate: false,
        canFastForward: false
      };
    }
  };

  const repos = context(['repos']);
  await updatePlugin._test.executeUpdate(repos.value, dependencies);
  assert.match(repos.sent.at(-1).content.text, /Plag-509-5\/private-bot/);
  assert.equal(repos.sent.at(-1).content.text.includes(token), false);

  const selectRepo = context(['repo', 'Plag-509-5/private-bot']);
  await updatePlugin._test.executeUpdate(selectRepo.value, dependencies);
  assert.equal(saved.repository, 'Plag-509-5/private-bot');
  assert.equal(saved.branch, 'stable');
  assert.match(selectRepo.sent.at(-1).content.text, /Branche initiale : \*stable\*/);

  const branches = context(['branches']);
  await updatePlugin._test.executeUpdate(branches.value, dependencies);
  assert.match(branches.sent.at(-1).content.text, /release\/v2/);
  assert.match(branches.sent.at(-1).content.text, /stable  ← sélectionnée/);

  const selectBranch = context(['branch', 'release/v2']);
  await updatePlugin._test.executeUpdate(selectBranch.value, dependencies);
  assert.equal(saved.branch, 'release/v2');
  assert.match(selectBranch.sent.at(-1).content.text, /private-bot@release\/v2/);

  const check = context(['check']);
  await updatePlugin._test.executeUpdate(check.value, dependencies);
  assert.match(check.sent.at(-1).content.text, /Branches GitHub \(3\)/);
  assert.match(check.sent.at(-1).content.text, /release\/v2  ← sélectionnée/);
  const checked = calls.find(call => call.type === 'check');
  assert.equal(checked.repository, 'Plag-509-5/private-bot');
  assert.equal(checked.branch, 'release/v2');
  assert.equal(checked.token, token);
  assert.equal(checked.bootstrapIfMissing, false);

  const status = context(['status']);
  await updatePlugin._test.executeUpdate(status.value, dependencies);
  assert.match(status.sent.at(-1).content.text, /Branche : \*release\/v2\*/);
  assert.match(status.sent.at(-1).content.text, /Token GitHub : configuré/);

  const reset = context(['reset']);
  await updatePlugin._test.executeUpdate(reset.value, dependencies);
  assert.deepEqual(saved, {});
});

test('la première mise à jour sans .git crée le fichier Git et explique la synchronisation initiale', async () => {
  const calls = [];
  const dependencies = {
    getSettings: async () => ({}),
    getToken: () => '',
    listBranches: async () => ['main'],
    checkForUpdates: async options => {
      calls.push(options);
      return {
        bootstrapped: true,
        repository: 'Plag-509-5/bot',
        branch: 'main',
        shortSha: 'abc1234',
        hasUpdate: false,
        ahead: 0
      };
    }
  };
  const update = context([]);
  await updatePlugin._test.executeUpdate(update.value, dependencies);
  assert.equal(calls[0].bootstrapIfMissing, true);
  assert.match(update.sent.at(-1).content.text, /fichier \.git a été créé/);
  assert.match(update.sent.at(-1).content.text, /fichiers suivis ont été synchronisés/);
  assert.match(update.sent.at(-1).content.text, /\.env/);
});

test('valide que la branche choisie existe et n’écrase pas une sélection avec un nom invalide', async () => {
  const saved = { repository: 'Plag-509-5/private-bot', branch: 'stable' };
  const dependencies = {
    getSettings: async () => ({ ...saved }),
    setSettings: async patch => Object.assign(saved, patch),
    getToken: () => '',
    listBranches: async () => ['stable', 'main']
  };

  const invalid = context(['branch', '../main']);
  await updatePlugin._test.executeUpdate(invalid.value, dependencies);
  assert.equal(saved.branch, 'stable');
  assert.match(invalid.sent.at(-1).content.text, /Nom de branche.*invalide/);

  const missing = context(['branch', 'develop']);
  await updatePlugin._test.executeUpdate(missing.value, dependencies);
  assert.equal(saved.branch, 'stable');
  assert.match(missing.sent.at(-1).content.text, /introuvable/);
});
