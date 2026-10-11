'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const updater = require('../src/services/github-updater');
const updatePlugin = require('../src/plugins/owner/update');

const currentSha = '1'.repeat(40);
const targetSha = '2'.repeat(40);
const baseSha = '3'.repeat(40);

function commandContext(overrides = {}) {
  const sent = [];
  const context = {
    socket: {
      async sendMessage(jid, content, options) {
        sent.push({ jid, content, options });
        return { key: { id: String(sent.length) } };
      }
    },
    msg: {
      key: { remoteJid: '50911111111@s.whatsapp.net', fromMe: false, id: 'update-command' },
      message: { conversation: '.update' }
    },
    from: '50911111111@s.whatsapp.net',
    sender: '50911111111@s.whatsapp.net',
    args: [],
    prefix: '.',
    command: 'update',
    isOwner: true,
    isSessionOwner: false,
    isSudo: false,
    ...overrides
  };
  return { context, sent };
}

function updatePlan(overrides = {}) {
  return {
    repository: 'Plag-509-5/bot',
    root: '/srv/kaido',
    branch: 'main',
    currentBranch: 'main',
    currentSha,
    targetSha,
    shortSha: '2222222',
    commitSummary: 'fix: improve command routing',
    ahead: 0,
    behind: 2,
    files: [
      { status: 'M', label: 'MODIF', path: 'README.md' },
      { status: 'A', label: 'AJOUT', path: 'src/plugins/owner/new.js' }
    ],
    hasUpdate: true,
    canFastForward: true,
    ...overrides
  };
}

function pluginDependencies(overrides = {}) {
  return {
    getSettings: async () => ({}),
    setSettings: async () => ({}),
    clearSettings: async () => ({}),
    getOriginRepository: async () => ({ repository: 'Plag-509-5/bot' }),
    getRepositoryInfo: async ({ repository }) => ({ fullName: repository, defaultBranch: 'main', archived: false }),
    listRepositories: async () => [],
    listBranches: async () => ['main', 'develop', 'release/v2'],
    getToken: () => '',
    ...overrides
  };
}

test('valide les branches et reconnaît les formats GitHub HTTPS et SSH', () => {
  assert.equal(updater.validateBranchName('release/v2'), 'release/v2');
  assert.throws(() => updater.validateBranchName('../main'), /invalide/);
  assert.throws(() => updater.validateBranchName('main; rm -rf /'), /invalide/);
  assert.equal(updater.parseGitHubRepository('https://github.com/Plag-509-5/bot.git'), 'Plag-509-5/bot');
  assert.equal(updater.parseGitHubRepository('git@github.com:Plag-509-5/bot.git'), 'Plag-509-5/bot');
  assert.equal(updater.parseGitHubRepository('ssh://git@github.com/Plag-509-5/bot.git'), 'Plag-509-5/bot');
  assert.equal(updater.parseGitHubRepository('Plag-509-5/bot'), 'Plag-509-5/bot');
  assert.equal(updater.validateGitHubRepository('Plag-509-5/bot'), 'Plag-509-5/bot');
  assert.throws(() => updater.validateGitHubRepository('../bot'), /Dépôt GitHub invalide/);
  assert.equal(updater.parseGitHubRepository('https://gitlab.com/Plag-509-5/bot.git'), null);
  assert.equal(updater.parseGitHubRepository('https://github.com/owner/repo/tree/main'), null);
});

test('parse les commits ahead/behind et les fichiers ajoutés, modifiés, supprimés ou renommés', () => {
  assert.deepEqual(updater.parseAheadBehind('2\t5\n'), { ahead: 2, behind: 5 });
  assert.throws(() => updater.parseAheadBehind('oops'), /invalide/);
  assert.deepEqual(updater.parseChangedFiles([
    'M\tREADME.md',
    'A\tsrc/new.js',
    'D\told.js',
    'R100\told-name.js\tnew-name.js'
  ].join('\n')), [
    { status: 'M', label: 'MODIF', path: 'README.md' },
    { status: 'A', label: 'AJOUT', path: 'src/new.js' },
    { status: 'D', label: 'SUPPRESSION', path: 'old.js' },
    { status: 'R100', label: 'MODIF', path: 'old-name.js → new-name.js' }
  ]);
});

