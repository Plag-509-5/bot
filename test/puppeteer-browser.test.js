'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ensurePuppeteerBrowser, resetBrowserInstallState } = require('../src/services/puppeteer-browser');

test('réutilise un navigateur système déjà présent sans déclencher de téléchargement', async () => {
  resetBrowserInstallState();
  let installs = 0;
  const executable = await ensurePuppeteerBrowser({
    puppeteer: { executablePath: () => '/usr/bin/chromium' },
    exists: () => true,
    async installBrowser() { installs += 1; }
  });
  assert.equal(executable, '/usr/bin/chromium');
  assert.equal(installs, 0);
});

test('télécharge Chromium à la première demande TGS et mutualise les appels simultanés', async () => {
  resetBrowserInstallState();
  let installed = false;
  let installs = 0;
  const options = {
    puppeteer: { executablePath: () => '/cache/chrome' },
    exists: () => installed,
    async installBrowser() {
      installs += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      installed = true;
    }
  };
  const paths = await Promise.all([
    ensurePuppeteerBrowser(options),
    ensurePuppeteerBrowser(options)
  ]);
  assert.deepEqual(paths, ['/cache/chrome', '/cache/chrome']);
  assert.equal(installs, 1);
  resetBrowserInstallState();
});

test('le script de déploiement exige FFmpeg, installe avec npm ci et applique le patch Baileys', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-dependencies.sh'), 'utf8');
  assert.match(script, /command -v ffmpeg/);
  assert.match(script, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(script, /patch-baileys-group-status-media\.js/);
  assert.doesNotMatch(script, /strict-ssl\s*=\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/);
});

test('le lock utilise le paquet libsignal publié à la révision officielle et évite l’ancien traducteur inutilisé', () => {
  const packageJson = require('../package.json');
  const lock = require('../package-lock.json');
  assert.equal(packageJson.overrides.libsignal, '6.0.0');
  assert.equal(lock.packages['node_modules/libsignal'].resolved, 'https://registry.npmjs.org/libsignal/-/libsignal-6.0.0.tgz');
  assert.equal(lock.packages['node_modules/libsignal'].version, '6.0.0');
  assert.equal(packageJson.dependencies['google-translate-api'], undefined);
  assert.equal(require('../.puppeteerrc.cjs').skipDownload, true);
});
