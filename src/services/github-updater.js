'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_UPDATE_BRANCH = 'main';
const GIT_COMMAND_TIMEOUT_MS = 90_000;
const GITHUB_API_TIMEOUT_MS = 15_000;
const GITHUB_API_PAGE_SIZE = 100;
const GITHUB_API_MAX_PAGES = 10;
const GITHUB_API_BASE_URL = 'https://api.github.com';
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

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return value;

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

function validateGitHubRepository(value) {
  const repository = parseGitHubRepository(value);
  if (!repository || repository.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Dépôt GitHub invalide. Format attendu : propriétaire/dépôt.');
  }
  return repository;
}

function getGitHubToken(env = process.env) {
  return String(env.BOT_UPDATE_GITHUB_TOKEN || env.GITHUB_TOKEN || '').trim();
}

function getGitAuthEnvironment(token, baseEnv = process.env) {
  if (!token) return undefined;
  const env = { ...baseEnv };
  const parsedCount = Number(env.GIT_CONFIG_COUNT || 0);
  const count = Number.isInteger(parsedCount) && parsedCount >= 0 ? parsedCount : 0;
  env.GIT_CONFIG_COUNT = String(count + 1);
  env[`GIT_CONFIG_KEY_${count}`] = 'http.https://github.com/.extraheader';
  env[`GIT_CONFIG_VALUE_${count}`] = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return env;
}

