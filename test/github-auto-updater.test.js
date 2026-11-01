'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  dependencyFilesChanged,
  parseInterval,
  createGitHubAutoUpdater
} = require('../src/services/github-auto-updater');

function plan(overrides = {}) {
  return {
    repository: 'Plag-509-5/bot',
    branch: 'main',
    shortSha: 'abc1234',
    targetSha: 'a'.repeat(40),
    ahead: 0,
    behind: 1,
    hasUpdate: true,
    canFastForward: true,
    localChanges: [],
    files: [{ status: 'M', path: 'README.md', paths: ['README.md'] }],
    ...overrides
  };
}

function createHarness({ env = {}, updatePlan = plan(), settings = {}, untrackedOutput = '', ...overrides } = {}) {
  const calls = { checks: [], applies: [], restarts: 0, logs: [] };
  const service = createGitHubAutoUpdater({
    env,
    updater: {
      DEFAULT_UPDATE_BRANCH: 'main',
      getDefaultRepositoryPath: inputEnv => inputEnv.BOT_REPO_PATH || '/srv/kaido',
      getGitHubToken: inputEnv => inputEnv.BOT_UPDATE_GITHUB_TOKEN || '',
      async checkForUpdates(options) {
        calls.checks.push(options);
        if (overrides.checkError) throw overrides.checkError;
        return updatePlan;
      },
      async applyUpdate(value) {
        calls.applies.push(value);
        return { updatedSha: value.targetSha, files: value.files };
      },
      async runGit() { return { stdout: untrackedOutput }; }
    },
    settings: { async getUpdateSettings() { return settings; } },
    logger: {
      info: message => calls.logs.push(['info', message]),
      warn: message => calls.logs.push(['warn', message])
    },
    async restart() { calls.restarts += 1; },
    ...overrides
  });
  return { service, calls };
}

test('la mise à jour automatique est désactivée par défaut et le polling est borné', () => {
  const timers = [];
  const { service } = createHarness({
    setTimeoutFn: (callback, delay) => { timers.push(['timeout', delay]); return { unref() {} }; },
    setIntervalFn: (callback, delay) => { timers.push(['interval', delay]); return { unref() {} }; }
  });
  assert.equal(service.start(), false);
  assert.deepEqual(timers, []);
  assert.equal(parseInterval('invalid'), DEFAULT_INTERVAL_MS);
  assert.equal(parseInterval(1), MIN_INTERVAL_MS);
  assert.equal(parseInterval(MAX_INTERVAL_MS * 2), MAX_INTERVAL_MS);
  assert.equal(parseInterval(15 * 60 * 1000), 15 * 60 * 1000);
});

test('la première vérification attend le démarrage et le polling se programme une seule fois', () => {
  const timers = [];
  const cleared = [];
  const { service } = createHarness({
    env: { BOT_AUTO_UPDATE_ENABLED: 'true', BOT_AUTO_UPDATE_INTERVAL_MS: String(30 * 60 * 1000) },
    startDelayMs: 30_000,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(['timeout', timer]);
      return timer;
    },
    setIntervalFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(['interval', timer]);
      return timer;
    },
    clearTimeoutFn: timer => cleared.push(['timeout', timer]),
    clearIntervalFn: timer => cleared.push(['interval', timer])
  });

  assert.equal(service.start(), true);
  assert.equal(service.start(), true);
  assert.equal(timers.length, 2);
  assert.equal(timers[0][1].delay, 30_000);
  assert.equal(timers[1][1].delay, 30 * 60 * 1000);
  service.stop();
  assert.equal(cleared.length, 2);
  assert.equal(service.getStatus().started, false);
});

test('applique une mise à jour fast-forward propre et redémarre après l’application', async () => {
  const { service, calls } = createHarness({
    env: {
      BOT_AUTO_UPDATE_ENABLED: 'on',
      BOT_REPO_PATH: '/srv/custom-bot',
      BOT_UPDATE_GITHUB_TOKEN: 'github-secret',
      BOT_UPDATE_REPO: 'fallback/repo',
      BOT_UPDATE_BRANCH: 'fallback-branch'
    },
    settings: { repository: 'Plag-509-5/bot', branch: 'stable' }
  });

  const result = await service.checkNow();
  assert.equal(result.status, 'updated');
  assert.equal(calls.checks.length, 1);
  assert.deepEqual(calls.checks[0], {
    cwd: '/srv/custom-bot',
    repository: 'Plag-509-5/bot',
    branch: 'stable',
    token: 'github-secret'
  });
  assert.equal(calls.applies.length, 1);
  assert.equal(calls.restarts, 1);
});

test('ignore les changements locaux, les branches divergentes et les modifications de dépendances', async t => {
  await t.test('changement local', async () => {
    const { service, calls } = createHarness({ updatePlan: plan({ localChanges: [{ path: 'src/local.js' }] }) });
    assert.equal((await service.checkNow()).status, 'local_changes');
    assert.equal(calls.applies.length, 0);
    assert.equal(calls.restarts, 0);
  });

  await t.test('fichier local non suivi', async () => {
    const { service, calls } = createHarness({ untrackedOutput: 'local-not-committed.js\\0' });
    assert.equal((await service.checkNow()).status, 'local_changes');
    assert.equal(calls.applies.length, 0);
    assert.equal(calls.restarts, 0);
  });

  await t.test('branche divergente', async () => {
    const { service, calls } = createHarness({ updatePlan: plan({ ahead: 1, canFastForward: false }) });
    assert.equal((await service.checkNow()).status, 'diverged');
    assert.equal(calls.applies.length, 0);
    assert.equal(calls.restarts, 0);
  });

  await t.test('manifestes de dépendances', async () => {
    const changedPlan = plan({ files: [{ status: 'M', path: 'package-lock.json', paths: ['package-lock.json'] }] });
    const { service, calls } = createHarness({ updatePlan: changedPlan });
    assert.equal((await service.checkNow()).status, 'dependencies_changed');
    assert.equal(calls.applies.length, 0);
    assert.equal(calls.restarts, 0);
  });
});

test('reconnaît les manifests/lockfiles même dans un renommage', () => {
  assert.equal(dependencyFilesChanged(plan({ files: [{ paths: ['npm-shrinkwrap.json', 'npm-lock.json'] }] })), true);
  assert.equal(dependencyFilesChanged(plan({ files: [{ path: 'src/service.js' }] })), false);
});

test('une panne GitHub est journalisée sans faire tomber le processus', async () => {
  const { service, calls } = createHarness({ checkError: new Error('GitHub indisponible') });
  const result = await service.checkNow();
  assert.equal(result.status, 'error');
  assert.equal(calls.restarts, 0);
  assert.ok(calls.logs.some(([level]) => level === 'warn'));
});
