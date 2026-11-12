/* Temporary visual probe: loads the renderer, drives assembly + event trace, captures PNGs. */
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '.probe');
const errors = [];

function shot(win, name) {
  return win.webContents.capturePage().then((img) => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function zoomIn(win, times) {
  for (let i = 0; i < times; i++) {
    await win.webContents.executeJavaScript(
      `document.querySelector('.graph-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,clientX:760,clientY:430,bubbles:true,cancelable:true}))`);
    await sleep(30);
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1500, height: 940, show: true, backgroundColor: '#11161d',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(1200);

  const result = {};
  result.demo = await win.webContents.executeJavaScript(`(function(){
    UA.App.action('load-demo');
    UA.UI.closeModal();
    return { nodes: UA.App.getProject().nodes.length, assemblies: (UA.App.getProject().assemblies||[]).map(a=>a.name) };
  })()`);
  await sleep(700);
  result.assembly = await win.webContents.executeJavaScript(`(function(){
    UA.App.action('layout-assembly');
    var g = UA.App.assemblyGroups || [];
    return { order: g.map(x=>x.label), bounds: g.map(x=>({t:Math.round(x.top), b:Math.round(x.bottom)})),
             lr: g.map(x=>[Math.round(x.left), Math.round(x.right)]), count: g.reduce((s,x)=>s+x.ids.length,0) };
  })()`);
  await sleep(900);
  await zoomIn(win, 7);
  await sleep(400);
  await shot(win, 'assembly.png');

  result.modeMutex = await win.webContents.executeJavaScript(`(function(){
   try {
    var p = UA.App.getProject();
    UA.App.action('layout-assembly');            // 先退出上一节遗留的 assembly
    var wasOff = !UA.App.assemblyGroups && UA.App.canvasMode === null;
    UA.App.action('layout-assembly');            // 进入 assembly
    var asmOn = !!UA.App.assemblyGroups && UA.App.canvasMode === 'assembly';
    var first = p.nodes.find(n => n.visible && n.kind === 'class');
    UA.App.setSelection(new Set([first.id]), null, null);
    UA.App.action('focus');                      // 进入 focus 必须清掉 assembly
    var r = { wasOff: wasOff, asmOn: asmOn,
      assemblyClearedByFocus: !UA.App.assemblyGroups && UA.App.canvasMode === 'focus' };
    UA.App.action('layout-assembly');            // focus 中点 Assembly → 切换模式，聚焦状态清除
    r.focusClearedByAssembly = UA.App.canvasMode === 'assembly' && !UA.App.focusId && !UA.App.trace;
    UA.App.action('layout-assembly');            // 再点一次退出，布局还原
    r.exitRestores = !UA.App.assemblyGroups && UA.App.canvasMode === null;
    return r;
   } catch (e) { return { error: String(e) }; }
  })()`);

  result.event = await win.webContents.executeJavaScript(`(function(){
    UA.App.action('layout-assembly');            // exit assembly view
    var p = UA.App.getProject();
    var gm = p.nodes.find(n=>n.name==='GameManager');
    UA.App.action('trace-event', { event: 'onGameOver', type: gm.sourceKey });
    var roles = {};
    Object.keys(UA.App.traceRoles||{}).forEach(function(id){
      var n = p.nodes.find(x=>x.id===id);
      roles[n ? n.name : id] = (UA.App.traceRoles[id]||[]).map(r=>r.role+(r.member?'@'+r.member:''));
    });
    var links = (UA.App.traceLinks||[]).map(function(l){
      var a=p.nodes.find(x=>x.id===l.from), b=p.nodes.find(x=>x.id===l.to);
      return (a?a.name:'?')+' -> '+(b?b.name:'?')+' ['+l.label+']';
    });
    var cols = (UA.App.traceColumnBounds||[]).map(c=>c.label);
    return { roles: roles, links: links, cols: cols, trace: UA.App.trace };
  })()`);
  await sleep(900);
  await shot(win, 'event.png');

  result.field = await win.webContents.executeJavaScript(`(function(){
    UA.App.action('unfocus');
    var p = UA.App.getProject();
    var gm = p.nodes.find(n=>n.name==='GameManager');
    UA.App.action('trace-field', { field: 'player', type: gm.sourceKey });
    var cols = (UA.App.traceColumnBounds||[]).map(c=>c.label);
    var roles = {};
    Object.keys(UA.App.traceRoles||{}).forEach(function(id){
      var n = p.nodes.find(x=>x.id===id);
      roles[n ? n.name : id] = (UA.App.traceRoles[id]||[]).map(r=>r.role+(r.member?'@'+r.member:''));
    });
    var links = (UA.App.traceLinks||[]).map(function(l){
      var a=p.nodes.find(x=>x.id===l.from), b=p.nodes.find(x=>x.id===l.to);
      return (a?a.name:'?')+' -> '+(b?b.name:'?')+' ['+l.label+']';
    });
    return { cols: cols, roles: roles, links: links };
  })()`);
  await sleep(900);
  await shot(win, 'field.png');

  // ---- round 7: toolbar modes, isolate toggle, search tab, exports ----------
  result.ui = await win.webContents.executeJavaScript(`(function(){
    var r = {};
    var q = function(s){ return document.querySelector(s); };
    r.batchBarGone = !q('.batch-bar');
    r.toolbarButtons = ['show-all','hide-all','isolate'].every(function(a){
      return !!q('.toolbar [data-action="' + a + '"]');
    });
    var p = UA.App.getProject();
    var gm = p.nodes.find(function(n){ return n.name === 'GameManager'; });
    // trace glow on/off
    UA.App.action('trace-event', { event: 'onGameOver', type: gm.sourceKey });
    r.traceGlow = q('.toolbar [data-action="trace-event"]').classList.contains('mode-on');
    UA.App.action('unfocus');
    // isolate toggle (outside any trace mode)
    UA.App.setSelection(new Set([gm.id]));
    var before = p.nodes.filter(function(n){ return n.visible !== false; }).length;
    UA.App.action('isolate');
    r.isolateGlow = q('.toolbar [data-action="isolate"]').classList.contains('mode-on');
    var during = p.nodes.filter(function(n){ return n.visible !== false; }).length;
    UA.App.action('isolate');
    var after = p.nodes.filter(function(n){ return n.visible !== false; }).length;
    r.isolate = { before: before, during: during, after: after,
      restored: after === before && during < before,
      glowOff: !q('.toolbar [data-action="isolate"]').classList.contains('mode-on') };
    r.traceGlowOff = !q('.toolbar [data-action="trace-event"]').classList.contains('mode-on');
    // left search tab driven by the panel input
    q('.panel-tabs[data-panel="left"] [data-tab="search"]').click();
    var inp = q('#tree-search');
    inp.value = 'player';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var leftText = document.getElementById('left-body').textContent;
    r.search = { hits: leftText.indexOf('条') >= 0 && /Player/i.test(leftText) };
    return r;
  })()`);

  result.exports = await win.webContents.executeJavaScript(`(function(){
    var cap = {};
    var orig = UA.Bridge.exportFile;
    UA.Bridge.exportFile = function(kind, content){ cap[kind] = content; return Promise.resolve({ ok: true }); };
    UA.App.action('export-md');
    UA.Bridge.exportFile = orig;
    return {
      md: cap.md ? { size: cap.md.length,
        hasMountScripts: cap.md.indexOf('挂载脚本') >= 0,
        hasMountsOn: cap.md.indexOf('挂载于') >= 0,
        hasComponents: cap.md.indexOf('组件组成') >= 0 } : null
    };
  })()`);

  // PNG in browser bridge path: base64 must decode to real PNG bytes.
  result.png = await win.webContents.executeJavaScript(`(async function(){
    var blob = null;
    var oldCU = URL.createObjectURL;
    URL.createObjectURL = function(b){ blob = b; return oldCU.call(URL, b); };
    var oldClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){};
    UA.App.action('export-png');
    URL.createObjectURL = oldCU;
    HTMLAnchorElement.prototype.click = oldClick;
    if (!blob) return { ok: false };
    var buf = new Uint8Array(await blob.arrayBuffer());
    return { ok: buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47,
      size: buf.length, type: blob.type };
  })()`);

  // ---- round 9: member expand, member-level 定义 badge, SVG validity --------
  result.expand = await win.webContents.executeJavaScript(`(function(){
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    var gm = p.nodes.find(function(n){ return n.name === 'GameManager'; });
    for (var i = 0; i < 50; i++) gm.members.push({ id: gm.id + '#x' + i, name: 'x' + i, kind: 'field', access: 'private', type: 'int' });
    cv.invalidateGeo(); cv.render();
    var g = cv.visibleGeos().find(function(x){ return x.node.id === gm.id; });
    var row = g.rows.find(function(r){ return r.kind === 'more'; });
    if (!row) return { ok: false, reason: 'no more row' };
    var s = cv.toScreen(g.x + g.w / 2, g.y + row.y + row.h / 2);
    var el = document.querySelector('.graph-canvas');
    var rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + s.x, clientY: rect.top + s.y, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + s.x, clientY: rect.top + s.y, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    var g2 = cv.visibleGeos().find(function(x){ return x.node.id === gm.id; });
    var memberRows = g2.rows.filter(function(r){ return r.kind === 'member'; }).length;
    var collapseRow = g2.rows.find(function(r){ return r.kind === 'more'; });
    var expandedOk = UA.App.expandedNodes.has(gm.id) && memberRows === gm.members.length && collapseRow && /收起/.test(collapseRow.text);
    // click again to collapse
    var row2 = g2.rows.find(function(r){ return r.kind === 'more'; });
    var s2 = cv.toScreen(g2.x + g2.w / 2, g2.y + row2.y + row2.h / 2);
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + s2.x, clientY: rect.top + s2.y, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    var g3 = cv.visibleGeos().find(function(x){ return x.node.id === gm.id; });
    return { ok: expandedOk,
      collapsedAgain: !UA.App.expandedNodes.has(gm.id) && g3.rows.filter(function(r){ return r.kind === 'member'; }).length === 40 };
  })()`);
  await sleep(300);

  // 定义 badge now lives on the member row (fallback to header if truncated).
  result.defBadge = await win.webContents.executeJavaScript(`(function(){
    var p = UA.App.getProject();
    var gm = p.nodes.find(function(n){ return n.name === 'GameManager'; });
    UA.App.action('trace-event', { event: 'onGameOver', type: gm.sourceKey });
    var roles = (UA.App.traceRoles || {})[gm.id] || [];
    var def = roles.find(function(r){ return r.role === '定义'; });
    UA.App.action('unfocus');
    return def ? { member: def.member } : null;
  })()`);

  // GameObject / prefab composition: built-in components + scripts + prefab instance link.
  result.compose = await win.webContents.executeJavaScript(`(function(){
   try {
    var p = UA.App.getProject();
    var pr = p.nodes.find(function(n){ return n.name === 'PlayerRoot'; });
    var gmRoot = p.nodes.find(function(n){ return n.name === 'GameRoot'; });
    var comps = pr ? (pr.components || []).map(function(c){ return c.type + (c.nodeKey ? '(s)' : ''); }) : [];
    var instEdge = p.edges.find(function(e){
      return e.kind === 'compose' && e.label === '预制体实例' && e.to === (pr && pr.id);
    });
    var fromNode = instEdge ? p.nodes.find(function(n){ return n.id === instEdge.from; }) : null;
    // card rows
    var g = UA.App.getCanvas().nodeGeo(pr);
    var compRows = g.rows.filter(function(r){ return r.kind === 'comp'; }).length;
    UA.App.setSelection(new Set([pr.id]));
    var inspect = document.getElementById('right-body').textContent;
    return { kind: pr && pr.kind, comps: comps, compRows: compRows,
      hasGroup: g.rows.some(function(r){ return r.kind === 'group' && /组件/.test(r.text); }),
      instFrom: fromNode ? fromNode.name : '', inspectHas: comps.length > 0 && inspect.indexOf('组件组成') >= 0 };
   } catch (e) { return { error: String(e && e.message || e) }; }
  })()`);
  await sleep(500);
  await win.webContents.executeJavaScript(`(function(){
    var p = UA.App.getProject();
    var pr = p.nodes.find(function(n){ return n.name === 'PlayerRoot'; });
    UA.App.getCanvas().flyTo(pr.id);
    UA.App.getCanvas().zoom(1.35);
  })()`);
  await sleep(500);
  await shot(win, 'compose.png');

  await sleep(400);
  await zoomIn(win, 6);
  await sleep(300);
  await shot(win, 'edges.png');

  // 节点拖拽：mousedown → mousemove → mouseup 后位置变化，且不影响扫描差异指纹。
  result.drag = await win.webContents.executeJavaScript(`(function(){
   try {
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    var n = p.nodes[0];
    var g = cv.nodeGeo(n);
    var s = cv.toScreen(g.x + g.w / 2, g.y + 8);
    var el = document.querySelector('.graph-canvas');
    var rect = el.getBoundingClientRect();
    var cx = rect.left + s.x, cy = rect.top + s.y;
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: cx + 80, clientY: cy + 60, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    var g2 = cv.nodeGeo(n);
    var moved = Math.abs(g2.x - g.x) > 10 && Math.abs(g2.y - g.y) > 10;
    return { moved: moved, dx: Math.round(g2.x - g.x), dy: Math.round(g2.y - g.y), selected: UA.App.selection.has(n.id) };
   } catch (e) { return { error: String(e && e.message || e) }; }
  })()`);
  await sleep(300);

  // 成员高亮 + 孤立节点规则（只统计脚本类）
  result.highlight = await win.webContents.executeJavaScript(`(function(){
   try {
    UA.App.action('unfocus');
    UA.App.action('highlight-member', { id: 'event' });
    UA.App.action('highlight-member', { id: 'coroutine' });
    var on = UA.App.memberHighlight ? Array.from(UA.App.memberHighlight) : [];
    UA.App.action('highlight-member', { id: 'event' });
    var after = Array.from(UA.App.memberHighlight);
    var p = UA.App.getProject();
    var iso = UA.App.getSummary().isolated || [];
    var allScript = iso.every(function (id) {
      var n = p.nodes.find(function (x) { return x.id === id; });
      return n && ['class','struct','interface','enum','scriptableObject'].indexOf(n.kind) >= 0;
    });
    return { toggledOn: on, toggledOff: after, isolated: iso.length, isolatedAllScripts: allScript };
   } catch (e) { return { error: String(e) }; }
  })()`);

  result.errors = errors;

  // 性能基线：合成 400 节点 / 800 边的工程，量渲染与命中测试耗时。
  result.perf = await win.webContents.executeJavaScript(`(function(){
    var S = UA.Schema, L = UA.Layout;
    var p = S.createEmptyProject('性能基线');
    var kinds = ['class','interface','struct','enum','scriptableObject'];
    for (var i = 0; i < 400; i++) {
      var members = [];
      for (var m = 0; m < 14; m++) {
        members.push({ id: 'm' + i + '_' + m, kind: m % 4 === 0 ? 'method' : 'field',
          name: 'member' + m, type: 'float', access: 'public', returnType: 'void', parameters: '' });
      }
      p.nodes.push(S.normalizeNode({ id: 'n' + i, kind: kinds[i % kinds.length], name: 'Type' + i,
        sourceKey: 'cs:i#' + i, filePath: 'Assets/S' + i + '.cs', members: members }, 'n' + i));
    }
    for (var e = 0; e < 800; e++) {
      p.edges.push(S.normalizeEdge({ id: 'e' + e, from: 'n' + (e % 400), to: 'n' + ((e * 7 + 13) % 400),
        kind: e % 3 === 0 ? 'depend' : (e % 3 === 1 ? 'inherit' : 'compose'), sourceMember: 'member' + (e % 14) }, 'e' + e));
    }
    L.applyPositions(p, L.gridLayout(p).positions);
    UA.App.loadProjectObject(p);
    var cv = UA.App.getCanvas();
    cv.fit();
    var t0 = performance.now();
    for (var f = 0; f < 60; f++) cv.render();
    var renderMs = (performance.now() - t0) / 60;
    cv.zoom(2.4);   // 放大后只画视口内的节点，验证剔除效果
    var t2 = performance.now();
    for (var f2 = 0; f2 < 60; f2++) cv.render();
    var zoomMs = (performance.now() - t2) / 60;
    var t1 = performance.now();
    for (var k = 0; k < 200; k++) cv.hitTest(100 + (k % 50) * 9, 80 + (k % 37) * 11);
    var hitMs = (performance.now() - t1) / 200;
    return { nodes: p.nodes.length, edges: p.edges.length,
      renderMs: Math.round(renderMs * 100) / 100, zoomMs: Math.round(zoomMs * 100) / 100,
      hitMs: Math.round(hitMs * 1000) / 1000 };
  })()`);

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  app.exit(errors.length ? 1 : 0);
});
