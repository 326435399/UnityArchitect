'use strict';
/**
 * Electron 探针：验证「悬停对应」与「类型徽标常显」——
 * 1. 悬停一条实例间引用边 → 边加粗 + 源成员行/目标卡片点亮 + 完整对应提示
 * 2. 悬停 GameObject 的组件行 → 点亮进/出该组件的边
 * 3. 头部有角色徽章时类型字母徽标仍然可见
 * 用法：electron tools/probe-hover.js <unityRoot> [outDir]
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const scanner = require('../electron/scanner');
const S = require('../src/shared/schema');
const Model = require('../src/shared/model');

const ROOT = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'tests', '.probe-out');
const RESULT = path.join(OUT, 'hover-result.json');

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
  const proj = S.createEmptyProject('hover-probe');
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

  const shot = async (name) => {
    await new Promise(r => setTimeout(r, 320));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
  };

  // 进入 CycleA 实例的溯源根视图（含实例/GameObject/SO 混合子图）
  const setup = await win.webContents.executeJavaScript(`(function () {
    var p = UA.App.getProject();
    var target = p.nodes.find(function (n) {
      return n.kind === 'component' && p.edges.some(function (e) { return e.from === n.id && e.kind === 'serialize'; });
    });
    if (!target) return { ok: false, why: 'no component instance' };
    UA.App.action('trace-root', { id: target.id });
    return new Promise(function (res) { setTimeout(function () {
      res({ ok: true, target: target.name, mode: UA.App.canvasMode });
    }, 400); });
  })()`);
  if (!setup.ok) return fail('root trace: ' + setup.why);
  await shot('hover-base.png');

  const step1 = await win.webContents.executeJavaScript(`(function () {
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    // 悬停一条实例间序列化引用边（源是组件实例且 label 有值）
    var e = p.edges.find(function (e) {
      var a = p.nodes.find(function (n) { return n.id === e.from; });
      return e.kind === 'serialize' && e.label && a && a.kind === 'component';
    }) || p.edges.find(function (e) { return e.kind === 'serialize' && e.targetMember; });
    if (!e) return { ok: false, why: 'no serialize edge' };
    cv.debugSetHover({ type: 'edge', id: e.id, edge: e });
    return new Promise(function (res) { setTimeout(function () {
      var pr = cv.debugPairing();
      var src = p.nodes.find(function (n) { return n.id === e.from; });
      var dst = p.nodes.find(function (n) { return n.id === e.to; });
      res({ ok: true, edge: (src ? src.name : '') + '.' + e.label + ' -> ' + (dst ? dst.name : '') +
        (e.targetMember ? '.' + e.targetMember : ''),
        litEdges: pr.edges.length, litRows: pr.rows });
    }, 300); });
  })()`);
  if (!step1.ok) return fail('hover edge: ' + step1.why);
  await shot('hover-edge.png');
  await win.webContents.executeJavaScript('UA.App.getCanvas().debugSetHover(null); "ok";');
  await new Promise(r => setTimeout(r, 200));

  const step2 = await win.webContents.executeJavaScript(`(function () {
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    // 悬停 GameObject 卡片上的一个被引用组件行（有边 targetMember 指向它）
    var e = p.edges.find(function (e) { return e.targetMember; });
    if (!e) return { ok: true, skipped: true };
    var go = p.nodes.find(function (n) { return n.id === e.to; });
    if (!go) return { ok: false, why: 'target go missing' };
    cv.debugSetHover({ type: 'comp', id: 'x', nodeId: go.id, comp: { type: e.targetMember, fileId: '' } });
    return new Promise(function (res) { setTimeout(function () {
      var pr = cv.debugPairing();
      res({ ok: true, hovered: go.name + '.' + e.targetMember, litEdges: pr.edges.length, litRows: pr.rows });
    }, 300); });
  })()`);
  if (!step2.ok) return fail('hover comp row: ' + step2.why);
  await shot('hover-comp.png');
  await win.webContents.executeJavaScript('UA.App.getCanvas().debugSetHover(null); "ok";');
  await new Promise(r => setTimeout(r, 200));

  const result = { ok: true, setup: setup, hoverEdge: step1, hoverComp: step2 };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
  console.log('PROBE OK ' + JSON.stringify(result));
  app.exit(0);
}).catch(function (e) { fail('unexpected: ' + (e && e.message)); });
