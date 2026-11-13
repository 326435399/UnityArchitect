/* Application orchestration: state, commands, scanning, export, shortcuts. */
(function (root) {
  'use strict';
  var UA = root.UA, S = UA.Schema, Model = UA.Model, Analysis = UA.Analysis,
    Layout = UA.Layout, UI = UA.UI, Bridge = UA.Bridge;
  var esc = UI.esc;

  var DEMO_FILES = (function () {
    var meta = function (g) { return 'fileFormatVersion: 2\nguid: ' + g + '\n'; };
    return [
      { path: 'Assets/Scripts/Core/GameManager.cs', content: [
        'using UnityEngine;', 'using UnityEngine.Events;', 'namespace Demo.Core {',
        'public class GameManager : MonoBehaviour {',
        '  [SerializeField] private PlayerController player;',
        '  public UnityEvent onGameOver;',
        '  private void Start() { player = GetComponent<PlayerController>(); }',
        '  public void Restart(int level) { player.TakeDamage(level); onGameOver?.Invoke(); }',
        '} }', ''].join('\n') },
      { path: 'Assets/Scripts/Core/GameManager.cs.meta', content: meta('11111111111111111111111111111111') },
      { path: 'Assets/Scripts/Player/PlayerController.cs', content: [
        'using UnityEngine;', 'using UnityEngine.Events;', 'using System.Collections;',
        'using System.Collections.Generic;', 'namespace Demo.Player {',
        'public interface IDamageable { void ApplyDamage(int amount); }',
        '[RequireComponent(typeof(Rigidbody))]',
        'public class PlayerController : MonoBehaviour, IDamageable {',
        '  [SerializeField] private int hp = 100;',
        '  [SerializeField] private HealthConfig config;',
        '  public UnityEvent<int> onDeath;',
        '  public List<GameManager> observers = new List<GameManager>();',
        '  public int Hp { get => hp; set => hp = value; }',
        '  public void TakeDamage(int amount) { hp -= amount; }',
        '  public void ApplyDamage(int amount) { TakeDamage(amount); }',
        '  public IEnumerator Respawn(GameManager manager) { yield return null; }',
        '} }', ''].join('\n') },
      { path: 'Assets/Scripts/Player/PlayerController.cs.meta', content: meta('22222222222222222222222222222222') },
      { path: 'Assets/Scripts/Data/HealthConfig.cs', content: [
        'using UnityEngine;', 'namespace Demo.Data {',
        '[CreateAssetMenu(menuName = "Demo/Health")]',
        'public class HealthConfig : ScriptableObject {',
        '  public int maxHp = 100;',
        '  public float regenRate = 1.5f;',
        '} }', ''].join('\n') },
      { path: 'Assets/Scripts/Data/HealthConfig.cs.meta', content: meta('44444444444444444444444444444444') },
      { path: 'Assets/Scripts/UI/HudView.cs', content: [
        'using UnityEngine;', 'namespace Demo.UI {',
        'public class HudView : MonoBehaviour {',
        '  [SerializeField] private PlayerController player;',
        '  [SerializeField] private GameManager manager;',
        '  private void OnEnable() { if (manager) manager.onGameOver += HandleGameOver; }',
        '  private void OnDisable() { if (manager) manager.onGameOver -= HandleGameOver; }',
        '  private void HandleGameOver() { Refresh(0); }',
        '  private void SyncHp() { player.Hp = 100; }',
        '  public void Refresh(int hp) { }',
        '} }', ''].join('\n') },
      { path: 'Assets/Scripts/UI/HudView.cs.meta', content: meta('55555555555555555555555555555555') },
      { path: 'Assets/Prefabs/Player.prefab', content: [
        '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!1 &100000', 'GameObject:', '  m_Name: PlayerRoot',
        '  m_Component:', '  - component: {fileID: 300000}', '  - component: {fileID: 350000}', '  - component: {fileID: 200000}',
        '--- !u!4 &300000', 'Transform:', '  m_GameObject: {fileID: 100000}',
        '--- !u!65 &350000', 'BoxCollider:', '  m_GameObject: {fileID: 100000}', '  m_Enabled: 1',
        '--- !u!114 &200000', 'MonoBehaviour:', '  m_GameObject: {fileID: 100000}',
        '  m_Script: {fileID: 11500000, guid: 22222222222222222222222222222222, type: 3}',
        '  config: {fileID: 11400000, guid: 33333333333333333333333333333333, type: 2}', ''].join('\n') },
      { path: 'Assets/Prefabs/Player.prefab.meta', content: meta('77777777777777777777777777777777') },
      { path: 'Assets/Data/DefaultHealth.asset', content: [
        '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!114 &11400000', 'MonoBehaviour:', '  m_Name: DefaultHealth',
        '  m_Script: {fileID: 11500000, guid: 44444444444444444444444444444444, type: 3}',
        '  maxHp: 100', ''].join('\n') },
      { path: 'Assets/Data/DefaultHealth.asset.meta', content: meta('33333333333333333333333333333333') },
      { path: 'Assets/Scenes/Main.unity', content: [
        '%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!1 &500000', 'GameObject:', '  m_Name: GameRoot',
        '  m_Component:', '  - component: {fileID: 500001}', '  - component: {fileID: 600000}',
        '--- !u!4 &500001', 'Transform:', '  m_GameObject: {fileID: 500000}',
        '--- !u!114 &600000', 'MonoBehaviour:', '  m_GameObject: {fileID: 500000}',
        '  m_Script: {fileID: 11500000, guid: 11111111111111111111111111111111, type: 3}',
        '  playerPrefab: {fileID: 0, guid: 77777777777777777777777777777777, type: 3}',
        '--- !u!1001 &700000', 'PrefabInstance:', '  m_Modification:', '    m_TransformParent: {fileID: 500001}',
        '  m_SourcePrefab: {fileID: 100100000, guid: 77777777777777777777777777777777, type: 3}', ''].join('\n') },
      { path: 'Assets/Scenes/Main.unity.meta', content: meta('88888888888888888888888888888888') },
      { path: 'Assets/Scripts/Data/Demo.Data.asmdef', content: JSON.stringify({ name: 'Demo.Data', references: [] }) },
      { path: 'Assets/Scripts/Data/Demo.Data.asmdef.meta', content: meta('b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0', 'AssemblyDefinitionImporter') },
      { path: 'Assets/Scripts/UI/Demo.UI.asmdef', content: JSON.stringify({ name: 'Demo.UI', references: ['b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'] }) },
      { path: 'Assets/Scripts/UI/Demo.UI.asmdef.meta', content: meta('b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1', 'AssemblyDefinitionImporter') },
      { path: 'Assets/Scripts/Player/Demo.Player.asmdef', content: JSON.stringify({ name: 'Demo.Player', references: ['Demo.Data'] }) },
      { path: 'Assets/Scripts/Player/Demo.Player.asmdef.meta', content: meta('b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'AssemblyDefinitionImporter') },
      { path: 'Assets/Scripts/Core/Demo.Core.asmdef', content: JSON.stringify({ name: 'Demo.Core', references: ['b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0', 'Demo.Player', 'Demo.UI'] }) },
      { path: 'Assets/Scripts/Core/Demo.Core.asmdef.meta', content: meta('b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3', 'AssemblyDefinitionImporter') }
    ];
  })();

  var project = S.createEmptyProject('未扫描 Unity 工程');
  var canvas = null;
  var lastFingerprint = null, lastDiff = null, scanStats = null, summaryCache = null;
  var showMinimap = true;

  var app = {
    selection: new Set(),
    selectedEdgeId: null, selectedMemberId: null,
    focusId: null, focusNeighbors: new Set(), focusSnapshot: null, focusSide: 'both', focusDepth: 1,
    isolateSnapshot: null,
    trace: null, traceDetail: null, assemblyGroups: null,
    traceRoles: null, traceLinks: null, traceColumnBounds: null,
    canvasMode: null, memberHighlight: new Set(),
    expandedNodes: new Set(),
    leftTab: 'resources', rightTab: 'inspector',
    collapsedKinds: new Set(), showMinimap: true,
    treeQuery: '', searchQuery: '',
    getProject: function () { return project; },
    getCanvas: function () { return canvas; },
    getSummary: function () {
      if (!summaryCache) summaryCache = Analysis.summary(project);
      return summaryCache;
    },
    getLastDiff: function () { return lastDiff; },
    getScanStats: function () { return scanStats; }
  };

  function refresh() {
    summaryCache = null;
    if (canvas) { canvas.invalidateGeo(); canvas.render(); }
    UI.renderAll(app);
    var root0 = project.meta.unityRoot || '';
    Bridge.setTitle(project.meta.name + (root0 ? ' · ' + root0 : '') + ' - Unity Architect');
  }
  /** Apply a mutation to the project model and refresh all views. */
  function mutate(fn) {
    fn();
    project.meta.updatedAt = S.nowIso();
    refresh();
  }
  function setProject(p, label) {
    project = S.normalizeProject(p);
    lastFingerprint = Model.fingerprint(project);
    lastDiff = null;
    app.selection = new Set();
    app.selectedEdgeId = null; app.focusId = null; app.focusNeighbors = new Set();
    app.focusSnapshot = null; app.focusSide = 'both'; app.focusDepth = 1; app.trace = null; app.traceDetail = null; app.assemblyGroups = null;
    app.traceRoles = null; app.traceLinks = null; app.traceColumnBounds = null; app.canvasMode = null;
    app.expandedNodes = new Set();
    app.isolateSnapshot = null;
    document.body.dataset.theme = project.view.theme;
    refresh();
    if (canvas) setTimeout(function () { canvas.fit(); }, 30);
    if (label) UI.toast(label);
  }

  app.loadProjectObject = function (p, label) { setProject(p, label); };

  app.setSelection = function (ids, edgeId, memberId) {
    app.selection = ids instanceof Set ? ids : new Set(ids || []);
    app.selectedEdgeId = edgeId || null;
    app.selectedMemberId = memberId || null;
    UI.renderSelection(app);
    if (canvas) canvas.render();
  };
  app.selectNode = function (id, additive) {
    var next = new Set(additive ? app.selection : []);
    if (additive && next.has(id)) next.delete(id); else next.add(id);
    app.setSelection(next, null, null);
  };
  app.onHover = function (hover) {
    if (!hover) { UI.el('status-left').textContent = '就绪'; return; }
    var label = hover.type === 'edge' ? '关系' : (hover.type === 'member' ? '成员' : '节点');
    UI.el('status-left').textContent = '悬停：' + label;
  };
  app.onRenderDone = function (info) {
    UI.el('zoom-label').textContent = Math.round(project.view.scale * 100) + '%';
    void info;
  };
  app.resizeCanvas = function () { if (canvas) canvas.resize(); };
  app.setTab = function (side, tab) {
    if (side === 'left') app.leftTab = tab; else app.rightTab = tab;
    document.querySelectorAll('.panel-tabs').forEach(function (bar) {
      if (bar.dataset.panel !== side) return;
      bar.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    });
    UI.renderLeft(app); UI.renderRight(app);
  };

  app.onContextMenu = function (x, y, hit) {
    var items = [];
    if (hit.type === 'node' || hit.type === 'member') {
      // 右键即选中：菜单里的定位/聚焦/追踪都以被右键的节点为准。
      app.setSelection(new Set([hit.nodeId]), null, hit.type === 'member' ? hit.id : null);
      var n = Model.getNode(project, hit.nodeId);
      var mem = (hit.type === 'member' && n) ? n.members.find(function (m) { return m.id === hit.id; }) : null;
      var inFocus = app.canvasMode === 'focus';
      items = [
        { label: '定位到 ' + (n ? n.name : ''), action: 'goto', data: { id: hit.nodeId }, key: 'F' },
        { label: inFocus ? '取消聚焦依赖' : '聚焦依赖', action: inFocus ? 'unfocus' : 'focus', key: 'G' }
      ];
      if (mem && (mem.kind === 'field' || mem.kind === 'property')) {
        items.push({ label: '数据流向 · ' + mem.name, action: 'trace-field',
          data: { field: mem.name, type: n.sourceKey || '' }, key: 'T' });
      } else if (mem && mem.kind === 'method') {
        items.push({ label: '方法追踪 · ' + mem.name, action: 'trace-method',
          data: { method: mem.name, type: n.sourceKey || '' }, key: 'T' });
      } else {
        items.push({ label: '数据流向', action: 'trace-field', data: {}, key: 'T' });
      }
      if (mem && mem.kind === 'event') {
        items.push({ label: '事件追踪 · ' + mem.name, action: 'trace-event',
          data: { event: mem.name, type: n.sourceKey || '' } });
      }
      items.push({ sep: true }, { label: '隐藏节点', action: 'toggle-visible', data: { id: hit.nodeId } });
    } else if (hit.type === 'edge') {
      items = [
        { label: '查看关系', action: 'select-edge', data: { id: hit.id } }
      ];
    } else {
      items = [
        { label: '适应画布', action: 'fit', data: {} },
        { label: '分层布局', action: 'layout-layered', data: {} }
      ];
    }
    UI.contextMenu(x, y, items, app);
  };
  app.onDoubleClick = function (hit) {
    if (hit.type === 'node' || hit.type === 'member') app.action('goto', { id: hit.nodeId });
    else if (canvas) canvas.fit();
  };

  // ------------------------------------------------------------------ fields
  app.updateField = function (field, value, id) {
    if (field === 'nodeFilter' || field === 'edgeFilter') {
      mutate(function () { project.settings[field][id] = !!value; });
      return;
    }
    if (field === 'showMembers') { mutate(function () { project.settings.showMembers = !!value; }); return; }
    if (field === 'minimap') {
      app.showMinimap = showMinimap = !!value;
      if (canvas) canvas.setMinimap(showMinimap);
      return;
    }
    if (field === 'layout') { project.settings.layout = value; return; }
  };

  // ------------------------------------------------------------------ actions
  function runScan(parsed, rootPath, quiet) {
    if (!parsed || !parsed.nodes) { UI.toast('未解析到任何文件'); return; }
    exitModeSilent();
    var before = Model.fingerprint(project);
    var addedCount = 0, purgedCount = 0;
    mutate(function () {
      var result = Model.mergeScan(project, parsed, { removeStale: true });
      addedCount = result.addedNodes.length;
      purgedCount = result.staleNodes.length;
      // 工程名只取目录名，完整路径放 unityRoot，避免标题重复显示两遍路径。
      project.meta.name = rootPath ? rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : project.meta.name;
      project.meta.unityRoot = rootPath || project.meta.unityRoot;
      if (addedCount > 0) {
        var layout = project.settings.layout === 'grid' ? Layout.gridLayout(project) : Layout.layeredLayout(project);
        Layout.applyPositions(project, layout.positions);
      }
    });
    lastFingerprint = before;
    lastDiff = Model.diffFingerprints(before, Model.fingerprint(project));
    scanStats = parsed.stats;
    app.focusId = null; app.focusNeighbors = new Set(); app.focusSnapshot = null;
    app.trace = null; app.traceDetail = null; app.assemblyGroups = null;
    app.traceRoles = null; app.traceLinks = null; app.traceColumnBounds = null;
    app.expandedNodes = new Set();
    app.isolateSnapshot = null;
    setTimeout(function () { canvas.fit(); }, 20);
    if (quiet) return;
    var d = lastDiff;
    UI.modal({
      title: '扫描完成',
      body: '<div class="stat-grid">' +
        '<div class="stat"><b>' + parsed.stats.csFiles + '</b><span>脚本</span></div>' +
        '<div class="stat"><b>' + parsed.stats.types + '</b><span>类型</span></div>' +
        '<div class="stat"><b>' + parsed.stats.nodes + '</b><span>节点</span></div>' +
        '<div class="stat"><b>' + parsed.stats.edges + '</b><span>关系</span></div></div>' +
        '<div class="notice info">新增节点 ' + d.addedNodes.length + ' · 成员变更 ' + d.changedNodes.length +
        ' · 新增关系 ' + d.addedEdges.length + ' · 移除关系 ' + d.removedEdges.length +
        (purgedCount ? ' · <b style="color:var(--danger)">清除失效节点 ' + purgedCount + ' 个</b>' : '') +
        ' · 耗时 ' + parsed.stats.elapsedMs + ' ms</div>' +
        (parsed.stats.truncated ? '<div class="notice warn">达到扫描上限（2 万文件 / 48MB），部分文件未纳入</div>' : '') +
        (parsed.stats.unknownGuids ? '<div class="notice warn">有 ' + parsed.stats.unknownGuids + ' 个 GUID 未解析（可能来自 Packages 或未纳入的目录）</div>' : '') +
        (parsed.stats.unresolvedScriptComps ? '<div class="notice warn">有 ' + parsed.stats.unresolvedScriptComps + ' 个脚本组件未能识别名称：官方包脚本（EventSystem 等）需选择<b>工程根目录</b>重新扫描（包含 Library），也可能来自已删除脚本的失效引用</div>' : '') +
        (parsed.warnings.length ? '<div class="notice warn">解析提示 ' + parsed.warnings.length + ' 条，例如：' + esc(parsed.warnings[0].text) + '</div>' : '') +
        '<div class="notice info">布局位置会在重新扫描时保留。</div>',
      buttons: [{ label: '完成', primary: true }]
    });
  }

  function showScanError(e) {
    var msg = '读取失败：' + (e && e.message ? e.message : e);
    if (e && e.scanHint) {
      UI.modal({
        title: '无法读取 Unity 工程目录',
        body: '<div class="notice warn">' + esc(msg) + '</div>' +
          '<div class="notice info">' + esc(e.scanHint) + '</div>',
        buttons: [{ label: '知道了', primary: true }]
      });
    } else UI.toast(msg, 6000);
  }

  function doScan(options) {
    var opts = options || {};
    UI.toast(opts.rescan ? '正在重新读取已绑定目录…' : '正在读取 Unity 工程目录…');
    return Promise.resolve(Bridge.scanUnity(opts)).then(function (r) {
      if (!r) return;
      runScan(r.parsed, r.rootPath);
      if (r.mode === 'fsa') UI.toast('已绑定「' + r.rootPath + '」· 下次打开本页自动读取', 4600);
      else if (r.mode === 'drop') UI.toast('已从拖入目录生成关系图', 3600);
      if (r.truncated) UI.toast('达到扫描上限，部分文件未纳入', 4600);
    }).catch(showScanError);
  }

  /** Focus edge kind → role badge text (drawn next to the referencing member row). */
  var FOCUS_ROLE = {
    compose: '组合', aggregate: '聚合', serialize: '序列化', depend: '依赖',
    use: '引用', event: '引用', inherit: '继承', implement: '实现'
  };

  /** Focus mode member badges: mark which member of each neighbour references the focused type. */
  function buildFocusRoles(fid, keep) {
    var roles = Object.create(null);
    project.edges.forEach(function (e) {
      var holder;
      if (e.to === fid && keep.has(e.from)) holder = e.from;        // neighbour references focus
      else if (e.from === fid && keep.has(e.to)) holder = e.from;   // focus references neighbour
      else return;
      var node = Model.getNode(project, holder);
      if (!node) return;
      var text = FOCUS_ROLE[e.kind] || '引用';
      var memberName = e.label && (node.members || []).some(function (m) { return m.name === e.label; })
        ? e.label : null;
      addRole(roles, holder, text, memberName);
    });
    return roles;
  }

  /** Focus mode: re-layout only the dependency neighbourhood (upstream left, downstream right). */
  function applyFocusLayout(fid, depth, side) {
    if (!Model.getNode(project, fid)) return;
    var res = Layout.focusLayout(project, fid, { depth: depth, side: side });
    if (res.ids.length <= 1) { UI.toast('该节点还没有引用关系'); return; }
    exitModeSilent();
    traceSnapshot();
    var keep = new Set(res.ids);
    Layout.applyPositions(project, res.positions);
    project.nodes.forEach(function (n) { n.visible = keep.has(n.id); });
    app.focusId = fid;
    app.focusNeighbors = keep;
    app.focusSide = side;
    app.focusDepth = depth;
    app.canvasMode = 'focus';
    app.traceRoles = buildFocusRoles(fid, keep);
    if (canvas) { canvas.invalidateGeo(); canvas.render(); }
    UI.renderAll(app);
    setTimeout(function () { if (canvas) canvas.fit(); }, 20);
    UI.toast('聚焦 · 引用它 ' + res.counts.up + ' 个 · 它依赖 ' + res.counts.down + ' 个' +
      (side === 'in' ? '（只看上游）' : (side === 'out' ? '（只看下游）' : '')));
  }

  function exitFocusLayout() {
    if (app.focusSnapshot) {
      project.nodes.forEach(function (n) {
        var p = app.focusSnapshot.positions[n.id];
        if (p) { n.position.x = p.x; n.position.y = p.y; }
        if (app.focusSnapshot.visible[n.id] !== undefined) n.visible = app.focusSnapshot.visible[n.id];
      });
    }
    app.focusSnapshot = null;
    app.focusId = null; app.focusNeighbors = new Set(); app.focusSide = 'both'; app.focusDepth = 1;
    app.trace = null; app.traceDetail = null; app.assemblyGroups = null;
    app.traceRoles = null; app.traceLinks = null; app.traceColumnBounds = null;
    app.canvasMode = null;
    if (canvas) { canvas.invalidateGeo(); canvas.render(); }
    UI.renderAll(app);
    setTimeout(function () { if (canvas) canvas.fit(); }, 20);
    UI.toast('已退出聚焦，布局已还原');
  }

  /** 静默退出当前画布模式（聚焦/追踪/Assembly）：还原快照、清空模式状态。
   *  模式互斥：进入任一模式前先调用，避免层带矩形与节点位置脱节。 */
  function exitModeSilent() {
    if (app.focusSnapshot) {
      project.nodes.forEach(function (n) {
        var p = app.focusSnapshot.positions[n.id];
        if (p) { n.position.x = p.x; n.position.y = p.y; }
        if (app.focusSnapshot.visible[n.id] !== undefined) n.visible = app.focusSnapshot.visible[n.id];
      });
    }
    app.focusSnapshot = null;
    app.focusId = null; app.focusNeighbors = new Set(); app.focusSide = 'both'; app.focusDepth = 1;
    app.trace = null; app.traceDetail = null; app.assemblyGroups = null;
    app.traceRoles = null; app.traceLinks = null; app.traceColumnBounds = null;
    app.canvasMode = null;
  }

  /** Snapshot positions/visibility once so any trace/assembly view can restore. */
  function traceSnapshot() {
    if (!app.focusSnapshot) {
      app.focusSnapshot = { positions: Object.create(null), visible: Object.create(null) };
      project.nodes.forEach(function (n) {
        app.focusSnapshot.positions[n.id] = { x: n.position.x, y: n.position.y };
        app.focusSnapshot.visible[n.id] = n.visible !== false;
      });
    }
  }

  /** Apply a trace/assembly layout result: hide the rest, refocus, redraw. */
  function commitTrace(lay, focusId0, extra) {
    var keep = new Set(lay.ids);
    Layout.applyPositions(project, lay.positions);
    project.nodes.forEach(function (n) { n.visible = keep.has(n.id); });
    app.focusId = focusId0 || null;
    app.focusNeighbors = keep;
    app.traceColumnBounds = lay.columnBounds || null;
    app.traceRoles = (extra && extra.roles) || null;
    app.traceLinks = (extra && extra.links) || null;
    if (canvas) { canvas.invalidateGeo(); canvas.render(); }
    UI.renderAll(app);
    setTimeout(function () { if (canvas) canvas.fit(); }, 20);
  }

  var ROLE_TONE = S.ROLE_TONE;

  /** Attach a role badge to a class (member=null → header) or one of its methods. */
  function addRole(roles, id, role, member) {
    if (!id) return;
    var list = roles[id] = roles[id] || [];
    var key = role + '|' + (member || '');
    if (list.some(function (r) { return (r.role + '|' + (r.member || '')) === key; })) return;
    list.push({ role: role, member: member || null });
  }

  /** Event trace: definitions left, subscribers middle, firers right; exit restores layout. */
  function applyEventTrace(eventName, typeKey) {
    var res = Analysis.traceEvent(project, eventName, typeKey || '');
    if (!res.definitions.length) { UI.toast('没有找到声明了「' + eventName + '」事件的类'); return; }
    exitModeSilent(); traceSnapshot();
    var defId = res.definitions[0].id;
    var roles = Object.create(null), links = [];
    res.definitions.forEach(function (d) { addRole(roles, d.id, '定义', eventName); });
    res.subscribers.forEach(function (s) {
      (s.details || []).forEach(function (d) {
        addRole(roles, s.id, d.action === 'unsubscribe' ? '注销' : '注册', d.method);
      });
      if (s.id !== defId) links.push({ from: s.id, to: defId, label: '注册', color: ROLE_TONE['注册'] });
    });
    res.firers.forEach(function (f) {
      (f.details || []).forEach(function (d) { addRole(roles, f.id, '激活', d.method); });
      if (f.id !== defId) links.push({ from: f.id, to: defId, label: '激活', color: ROLE_TONE['激活'] });
    });
    var lay = Layout.eventTraceLayout(project, res);
    commitTrace(lay, defId, { roles: roles, links: links });
    app.canvasMode = 'event';
    app.trace = { kind: 'event', name: eventName, type: typeKey || '' };
    app.traceDetail = {
      title: '所有引用 · 事件「' + (typeKey ? res.definitions[0].name + '.' : '') + eventName + '」',
      stat: '定义 ' + res.definitions.length + ' · 注册/注销 ' + res.subscribers.length + ' · 激活 ' + res.firers.length,
      groups: res.details
    };
    UI.toast('事件追踪「' + eventName + '」· 定义 ' + res.definitions.length +
      ' · 注册 ' + res.subscribers.length + ' · 激活 ' + res.firers.length + '（再点一次退出）');
    UI.syncToolbar(app);
  }

  /** Field/property references: 字段类型 | 声明 | 写入 | 读取 columns; exit restores layout. */
  function applyFieldTrace(fieldName, typeKey) {
    var res = Analysis.traceField(project, fieldName, typeKey);
    if (!res.definitions.length) { UI.toast('没有找到名为「' + fieldName + '」的变量或属性'); return; }
    exitModeSilent(); traceSnapshot();
    var defId = res.definitions[0].id;
    var roles = Object.create(null), links = [];
    res.definitions.forEach(function (d) { addRole(roles, d.id, '定义', fieldName); });
    res.writers.forEach(function (w) {
      (w.details || []).forEach(function (d) { addRole(roles, w.id, '写入', d.method); });
      if (w.id !== defId) links.push({ from: w.id, to: defId, label: '写入', color: ROLE_TONE['写入'] });
    });
    res.readers.forEach(function (r) {
      (r.details || []).forEach(function (d) { addRole(roles, r.id, '读取', d.method); });
      if (r.id !== defId) links.push({ from: r.id, to: defId, label: '读取', color: ROLE_TONE['读取'] });
    });
    (res.typeClasses || []).forEach(function (tc) {
      addRole(roles, tc.id, '字段类型', null);
      if (tc.id !== defId) links.push({ from: defId, to: tc.id, label: '类型', color: ROLE_TONE['字段类型'] });
    });
    var lay = Layout.fieldTraceLayout(project, res);
    commitTrace(lay, defId, { roles: roles, links: links });
    app.canvasMode = 'field';
    app.trace = { kind: 'field', name: fieldName, type: typeKey || '' };
    app.traceDetail = {
      title: '所有引用 · 「' + fieldName + '」',
      stat: '声明 ' + res.definitions.length + ' · 写入 ' + res.writers.length + ' · 读取 ' + res.readers.length,
      groups: res.details
    };
    UI.toast('数据流向「' + fieldName + '」· 声明 ' + res.definitions.length +
      ' · 写入 ' + res.writers.length + ' · 读取 ' + res.readers.length + '（再点一次退出）');
    UI.syncToolbar(app);
  }

  /** Method references: 定义 | 调用 columns; exit restores layout. */
  function applyMethodTrace(methodName, typeKey) {
    var res = Analysis.traceMethod(project, methodName, typeKey);
    if (!res.definitions.length) { UI.toast('没有找到名为「' + methodName + '」的方法'); return; }
    exitModeSilent(); traceSnapshot();
    var defId = res.definitions[0].id;
    var roles = Object.create(null), links = [];
    res.definitions.forEach(function (d) {
      addRole(roles, d.id, '定义', methodName);
    });
    res.callers.forEach(function (c) {
      (c.details || []).forEach(function (d) { addRole(roles, c.id, '调用', d.method); });
      if (c.id !== defId) links.push({ from: c.id, to: defId, label: '调用', color: ROLE_TONE['调用'] });
    });
    var lay = Layout.methodTraceLayout(project, res);
    commitTrace(lay, defId, { roles: roles, links: links });
    app.canvasMode = 'method';
    app.trace = { kind: 'method', name: methodName, type: typeKey || '' };
    app.traceDetail = {
      title: '所有引用 · 方法「' + methodName + '」',
      stat: '定义 ' + res.definitions.length + ' · 调用 ' + res.callers.length,
      groups: res.details
    };
    UI.toast('方法引用「' + methodName + '」· 定义 ' + res.definitions.length +
      ' · 调用方 ' + res.callers.length + '（再点一次退出）');
    UI.syncToolbar(app);
  }

  /** Assembly layered view: one horizontal band per AssemblyDefinition, top→bottom. */
  function applyAssemblyLayout() {
    if (!project.assemblies || !project.assemblies.length) {
      UI.toast('工程中没有 AssemblyDefinition（.asmdef），无法按程序集分层');
      return;
    }
    var res = Layout.assemblyLayout(project);
    if (!res.ids.length) { UI.toast('画布上没有可分层的节点'); return; }
    exitModeSilent(); traceSnapshot();
    commitTrace(res, null);
    app.assemblyGroups = res.groups;
    app.canvasMode = 'assembly';
    if (canvas) { canvas.invalidateGeo(); canvas.render(); }
    UI.syncToolbar(app);
    UI.toast('Assembly 分层 · 主链：' + res.groups.slice(0, res.mainCount).map(function (g) { return g.label; }).join(' → ') +
      (res.sideCount ? ' ｜ 侧栏：' + res.groups.slice(res.mainCount).map(function (g) { return g.label; }).join('、') : '') + '（再点一次退出）');
  }

  function pickFieldAndTrace(node) {
    var flds = node ? (node.members || []).filter(function (m) { return m.kind === 'field' || m.kind === 'property'; }) : [];
    if (!flds.length) { UI.toast('选中的节点没有变量 / 属性成员，请在检查器里点成员旁的 ⇥ 按钮'); return; }
    if (flds.length === 1) { applyFieldTrace(flds[0].name, node.sourceKey || ''); return; }
    UI.modal({
      title: '选择要追踪的变量 / 属性',
      body: '<div>' + flds.map(function (m) {
        return '<div class="diff-list"><div data-action="trace-field" data-field="' + esc(m.name) +
          '" data-type="' + esc(node.sourceKey || '') + '" style="padding:7px 8px;cursor:pointer;border-bottom:1px dashed var(--border)"><b>' + esc(m.name) +
          '</b> <span style="color:var(--text3)">: ' + esc(m.type || 'var') + '</span></div></div>';
      }).join('') + '</div>',
      buttons: [{ label: '取消' }]
    });
  }

  function pickEventAndTrace(node) {
    var evs = node ? (node.members || []).filter(function (m) { return m.kind === 'event'; }) : [];
    if (!evs.length) { UI.toast('选中的节点没有事件成员，请在检查器里点事件旁的 ⚡ 按钮'); return; }
    if (evs.length === 1) { applyEventTrace(evs[0].name, node.sourceKey || ''); return; }
    UI.modal({
      title: '选择要追踪的事件',
      body: '<div>' + evs.map(function (m) {
        return '<div class="diff-list"><div data-action="trace-event" data-event="' + esc(m.name) +
          '" data-type="' + esc(node.sourceKey || '') + '" style="padding:7px 8px;cursor:pointer;border-bottom:1px dashed var(--border)"><b>' + esc(m.name) +
          '</b> <span style="color:var(--text3)">: ' + esc(m.type || 'var') + '</span></div></div>';
      }).join('') + '</div>',
      buttons: [{ label: '取消' }]
    });
  }

  function loadDemo() {
    setProject(S.createEmptyProject('示例工程 · Battle 系统'));
    var parsed = UA.UnityParser.parseProject(DEMO_FILES, {});
    runScan(parsed, '示例工程 · Battle 系统');
  }

  /** 导出 Markdown 引用清单：统计、程序集、类型成员、挂载与组件组成、关系表。 */
  function exportMarkdown() {
    var sm = app.getSummary();
    var byId = Object.create(null);
    project.nodes.forEach(function (n) { byId[n.id] = n; });

    // Usage maps built once from all memberRefs records (VS find-all-references).
    var eventSubs = Object.create(null), eventFires = Object.create(null);
    var fieldUses = Object.create(null);   // typeKey#field -> [{ from, method, action, via, snippet }]
    var callers = Object.create(null);     // typeKey#member -> [{ from, method, via }]
    project.nodes.forEach(function (n) {
      (n.members || []).forEach(function (m) {
        (m.memberRefs || []).forEach(function (u) {
          var rec = { from: n.name, method: m.name, action: u.action, via: u.via, snippet: u.snippet };
          if (u.action === 'fire') {
            (eventFires[u.name] = eventFires[u.name] || []).push(rec);
          } else if (u.action === 'subscribe' || u.action === 'unsubscribe') {
            (eventSubs[u.name] = eventSubs[u.name] || []).push(rec);
          } else if (u.action === 'write' || u.action === 'read') {
            (fieldUses[(u.type || '') + '#' + u.name] = fieldUses[(u.type || '') + '#' + u.name] || []).push(rec);
          } else if (u.action === 'call') {
            (callers[(u.type || '') + '#' + u.name] = callers[(u.type || '') + '#' + u.name] || []).push(rec);
          }
        });
      });
    });
    function usesOf(map, sourceKey, name) {
      return map[(sourceKey || '') + '#' + name] || []; // 接收者解析不到类型的一律不计入
    }
    function names(list) {
      return (list || []).map(function (x) {
        return '`' + x.from + (x.method ? '.' + x.method : '') + '`' + (x.via ? '（经 `' + x.via + '`）' : '');
      }).join('、');
    }

    var lines = ['# ' + project.meta.name + ' · 引用关系清单', '',
      '> 由 Unity Architect 生成 · ' + new Date().toLocaleString('zh-CN'), '',
      '## 统计', '',
      '- 节点：' + sm.nodes + '（可见 ' + sm.visibleNodes + '）',
      '- 关系：' + sm.edges,
      '- 循环依赖：' + sm.cycles.length,
      '- 孤立节点：' + sm.isolated.length, ''];

    if (project.assemblies && project.assemblies.length) {
      lines.push('## 程序集', '');
      project.assemblies.forEach(function (a) {
        lines.push('- `' + a.name + '`' +
          (a.refs && a.refs.length ? ' → 依赖 ' + a.refs.map(function (r) { return '`' + r + '`'; }).join('、') : '（无项目内依赖）'));
      });
      lines.push('');
    }

    lines.push('## 类型', '');
    project.nodes.forEach(function (n) {
      lines.push('### ' + n.name + ' · ' + (S.NODE_KINDS[n.kind] || {}).label);
      if (n.namespace) lines.push('- 命名空间：`' + n.namespace + '`');
      if (n.filePath) lines.push('- 文件：`' + n.filePath + '`');
      if (n.baseTypes.length) lines.push('- 基类 / 接口：' + n.baseTypes.join(', '));
      var mounts = project.edges.filter(function (e) { return e.kind === 'attach' && e.to === n.id && byId[e.from]; });
      if (mounts.length) {
        lines.push('- 挂载于：' + mounts.map(function (e) {
          return '`' + byId[e.from].name + '`' + (byId[e.from].filePath ? '（' + byId[e.from].filePath + '）' : '');
        }).join('、'));
      }
      // GameObject / 预制体 / 场景节点：列出挂载了哪些脚本。
      var attached = project.edges.filter(function (e) { return e.kind === 'attach' && e.from === n.id && byId[e.to]; });
      if (attached.length) {
        lines.push('- 挂载脚本：' + attached.map(function (e) {
          return '`' + byId[e.to].name + '`';
        }).join('、'));
      }
      // 完整组件组成（内置组件 + 脚本组件，按 YAML 顺序）。
      if (n.components && n.components.length) {
        lines.push('- 组件组成（' + n.components.length + '）：' + n.components.map(function (c) {
          return '`' + c.type + '`' + (c.nodeKey ? '（脚本）' : '') + (c.enabled === false ? '（未启用）' : '');
        }).join('、'));
      }

      var groups2 = [
        { label: '变量', test: function (m) { return m.kind === 'field'; } },
        { label: '事件', test: function (m) { return m.kind === 'event'; } },
        { label: '属性', test: function (m) { return m.kind === 'property'; } },
        { label: '方法', test: function (m) { return m.kind === 'method'; } }
      ];
      groups2.forEach(function (g) {
        var list = n.members.filter(g.test);
        if (!list.length) return;
        lines.push('', '#### ' + g.label, '');
        list.forEach(function (m) {
          lines.push('- `' + Layout.memberLine(m) + '`' + (m.isSerialized ? ' _(序列化)_' : ''));
          if (g.label === '变量' || g.label === '属性') {
            var uses = usesOf(fieldUses, n.sourceKey, m.name);
            var ws = uses.filter(function (u) { return u.action === 'write'; });
            var rs = uses.filter(function (u) { return u.action === 'read'; });
            if (ws.length) lines.push('  - 写入：' + names(ws));
            if (rs.length) lines.push('  - 读取：' + names(rs));
          } else if (g.label === '事件') {
            var subs = eventSubs[m.name] || [], fires = eventFires[m.name] || [];
            if (subs.length) lines.push('  - 注册 / 注销：' + names(subs));
            if (fires.length) lines.push('  - 触发：' + names(fires));
          } else if (g.label === '方法') {
            var cs = usesOf(callers, n.sourceKey, m.name);
            if (cs.length) lines.push('  - 被调用：' + names(cs));
          }
        });
      });
      lines.push('');
    });

    lines.push('## 关系', '');
    project.edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      lines.push('- `' + a.name + '` **' + (S.EDGE_KINDS[e.kind] || {}).label + '** `' + b.name + '`' +
        (e.label ? ' · ' + e.label : '') + (e.note ? ' · ' + e.note : ''));
    });
    Bridge.exportFile('md', lines.join('\n'), project.meta.name + '.md').then(function () { UI.toast('Markdown 已导出'); });
  }

  var HELP_HTML = [
    '<div style="max-height:62vh;overflow:auto;line-height:1.9;font-size:13px">',
    '<p><b>Unity Architect</b> · Unity 类关系梳理工具（纯 HTML 单文件版）</p>',
    '<h4>一、快速上手</h4>',
    '<ol style="padding-left:18px">',
    '<li>点工具栏 <b>扫描 Unity 工程</b>，选择工程根目录（含 Assets 文件夹）；授权一次后，下次打开会自动重新读取</li>',
    '<li>或直接把工程根目录 / Assets 文件夹<b>拖进窗口</b>；没有目录权限时用菜单「文件 → 选择文件夹（兼容模式）」</li>',
    '<li>点 <b>载入示例工程</b> 可以先看功能效果</li>',
    '</ol>',
    '<h4>二、扫描范围</h4>',
    '<ul style="padding-left:18px">',
    '<li>每次扫描固定覆盖三类内容：<b>脚本</b>（.cs 类型、成员、脚本间依赖）、<b>场景与预制体挂载</b>（脚本挂在哪些 GameObject 上）、<b>SO 资源实例</b>（.asset 文件解析成资源节点，并按序列化字段名连出引用线）</li>',
    '<li>贴图、音频、材质等其余资源一律不导入；AssemblyDefinition（.asmdef）只作为<b>分层元数据</b>读取，不生成节点；Unity 自身的 ProjectSettings / Packages / Library 也永远不会导入</li>',
    '<li>左栏「筛选 → 层级（一键切换）」：扫描后不改文件、即时切换画布显示层级（仅脚本 / 含挂载 / 全部）</li>',
    '<li>删除过的脚本重新扫描后自动清除，布局位置会保留</li>',
    '</ul>',
    '<h4>三、查找所有引用（Visual Studio 式）</h4>',
    '<ul style="padding-left:18px">',
    '<li>检查器里每个成员旁都有按钮：变量/属性 ⇥、事件 ⚡、方法 ⇥；点击即在画布上把<b>所有引用位置</b>聚拢成列，并在右侧列出每个引用的<b>类、方法与代码行</b>（就像 VS 的「查找所有引用」结果列表）；<b>右键成员行</b>的菜单里也有同样的入口，或用快捷键 <b>T</b> 对选中节点的字段开数据流向</li>',
    '<li><b>事件追踪 ⚡</b>：只追踪你点的那个类里的事件，两个类都写了同名的 <code>Changed</code> 也不会串（如 <code>G1State.Changed</code> 与 <code>TowerGameState.Changed</code> 各自独立）</li>',
    '<li>追踪时节点上直接标角色：<b>定义 / 激活</b> 标在声明并触发它的类上，<b>注册</b> 标在调用它的方法（如 <code>Bind</code>）旁边，并画出「注册 / 激活 → 定义」的箭头；激活发生在别的类时同样补一条箭头</li>',
    '<li><b>数据流向 ⇥</b>：列依次是「字段类型」（最左，这个字段指向的对象）、「声明」（含初始值）、「写入」、「读取」；即使引用都发生在同一个类里，也能看到它指向的类型对象</li>',
    '<li><b>方法 ⇥</b>：左列「定义」、右列「调用」；方法组引用（如 <code>+= Refresh</code>）也算一处引用。只按接收者类型归因——解析不了接收者的引用（反射、局部变量上的调用）一律不计入，工具类里的 <code>set.Contains(...)</code> 不会被误算成别的类的同名方法</li>',
    '<li>再点一次同一按钮（或 Esc）退出追踪并还原布局</li>',
    '</ul>',
    '<h4>四、Assembly 分层视图</h4>',
    '<ul style="padding-left:18px">',
    '<li>工具栏 <b>Assembly 分层</b>：按 .asmdef 的 references 关系<b>自上而下</b>分层——主链在左侧一列、全部左对齐：没人引用它的入口程序集（如 Boot）在最上层，它依赖的层排在下一行（如 Boot → GamePlay / UI 平级同一行 → Data → Core）</li>',
    '<li><b>SO 资源、预制体、GameObject 层、Editor 程序集全部放右侧栏</b>（彼此左对齐、纵向分布），不与主链混在一起；SO 资源实例卡片右上角带 <b>SO.asset</b> 徽章；GameObject / 预制体卡片上的组件行带有<b>类型图标</b>（移动轴 / 碰撞盒 / 相机 / 灯光 / 声音 / 动画…），自定义脚本显示蓝色 C# 图标，官方包脚本（EventSystem 等）也能解析出真实名字</li>',
    '</ul>',
    '<h4>五、画布操作</h4>',
    '<ul style="padding-left:18px">',
    '<li>工具栏 <b>事件 / 协程 / UnityEvent / 委托</b> 四个高亮开关：点亮的类别成员文字变醒目颜色并加粗，再点一次恢复</li>',
    '<li>聚焦依赖 / 事件追踪 / 数据流向 / Assembly 分层 / 孤立选中 是<b>互斥模式</b>：切入新模式时旧模式自动退出还原，当前模式按钮持续发光；再点一次（或 Esc）退出</li>',
    '<li>右键菜单：<b>定位到（F）</b>、<b>聚焦依赖 / 取消聚焦依赖（G）</b>、<b>数据流向（T）</b>；右键到成员行时追踪直接对准该成员</li>',
    '<li>滚轮缩放、空白处拖动平移、节点拖拽移动、框选多选、双击节点定位；Ctrl+K 全局检索、Ctrl+A 全选、F 适应画布、Esc 退出当前模式</li>',
    '<li>默认黑色主题，右上「主题」可切换明暗；小地图可在「筛选 → 显示」里关闭</li>',
    '</ul>',
    '<h4>六、导出</h4>',
    '<ul style="padding-left:18px">',
    '<li><b>导出 Markdown</b>：按 变量 / 事件 / 属性 / 方法 分组，事件列出注册与触发方、方法列出被谁调用、变量列出写入与读取方，另含程序集依赖与挂载对象清单</li>',
    '<li><b>导出 PNG</b>：当前画布截图</li>',
    '<li><b>GameObject / 预制体组成</b>：场景与预制体对象卡片上直接列出「组件」清单（Transform / Rigidbody / 自定义脚本…，按 YAML 顺序）；点脚本组件可跳到对应脚本节点。场景里的 <code>PrefabInstance</code> 会以「组合 · 预制体实例」边连到预制体对象，预制体根节点显示为「预制体」类型；组件过多时点「▼ 还有 N 个组件」展开全部</li>',
    '<li>标题栏与「工程」页会显示当前扫描的 Unity 工程名与目录，随时确认正在观察哪个工程（浏览器只能拿到文件夹名，桌面版显示完整路径）</li>',
    '<li>本工具是<b>纯扫描查看器</b>：所有节点与关系都来自扫描结果，没有新建 / 打开 / 保存工程、撤销重做和手动编辑结构的功能；重新扫描即得到最新结构</li>',
    '</ul>',
    '<h4>七、常见问题</h4>',
    '<ul style="padding-left:18px">',
    '<li>扫描后没有反应 / 提示失败：确认选的是工程根目录（里面有 Assets 文件夹），或改用拖入 / 兼容模式</li>',
    '<li>事件追踪 / 数据流向显示为空：需要<b>重新扫描一次</b>生成方法体使用记录（旧存档没有这个数据）</li>',
    '<li>本工具是纯查看器：所有节点与关系都来自扫描结果，不支持手工创建；重新扫描会刷新全部内容</li>',
    '<li>浏览器安全模型不允许后台静默读盘，这是系统限制；本工具用「一次授权 + 自动重扫 / 拖放」做到最接近自动</li>',
    '</ul>',
    '</div>'
  ].join('\n');

  function action(name, data) {
    var id = data && data.id;
    switch (name) {
      case 'scan': doScan(); break;
      case 'rescan': doScan({ rescan: true }); break;
      case 'scan-legacy': doScan({ legacy: true }); break;
      case 'unlink-dir':
        Bridge.clearLinkedDir().then(function () {
          UI.toast('已解除目录绑定');
          var hint = UI.el('desktop-hint');
          if (hint) hint.textContent = 'HTML 版 · 可拖入 Unity 工程文件夹';
        });
        break;
      case 'load-demo': loadDemo(); break;
      case 'show-help':
        UI.modal({ title: '使用说明 · Unity Architect', body: HELP_HTML, buttons: [{ label: '知道了', primary: true }] });
        break;
      case 'fit': if (canvas) canvas.fit(); break;
      case 'zoom-in': if (canvas) canvas.zoom(1.2); refreshStatusOnly(); break;
      case 'zoom-out': if (canvas) canvas.zoom(1 / 1.2); refreshStatusOnly(); break;
      case 'layout-layered': case 'layout-grid':
        exitModeSilent();
        mutate(function () {
          var res = name === 'layout-grid' ? Layout.gridLayout(project) : Layout.layeredLayout(project);
          Layout.applyPositions(project, res.positions);
          project.settings.layout = name === 'layout-grid' ? 'grid' : 'layered';
        });
        if (canvas) canvas.fit(); UI.toast('布局已更新');
        break;
      case 'select-edge': app.setSelection(new Set(), id, null); app.setTab('right', 'inspector'); break;
      case 'goto':
        if (!id) break;
        app.setSelection(new Set([id]), null, null);
        canvas.flyTo(id);
        break;
      case 'focus': {
        if (!app.selection.size) { UI.toast('请先选中一个节点'); break; }
        var fid = Array.from(app.selection)[0];
        if (app.canvasMode === 'focus') { exitFocusLayout(); break; }
        applyFocusLayout(fid, 1, 'both');
        break;
      }
      case 'focus-side': {
        if (!app.selection.size) { UI.toast('请先选中一个节点'); break; }
        applyFocusLayout(Array.from(app.selection)[0], 1, (data && data.id) === 'in' ? 'in' : 'out');
        break;
      }
      case 'unfocus': exitFocusLayout(); break;
      case 'trace-event': {
        if (data && data.event) {
          var sameEv = app.trace && app.trace.kind === 'event' && app.trace.name === data.event &&
            (!data.type || app.trace.type === data.type);
          if (sameEv) exitFocusLayout();
          else applyEventTrace(data.event, (data && data.type) || '');
        } else if (app.trace) {
          exitFocusLayout(); // toolbar button acts as a toggle while tracing
        } else {
          if (!app.selection.size) { UI.toast('请先选中一个含事件的节点'); break; }
          pickEventAndTrace(Model.getNode(project, Array.from(app.selection)[0]));
        }
        break;
      }
      case 'trace-field': {
        if (data && data.field) {
          var sameFld = app.trace && app.trace.kind === 'field' && app.trace.name === data.field &&
            (!data.type || app.trace.type === data.type);
          if (sameFld) exitFocusLayout();
          else applyFieldTrace(data.field, (data && data.type) || '');
        } else if (app.trace) {
          exitFocusLayout();
        } else {
          if (!app.selection.size) { UI.toast('请先选中一个节点'); break; }
          pickFieldAndTrace(Model.getNode(project, Array.from(app.selection)[0]));
        }
        break;
      }
      case 'trace-method': {
        if (data && data.method) {
          var sameMth = app.trace && app.trace.kind === 'method' && app.trace.name === data.method &&
            (!data.type || app.trace.type === data.type);
          if (sameMth) exitFocusLayout();
          else applyMethodTrace(data.method, (data && data.type) || '');
        } else if (app.trace) {
          exitFocusLayout();
        }
        break;
      }
      case 'layout-assembly': {
        if (app.canvasMode === 'assembly') exitFocusLayout();
        else applyAssemblyLayout();
        break;
      }
      case 'depth': {
        if (!app.selection.size) break;
        applyFocusLayout(Array.from(app.selection)[0], Number(data.id) || 1, app.focusSide || 'both');
        break;
      }
      case 'layer-preset': {
        var preset = (data && data.id) === 'all' ? 'all'
          : ((data && data.id) === 'mounts' ? 'mounts' : 'scripts');
        var presetName = preset === 'all' ? '全部' : (preset === 'mounts' ? '含挂载' : '仅脚本');
        var allowed = {
          scripts: ['class', 'interface', 'struct', 'enum', 'scriptableObject'],
          mounts: ['class', 'interface', 'struct', 'enum', 'scriptableObject', 'gameObject', 'prefab', 'scene'],
          all: Object.keys(S.NODE_KINDS)
        }[preset];
        exitModeSilent();
        mutate(function () {
          Object.keys(S.NODE_KINDS).forEach(function (k) { project.settings.nodeFilter[k] = allowed.indexOf(k) >= 0; });
          project.nodes.forEach(function (n) { n.visible = true; });
          var lay = Layout.layeredLayout(project);
          Layout.applyPositions(project, lay.positions);
        });
        app.isolateSnapshot = null;
        setTimeout(function () { if (canvas) canvas.fit(); }, 30);
        UI.toast('已切换层级：' + presetName);
        break;
      }
      case 'show-all': mutate(function () { project.nodes.forEach(function (n) { n.visible = true; }); app.isolateSnapshot = null; }); break;
      case 'hide-all': mutate(function () { project.nodes.forEach(function (n) { n.visible = false; }); app.isolateSnapshot = null; }); break;
      case 'isolate':
        if (app.isolateSnapshot) {
          // Toggle off: restore the visibility snapshot taken when isolating.
          var snap0 = app.isolateSnapshot;
          mutate(function () {
            project.nodes.forEach(function (n) {
              if (snap0[n.id] !== undefined) n.visible = snap0[n.id];
            });
          });
          app.isolateSnapshot = null;
          UI.syncToolbar(app);
          UI.toast('已退出孤立选中，显示已还原');
        } else {
          if (!app.selection.size) { UI.toast('请先选中一个节点，再点「孤立选中」'); break; }
          var keep = new Set();
          app.selection.forEach(function (nid) {
            keep.add(nid);
            Analysis.neighbors(project, nid, { direction: 'both', depth: 1 }).ids.forEach(function (x) { keep.add(x); });
          });
          mutate(function () {
            var snap = Object.create(null);
            project.nodes.forEach(function (n) { snap[n.id] = n.visible !== false; });
            app.isolateSnapshot = snap;
            project.nodes.forEach(function (n) { n.visible = keep.has(n.id); });
          });
          UI.toast('孤立选中 · 只显示选中项与直接引用（再点一次退出）');
        }
        break;
      case 'toggle-visible': mutate(function () { var n = Model.getNode(project, id); if (n) n.visible = n.visible === false; }); break;
      case 'toggle-group':
        if (app.collapsedKinds.has(id)) app.collapsedKinds.delete(id); else app.collapsedKinds.add(id);
        UI.renderLeft(app);
        break;
      case 'remove-stale':
        mutate(function () {
          var stale = new Set(project.nodes.filter(function (n) { return n.stale; }).map(function (n) { return n.id; }));
          project.nodes = project.nodes.filter(function (n) { return !stale.has(n.id); });
          project.edges = project.edges.filter(function (e) { return !stale.has(e.from) && !stale.has(e.to); });
        });
        break;
      case 'theme':
        mutate(function () { project.view.theme = project.view.theme === 'dark' ? 'light' : 'dark'; });
        document.body.dataset.theme = project.view.theme;
        break;
      case 'settings':
        UI.modal({ title: '设置', body:
          '<div class="kv"><label>默认布局</label><select data-field="layout">' +
          ['layered', 'grid'].map(function (v) { return '<option value="' + v + '"' + (project.settings.layout === v ? ' selected' : '') + '>' + ({ layered: '分层', grid: '网格' })[v] + '</option>'; }).join('') + '</select></div>' +
          '<div class="notice info">布局算法在扫描到新节点或点击「分层布局」时运行。</div>' +
          '<div class="notice info">主题、筛选器、成员显示在会话内始终生效；重新扫描不会重置它们。</div>',
          buttons: [{ label: '完成', primary: true }] });
        break;
      case 'export-png':
        if (!canvas) break;
        Bridge.exportFile('png', canvas.toDataURL().split(',')[1], project.meta.name + '.png').then(function () { UI.toast('PNG 已导出'); });
        break;
      case 'export-md': exportMarkdown(); break;
      case 'tab-deps': app.setTab('right', 'deps'); break;
      case 'highlight-member': {
        var key = data && data.id;
        if (!key) break;
        if (app.memberHighlight.has(key)) app.memberHighlight.delete(key);
        else app.memberHighlight.add(key);
        UI.syncToolbar(app);
        if (canvas) canvas.render();
        var h = S.MEMBER_HIGHLIGHTS.find(function (x) { return x.key === key; });
        UI.toast((app.memberHighlight.has(key) ? '已高亮「' : '已取消「') + (h ? h.label : key) + '」成员文字');
        break;
      }
      case 'show-cycles': {
        var cs = app.getSummary().cycles;
        UI.modal({ title: '循环依赖 · ' + cs.length, body: cs.length ? cs.map(function (c, i) {
          return '<div class="notice danger">环 ' + (i + 1) + '：' + esc(c.nodeIds.map(function (x) { var n = Model.getNode(project, x); return n ? n.name : x; }).join(' → ')) + '</div>';
        }).join('') : '<div class="notice info">未检测到循环依赖</div>', buttons: [{ label: '关闭', primary: true }] });
        break;
      }
      case 'show-isolated': {
        var iso = app.getSummary().isolated;
        UI.modal({ title: '孤立节点 · ' + iso.length, body: iso.length ? '<div class="diff-list">' + iso.map(function (x) {
          var n = Model.getNode(project, x); return '<div>' + esc(n ? n.name : x) + '</div>';
        }).join('') + '</div>' : '<div class="notice info">没有孤立节点</div>', buttons: [{ label: '关闭', primary: true }] });
        break;
      }
      case 'show-diff': {
        var d = lastDiff;
        if (!d) { UI.toast('还没有扫描记录'); break; }
        var row = function (label, arr) {
          if (!arr.length) return '';
          return '<h3>' + label + ' · ' + arr.length + '</h3><div class="diff-list">' + arr.slice(0, 30).map(function (x) {
            return '<div>' + esc(x.name || x.key || (x.from + ' → ' + x.to)) + '</div>';
          }).join('') + '</div>';
        };
        UI.modal({ title: '扫描差异', body: row('新增节点', d.addedNodes) + row('移除节点', d.removedNodes) +
          row('成员变更', d.changedNodes) + row('新增关系', d.addedEdges) + row('移除关系', d.removedEdges) +
          (d.addedNodes.length + d.removedNodes.length + d.changedNodes.length + d.addedEdges.length + d.removedEdges.length === 0
            ? '<div class="notice info">与上次扫描相比没有结构变化</div>' : ''), buttons: [{ label: '关闭', primary: true }] });
        break;
      }
      case 'scan-help':
        UI.modal({ title: '目录读取说明（HTML 版）', body:
          '<div class="notice info">浏览器出于安全限制，不能悄悄读取本机任意目录。本工具用三种方式把这件事做到最接近「自动」：</div>' +
          '<p><b>① 绑定目录（推荐，Chrome / Edge）</b><br>点「扫描 Unity 工程」选一次工程根目录并授权。授权会被记住，之后每次打开本页都会<b>自动重新读取</b>该目录、刷新关系图，无需再点任何按钮；也可随时点「重新扫描」。</p>' +
          '<p><b>② 直接拖入文件夹</b><br>把 Unity 工程根目录或 Assets 文件夹拖进窗口，松手即解析。这条路径不依赖目录授权，在预览面板 / 内嵌窗口里通常也能用。</p>' +
          '<p><b>③ 兼容模式</b><br>菜单「文件 → 选择文件夹（兼容模式）」使用传统文件夹选择，适用于不支持目录句柄的浏览器；每次需重新选目录。</p>' +
          '<div class="notice warn">若三种方式都失败，请用 Chrome / Edge 把本 HTML 保存到本地后双击打开，不要停留在内嵌预览窗口。浏览器不允许后台静默读磁盘是系统限制，不是工具故障。</div>' +
          '<p style="color:var(--text3)">扫描范围：.cs / .meta / .prefab / .unity / .asset，自动跳过 Library、Temp、obj、.git 等目录；上限 2 万文件 / 48MB。</p>',
          buttons: [{ label: '知道了', primary: true }] });
        break;
      case 'about': {
        var a = S.ABOUT || {};
        UI.modal({ title: '关于 Unity Architect', body:
          '<div class="notice info">v' + S.APP_VERSION + ' · 纯扫描查看器 · 桌面版 / 网页版</div>' +
          '<p>扫描 Unity 工程的 .cs 与 prefab/scene/asset YAML，自动生成带 UML 语义的引用关系图；支持事件追踪、跨类数据流向、循环依赖检测、Assembly 分层与多种观察模式。</p>' +
          ((a.author || a.contact || a.repo || a.license)
            ? '<div class="card" style="margin-top:8px;padding:10px 12px">' +
              (a.author ? '<div>' + esc(a.author) + '</div>' : '') +
              (a.contact ? '<div style="margin-top:4px">' + esc(a.contact) + '</div>' : '') +
              (a.repo ? '<div style="margin-top:4px"><a href="' + esc(a.repo.replace(/^开源地址[：:]\s*/, '')) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(a.repo) + '</a></div>' : '') +
              (a.license ? '<div style="margin-top:4px;color:var(--text3)">' + esc(a.license) + '</div>' : '') +
              '</div>' : '') +
          '<p style="margin-top:8px;color:var(--text3)">快捷键：Ctrl+K 检索 · Ctrl+A 全选 · F 适应 · L 布局 · Esc 退出当前模式</p>',
          buttons: [{ label: '关闭', primary: true }] });
        break;
      }
      default: break;
    }
  }
  app.action = action;

  function refreshStatusOnly() { UI.renderStatus(app); }

  function bindShortcuts() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'k') {
        e.preventDefault(); UI.el('global-search').focus(); app.setTab('left', 'search'); return;
      }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); app.setSelection(new Set(project.nodes.map(function (n) { return n.id; }))); return; }
      if (typing) return;
      if (e.key === 'Escape') { action('unfocus'); UI.hideContext(); return; }
      var k = e.key.toLowerCase();
      if (k === 'f') {
        // F：定位到当前选中节点；没有选中时退化为适应画布。
        if (app.selection.size) action('goto', { id: Array.from(app.selection)[0] });
        else action('fit');
        return;
      }
      if (k === 'g') { action('focus'); return; }   // G：聚焦依赖 ⇄ 取消聚焦
      if (k === 't') { action('trace-field'); return; } // T：数据流向（选中节点的字段）
      if (k === 'l') { action('layout-layered'); return; }
    });
  }

  function initBrowserBridge() {
    if (Bridge.isDesktop) return;
    var hint = UI.el('desktop-hint');
    if (hint) hint.textContent = 'HTML 版 · 拖入 Unity 工程文件夹即可解析';

    Bridge.onDropFiles(function (err, res) {
      if (err) { showScanError(err); return; }
      runScan(res.parsed, res.rootPath);
      UI.toast('已读取拖入目录 · ' + res.parsed.stats.csFiles + ' 个脚本 / ' + res.parsed.stats.nodes + ' 个节点', 4400);
      if (res.truncated) UI.toast('达到扫描上限，部分文件未纳入', 4600);
    });

    // Bound directory from a previous session: re-read automatically, no picker needed.
    Bridge.linkedDir().then(function (info) {
      if (!info) return;
      if (!info.granted) {
        if (hint) hint.textContent = '已绑定：' + info.name + ' · 点「扫描 Unity 工程」重新授权';
        return;
      }
      if (hint) hint.textContent = '正在自动读取：' + info.name;
      return Bridge.scanUnity({ rescan: true }).then(function (r) {
        if (!r) return;
        runScan(r.parsed, r.rootPath, true);
        if (hint) hint.textContent = '已自动读取：' + info.name + ' · ' + r.parsed.stats.nodes + ' 个节点';
        refreshStatusOnly();
      });
    }).catch(function () {
      if (hint) hint.textContent = 'HTML 版 · 点「扫描 Unity 工程」绑定目录';
    });
  }

  function boot() {
    UI.init(app);
    canvas = UA.Canvas.create(UI.el('canvas-wrap'), app);
    bindShortcuts();
    document.body.dataset.theme = project.view.theme;
    setProject(S.createEmptyProject('未扫描 Unity 工程'));
    setTimeout(function () { UI.toast('点「扫描 Unity 工程」绑定目录，或把工程文件夹拖进窗口'); }, 600);
    canvas.resize();
    initBrowserBridge();

    Bridge.onMenu(function (name, payload) { action(name, payload || {}); });

    root.UA.App = app;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis);
