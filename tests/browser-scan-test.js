/* End-to-end test of the browser directory-reading path. Pure Node, no Electron. */
'use strict';
const assert = require('assert');

/* ---------- minimal DOM / browser mocks -------------------------------- */
const listeners = Object.create(null);
function fakeInput() {
  return {
    value: '', files: [],
    setAttribute() {}, removeAttribute() {},
    click() { if (typeof this.onchange === 'function') this.onchange(); }
  };
}
const inputs = {
  'dir-input': fakeInput(),
  'file-input': fakeInput(),
  'drop-overlay': { classList: { toggle() {} } }
};
global.document = {
  title: '',
  addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
  getElementById(id) { return inputs[id] || null; },
  createElement() { return { click() {}, remove() {} }; },
  body: { appendChild() {} }
};
global.localStorage = {
  _d: Object.create(null),
  getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); }
};
global.UA = { UnityParser: require('../src/shared/unity-parser.js') };

const DEMO = [
  { path: 'Assets/Scripts/GameManager.cs', content: [
    'using UnityEngine;', 'namespace Demo {', 'public class GameManager : MonoBehaviour {',
    '  [SerializeField] private PlayerController player;',
    '  public void Restart() { player.TakeDamage(1); }', '} }', ''].join('\n') },
  { path: 'Assets/Scripts/GameManager.cs.meta', content: 'fileFormatVersion: 2\nguid: 11111111111111111111111111111111\n' },
  { path: 'Assets/Scripts/PlayerController.cs', content: [
    'using UnityEngine;', 'namespace Demo {', 'public class PlayerController : MonoBehaviour {',
    '  public int hp = 100;', '  public void TakeDamage(int n) { hp -= n; }', '} }', ''].join('\n') },
  { path: 'Assets/Scripts/PlayerController.cs.meta', content: 'fileFormatVersion: 2\nguid: 22222222222222222222222222222222\n' },
  { path: 'Assets/Scripts/DemoData.cs', content: [
    'using UnityEngine;', 'namespace Demo {', 'public class DemoData : ScriptableObject {',
    '  public int speed = 5;', '} }', ''].join('\n') },
  { path: 'Assets/Scripts/DemoData.cs.meta', content: 'fileFormatVersion: 2\nguid: 44444444444444444444444444444444\n' },
  { path: 'Assets/Data/PlayerData.asset', content: [
    '%YAML 1.1', '--- !u!114 &11400000', 'MonoBehaviour:', '  m_Name: PlayerData',
    '  m_Script: {fileID: 11500000, guid: 44444444444444444444444444444444, type: 3}', ''].join('\n') },
  { path: 'Assets/Data/PlayerData.asset.meta', content: 'fileFormatVersion: 2\nguid: 33333333333333333333333333333333\n' },
  { path: 'Assets/Prefabs/Player.prefab', content: [
    '%YAML 1.1', '--- !u!1 &100000', 'GameObject:', '  m_Name: PlayerRoot',
    '--- !u!114 &200000', 'MonoBehaviour:', '  m_GameObject: {fileID: 100000}',
    '  m_Script: {fileID: 11500000, guid: 22222222222222222222222222222222, type: 3}',
    '  data: {fileID: 11400000, guid: 33333333333333333333333333333333, type: 2}', ''].join('\n') },
  { path: 'Assets/Prefabs/Player.prefab.meta', content: 'fileFormatVersion: 2\nguid: 55555555555555555555555555555555\n' },
  { path: 'Assets/Scenes/Sample.unity', content: [
    '%YAML 1.1',
    '--- !u!1 &500000', 'GameObject:', '  m_Name: EventSystem',
    '--- !u!114 &600000', 'MonoBehaviour:', '  m_GameObject: {fileID: 500000}',
    '  m_Script: {fileID: 11500000, guid: 99999999999999999999999999999999, type: 3}',
    '--- !u!114 &700000', 'MonoBehaviour:', '  m_GameObject: {fileID: 500000}',
    '  m_Script: {fileID: 11500000, guid: 88888888888888888888888888888888, type: 3}', ''].join('\n') },
  { path: 'Assets/Scenes/Sample.unity.meta', content: 'fileFormatVersion: 2\nguid: 66666666666666666666666666666666\n' },
  { path: 'Library/PackageCache/com.unity.ugui@1.0.0/Runtime/EventSystem/EventSystem.cs.meta',
    content: 'fileFormatVersion: 2\nguid: 99999999999999999999999999999999\n' },
  { path: 'Library/Cache/Ignored.cs', content: 'public class Ignored {}' },
  { path: 'ProjectSettings/TagManager.asset', content: '%YAML 1.1\n--- !u!78 &1\nTagManager:\n  m_Name: Tags\n' }
];

