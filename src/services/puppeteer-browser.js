'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
let browserInstallPromise = null;

async function installBundledChrome() {
  const cliPath = path.join(path.dirname(require.resolve('puppeteer')), 'node', 'cli.js');
  await execFileAsync(process.execPath, [cliPath, 'browsers', 'install', 'chrome'], {
    timeout: 10 * 60 * 1000,
    maxBuffer: 2 * 1024 * 1024
  });
}

async function ensurePuppeteerBrowser(options = {}) {
  const puppeteer = options.puppeteer || require('puppeteer');
  const executablePath = puppeteer.executablePath();
  const exists = options.exists || fs.existsSync;
  if (exists(executablePath)) return executablePath;

  if (!browserInstallPromise) {
    const installBrowser = options.installBrowser || installBundledChrome;
    browserInstallPromise = Promise.resolve().then(installBrowser).catch(error => {
      browserInstallPromise = null;
      throw error;
    });
  }
  await browserInstallPromise;
  if (!exists(executablePath)) {
    browserInstallPromise = null;
    throw new Error('Chromium ne s’est pas installé correctement pour la conversion TGS.');
  }
  return executablePath;
}

function resetBrowserInstallState() {
  browserInstallPromise = null;
}

module.exports = { ensurePuppeteerBrowser, resetBrowserInstallState };
