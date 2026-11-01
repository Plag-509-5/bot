'use strict';

const { createWelcomeGoodbyeCommand } = require('../../services/welcome-goodbye-command');
const { updateGroupSetting } = require('../../handlers/welcome_goodbye');

module.exports = {
  name: 'welcome',
  category: 'group',
  description: 'Active et personnalise le message d’arrivée dans le groupe',
  usage: '.welcome on|off|status|set <message>|reset',
  isGroup: true,
  async execute(context) {
    return createWelcomeGoodbyeCommand(false)(context);
  },
  _test: { updateGroupSetting }
};
