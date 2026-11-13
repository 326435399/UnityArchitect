'use strict';
/**
 * Electron 探针：真实扫描目标工程，注入渲染层，验证三个新能力——
 * 1. 项目体检面板（H / 工具栏「体检」）
 * 2. 循环依赖环形视图（点击体检清单里的环条目）
 * 3. 溯源根视图的中间过程成员徽章
 * 用法：electron tools/probe-health.js <unityRoot> [outDir]
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const scanner = require('../electron/scanner');
const S = require('../src/shared/schema');
const Model = require('../src/shared/model');

const ROOT = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'tests', '.probe-out');
const RESULT = path.join(OUT, 'probe-result.json');

function fail(msg) {
  fs.mkdirSync(path.dirname(RESULT), { recursive: true });
  fs.writeFileSync(RESULT, JSON.stringify({ ok: false, error: msg }, null, 2));
  console.error('PROBE FAIL: ' + msg);
  app.exit(1);
}

app.whenReady().then(async () => {
  if (!ROOT) return fail('missing unityRoot argument');
  let parsed;
  try {
    const r = scanner.scan(ROOT);
    parsed = r && r.parsed;
  } catch (e) { return fail('scan failed: ' + e.message); }
  if (!parsed || !parsed.nodes || !parsed.nodes.length) return fail('scan produced no nodes');
  // scanner 返回的是 raw scan（key 引用），必须先 mergeScan 转成 project 才能注入渲染层
  let projectJson;
  try {
    const proj = S.createEmptyProject('probe');
    Model.mergeScan(proj, parsed);
    projectJson = proj;
  } catch (e) { return fail('mergeScan failed: ' + e.message); }

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
    'UA.App.loadProjectObject(JSON.parse(' + JSON.stringify(JSON.stringify(projectJson)) + '), "probe"); "ok";'
  );
  if (injected !== 'ok') return fail('project injection failed');
  await new Promise(r => setTimeout(r, 400));

  const step1 = await win.webContents.executeJavaScript(`(function () {
    UA.App.action('health');
    var host = document.querySelector('#modal-root .modal');
    if (!host) return { ok: false, why: 'health modal missing' };
    var score = host.querySelector('.health-score b');
    var groups = Array.prototype.map.call(host.querySelectorAll('.health-group > h3'), function (h) {
      return h.textContent.trim();
    });
    var items = host.querySelectorAll('.health-item').length;
    var cycleBtn = host.querySelector('[data-hg="cycle"]');
    return { ok: true, score: score ? score.textContent : '', groups: groups, items: items,
      hasCycle: !!cycleBtn };
  })()`);
  if (!step1.ok) return fail('health panel: ' + step1.why);

  const shot = async (name) => {
    await new Promise(r => setTimeout(r, 320)); // capturePage 需要等 compositor 出新帧
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
  };
  await shot('health.png');

  let cycleView = { skipped: true };
  if (step1.hasCycle) {
    cycleView = await win.webContents.executeJavaScript(`(function () {
      var btn = document.querySelector('#modal-root [data-hg="cycle"]');
      btn.click();
      return new Promise(function (res) { setTimeout(function () {
        var roleRows = [];
        var rolesMap = UA.App.traceRoles || {};
        Object.keys(rolesMap).forEach(function (id) {
          (rolesMap[id] || []).forEach(function (r) {
            if (r.member) roleRows.push((UA.App.getProject().nodes.find(function (n) { return n.id === id; }) || {}).name +
              ':' + r.role + '·' + r.member);
          });
        });
        res({
          canvasMode: UA.App.canvasMode || null,
          links: UA.App.traceLinks ? UA.App.traceLinks.length : 0,
          labels: UA.App.traceLinks ? UA.App.traceLinks.map(function (l) { return l.label; }) : [],
          roleRows: roleRows,
          visible: UA.App.getProject().nodes.filter(function (n) { return n.visible; }).length
        });
      }, 350); });
    })()`);
    await shot('cycle.png');
    await win.webContents.executeJavaScript('UA.App.action("unfocus"); "ok";');
    await new Promise(r => setTimeout(r, 300));
  }

  const step3 = await win.webContents.executeJavaScript(`(function () {
    var p = UA.App.getProject();
    // 优先选一个有出边的组件实例，验证实例级溯源；退化到任意脚本类
    var target = p.nodes.find(function (n) {
      return n.kind === 'component' && p.edges.some(function (e) {
        return e.from === n.id && e.kind === 'serialize';
      });
    }) || p.nodes.find(function (n) {
      return n.kind === 'class' && n.name === 'TrackedRow';
    });
    if (!target) return { ok: false, why: 'no script node to trace' };
    UA.App.action('trace-root', { id: target.id });
    return new Promise(function (res) { setTimeout(function () {
      var roles = UA.App.traceRoles || {};
      var withMember = [];
      Object.keys(roles).forEach(function (id) {
        (roles[id] || []).forEach(function (r) {
          if (r.member) withMember.push({ node: id, role: r.role, member: r.member });
        });
      });
      res({ ok: true, target: target.name, withMember: withMember,
        mode: UA.App.canvasMode, visible: p.nodes.filter(function (n) { return n.visible; }).length });
    }, 350); });
  })()`);
  if (!step3.ok) return fail('root trace: ' + step3.why);
  await shot('root-trace.png');

  const step4 = await win.webContents.executeJavaScript(`(function () {
    var p = UA.App.getProject();
    var insts = p.nodes.filter(function (n) { return n.kind === 'component'; });
    var byId = Object.create(null);
    p.nodes.forEach(function (n) { byId[n.id] = n; });
    return { ok: true, instances: insts.length,
      names: insts.slice(0, 10).map(function (n) { return n.name; }),
      attach: p.edges.filter(function (e) { return e.kind === 'attach'; }).length,
      instantiate: p.edges.filter(function (e) { return e.kind === 'instantiate'; }).length,
      instToInst: p.edges.filter(function (e) {
        return e.kind === 'serialize' && byId[e.from] && byId[e.to] &&
          byId[e.from].kind === 'component' && byId[e.to].kind === 'component';
      }).length };
  })()`);
  if (!step4.ok) return fail('component instances: ' + step4.why);

  const result = {
    ok: true,
    health: { score: step1.score, groups: step1.groups, itemCount: step1.items },
    cycleView: cycleView,
    rootTrace: step3,
    instances: step4
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
  console.log('PROBE OK ' + JSON.stringify(result));
  app.exit(0);
}).catch(function (e) { fail('unexpected: ' + (e && e.message)); });
