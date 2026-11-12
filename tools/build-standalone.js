/* Bundle the app into a single offline HTML file. node tools/build-standalone.js */
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

const sources = scripts.map(function (rel) {
  return { rel: rel, src: fs.readFileSync(path.join(renderer, rel), 'utf8') };
});
const css = fs.readFileSync(path.join(renderer, 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');

// Replacement values must be functions: module sources contain "$'" (e.g. the
// regex '(.+)$' in unity-parser.js), which String.replace treats as a special
// pattern and would splice the whole document into the script body.
html = html.replace('<link rel="stylesheet" href="style.css">',
  function () { return '<style>\n' + css + '\n</style>'; });
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
  function () {
    return '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src \'self\' data: blob:;">';
  });
html = html.replace(/<script src="[^"]+"><\/script>\s*/g, '');

const inline = sources.map(function (m) {
  return '<script>\n' + m.src + '\n</script>';
}).join('\n');
html = html.replace('</body>', function () { return inline + '\n</body>'; });

// Byte-for-byte verification of every inlined module.
sources.forEach(function (m) {
  if (!html.includes('<script>\n' + m.src + '\n</script>')) {
    console.error('Bundled module corrupted: ' + m.rel);
    process.exit(1);
  }
});
if (/<script src=/.test(html) || /<link rel="stylesheet"/.test(html)) {
  console.error('Standalone build still has external references');
  process.exit(1);
}

const out = path.join(root, 'UnityArchitect-standalone.html');
const deliver = path.join(root, '..', 'Unity关系图工具V2.html');
fs.writeFileSync(out, html, 'utf8');
fs.writeFileSync(deliver, html, 'utf8');
console.log('Standalone ready: ' + deliver + ' (' + Math.round(html.length / 1024) + ' KB, ' +
  scripts.length + ' modules inlined and verified)');
