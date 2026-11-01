'use strict';

const { createWelcomeGoodbyeCommand } = require('../../services/welcome-goodbye-command');

module.exports = {
  name: 'goodbye',
  category: 'group',
  description: 'Active et personnalise le message de départ du groupe',
  usage: '.goodbye on|off|status|set <message>|reset',
  isGroup: true,
  execute: createWelcomeGoodbyeCommand(true)
};
