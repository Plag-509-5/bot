'use strict';

const githubUpdater = require('../../services/github-updater');
const updateSettings = require('../../services/github-update-settings');

const MAX_DISPLAYED_FILES = 14;
const MAX_DISPLAYED_BRANCHES = 18;
const MAX_DISPLAYED_REPOSITORIES = 20;
const VALID_MODES = new Set(['check', 'apply']);
const USAGE = [
  '.update check — compare la mise à jour et affiche les branches GitHub',
  '.update apply — remplace uniquement les fichiers touchés par GitHub',
  '.update repos — liste les dépôts accessibles avec le token GitHub',
  '.update repo <owner/repo> — sélectionne un dépôt',
  '.update branches — liste les branches du dépôt sélectionné',
  '.update branch <branche> — sélectionne une branche',
  '.update status — affiche la sélection active',
  '.update reset — efface la sélection enregistrée dans MongoDB'
].join('\n');

function usageText(prefix = '.', command = 'update') {
  return USAGE.replaceAll('.update', `${prefix}${command}`);
}

function canUpdate(context = {}) {
  return Boolean(context.isOwner || context.isSessionOwner);
}

function getReplyJid({ from, msg, sender }) {
  if (!String(from || '').endsWith('@g.us')) return from;
  const participant = msg?.key?.participantAlt || msg?.key?.participant || sender;
  return participant && !String(participant).endsWith('@g.us') ? participant : null;
}

async function reply(context, text) {
  const target = getReplyJid(context);
  if (!target) return null;
  const options = target === context.from && context.msg ? { quoted: context.msg } : undefined;
  return context.socket.sendMessage(target, { text }, options);
}

function changedFilesText(files = []) {
  if (!files.length) return '  (aucun fichier à mettre à jour)';
  const lines = files.slice(0, MAX_DISPLAYED_FILES).map(file => {
    const filePath = String(file.path || '').replace(/[\r\n\t]+/g, ' ').slice(0, 140);
    return `  • ${file.label}: ${filePath}`;
  });
  if (files.length > MAX_DISPLAYED_FILES) {
    lines.push(`  • … et ${files.length - MAX_DISPLAYED_FILES} autre(s) fichier(s)`);
  }
  return lines.join('\n');
}

function filePaths(file = {}) {
  if (Array.isArray(file.paths) && file.paths.length) return file.paths;
  return String(file.path || '').split(' → ').filter(Boolean);
}

function dependencyFilesChanged(files = []) {
  const dependencyFiles = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);
  return files.some(file => filePaths(file).some(filePath => dependencyFiles.has(filePath)));
}

function localChangeSummary(plan = {}) {
  const localFiles = new Set((plan.localChanges || []).flatMap(change => (
    Array.isArray(change.paths) && change.paths.length ? change.paths : [change.path]
  )).filter(Boolean));
  if (!localFiles.size) return '';
  const githubFiles = new Set((plan.files || []).flatMap(filePaths));
  const overwritten = [...localFiles].filter(filePath => githubFiles.has(filePath)).length;
  const preserved = localFiles.size - overwritten;
  return `⚠️ Changements locaux suivis : ${localFiles.size}; ${overwritten} fichier(s) également modifié(s) par GitHub seront remplacés et ${preserved} autre(s) conservé(s).`;
}

function branchListText(branches = [], selectedBranch = '', error = '', limit = MAX_DISPLAYED_BRANCHES) {
  if (error) return `Branches GitHub indisponibles : ${String(error).slice(0, 220)}`;
  if (!branches.length) return 'Branches GitHub : aucune branche trouvée.';
  const shown = branches.slice(0, limit).map(name => (
    `  • ${name}${name === selectedBranch ? '  ← sélectionnée' : ''}`
  ));
  if (branches.length > limit) shown.push(`  • … et ${branches.length - limit} autre(s)`);
  return `Branches GitHub (${branches.length}) :\n${shown.join('\n')}`;
}

