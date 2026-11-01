'use strict';

const axios = require('axios');
const GITHUB_USERS = 'https://api.github.com/users';

function display(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replace(/\r?\n/g, ' ').slice(0, 400);
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
function renderProfile(user) {
  const profileUrl = user.html_url || `https://github.com/${encodeURIComponent(user.login)}`;
  return [
    '🐉 *KAIDO • PROFIL GITHUB*',
    '',
    `🆔 ID : ${display(user.id)}`,
    `👤 Nom : ${display(user.name)}`,
    `🔖 Identifiant : @${display(user.login)}`,
    `📝 Bio : ${display(user.bio)}`,
    `🏢 Organisation : ${display(user.company)}`,
    `📍 Localisation : ${display(user.location)}`,
    `📧 Courriel public : ${display(user.email)}`,
    `🌐 Site : ${display(user.blog)}`,
    `📦 Dépôts publics : ${display(user.public_repos)}`,
    `🧩 Gists publics : ${display(user.public_gists)}`,
    `👥 Abonnés : ${display(user.followers)}`,
    `➡️ Abonnements : ${display(user.following)}`,
    `📅 Compte créé : ${formatDate(user.created_at)}`,
    `🔄 Profil modifié : ${formatDate(user.updated_at)}`,
    `🔗 Profil : ${profileUrl}`
  ].join('\n');
}

module.exports = {
  name: 'github',
  alias: ['ghuser'],
  category: 'tools',
  description: 'Affiche le profil public d’un compte GitHub',
  usage: '.github <identifiant>',
  async execute({ socket, msg, from, args = [], prefix = '.' }) {
    const username = args.join(' ').trim().replace(/^@/, '');
    if (!username || !/^[A-Za-z0-9-]{1,39}$/.test(username)) {
      return socket.sendMessage(from, { text: `🔍 Utilisation : ${prefix}github <identifiant>\nExemple : ${prefix}github octocat` }, { quoted: msg });
    }
    try {
      const response = await axios.get(`${GITHUB_USERS}/${encodeURIComponent(username)}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Kaido-MD' },
        timeout: 10000,
        validateStatus: status => status >= 200 && status < 500
      });
      if (response.status === 404 || !response.data?.login) {
        return socket.sendMessage(from, { text: `❌ Aucun compte GitHub public « ${username} » n’a été trouvé.` }, { quoted: msg });
      }
      if (response.status === 403) {
        return socket.sendMessage(from, { text: '⚠️ Le quota public de l’API GitHub est temporairement atteint. Réessaie dans un moment.' }, { quoted: msg });
      }
      const user = response.data;
      return socket.sendMessage(from, {
        image: { url: user.avatar_url },
        caption: renderProfile(user)
      }, { quoted: msg });
    } catch (error) {
      console.warn('[GITHUB PROFILE API]', error?.message || error);
      return socket.sendMessage(from, { text: '❌ Impossible de joindre l’API GitHub pour le moment.' }, { quoted: msg });
    }
  },
  _test: { renderProfile, formatDate, GITHUB_USERS }
};