function redactApiMessage(value, token) {
  let message = String(value || 'réponse inconnue');
  if (token) message = message.split(token).join('[token masqué]');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

async function githubApiRequest(url, { token = getGitHubToken(), fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch HTTP indisponible pour interroger GitHub.');
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Kaido-MD-GitHub-Updater',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(`Connexion à l’API GitHub impossible : ${redactApiMessage(error?.message, token)}`);
  }

  let payload;
  try { payload = await response.json(); }
  catch { payload = null; }
  if (!response.ok) {
    const detail = redactApiMessage(payload?.message || response.statusText || 'requête refusée', token);
    throw new Error(`API GitHub (${response.status}) : ${detail}`);
  }
  return payload;
}

function apiRepositoryPath(repository, suffix = '') {
  const [owner, name] = validateGitHubRepository(repository).split('/');
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

async function getGitHubRepositoryInfo({ repository, token = getGitHubToken(), fetchImpl } = {}) {
  const payload = await githubApiRequest(
    `${GITHUB_API_BASE_URL}${apiRepositoryPath(repository)}`,
    { token, fetchImpl }
  );
  return {
    fullName: String(payload?.full_name || repository),
    private: Boolean(payload?.private),
    defaultBranch: String(payload?.default_branch || DEFAULT_UPDATE_BRANCH),
    archived: Boolean(payload?.archived),
    htmlUrl: String(payload?.html_url || '')
  };
}

async function listGitHubRepositories({ token = getGitHubToken(), fetchImpl } = {}) {
  if (!token) {
    throw new Error('Configure BOT_UPDATE_GITHUB_TOKEN dans .env pour lister les dépôts autorisés.');
  }
  const repositories = [];
  for (let page = 1; page <= GITHUB_API_MAX_PAGES; page += 1) {
    const url = new URL('/user/repos', GITHUB_API_BASE_URL);
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('per_page', String(GITHUB_API_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const payload = await githubApiRequest(url.toString(), { token, fetchImpl });
    if (!Array.isArray(payload)) throw new Error('GitHub a renvoyé une liste de dépôts invalide.');
    repositories.push(...payload.map(repository => ({
      fullName: String(repository.full_name || ''),
      private: Boolean(repository.private),
      defaultBranch: String(repository.default_branch || DEFAULT_UPDATE_BRANCH),
      archived: Boolean(repository.archived),
      description: String(repository.description || '')
    })).filter(repository => repository.fullName));
    if (payload.length < GITHUB_API_PAGE_SIZE) break;
  }
  return repositories;
}

async function listGitHubBranches({ repository, token = getGitHubToken(), fetchImpl } = {}) {
  const branches = [];
  for (let page = 1; page <= GITHUB_API_MAX_PAGES; page += 1) {
    const url = new URL(`${apiRepositoryPath(repository, '/branches')}`, GITHUB_API_BASE_URL);
    url.searchParams.set('per_page', String(GITHUB_API_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const payload = await githubApiRequest(url.toString(), { token, fetchImpl });
    if (!Array.isArray(payload)) throw new Error('GitHub a renvoyé une liste de branches invalide.');
    branches.push(...payload.map(branch => String(branch?.name || '')).filter(Boolean));
    if (payload.length < GITHUB_API_PAGE_SIZE) break;
  }
  return [...new Set(branches)];
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

async function runGit(args, cwd, { timeout = GIT_COMMAND_TIMEOUT_MS, token } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      env: getGitAuthEnvironment(token)
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

async function getOriginRepository({
  cwd = path.resolve(__dirname, '../..'),
  run = runGit
} = {}) {
  const root = await gitOutput(run, ['rev-parse', '--show-toplevel'], cwd);
  if (!root) throw new Error('Ce dossier ne semble pas être un dépôt Git.');
  const remoteUrl = await gitOutput(run, ['remote', 'get-url', 'origin'], root);
  const repository = parseGitHubRepository(remoteUrl);
  if (!repository) {
    throw new Error('Le remote `origin` doit pointer vers un dépôt GitHub pour utiliser .update.');
  }
  return { root, repository, remoteUrl };
}

function makeUpdateTargetRef(repository, branch, originRepository) {
  const updateBranch = validateBranchName(branch);
  const targetRepository = validateGitHubRepository(repository);
  return targetRepository.toLowerCase() === String(originRepository || '').toLowerCase()
    ? `refs/remotes/origin/${updateBranch}`
    : `refs/remotes/bot-update/${targetRepository}/${updateBranch}`;
}

function listTrackedChanges(statusOutput) {
  return String(statusOutput || '')
    .split(/\r?\n/)
    .filter(Boolean);
}

async function checkForUpdates({
  cwd = path.resolve(__dirname, '../..'),
  branch = process.env.BOT_UPDATE_BRANCH || DEFAULT_UPDATE_BRANCH,
  repository,
  token = getGitHubToken(),
  run = runGit
} = {}) {
  const updateBranch = validateBranchName(branch);
  const origin = await getOriginRepository({ cwd, run });
  const root = origin.root;
  const originRepository = origin.repository;
  const targetRepository = repository
    ? validateGitHubRepository(repository)
    : originRepository;

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

  const targetRef = makeUpdateTargetRef(targetRepository, updateBranch, originRepository);
  const refspec = `+refs/heads/${updateBranch}:${targetRef}`;
  const sameAsOrigin = targetRepository.toLowerCase() === originRepository.toLowerCase();
  const source = sameAsOrigin ? 'origin' : `https://github.com/${targetRepository}.git`;
  const shallowRepository = await gitOutput(run, ['rev-parse', '--is-shallow-repository'], root);
  if (shallowRepository === 'true') {
    await run(['fetch', '--quiet', '--no-tags', '--unshallow', source, refspec], root, {
      timeout: 5 * 60_000,
      token
    });
  } else {
    await run(['fetch', '--quiet', '--no-tags', source, refspec], root, {
      timeout: GIT_COMMAND_TIMEOUT_MS,
      token
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
    repository: targetRepository,
    originRepository,
    targetRef,
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

  const targetRef = plan.targetRef || `refs/remotes/origin/${validateBranchName(plan.branch)}`;
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
  GITHUB_API_TIMEOUT_MS,
  GITHUB_API_PAGE_SIZE,
  GITHUB_API_MAX_PAGES,
  GITHUB_API_BASE_URL,
  validateBranchName,
  parseGitHubRepository,
  validateGitHubRepository,
  getGitHubToken,
  getGitAuthEnvironment,
  githubApiRequest,
  getGitHubRepositoryInfo,
  listGitHubRepositories,
  listGitHubBranches,
  getOriginRepository,
  makeUpdateTargetRef,
  parseAheadBehind,
  parseChangedFiles,
  redactCredentials,
  runGit,
  checkForUpdates,
  applyUpdate
};
