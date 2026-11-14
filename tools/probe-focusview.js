/* 聚焦模式全图截图：node tools/probe-focusview.js <unityRoot> <nodeName> [kind] */
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const scanner = require('../electron/scanner');
const S = require('../src/shared/schema');
const Model = require('../src/shared/model');

const ROOT = process.argv[2];
const NODE_NAME = process.argv[3] || 'Cube';
const NODE_KIND = process.argv[4] || '';
const OUT = process.argv[5] || path.join(__dirname, '..', 'tests', '.probe-out');
const SHOT = path.join(OUT, 'focusview.png');

(async () => {
  await app.whenReady();
  const parsed = scanner.scan(ROOT).parsed;
  const proj = S.createEmptyProject('probe');
  Model.mergeScan(proj, parsed);
  const win = new BrowserWindow({
    width: 1600, height: 1000, show: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  win.show();
  await new Promise(r => setTimeout(r, 700));
  await win.webContents.executeJavaScript(
    'UA.App.loadProjectObject(JSON.parse(' + JSON.stringify(JSON.stringify(proj)) + '), "probe"); "ok";');
  await new Promise(r => setTimeout(r, 400));
  const res = await win.webContents.executeJavaScript(`(function () {
    var p = UA.App.getProject();
    var t = p.nodes.find(function (n) { return n.name === '${NODE_NAME}' && (!'${NODE_KIND}' || n.kind === '${NODE_KIND}'); });
    if (!t) return { ok: false, why: 'node not found' };
    UA.App.setSelection(new Set([t.id]));
    UA.App.action('focus', { id: t.id });
    return new Promise(function (res) {
      setTimeout(function () {
        UA.App.getCanvas().fit();
        setTimeout(function () { res({ ok: true, mode: UA.App.canvasMode }); }, 700);
      }, 600);
    });
  })()`);
  await new Promise(r => setTimeout(r, 700));
  fs.mkdirSync(OUT, { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(SHOT, img.toPNG());
  console.log('FOCUSVIEW OK ' + JSON.stringify(res));
  app.quit();
})().catch(e => { console.error('FOCUSVIEW FAIL ' + e.message); app.quit(); });
