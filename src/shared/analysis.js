/* Graph analysis: adjacency, dependency chains, SCC cycles, search. UMD. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var S = isNode ? require('./schema.js') : root.UA.Schema;
  var Model = isNode ? require('./model.js') : root.UA.Model;
  var api = factory(S, Model);
  if (isNode) module.exports = api;
  else { root.UA = root.UA || {}; root.UA.Analysis = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S, Model) {
  'use strict';

  function buildIndex(project, edges) {
    var list = edges || Model.visibleEdges(project);
    var out = Object.create(null), inn = Object.create(null);
    project.nodes.forEach(function (n) { out[n.id] = []; inn[n.id] = []; });
    list.forEach(function (e) {
      if (!out[e.from] || !inn[e.to]) return;
      out[e.from].push(e);
      inn[e.to].push(e);
    });
    return { out: out, inn: inn, edges: list };
  }

  function degrees(project, id, idx) {
    var ix = idx || buildIndex(project);
    return {
      out: ix.out[id] ? ix.out[id].length : 0,
      in: ix.inn[id] ? ix.inn[id].length : 0,
      total: (ix.out[id] ? ix.out[id].length : 0) + (ix.inn[id] ? ix.inn[id].length : 0)
    };
  }

  /** BFS dependency closure. direction: 'out' | 'in' | 'both'. */
  function neighbors(project, id, options) {
    var opts = options || {};
    var direction = opts.direction || 'out';
    var depth = Math.max(1, Math.min(8, opts.depth || 1));
    var idx = opts.index || buildIndex(project);
    var visited = new Set([id]);
    var levels = [], edgeIds = new Set();
    var frontier = [id];
    for (var d = 0; d < depth; d++) {
      var next = [];
      frontier.forEach(function (cur) {
        var buckets = [];
        if (direction === 'out' || direction === 'both') buckets.push(idx.out[cur] || []);
        if (direction === 'in' || direction === 'both') buckets.push(idx.inn[cur] || []);
        buckets.forEach(function (edges) {
          edges.forEach(function (e) {
            if (opts.kindFilter && opts.kindFilter.indexOf(e.kind) < 0) return;
            edgeIds.add(e.id);
            var other = e.from === cur ? e.to : e.from;
            if (!visited.has(other)) { visited.add(other); next.push(other); }
          });
        });
      });
      if (!next.length) break;
      levels.push(next.slice());
      frontier = next;
    }
    visited.delete(id);
    return { ids: Array.from(visited), levels: levels, edgeIds: Array.from(edgeIds) };
  }

  /** Iterative Kosaraju - safe for large graphs (no recursion). */
  function findCycles(project, edges) {
    var idx = buildIndex(project, edges);
    var ids = project.nodes.map(function (n) { return n.id; });
    var visited = Object.create(null), order = [];
    ids.forEach(function (start) {
      if (visited[start]) return;
      var stack = [{ id: start, i: 0 }];
      visited[start] = true;
      while (stack.length) {
        var top = stack[stack.length - 1];
        var list = idx.out[top.id] || [];
        if (top.i < list.length) {
          var nxt = list[top.i++].to;
          if (!visited[nxt]) { visited[nxt] = true; stack.push({ id: nxt, i: 0 }); }
        } else { order.push(top.id); stack.pop(); }
      }
    });
    var rev = Object.create(null);
    ids.forEach(function (id) { rev[id] = []; });
    idx.edges.forEach(function (e) { if (rev[e.to]) rev[e.to].push(e.from); });
    var assigned = Object.create(null), comps = [];
    for (var k = order.length - 1; k >= 0; k--) {
      var seed = order[k];
      if (assigned[seed]) continue;
      var comp = [], st = [seed];
      assigned[seed] = true;
      while (st.length) {
        var cur = st.pop();
        comp.push(cur);
        (rev[cur] || []).forEach(function (p) {
          if (!assigned[p]) { assigned[p] = true; st.push(p); }
        });
      }
      if (comp.length > 1) comps.push(comp);
    }
    idx.edges.forEach(function (e) {
      if (e.from === e.to) comps.push([e.from]);
    });
    return comps.map(function (comp, i) {
      var set = new Set(comp);
      return {
        id: 'cycle_' + i,
        nodeIds: comp,
        edges: idx.edges.filter(function (e) { return set.has(e.from) && set.has(e.to); }).map(function (e) { return e.id; }),
        length: comp.length
      };
    });
  }

  /** 孤立只看脚本：GameObject/预制体/场景等资源节点天生可以没有连线，不参与判定。 */
  var SCRIPT_KINDS = { 'class': 1, 'struct': 1, 'interface': 1, 'enum': 1, 'scriptableObject': 1 };
  function isolatedNodes(project, idx) {
    var ix = idx || buildIndex(project);
    return project.nodes.filter(function (n) {
      if (!SCRIPT_KINDS[n.kind]) return false;
      return (!ix.out[n.id] || !ix.out[n.id].length) && (!ix.inn[n.id] || !ix.inn[n.id].length);
    }).map(function (n) { return n.id; });
  }

  /**
   * Collect every memberRefs record in the project once:
   * [{ owner: node, member: containing member, ref: { type, name, action, via, snippet } }]
   */
  function collectRefs(project) {
    var list = [];
    project.nodes.forEach(function (n) {
      // 组件实例的成员是从类节点复制来的展示副本，代码级引用统计只看类节点，
      // 否则同一个成员的引用会被实例与类各算一遍
      if (n.kind === 'component') return;
      (n.members || []).forEach(function (m) {
        (m.memberRefs || []).forEach(function (u) {
          list.push({ owner: n, member: m, ref: u });
        });
      });
    });
    return list;
  }

  function entryFor(list, node) {
    var e = list.find(function (x) { return x.id === node.id; });
    if (!e) {
      e = { id: node.id, name: node.name, methods: [], details: [] };
      list.push(e);
    }
    return e;
  }

  var ACTION_LABEL = {
    read: '读取', write: '写入', call: '调用',
    fire: '激活', subscribe: '注册', unsubscribe: '注销'
  };

  /**
   * Trace one event across the project (VS "find all references" semantics):
   * - definitions: classes that declare `event X` (only the one owned by
   *                `typeKey` when the caller knows which class it clicked)
   * - subscribers: classes that register/unregister it (`x += h` / `x -= h`,
   *                receiver chains like `db.State.Changed += Refresh` resolve too)
   * - firers:      classes that raise it (`x?.Invoke()`, `x(...)`)
   * Each entry carries { id, name, methods: [..], details: [{ method, action, via, snippet }] }.
   */
  function traceEvent(project, eventName, typeKey) {
    var name = String(eventName || '').trim();
    var res = { event: name, typeKey: typeKey || '', definitions: [], subscribers: [], firers: [], details: [] };
    if (!name) return res;
    project.nodes.forEach(function (n) {
      // Same event name in another class must not leak into this trace.
      if (typeKey && n.sourceKey !== typeKey) return;
      if (n.kind === 'component') return; // 组件实例是展示副本，定义只认类节点
      (n.members || []).forEach(function (m) {
        if (m.kind === 'event' && m.name === name && !res.definitions.some(function (d) { return d.id === n.id; })) {
          res.definitions.push({ id: n.id, name: n.name, methods: [], details: [] });
          res.details.push({ id: n.id, name: n.name, kindLabel: '定义', rows: [{ action: '', method: m.name, via: '', snippet: 'event ' + m.name + ' : ' + (m.type || 'var') }] });
        }
      });
    });
    var defIds = new Set(res.definitions.map(function (d) { return d.id; }));
    var defKeys = new Set();
    project.nodes.forEach(function (n) {
      if (defIds.has(n.id)) (n.members || []).forEach(function (m) { if (m.kind === 'event' && m.name === name) defKeys.add(n.sourceKey); });
    });
    // Every class that declares a same-name event — kept only for the
    // definitions pass below; unresolved refs are never attributed (they would
    // turn any same-name call anywhere into a false subscriber/firer).
    collectRefs(project).forEach(function (it) {
      var u = it.ref;
      if (u.name !== name) return;
      if (u.action !== 'fire' && u.action !== 'subscribe' && u.action !== 'unsubscribe') return;
      if (!defKeys.has(u.type)) return; // receiver unresolved or a different same-name member
      var bucket = u.action === 'fire' ? res.firers : res.subscribers;
      var entry = entryFor(bucket, it.owner);
      if (entry.methods.indexOf(it.member.name) < 0) entry.methods.push(it.member.name);
      entry.details.push({ method: it.member.name, action: u.action, via: u.via, snippet: u.snippet });
    });
    // VS-style detail rows grouped per class.
    var seenClass = Object.create(null);
    res.subscribers.concat(res.firers).forEach(function (e) {
      if (seenClass[e.id]) return;
      seenClass[e.id] = true;
      res.details.push({
        id: e.id, name: e.name,
        kindLabel: defIds.has(e.id) ? '定义 · 触发' : '使用',
        rows: e.details.map(function (d) {
          return { action: d.action, method: d.method, via: d.via, snippet: d.snippet };
        })
      });
    });
    return res;
  }

  /**
   * Data flow / all references of one field or property (VS-style):
   * - definitions: classes declaring the member (with initial value)
   * - writers / readers: from memberRefs, chain-resolved when possible
   * - sources / sinks: multi-hop value flow (param passing, cross-object
   *   assignment, SO asset serialization origins).
   */
  function paramNamesOf(m) {
    return String(m.parameters || '').split(',').map(function (pp) {
      var ids = pp.match(/[A-Za-z_]\w*/g);
      return ids && ids.length ? ids[ids.length - 1] : '';
    }).filter(Boolean);
  }

  function buildFlowGraph(project) {
    var byKey = Object.create(null);
    var fieldsOf = Object.create(null);
    project.nodes.forEach(function (n) {
      if (!n.sourceKey) return;
      byKey[n.sourceKey] = n;
      fieldsOf[n.sourceKey] = (n.members || []).filter(function (m) {
        return m.kind === 'field' || m.kind === 'property';
      }).map(function (m) { return m.name; });
    });
    var hasField = function (key, name) { return (fieldsOf[key] || []).indexOf(name) >= 0; };
    var edges = [];
    project.nodes.forEach(function (n) {
      if (!n.sourceKey) return;
      (n.members || []).forEach(function (m) {
        if (m.kind !== 'method') return;
        var params = paramNamesOf(m);
        var hasParam = function (nm) { return params.indexOf(nm) >= 0; };
        // `field = param` inside method M of type A: the M(param) entry point writes A.field.
        (m.paramFlows || []).forEach(function (pf) {
          if (!hasField(n.sourceKey, pf.field)) return;
          edges.push({
            from: 'p:' + n.sourceKey + '\u0001' + m.name + '\u0001' + pf.param,
            to: 'f:' + n.sourceKey + '\u0001' + pf.field,
            via: { node: n.name, method: m.name, kind: 'write' }
          });
        });
        // `receiver.field = x`: a value handed over to another object.
        (m.assignFlows || []).forEach(function (af) {
          if (!byKey[af.type]) return;
          var from = hasField(n.sourceKey, af.from)
            ? 'f:' + n.sourceKey + '\u0001' + af.from
            : (hasParam(af.from) ? 'p:' + n.sourceKey + '\u0001' + m.name + '\u0001' + af.from : null);
          if (!from) return;
          edges.push({
            from: from,
            to: 'f:' + af.type + '\u0001' + af.to,
            via: { node: n.name, method: m.name, kind: 'pass', target: af.to }
          });
        });
        // `receiver.Method(arg)`: the argument value flows into the callee's parameter.
        (m.callTargets || []).forEach(function (ct) {
          var targetNode = byKey[ct.type];
          if (!targetNode || !Array.isArray(ct.args)) return;
          var tm = (targetNode.members || []).find(function (x) {
            return x.kind === 'method' && x.name === ct.member;
          });
          var tParams = tm ? paramNamesOf(tm) : [];
          ct.args.forEach(function (argName, i) {
            if (!argName) return;
            var pname = tParams[i];
            if (!pname) return;
            var from = hasField(n.sourceKey, argName)
              ? 'f:' + n.sourceKey + '\u0001' + argName
              : (hasParam(argName) ? 'p:' + n.sourceKey + '\u0001' + m.name + '\u0001' + argName : null);
            if (!from) return;
            edges.push({
              from: from,
              to: 'p:' + ct.type + '\u0001' + ct.member + '\u0001' + pname,
              via: { node: n.name, method: m.name, kind: 'call', target: targetNode.name + '.' + ct.member }
            });
          });
        });
      });
    });
    return edges;
  }

  /** Actual data element type of a declared member type:
   *  TrackedRow[] / List<TrackedRow> / IReadOnlyList<TrackedRow> /
   *  Dictionary<string, TrackedRow> / Nullable<TrackedRow> → 'TrackedRow'.
   *  容器（数组/列表/字典/可空）只是包装，数据类型取元素类型；
   *  字典取最后一个类型参数（值类型），嵌套泛型递归解包。 */
  function splitTypeArgs(s) {
    var parts = [], depth = 0, start = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '<' || c === '(' || c === '[') depth++;
      else if (c === '>' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
      else if (c === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    parts.push(s.slice(start));
    return parts.map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function elementTypeOf(typeStr) {
    var t = String(typeStr || '').trim();
    for (var guard = 0; guard < 8; guard++) {
      var arr = /\[\s*\]$/.exec(t);
      if (arr) { t = t.slice(0, arr.index).trim(); continue; }
      var g = /<([\s\S]*)>$/.exec(t);
      if (g) {
        var args = splitTypeArgs(g[1]);
        if (!args.length) return '';
        t = args[args.length - 1];
        continue;
      }
      return t.replace(/\?\s*$/, '').trim();
    }
    return t;
  }

  function holderToEntry(project, byKey, holder) {
    var rest = String(holder).slice(2); // strip 'f:' / 'p:'
    var cut = rest.indexOf('\u0001');
    if (cut < 0) return null;
    var key = rest.slice(0, cut);
    var node = byKey[key];
    if (!node) return null;
    return { id: node.id, name: node.name, holder: holder };
  }

  function bfsFlow(starts, edges, forward) {
    // Returns Map holder -> { edge, depth } of first arrival (excluding starts).
    var startSet = new Set(starts);
    var adj = Object.create(null);
    edges.forEach(function (e) {
      var a = forward ? e.from : e.to;
      var b = forward ? e.to : e.from;
      (adj[a] = adj[a] || []).push(forward ? { edge: e, to: b } : { edge: e, to: b });
    });
    var dist = Object.create(null), queue = [];
    starts.forEach(function (s) { dist[s] = 0; queue.push(s); });
    var out = Object.create(null);
    while (queue.length) {
      var cur = queue.shift();
      (adj[cur] || []).forEach(function (link) {
        if (dist[link.to] !== undefined || startSet.has(link.to)) return;
        dist[link.to] = (dist[cur] || 0) + 1;
        out[link.to] = link.edge;
        queue.push(link.to);
      });
    }
    return out;
  }

  function flowDetail(via) {
    if (!via) return '';
    if (via.kind === 'call') return via.node + '.' + via.method + '() 传参 → ' + (via.target || '');
    if (via.kind === 'write') return via.node + '.' + via.method + '(参数) 写入';
    return via.node + '.' + via.method + '() 赋值 → ' + (via.target || '');
  }

  function traceField(project, fieldName, typeKey) {
    var name = String(fieldName || '').trim();
    var res = { field: name, definitions: [], writers: [], readers: [], sources: [], sinks: [], typeClasses: [], details: [] };
    if (!name) return res;
    var byKey = Object.create(null), byId = Object.create(null);
    project.nodes.forEach(function (n) { byId[n.id] = n; if (n.sourceKey) byKey[n.sourceKey] = n; });

    // All classes declaring a member with this name (field or property).
    project.nodes.forEach(function (n) {
      if (n.kind === 'component') return; // 组件实例是展示副本，定义只认类节点
      var isDef = false, defMember = null;
      (n.members || []).forEach(function (m) {
        if ((m.kind === 'field' || m.kind === 'property') && m.name === name &&
          (!typeKey || n.sourceKey === typeKey)) {
          isDef = true;
          if (!defMember) defMember = m;
        }
      });
      if (isDef) {
        res.definitions.push({ id: n.id, name: n.name, methods: [], init: defMember ? defMember.initialValue : '' });
        res.details.push({
          id: n.id, name: n.name, kindLabel: '声明',
          rows: [{ action: '', method: defMember.name, via: '',
            snippet: (defMember.kind === 'property' ? 'property ' : 'field ') + defMember.name + ' : ' + (defMember.type || 'var') +
              (defMember.initialValue ? ' = ' + defMember.initialValue : '') }]
        });
      }
    });
    if (!res.definitions.length) return res;
    var defKeys = new Set(res.definitions.map(function (d) { return byId[d.id].sourceKey; }));

    // Declared type of the member: surfaced as an extra trace column so the
    // canvas also shows the object this field/property points at, even when
    // every reference happens to live inside the declaring class.
    res.definitions.forEach(function (def) {
      var node = byId[def.id];
      var mem = (node.members || []).find(function (m) {
        return (m.kind === 'field' || m.kind === 'property') && m.name === name;
      });
      if (!mem) return;
      var rtype = elementTypeOf(mem.type);
      if (!rtype) return;
      var typeNode = project.nodes.find(function (x) { return x.name === rtype && x.kind !== 'enum'; });
      if (typeNode && !res.typeClasses.some(function (x) { return x.id === typeNode.id; })) {
        res.typeClasses.push({ id: typeNode.id, name: typeNode.name });
      }
    });

    // Writers / readers from the VS-style reference records.
    collectRefs(project).forEach(function (it) {
      var u = it.ref;
      if (u.name !== name || (u.action !== 'write' && u.action !== 'read')) return;
      if (!defKeys.has(u.type)) return; // receiver unresolved or a different same-name member
      var entry = entryFor(u.action === 'write' ? res.writers : res.readers, it.owner);
      if (entry.methods.indexOf(it.member.name) < 0) entry.methods.push(it.member.name);
      entry.details = entry.details || [];
      entry.details.push({ method: it.member.name, action: u.action, via: u.via, snippet: u.snippet });
    });
    // Detail rows: group per class (definitions first, then writers, readers).
    var seenClass = Object.create(null);
    res.definitions.forEach(function (d) { seenClass[d.id] = true; });
    res.writers.concat(res.readers).forEach(function (e) {
      if (seenClass[e.id]) return;
      seenClass[e.id] = true;
      res.details.push({
        id: e.id, name: e.name, kindLabel: '使用',
        rows: (e.details || []).map(function (d) {
          return { action: d.action, method: d.method, via: d.via, snippet: d.snippet };
        })
      });
    });

    // Multi-hop value flow (unchanged): seeds = declaring field holders.
    var seeds = res.definitions.map(function (d) {
      return 'f:' + (byId[d.id].sourceKey || d.id) + '\u0001' + name;
    });

    var edges = buildFlowGraph(project);
    var up = bfsFlow(seeds, edges, false);   // holder -> edge that reached it
    var down = bfsFlow(seeds, edges, true);
    var seenEntry = Object.create(null);
    function pushEntry(list, holder, edge) {
      var entry = holderToEntry(project, byKey, holder);
      if (!entry) return;
      var defNodeIds = new Set(res.definitions.map(function (d) { return d.id; }));
      if (defNodeIds.has(entry.id) && seeds.indexOf(holder) >= 0) return;
      var k = entry.id + '|' + (edge ? edge.via.kind + edge.via.node + edge.via.method : '');
      if (seenEntry[k]) return;
      seenEntry[k] = true;
      entry.detail = flowDetail(edge && edge.via);
      list.push(entry);
    }
    Object.keys(up).forEach(function (h) { pushEntry(res.sources, h, up[h]); });
    Object.keys(down).forEach(function (h) { pushEntry(res.sinks, h, down[h]); });

    // SO resource origins: if the field's declared type is a ScriptableObject
    // class, scene / prefab fields serialize an instance of it — surface that
    // resource chain as a source (SO asset -> GameObject that references it).
    var seenRes = Object.create(null);
    res.definitions.forEach(function (def) {
      var defNode = byId[def.id];
      if (!defNode || !defNode.sourceKey) return;
      var mem = (defNode.members || []).find(function (m) {
        return (m.kind === 'field' || m.kind === 'property') && m.name === name;
      });
      if (!mem) return;
      var rtype = elementTypeOf(mem.type);
      if (!rtype) return;
      var typeNode = project.nodes.find(function (x) { return x.name === rtype; });
      if (!typeNode) return;
      project.edges.forEach(function (e) {
        if (e.kind !== 'compose' || e.to !== typeNode.id) return;
        var asset = byId[e.from];
        if (!asset || String(asset.sourceKey || '').indexOf('asset:') !== 0) return;
        if (!seenRes[asset.id]) {
          seenRes[asset.id] = true;
          res.sources.push({ id: asset.id, name: asset.name, detail: 'SO 资源（' + typeNode.name + ' 实例）' });
        }
        project.edges.forEach(function (e2) {
          if (e2.kind !== 'serialize' || e2.to !== asset.id) return;
          if (e2.sourceMember && e2.sourceMember !== name) return;
          var go = byId[e2.from];
          if (!go || seenRes[go.id + '#' + asset.id]) return;
          seenRes[go.id + '#' + asset.id] = true;
          res.sources.push({ id: go.id, name: go.name, detail: '字段 ' + name + ' 序列化引用 SO 资源 ' + asset.name });
        });
      });
    });
    return res;
  }

  /**
   * VS "find all references" for a method: who defines it and who calls it
   * (including method-group passes like `+= Refresh`).
   */
  function traceMethod(project, methodName, typeKey) {
    var name = String(methodName || '').trim();
    var res = { method: name, definitions: [], callers: [], readers: [], details: [] };
    if (!name) return res;
    project.nodes.forEach(function (n) {
      if (n.kind === 'component') return; // 组件实例是展示副本，定义只认类节点
      (n.members || []).forEach(function (m) {
        if (m.kind === 'method' && m.name === name && (!typeKey || n.sourceKey === typeKey) &&
          !res.definitions.some(function (d) { return d.id === n.id; })) {
          res.definitions.push({ id: n.id, name: n.name, methods: [] });
          res.details.push({
            id: n.id, name: n.name, kindLabel: '定义',
            rows: [{ action: '', method: m.name, via: '', snippet: m.name + '(' + (m.parameters || '') + ') : ' + (m.returnType || 'void') }]
          });
        }
      });
    });
    if (!res.definitions.length) return res;
    var defKeys = new Set(res.definitions.map(function (d) {
      var node = Model.getNode(project, d.id);
      return node ? node.sourceKey : '';
    }));
    collectRefs(project).forEach(function (it) {
      var u = it.ref;
      if (u.name !== name || (u.action !== 'call' && u.action !== 'read')) return;
      if (!defKeys.has(u.type)) return; // receiver unresolved or a different same-name member
      var bucket = u.action === 'call' ? res.callers : res.readers;
      var entry = entryFor(bucket, it.owner);
      if (entry.methods.indexOf(it.member.name) < 0) entry.methods.push(it.member.name);
      entry.details = entry.details || [];
      entry.details.push({ method: it.member.name, action: u.action, via: u.via, snippet: u.snippet });
    });
    var seenClass = Object.create(null);
    res.definitions.forEach(function (d) { seenClass[d.id] = true; });
    res.callers.concat(res.readers).forEach(function (e) {
      if (seenClass[e.id]) return;
      seenClass[e.id] = true;
      res.details.push({
        id: e.id, name: e.name, kindLabel: '使用',
        rows: (e.details || []).map(function (d) {
          return { action: d.action, method: d.method, via: d.via, snippet: d.snippet };
        })
      });
    });
    return res;
  }

  /** Reference count of one member for the inspector badge (reads/writes/calls/uses). */
  function refCount(project, typeKey, memberName) {
    var n = 0;
    collectRefs(project).forEach(function (it) {
      var u = it.ref;
      if (u.name !== memberName) return;
      if (u.type !== typeKey) return; // unresolved receivers are never attributed
      n++;
    });
    return n;
  }

  function summary(project) {
    var idx = buildIndex(project);
    var byKind = Object.create(null), byNodeKind = Object.create(null);
    idx.edges.forEach(function (e) { byKind[e.kind] = (byKind[e.kind] || 0) + 1; });
    project.nodes.forEach(function (n) { byNodeKind[n.kind] = (byNodeKind[n.kind] || 0) + 1; });
    var top = project.nodes.map(function (n) {
      return { id: n.id, name: n.name, degree: degrees(project, n.id, idx).total };
    }).sort(function (a, b) { return b.degree - a.degree; }).slice(0, 8);
    return {
      nodes: project.nodes.length,
      visibleNodes: Model.visibleNodes(project).length,
      edges: idx.edges.length,
      byKind: byKind, byNodeKind: byNodeKind,
      cycles: findCycles(project, idx.edges),
      isolated: isolatedNodes(project, idx),
      topConnected: top,
      staleNodes: project.nodes.filter(function (n) { return n.stale; }).length
    };
  }

  /**
   * 项目体检：不改变画布，只把图分析结果整理成一份可执行的问题清单。
   * 每个问题都带 nodeIds / edgeIds，点击即可定位；循环问题另带 cycleId 用于环形子图视图。
   */
  function healthReport(project) {
    var idx = buildIndex(project);
    var byId = Object.create(null);
    project.nodes.forEach(function (n) { byId[n.id] = n; });
    var scripts = project.nodes.filter(function (n) { return SCRIPT_KINDS[n.kind]; });
    var scriptTotal = Math.max(1, scripts.length);

    // ---- 1. 循环依赖：环上每个类都让改动传导，是最该先拆的 ----
    var cycles = findCycles(project, idx.edges).sort(function (a, b) { return b.length - a.length; });
    var cycleAll = cycles.map(function (c, i) {
      var names = c.nodeIds.map(function (x) { return byId[x] ? byId[x].name : x; });
      return {
        label: '环 ' + (i + 1) + ' · ' + c.length + ' 个类',
        sub: names.slice(0, 6).join(' → ') + (names.length > 6 ? ' → …' : '') + ' → ' + names[0],
        nodeIds: c.nodeIds, edgeIds: c.edges, cycleId: c.id, open: 'cycle'
      };
    });

    // ---- 2. 耦合中心：谁都在引用它，动一下全项目抖三抖 ----
    var hubMin = Math.max(4, Math.ceil(scriptTotal * 0.15));
    var hubAll = scripts.map(function (n) {
      var d = degrees(project, n.id, idx);
      return { n: n, d: d };
    }).filter(function (x) { return x.d.in >= hubMin; })
      .sort(function (a, b) { return b.d.in - a.d.in; })
      .map(function (x) {
        return {
          label: x.n.name,
          sub: '被 ' + x.d.in + ' 处引用 · 自身依赖 ' + x.d.out + ' 个',
          nodeIds: [x.n.id], open: 'node'
        };
      });

    // ---- 3. 上帝类：字段方法堆在一起，职责不清 ----
    var godAll = scripts.map(function (n) {
      var c = { field: 0, method: 0, event: 0, property: 0 };
      (n.members || []).forEach(function (m) { if (c[m.kind] !== undefined) c[m.kind] += 1; });
      var total = c.field + c.method + c.event + c.property;
      return { n: n, c: c, total: total };
    }).filter(function (x) { return x.total >= 20; })
      .sort(function (a, b) { return b.total - a.total; })
      .map(function (x) {
        return {
          label: x.n.name,
          sub: x.total + ' 个成员（变量 ' + x.c.field + ' / 方法 ' + x.c.method +
            ' / 属性 ' + x.c.property + ' / 事件 ' + x.c.event + '）',
          nodeIds: [x.n.id], open: 'node'
        };
      });

    // ---- 4. 孤立脚本：没有任何引用关系 ----
    var isoAll = isolatedNodes(project, idx).map(function (x) {
      var n = byId[x];
      return { label: n ? n.name : x, sub: n && n.namespace ? n.namespace : '无命名空间', nodeIds: [x], open: 'node' };
    });

    // ---- 5. 空壳类型：除了声明什么都没有 ----
    var emptyAll = scripts.filter(function (n) {
      return (n.kind === 'class' || n.kind === 'struct') && !(n.members || []).length;
    }).map(function (n) {
      return { label: n.name, sub: '声明了但没有任何成员', nodeIds: [n.id], open: 'node' };
    });

    // ---- 6. 缺命名空间：Unity 工程里最容易演变成全局面条 ----
    var noNsAll = scripts.filter(function (n) { return !n.namespace; }).map(function (n) {
      return { label: n.name, sub: '未归入任何命名空间', nodeIds: [n.id], open: 'node' };
    });

    // ---- 7. 失效节点：源文件已被删除或改名 ----
    var staleAll = project.nodes.filter(function (n) { return n.stale; }).map(function (n) {
      return { label: n.name, sub: '源文件已不存在', nodeIds: [n.id], open: 'node' };
    });

    var nsRatio = noNsAll.length / scriptTotal;
    var nsPenalty = nsRatio > 0.5 ? 10 : (nsRatio > 0.25 ? 6 : (noNsAll.length ? 3 : 0));

    var groups = [
      { key: 'cycle', label: '循环依赖', severity: 'high', cap: 25, unit: 5,
        hint: '两个以上的类互相引用，改动会在环里来回传导，也无法单独测试或拆包。',
        items: cycleAll, count: cycleAll.length },
      { key: 'hub', label: '耦合中心', severity: 'warn', cap: 12, unit: 3,
        hint: '被大量类引用的节点：它一变，所有引用方都要跟着改。确认它是否职责过宽。',
        items: hubAll.slice(0, 8), count: hubAll.length },
      { key: 'god', label: '上帝类', severity: 'warn', cap: 10, unit: 2,
        hint: '成员过多的类往往混了多个职责，是拆分的第一候选。',
        items: godAll.slice(0, 8), count: godAll.length },
      { key: 'isolated', label: '孤立脚本', severity: 'warn', cap: 8, unit: 1,
        hint: '既不引用别人也没人引用它。可能是废弃代码，也可能是靠反射/Resources.Load 调用的，需人工确认。',
        items: isoAll.slice(0, 20), count: isoAll.length },
      { key: 'empty', label: '空壳类型', severity: 'info', cap: 5, unit: 1,
        hint: '只有声明没有成员，通常是占位或删代码留下的壳子。',
        items: emptyAll.slice(0, 12), count: emptyAll.length },
      { key: 'ns', label: '缺命名空间', severity: 'info', cap: 10, unit: 0,
        hint: '没有命名空间的类会进入全局作用域，容易和其他插件重名。',
        items: noNsAll.slice(0, 12), count: noNsAll.length, penalty: nsPenalty },
      { key: 'stale', label: '失效节点', severity: 'info', cap: 4, unit: 0.5,
        hint: '上次扫描后源文件消失，图里还留着旧节点。可在工程信息里一键清理。',
        items: staleAll.slice(0, 12), count: staleAll.length }
    ];

    var penalty = 0, total = 0;
    groups.forEach(function (g) {
      total += g.count;
      var p = g.penalty !== undefined ? g.penalty : Math.min(g.count * g.unit, g.cap);
      g.penalty = p;
      penalty += p;
    });
    var score = Math.max(0, Math.round(100 - penalty));
    return {
      score: score,
      grade: score >= 85 ? '清爽' : (score >= 70 ? '尚可' : (score >= 50 ? '需关注' : '亟需治理')),
      total: total,
      groups: groups,
      metrics: { scripts: scripts.length, edges: idx.edges.length, cycles: cycles.length }
    };
  }

  /** Global search across nodes, members and edges. Returns plain display records. */
  function search(project, query, options) {
    var q = String(query || '').trim().toLowerCase();
    var opts = options || {};
    var results = [];
    var limit = opts.limit || 200;
    if (!q) return results;
    var types = opts.types || ['node', 'member', 'edge'];
    if (types.indexOf('node') >= 0) {
      project.nodes.forEach(function (n) {
        var hay = [n.name, n.fullName, n.namespace, n.filePath, n.note, (n.tags || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) >= 0) {
          results.push({ type: 'node', id: n.id, nodeId: n.id, label: n.name,
            sub: (S.NODE_KINDS[n.kind] || {}).label + ' · ' + (n.namespace || n.filePath || '') });
        }
      });
    }
    if (types.indexOf('member') >= 0) {
      project.nodes.forEach(function (n) {
        (n.members || []).forEach(function (m) {
          var hay = [m.name, m.type, m.returnType, m.parameters, m.note].join(' ').toLowerCase();
          if (hay.indexOf(q) >= 0) {
            results.push({ type: 'member', id: m.id, nodeId: n.id, label: m.name,
              sub: n.name + ' · ' + m.kind + ' · ' + (m.type || m.returnType) });
          }
        });
      });
    }
    if (types.indexOf('edge') >= 0) {
      project.edges.forEach(function (e) {
        var hay = [e.label, e.note, e.kind, e.sourceMember].join(' ').toLowerCase();
        if (hay.indexOf(q) >= 0) {
          var a = Model.getNode(project, e.from), b = Model.getNode(project, e.to);
          results.push({ type: 'edge', id: e.id, nodeId: e.from, label: e.label || (S.EDGE_KINDS[e.kind] || {}).label,
            sub: (a ? a.name : '?') + ' → ' + (b ? b.name : '?') });
        }
      });
    }
    return results.slice(0, limit);
  }

  /** 数据溯源：从某节点出发回答「数据从哪里来、到哪里去」。
   *  根 = 资产节点（SO / 场景 / 预制体，磁盘上唯一一份的数据）或没有出边的代码叶子。
   *  下游沿「它引用谁」走到根；上游沿「被谁引用」走到没有再被引用的顶层消费者。 */
  function rootTrace(project, nodeId) {
    var byId = Object.create(null);
    project.nodes.forEach(function (n) { byId[n.id] = n; });
    var empty = { origin: null, roots: [], consumers: [], cycles: 0, counts: { roots: 0, assetRoots: 0, leafRoots: 0, consumers: 0 } };
    if (!byId[nodeId]) return empty;
    var ix = buildIndex(project);

    function isAsset(n) { return n.kind === 'soAsset' || n.kind === 'scene' || n.kind === 'prefab'; }

    // 下游找根：沿出边递归；资产节点即停，出度 0 的节点也是根。
    // SO 脚本类本身不是根——引用它的类实际引用的是 .asset 实例，根重定向到资产。
    function assetInstancesOf(id) {
      var out = [];
      ix.inn[id].forEach(function (e) {
        var f = byId[e.from];
        if (f && f.kind === 'soAsset' && out.indexOf(f) < 0) out.push(f);
      });
      return out;
    }

    var downDist = Object.create(null);
    var cycles = 0;
    (function dfs(id, dist, stack) {
      var n = byId[id];
      var isLeaf = !ix.out[id].length;
      if (id !== nodeId && (isAsset(n) || isLeaf)) {
        if (n.kind === 'scriptableObject') {
          var inst = assetInstancesOf(id);
          if (inst.length) {
            inst.forEach(function (a) {
              if (downDist[a.id] === undefined || dist + 1 < downDist[a.id]) downDist[a.id] = dist + 1;
            });
            return;
          }
        }
        if (downDist[id] === undefined || dist < downDist[id]) downDist[id] = dist;
        return;
      }
      if (stack.indexOf(id) >= 0) { cycles++; return; }
      if (downDist[id] !== undefined && downDist[id] <= dist) return;
      downDist[id] = dist;
      var nextStack = stack.concat([id]);
      ix.out[id].forEach(function (e) { dfs(e.to, dist + 1, nextStack); });
    })(nodeId, 0, []);
    delete downDist[nodeId];

    // 上游找消费者：沿入边递归；没有再被引用的节点就是顶层消费者。
    var upDist = Object.create(null);
    (function dfs(id, dist, stack) {
      var n = byId[id];
      if (id !== nodeId && !ix.inn[id].length) {
        if (upDist[id] === undefined || dist < upDist[id]) upDist[id] = dist;
        return;
      }
      if (stack.indexOf(id) >= 0) return;
      if (upDist[id] !== undefined && upDist[id] <= dist) return;
      upDist[id] = dist;
      var nextStack = stack.concat([id]);
      ix.inn[id].forEach(function (e) { dfs(e.from, dist + 1, nextStack); });
    })(nodeId, 0, []);
    delete upDist[nodeId];

    function collect(map, rootOnly) {
      var out = [];
      Object.keys(map).forEach(function (id) {
        var n = byId[id];
        if (!n) return;
        if (rootOnly && !isAsset(n) && ix.out[id].length) return;
        out.push({ id: id, name: n.name, kind: n.kind, dist: map[id], asset: isAsset(n) });
      });
      out.sort(function (a, b) { return a.dist - b.dist || a.name.localeCompare(b.name); });
      return out;
    }

    var roots = collect(downDist, true);
    // 消费者只取「顶层」——没有再被任何节点引用的终点（如场景、顶层类）。
    var consumers = Object.keys(upDist).filter(function (id) {
      var n = byId[id];
      return n && !ix.inn[id].length;
    }).map(function (id) {
      var n = byId[id];
      return { id: id, name: n.name, kind: n.kind, dist: upDist[id], asset: isAsset(n) };
    }).sort(function (a, b) { return a.dist - b.dist || a.name.localeCompare(b.name); });
    var assetRoots = roots.filter(function (r) { return r.asset; }).length;
    return {
      origin: byId[nodeId],
      originIsRoot: isAsset(byId[nodeId]) || !ix.out[nodeId].length,
      originRootKind: isAsset(byId[nodeId]) ? '资产' : (!ix.out[nodeId].length ? '叶' : ''),
      roots: roots, consumers: consumers, cycles: cycles,
      counts: { roots: roots.length, assetRoots: assetRoots, leafRoots: roots.length - assetRoots, consumers: consumers.length }
    };
  }

  return {
    buildIndex: buildIndex, degrees: degrees, neighbors: neighbors,
    findCycles: findCycles, isolatedNodes: isolatedNodes,
    traceEvent: traceEvent, traceField: traceField, traceMethod: traceMethod, refCount: refCount,
    rootTrace: rootTrace,
    summary: summary, search: search, healthReport: healthReport
  };
});
