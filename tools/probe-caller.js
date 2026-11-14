'use strict';
/**
 * Electron 探针：验证「数据流向视图呈现写入方法的触发方」——
 * 追踪 GameView.state（Bind 写入、GameInstaller.Start 调用 Bind），
 * 截图确认「触发」列出现 GameInstaller，并断言 callers 数据与链接。
 * 用法：electron tools/probe-caller.js <unityRoot> [outDir]
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const scanner = require('../electron/scanner');
const S = require('../src/shared/schema');
const Model = require('../src/shared/model');

const ROOT = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'tests', '.probe-out');
const RESULT = path.join(OUT, 'caller-result.json');

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
  const proj = S.createEmptyProject('caller-probe');
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

  // 追踪 GameView.state：Bind 写入、OnGUI 读取、GameInstaller.Start 触发
  const setup = await win.webContents.executeJavaScript(`(function () {
    var p = UA.App.getProject();
    // 故意从「组件实例卡」发起（用户实际操作路径）——typeKey 是 comp:...，
    // 归一化后应能查到 state 的数据流向而不是「没有找到」
    var gv = p.nodes.find(function (n) { return n.name === 'GameView' && n.kind === 'component'; }) ||
             p.nodes.find(function (n) { return n.name === 'GameView' && n.kind !== 'component'; });
    if (!gv) return { ok: false, why: 'GameView not found' };
    UA.App.action('trace-field', { field: 'state', type: gv.sourceKey });
    return new Promise(function (res) { setTimeout(function () {
      var roles = UA.App.traceRoles || {};
      var callerNodes = p.nodes.filter(function (n) { return roles[n.id] &&
        roles[n.id].some(function (r) { return r.role === '调用'; }); })
        .map(function (n) { return n.name + '(' + roles[n.id].map(function (r) { return r.role + ':' + (r.member || '-'); }).join(',') + ')'; });
      res({ ok: true, mode: UA.App.canvasMode, callerNodes: callerNodes,
        links: (UA.App.traceLinks || []).map(function (l) {
          var a = p.nodes.find(function (n) { return n.id === l.from; });
          var b = p.nodes.find(function (n) { return n.id === l.to; });
          return (a ? a.name : '?') + ' -' + l.label + '-> ' + (b ? b.name : '?');
        }) });
    }, 500); });
  })()`);
  if (!setup.ok) return fail('field trace: ' + setup.why);

  await new Promise(r => setTimeout(r, 650));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'caller.png'), img.toPNG());

  const hasCaller = setup.callerNodes.some(function (s) { return s.indexOf('GameInstaller') === 0; });
  const hasLink = setup.links.some(function (l) { return /^GameInstaller -调用-> GameView/.test(l); });
  const result = { ok: hasCaller && hasLink, callerNodes: setup.callerNodes, links: setup.links };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
  console.log('PROBE ' + (result.ok ? 'OK' : 'MISS') + ' ' + JSON.stringify(result));
  app.exit(result.ok ? 0 : 2);
}).catch(function (e) { fail('unexpected: ' + (e && e.message)); });
