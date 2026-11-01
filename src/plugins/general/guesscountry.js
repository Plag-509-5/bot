'use strict';

const { createGeographyCommand } = require('../../services/geography-command');
const games = require('../../services/geography-games');

module.exports = {
  name: 'guesscountry',
  category: 'games',
  description: 'Jeu Kaido : identifie le pays correspondant au drapeau',
  usage: '.guesscountry [pays|stop]',
  execute: createGeographyCommand('country'),
  _test: games
};
