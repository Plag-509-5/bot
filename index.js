require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { createDashboardAuth } = require('./src/services/dashboard-auth');

const app = express();
const PORT = process.env.PORT || 3000;
const dashboardDir = path.join(__dirname, 'dashboard', 'static');
const dashboardAuth = createDashboardAuth({
  // Aucun mot de passe par défaut volontairement : ADMIN_PASS doit venir de .env.
  getPassword: () => process.env.ADMIN_PASS || ''
});

require('events').EventEmitter.defaultMaxListeners = 500;
app.set('trust proxy', 1);

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (String(req.path || '').startsWith('/dashboard')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  next();
});

// Ressources partagées des pages publiques (pairing, accueil). Servies AVANT le
// garde d'authentification : ces pages sont publiques, leurs scripts aussi.
const assetsDir = path.join(__dirname, 'dashboard', 'assets');
app.use('/assets', express.static(assetsDir, { maxAge: '1h' }));

// Connexion dashboard : mot de passe uniquement, sans nom d'utilisateur.
app.get('/dashboard/login', (req, res) => {
  if (dashboardAuth.isAuthenticated(req)) return res.redirect('/dashboard');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(dashboardDir, 'login.html'));
});
app.post('/dashboard/login', dashboardAuth.login);
app.get('/dashboard/logout', dashboardAuth.logout);

// Protéger les pages ET les API de gestion avant de servir le moindre fichier.
app.use(dashboardAuth.protectDashboardRequests);
app.use('/dashboard', express.static(dashboardDir, { index: 'index.html' }));

// Router principal (Pairing + Dashboard API + WhatsApp Socket Management)
const pairRouter = require('./src/core/pair');
app.use('/', pairRouter);

// Gestion des rejets de promesses non gérés
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ Unhandled Promise Rejection:', reason);
});

// Lancement du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════╗
║     KAIDO-MD Dashboard Server      ║
╠════════════════════════════════════╣
║  Serveur actif sur :               ║
║  http://localhost:${PORT}                ║
║                                    ║
║  Tableau de bord sécurisé :        ║
║  http://localhost:${PORT}/dashboard     ║
║  http://localhost:${PORT}/pair
╚════════════════════════════════════╝
`);
});

module.exports = app;
