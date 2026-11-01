'use strict';

const githubUpdaterDefault = require('./github-updater');
const updateSettingsDefault = require('./github-update-settings');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const START_DELAY_MS = 60 * 1000;
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.npmrc'
]);

function isEnabled(value) {
  if (typeof value === 'boolean') return value;
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

function parseInterval(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, parsed));
}

function dependencyFilesChanged(plan = {}) {
  const files = Array.isArray(plan.files) ? plan.files : [];
  return files.some(file => {
    const paths = Array.isArray(file?.paths) && file.paths.length
      ? file.paths
      : [file?.path || ''];
    return paths.some(filePath => DEPENDENCY_FILES.has(String(filePath).replace(/\\/g, '/').split('/').at(-1)));
  });
}

function createGitHubAutoUpdater(options = {}) {
  const env = options.env || process.env;
  const updater = options.updater || githubUpdaterDefault;
  const settings = options.settings || updateSettingsDefault;
  const logger = options.logger || console;
  const restart = typeof options.restart === 'function'
    ? options.restart
    : () => process.kill(process.pid, 'SIGTERM');
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const intervalMs = parseInterval(env.BOT_AUTO_UPDATE_INTERVAL_MS);
  const startDelayMs = Number.isSafeInteger(options.startDelayMs) && options.startDelayMs >= 0
    ? options.startDelayMs
    : START_DELAY_MS;

  let started = false;
  let inFlight = false;
  let initialTimer = null;
  let intervalTimer = null;

  function log(level, message) {
    const method = logger?.[level] || logger?.log;
    if (typeof method !== 'function') return;
    try { method.call(logger, `[AUTO-UPDATE] ${message}`); } catch (_) {}
  }

  async function checkNow() {
    if (inFlight) return { status: 'busy' };
    inFlight = true;
    try {
      const saved = typeof settings.getUpdateSettings === 'function'
        ? await settings.getUpdateSettings()
        : {};
      const repository = String(saved?.repository || env.BOT_UPDATE_REPO || '').trim() || undefined;
      const branch = String(saved?.branch || env.BOT_UPDATE_BRANCH || updater.DEFAULT_UPDATE_BRANCH || 'main').trim();
      const token = typeof updater.getGitHubToken === 'function'
        ? updater.getGitHubToken(env)
        : String(env.BOT_UPDATE_GITHUB_TOKEN || env.GITHUB_TOKEN || '').trim();
      const cwd = typeof updater.getDefaultRepositoryPath === 'function'
        ? updater.getDefaultRepositoryPath(env)
        : undefined;
      const plan = await updater.checkForUpdates({ cwd, repository, branch, token });

      if (!plan?.hasUpdate) return { status: 'current', plan };
      if (!plan.canFastForward || Number(plan.ahead) > 0) {
        log('warn', `mise à jour ignorée : ${plan.repository}@${plan.branch} a divergé (fast-forward impossible).`);
        return { status: 'diverged', plan };
      }
      if (Array.isArray(plan.localChanges) && plan.localChanges.length) {
        log('warn', `mise à jour ignorée : ${plan.localChanges.length} changement(s) local(aux) suivi(s) doivent être vérifiés.`);
        return { status: 'local_changes', plan };
      }
      if (typeof updater.runGit === 'function') {
        const untracked = await updater.runGit(
          ['ls-files', '--others', '--exclude-standard', '-z'],
          plan.root
        );
        if (String(untracked?.stdout || '').length) {
          log('warn', 'mise à jour ignorée : des fichiers locaux non suivis doivent être vérifiés.');
          return { status: 'local_changes', plan };
        }
      }
      if (dependencyFilesChanged(plan)) {
        log('warn', `mise à jour ${plan.shortSha || ''} ignorée : package.json ou un fichier de dépendances a changé; npm install et redémarrage manuels requis.`);
        return { status: 'dependencies_changed', plan };
      }

      const result = await updater.applyUpdate(plan);
      log('info', `mise à jour appliquée (${plan.repository}@${plan.branch}, ${String(result?.updatedSha || plan.targetSha || '').slice(0, 7)}); arrêt gracieux pour rechargement.`);
      await restart({ plan, result });
      return { status: 'updated', plan, result };
    } catch (error) {
      log('warn', `vérification échouée : ${String(error?.message || error).slice(0, 500)}`);
      return { status: 'error', error };
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (!isEnabled(env.BOT_AUTO_UPDATE_ENABLED)) return false;
    if (started) return true;
    started = true;
    log('info', `activé; première vérification dans ${Math.round(startDelayMs / 1000)} s, puis toutes les ${Math.round(intervalMs / 60_000)} min.`);
    initialTimer = setTimeoutFn(() => {
      initialTimer = null;
      void checkNow();
    }, startDelayMs);
    intervalTimer = setIntervalFn(() => { void checkNow(); }, intervalMs);
    initialTimer?.unref?.();
    intervalTimer?.unref?.();
    return true;
  }

  function stop() {
    if (initialTimer) clearTimeoutFn(initialTimer);
    if (intervalTimer) clearIntervalFn(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
    started = false;
  }

  return {
    start,
    stop,
    checkNow,
    getStatus() {
      return { enabled: isEnabled(env.BOT_AUTO_UPDATE_ENABLED), started, inFlight, intervalMs };
    }
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  START_DELAY_MS,
  DEPENDENCY_FILES,
  isEnabled,
  parseInterval,
  dependencyFilesChanged,
  createGitHubAutoUpdater
};