test('liste les dépôts et branches GitHub avec le token sans révéler sa valeur', async () => {
  const token = 'ghp_secret-test-value';
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    const parsedUrl = new URL(url);
    let body;
    if (parsedUrl.pathname === '/user/repos') {
      body = [{
        full_name: 'Plag-509-5/private-bot',
        private: true,
        default_branch: 'stable',
        archived: false,
        description: 'Private updater target'
      }];
    } else if (parsedUrl.pathname.endsWith('/branches')) {
      body = [{ name: 'main' }, { name: 'release/v2' }];
    } else {
      body = {
        full_name: 'Plag-509-5/private-bot',
        private: true,
        default_branch: 'stable',
        archived: false,
        html_url: 'https://github.com/Plag-509-5/private-bot'
      };
    }
    return { ok: true, status: 200, json: async () => body };
  };

  const repositories = await updater.listGitHubRepositories({ token, fetchImpl });
  assert.deepEqual(repositories, [{
    fullName: 'Plag-509-5/private-bot',
    private: true,
    defaultBranch: 'stable',
    archived: false,
    description: 'Private updater target'
  }]);
  const branches = await updater.listGitHubBranches({
    repository: 'Plag-509-5/private-bot', token, fetchImpl
  });
  assert.deepEqual(branches, ['main', 'release/v2']);
  const info = await updater.getGitHubRepositoryInfo({
    repository: 'Plag-509-5/private-bot', token, fetchImpl
  });
  assert.equal(info.defaultBranch, 'stable');
  assert.equal(info.private, true);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.options.headers.Authorization === `Bearer ${token}`));
  assert.ok(requests[0].url.includes('affiliation=owner%2Ccollaborator%2Corganization_member'));

  const environment = updater.getGitAuthEnvironment(token, { PATH: '/usr/bin', GIT_CONFIG_COUNT: '1' });
  assert.equal(environment.GIT_CONFIG_COUNT, '2');
  assert.equal(environment.GIT_CONFIG_KEY_1, 'http.https://github.com/.extraheader');
  assert.match(environment.GIT_CONFIG_VALUE_1, /^AUTHORIZATION: basic /);
  assert.equal(environment.GIT_CONFIG_VALUE_1.includes(token), false);
});

test('masque un token dans les erreurs de l’API GitHub', async () => {
  const token = 'secret-in-error';
  await assert.rejects(updater.listGitHubBranches({
    repository: 'Plag-509-5/private-bot',
    token,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ message: `bad credential ${token}` })
    })
  }), error => {
    assert.match(error.message, /token masqué/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
});

test('compare le HEAD local au dernier commit GitHub sans accepter de changements locaux suivis', async () => {
  const calls = [];
  let shallow = false;
  const run = async (args, cwd) => {
    calls.push({ args, cwd });
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return { stdout: '/srv/kaido' };
    if (command === 'remote get-url origin') return { stdout: 'https://github.com/Plag-509-5/bot.git' };
    if (command === 'branch --show-current') return { stdout: 'main' };
    if (command === 'status --porcelain --untracked-files=no') return { stdout: '' };
    if (command === 'rev-parse HEAD') return { stdout: currentSha };
    if (command === 'rev-parse --is-shallow-repository') return { stdout: shallow ? 'true' : 'false' };
    if (args[0] === 'fetch') return { stdout: '' };
    if (command === `rev-parse refs/remotes/origin/main`) return { stdout: targetSha };
    if (args[0] === 'merge-base') return { stdout: baseSha };
    if (args[0] === 'rev-list') return { stdout: '0\t2' };
    if (args[0] === 'diff') return { stdout: 'M\tREADME.md\nA\tsrc/new.js' };
    if (args[0] === 'show') return { stdout: '2222222\tfix: latest changes' };
    throw new Error(`commande inattendue: ${command}`);
  };

  const plan = await updater.checkForUpdates({ cwd: '/srv/kaido', branch: 'main', run });
  assert.equal(plan.repository, 'Plag-509-5/bot');
  assert.equal(plan.currentSha, currentSha);
  assert.equal(plan.targetSha, targetSha);
  assert.equal(plan.behind, 2);
  assert.equal(plan.ahead, 0);
  assert.equal(plan.canFastForward, true);
  assert.deepEqual(plan.files.map(file => file.path), ['README.md', 'src/new.js']);
  assert.ok(calls.some(({ args }) => args[0] === 'fetch' && !args.includes('--unshallow')));
  assert.ok(calls.every(({ cwd }) => cwd === '/srv/kaido'));

  shallow = true;
  calls.length = 0;
  await updater.checkForUpdates({ cwd: '/srv/kaido', branch: 'main', run });
  assert.ok(calls.some(({ args }) => args[0] === 'fetch' && args.includes('--unshallow')));

  const dirtyRun = async (args) => {
    if (args[0] === 'rev-parse') return { stdout: '/srv/kaido' };
    if (args[0] === 'remote') return { stdout: 'https://github.com/Plag-509-5/bot.git' };
    if (args[0] === 'branch') return { stdout: 'main' };
    if (args[0] === 'status') return { stdout: ' M src/local-change.js' };
    throw new Error(`ne devrait pas appeler ${args.join(' ')}`);
  };
  await assert.rejects(updater.checkForUpdates({ cwd: '/srv/kaido', run: dirtyRun }), /changements locaux/);
});

