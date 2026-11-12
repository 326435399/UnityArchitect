/* Zero-dependency test runner: node tests/run-tests.js */
'use strict';
var fs = require('fs');
var path = require('path');

var S = require('../src/shared/schema.js');
var Model = require('../src/shared/model.js');
var Cs = require('../src/shared/cs-parser.js');
var Unity = require('../src/shared/unity-parser.js');
var Analysis = require('../src/shared/analysis.js');
var Layout = require('../src/shared/layout.js');
var Fixtures = require('./fixtures/index.js');

var passed = 0, failed = 0, group = '';
function section(name) { group = name; console.log('\n── ' + name); }
function ok(cond, name, detail) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail !== undefined ? '  →  ' + JSON.stringify(detail) : '')); }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual: actual, expected: expected }); }

try {
  // ---------------------------------------------------------------- schema
  section('schema / normalize');
  var empty = S.createEmptyProject('demo');
  eq(empty.nodes.length, 0, 'empty nodes');
  ok(S.normalizeProject(null).nodes.length === 0, 'null project is safe');
  var broken = S.normalizeProject({
    nodes: [{ id: 'a', name: 'A', kind: 'class', members: [{ name: 'x' }] }, { id: 'a', name: 'Dup' }],
    edges: [{ id: 'e1', from: 'a', to: 'missing', kind: 'weird' }, { id: 'e2', from: 'a', to: 'a', kind: 'depend' }],
    view: { scale: 999, theme: 'dark' }
  });
  eq(broken.nodes.length, 2, 'duplicate ids are regenerated');
  eq(broken.edges.length, 1, 'dangling edge dropped');
  eq(broken.edges[0].kind, 'depend', 'unknown edge kind falls back to manual-safe value');
  eq(broken.view.scale, 4, 'scale clamped');
  eq(broken.view.theme, 'dark', 'theme preserved');

  // ---------------------------------------------------------------- C# parser
  section('C# parser');
  var pcPath = 'Assets/Scripts/Player/PlayerController.cs';
  var cs = Cs.parseCsFile(pcPath, Fixtures.FILES[pcPath]);
  eq(cs.types.length, 2, 'two top-level types in one file');
  ok(cs.types.some(function (t) { return t.name === 'IDamageable' && t.kind === 'interface'; }), 'interface detected');
  var pc = cs.types.find(function (t) { return t.name === 'PlayerController'; });
  ok(!!pc, 'PlayerController detected');
  ok(pc.baseTypes.indexOf('MonoBehaviour') >= 0 && pc.baseTypes.indexOf('IDamageable') >= 0, 'base types extracted');
  var byName = function (n) { return pc.members.find(function (m) { return m.name === n; }); };
  ok(byName('hp') && byName('hp').isSerialized && byName('hp').category === 'serializedField', 'SerializeField field');
  ok(byName('onDeath') && byName('onDeath').kind === 'event' && byName('onDeath').category === 'unityEvent', 'UnityEvent member');
  ok(byName('Hp') && byName('Hp').kind === 'property', 'property with accessors');
  ok(byName('TakeDamage') && byName('TakeDamage').kind === 'method' && byName('TakeDamage').parameters === 'int amount', 'method signature');
  ok(byName('Respawn') && byName('Respawn').category === 'coroutine', 'IEnumerator coroutine');
  ok(byName('observers') && byName('observers').type.indexOf('List') === 0, 'generic field type');
  ok(!pc.members.some(function (m) { return m.name === 'set' || m.name === 'get'; }), 'no accessor fragments parsed as members');
  var gm = Cs.parseCsFile('Assets/Scripts/Core/GameManager.cs', Fixtures.FILES['Assets/Scripts/Core/GameManager.cs']);
  ok(gm.types[0].namespace === 'Battle.Core', 'namespace extracted');
  ok(gm.types[0].refs.some(function (r) { return r.type === 'PlayerController' && r.relation === 'depend'; }), 'GetComponent<T> dependency');

  // ---------------------------------------------------------------- Unity parser
  section('Unity project parser');
  var files = Fixtures.asFileArray();
  var parsed = Unity.parseProject(files, {});
  ok(parsed.stats.types >= 7, 'at least 7 C# types', parsed.stats);
  ok(parsed.stats.guidCount >= 8, 'guid index built', parsed.stats.guidCount);
  ok(parsed.nodes.some(function (n) { return n.kind === 'scriptableObject' && n.name === 'HealthData'; }), 'ScriptableObject kind');
  ok(parsed.nodes.some(function (n) { return n.kind === 'interface' && n.name === 'IDamageable'; }), 'interface node');
  ok(parsed.nodes.some(function (n) { return (n.kind === 'gameObject' || n.kind === 'prefab') && n.name === 'PlayerRoot'; }), 'GameObject from prefab');
  var playerRoot = parsed.nodes.find(function (n) { return n.name === 'PlayerRoot'; });
  ok(playerRoot && playerRoot.kind === 'prefab', 'prefab root object gets the prefab kind', playerRoot && playerRoot.kind);
  var pTypes = playerRoot ? (playerRoot.components || []).map(function (c) { return c.type; }) : [];
  ok(pTypes.indexOf('Transform') >= 0 && pTypes.indexOf('Rigidbody') >= 0 && pTypes.some(function (t) { return /PlayerController$/.test(t); }),
    'prefab composition lists built-in components and scripts', pTypes);
  ok(parsed.edges.some(function (e) {
    return e.kind === 'compose' && e.label === '预制体实例' && e.fromKey && e.toKey === playerRoot.sourceKey;
  }), 'scene prefab instance links to the prefab object');
  ok(!parsed.nodes.some(function (n) { return n.kind === 'assembly' || n.kind === 'manual'; }),
    'no assembly / manual nodes any more');
  ok(parsed.nodes.some(function (n) {
    return n.kind === 'scriptableObject' && n.name === 'DefaultHealth' && String(n.sourceKey).indexOf('asset:') === 0;
  }), 'SO asset instance node (.asset file)');
  var soNode = parsed.nodes.find(function (n) { return n.name === 'DefaultHealth'; });
  var soClass = parsed.nodes.find(function (n) { return n.name === 'HealthData'; });
  ok(parsed.edges.some(function (e) {
    return e.kind === 'compose' && e.fromKey === soNode.sourceKey && e.toKey === soClass.sourceKey;
  }), 'SO asset instance links to its class');
  var kinds = parsed.edges.reduce(function (a, e) { a[e.kind] = (a[e.kind] || 0) + 1; return a; }, {});
  ok(kinds.implement > 0, 'implement edge', kinds);
  ok(kinds.inherit > 0 || kinds.implement > 0, 'inheritance edges', kinds);
  ok(kinds.serialize > 0, 'serialized reference edge', kinds);
  ok(kinds.attach > 0, 'component attach edge', kinds);
  ok(kinds.depend > 0, 'dependency edge', kinds);
  ok(kinds.aggregate > 0, 'container aggregate edge', kinds);
  ok(parsed.stats.unknownGuids === 0, 'all GUIDs resolved', parsed.stats.unknownGuids);
  var attach = parsed.edges.find(function (e) { return e.kind === 'attach'; });
  ok(attach && attach.toKey.indexOf('PlayerController') >= 0, 'attach points at the main script class', attach && attach.toKey);
  var serEdge = parsed.edges.find(function (e) {
    return e.kind === 'serialize' && e.fromKey === 'asset:Assets/Prefabs/Player.prefab#100000' &&
      e.toKey === soNode.sourceKey;
  });
  ok(serEdge && serEdge.sourceMember === 'config', 'serialize edge keeps the field name', serEdge);
  eq(Unity.normalizePath('C:/Proj/Assets/Scripts/A.cs', 'C:/Proj'), 'Assets/Scripts/A.cs', 'root prefix normalized');

  // ---------------------------------------------------------------- merge
  section('scan merge / annotation preservation');
  var project = S.createEmptyProject('BattleSystem');
  var merge1 = Model.mergeScan(project, parsed, {});
  ok(merge1.addedNodes.length >= 10, 'nodes created', merge1.addedNodes.length);
  var count1 = project.nodes.length, edges1 = project.edges.length;
  var target = project.nodes.find(function (n) { return n.name === 'PlayerController'; });
  target.note = '手工批注：不要动';
  target.position = { x: 777, y: 888 };
  var merge2 = Model.mergeScan(project, parsed, {});
  eq(project.nodes.length, count1, 're-scan is idempotent (no duplicate nodes)');
  eq(project.edges.length, edges1, 're-scan is idempotent (no duplicate edges)');
  eq(merge2.addedNodes.length, 0, 'no new nodes on identical re-scan');
  eq(target.note, '手工批注：不要动', 'manual note survives re-scan');
  eq(target.position.x, 777, 'manual position survives re-scan');
  var fewer = { nodes: parsed.nodes.filter(function (n) { return n.name !== 'HudView'; }), edges: parsed.edges };
  var staleProject = S.createEmptyProject('StaleTest');
  Model.mergeScan(staleProject, parsed, {});
  var staleMerge = Model.mergeScan(staleProject, fewer, {});
  ok(staleMerge.staleNodes.length >= 1, 'missing type reported as stale', staleMerge.staleNodes.length);
  ok(!staleProject.nodes.some(function (n) { return n.name === 'HudView'; }), 'stale auto node removed on re-scan');
  ok(!staleProject.edges.some(function (e) { return e.stale; }), 'no stale edges remain after purge');
  var keepFlagged = Model.mergeScan(S.createEmptyProject('KeepStale'), fewer, { removeStale: false });
  // fewer is scanned into an empty project, so nothing is stale here; verify opt accepted.
  ok(keepFlagged.addedNodes.length >= 1, 'removeStale:false option accepted');
  var fingerprintA = Model.fingerprint(project);

  // ---------------------------------------------------------------- analysis
  section('graph analysis');
  var summary = Analysis.summary(project);
  ok(summary.nodes > 0 && summary.edges > 0, 'summary counts', { n: summary.nodes, e: summary.edges });
  var cycles = Analysis.findCycles(project);
  ok(cycles.length >= 1, 'circular dependency detected', cycles.map(function (c) { return c.length; }));
  var idx = Analysis.buildIndex(project);
  var deg = Analysis.degrees(project, target.id, idx);
  ok(deg.total > 0, 'degree computed', deg);
  var nb = Analysis.neighbors(project, target.id, { direction: 'both', depth: 2 });
  ok(nb.ids.length > 0 && nb.ids.indexOf(target.id) < 0, 'N-hop closure excludes self', nb.ids.length);
  var hits = Analysis.search(project, 'TakeDamage');
  ok(hits.length > 0 && hits.some(function (h) { return h.type === 'member'; }), 'global search finds members', hits.length);
  ok(Analysis.isolatedNodes(project).length >= 0, 'isolated node scan runs');
  // 孤立只统计脚本类：GameObject/预制体/场景不参与判定
  var iso = Analysis.isolatedNodes(project);
  var isoAllScript = iso.every(function (id) {
    var n = Model.getNode(project, id);
    return n && ['class', 'struct', 'interface', 'enum', 'scriptableObject'].indexOf(n.kind) >= 0;
  });
  ok(isoAllScript, 'isolated nodes are script kinds only', iso.length);
  // 成员高亮：开关映射到颜色
  var keys = new Set(['event']);
  eq(S.highlightFor('csharpEvent', keys), '#FF4FC3', 'event highlight color');
  eq(S.highlightFor('coroutine', keys), null, 'coroutine untouched while only event on');
  keys.add('coroutine');
  eq(S.highlightFor('coroutine', keys), '#FFA640', 'coroutine highlight color');
  eq(S.highlightFor('method', keys), null, 'plain methods never highlighted');

  // ---------------------------------------------------------------- layout
  section('layout / geometry');
  var measure = Layout.measureNode(target, { showMembers: true });
  ok(measure.w >= 200 && measure.h > 34, 'node measured', { w: measure.w, h: measure.h });
  ok(measure.rows.some(function (r) { return r.kind === 'member'; }), 'rows contain members');
  var layered = Layout.layeredLayout(project, {});
  eq(Object.keys(layered.positions).length, Model.visibleNodes(project).length, 'layered positions cover visible nodes');
  ok(Object.keys(layered.positions).every(function (id) {
    return Number.isFinite(layered.positions[id].x) && Number.isFinite(layered.positions[id].y);
  }), 'no NaN positions');
  var grid = Layout.gridLayout(project, {});
  eq(Object.keys(grid.positions).length, Model.visibleNodes(project).length, 'grid positions cover visible nodes');
  eq(Layout.applyPositions(project, layered.positions), Model.visibleNodes(project).length, 'positions applied');
  var fit = Layout.fitBounds(project, { width: 1200, height: 800 });
  ok(Number.isFinite(fit.scale) && fit.scale > 0 && fit.scale <= 1.6, 'fit bounds', fit);

  // focus layout: upstream column left, focus middle, downstream column right
  var focusTarget = null;
  project.edges.some(function (e) {
    var n = Model.getNode(project, e.from);
    if (n && n.kind === 'class') { focusTarget = n; return true; }
    return false;
  });
  ok(!!focusTarget, 'focus target with outgoing edges exists');
  if (focusTarget) {
    var fl = Layout.focusLayout(project, focusTarget.id, { depth: 2, side: 'both' });
    ok(fl.ids.indexOf(focusTarget.id) >= 0, 'focus layout includes the focused node');
    ok(fl.ids.length >= 2, 'focus layout includes neighbours');
    ok(fl.counts.up + fl.counts.down >= 1, 'focus layout counts dependencies');
    var fx = fl.positions[focusTarget.id];
    ok(Number.isFinite(fx.x) && Number.isFinite(fx.y), 'focus position is finite');
    var left = Object.keys(fl.positions).filter(function (id) { return fl.positions[id].x < fx.x; }).length;
    var right = Object.keys(fl.positions).filter(function (id) { return fl.positions[id].x > fx.x; }).length;
    eq(left, fl.counts.up, 'upstream column sits left of focus');
    eq(right, fl.counts.down, 'downstream column sits right of focus');
    var inOnly = Layout.focusLayout(project, focusTarget.id, { depth: 1, side: 'in' });
    eq(inOnly.counts.down, 0, 'side=in has no downstream');
    var outOnly = Layout.focusLayout(project, focusTarget.id, { depth: 1, side: 'out' });
    eq(outOnly.counts.up, 0, 'side=out has no upstream');
  }

  // event trace: definition / subscribe / fire columns
  section('event trace');
  var gm = project.nodes.find(function (n) { return n.name === 'GameManager'; });
  var hv = project.nodes.find(function (n) { return n.name === 'HudView'; });
  ok(!!gm && !!hv, 'event fixture nodes exist');
  var evMem = gm && gm.members.find(function (m) { return m.kind === 'event' && m.name === 'onGameOver'; });
  ok(!!evMem, 'event member parsed as kind=event');
  var restart = gm && gm.members.find(function (m) { return m.name === 'Restart'; });
  ok(restart && (restart.memberRefs || []).some(function (u) { return u.name === 'onGameOver' && u.action === 'fire'; }),
    'method body records event fire');
  var gmMeasure = Layout.measureNode(gm, { showMembers: true });
  var labels = gmMeasure.rows.filter(function (r) { return r.kind === 'group'; }).map(function (r) { return r.text; });
  ok(labels.indexOf('变量') >= 0 && labels.indexOf('事件') >= 0 && labels.indexOf('方法') >= 0,
    'card groups split into 变量/事件/方法', labels);
  var esNode = project.nodes.find(function (n) { return n.name === 'EventSystem'; });
  var esTypes = (esNode && esNode.components || []).map(function (c) { return c.type; });
  ok(esTypes.indexOf('EventSystem') >= 0 && esTypes.indexOf('StandaloneInputModule') >= 0,
    'package script components resolve to real script names (not MonoBehaviour)', esTypes);
  ok((esNode.components || []).every(function (c) { return c.type === 'Transform' || c.isScript === true; }),
    'script components carry the isScript flag');
  var prNode = project.nodes.find(function (n) { return n.name === 'PlayerRoot'; });
  var prMeasure = Layout.measureNode(prNode, { showMembers: true });
  ok(prMeasure.rows.some(function (r) { return r.kind === 'group' && /组件/.test(r.text); }) &&
     prMeasure.rows.filter(function (r) { return r.kind === 'comp'; }).length >= 3,
    'GameObject card shows its component composition');
  var bigNode = { id: 'test:big#Big', name: 'Big', kind: 'class', members: [] };
  for (var bi = 0; bi < 55; bi++) bigNode.members.push({ id: bigNode.id + '#m' + bi, name: 'm' + bi, kind: 'field', access: 'private', type: 'int' });
  var bigCollapsed = Layout.measureNode(bigNode, { showMembers: true });
  var bigMore = bigCollapsed.rows.find(function (r) { return r.kind === 'more'; });
  ok(bigMore && /点击展开/.test(bigMore.text), 'truncated card offers a click-to-expand row', bigMore && bigMore.text);
  ok(bigCollapsed.rows.filter(function (r) { return r.kind === 'member'; }).length === 40, 'collapsed card caps at 40 members');
  var bigExpanded = Layout.measureNode(bigNode, { showMembers: true, expanded: true });
  ok(bigExpanded.rows.filter(function (r) { return r.kind === 'member'; }).length === 55 && bigExpanded.rows.some(function (r) { return r.kind === 'more' && /收起/.test(r.text); }),
    'expanded card lists every member with a collapse row');
  var trace = Analysis.traceEvent(project, 'onGameOver');
  eq(trace.definitions.length, 1, 'trace finds one definition');
  ok(trace.subscribers.some(function (s) { return s.name === 'HudView'; }), 'trace finds subscriber HudView');
  ok(trace.subscribers[0].methods.indexOf('OnEnable') >= 0, 'subscriber records subscribing method');
  ok(trace.firers.some(function (f) { return f.name === 'GameManager'; }), 'trace finds firer GameManager');
  eq(Analysis.traceEvent(project, '不存在的事件').definitions.length, 0, 'trace of unknown event is empty');
  var etl = Layout.eventTraceLayout(project, trace);
  ok(etl.ids.length >= 2, 'event trace layout covers participants');
  var defX = etl.positions[trace.definitions[0].id].x;
  var subX = etl.positions[trace.subscribers[0].id].x;
  ok(defX < subX, 'definitions sit left of subscribers', { def: defX, sub: subX });
  var fireIds = trace.firers.map(function (f) { return f.id; }).filter(function (id) { return etl.positions[id] && trace.definitions[0].id !== id; });
  ok(fireIds.every(function (id) { return etl.positions[id].x > subX; }) || trace.firers.every(function (f) { return f.id === trace.definitions[0].id; }),
    'pure firers sit right of subscribers');
  eq(etl.ids.length, Object.keys(etl.positions).length, 'trace layout ids match positions (deduped)');

  // ---------------------------------------------------------------- find all references (VS style)
  section('find all references / chained receivers');
  var g1State = project.nodes.find(function (n) { return n.name === 'G1State'; });
  var g1View = project.nodes.find(function (n) { return n.name === 'G1View'; });
  ok(!!g1State && !!g1View, 'chain fixture nodes exist');
  var chainTrace = Analysis.traceEvent(project, 'Changed');
  eq(chainTrace.definitions.length, 1, 'Changed defined in G1State only');
  ok(chainTrace.subscribers.some(function (s) { return s.name === 'G1View'; }),
    'db.State.Changed += Refresh resolves the chain to G1View');
  ok(chainTrace.firers.some(function (f) { return f.name === 'G1State'; }),
    'Changed?.Invoke() fires in G1State itself');
  var subDetail = chainTrace.subscribers[0].details.find(function (d) { return d.action === 'subscribe'; });
  ok(subDetail && subDetail.via === 'db.State' && /Changed \+= Refresh/.test(subDetail.snippet),
    'subscriber detail carries receiver chain and code line', subDetail);
  ok(chainTrace.details.some(function (g) { return g.name === 'G1View' && g.rows.length >= 2; }),
    'VS-style detail rows grouped per class');
  var typedTrace = Analysis.traceEvent(project, 'Changed', g1State.sourceKey);
  eq(typedTrace.definitions.length, 1, 'typed event trace keeps only the clicked class definition');
  eq(typedTrace.definitions[0].id, g1State.id, 'typed event trace defines the requested class');
  ok(typedTrace.subscribers.some(function (s) { return s.name === 'G1View'; }),
    'typed event trace still resolves the subscriber');
  eq(Analysis.traceEvent(project, 'Changed', 'cs:nowhere#Nope').definitions.length, 0,
    'typed event trace ignores other classes owning a same-name event');
  var typedLayout = Layout.eventTraceLayout(project, typedTrace);
  ok(Array.isArray(typedLayout.columnBounds) && typedLayout.columnBounds.length >= 2,
    'trace layout exposes column captions for role labels');
  var scoreTrace = Analysis.traceField(project, 'Score', g1State.sourceKey);
  eq(scoreTrace.definitions.length, 1, 'Score property declared in G1State');
  ok(scoreTrace.readers.some(function (r) { return r.name === 'G1View'; }),
    'db.State.Score read resolves to G1State.Score');
  ok(scoreTrace.writers.length === 0, 'no writers of the get-only style property from outside');
  var accessor = g1State.members.find(function (m) { return m.name === 'Score'; });
  ok(accessor && (accessor.memberRefs || []).some(function (u) { return u.name === 'score' && u.action === 'write'; }),
    'property accessor body is scanned (score = value)');
  var pcNodeEarly = project.nodes.find(function (n) { return n.name === 'PlayerController'; });
  var methodTrace = Analysis.traceMethod(project, 'TakeDamage', pcNodeEarly.sourceKey || '');
  ok(methodTrace.callers.some(function (c) { return c.name === 'GameManager'; }),
    'traceMethod finds GameManager.Restart as caller');
  ok(methodTrace.callers.some(function (c) { return c.name === 'PlayerController'; }),
    'traceMethod finds the same-class call (ApplyDamage -> TakeDamage)');
  ok(Analysis.refCount(project, g1State.sourceKey, 'Changed') >= 3, 'refCount counts definition-adjacent uses');

  // ---------------------------------------------------------------- assembly layers
  section('assembly layered view');
  ok(Array.isArray(project.assemblies) && project.assemblies.length >= 3, 'asmdef metadata stored', project.assemblies && project.assemblies.length);
  var coreAsm = project.assemblies.find(function (a) { return a.name === 'Battle.Core'; });
  ok(coreAsm && coreAsm.refs.indexOf('Battle.Data') >= 0,
    'GUID asmdef reference resolved to assembly name', coreAsm && coreAsm.refs);
  eq(gm.assembly, 'Battle.Core', 'type mapped to nearest asmdef (Core)');
  eq(g1View.assembly, 'Battle.UI', 'type mapped to nearest asmdef (UI)');
  eq(g1State.assembly, 'Battle.Data', 'type mapped to nearest asmdef (Data)');
  var asm = Layout.assemblyLayout(project);
  ok(asm.order.indexOf('Battle.Core') < asm.order.indexOf('Battle.UI') &&
     asm.order.indexOf('Battle.UI') < asm.order.indexOf('Battle.Data'),
    'entry assembly sits on top, dependencies stack downward', asm.order);
  ok(asm.groups.some(function (g) { return g.label === 'Battle.Data 层' && g.ids.some(function (id) { return id === g1State.id; }); }),
    'layer band contains its member nodes');
  // 平级（depth 相同）的层带共享同一行（top 相同），上下只在不同 depth 之间发生。
  var topByDepth = Object.create(null);
  var peersOk = true;
  asm.groups.filter(function (g) { return !g.side && g.depth !== null; }).forEach(function (g) {
    if (topByDepth[g.depth] === undefined) topByDepth[g.depth] = g.top;
    else if (topByDepth[g.depth] !== g.top) peersOk = false;
  });
  ok(peersOk, 'same-depth bands share one horizontal row');
  ok(asm.groups.some(function (g) { return g.label === '（未分组）' && g.side; }), 'nodes without asmdef get the unassigned side band');
  var ungroupedBand = asm.groups.find(function (g) { return g.label === '（未分组）'; });
  // 侧栏组（SO 资源 / Editor / 预制体 / 未分组）整体在主链右侧；主链只含程序集层。
  ok(asm.groups.some(function (g) { return g.label === 'SO 资源' && g.side; }), 'SO asset band sits in the side column');
  var prefabBand = asm.groups.find(function (g) { return g.label === '预制体'; });
  ok(!prefabBand || prefabBand.side, 'prefab resources get their own side band');
  var soBand = asm.groups.find(function (g) { return g.label === 'SO 资源'; });
  var dataBandForSo = asm.groups.find(function (g) { return g.label === 'Battle.Data 层'; });
  ok(!soBand || !dataBandForSo || soBand.left > dataBandForSo.left,
    'SO asset band sits right of the main chain, never inside it');
  var mainBands = asm.groups.filter(function (g) { return !g.side; });
  var mainMaxRight = Math.max.apply(null, mainBands.map(function (g) { return g.right; }));
  ok(ungroupedBand.left > mainMaxRight, 'unassigned band is pushed to the side of the main chain',
    'side left=' + ungroupedBand.left + ' main right=' + mainMaxRight);
  var sidePos = asm.positions[ungroupedBand.ids[0]];
  ok(sidePos && mainBands.every(function (g) {
    return g.ids.every(function (id) { return asm.positions[id].x < sidePos.x; });
  }), 'every side node sits right of every main-chain node');
  var iconRb = S.compIcon('Rigidbody');
  eq(iconRb.glyph, 'rigidbody', 'component icon matched by type name');
  eq(S.compIcon('PlayerController', true).glyph, 'script', 'custom script gets the script icon');
  ok(asm.ids.every(function (id) { return Number.isFinite(asm.positions[id].x); }), 'assembly positions finite');
  var coreBand = asm.groups.find(function (g) { return g.label === 'Battle.Core 层'; });
  var dataBand = asm.groups.find(function (g) { return g.label === 'Battle.Data 层'; });
  ok(coreBand && dataBand && coreBand.top < dataBand.top,
    'top layer is drawn above the layers it depends on', coreBand && [coreBand.top, dataBand && dataBand.top]);
  var editorProbe = JSON.parse(JSON.stringify(project));
  editorProbe.assemblies.push({ name: 'Battle.Editor', refs: ['Battle.Core'] });
  var editorNode = editorProbe.nodes.find(function (n) { return n.name === 'GameRoot'; });
  if (editorNode) editorNode.assembly = 'Battle.Editor';
  var asmEditor = Layout.assemblyLayout(editorProbe);
  ok(asmEditor.order.indexOf('Battle.Editor') > asmEditor.order.indexOf('Battle.Data'),
    'editor assembly gets its own trailing layer', asmEditor.order);

  // ---------------------------------------------------------------- data flow
  section('data flow');
  var pcNode = project.nodes.find(function (n) { return n.name === 'PlayerController'; });
  ok(!!pcNode, 'PlayerController exists');
  var tf = Analysis.traceField(project, 'player', gm.sourceKey);
  eq(tf.definitions.length, 1, 'field trace finds declaring class');
  ok(tf.writers.some(function (w) { return w.name === 'GameManager' && w.methods.indexOf('Start') >= 0; }),
    'field write detected (player = GetComponent)');
  ok(tf.readers.some(function (r) { return r.name === 'GameManager' && r.methods.indexOf('Restart') >= 0; }),
    'field read detected');
  ok((tf.typeClasses || []).some(function (t) { return t.name === 'PlayerController'; }),
    'field trace exposes the declared type class', tf.typeClasses);
  eq(Analysis.traceField(project, '不存在的字段').definitions.length, 0, 'traceField of unknown field is empty');
  var ftl = Layout.fieldTraceLayout(project, tf);
  ok(ftl.ids.length >= 1 && Number.isFinite(ftl.positions[gm.id].x), 'field trace layout positions');
  ok(ftl.columnBounds.some(function (b) { return b.label === '字段类型'; }), 'field trace layout adds a type column');
  var typeNode = project.nodes.find(function (n) { return n.name === 'PlayerController'; });
  ok(typeNode && Number.isFinite(ftl.positions[typeNode.id].x) && ftl.positions[typeNode.id].x < ftl.positions[gm.id].x,
    'field type column sits left of the declaring column');
  var cc = Analysis.traceMethod(project, 'TakeDamage', pcNode.sourceKey).callers;
  ok(cc.some(function (c) { return c.name === 'GameManager' && c.methods.indexOf('Restart') >= 0; }),
    'caller detected via receiver field', cc);

  // Multi-hop: GameRoot.Start -> binder.Bind(db) -> DataBinder.bound = data
  var gameRootNode = project.nodes.find(function (n) { return n.name === 'GameRoot' && n.kind === 'class'; });
  var dataBinderNode = project.nodes.find(function (n) { return n.name === 'DataBinder'; });
  ok(!!gameRootNode && !!dataBinderNode, 'bind-chain fixture nodes exist');
  var bindMem = dataBinderNode.members.find(function (m) { return m.name === 'Bind'; });
  ok(bindMem && (bindMem.paramFlows || []).some(function (f) { return f.param === 'data' && f.field === 'bound'; }),
    'paramFlow extracted (bound = data)');
  var startMem = gameRootNode.members.find(function (m) { return m.name === 'Start'; });
  ok(startMem && (startMem.callTargets || []).some(function (c) {
    return c.member === 'Bind' && Array.isArray(c.args) && c.args.indexOf('db') >= 0;
  }), 'call args extracted (binder.Bind(db))');
  var flowDown = Analysis.traceField(project, 'db', gameRootNode.sourceKey);
  eq(flowDown.definitions.length, 1, 'db trace declares in GameRoot only');
  ok(flowDown.sinks.some(function (s) { return s.name === 'DataBinder' && s.holder.indexOf('\u0001f:') >= 0; }) ||
     flowDown.sinks.some(function (s) { return s.name === 'DataBinder'; }),
    'db flows into DataBinder across classes', flowDown.sinks);
  ok(flowDown.sinks.some(function (s) { return s.name === 'DataBinder' && /传参|写入/.test(s.detail || ''); }),
    'sink records how the value got there', flowDown.sinks);
  var flowUp = Analysis.traceField(project, 'bound', dataBinderNode.sourceKey);
  ok(flowUp.sources.some(function (s) { return s.name === 'GameRoot'; }),
    'bound sources reach back to GameRoot.db', flowUp.sources);
  // SO resource origin: prefab field `config` serializes the DefaultHealth asset.
  var flowRes = Analysis.traceField(project, 'config', pcNode.sourceKey);
  ok(flowRes.sources.some(function (s) { return s.name === 'DefaultHealth' && /SO 资源/.test(s.detail || ''); }),
    'SO asset instance surfaces as a resource source', flowRes.sources);
  ok(flowRes.sources.some(function (s) { return s.name === 'PlayerRoot' && /序列化引用/.test(s.detail || ''); }),
    'mounting GameObject surfaces as the serialization owner', flowRes.sources);

  // ---------------------------------------------------------------- scan diff
  section('scan diff');
  var fpB = Model.fingerprint(project);
  var diff = Model.diffFingerprints(fingerprintA, fpB);
  ok(Array.isArray(diff.addedNodes) && Array.isArray(diff.changedNodes), 'diff returns comparable lists');

  // ---------------------------------------------------------------- materialize fixtures
  section('fixtures');
  var fixtureRoot = path.join(__dirname, 'fixtures', 'Assets');
  var written = 0;
  Object.keys(Fixtures.FILES).forEach(function (rel) {
    var dest = path.join(__dirname, 'fixtures', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Fixtures.FILES[rel], 'utf8');
    written++;
  });
  ok(fs.existsSync(path.join(fixtureRoot, 'Scripts', 'Player', 'PlayerController.cs')), 'fixtures materialized');
  eq(written, Object.keys(Fixtures.FILES).length, 'all fixture files written');

} catch (err) {
  failed++;
  console.error('\n  EXCEPTION in [' + group + ']:', err && err.stack ? err.stack : err);
}

console.log('\n──────────────────────────────');
console.log('  PASS ' + passed + '   FAIL ' + failed);
process.exitCode = failed ? 1 : 0;
