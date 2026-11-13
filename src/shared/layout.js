/* Node measurement + automatic layouts (layered / grid / focus / trace / assembly / fit). UMD. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var S = isNode ? require('./schema.js') : root.UA.Schema;
  var Model = isNode ? require('./model.js') : root.UA.Model;
  var api = factory(S, Model);
  if (isNode) module.exports = api;
  else { root.UA = root.UA || {}; root.UA.Layout = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S, Model) {
  'use strict';

  var HEADER_H = 34, GROUP_H = 20, ROW_H = 18, PAD_BOTTOM = 10;
  var GAP_X = 130, GAP_Y = 46;

  function accessSign(m) {
    if (m.access === 'public') return '+';
    if (m.access === 'private') return '−';
    if (m.access === 'protected') return '#';
    return '~';
  }

  function memberLine(m) {
    if (m.kind === 'method') return accessSign(m) + ' ' + m.name + '(' + (m.parameters || '') + ') : ' + (m.returnType || 'void');
    if (m.kind === 'property') return accessSign(m) + ' ' + m.name + ' { get; set; } : ' + (m.type || 'var');
    if (m.kind === 'event') return accessSign(m) + ' ' + m.name + ' : ' + (m.type || 'var') + '  «event»';
    return accessSign(m) + ' ' + m.name + ' : ' + (m.type || 'var') +
      (m.initialValue ? ' = ' + m.initialValue : '');
  }

  /** Single source of truth for node geometry, shared by canvas renderer and hit-test. */
  function measureNode(node, options) {
    var opts = options || {};
    var show = opts.showMembers !== false;
    var expanded = !!opts.expanded; // 点击「还有 N 项」后展开全部成员
    var maxMembers = expanded ? Infinity : (opts.maxMembers || 40);
    var rows = [{ kind: 'header', y: 0, h: HEADER_H, text: node.name }];
    var y = HEADER_H;
    var members = show ? (node.members || []).slice(0, maxMembers) : [];
    var groups = [
      { label: '变量', test: function (m) { return m.kind === 'field'; } },
      { label: '事件', test: function (m) { return m.kind === 'event'; } },
      { label: '属性', test: function (m) { return m.kind === 'property'; } },
      { label: '方法', test: function (m) { return m.kind === 'method'; } }
    ];
    // GameObject 的组成：Transform / Rigidbody / 自定义脚本…（按 YAML 顺序）
    var comps = ((node.kind === 'gameObject' || node.kind === 'prefab') && Array.isArray(node.components)) ? node.components : [];
    var COMP_LIMIT = 8;
    if (show && comps.length) {
      rows.push({ kind: 'group', y: y, h: GROUP_H, text: '组件 · ' + comps.length });
      y += GROUP_H;
      (expanded ? comps : comps.slice(0, COMP_LIMIT)).forEach(function (c) {
        rows.push({ kind: 'comp', y: y, h: ROW_H, comp: c, text: c.type, nodeKey: c.nodeKey || '' });
        y += ROW_H;
      });
      if (comps.length > COMP_LIMIT) {
        rows.push({
          kind: 'more', y: y, h: ROW_H,
          text: expanded ? '▲ 收起' : '▼ 还有 ' + (comps.length - COMP_LIMIT) + ' 个组件（点击展开）'
        });
        y += ROW_H;
      }
    }
    groups.forEach(function (g) {
      var list = members.filter(g.test);
      if (!list.length) return;
      rows.push({ kind: 'group', y: y, h: GROUP_H, text: g.label });
      y += GROUP_H;
      list.forEach(function (m) {
        rows.push({ kind: 'member', y: y, h: ROW_H, member: m, text: memberLine(m) });
        y += ROW_H;
      });
    });
    if (show && (node.members || []).length > maxMembers) {
      rows.push({ kind: 'more', y: y, h: ROW_H, text: '▼ 还有 ' + (node.members.length - maxMembers) + ' 项（点击展开）' });
      y += ROW_H;
    } else if (show && expanded && (node.members || []).length > (opts.maxMembers || 40)) {
      rows.push({ kind: 'more', y: y, h: ROW_H, text: '▲ 收起' });
      y += ROW_H;
    }
    if (show && !members.length && !comps.length) {
      rows.push({ kind: 'empty', y: y, h: ROW_H, text: '（暂无成员）' });
      y += ROW_H;
    }
    y += PAD_BOTTOM;

    // SO.asset 徽章比单字符徽章宽，头部预留更多空间避免与长标题相撞。
    var headerBadgeW = node.kind === 'scriptableObject' && /\.asset$/i.test(node.filePath || '') ? 78 : 46;
    var w = 210;
    rows.forEach(function (r) {
      if (!r.text) return;
      var width = r.text.length * 7.1 + (r.kind === 'header' ? headerBadgeW : 30);
      if (width > w) w = width;
    });
    return { w: Math.min(400, Math.max(200, Math.round(w))), h: Math.max(HEADER_H + PAD_BOTTOM, y), rows: rows };
  }

  function sizes(project, opts) {
    var out = Object.create(null);
    project.nodes.forEach(function (n) { out[n.id] = measureNode(n, opts); });
    return out;
  }

  /** Layered (Sugiyama-like) layout following edge direction. Cycles fall back to layer 0. */
  function layeredLayout(project, options) {
    var opts = options || {};
    var nodes = Model.visibleNodes(project);
    var edges = Model.visibleEdges(project, new Set(nodes.map(function (n) { return n.id; })));
    var sz = sizes(project, { showMembers: project.settings.showMembers });
    var idset = new Set(nodes.map(function (n) { return n.id; }));
    var indeg = Object.create(null), layer = Object.create(null), out = Object.create(null);
    nodes.forEach(function (n) { indeg[n.id] = 0; layer[n.id] = 0; out[n.id] = []; });
    edges.forEach(function (e) {
      if (!idset.has(e.from) || !idset.has(e.to) || e.from === e.to) return;
      indeg[e.to]++; out[e.from].push(e.to);
    });
    var queue = nodes.filter(function (n) { return indeg[n.id] === 0; }).map(function (n) { return n.id; });
    var processed = 0;
    while (queue.length) {
      var cur = queue.shift(); processed++;
      out[cur].forEach(function (to) {
        layer[to] = Math.max(layer[to], layer[cur] + 1);
        indeg[to]--;
        if (indeg[to] === 0) queue.push(to);
      });
    }
    void processed;
    var buckets = Object.create(null);
    nodes.forEach(function (n) {
      var l = layer[n.id] || 0;
      (buckets[l] = buckets[l] || []).push(n);
    });
    var positions = Object.create(null);
    var x = 0;
    Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; }).forEach(function (l) {
      var list = buckets[l];
      list.sort(function (a, b) {
        var da = (out[a.id] || []).length, db = (out[b.id] || []).length;
        if (db !== da) return db - da;
        return (a.position.y - b.position.y) || a.name.localeCompare(b.name);
      });
      var colW = 0, totalH = 0;
      list.forEach(function (n) {
        colW = Math.max(colW, sz[n.id].w);
        totalH += sz[n.id].h + GAP_Y;
      });
      totalH = Math.max(0, totalH - GAP_Y);
      var y = -totalH / 2;
      list.forEach(function (n) {
        positions[n.id] = { x: x, y: y };
        y += sz[n.id].h + GAP_Y;
      });
      x += colW + GAP_X;
    });
    return { positions: positions, layers: Object.keys(buckets).length, moved: nodes.length };
  }

  function gridLayout(project, options) {
    var opts = options || {};
    var nodes = Model.visibleNodes(project);
    var sz = sizes(project, { showMembers: project.settings.showMembers });
    var cols = opts.columns || Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    var positions = Object.create(null);
    var rows = Object.create(null);
    nodes.sort(function (a, b) { return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name); });
    nodes.forEach(function (n, i) {
      var c = i % cols, r = Math.floor(i / cols);
      rows[r] = Math.max(rows[r] || 0, sz[n.id].h);
      positions[n.id] = { x: c * 430, y: 0 };
    });
    var acc = 0, rowY = Object.create(null);
    Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) { rowY[r] = acc; acc += rows[r] + GAP_Y; });
    nodes.forEach(function (n, i) {
      var r = Math.floor(i / cols);
      positions[n.id].y = rowY[r];
    });
    return { positions: positions, moved: nodes.length };
  }

  /**
   * Dependency-centric layout for focus mode: upstream (who references me) on the
   * left, the focused node in the middle, downstream (what I depend on) on the
   * right. `side` restricts it to one direction so "who uses me" can stand alone.
   */
  function focusLayout(project, focusId, options) {
    var opts = options || {};
    var depth = opts.full ? 64 : Math.max(1, Math.min(4, opts.depth || 1));
    var side = opts.side === 'in' || opts.side === 'out' ? opts.side : 'both';
    var byId = Object.create(null);
    project.nodes.forEach(function (n) { byId[n.id] = n; });
    if (!byId[focusId]) return { positions: {}, ids: [], counts: { up: 0, down: 0 }, depth: depth };

    var sizeCache = Object.create(null);
    function sizeOf(n) {
      if (!sizeCache[n.id]) sizeCache[n.id] = measureNode(n, { showMembers: project.settings.showMembers });
      return sizeCache[n.id];
    }

    var incoming = Object.create(null), outgoing = Object.create(null);
    project.edges.forEach(function (e) {
      if (!byId[e.from] || !byId[e.to] || e.from === e.to) return;
      (outgoing[e.from] = outgoing[e.from] || []).push(e.to);
      (incoming[e.to] = incoming[e.to] || []).push(e.from);
    });

    function bfs(adj) {
      var dist = Object.create(null), queue = [{ id: focusId, d: 0 }];
      dist[focusId] = 0;
      while (queue.length) {
        var cur = queue.shift();
        if (cur.d >= depth) continue;
        (adj[cur.id] || []).forEach(function (nxt) {
          if (dist[nxt] === undefined) { dist[nxt] = cur.d + 1; queue.push({ id: nxt, d: cur.d + 1 }); }
        });
      }
      delete dist[focusId];
      return dist;
    }
    var up = side === 'out' ? Object.create(null) : bfs(incoming);
    var down = side === 'in' ? Object.create(null) : bfs(outgoing);
    // Reached in both directions -> downstream column (it's what I depend on).
    Object.keys(up).forEach(function (id) { if (down[id] !== undefined) delete up[id]; });
    // 溯源模式：左边是数据根（出边方向），右边是消费者（入边方向）——与聚焦相反。
    if (opts.flip) { var swap = up; up = down; down = swap; }

    var maxUp = 0, maxDown = 0;
    Object.keys(up).forEach(function (id) { if (up[id] > maxUp) maxUp = up[id]; });
    Object.keys(down).forEach(function (id) { if (down[id] > maxDown) maxDown = down[id]; });
    if (!opts.full) { maxUp = Math.min(maxUp, depth); maxDown = Math.min(maxDown, depth); }

    var columns = [];
    for (var d1 = maxUp; d1 >= 1; d1--) columns.push({ dist: d1, dir: 'up', items: [] });
    columns.push({ dist: 0, dir: 'focus', items: [byId[focusId]] });
    for (var d2 = 1; d2 <= maxDown; d2++) columns.push({ dist: d2, dir: 'down', items: [] });

    columns.forEach(function (col) {
      if (col.dir === 'focus') return;
      var src = col.dir === 'up' ? up : down;
      Object.keys(src).forEach(function (id) {
        if (src[id] === col.dist && byId[id]) col.items.push(byId[id]);
      });
      col.items.sort(function (a, b) {
        var da = (outgoing[a.id] || []).length + (incoming[a.id] || []).length;
        var db = (outgoing[b.id] || []).length + (incoming[b.id] || []).length;
        if (db !== da) return db - da;
        return a.name.localeCompare(b.name);
      });
    });

    var positions = Object.create(null), ids = [];
    var gapCol = opts.gapX || 170;
    var x = 0;
    columns.forEach(function (col) {
      var colW = 220;
      col.items.forEach(function (n) { colW = Math.max(colW, sizeOf(n).w); });
      var totalH = 0;
      col.items.forEach(function (n) { totalH += sizeOf(n).h + GAP_Y; });
      totalH = Math.max(0, totalH - GAP_Y);
      var y = -totalH / 2;
      col.items.forEach(function (n) {
        positions[n.id] = { x: x, y: y };
        ids.push(n.id);
        y += sizeOf(n).h + GAP_Y;
      });
      if (col.items.length) x += colW + gapCol;
    });

    return {
      positions: positions, ids: ids, depth: depth,
      counts: { up: Object.keys(up).length, down: Object.keys(down).length }
    };
  }

  /**
   * Generic column trace layout. `columns` = [{ label, items: [node] }]; a node
   * appearing in several columns is kept in the first one so columns stay disjoint.
   */
  function traceLayout(project, columnsIn) {
    var byId = Object.create(null);
    project.nodes.forEach(function (n) { byId[n.id] = n; });
    var sizeCache = Object.create(null);
    function sizeOf(n) {
      if (!sizeCache[n.id]) sizeCache[n.id] = measureNode(n, { showMembers: project.settings.showMembers });
      return sizeCache[n.id];
    }
    var seen = Object.create(null);
    var columns = columnsIn.map(function (c) { return { label: c.label, items: [] }; });
    columnsIn.forEach(function (c, ci) {
      (c.items || []).forEach(function (n) {
        if (!n || !byId[n.id] || seen[n.id]) return;
        seen[n.id] = true;
        columns[ci].items.push(byId[n.id]);
      });
    });

    var positions = Object.create(null), ids = [];
    var gapCol = 150;
    var x = 0;
    var columnBounds = [];
    columns.forEach(function (col) {
      if (!col.items.length) return;
      var colW = 220;
      col.items.forEach(function (n) { colW = Math.max(colW, sizeOf(n).w); });
      var totalH = 0;
      col.items.forEach(function (n) { totalH += sizeOf(n).h + GAP_Y; });
      totalH = Math.max(0, totalH - GAP_Y);
      var y = -totalH / 2;
      var top = y;
      col.items.forEach(function (n) {
        positions[n.id] = { x: x, y: y };
        ids.push(n.id);
        y += sizeOf(n).h + GAP_Y;
      });
      columnBounds.push({ label: col.label, left: x, right: x + colW, top: top, bottom: y - GAP_Y, count: col.items.length });
      x += colW + gapCol;
    });
    var counts = columns.map(function (c) { return c.items.length; });
    return { positions: positions, ids: ids, counts: counts, columnBounds: columnBounds };
  }

  /** Event trace: 定义 | 注册 | 激活 columns. `res` comes from Analysis.traceEvent. */
  function eventTraceLayout(project, res) {
    function pick(entries) {
      return (entries || []).filter(function (e) { return e && e.id; }).map(function (e) { return { id: e.id }; });
    }
    return traceLayout(project, [
      { label: '定义', items: pick(res.definitions) },
      { label: '注册', items: pick(res.subscribers) },
      { label: '激活', items: pick(res.firers) }
    ]);
  }

  /** Field/property references: 字段类型 | 声明 | 写入 | 读取 columns. `res` = Analysis.traceField. */
  function fieldTraceLayout(project, res) {
    function pick(entries) {
      return (entries || []).filter(function (e) { return e && e.id; }).map(function (e) { return { id: e.id }; });
    }
    return traceLayout(project, [
      { label: '字段类型', items: pick(res.typeClasses) },
      { label: '声明', items: pick(res.definitions) },
      { label: '写入', items: pick(res.writers) },
      { label: '读取', items: pick(res.readers) }
    ]);
  }

  /** Method references: 定义 | 调用 columns. `res` = Analysis.traceMethod. */
  function methodTraceLayout(project, res) {
    function pick(entries) {
      return (entries || []).filter(function (e) { return e && e.id; }).map(function (e) { return { id: e.id }; });
    }
    return traceLayout(project, [
      { label: '定义', items: pick(res.definitions) },
      { label: '调用', items: pick(res.callers) }
    ]);
  }

  /**
   * Cycle view: put the members of ONE dependency loop on a circle, in the order
   * they are referenced, so the loop reads as an actual loop instead of arrows
   * scattered across the canvas. Radius grows with node count and node width.
   */
  function cycleLayout(project, ids) {
    var nodes = (ids || []).map(function (id) { return Model.getNode(project, id); }).filter(Boolean);
    if (!nodes.length) return { ids: [], positions: {}, columnBounds: null };
    var maxW = 0;
    nodes.forEach(function (n) {
      var g = measureNode(n, { expanded: true });
      if (g.w > maxW) maxW = g.w;
    });
    var n = nodes.length;
    var radius = Math.max(190, (maxW + 90) * n / (2 * Math.PI));
    var positions = Object.create(null);
    nodes.forEach(function (node, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      positions[node.id] = { x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) };
    });
    return { ids: nodes.map(function (x) { return x.id; }), positions: positions, columnBounds: null, radius: radius };
  }

  /**
   * Assembly layered view read from the .asmdef chain, stacked top → bottom:
   * the assembly nobody references (the entry assembly, e.g. Root) sits on the
   * top band, and every assembly it references sits on the band below it, so
   * the reference direction always points downward:
   *   Root → [GamePlay | UI | Presentation] → Data → Core
   * - Same-depth assemblies are peers: their bands share a row, left → right.
   * - SO asset instances（.asset）form their own band placed left of the Data
   *   layer; Editor assemblies / prefab resources / the rest of the ungrouped
   *   types form separate bands in the side area.
   * Returns positions + band bounds/labels (left/right/top/bottom) so the
   * canvas can draw a clearly visible band with the layer name on its left.
   */
  function assemblyLayout(project) {
    var nodes = Model.visibleNodes(project);
    var asms = (project.assemblies || []).filter(function (a) { return a && a.name; });
    var byName = Object.create(null);
    asms.forEach(function (a) { byName[a.name] = a; });

    // dependents[X] = assemblies that reference X (i.e. sit above X).
    var dependents = Object.create(null);
    asms.forEach(function (a) { dependents[a.name] = []; });
    asms.forEach(function (a) {
      (a.refs || []).forEach(function (r) { if (dependents[r]) dependents[r].push(a.name); });
    });
    // depth(A) = 1 + max(depth of who references A); entry assemblies are 0.
    var depth = Object.create(null);
    asms.forEach(function (a) { depth[a.name] = 0; });
    var queue = asms.filter(function (a) { return !dependents[a.name].length; }).map(function (a) { return a.name; });
    var guard = 0;
    while (queue.length && guard++ < asms.length * 6 + 12) {
      var cur = queue.shift();
      ((byName[cur] && byName[cur].refs) || []).forEach(function (r) {
        if (depth[r] === undefined) return;
        if (depth[r] < depth[cur] + 1) { depth[r] = depth[cur] + 1; queue.push(r); }
      });
    }

    function isEditor(name) { return /(?:^|[.\/])Editor$/i.test(name) || /\.Editor\./i.test(name); }
    var UNASSIGNED = '（未分组）';
    var SO_GROUP = '（SO 资源）';
    var PREFAB_GROUP = '（预制体）';
    // .asset 生成的 ScriptableObject 资源实例与脚本类（SO 定义）是完全不同的东西，
    // 预制体同理：三者各自单独成组，不与 GameObject 混在一起。
    function isSoAssetNode(n) { return n.kind === 'scriptableObject' && /\.asset$/i.test(n.filePath || ''); }
    var buckets = Object.create(null);
    nodes.forEach(function (n) {
      var a = n.assembly && byName[n.assembly] ? n.assembly
        : (n.kind === 'prefab' ? PREFAB_GROUP : isSoAssetNode(n) ? SO_GROUP : UNASSIGNED);
      (buckets[a] = buckets[a] || []).push(n);
    });
    function isSpecial(name) { return name === UNASSIGNED || name === SO_GROUP || name === PREFAB_GROUP; }
    var mainNames = Object.keys(buckets).filter(function (n) { return !isSpecial(n) && !isEditor(n); });
    mainNames.sort(function (x, y) { return (depth[x] - depth[y]) || x.localeCompare(y); });
    var editorNames = Object.keys(buckets).filter(function (n) { return !isSpecial(n) && isEditor(n); }).sort();

    var sizeCache = Object.create(null);
    function sizeOf(n) {
      if (!sizeCache[n.id]) sizeCache[n.id] = measureNode(n, { showMembers: project.settings.showMembers });
      return sizeCache[n.id];
    }

    var MAX_ROWS = 6, LABEL_W = 192, BAND_PAD = 26, SUB_GAP = 64, BAND_GAP = 58, SIDE_GAP = 250;
    function makePlan(name) {
      var list = buckets[name].slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      var cols = Math.max(1, Math.ceil(list.length / MAX_ROWS));
      var colW = [], colH = [], c;
      for (c = 0; c < cols; c++) { colW[c] = 0; colH[c] = 0; }
      list.forEach(function (n, i) {
        var ci = Math.floor(i / MAX_ROWS);
        colW[ci] = Math.max(colW[ci], sizeOf(n).w);
        colH[ci] += sizeOf(n).h + GAP_Y;
      });
      for (c = 0; c < cols; c++) colH[c] = Math.max(0, colH[c] - GAP_Y);
      var height = 0;
      colH.forEach(function (h) { height = Math.max(height, h); });
      var width = LABEL_W + BAND_PAD;
      colW.forEach(function (w) { width += w + SUB_GAP; });
      width += BAND_PAD - SUB_GAP;
      return { name: name, list: list, cols: cols, colW: colW, height: Math.max(height, 56), width: width };
    }
    // 同 depth 的程序集是平级关系（如 GamePlay 与 UI）：层带共享一行，左右并排。
    var rowsByDepth = [];
    mainNames.forEach(function (name) {
      var d = depth[name] || 0;
      (rowsByDepth[d] = rowsByDepth[d] || []).push(makePlan(name));
    });
    // SO 资源与预制体、GameObject 层、Editor 一样属于"非主链"分组：
    // 全部放到右侧栏，主链只保留程序集依赖层级（Boot→Gameplay→Data→Core…）。
    var maxDepth = 0;
    rowsByDepth.forEach(function (_, d) { if (d > maxDepth) maxDepth = d; });
    var rowDepths = [];
    rowsByDepth.forEach(function (_, d) { rowDepths.push(d); });
    rowDepths.sort(function (a, b) { return a - b; });

    var totalH = 0;
    rowDepths.forEach(function (d) {
      var rowH = 0;
      rowsByDepth[d].forEach(function (p) { rowH = Math.max(rowH, p.height + BAND_PAD * 2); });
      totalH += rowH + BAND_GAP;
    });
    totalH = Math.max(0, totalH - BAND_GAP);

    var sideNames = (buckets[SO_GROUP] ? [SO_GROUP] : [])
      .concat(buckets[PREFAB_GROUP] ? [PREFAB_GROUP] : [])
      .concat(buckets[UNASSIGNED] ? [UNASSIGNED] : [])
      .concat(editorNames);
    var sidePlans = sideNames.map(makePlan);

    var positions = Object.create(null), ids = [], groups = [];
    function bandLabel(plan) {
      var name = plan.name;
      if (name === SO_GROUP) return 'SO 资源';
      if (name === PREFAB_GROUP) return '预制体';
      if (name === UNASSIGNED) {
        // 组里只有 GameObject/场景时它就是对象层；混有无 asmdef 的脚本类才叫未分组。
        var hasScript = plan.list.some(function (n) {
          return n.kind === 'class' || n.kind === 'interface' || n.kind === 'struct' ||
            n.kind === 'enum' || n.kind === 'scriptableObject';
        });
        return hasScript ? UNASSIGNED : 'GameObject 层';
      }
      return name + ' 层';
    }
    // 在 (px, top) 处放置一条层带，返回 { right, bottom }（绝对坐标）。
    function placeBand(plan, px, top, pi, isSide) {
      var bandTop = top;
      var bandBottom = bandTop + plan.height + BAND_PAD * 2;
      var accX = px + LABEL_W;
      for (var c = 0; c < plan.cols; c++) {
        var ny = bandTop + BAND_PAD;
        plan.list.forEach(function (n, i) {
          if (Math.floor(i / MAX_ROWS) !== c) return;
          positions[n.id] = { x: accX, y: ny };
          ids.push(n.id);
          ny += sizeOf(n).h + GAP_Y;
        });
        accX += plan.colW[c] + SUB_GAP;
      }
      var right = accX - SUB_GAP + BAND_PAD;
      groups.push({
        label: bandLabel(plan),
        ids: plan.list.map(function (n) { return n.id; }),
        depth: depth[plan.name] !== undefined ? depth[plan.name] : null,
        left: px, right: right,
        top: bandTop, bottom: bandBottom, index: pi, side: !!isSide
      });
      return { right: right, bottom: bandBottom };
    }

    // 主依赖链自上而下（全部从 x=0 左对齐），同层平级左右并排；
    // SO 资源 / 预制体 / GameObject 层 / Editor 全部在右侧栏（左对齐，主链高度内等分分布）。
    var mainRight = 0, mainOrder = [];
    var y = -totalH / 2;
    var pi = 0;
    rowDepths.forEach(function (d) {
      var plans = rowsByDepth[d];
      var rowH = 0;
      plans.forEach(function (p) { rowH = Math.max(rowH, p.height + BAND_PAD * 2); });
      var x = 0;
      plans.forEach(function (plan) {
        mainOrder.push(plan.name);
        var r = placeBand(plan, x, y, pi++);
        mainRight = Math.max(mainRight, r.right);
        x = r.right + BAND_GAP;
      });
      y += rowH + BAND_GAP;
    });
    var sideX = mainRight + SIDE_GAP;
    // 侧栏层带全部左对齐；多个时在主链高度内上下等分分布（单个或放不下则整体居中）。
    var sideSum = 0;
    sidePlans.forEach(function (plan) { sideSum += plan.height + BAND_PAD * 2; });
    var sy = 0, sideGap = BAND_GAP;
    if (sidePlans.length === 1 || sideSum + BAND_GAP * (sidePlans.length - 1) >= totalH) {
      sy = -(sideSum + BAND_GAP * (sidePlans.length - 1)) / 2;
    } else {
      sideGap = (totalH - sideSum) / (sidePlans.length - 1);
      sy = -totalH / 2;
    }
    sidePlans.forEach(function (plan, si) {
      var r = placeBand(plan, sideX, sy, mainOrder.length + si, true);
      sy = r.bottom + sideGap;
    });
    var order = mainOrder.concat(sideNames);
    return { positions: positions, ids: ids, groups: groups, order: order,
      mainCount: mainOrder.length, sideCount: sidePlans.length, layers: order.length };
  }

  function applyPositions(project, positions) {
    var n = 0;
    Object.keys(positions || {}).forEach(function (id) {
      var node = Model.getNode(project, id);
      if (!node || !positions[id]) return;
      node.position.x = Math.round(positions[id].x);
      node.position.y = Math.round(positions[id].y);
      n++;
    });
    return n;
  }

  /** Viewport transform: screen = center + offset + world * scale. */
  function fitBounds(project, viewport, options) {
    var opts = options || {};
    var nodes = Model.visibleNodes(project);
    if (!nodes.length) return { scale: 1, offsetX: 0, offsetY: 0 };
    var sz = sizes(project, { showMembers: project.settings.showMembers });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + sz[n.id].w);
      maxY = Math.max(maxY, n.position.y + sz[n.id].h);
    });
    var pad = opts.padding || 120;
    var bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    var scale = S.clamp(Math.min((viewport.width - pad) / bw, (viewport.height - pad) / bh), 0.15, 1.6);
    return {
      scale: scale,
      offsetX: -(minX + maxX) / 2 * scale,
      offsetY: -(minY + maxY) / 2 * scale
    };
  }

  return {
    HEADER_H: HEADER_H, ROW_H: ROW_H, GAP_Y: GAP_Y,
    memberLine: memberLine, measureNode: measureNode,
    layeredLayout: layeredLayout, gridLayout: gridLayout,
    focusLayout: focusLayout, eventTraceLayout: eventTraceLayout, fieldTraceLayout: fieldTraceLayout,
    methodTraceLayout: methodTraceLayout, assemblyLayout: assemblyLayout, cycleLayout: cycleLayout,
    applyPositions: applyPositions, fitBounds: fitBounds
  };
});
