'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_UPDATE_BRANCH = 'main';
const GIT_COMMAND_TIMEOUT_MS = 90_000;
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;

function validateBranchName(value = DEFAULT_UPDATE_BRANCH) {
  const branch = String(value || DEFAULT_UPDATE_BRANCH).trim();
  if (!branch
    || !/^[A-Za-z0-9._/-]+$/.test(branch)
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('..')
    || branch.includes('//')
    || branch.endsWith('.lock')) {
    throw new Error('Nom de branche de mise à jour invalide.');
  }
  return branch;
}

function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  let repositoryPath = '';

  const sshMatch = value.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+)$/i);
  if (sshMatch) {
    repositoryPath = sshMatch[1];
  } else {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'github.com' || url.protocol !== 'https:') return null;
      repositoryPath = url.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      return null;
    }
  }

  repositoryPath = repositoryPath
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryPath)) return null;
  return repositoryPath;
}

function parseAheadBehind(output) {
  const values = String(output || '').trim().split(/\s+/).map(Number);
  if (values.length !== 2 || values.some(value => !Number.isInteger(value) || value < 0)) {
    throw new Error('Git a renvoyé une comparaison de commits invalide.');
  }
  return { ahead: values[0], behind: values[1] };
}

function parseChangedFiles(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [status = '', ...paths] = line.split('\t');
      if (!status || !paths.length) return null;
      const code = status[0];
      const label = code === 'A' ? 'AJOUT' : code === 'D' ? 'SUPPRESSION' : 'MODIF';
      const filePath = code === 'R' && paths.length > 1
        ? `${paths[0]} → ${paths[1]}`
        : paths.at(-1);
      return { status, label, path: filePath };
    })
    .filter(Boolean);
}

function redactCredentials(value) {
  return String(value || '')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[identifiants masqués]@')
    .slice(0, 700);
}

async function runGit(args, cwd, { timeout = GIT_COMMAND_TIMEOUT_MS } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true
    });
    return {
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || '')
    };
  } catch (error) {
    const stderr = redactCredentials(error?.stderr || error?.message || '');
    const command = args.slice(0, 2).join(' ');
    const wrapped = new Error(`Échec de Git (${command})${stderr ? ` : ${stderr}` : '.'}`);
    wrapped.code = error?.code;
    throw wrapped;
  }
}

async function gitOutput(run, args, cwd, options) {
  const result = await run(args, cwd, options);
  return String(result?.stdout || '').trim();
}

function listTrackedChanges(statusOutput) {
  return String(statusOutput || '')
    .split(/\r?\n/)
    .filter(Boolean);
}

