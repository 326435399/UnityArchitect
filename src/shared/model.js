/* Unity Architect - graph model and scan merge. UMD. */
(function (root, factory) {
  'use strict';
  var Schema = (typeof module === 'object' && module.exports) ? require('./schema.js') : root.UA.Schema;
  var api = factory(Schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.UA = root.UA || {}; root.UA.Model = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  function getNode(project, id) { return project.nodes.find(function (n) { return n.id === id; }) || null; }
  function getEdge(project, id) { return project.edges.find(function (e) { return e.id === id; }) || null; }
  function visibleNodes(project) {
    var f = project.settings.nodeFilter || {};
    return project.nodes.filter(function (n) { return n.visible !== false && f[n.kind] !== false; });
  }
  function visibleEdges(project, visibleIdSet) {
    var f = project.settings.edgeFilter || {};
    var set = visibleIdSet || new Set(visibleNodes(project).map(function (n) { return n.id; }));
    return project.edges.filter(function (e) {
      return f[e.kind] !== false && set.has(e.from) && set.has(e.to);
    });
  }

  /**
   * Remove stale auto nodes (deleted scripts / removed assets) and their edges.
   * Manual nodes and manual edges are always preserved.
   * Returns the number of removed nodes.
   */
  function purgeStale(p) {
    var staleIds = new Set(p.nodes.filter(function (n) { return n.stale && !n.manual; }).map(function (n) { return n.id; }));
    if (!staleIds.size) return 0;
    p.nodes = p.nodes.filter(function (n) { return !staleIds.has(n.id); });
    p.edges = p.edges.filter(function (e) {
      return !e.stale && !staleIds.has(e.from) && !staleIds.has(e.to);
    });
    return staleIds.size;
  }

  /**
   * Merge a parse result into the project while preserving manual work.
   * Auto nodes are matched by sourceKey; manual nodes/edges/members are never removed.
   * Stale auto nodes (missing from this scan) are removed unless opts.removeStale === false.
   * Returns a change summary used for the "scan diff" view.
   */
  function mergeScan(project, parsed, options) {
    var opts = options || {};
    var result = { addedNodes: [], updatedNodes: [], staleNodes: [], addedEdges: [], staleEdges: [], removedEdges: [] };
    var parsedNodeKeys = Object.create(null);
    var parsedEdgeKeys = Object.create(null);
    var byKey = Object.create(null);
    project.nodes.forEach(function (n) { if (n.sourceKey) byKey[n.sourceKey] = n; });

    (parsed.nodes || []).forEach(function (rawNode) {
      var key = rawNode.sourceKey;
      if (!key) return;
      parsedNodeKeys[key] = true;
      var existing = byKey[key];
      var incoming = S.normalizeNode(rawNode, rawNode.id || S.genId('node'));
      if (existing) {
        var sig = function (n) {
          return JSON.stringify({
            kind: n.kind, name: n.name, baseTypes: n.baseTypes,
            members: n.members.map(function (m) { return [m.name, m.type, m.kind, m.access, m.isSerialized]; })
          });
        };
        var sigBefore = sig(existing);
        var keep = {
          id: existing.id, position: existing.position, note: existing.note,
          tags: existing.tags, visible: existing.visible,
          color: existing.color, stale: false
        };
        Object.assign(existing, incoming, keep);
        existing.members = incoming.members; // hand-added members are no longer kept
        if (sigBefore !== sig(existing)) result.updatedNodes.push(existing.id);
        byKey[key] = existing;
      } else {
        incoming.position = incoming.position.x || incoming.position.y
          ? incoming.position : { x: 0, y: 0 };
        project.nodes.push(incoming);
        byKey[key] = incoming;
        result.addedNodes.push(incoming.id);
      }
    });

    // Stale nodes (deleted scripts / removed assets / legacy manual entries
    // without a scan source) are purged on every re-scan.
    project.nodes.forEach(function (n) {
      if (!n.sourceKey) {
        if (!n.stale) result.staleNodes.push(n.id);
        n.stale = true;
        return;
      }
      if (!parsedNodeKeys[n.sourceKey]) {
        if (!n.stale) result.staleNodes.push(n.id);
        n.stale = true;
      } else if (n.stale) {
        n.stale = false;
      }
    });
    if (opts.removeStale !== false) {
      purgeStale(project);
    }

    var edgeByKey = Object.create(null);
    project.edges.forEach(function (e) { if (e.sourceKey) edgeByKey[e.sourceKey] = e; });

    (parsed.edges || []).forEach(function (rawEdge) {
      var fromNode = byKey[rawEdge.fromKey], toNode = byKey[rawEdge.toKey];
      if (!fromNode || !toNode) return;
      var key = rawEdge.sourceKey || ('auto:' + rawEdge.kind + ':' + rawEdge.fromKey + '>' + rawEdge.toKey + ':' + (rawEdge.sourceMember || ''));
      parsedEdgeKeys[key] = true;
      var existingEdge = edgeByKey[key];
      var payload = {
        id: existingEdge ? existingEdge.id : S.genId('edge'),
        from: fromNode.id, to: toNode.id, kind: rawEdge.kind,
        sourceMember: rawEdge.sourceMember || '',
        sourceComp: rawEdge.sourceComp || '',
        targetMember: rawEdge.targetMember || '',
        label: rawEdge.label || '', sourceKey: key, manual: false, stale: false
      };
      if (existingEdge) Object.assign(existingEdge, payload);
      else {
        var e = S.normalizeEdge(payload, payload.id);
        project.edges.push(e);
        edgeByKey[key] = e;
        result.addedEdges.push(e.id);
      }
    });

    project.edges.forEach(function (e) {
      if (!e.sourceKey) { e.stale = true; return; } // hand-drawn edges have no scan source
      if (!parsedEdgeKeys[e.sourceKey]) e.stale = true;
      else if (e.stale) e.stale = false;
    });
    if (opts.removeStale !== false) {
      project.edges.forEach(function (e) {
        if (!e.stale) return;
        var a = getNode(project, e.from), b = getNode(project, e.to);
        result.staleEdges.push({ name: (a ? a.name : e.from) + ' → ' + (b ? b.name : e.to), kind: e.kind });
      });
      result.removedEdges = result.staleEdges;
      project.edges = project.edges.filter(function (e) { return !e.stale; });
    }

    // Deduplicate identical edges.
    var seen = Object.create(null);
    project.edges = project.edges.filter(function (e) {
      var k = [e.from, e.to, e.kind, e.sourceMember, e.sourceComp].join('|');
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });

    project.meta.lastScan = S.nowIso();
    project.meta.updatedAt = S.nowIso();
    if (Array.isArray(parsed.assemblies)) project.assemblies = parsed.assemblies;
    return result;
  }



  /** Lightweight structural snapshot used for version comparison. */
  function fingerprint(project) {
    return {
      nodes: project.nodes.map(function (n) {
        return { key: n.sourceKey || n.id, name: n.name, kind: n.kind,
          members: n.members.map(function (m) { return m.kind + ' ' + m.type + ' ' + m.name; }) };
      }),
      edges: project.edges.map(function (e) {
        var a = getNode(project, e.from), b = getNode(project, e.to);
        return { from: a ? (a.sourceKey || a.id) : e.from, to: b ? (b.sourceKey || b.id) : e.to,
          kind: e.kind, member: e.sourceMember, comp: e.sourceComp || '' };
      })
    };
  }

  /** Compare two fingerprints. Returns added/removed/changed lists. */
  function diffFingerprints(oldFp, newFp) {
    var out = { addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [] };
    if (!oldFp) return out;
    var oldNodes = Object.create(null), newNodes = Object.create(null);
    oldFp.nodes.forEach(function (n) { oldNodes[n.key] = n; });
    newFp.nodes.forEach(function (n) { newNodes[n.key] = n; });
    Object.keys(newNodes).forEach(function (k) {
      if (!oldNodes[k]) out.addedNodes.push(newNodes[k]);
      else if (JSON.stringify(oldNodes[k].members) !== JSON.stringify(newNodes[k].members) ||
               oldNodes[k].name !== newNodes[k].name) out.changedNodes.push(newNodes[k]);
    });
    Object.keys(oldNodes).forEach(function (k) { if (!newNodes[k]) out.removedNodes.push(oldNodes[k]); });
    var edgeKey = function (e) { return [e.from, e.to, e.kind, e.member, e.comp].join('|'); };
    var oldE = new Set(oldFp.edges.map(edgeKey));
    var newE = new Set(newFp.edges.map(edgeKey));
    newFp.edges.forEach(function (e) { if (!oldE.has(edgeKey(e))) out.addedEdges.push(e); });
    oldFp.edges.forEach(function (e) { if (!newE.has(edgeKey(e))) out.removedEdges.push(e); });
    return out;
  }

  return {
    getNode: getNode, getEdge: getEdge,
    visibleNodes: visibleNodes, visibleEdges: visibleEdges,
    mergeScan: mergeScan,
    fingerprint: fingerprint, diffFingerprints: diffFingerprints
  };
});