function planSummary(plan, prefix = '.', branches = [], branchError = '') {
  const localSummary = localChangeSummary(plan);
  const lines = [
    `🔎 *Mise à jour GitHub — ${plan.repository} (${plan.branch})*`,
    `Version locale : \`${plan.currentSha.slice(0, 7)}\` (${plan.currentBranch})`,
    `Dernière version : \`${plan.shortSha}\`${plan.commitSummary ? ` — ${plan.commitSummary}` : ''}`,
    `Fichiers concernés : ${plan.files.length}`,
    changedFilesText(plan.files)
  ];
  if (localSummary) lines.push(localSummary);
  lines.push(
    '',
    branchListText(branches, plan.branch, branchError),
    '',
    'Seuls les fichiers listés seront remplacés; les autres fichiers et fichiers non suivis restent intacts.',
    `Pour appliquer : ${prefix}update apply`
  );
  return lines.join('\n');
}

function dependencyNames(dependencies = {}) {
  return {
    getSettings: dependencies.getSettings || updateSettings.getUpdateSettings,
    setSettings: dependencies.setSettings || updateSettings.setUpdateSettings,
    clearSettings: dependencies.clearSettings || updateSettings.clearUpdateSettings,
    getOriginRepository: dependencies.getOriginRepository || githubUpdater.getOriginRepository,
    getRepositoryInfo: dependencies.getRepositoryInfo || githubUpdater.getGitHubRepositoryInfo,
    listRepositories: dependencies.listRepositories || githubUpdater.listGitHubRepositories,
    listBranches: dependencies.listBranches || githubUpdater.listGitHubBranches,
    checkForUpdates: dependencies.checkForUpdates || githubUpdater.checkForUpdates,
    applyUpdate: dependencies.applyUpdate || githubUpdater.applyUpdate,
    getToken: dependencies.getToken || githubUpdater.getGitHubToken
  };
}

async function resolveSelection(saved = {}, dependencies = {}) {
  const services = dependencyNames(dependencies);
  const repository = String(saved.repository || process.env.BOT_UPDATE_REPO || githubUpdater.DEFAULT_UPDATE_REPOSITORY).trim();
  const branch = String(saved.branch || process.env.BOT_UPDATE_BRANCH || githubUpdater.DEFAULT_UPDATE_BRANCH).trim();
  const selectedRepository = repository || (await services.getOriginRepository()).repository;
  return {
    repository: githubUpdater.validateGitHubRepository(selectedRepository),
    branch: githubUpdater.validateBranchName(branch)
  };
}

async function getCurrentSettings(dependencies = {}) {
  return dependencyNames(dependencies).getSettings();
}

async function listRepositories(context, dependencies = {}) {
  const services = dependencyNames(dependencies);
  const token = services.getToken();
  if (!token) {
    return reply(context,
      '🔐 Ajoute un token GitHub dans BOT_UPDATE_GITHUB_TOKEN (.env) pour lister tes dépôts privés et publics. Ne l’envoie pas dans WhatsApp.');
  }

  const repositories = await services.listRepositories({ token });
  if (!repositories.length) return reply(context, '📭 Aucun dépôt accessible avec ce token GitHub.');
  const lines = repositories.slice(0, MAX_DISPLAYED_REPOSITORIES).map(repository => (
    `  • ${repository.fullName} (${repository.private ? 'privé' : 'public'}, branche par défaut : ${repository.defaultBranch})`
  ));
  if (repositories.length > MAX_DISPLAYED_REPOSITORIES) {
    lines.push(`  • … et ${repositories.length - MAX_DISPLAYED_REPOSITORIES} autre(s) dépôt(s)`);
  }
  return reply(context,
    `📚 *Dépôts GitHub accessibles (${repositories.length})*\n${lines.join('\n')}\n\n` +
    `Sélection : ${context.prefix || '.'}update repo <owner/repo>`);
}

async function selectRepository(context, args, dependencies = {}) {
  const { prefix = '.' } = context;
  if (args.length === 1) {
    const saved = await getCurrentSettings(dependencies);
    const selection = await resolveSelection(saved, dependencies);
    return reply(context,
      `Dépôt actif : *${selection.repository}*\nUsage : ${prefix}update repo <owner/repo>\n` +
      `Liste les dépôts accessibles avec ${prefix}update repos.`);
  }
  if (args.length !== 2) return reply(context, `Usage : ${prefix}update repo <owner/repo>`);

  const services = dependencyNames(dependencies);
  const repository = githubUpdater.validateGitHubRepository(args[1]);
  await reply(context, `⏳ Vérification de l’accès à *${repository}* auprès de GitHub…`);
  const info = await services.getRepositoryInfo({ repository, token: services.getToken() });
  if (info.archived) throw new Error('Ce dépôt GitHub est archivé; sélection impossible.');
  const branches = await services.listBranches({ repository: info.fullName || repository, token: services.getToken() });
  if (!branches.length) throw new Error('Ce dépôt GitHub ne contient aucune branche sélectionnable.');
  const branch = branches.includes(info.defaultBranch)
    ? info.defaultBranch
    : (branches[0] || info.defaultBranch);
  await services.setSettings({ repository: info.fullName || repository, branch });
  return reply(context,
    `✅ Dépôt sélectionné : *${info.fullName || repository}*\n` +
    `Branche initiale : *${branch}*\nUtilise ${prefix}update branches puis ${prefix}update branch <branche> pour la changer.`);
}

