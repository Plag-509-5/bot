'use strict';

const githubUpdater = require('../../services/github-updater');

const MAX_DISPLAYED_FILES = 14;
const VALID_MODES = new Set(['check', 'apply']);

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
  if (!files.length) return '  (aucun fichier modifié dans ce commit)';
  const lines = files.slice(0, MAX_DISPLAYED_FILES).map(file => {
    const filePath = String(file.path || '').replace(/[\r\n\t]+/g, ' ').slice(0, 140);
    return `  • ${file.label}: ${filePath}`;
  });
  if (files.length > MAX_DISPLAYED_FILES) {
    lines.push(`  • … et ${files.length - MAX_DISPLAYED_FILES} autre(s) fichier(s)`);
  }
  return lines.join('\n');
}

function dependencyFilesChanged(files = []) {
  const dependencyFiles = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);
  return files.some(file => String(file.path || '').split(' → ').some(filePath => dependencyFiles.has(filePath)));
}

function planSummary(plan, prefix = '.') {
  return [
    `🔎 *Mise à jour GitHub — ${plan.repository} (${plan.branch})*`,
    `Version locale : \`${plan.currentSha.slice(0, 7)}\` (${plan.currentBranch})`,
    `Dernière version : \`${plan.shortSha}\`${plan.commitSummary ? ` — ${plan.commitSummary}` : ''}`,
    `Fichiers concernés : ${plan.files.length}`,
    changedFilesText(plan.files),
    '',
    `Pour appliquer : ${prefix}update`
  ].join('\n');
}

async function executeUpdate(context, dependencies = {}) {
  const { args = [], prefix = '.', command = 'update' } = context;
  if (!canUpdate(context)) {
    return reply(context, '🚫 La mise à jour est réservée au propriétaire du bot ou de cette session.');
  }

  const mode = String(args[0] || 'apply').toLowerCase();
  if (!VALID_MODES.has(mode) || args.length > 1) {
    return reply(context, `Usage : ${prefix}${command} [check|apply]\n• check : compare sans modifier les fichiers\n• apply : applique la dernière version de la branche configurée (par défaut : main)`);
  }

  try {
    const branch = process.env.BOT_UPDATE_BRANCH || githubUpdater.DEFAULT_UPDATE_BRANCH;
    await reply(context, `⏳ Vérification de la branche GitHub *${branch}*…`);

    const check = dependencies.checkForUpdates || githubUpdater.checkForUpdates;
    const plan = await check({ branch });

    if (!plan.hasUpdate) {
      if (plan.ahead > 0) {
        return reply(context,
          `✅ Aucun commit GitHub à appliquer. La branche locale *${plan.currentBranch}* est en avance de ${plan.ahead} commit(s) sur *${plan.branch}* (${plan.shortSha}).`);
      }
      return reply(context,
        `✅ Le bot est déjà à jour sur *${plan.branch}* (commit ${plan.shortSha}).`);
    }

    if (plan.ahead > 0 || !plan.canFastForward) {
      return reply(context,
        `⚠️ La branche locale *${plan.currentBranch}* et GitHub ont divergé. Aucune modification n’a été appliquée; synchronise ou rebase le dépôt manuellement avant de relancer ${prefix}update.`);
    }

    if (mode === 'check') return reply(context, planSummary(plan, prefix));

    await reply(context,
      `🔄 ${plan.files.length} fichier(s) à mettre à jour vers ${plan.shortSha}. Application en fast-forward…`);
    const apply = dependencies.applyUpdate || githubUpdater.applyUpdate;
    const result = await apply(plan);
    const notes = [
      `✅ Mise à jour appliquée : \`${result.updatedSha.slice(0, 7)}\`.`,
      `${plan.files.length} ${plan.files.length === 1 ? 'fichier mis à jour' : 'fichiers mis à jour'}.`,
      'Redémarre le bot pour charger complètement les nouveaux fichiers.'
    ];
    if (dependencyFilesChanged(plan.files)) {
      notes.push('⚠️ `package.json` ou le lockfile a changé : exécute `npm install` avant le redémarrage.');
    }
    return reply(context, notes.join('\n'));
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
  description: 'Compare puis applique les fichiers de la dernière version GitHub',
  usage: '.update [check|apply]',
  execute: executeUpdate,
  _test: {
    canUpdate,
    getReplyJid,
    changedFilesText,
    dependencyFilesChanged,
    planSummary,
    executeUpdate,
    MAX_DISPLAYED_FILES
  }
};
