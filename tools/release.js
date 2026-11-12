/* 一键打包：语法检查 → 测试 → 网页版 HTML → 便携版 exe → 分发 zip。 node tools/release.js */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const started = Date.now();

function run(label, args) {
  process.stdout.write('\n=== ' + label + ' ===\n');
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\n[失败] ' + label + '（退出码 ' + r.status + '）');
    process.exit(r.status || 1);
  }
}

run('1/6 语法检查', ['tests/syntax-check.js']);
run('2/6 单元测试', ['tests/run-tests.js']);
run('3/6 浏览器扫描测试', ['tests/browser-scan-test.js']);
run('4/6 生成网页版（单文件 HTML）', ['tools/build-standalone.js']);
run('5/6 校验网页版产物', ['tests/standalone-check.js']);
run('6/6 打包便携版 exe', ['tools/pack-portable.js']);

const dist = path.join(root, 'dist', 'UnityArchitect-win32-x64');
if (!fs.existsSync(path.join(dist, 'UnityArchitect.exe'))) {
  console.error('[失败] 未找到打包产物：' + dist);
  process.exit(1);
}

const html = path.join(root, '..', 'Unity关系图工具V2.html');
const zipPath = path.join(root, '..', 'UnityArchitect-' + pkg.version + '-win64.zip');

process.stdout.write('\n=== 压缩分发包 ===\n');
if (process.platform === 'win32') {
  const zip = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Compress-Archive -Path "' + dist + '\\*" -DestinationPath "' + zipPath + '" -Force'],
    { stdio: 'inherit' });
  if (zip.status !== 0) console.warn('[警告] 自动压缩失败，请手动压缩 dist/UnityArchitect-win32-x64');
} else {
  console.warn('[提示] 非 Windows 环境，跳过 zip；请手动压缩 dist/UnityArchitect-win32-x64');
}

function sizeOf(p) {
  try { return Math.round(fs.statSync(p).size / 1024) + ' KB'; } catch (e) { return '未生成'; }
}

console.log('\n=== 打包完成（v' + pkg.version + '，用时 ' + Math.round((Date.now() - started) / 1000) + ' 秒）===');
console.log('网页版单文件 : ' + path.resolve(html) + '  (' + sizeOf(html) + ')');
console.log('便携版 exe   : ' + path.resolve(dist) + '\\UnityArchitect.exe');
console.log('分发 zip     : ' + (fs.existsSync(zipPath) ? path.resolve(zipPath) + '  (' + sizeOf(zipPath) + ')' : '未生成'));
