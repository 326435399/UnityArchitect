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
    // Every class that declares a same-name event: used to drop unresolved
    // references coming from the *other* Changed when only one is traced.
    var sameNameDeclKeys = new Set();
    project.nodes.forEach(function (n) {
      if ((n.members || []).some(function (m) { return m.kind === 'event' && m.name === name; })) sameNameDeclKeys.add(n.sourceKey);
    });
    collectRefs(project).forEach(function (it) {
      var u = it.ref;
      if (u.name !== name) return;
      if (u.action !== 'fire' && u.action !== 'subscribe' && u.action !== 'unsubscribe') return;
      if (u.type) {
        if (!defKeys.has(u.type)) return; // resolved to a different same-name member
      } else if (typeKey && it.owner.sourceKey !== typeKey && sameNameDeclKeys.has(it.owner.sourceKey)) {
        return; // unresolved ref living in another class that owns its own Changed
      }
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
      var rtype = String(mem.type || '').replace(/<.*$/, '').replace(/\[\s*\]$/, '').trim();
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
      if (u.type && !defKeys.has(u.type)) return; // belongs to a different same-name member
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
      var rtype = String(mem.type || '').replace(/<.*$/, '').replace(/\[\s*\]$/, '').trim();
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
      if (u.type && !defKeys.has(u.type)) return;
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
      if (u.type && typeKey && u.type !== typeKey) return;
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

  return {
    buildIndex: buildIndex, degrees: degrees, neighbors: neighbors,
    findCycles: findCycles, isolatedNodes: isolatedNodes,
    traceEvent: traceEvent, traceField: traceField, traceMethod: traceMethod, refCount: refCount,
    summary: summary, search: search
  };
});