/* ---------- fake File System Access handles ---------------------------- */
function makeTree(files) {
  const root = { dirs: Object.create(null), files: Object.create(null) };
  files.forEach(f => {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      if (!node.dirs[d]) node.dirs[d] = { dirs: Object.create(null), files: Object.create(null) };
      node = node.dirs[d];
    }
    node.files[parts[parts.length - 1]] = f.content;
  });
  return root;
}
function fsDir(name, node) {
  return {
    kind: 'directory', name,
    queryPermission() { return 'granted'; },
    getDirectoryHandle(sub) {
      const child = node.dirs[sub];
      if (!child) return Promise.reject(new Error('not found: ' + sub));
      return Promise.resolve(fsDir(sub, child));
    },
    async *entries() {
      for (const d of Object.keys(node.dirs)) yield [d, fsDir(d, node.dirs[d])];
      for (const f of Object.keys(node.files)) {
        const content = node.files[f];
        yield [f, { kind: 'file', name: f, async getFile() { return new Blob([content]); } }];
      }
    }
  };
}
/* ---------- fake drag & drop entries ----------------------------------- */
function dropDir(name, node) {
  return {
    isDirectory: true, isFile: false, name,
    getDirectory(sub, _opts, success, failure) {
      const child = node.dirs[sub];
      if (child) success(dropDir(sub, child)); else failure(new Error('not found: ' + sub));
    },
    createReader() {
      const list = [];
      Object.keys(node.dirs).forEach(d => list.push(dropDir(d, node.dirs[d])));
      Object.keys(node.files).forEach(f => {
        const content = node.files[f];
        list.push({
          isFile: true, isDirectory: false, name: f,
          file(cb) { cb(new Blob([content])); }
        });
      });
      let sent = false;
      return { readEntries(cb) { if (sent) return cb([]); sent = true; cb(list); } };
    }
  };
}

let pickerCalls = 0;
global.showDirectoryPicker = function () {
  pickerCalls++;
  return Promise.resolve(fsDir('MyUnityProject', makeTree(DEMO)));
};

require('../src/renderer/bridge.js');
const Bridge = global.UA.Bridge;
const I = Bridge._internals;

