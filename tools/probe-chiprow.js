'use strict';
/**
 * Electron 探针：验证「成员行角色徽章不再截断类型名」——
 * 进入 GameInstaller 实例的溯源根视图（成员行右侧挂「序列化」徽章），
 * 放大到该卡片截近景，确认 controller : GameController 完整可见。
 * 用法：electron tools/probe-chiprow.js <unityRoot> [nodeName] [kind] [outDir]
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const scanner = require('../electron/scanner');
const S = require('../src/shared/schema');
const Model = require('../src/shared/model');

const ROOT = process.argv[2];
const NODE_NAME = process.argv[3] || 'GameInstaller';
const NODE_KIND = process.argv[4] || ''; // 可选：component / class / gameObject…，同名时按 kind 过滤
const NODE_MODE = process.argv[5] || 'trace-root'; // 可选：trace-root / focus 等 App action
const OUT = process.argv[6] || path.join(__dirname, '..', 'tests', '.probe-out');
const RESULT = path.join(OUT, 'chiprow-result.json');

function fail(msg) {
  fs.mkdirSync(path.dirname(RESULT), { recursive: true });
  fs.writeFileSync(RESULT, JSON.stringify({ ok: false, error: msg }, null, 2));
  console.error('PROBE FAIL: ' + msg);
  app.exit(1);
}

app.whenReady().then(async () => {
  if (!ROOT) return fail('missing unityRoot argument');
  let parsed;
  try { parsed = scanner.scan(ROOT).parsed; } catch (e) { return fail('scan failed: ' + e.message); }
  const proj = S.createEmptyProject('chiprow-probe');
  Model.mergeScan(proj, parsed);

  const win = new BrowserWindow({
    width: 1520, height: 940, show: false, backgroundColor: '#1B2026',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  try { await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html')); }
  catch (e) { return fail('load index.html failed: ' + e.message); }
  win.show();
  await new Promise(r => setTimeout(r, 700));

  const injected = await win.webContents.executeJavaScript(
    'UA.App.loadProjectObject(JSON.parse(' + JSON.stringify(JSON.stringify(proj)) + '), "probe"); "ok";'
  );
  if (injected !== 'ok') return fail('project injection failed');
  await new Promise(r => setTimeout(r, 400));

  const setup = await win.webContents.executeJavaScript(`(function () {
    var p = UA.App.getProject();
    var target = p.nodes.find(function (n) { return n.name === '${NODE_NAME}' && (!'${NODE_KIND}' || n.kind === '${NODE_KIND}'); }) ||
                 p.nodes.find(function (n) { return n.name.indexOf('${NODE_NAME}') === 0 && (!'${NODE_KIND}' || n.kind === '${NODE_KIND}'); });
    if (!target) return { ok: false, why: 'node ${NODE_NAME} not found' };
    UA.App.setSelection(new Set([target.id]));
    UA.App.action('${NODE_MODE}', { id: target.id });
    return new Promise(function (res) { setTimeout(function () {
      res({ ok: true, target: target.name, mode: UA.App.canvasMode });
    }, 500); });
  })()`);
  if (!setup.ok) return fail('root trace: ' + setup.why);

  // 放大到目标卡片近景：先 flyTo 居中，再 zoom 逼近
  const zoomed = await win.webContents.executeJavaScript(`(function () {
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    var n = p.nodes.find(function (n) { return n.name === '${NODE_NAME}' && (!'${NODE_KIND}' || n.kind === '${NODE_KIND}'); }) ||
            p.nodes.find(function (n) { return n.name.indexOf('${NODE_NAME}') === 0 && (!'${NODE_KIND}' || n.kind === '${NODE_KIND}'); });
    if (!n) return { ok: false, why: 'node lost after trace' };
    cv.flyTo(n.id);
    cv.zoom(2.2); cv.zoom(1.6);
    return new Promise(function (res) { setTimeout(function () {
      res({ ok: true, scale: cv.getView().scale });
    }, 400); });
  })()`);
  if (!zoomed.ok) return fail('zoom: ' + zoomed.why);

  await new Promise(r => setTimeout(r, 650));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'chiprow.png'), img.toPNG());

  // 数据面核验：目标节点里带徽章的成员行，其文字宽度应完整放进节点宽度
  const check = await win.webContents.executeJavaScript(`(function () {
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    var n = p.nodes.find(function (n) { return n.name.indexOf('${NODE_NAME}') === 0; });
    var g = cv.nodeGeo(n);
    var roles = (UA.App.traceRoles && UA.App.traceRoles[n.id]) || [];
    var bad = [];
    (g.rows || []).forEach(function (row) {
      if (row.kind !== 'member' || !row.member) return;
      var rts = roles.filter(function (r) { return r.member === row.member.name; });
      if (!rts.length) return;
      var txt = row.text.slice(2);
      // 用与渲染一致的预算公式反推：文字应能在 g.w - 34 - reserve 内放下
      var canvas2 = document.createElement('canvas').getContext('2d');
      canvas2.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
      var reserve = 8;
      rts.forEach(function (r) { reserve += canvas2.measureText(r.role).width + 16; });
      canvas2.font = '11px "Consolas", "JetBrains Mono", monospace';
      var need = canvas2.measureText(txt).width;
      var budget = g.w - 34 - reserve;
      bad.push({ member: row.member.name, text: txt, need: Math.ceil(need),
                 budget: Math.floor(budget), fits: need <= budget, nodeW: g.w });
    });
    return { ok: true, nodeW: g.w, rows: bad };
  })()`);
  if (!check.ok) return fail('check: ' + check.why);
  const overflow = check.rows.filter(function (r) { return !r.fits; });
  const result = { ok: overflow.length === 0, setup: setup, zoom: zoomed, rows: check.rows, overflow: overflow };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
  console.log('PROBE ' + (result.ok ? 'OK' : 'OVERFLOW') + ' ' + JSON.stringify(result));
  app.exit(result.ok ? 0 : 2);
}).catch(function (e) { fail('unexpected: ' + (e && e.message)); });