async function checkForUpdates({
  cwd = path.resolve(__dirname, '../..'),
  branch = process.env.BOT_UPDATE_BRANCH || DEFAULT_UPDATE_BRANCH,
  run = runGit
} = {}) {
  const updateBranch = validateBranchName(branch);
  const root = await gitOutput(run, ['rev-parse', '--show-toplevel'], cwd);
  if (!root) throw new Error('Ce dossier ne semble pas être un dépôt Git.');

  const remoteUrl = await gitOutput(run, ['remote', 'get-url', 'origin'], root);
  const repository = parseGitHubRepository(remoteUrl);
  if (!repository) {
    throw new Error('Le remote `origin` doit pointer vers un dépôt GitHub pour utiliser .update.');
  }

  const currentBranch = await gitOutput(run, ['branch', '--show-current'], root);
  if (!currentBranch) {
    throw new Error('Le dépôt est en HEAD détachée. Place le bot sur une branche Git avant de le mettre à jour.');
  }

  const localChanges = listTrackedChanges(await gitOutput(
    run,
    ['status', '--porcelain', '--untracked-files=no'],
    root
  ));
  if (localChanges.length) {
    throw new Error(`Mise à jour annulée : ${localChanges.length} fichier(s) suivi(s) ont des changements locaux. Committe ou restaure-les d’abord.`);
  }

  const currentSha = await gitOutput(run, ['rev-parse', 'HEAD'], root);
  if (!/^[a-f0-9]{40,64}$/i.test(currentSha)) {
    throw new Error('Impossible d’identifier le commit actuellement installé.');
  }

  const targetRef = `refs/remotes/origin/${updateBranch}`;
  const refspec = `+refs/heads/${updateBranch}:${targetRef}`;
  const shallowRepository = await gitOutput(run, ['rev-parse', '--is-shallow-repository'], root);
  if (shallowRepository === 'true') {
    await run(['fetch', '--quiet', '--no-tags', '--unshallow', 'origin', refspec], root, {
      timeout: 5 * 60_000
    });
  } else {
    await run(['fetch', '--quiet', '--no-tags', 'origin', refspec], root, {
      timeout: GIT_COMMAND_TIMEOUT_MS
    });
  }

  const targetSha = await gitOutput(run, ['rev-parse', targetRef], root);
  if (!/^[a-f0-9]{40,64}$/i.test(targetSha)) {
    throw new Error(`Impossible de lire la branche GitHub ${updateBranch}.`);
  }

  let mergeBase;
  try {
    mergeBase = await gitOutput(run, ['merge-base', currentSha, targetRef], root);
  } catch {
    throw new Error('Les historiques locaux et GitHub n’ont pas de base commune. Utilise un clone Git complet du dépôt.');
  }
  if (!mergeBase) {
    throw new Error('Les historiques locaux et GitHub n’ont pas de base commune. Utilise un clone Git complet du dépôt.');
  }

  const { ahead, behind } = parseAheadBehind(await gitOutput(
    run,
    ['rev-list', '--left-right', '--count', `${currentSha}...${targetRef}`],
    root
  ));
  const files = parseChangedFiles(await gitOutput(
    run,
    ['diff', '--no-ext-diff', '--name-status', '--find-renames', `${currentSha}..${targetRef}`],
    root
  ));
  const latestCommit = await gitOutput(
    run,
    ['show', '-s', '--format=%h%x09%s', targetRef],
    root
  );
  const [shortSha = targetSha.slice(0, 7), ...summary] = latestCommit.split('\t');
  const commitSummary = summary.join('\t').replace(/[\r\n]+/g, ' ').slice(0, 140);

  return {
    repository,
    root,
    branch: updateBranch,
    currentBranch,
    currentSha,
    targetSha,
    shortSha,
    commitSummary,
    ahead,
    behind,
    files,
    hasUpdate: behind > 0,
    canFastForward: ahead === 0 && behind > 0
  };
}

async function applyUpdate(plan, { run = runGit } = {}) {
  if (!plan?.canFastForward) {
    throw new Error('Cette mise à jour ne peut pas être appliquée automatiquement en fast-forward.');
  }

  const currentSha = await gitOutput(run, ['rev-parse', 'HEAD'], plan.root);
  if (currentSha !== plan.currentSha) {
    throw new Error('Le dépôt a changé depuis la comparaison. Relance .update check avant de réessayer.');
  }

  const localChanges = listTrackedChanges(await gitOutput(
    run,
    ['status', '--porcelain', '--untracked-files=no'],
    plan.root
  ));
  if (localChanges.length) {
    throw new Error('Mise à jour annulée : des fichiers suivis ont été modifiés depuis la comparaison.');
  }

  const targetRef = `refs/remotes/origin/${plan.branch}`;
  const targetSha = await gitOutput(run, ['rev-parse', targetRef], plan.root);
  if (targetSha !== plan.targetSha) {
    throw new Error('GitHub a avancé depuis la comparaison. Relance .update check pour récupérer la nouvelle version.');
  }

  await run(['merge', '--ff-only', '--no-edit', targetRef], plan.root, {
    timeout: GIT_COMMAND_TIMEOUT_MS
  });

  const updatedSha = await gitOutput(run, ['rev-parse', 'HEAD'], plan.root);
  if (updatedSha !== plan.targetSha) {
    throw new Error('Git n’a pas confirmé le commit attendu après la mise à jour.');
  }
  return { updatedSha, files: plan.files };
}

module.exports = {
  DEFAULT_UPDATE_BRANCH,
  GIT_COMMAND_TIMEOUT_MS,
  validateBranchName,
  parseGitHubRepository,
  parseAheadBehind,
  parseChangedFiles,
  redactCredentials,
  runGit,
  checkForUpdates,
  applyUpdate
};