let passed = 0;
function ok(cond, name) { assert.ok(cond, name); passed++; console.log('  PASS ' + name); }
function eq(a, b, name) { assert.strictEqual(a, b, name); passed++; console.log('  PASS ' + name); }
function checkGraph(r, name) {
  ok(!!r && !!r.parsed, name + ': result');
  ok(r.parsed.stats.csFiles >= 2, name + ': parsed .cs files (' + r.parsed.stats.csFiles + ')');
  ok(r.parsed.stats.types >= 2, name + ': parsed types (' + r.parsed.stats.types + ')');
  ok(r.parsed.nodes.length >= 4, name + ': nodes (' + r.parsed.nodes.length + ')');
  ok(r.parsed.edges.length >= 1, name + ': edges (' + r.parsed.edges.length + ')');
  ok(r.parsed.nodes.every(n => /^Assets\//.test(n.filePath)),
    name + ': paths normalized to Assets/');
  ok(!r.parsed.nodes.some(n => /Library\//.test(n.filePath)), name + ': Library skipped');
  ok(!r.parsed.nodes.some(n => /ProjectSettings\//.test(n.filePath)), name + ': ProjectSettings skipped');
  ok(!r.parsed.nodes.some(n => n.kind === 'assembly' || n.kind === 'manual'),
    name + ': no assembly / manual nodes');
  // EventSystem（官方包脚本）通过 Library/PackageCache 的 .cs.meta 解析出真实名字
  const es = r.parsed.nodes.find(n => n.name === 'EventSystem');
  ok(!!es, name + ': EventSystem GO exists');
  ok(!!es.components && es.components.some(c => c.type === 'EventSystem'),
    name + ': EventSystem script resolved from PackageCache meta');
  ok(es.components.some(c => c.type === 'MonoBehaviour'),
    name + ': unknown-guid script stays MonoBehaviour');
  eq(r.parsed.stats.unresolvedScriptComps, 1,
    name + ': unresolved script comps counted (' + r.parsed.stats.unresolvedScriptComps + ')');
}

async function main() {
  console.log('Browser directory scan tests');

  eq(I.toAssetPath('MyUnityProject/Assets/Scripts/A.cs', 'MyUnityProject'), 'Assets/Scripts/A.cs', 'project root -> Assets/');
  eq(I.toAssetPath('Assets/Scripts/A.cs', 'Assets'), 'Assets/Scripts/A.cs', 'selected Assets folder keeps prefix');
  eq(I.toAssetPath('Some/Assets/Scripts/A.cs', 'Some'), 'Assets/Scripts/A.cs', 'nested Assets folder');
  eq(I.toAssetPath('Assets/Packages/x.asmdef', 'Assets'), 'Assets/Packages/x.asmdef', 'Assets prefix once');

  // 1. bind a directory via showDirectoryPicker
  const r1 = await Bridge.scanUnity({});
  eq(r1.mode, 'fsa', 'picker mode');
  eq(r1.rootPath, 'MyUnityProject', 'root name');
  eq(pickerCalls, 1, 'picker opened once');
  eq(r1.parsed.stats.scope, 'standard', 'standard scope reported');
  checkGraph(r1, 'picker');
  ok(r1.parsed.nodes.some(n => n.kind === 'gameObject' || n.kind === 'prefab'), 'scene mounts are included');
  ok(r1.parsed.nodes.some(n => n.kind === 'scriptableObject' && String(n.sourceKey).indexOf('asset:') === 0),
    'SO asset instances are included');

  // 2. bound directory is remembered
  const link = await Bridge.linkedDir();
  ok(!!link && link.granted, 'directory binding persisted');
  eq(link.name, 'MyUnityProject', 'bound name');

  // 3. automatic re-scan without any picker / user gesture
  const callsBefore = pickerCalls;
  const r2 = await Bridge.scanUnity({ rescan: true });
  eq(pickerCalls, callsBefore, 'rescan opens no picker');
  checkGraph(r2, 'rescan');
  eq(r2.parsed.stats.csFiles, r1.parsed.stats.csFiles, 'rescan is deterministic');

  // 4. drag & drop a whole folder
  const r3 = await I.scanEntries([dropDir('MyUnityProject', makeTree(DEMO))]);
  eq(r3.mode, 'drop', 'drop mode');
  checkGraph(r3, 'drop');
  const overlayHandlers = listeners['drop'] || [];
  ok(overlayHandlers.length === 1, 'drop listener installed on document');

  // 5. webkitdirectory compatibility picker
  const legacyFiles = DEMO.map(f => ({
    name: f.path.split('/').pop(),
    webkitRelativePath: 'MyUnityProject/' + f.path,
    size: f.content.length,
    text: () => Promise.resolve(f.content)
  }));
  inputs['dir-input'].files = legacyFiles;
  const r4 = await Bridge.scanUnity({ legacy: true });
  eq(r4.mode, 'legacy', 'legacy mode');
  checkGraph(r4, 'legacy');

  // 6. empty directory produces an actionable error (instead of silent null)
  const empty = I.newState();
  let emptyErr = null;
  try { I.filesToResult(empty, 'EmptyProject', 'fsa'); } catch (e) { emptyErr = e; }
  ok(!!emptyErr && !!emptyErr.scanHint, 'empty directory throws with hint');

  // 7. unlink then rescan reports a clear message
  await Bridge.clearLinkedDir();
  eq(await Bridge.linkedDir(), null, 'unlink clears binding');
  let unlinkErr = null;
  try { await Bridge.scanUnity({ rescan: true }); } catch (e) { unlinkErr = e; }
  ok(!!unlinkErr && /尚未绑定/.test(unlinkErr.message), 'rescan after unlink is explained');

  // 8. limits: oversized single file is skipped, not fatal
  const st = I.newState();
  I.addFile(st, 'Assets/Scripts/A.cs', 10, 'class A {}');
  I.addFile(st, 'Assets/Scripts/Big.cs', 4 * 1024 * 1024, 'x');
  eq(st.files.length, 1, 'oversized file skipped');
  eq(st.skipped, 1, 'skipped counter');

  // 9. package metas bypass the byte budget: a project whose Assets already
  //    exhausted 48MB must still resolve official script GUIDs
  const st2 = I.newState();
  st2.bytes = 48 * 1024 * 1024; // budget exhausted by the main scan
  I.addPkgMeta(st2, 'Library/PackageCache/x/EventSystem.cs.meta', 60,
    'fileFormatVersion: 2\nguid: 99999999999999999999999999999999\n');
  eq(st2.files.length, 1, 'pkg meta added after budget exhausted');
  eq(st2.pkgBytes, 60, 'pkg meta bytes tracked separately');

  console.log('\n' + passed + '/' + passed + ' assertions passed');
}
main().catch(e => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
