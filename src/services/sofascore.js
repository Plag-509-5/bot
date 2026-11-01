'use strict';

const axios = require('axios');
const BASE_URL = 'https://sofavpn.com/api/v1';
const HEADERS = Object.freeze({
  'User-Agent': 'com.sofascore.results/250702/110f52',
  'Accept': 'application/json',
  'Cache-Control': 'max-age=0'
});
const POSITIONS = Object.freeze({ D: 'Défenseur', M: 'Milieu de terrain', F: 'Attaquant', G: 'Gardien' });
const SEARCH_PATHS = Object.freeze({ player: 'search/all', team: 'search/teams', tournament: 'search/unique-tournaments' });

function formatDate(timestamp) {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return '—';
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
function getItems(response) {
  return Array.isArray(response?.data?.results) ? response.data.results : [];
}
function createClient(http = axios) {
  async function get(path, params) {
    const response = await http.get(`${BASE_URL}/${path}`, {
      ...(params ? { params } : {}),
      headers: HEADERS,
      timeout: 12000,
      maxContentLength: 2 * 1024 * 1024
    });
    return response?.data || {};
  }

  async function search(type, query) {
    const kind = String(type || '').toLowerCase();
    if (!SEARCH_PATHS[kind]) throw new Error('Choisis player, team ou tournament.');
    const term = String(query || '').trim();
    if (!term) throw new Error('Ajoute un nom de joueur, d’équipe ou de compétition.');
    const data = await get(SEARCH_PATHS[kind], { q: term, page: 0 });
    let results = getItems({ data });
    if (kind === 'player') results = results.filter(item => item.type === 'player');
    if (!results.length) return `🔎 Aucun résultat trouvé pour « ${term} ».`;
    const matches = results.slice(0, 3);
    const details = await Promise.all(matches.map(async item => {
      const entity = item?.entity || {};
      if (!entity.id) return null;
      if (kind === 'player') return formatPlayer(await get(`player/${encodeURIComponent(entity.id)}`), entity);
      if (kind === 'team') return formatTeam(await get(`team/${encodeURIComponent(entity.id)}`), entity);
      return formatTournament(await get(`unique-tournament/${encodeURIComponent(entity.id)}`), entity);
    }));
    const output = details.filter(Boolean).join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');
    return output ? `⚽ *KAIDO SOFA — ${kind === 'player' ? 'JOUEURS' : kind === 'team' ? 'ÉQUIPES' : 'COMPÉTITIONS'}*\n\n${output}` : `🔎 Aucun détail exploitable trouvé pour « ${term} ».`;
  }
  return { search };
}

function formatPlayer(data, fallback = {}) {
  const p = data?.player || {};
  const team = p.team || {};
  const league = team.tournament || {};
  const country = p.country || {};
  const marketValue = p.proposedMarketValueRaw?.value;
  const formattedMarket = Number.isFinite(Number(marketValue))
    ? `€${new Intl.NumberFormat('fr-FR').format(Number(marketValue))}` : '—';
  const foot = ({ Right: 'Droit', Left: 'Gauche', Both: 'Ambidextre' })[p.preferredFoot] || valueOrDash(p.preferredFoot);
  const id = p.id || fallback.id;
  return [
    `⚽ *${valueOrDash(p.name || fallback.name)}*`,
    `• Nom court : ${valueOrDash(p.shortName)}`,
    `• Poste : ${valueOrDash(p.position)}${p.position ? ` — ${POSITIONS[p.position] || 'Autre'}` : ''}`,
    `• Numéro : ${valueOrDash(p.jerseyNumber || p.shirtNumber)}`,
    `• Taille : ${p.height ? `${p.height} cm` : '—'}`,
    `• Pied fort : ${foot}`,
    `• Né(e) le : ${formatDate(p.dateOfBirthTimestamp)}`,
    `• Contrat jusqu’au : ${formatDate(p.contractUntilTimestamp)}`,
    `• Valeur estimée : ${formattedMarket}`,
    `• Équipe : ${valueOrDash(team.name)}`,
    `• Compétition : ${valueOrDash(league.name)}`,
    `• Pays : ${valueOrDash(country.name)}`,
    `• Profil : ${valueOrDash(p.slug)}`,
    `• Photo : ${id ? `${BASE_URL}/player/${encodeURIComponent(id)}/image` : '—'}`
  ].join('\n');
}

function formatTeam(data, fallback = {}) {
  const team = data?.team || {};
  const country = team.category?.country || {};
  const league = team.tournament || {};
  const manager = team.manager || {};
  const venue = team.venue || {};
  const form = data?.pregameForm || {};
  const coordinates = venue.venueCoordinates;
  const position = form.position || '—';
  return [
    `🏟️ *${valueOrDash(team.name || fallback.name)}*`,
    `• Nom court : ${valueOrDash(team.shortName)}`,
    `• Sport : ${valueOrDash(team.sport?.name)}`,
    `• Pays : ${valueOrDash(country.name)}`,
    `• Compétition : ${valueOrDash(league.name)}`,
    `• Classement : ${position}`,
    `• Forme récente : ${Array.isArray(form.form) && form.form.length ? form.form.join(' · ') : '—'}`,
    `• Entraîneur : ${valueOrDash(manager.name)}${manager.country?.name ? ` (${manager.country.name})` : ''}`,
    `• Ville du stade : ${valueOrDash(venue.city?.name)}`,
    `• Coordonnées du stade : ${coordinates ? `${coordinates.latitude}, ${coordinates.longitude}` : '—'}`,
    `• Profil : ${valueOrDash(team.slug)}`,
    `• Image : ${team.id ? `${BASE_URL}/team/${encodeURIComponent(team.id)}/image` : '—'}`
  ].join('\n');
}

function formatTournament(data, fallback = {}) {
  const tournament = data?.uniqueTournament || {};
  const holder = tournament.titleHolder || {};
  const mostTitles = (tournament.mostTitlesTeams || []).map(team => team.name).filter(Boolean).join(', ') || '—';
  return [
    `🏆 *${valueOrDash(tournament.name || fallback.name)}*`,
    `• Région : ${valueOrDash(tournament.category?.name)}`,
    `• Sport : ${valueOrDash(tournament.category?.sport?.name)}`,
    `• Champion en titre : ${valueOrDash(holder.name)}${holder.country?.name ? ` (${holder.country.name})` : ''}`,
    `• Équipes les plus titrées : ${mostTitles}`,
    `• Début : ${formatDate(tournament.startDateTimestamp)}`,
    `• Fin : ${formatDate(tournament.endDateTimestamp)}`,
    `• Identifiant : ${valueOrDash(tournament.slug)}`
  ].join('\n');
}

module.exports = { BASE_URL, HEADERS, POSITIONS, createClient, formatDate, formatPlayer, formatTeam, formatTournament };
