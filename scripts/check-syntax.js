#!/usr/bin/env node
/**
 * Vérification de syntaxe de tout le projet.
 *
 * `node --check` est lancé sur chaque fichier .js suivi par le projet, ce qui
 * évite de maintenir une liste de fichiers à jour dans package.json.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'sessions', 'tmp']);
const TARGETS = ['index.js', 'config', 'scripts', 'src', 'test'];

function collect(target, out = []) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return out;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (full.endsWith('.js')) out.push(full);
    return out;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    collect(path.join(target, entry.name), out);
  }
  return out;
}

const files = TARGETS.flatMap((t) => collect(t)).sort();
let failures = 0;

for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failures += 1;
    console.error(`✖ ${path.relative(ROOT, file)}`);
    console.error((res.stderr || '').trim());
  }
}

console.log(`\n${files.length - failures}/${files.length} fichiers OK.`);
process.exit(failures === 0 ? 0 : 1);
