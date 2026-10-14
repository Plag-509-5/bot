'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
    { status: 'M', label: 'MODIF', path: 'README.md', paths: ['README.md'] },
    { status: 'A', label: 'AJOUT', path: 'src/new.js', paths: ['src/new.js'] },
    { status: 'D', label: 'SUPPRESSION', path: 'old.js', paths: ['old.js'] },
    { status: 'R100', label: 'MODIF', path: 'old-name.js → new-name.js', paths: ['old-name.js', 'new-name.js'] }
  ]);
  assert.deepEqual(updater.parseChangedFiles('R100\0folder/old name.txt\0folder/new name.txt\0M\0tab\tname.js\0'), [
    { status: 'R100', label: 'MODIF', path: 'folder/old name.txt → folder/new name.txt', paths: ['folder/old name.txt', 'folder/new name.txt'] },
    { status: 'M', label: 'MODIF', path: 'tab\tname.js', paths: ['tab\tname.js'] }
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
  assert.equal(environment.GIT_DISCOVERY_ACROSS_FILESYSTEM, '1');
  assert.equal(updater.getGitAuthEnvironment('', { PATH: '/usr/bin' }).GIT_DISCOVERY_ACROSS_FILESYSTEM, '1');
});

test('peut pointer le détecteur du dépôt vers BOT_REPO_PATH et explique un clone Git absent', async () => {
  const previousPath = process.env.BOT_REPO_PATH;
  try {
    process.env.BOT_REPO_PATH = '/srv/kaido';
    const result = await updater.getOriginRepository({
      run: async (args, cwd) => {
        assert.equal(cwd, '/srv/kaido');
        if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: '/srv/kaido' };
        if (args.join(' ') === 'remote get-url origin') return { stdout: 'https://github.com/Plag-509-5/bot.git' };
        throw new Error(`commande inattendue ${args.join(' ')}`);
      }
    });
    assert.equal(result.root, '/srv/kaido');
    assert.equal(result.repository, 'Plag-509-5/bot');
  } finally {
    if (previousPath === undefined) delete process.env.BOT_REPO_PATH;
    else process.env.BOT_REPO_PATH = previousPath;
  }

  await assert.rejects(updater.getOriginRepository({
    cwd: '/home',
    run: async () => {
      throw new Error('Échec de Git (rev-parse --show-toplevel) : fatal: not a git repository');
    }
  }), /BOT_REPO_PATH/);
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

test('compare le HEAD GitHub et conserve les changements locaux pour une application ciblée', async () => {
  const calls = [];
  let shallow = false;
  let localStatus = '';
  const run = async (args, cwd) => {
    calls.push({ args, cwd });
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return { stdout: '/srv/kaido' };
    if (command === 'remote get-url origin') return { stdout: 'https://github.com/Plag-509-5/bot.git' };
    if (command === 'branch --show-current') return { stdout: 'main' };
    if (args[0] === 'status') return { stdout: localStatus };
    if (command === 'rev-parse HEAD') return { stdout: currentSha };
    if (command === 'rev-parse --is-shallow-repository') return { stdout: shallow ? 'true' : 'false' };
    if (args[0] === 'fetch') return { stdout: '' };
    if (command === 'rev-parse refs/remotes/origin/main') return { stdout: targetSha };
    if (args[0] === 'merge-base') return { stdout: baseSha };
    if (args[0] === 'rev-list') return { stdout: '0	2' };
    if (args[0] === 'diff') return { stdout: 'M\0README.md\0A\0src/new.js\0' };
    if (args[0] === 'show') return { stdout: '2222222	fix: latest changes' };
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
  assert.deepEqual(plan.localChanges, []);
  assert.ok(calls.some(({ args }) => args[0] === 'fetch' && !args.includes('--unshallow')));
  assert.ok(calls.every(({ cwd }) => cwd === '/srv/kaido'));

  shallow = true;
  calls.length = 0;
  await updater.checkForUpdates({ cwd: '/srv/kaido', branch: 'main', run });
  assert.ok(calls.some(({ args }) => args[0] === 'fetch' && args.includes('--unshallow')));

  shallow = false;
  localStatus = ' M src/local-change.js\0';
  const dirtyPlan = await updater.checkForUpdates({ cwd: '/srv/kaido', run });
  assert.equal(dirtyPlan.hasUpdate, true);
  assert.equal(dirtyPlan.localChanges.length, 1);
  assert.equal(dirtyPlan.localChanges[0].path, 'src/local-change.js');
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
    if (args[0] === 'status') return { stdout: '' };
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

test('applique uniquement le diff GitHub, déplace HEAD en fast-forward et refuse un HEAD périmé', async () => {
  const plan = updatePlan();
  const calls = [];
  let reset = false;
  const run = async args => {
    calls.push(args);
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: reset ? targetSha : currentSha };
    if (args[0] === 'branch') return { stdout: 'main' };
    if (args[0] === 'status') return { stdout: '' };
    if (args[0] === 'rev-parse') return { stdout: targetSha };
    if (args[0] === 'merge-base') return { stdout: currentSha };
    if (args[0] === 'rev-list') return { stdout: '0	2' };
    if (args[0] === 'diff') return { stdout: 'M\0README.md\0A\0src/new.js\0' };
    if (args[0] === 'restore') return { stdout: '' };
    if (args[0] === 'update-ref') { reset = true; return { stdout: '' }; }
    throw new Error(`commande inattendue: ${args.join(' ')}`);
  };
  const result = await updater.applyUpdate(plan, { run });
  assert.equal(result.updatedSha, targetSha);
  assert.deepEqual(result.updatedPaths, ['README.md', 'src/new.js']);
  assert.ok(calls.some(args => args[0] === 'restore'
    && args.includes('--staged')
    && args.includes(':(literal)README.md')
    && args.includes(':(literal)src/new.js')));
  assert.ok(calls.some(args => args[0] === 'update-ref'
    && args.includes('HEAD')
    && args.includes('refs/remotes/origin/main')
    && args.includes(currentSha)));
  assert.equal(calls.some(args => args[0] === 'reset' || args[0] === 'merge'), false);

  await assert.rejects(updater.applyUpdate(plan, {
    run: async args => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: '4'.repeat(40) };
      throw new Error(`ne devrait pas appeler ${args.join(' ')}`);
    }
  }), /a changé depuis la comparaison/);
});

test('application Git réelle : ne restaure que les fichiers du diff et préserve les personnalisations hors diff', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-update-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (name, content) => fs.writeFileSync(path.join(root, name), content);
  try {
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.email', 'kaido-test@example.invalid');
    git('config', 'user.name', 'Kaido Update Test');
    git('remote', 'add', 'origin', 'https://github.com/Plag-509-5/bot.git');
    write('change.txt', 'base value\n');
    write('keep.txt', 'base keep\n');
    write('delete.txt', 'delete from base\n');
    write('rename-old.txt', 'unchanged rename body\n');
    write('custom.txt', 'panel base\n');
    write('staged.txt', 'staged base\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    git('switch', '--quiet', '-c', 'update-target');
    write('change.txt', 'from GitHub\n');
    fs.rmSync(path.join(root, 'delete.txt'));
    fs.renameSync(path.join(root, 'rename-old.txt'), path.join(root, 'rename-new.txt'));
    write('added.txt', 'new from GitHub\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'selective update');
    const target = git('rev-parse', 'HEAD');
    git('switch', '--quiet', 'main');
    git('update-ref', 'refs/remotes/origin/update-target', target);

    write('change.txt', 'panel edit that must be replaced\n');
    write('custom.txt', 'panel-only customization\n');
    write('staged.txt', 'staged panel customization\n');
    git('add', 'staged.txt');
    write('.env', 'PANEL_SECRET=keep-me\n');

    const files = updater.parseChangedFiles(git(
      'diff', '--no-ext-diff', '--name-status', '--find-renames', '-z', `${base}..${target}`
    ));
    const result = await updater.applyUpdate({
      root,
      branch: 'update-target',
      currentBranch: 'main',
      currentSha: base,
      targetSha: target,
      targetRef: 'refs/remotes/origin/update-target',
      canFastForward: true,
      files
    });

    assert.equal(result.updatedSha, target);
    assert.equal(fs.readFileSync(path.join(root, 'change.txt'), 'utf8'), 'from GitHub\n');
    assert.equal(fs.readFileSync(path.join(root, 'added.txt'), 'utf8'), 'new from GitHub\n');
    assert.equal(fs.existsSync(path.join(root, 'delete.txt')), false);
    assert.equal(fs.existsSync(path.join(root, 'rename-old.txt')), false);
    assert.equal(fs.readFileSync(path.join(root, 'rename-new.txt'), 'utf8'), 'unchanged rename body\n');
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'base keep\n');
    assert.equal(fs.readFileSync(path.join(root, 'custom.txt'), 'utf8'), 'panel-only customization\n');
    assert.equal(fs.readFileSync(path.join(root, 'staged.txt'), 'utf8'), 'staged panel customization\n');
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'PANEL_SECRET=keep-me\n');
    assert.deepEqual(new Set(result.overwrittenLocalFiles), new Set(['change.txt']));
    assert.deepEqual(new Set(result.preservedLocalFiles), new Set(['custom.txt', 'staged.txt']));

    const remainingChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.match(remainingChanges, /^ M custom\.txt$/m);
    assert.match(remainingChanges, /^M  staged\.txt$/m);
    assert.doesNotMatch(remainingChanges, /change\.txt|delete\.txt|rename-old\.txt|rename-new\.txt|added\.txt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('`.update check` distingue les fichiers locaux remplacés de ceux qui seront conservés', async () => {
  const check = commandContext({ args: ['check'] });
  await updatePlugin._test.executeUpdate(check.context, pluginDependencies({
    checkForUpdates: async () => updatePlan({
      files: [
        { status: 'M', label: 'MODIF', path: 'README.md', paths: ['README.md'] },
        { status: 'M', label: 'MODIF', path: 'remote.js', paths: ['remote.js'] }
      ],
      localChanges: [
        { status: ' M', path: 'README.md', paths: ['README.md'] },
        { status: ' M', path: 'panel-only.js', paths: ['panel-only.js'] }
      ]
    })
  }));
  const reply = check.sent.at(-1).content.text;
  assert.match(reply, /1 fichier\(s\) également modifié\(s\) par GitHub seront remplacés/);
  assert.match(reply, /1 autre\(s\) conservé\(s\)/);
  assert.match(reply, /Seuls les fichiers listés seront remplacés/);
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