test('peut comparer une branche d’un dépôt sélectionné et authentifier git fetch sans URL tokenisée', async () => {
  const calls = [];
  const targetRef = 'refs/remotes/bot-update/Plag-509-5/upstream/release/v2';
  const token = 'ghp_fetch-secret';
  const run = async (args, cwd, options) => {
    calls.push({ args, cwd, options });
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return { stdout: '/srv/kaido' };
    if (command === 'remote get-url origin') return { stdout: 'https://github.com/Plag-509-5/bot.git' };
    if (command === 'branch --show-current') return { stdout: 'main' };
    if (command === 'status --porcelain --untracked-files=no') return { stdout: '' };
    if (command === 'rev-parse HEAD') return { stdout: currentSha };
    if (command === 'rev-parse --is-shallow-repository') return { stdout: 'false' };
    if (args[0] === 'fetch') return { stdout: '' };
    if (command === `rev-parse ${targetRef}`) return { stdout: targetSha };
    if (args[0] === 'merge-base') return { stdout: baseSha };
    if (args[0] === 'rev-list') return { stdout: '0\t1' };
    if (args[0] === 'diff') return { stdout: 'M\tREADME.md' };
    if (args[0] === 'show') return { stdout: '2222222\tupstream update' };
    throw new Error(`commande inattendue: ${command}`);
  };

  const plan = await updater.checkForUpdates({
    cwd: '/srv/kaido',
    repository: 'Plag-509-5/upstream',
    branch: 'release/v2',
    token,
    run
  });
  const fetchCall = calls.find(call => call.args[0] === 'fetch');
  assert.ok(fetchCall.args.includes('https://github.com/Plag-509-5/upstream.git'));
  assert.ok(fetchCall.args.includes(`+refs/heads/release/v2:${targetRef}`));
  assert.equal(fetchCall.options.token, token);
  assert.equal(fetchCall.args.some(argument => argument.includes(token)), false);
  assert.equal(plan.repository, 'Plag-509-5/upstream');
  assert.equal(plan.targetRef, targetRef);
  assert.equal(plan.canFastForward, true);
});

test('applique seulement un fast-forward confirmé, sans écraser un changement apparu entre-temps', async () => {
  const plan = updatePlan();
  const calls = [];
  let merged = false;
  const run = async args => {
    calls.push(args);
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: merged ? targetSha : currentSha };
    if (args[0] === 'status') return { stdout: '' };
    if (args[0] === 'rev-parse') return { stdout: targetSha };
    if (args[0] === 'merge') { merged = true; return { stdout: '' }; }
    throw new Error(`commande inattendue: ${args.join(' ')}`);
  };
  const result = await updater.applyUpdate(plan, { run });
  assert.equal(result.updatedSha, targetSha);
  assert.ok(calls.some(args => args[0] === 'merge' && args.includes('--ff-only')));

  await assert.rejects(updater.applyUpdate(plan, {
    run: async args => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: '4'.repeat(40) };
      throw new Error(`ne devrait pas appeler ${args.join(' ')}`);
    }
  }), /a changé depuis la comparaison/);
});

test('`.update check` liste les changements sans appliquer et `.update` applique puis conseille le redémarrage', async () => {
  const checked = commandContext({ args: ['check'] });
  let applied = false;
  await updatePlugin._test.executeUpdate(checked.context, pluginDependencies({
    checkForUpdates: async ({ branch, repository }) => {
      assert.equal(branch, 'main');
      assert.equal(repository, 'Plag-509-5/bot');
      return updatePlan({ files: [
        { status: 'M', label: 'MODIF', path: 'README.md' },
        { status: 'M', label: 'MODIF', path: 'package.json' }
      ] });
    },
    applyUpdate: async () => { applied = true; return { updatedSha: targetSha }; }
  }));
  assert.equal(applied, false);
  assert.match(checked.sent.at(-1).content.text, /README\.md/);
  assert.match(checked.sent.at(-1).content.text, /Pour appliquer/);

  const applying = commandContext();
  await updatePlugin._test.executeUpdate(applying.context, pluginDependencies({
    checkForUpdates: async () => updatePlan({
      files: [{ status: 'M', label: 'MODIF', path: 'package.json' }]
    }),
    applyUpdate: async plan => {
      applied = true;
      assert.equal(plan.targetSha, targetSha);
      return { updatedSha: targetSha };
    }
  }));
  assert.equal(applied, true);
  assert.match(applying.sent.at(-1).content.text, /Redémarre le bot/);
  assert.match(applying.sent.at(-1).content.text, /npm install/);
});

test('`.update` est limité au propriétaire et répond en privé lorsqu’il est lancé dans un groupe', async () => {
  const unauthorised = commandContext({ isOwner: false, isSessionOwner: false, isSudo: true });
  let checks = 0;
  await updatePlugin._test.executeUpdate(unauthorised.context, {
    checkForUpdates: async () => { checks += 1; return updatePlan(); }
  });
  assert.equal(checks, 0, 'un sudo seul ne doit pas mettre à jour les fichiers');
  assert.match(unauthorised.sent.at(-1).content.text, /réservée au propriétaire/i);

  const ownerJid = '50911111111@s.whatsapp.net';
  const group = commandContext({
    from: '120363123@g.us',
    msg: {
      key: { remoteJid: '120363123@g.us', participant: ownerJid, id: 'group-update' },
      message: { conversation: '.update check' }
    },
    args: ['check']
  });
  await updatePlugin._test.executeUpdate(group.context, pluginDependencies({
    checkForUpdates: async () => updatePlan({ hasUpdate: false, behind: 0, files: [] })
  }));
  assert.ok(group.sent.every(event => event.jid === ownerJid));
  assert.equal(updatePlugin._test.getReplyJid(group.context), ownerJid);
});