async function listBranches(context, dependencies = {}) {
  const services = dependencyNames(dependencies);
  const saved = await services.getSettings();
  const selection = await resolveSelection(saved, dependencies);
  const branches = await services.listBranches({
    repository: selection.repository,
    token: services.getToken()
  });
  return reply(context,
    `🌿 *Branches de ${selection.repository}*\n${branchListText(branches, selection.branch, '', 35)}\n\n` +
    `Sélection : ${(context.prefix || '.')}update branch <branche>`);
}

async function selectBranch(context, args, dependencies = {}) {
  const { prefix = '.' } = context;
  if (args.length < 2) {
    return reply(context, `Usage : ${prefix}update branch <branche>\nVoir les choix avec ${prefix}update branches.`);
  }
  const services = dependencyNames(dependencies);
  const saved = await services.getSettings();
  const selection = await resolveSelection(saved, dependencies);
  const branch = githubUpdater.validateBranchName(args.slice(1).join(' '));
  const branches = await services.listBranches({
    repository: selection.repository,
    token: services.getToken()
  });
  if (!branches.includes(branch)) {
    return reply(context,
      `❌ Branche *${branch}* introuvable dans *${selection.repository}*.\n` +
      branchListText(branches, selection.branch, '', 25));
  }
  await services.setSettings({ branch });
  return reply(context, `✅ Branche de mise à jour sélectionnée : *${selection.repository}@${branch}*.`);
}

async function showSelection(context, dependencies = {}) {
  const saved = await getCurrentSettings(dependencies);
  const selection = await resolveSelection(saved, dependencies);
  const tokenConfigured = Boolean(dependencyNames(dependencies).getToken());
  return reply(context,
    `⚙️ *Source de mise à jour*\nDépôt : *${selection.repository}*\nBranche : *${selection.branch}*\n` +
    `Token GitHub : ${tokenConfigured ? 'configuré' : 'absent (dépôts publics seulement)'}`);
}

