'use strict';

const { createGeographyCommand } = require('../../services/geography-command');
const games = require('../../services/geography-games');

module.exports = {
  name: 'guesscapital',
  category: 'games',
  description: 'Jeu Kaido : devine la capitale du pays proposé',
  usage: '.guesscapital [réponse|stop]',
  execute: createGeographyCommand('capital'),
  _test: games
};
