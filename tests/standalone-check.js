/* Guards against corrupted inlining (e.g. "$'" in a regex being interpreted by String.replace). */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const renderer = path.join(root, 'src', 'renderer');
const scripts = [
  '../shared/schema.js', '../shared/model.js', '../shared/cs-parser.js',
  '../shared/unity-parser.js', '../shared/analysis.js', '../shared/layout.js',
  'bridge.js', 'canvas.js', 'ui.js', 'app.js'
];
const outputs = [
  path.join(root, 'UnityArchitect-standalone.html'),
  path.join(root, '..', 'Unity关系图工具V2.html')
];

let failures = 0;
outputs.forEach(function (file) {
  const tag = path.basename(file);
  if (!fs.existsSync(file)) { console.error('FAIL ' + tag + ': missing'); failures++; return; }
  const html = fs.readFileSync(file, 'utf8');
  scripts.forEach(function (rel) {
    const src = fs.readFileSync(path.join(renderer, rel), 'utf8');
    if (!html.includes('<script>\n' + src + '\n</script>')) {
      console.error('FAIL ' + tag + ': module corrupted -> ' + rel);
      failures++;
    }
  });
  const opens = (html.match(/<script>/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  if (opens !== closes || opens !== scripts.length) {
    console.error('FAIL ' + tag + ': script tags ' + opens + '/' + closes + ' expected ' + scripts.length);
    failures++;
  }
  if (/<script src=/.test(html) || /<link rel="stylesheet"/.test(html)) {
    console.error('FAIL ' + tag + ': external reference remains'); failures++;
  }
  ['showDirectoryPicker', 'data-action="rescan"', 'drop-overlay', 'UnityParser', 'onDropFiles'].forEach(function (needle) {
    if (!html.includes(needle)) { console.error('FAIL ' + tag + ': missing ' + needle); failures++; }
  });
  if (!failures) console.log('  PASS ' + tag + ' (' + Math.round(html.length / 1024) + ' KB, ' + scripts.length + ' modules)');
});

if (failures) { console.error('\nstandalone check: ' + failures + ' failure(s)'); process.exit(1); }
console.log('standalone check: all outputs verified');
