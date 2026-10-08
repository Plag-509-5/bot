'use strict';

// Inventaire syntaxique (AST), sans charger pair.js ni contacter Mongo/WhatsApp.
// L'existence d'une API n'est pas une validation fonctionnelle de la commande.
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const BAILEYS = '@whiskeysockets/baileys';
const SOCKET_NAMES = new Set(['socket', 'sock', 'conn', 'botSocket']);

function jsFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? jsFiles(full) : entry.name.endsWith('.js') ? [full] : [];
  }).sort();
}

function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, [...ancestors, node]));
    else if (value && typeof value === 'object') walk(value, visit, [...ancestors, node]);
  }
}

function isBaileysRequire(node) {
  return node?.type === 'CallExpression'
    && node.callee?.name === 'require'
    && node.arguments[0]?.value === BAILEYS;
}

function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  return node.computed && typeof node.property.value === 'string' ? node.property.value : null;
}

function auditBaileysSurface(root = ROOT) {
  const exports = new Map();
  const methods = new Map();
  const assignedMethods = new Set();
  const legacyCommands = new Set();
  const files = [path.join(root, 'index.js'), ...jsFiles(path.join(root, 'src'))];
  const record = (map, name, file, line) => {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(`${path.relative(root, file)}:${line}`);
  };

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    const namespaces = new Set();
    walk(ast, node => {
      if (node.type === 'VariableDeclarator' && isBaileysRequire(node.init)) {
        if (node.id.type === 'Identifier') namespaces.add(node.id.name);
        else if (node.id.type === 'ObjectPattern') {
          for (const property of node.id.properties) {
            const name = property.key?.name || property.key?.value;
            if (name) record(exports, name, file, node.loc.start.line);
          }
        }
      }
    });
    walk(ast, (node, ancestors) => {
      if (node.type === 'MemberExpression') {
        const name = memberName(node);
        if (name && (isBaileysRequire(node.object) || namespaces.has(node.object?.name))) {
          record(exports, name, file, node.loc.start.line);
        }
      }
      if (node.type === 'CallExpression') {
        const name = memberName(node.callee);
        if (name && SOCKET_NAMES.has(node.callee.object?.name)) {
          record(methods, name, file, node.loc.start.line);
        }
      }
      if (node.type === 'AssignmentExpression' && SOCKET_NAMES.has(node.left?.object?.name)) {
        const name = memberName(node.left);
        if (name) assignedMethods.add(name);
      }
      if (node.type === 'SwitchStatement' && node.discriminant?.name === 'command'
        && ancestors.some(parent => parent.type === 'FunctionDeclaration' && parent.id?.name === 'setupCommandHandlers')) {
        // Seulement les case DIRECTS du switch principal, pas ceux de .config.
        for (const entry of node.cases) {
          if (typeof entry.test?.value === 'string') legacyCommands.add(entry.test.value.toLowerCase());
        }
      }
    });
  }
  return { exports, methods, assignedMethods, legacyCommands, files };
}

module.exports = { auditBaileysSurface, jsFiles };
