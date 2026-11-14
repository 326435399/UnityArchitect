/* Electron 探针：验证「固定选中（图钉）」。
 * 用法：electron tools/probe-pin.js <unityRoot> <nodeName> <memberName>
 * 步骤：钉住成员行 → 清空 hover → 校验 pairing 仍点亮；换钉另一成员自动替换；解锁后 pairing 清空。 */
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const scanner = require('../electron/scanner');
const S = require('../src/shared/schema');
const Model = require('../src/shared/model');

const ROOT = process.argv[2];
const NODE_NAME = process.argv[3] || 'EnemyBrain';
const MEMBER = process.argv[4] || 'state';
const OUT = process.argv[5] || path.join(__dirname, '..', 'tests', '.probe-out');
const SHOT = path.join(OUT, 'pin.png');

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
    var cv = UA.App.getCanvas();
    var p = UA.App.getProject();
    function findNode(name) { return p.nodes.find(function (n) { return n.name === name; }); }
    function findMember(nodeName, memName) {
      var n = findNode(nodeName);
      if (!n) return null;
      var m = (n.members || []).find(function (x) { return x.name === memName; });
      return m ? { nodeId: n.id, id: m.id, name: memName } : null;
    }
    var m1 = findMember('${NODE_NAME}', '${MEMBER}');
    if (!m1) return { ok: false, why: 'member not found' };
    var out = { ok: true, target: '${NODE_NAME}.${MEMBER}' };
    function pairCount() { return cv.debugPairing().edges.length; }
    return new Promise(function (done) {
      // ① 钉住 m1，hover 移开（设为 null），pairing 应保持点亮
      cv.setPinned({ type: 'member', nodeId: m1.nodeId, id: m1.id });
      cv.debugSetHover(null);
      setTimeout(function () {
        out.pinnedEdges = pairCount();
        out.pinnedStillActive = cv.getPinned() && pairCount() > 0;
        // ② 换钉另一成员（若有），旧钉自动取消
        var others = (findNode('${NODE_NAME}').members || []).filter(function (x) { return x.name !== '${MEMBER}'; });
        if (others.length) {
          cv.setPinned({ type: 'member', nodeId: m1.nodeId, id: others[0].id });
          out.repinKeptOne = cv.getPinned().id === others[0].id;
        }
        // ③ 解锁（渲染是异步的，等一帧再校验 pairing 清空）
        cv.setPinned(null);
        setTimeout(function () {
          out.unlockedClear = !cv.getPinned() && pairCount() === 0;
          out.allPass = out.pinnedStillActive && out.repinKeptOne !== false && out.unlockedClear;
          done(out);
        }, 400);
      }, 500);
    });
  })()`);
  await new Promise(r => setTimeout(r, 400));
  // 截图：先做分层布局（探针工程无坐标，全堆原点），再钉住成员行供人工目检
  await win.webContents.executeJavaScript(`(function () {
    UA.App.action('layout-layered');
    return 'layout';
  })()`);
  await new Promise(r => setTimeout(r, 600));
  await win.webContents.executeJavaScript(`(function () {
    var cv = UA.App.getCanvas(); var p = UA.App.getProject();
    var n = p.nodes.find(function (x) { return x.name === '${NODE_NAME}'; });
    if (!n) return 'no node';
    var m = (n.members || []).find(function (x) { return x.name === '${MEMBER}'; });
    if (!m) return 'no member';
    UA.App.setSelection(new Set([n.id]));
    cv.fit();
    for (var i = 0; i < 12; i++) cv.zoom(1.25); // flyTo 只居中不缩放，先放大再对准
    cv.flyTo(n.id);
    cv.setPinned({ type: 'member', nodeId: n.id, id: m.id });
    return 'pinned';
  })()`);
  await new Promise(r => setTimeout(r, 900));
  fs.mkdirSync(OUT, { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(SHOT, img.toPNG());
  console.log('PIN ' + (res && res.allPass ? 'OK' : 'FAIL') + ' ' + JSON.stringify(res));
  app.quit();
})().catch(e => { console.error('PIN FAIL ' + e.message); app.quit(); });
