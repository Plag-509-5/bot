'use strict';

module.exports = {
  apps: [{
    name: 'kaido-md',
    script: 'npm',
    args: 'start',
    interpreter: 'none',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: '30s',
    max_restarts: 100,
    restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    listen_timeout: 30_000,
    // Laisser le bot vider les écritures d'auth Mongo avant un redémarrage.
    kill_timeout: 180_000,
    time: true,
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