async function checkOrApply(context, mode, dependencies = {}) {
  const { prefix = '.' } = context;
  const services = dependencyNames(dependencies);
  const saved = await services.getSettings();
  const selection = await resolveSelection(saved, dependencies);
  const token = services.getToken();
  await reply(context,
    `⏳ Vérification de *${selection.repository}@${selection.branch}* sur GitHub…`);

  let branches = [];
  let branchError = '';
  try {
    branches = await services.listBranches({ repository: selection.repository, token });
  } catch (error) {
    branchError = error?.message || String(error);
  }

  const plan = await services.checkForUpdates({
    repository: selection.repository,
    branch: selection.branch,
    token,
    bootstrapIfMissing: mode === 'apply'
  });
  const branchInfo = branchListText(branches, selection.branch, branchError);

  if (plan.bootstrapped) {
    return reply(context,
      `✅ Déploiement sans métadonnées Git détecté : le fichier .git a été créé et les fichiers suivis ont été synchronisés depuis *${plan.repository}@${plan.branch}* (${plan.shortSha}). ` +
      'Les fichiers non suivis, dont .env, ont été conservés. Redémarre le bot pour charger cette version.');
  }

  if (!plan.hasUpdate) {
    if (plan.ahead > 0) {
      return reply(context,
        `✅ Aucun commit GitHub à appliquer. La branche locale *${plan.currentBranch}* est en avance de ${plan.ahead} commit(s) sur *${plan.repository}@${plan.branch}* (${plan.shortSha}).\n\n${branchInfo}`);
    }
    return reply(context,
      `✅ Le bot est déjà à jour sur *${plan.repository}@${plan.branch}* (commit ${plan.shortSha}).\n\n${branchInfo}`);
  }

  if (plan.ahead > 0 || !plan.canFastForward) {
    return reply(context,
      `⚠️ La branche locale *${plan.currentBranch}* et *${plan.repository}@${plan.branch}* ont divergé. ` +
      `Aucune modification n’a été appliquée; seul un fast-forward est autorisé.\n\n${branchInfo}`);
  }

  if (mode === 'check') return reply(context, planSummary(plan, prefix, branches, branchError));

  const localSummary = localChangeSummary(plan);
  const applyingMessage = [
    `🔄 ${plan.files.length} fichier(s) touché(s) par GitHub vers ${plan.shortSha}. Seuls ces fichiers seront remplacés; les autres restent intacts.`,
    localSummary
  ].filter(Boolean).join('\n');
  await reply(context, applyingMessage);
  const result = await services.applyUpdate(plan);
  const appliedFiles = Array.isArray(result.files) ? result.files : plan.files;
  const notes = [
    `✅ Mise à jour appliquée depuis *${plan.repository}@${plan.branch}* : \`${result.updatedSha.slice(0, 7)}\`.`,
    `${appliedFiles.length} ${appliedFiles.length === 1 ? 'fichier mis à jour' : 'fichiers mis à jour'}.`
  ];
  if (result.overwrittenLocalFiles?.length) {
    notes.push(`⚠️ Changements locaux remplacés sur ${result.overwrittenLocalFiles.length} fichier(s) du diff GitHub.`);
  }
  if (result.preservedLocalFiles?.length) {
    notes.push(`✅ Changements locaux conservés hors du diff : ${result.preservedLocalFiles.length} fichier(s).`);
  }
  notes.push('Redémarre le bot pour charger complètement les nouveaux fichiers.');
  if (dependencyFilesChanged(appliedFiles)) {
    notes.push('⚠️ `package.json` ou le lockfile a changé : exécute `npm install` avant le redémarrage.');
  }
  return reply(context, notes.join('\n'));
}

async function executeUpdate(context, dependencies = {}) {
  const { args = [], prefix = '.', command = 'update' } = context;
  if (!canUpdate(context)) {
    return reply(context, '🚫 La mise à jour est réservée au propriétaire du bot ou de cette session.');
  }

  const action = String(args[0] || 'apply').toLowerCase();
  try {
    if (['repos', 'repositories'].includes(action)) {
      if (args.length !== 1) return reply(context, `Usage : ${prefix}${command} repos`);
      return await listRepositories(context, dependencies);
    }
    if (action === 'repo') return await selectRepository(context, args, dependencies);
    if (['branches', 'branch-list'].includes(action)) {
      if (args.length !== 1) return reply(context, `Usage : ${prefix}${command} branches`);
      return await listBranches(context, dependencies);
    }
    if (action === 'branch') return await selectBranch(context, args, dependencies);
    if (action === 'status') return await showSelection(context, dependencies);
    if (action === 'reset') {
      if (args.length !== 1) return reply(context, `Usage : ${prefix}${command} reset`);
      await dependencyNames(dependencies).clearSettings();
      return reply(context, '✅ Sélection enregistrée effacée. Les valeurs BOT_UPDATE_REPO et BOT_UPDATE_BRANCH de .env (ou le remote origin) seront utilisées.');
    }
    if (!VALID_MODES.has(action) || args.length > 1) {
      return reply(context, `Usage :\n${usageText(prefix, command)}`);
    }
    return await checkOrApply(context, action, dependencies);
  } catch (error) {
    console.error('[UPDATE ERROR]', error?.message || error);
    return reply(context,
      `❌ Mise à jour impossible : ${String(error?.message || error).slice(0, 700)}`);
  }
}

module.exports = {
  name: 'update',
  alias: ['updatebot'],
  category: 'owner',
  description: 'Sélectionne un dépôt/branche GitHub et applique les mises à jour en fast-forward',
  usage: '.update [check|apply|repos|repo|branches|branch|status|reset]',
  execute: executeUpdate,
  _test: {
    canUpdate,
    getReplyJid,
    usageText,
    changedFilesText,
    dependencyFilesChanged,
    branchListText,
    planSummary,
    resolveSelection,
    listRepositories,
    selectRepository,
    listBranches,
    selectBranch,
    showSelection,
    checkOrApply,
    executeUpdate,
    MAX_DISPLAYED_FILES,
    MAX_DISPLAYED_BRANCHES,
    MAX_DISPLAYED_REPOSITORIES
  }
};
