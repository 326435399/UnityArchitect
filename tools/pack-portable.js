/* Build a portable Windows app folder without electron-builder. node tools/pack-portable.js */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'dist', 'UnityArchitect-win32-x64');

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('Electron binary is missing. Run: npm install');
  process.exit(1);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

fs.mkdirSync(out, { recursive: true });
console.log('Copying Electron runtime...');
copyDir(electronDist, out);

// 重命名主程序，双击即可启动（Electron 默认加载同目录 resources\app）
const exeSrc = path.join(out, 'electron.exe');
const exeName = 'UnityArchitect.exe';
fs.renameSync(exeSrc, path.join(out, exeName));

const appDir = path.join(out, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(appDir, 'package.json'));
copyDir(path.join(root, 'electron'), path.join(appDir, 'electron'));
copyDir(path.join(root, 'src'), path.join(appDir, 'src'));
if (fs.existsSync(path.join(root, 'assets'))) copyDir(path.join(root, 'assets'), path.join(appDir, 'assets'));

// 写入应用图标与产品信息（resedit 纯 JS 修改 PE 资源，无需 rcedit 原生依赖）
const icoPath = path.join(root, 'assets', 'icon.ico');
if (fs.existsSync(icoPath)) {
  const ResEdit = require('resedit');
  const exePath = path.join(out, exeName);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const iconData = iconFile.icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  groups.forEach((g) => ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang || 1033, iconData));
  ResEdit.Resource.VersionInfo.fromEntries(res.entries).forEach(function (vi) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: 'Unity Architect',
      ProductName: 'Unity Architect'
    });
    vi.outputToResourceEntries(res.entries);
  });
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('Applied app icon + product info to ' + exeName);
}

const launcher = [
  '@echo off',
  'set ELECTRON_RUN_AS_NODE=',
  'start "" "%~dp0' + exeName + '"',
  ''
].join('\r\n');
fs.writeFileSync(path.join(out, '启动 Unity Architect.cmd'), launcher, 'ascii');

const ok = fs.existsSync(path.join(out, exeName)) &&
  fs.existsSync(path.join(appDir, 'package.json')) &&
  fs.existsSync(path.join(appDir, 'src', 'renderer', 'index.html'));
if (!ok) { console.error('Portable build verification failed'); process.exit(1); }
console.log('Portable app ready: ' + out);
console.log('Double-click ' + exeName + ' (or 启动 Unity Architect.cmd) to launch');
