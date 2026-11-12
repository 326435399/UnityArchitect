/* Syntax-check every first-party JS file without executing it. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dirs = ['src', 'electron', 'tests', 'tools'];
let checked = 0, failed = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'Assets' || entry.name === '.electron-cache') return;
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      try {
        new vm.Script(fs.readFileSync(full, 'utf8'), { filename: full });
        checked++;
      } catch (e) {
        failed++;
        console.error('SYNTAX FAIL ' + path.relative(root, full) + '\n  ' + e.message);
      }
    }
  });
}

dirs.forEach(function (d) { walk(path.join(root, d)); });
console.log('syntax check: ' + checked + ' files OK, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
