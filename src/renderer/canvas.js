/* Canvas graph renderer + interaction. Depends on UA.Schema/Model/Layout/Analysis. */
(function (root) {
  'use strict';
  var UA = root.UA;
  var S = UA.Schema, Model = UA.Model, Layout = UA.Layout, Analysis = UA.Analysis;

  function create(container, app) {
    var canvas = document.createElement('canvas');
    canvas.className = 'graph-canvas';
    container.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var cw = 1, ch = 1;
    var view = { scale: 1, offsetX: 0, offsetY: 0 };
    var hover = null, drag = null, pan = null, marquee = null;
    var geoCache = Object.create(null);
    var edgeGeomCache = Object.create(null);
    var lastGeos = null, lastEdges = null;   // 渲染时缓存，命中测试直接复用
    var traceGeomCache = Object.create(null); // trace 强调链几何（命中测试优先于普通边）
    // 悬停对应引擎：hover 一条边/一个成员行/一个组件行 → 点亮相关的边与两端的行
    var pairing = { edges: new Set(), rows: new Set(), active: false };
    var callouts = []; // 悬停边的完整对应提示，渲染末尾画在最上层
    var truncCache = Object.create(null), truncCount = 0;
    var compIconCache = Object.create(null);
    var showMinimap = true;
    var rafId = 0, renderQueued = false;
    var raf = root.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    var caf = root.cancelAnimationFrame || clearTimeout;

    /** 交互期间把重绘合并到下一帧，避免每次 mousemove 都同步全量重绘。 */
    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      rafId = raf(function () { renderQueued = false; rafId = 0; render(); });
    }
    function flushRender() {
      if (!renderQueued) return;
      renderQueued = false;
      if (rafId) { caf(rafId); rafId = 0; }
      render();
    }

    function theme() { return S.THEME[app.getProject().view.theme] || S.THEME.light; }
    function project() { return app.getProject(); }
    function toScreen(x, y) { return { x: cw / 2 + view.offsetX + x * view.scale, y: ch / 2 + view.offsetY + y * view.scale }; }
    function toWorld(x, y) { return { x: (x - cw / 2 - view.offsetX) / view.scale, y: (y - ch / 2 - view.offsetY) / view.scale }; }
    function localPoint(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function nodeGeo(n) {
      var expanded = !!(app.expandedNodes && app.expandedNodes.has(n.id));
      var key = n.id + '|' + n.members.length + '|' + project().settings.showMembers + '|' + (expanded ? 'x' : 'd');
      if (!geoCache[key]) {
        var m = Layout.measureNode(n, { showMembers: project().settings.showMembers, expanded: expanded });
        // 类名必须完整显示：追踪模式有角色徽章时标题预算被压缩（g.w-116），
        // 长类名会被截断成省略号 —— 按实际字体测量把节点加宽到放得下为止。
        var roles = (app.traceRoles && app.traceRoles[n.id]) || [];
        ctx.font = '500 13px "Segoe UI", "Microsoft YaHei", sans-serif';
        var need = Math.ceil(ctx.measureText(n.name).width) + (roles.length ? 116 : 62) + 12;
        if (need > m.w) m.w = need;
        geoCache[key] = { x: n.position.x, y: n.position.y, w: m.w, h: m.h, rows: m.rows, node: n };
      }
      return geoCache[key];
    }
    function visibleGeos() {
      return Model.visibleNodes(project()).map(nodeGeo);
    }
    function visibleEdgeList(geos) {
      var set = new Set(geos.map(function (g) { return g.node.id; }));
      return Model.visibleEdges(project(), set);
    }
    function invalidateGeo() { geoCache = Object.create(null); lastGeos = null; lastEdges = null; }

    function resize() {
      cw = Math.max(1, container.clientWidth);
      ch = Math.max(1, container.clientHeight);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      render();
    }

    function roundRect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    // 文本截断每帧要跑很多次（节点名 + 每个成员行 + 连线标签）：按 字体+宽度+文本 缓存。
    function truncate(text, maxW) {
      var key = ctx.font + '\u0001' + (maxW | 0) + '\u0001' + text;
      var hit = truncCache[key];
      if (hit !== undefined) return hit;
      var out = text;
      if (ctx.measureText(text).width > maxW) {
        var lo = 0, hi = text.length;
        while (lo < hi) {
          var mid = Math.ceil((lo + hi) / 2);
          if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
        }
        out = text.slice(0, lo) + '…';
      }
      if (++truncCount > 4000) { truncCache = Object.create(null); truncCount = 1; }
      truncCache[key] = out;
      return out;
    }

    /** Bounding box of node geometries in one pass (no intermediate arrays). */
    function boundsOf(list) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        if (g.x < minX) minX = g.x;
        if (g.y < minY) minY = g.y;
        if (g.x + g.w > maxX) maxX = g.x + g.w;
        if (g.y + g.h > maxY) maxY = g.y + g.h;
      }
      return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
    function edgePoint(r, dx, dy) {
      var c = center(r), hw = r.w / 2 + 4, hh = r.h / 2 + 4;
      var tx = dx === 0 ? Infinity : hw / Math.abs(dx);
      var ty = dy === 0 ? Infinity : hh / Math.abs(dy);
      var t = Math.min(tx, ty);
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
    function bezier(p0, c, p2, t) {
      var u = 1 - t;
      return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
    }

    function drawArrow(p2, from, style, color, bg) {
      var dx = p2.x - from.x, dy = p2.y - from.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len, px = -uy, py = ux;
      ctx.save();
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4;
      if (style === 'triangle' || style === 'hollowDiamond' || style === 'diamond') {
        var size = style === 'triangle' ? 13 : 15;
        var back = { x: p2.x - ux * size, y: p2.y - uy * size };
        var mid = { x: p2.x - ux * size * 0.5, y: p2.y - uy * size * 0.5 };
        ctx.beginPath();
        if (style === 'triangle') {
          ctx.moveTo(p2.x, p2.y);
          ctx.lineTo(back.x + px * 6.5, back.y + py * 6.5);
          ctx.lineTo(back.x - px * 6.5, back.y - py * 6.5);
        } else {
          ctx.moveTo(p2.x, p2.y);
          ctx.lineTo(mid.x + px * 5.5, mid.y + py * 5.5);
          ctx.lineTo(back.x, back.y);
          ctx.lineTo(mid.x - px * 5.5, mid.y - py * 5.5);
        }
        ctx.closePath();
        ctx.fillStyle = style === 'diamond' ? color : bg;
        ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p2.x - ux * 10 + px * 5, p2.y - uy * 10 + py * 5);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p2.x - ux * 10 - px * 5, p2.y - uy * 10 - py * 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** 悬停对应：hover 边 → 点亮两端行；hover 成员行 → 点亮它发出的边；hover 组件行 → 点亮进/出它的边。 */
    function computePairing(geoById) {
      pairing.edges.clear(); pairing.rows.clear(); pairing.active = false;
      if (!hover) return;
      var p = project();
      function addEdge(e) {
        pairing.edges.add(e.id); pairing.active = true;
        var src = geoById[e.from] && geoById[e.from].node, dst = geoById[e.to] && geoById[e.to].node;
        if (!src || !dst) return;
        // 源端行：组件实例卡点成员行（字段名），GameObject 卡点发起引用的组件行（sourceComp）
        if (src.kind === 'component' && e.label) pairing.rows.add(e.from + '|member:' + e.label);
        else if (e.sourceComp) pairing.rows.add(e.from + '|comp:' + e.sourceComp);
        // 目标端行：GameObject 卡点被引用的组件行；其余（实例/类卡）整卡点亮
        if (dst.kind === 'gameObject' || dst.kind === 'prefab' || dst.kind === 'scene') {
          if (e.targetMember) pairing.rows.add(e.to + '|comp:' + e.targetMember);
        } else pairing.rows.add(e.to + '|card:');
      }
      if (hover.type === 'edge' && hover.edge) { addEdge(hover.edge); return; }
      if (hover.type === 'member' && hover.nodeId) {
        var g0 = geoById[hover.nodeId];
        var m = g0 && (g0.node.members || []).some ? (g0.node.members || []).find(function (x) { return x.id === hover.id; }) : null;
        if (!m) return;
        p.edges.forEach(function (e) { if (e.from === hover.nodeId && e.label === m.name) addEdge(e); });
        return;
      }
      if (hover.type === 'comp' && hover.nodeId && hover.comp && hover.comp.type) {
        var ct = hover.comp.type;
        p.edges.forEach(function (e) {
          if (e.from === hover.nodeId && e.sourceComp === ct) addEdge(e);
          if (e.to === hover.nodeId && e.targetMember === ct) addEdge(e);
        });
      }
    }

    function drawEdges(geos, edges, selectedIds, focusId, vr) {
      edgeGeomCache = Object.create(null);
      var byId = Object.create(null);
      geos.forEach(function (g) { byId[g.node.id] = g; });
      var t = theme();
      var pairs = Object.create(null);
      // Labels are collected and drawn in a second pass so they never get
      // buried under later lines, and labels of parallel edges are stacked.
      var labelGroups = Object.create(null);
      var margin = 260 / view.scale;
      edges.forEach(function (e) {
        var a = byId[e.from], b = byId[e.to];
        if (!a || !b) return;
        // 视口剔除：两端都在屏幕外的边不画（缩放/平移时省下大量曲线与标签）。
        if (vr && (a.x > vr.x1 + margin || a.x + a.w < vr.x0 - margin || a.y > vr.y1 + margin || a.y + a.h < vr.y0 - margin) &&
                  (b.x > vr.x1 + margin || b.x + b.w < vr.x0 - margin || b.y > vr.y1 + margin || b.y + b.h < vr.y0 - margin)) return;
        var style = S.EDGE_KINDS[e.kind] || S.EDGE_KINDS.depend;
        var color = S.edgeColor(e.kind, project().view.theme);
        var ac = center(a), bc = center(b);
        var dx = bc.x - ac.x, dy = bc.y - ac.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var pairKey = [e.from, e.to].sort().join('|');
        var idx = pairs[pairKey] || 0; pairs[pairKey] = idx + 1;
        var bend = (idx - (pairs[pairKey] - 1) / 2) * 34;
        var p0 = edgePoint(a, dx, dy), p2 = edgePoint(b, -dx, -dy);
        var nx = -dy / len, ny = dx / len;
        var ctrl = { x: (p0.x + p2.x) / 2 + nx * bend, y: (p0.y + p2.y) / 2 + ny * bend };
        var relevant = selectedIds.has(e.from) || selectedIds.has(e.to) || (focusId && (e.from === focusId || e.to === focusId));
        var isHover = hover && hover.type === 'edge' && hover.id === e.id;
        var isPaired = pairing.edges.has(e.id);
        var isSel = app.selectedEdgeId === e.id;
        ctx.save();
        ctx.globalAlpha = e.stale ? 0.35 : (selectedIds.size && !relevant && !isPaired ? 0.28 : (isPaired ? 1 : 0.92));
        ctx.strokeStyle = color;
        ctx.lineWidth = (isSel || isHover) ? style.width + 1.6 : (isPaired ? style.width + 1.2 : style.width);
        ctx.setLineDash(style.dash);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawArrow(p2, bezier(p0, ctrl, p2, 0.88), style.arrow, color, t.card);
        var alpha = ctx.globalAlpha;
        ctx.restore();
        edgeGeomCache[e.id] = { p0: p0, p2: p2, ctrl: ctrl };
        // 悬停边：收集完整对应提示（源.字段 ▸ 目标.组件），渲染末尾统一画在最上层
        if (isHover) callouts.push({ edge: e, p0: p0, ctrl: ctrl, p2: p2 });
        var label = e.label || (e.sourceMember ? e.sourceMember.split('#').pop() : '');
        // 标签降噪：只在缩放足够大、边被选中/聚焦、或被悬停对应点亮时显示
        if (label && (view.scale > 1.6 || relevant || isPaired)) {
          // Canonical normal per node pair (independent of edge direction) so
          // labels of parallel edges stack on the same side without crossing.
          var idA = e.from < e.to ? e.from : e.to, idB = e.from < e.to ? e.to : e.from;
          var ca = center(byId[idA]), cb = center(byId[idB]);
          var cdx = cb.x - ca.x, cdy = cb.y - ca.y;
          var clen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
          (labelGroups[idA + '|' + idB] = labelGroups[idA + '|' + idB] || []).push({
            text: String(label), color: color, alpha: alpha,
            mid: bezier(p0, ctrl, p2, 0.5),
            nx: -cdy / clen, ny: cdx / clen
          });
        }
      });
      Object.keys(labelGroups).forEach(function (pk) {
        var items = labelGroups[pk];
        items.sort(function (x, y) {
          return (x.mid.x * x.nx + x.mid.y * x.ny) - (y.mid.x * y.nx + y.mid.y * y.ny);
        });
        ctx.save();
        ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        items.forEach(function (it, i) {
          var off = (i - (items.length - 1) / 2) * 17;
          var lx = it.mid.x + it.nx * off, ly = it.mid.y + it.ny * off;
          var text = truncate(it.text, 150);
          var tw = ctx.measureText(text).width;
          roundRect(lx - tw / 2 - 5, ly - 9, tw + 10, 17, 4);
          ctx.globalAlpha = Math.min(1, it.alpha + 0.08);
          ctx.fillStyle = t.card; ctx.fill();
          ctx.strokeStyle = t.border; ctx.lineWidth = 0.5; ctx.stroke();
          ctx.globalAlpha = 1; ctx.fillStyle = it.color;
          ctx.fillText(text, lx, ly);
        });
        ctx.restore();
      });
    }

    function drawNode(g, selectedIds, focusId) {
      var t = theme(), n = g.node;
      var lod = view.scale < 0.42; // 缩放过小：只画标题，跳过成员行
      var color = n.color || S.kindColor(n.kind, project().view.theme);
      var roles = (app.traceRoles && app.traceRoles[n.id]) || [];
      var selected = selectedIds.has(n.id);
      var isHover = hover && hover.type === 'node' && hover.id === n.id;
      var dim = focusId && !selected && focusId !== n.id && !app.focusNeighbors.has(n.id);
      ctx.save();
      ctx.globalAlpha = n.stale ? 0.55 : (dim ? 0.35 : 1);
      var cardPaired = pairing.rows.has(n.id + '|card:');
      roundRect(g.x, g.y, g.w, g.h, 9);
      ctx.fillStyle = t.card; ctx.fill();
      ctx.strokeStyle = selected ? t.selection : (isHover ? color : (cardPaired ? color : t.cardBorder));
      ctx.lineWidth = selected ? 2.2 : ((isHover || cardPaired) ? 1.6 : 1);
      if (n.stale) ctx.setLineDash([5, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.save();
      roundRect(g.x, g.y, g.w, g.h, 9); ctx.clip();
      ctx.fillStyle = color + '1F';
      ctx.fillRect(g.x, g.y, g.w, Layout.HEADER_H);
      ctx.fillStyle = color; ctx.fillRect(g.x, g.y, 4, Layout.HEADER_H);
      ctx.restore();
      ctx.font = '500 13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = t.text;
      ctx.fillText(truncate(n.name, g.w - (roles.length ? 116 : 62)), g.x + 12, g.y + Layout.HEADER_H / 2);
      var hasHeaderRoles = drawRoleChips(g, roles, 20);
      // 类型字母徽标恒画在右上角；角色徽章让位到它左侧——不能为角色徽章牺牲节点类型标识
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.fillText(S.kindBadge(n), g.x + g.w - 9, g.y + Layout.HEADER_H / 2);
      g.rows.forEach(function (row) {
        if (row.kind === 'header') return;
        // LOD：缩到看不清文字时只画标题，省掉成百上千行文本绘制。
        if (lod) return;
        var y = g.y + row.y + row.h / 2;
        if (row.kind === 'group') {
          ctx.fillStyle = t.panelAlt; ctx.fillRect(g.x + 1, g.y + row.y, g.w - 2, row.h);
          ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'left'; ctx.fillStyle = t.text3;
          ctx.fillText(row.text, g.x + 12, y);
          ctx.beginPath(); ctx.moveTo(g.x, g.y + row.y + row.h - 0.5); ctx.lineTo(g.x + g.w, g.y + row.y + row.h - 0.5);
          ctx.strokeStyle = t.border; ctx.lineWidth = 0.5; ctx.stroke();
        } else if (row.kind === 'member') {
          var m = row.member;
          var isHoverRow = hover && hover.type === 'member' && hover.id === m.id;
          if (isHoverRow) { ctx.fillStyle = t.panelAlt; ctx.fillRect(g.x + 4, g.y + row.y, g.w - 8, row.h); }
          // 悬停对应：该成员是被悬停边/组件行点亮的引用方
          var isPairedRow = pairing.rows.has(n.id + '|member:' + m.name);
          if (isPairedRow) {
            ctx.fillStyle = color + '2E'; ctx.fillRect(g.x + 4, g.y + row.y, g.w - 8, row.h);
            ctx.strokeStyle = color; ctx.lineWidth = 1.2;
            ctx.strokeRect(g.x + 4.5, g.y + row.y + 0.5, g.w - 9, row.h - 1);
          }
          var rowRoles = roles.filter(function (r) { return r.member === m.name; });
          var reserve = 0;
          if (rowRoles.length) {
            ctx.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
            rowRoles.forEach(function (r) { reserve += ctx.measureText(r.role).width + 16; });
            reserve += 8;
          }
          ctx.font = '11px "Consolas", "JetBrains Mono", monospace';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          var sign = m.access === 'public' ? '+' : (m.access === 'private' ? '−' : (m.access === 'protected' ? '#' : '~'));
          ctx.fillStyle = S.ACCESS_COLORS[m.access] || t.text2;
          ctx.fillText(sign, g.x + 12, y);
          // 高亮开关打开时，事件/协程/UnityEvent/委托成员文字换成醒目颜色并加粗。
          // kind 是粗分类（field/event/method…），细分在 category（csharpEvent/coroutine/…）。
          var hl = app.memberHighlight && app.memberHighlight.size ? S.highlightFor(m.category || m.kind, app.memberHighlight) : null;
          if (hl) { ctx.fillStyle = hl; ctx.font = '700 11px "Consolas", "JetBrains Mono", monospace'; }
          else ctx.fillStyle = t.text;
          ctx.fillText(truncate(row.text.slice(2), g.w - 34 - reserve), g.x + 25, y);
          if (m.isSerialized) {
            ctx.fillStyle = '#3FB950'; ctx.fillRect(g.x + g.w - 8, y - 3, 4, 6);
          }
          if (rowRoles.length) {
            var rx = g.x + g.w - 8;
            ctx.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            for (var ri = rowRoles.length - 1; ri >= 0; ri--) {
              var rr = rowRoles[ri];
              var rc = TRACE_ROLE_COLOR[rr.role] || (rr.member ? '#3FB950' : t.text2);
              var cw = ctx.measureText(rr.role).width + 14;
              rx -= cw + 4;
              roundRect(rx, y - 8, cw, 16, 8);
              ctx.fillStyle = t.card; ctx.fill();
              ctx.fillStyle = rc + '2E'; ctx.fill();
              ctx.strokeStyle = rc; ctx.lineWidth = 1; ctx.stroke();
              ctx.fillStyle = rc;
              ctx.fillText(rr.role, rx + cw / 2, y);
            }
            ctx.textAlign = 'left';
          }
        } else if (row.kind === 'comp') {
          var comp = row.comp || {};
          var isHoverComp = hover && hover.type === 'comp' && hover.id === 'comp:' + n.id + ':' + (comp.fileId || comp.type);
          if (isHoverComp) { ctx.fillStyle = t.panelAlt; ctx.fillRect(g.x + 4, g.y + row.y, g.w - 8, row.h); }
          // 悬停对应：该组件行是被悬停边点亮的引用方 / 被引用方
          var isPairedComp = pairing.rows.has(n.id + '|comp:' + comp.type);
          if (isPairedComp) {
            ctx.fillStyle = color + '2E'; ctx.fillRect(g.x + 4, g.y + row.y, g.w - 8, row.h);
            ctx.strokeStyle = color; ctx.lineWidth = 1.2;
            ctx.strokeRect(g.x + 4.5, g.y + row.y + 0.5, g.w - 9, row.h - 1);
          }
          // 环视图 / 追踪：被引用的组件行右侧也挂角色徽章（如「序列化」），与成员行一致
          var compRoles = roles.filter(function (r) { return r.member === comp.type; });
          var compReserve = 0;
          if (compRoles.length) {
            ctx.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
            compRoles.forEach(function (r) { compReserve += ctx.measureText(r.role).width + 16; });
            compReserve += 8;
          }
          ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          drawCompIcon(comp, g.x + 10, y);
          ctx.fillStyle = comp.enabled === false ? t.text3 : t.text;
          ctx.fillText(truncate(row.text, g.w - 46 - compReserve), g.x + 32, y);
          if (compRoles.length) {
            var crx = g.x + g.w - 8;
            ctx.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            for (var cri = compRoles.length - 1; cri >= 0; cri--) {
              var crr = compRoles[cri];
              var crc = TRACE_ROLE_COLOR[crr.role] || (crr.member ? '#3FB950' : t.text2);
              var ccw = ctx.measureText(crr.role).width + 14;
              crx -= ccw + 4;
              roundRect(crx, y - 8, ccw, 16, 8);
              ctx.fillStyle = t.card; ctx.fill();
              ctx.fillStyle = crc + '2E'; ctx.fill();
              ctx.strokeStyle = crc; ctx.lineWidth = 1; ctx.stroke();
              ctx.fillStyle = crc;
              ctx.fillText(crr.role, crx + ccw / 2, y);
            }
            ctx.textAlign = 'left';
          }
        } else if (row.kind === 'more') {
          var isHoverMore = hover && hover.type === 'more' && hover.nodeId === n.id;
          if (isHoverMore) { ctx.fillStyle = t.panelAlt; ctx.fillRect(g.x + 4, g.y + row.y, g.w - 8, row.h); }
          ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillStyle = t.selection || '#4EA1FF';
          ctx.fillText(row.text, g.x + 12, y);
        } else {
          ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'left'; ctx.fillStyle = t.text3;
          ctx.fillText(row.text, g.x + 12, y);
        }
      });
      if (n.stale) {
        ctx.font = '10px "Segoe UI", sans-serif'; ctx.textAlign = 'right';
        ctx.fillStyle = '#A32D2D'; ctx.fillText('已失效', g.x + g.w - 9, g.y + g.h - 9);
      }
      ctx.restore();
    }

    function drawGrid() {
      var t = theme();
      ctx.fillStyle = t.canvas; ctx.fillRect(0, 0, cw, ch);
      var step = 28 * view.scale;
      if (step < 8) return;
      var ox = (cw / 2 + view.offsetX) % step, oy = (ch / 2 + view.offsetY) % step;
      ctx.strokeStyle = t.grid; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = ox; x < cw; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
      for (var y = oy; y < ch; y += step) { ctx.moveTo(0, y); ctx.lineTo(cw, y); }
      ctx.stroke();
    }

    function drawMinimap(geos) {
      if (!showMinimap || geos.length < 2) return;
      var t = theme(), W = 168, H = 112, pad = 12;
      var x0 = cw - W - pad, y0 = ch - H - pad;
      var b = boundsOf(geos);
      var minX = b.minX, minY = b.minY, maxX = b.maxX, maxY = b.maxY;
      var k = Math.min((W - 16) / Math.max(1, maxX - minX), (H - 16) / Math.max(1, maxY - minY));
      var ox = x0 + 8 - minX * k, oy = y0 + 8 - minY * k;
      ctx.save();
      roundRect(x0, y0, W, H, 8);
      ctx.fillStyle = t.card; ctx.globalAlpha = 0.94; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = t.border; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); roundRect(x0, y0, W, H, 8); ctx.clip();
      geos.forEach(function (g) {
        ctx.fillStyle = S.kindColor(g.node.kind, project().view.theme) + 'AA';
        ctx.fillRect(ox + g.x * k, oy + g.y * k, Math.max(2, g.w * k), Math.max(2, g.h * k));
      });
      var tl = toWorld(0, 0), br = toWorld(cw, ch);
      ctx.strokeStyle = t.selection; ctx.lineWidth = 1.2;
      ctx.strokeRect(ox + tl.x * k, oy + tl.y * k, (br.x - tl.x) * k, (br.y - tl.y) * k);
      ctx.restore(); ctx.restore();
    }

    function drawMarquee() {
      if (!marquee) return;
      var t = theme();
      ctx.save();
      ctx.fillStyle = t.selection + '18';
      ctx.strokeStyle = t.selection; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      var x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      var w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    /** Unity 组件小图标：16x16 圆角底 + 类型化矢量图形，脚本为 C# 页面图标。 */
    var COMP_GLYPHS = {
      transform: function (c, cx, cy) {
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(cx - 5, cy); c.lineTo(cx + 5, cy);
        c.moveTo(cx, cy - 5); c.lineTo(cx, cy + 5);
        c.stroke();
        c.beginPath();
        c.moveTo(cx + 5, cy); c.lineTo(cx + 2.4, cy - 2); c.moveTo(cx + 5, cy); c.lineTo(cx + 2.4, cy + 2);
        c.moveTo(cx, cy - 5); c.lineTo(cx - 2, cy - 2.6); c.moveTo(cx, cy - 5); c.lineTo(cx + 2, cy - 2.6);
        c.stroke();
      },
      rigidbody: function (c, cx, cy) {
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, cy + 1.2, 3.4, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(cx - 3, cy - 4.4); c.lineTo(cx + 3, cy - 4.4); c.stroke();
      },
      box: function (c, cx, cy) { c.lineWidth = 1.2; c.strokeRect(cx - 4, cy - 4, 8, 8); },
      mesh: function (c, cx, cy) {
        c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(cx, cy - 4.5); c.lineTo(cx + 4.5, cy + 3.5); c.lineTo(cx - 4.5, cy + 3.5); c.closePath(); c.stroke();
      },
      camera: function (c, cx, cy) {
        c.lineWidth = 1.1;
        c.strokeRect(cx - 5, cy - 3.2, 10, 6.6);
        c.beginPath(); c.arc(cx, cy + 0.1, 2, 0, Math.PI * 2); c.stroke();
      },
      light: function (c, cx, cy) {
        c.lineWidth = 1.1;
        c.beginPath(); c.arc(cx, cy, 2.1, 0, Math.PI * 2); c.stroke();
        c.beginPath();
        for (var a = 0; a < 8; a++) {
          var ang = a * Math.PI / 4;
          c.moveTo(cx + Math.cos(ang) * 3.3, cy + Math.sin(ang) * 3.3);
          c.lineTo(cx + Math.cos(ang) * 5, cy + Math.sin(ang) * 5);
        }
        c.stroke();
      },
      audio: function (c, cx, cy) {
        c.beginPath();
        c.moveTo(cx - 4.5, cy - 2); c.lineTo(cx - 1.5, cy - 2); c.lineTo(cx + 1.5, cy - 5);
        c.lineTo(cx + 1.5, cy + 5); c.lineTo(cx - 1.5, cy + 2); c.lineTo(cx - 4.5, cy + 2);
        c.closePath(); c.fill();
        c.lineWidth = 1; c.beginPath(); c.arc(cx + 1.5, cy, 3, -0.95, 0.95); c.stroke();
      },
      play: function (c, cx, cy) {
        c.beginPath(); c.moveTo(cx - 2.5, cy - 4.2); c.lineTo(cx + 4.2, cy); c.lineTo(cx - 2.5, cy + 4.2);
        c.closePath(); c.fill();
      },
      dots: function (c, cx, cy) {
        [[-3, 1.8], [3, 1.8], [0, -2.6]].forEach(function (p) {
          c.beginPath(); c.arc(cx + p[0], cy + p[1], 1.5, 0, Math.PI * 2); c.fill();
        });
      },
      ui: function (c, cx, cy) {
        c.lineWidth = 1.1;
        c.strokeRect(cx - 4.5, cy - 4.2, 9, 3.4);
        c.strokeRect(cx - 4.5, cy + 0.8, 9, 3.4);
      },
      nav: function (c, cx, cy) {
        c.beginPath(); c.moveTo(cx - 4, cy - 3.6); c.lineTo(cx + 4.6, cy); c.lineTo(cx - 4, cy + 3.6);
        c.lineTo(cx - 1.8, cy); c.closePath(); c.fill();
      },
      joint: function (c, cx, cy) {
        c.lineWidth = 1.1;
        c.beginPath(); c.arc(cx - 2.6, cy, 2, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(cx + 2.6, cy, 2, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(cx - 0.8, cy); c.lineTo(cx + 0.8, cy); c.stroke();
      },
      grid: function (c, cx, cy) {
        c.lineWidth = 1;
        c.strokeRect(cx - 4, cy - 4, 8, 8);
        c.beginPath();
        c.moveTo(cx - 1.3, cy - 4); c.lineTo(cx - 1.3, cy + 4);
        c.moveTo(cx + 1.3, cy - 4); c.lineTo(cx + 1.3, cy + 4);
        c.moveTo(cx - 4, cy - 1.3); c.lineTo(cx + 4, cy - 1.3);
        c.moveTo(cx - 4, cy + 1.3); c.lineTo(cx + 4, cy + 1.3);
        c.stroke();
      },
      picture: function (c, cx, cy) {
        c.lineWidth = 1.1;
        c.strokeRect(cx - 4.5, cy - 3.6, 9, 7.2);
        c.beginPath(); c.moveTo(cx - 3, cy + 1.6); c.lineTo(cx - 0.8, cy - 1.2); c.lineTo(cx + 1.2, cy + 0.6); c.lineTo(cx + 3, cy - 1.6); c.stroke();
      },
      gear: function (c, cx, cy) {
        c.lineWidth = 1.1;
        c.beginPath(); c.arc(cx, cy, 3.2, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(cx, cy, 1.1, 0, Math.PI * 2); c.fill();
      },
      script: function (c, cx, cy) {
        c.font = '700 7px "Segoe UI", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('C#', cx, cy + 0.5);
        c.textAlign = 'left';
      }
    };
    function drawCompIcon(comp, x, cy) {
      var isScript = !!(comp.nodeKey || comp.isScript);
      var ck = comp.type + '\u0001' + (isScript ? '1' : '0');
      var spec = compIconCache[ck] || (compIconCache[ck] = S.compIcon(comp.type, isScript));
      ctx.save();
      if (comp.enabled === false) ctx.globalAlpha = 0.4;
      roundRect(x, cy - 8, 16, 16, 4);
      ctx.fillStyle = spec.color + '30'; ctx.fill();
      ctx.strokeStyle = spec.color + 'B0'; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = spec.color; ctx.fillStyle = spec.color;
      (COMP_GLYPHS[spec.glyph] || COMP_GLYPHS.gear)(ctx, x + 8, cy);
      ctx.restore();
    }

    /** Assembly layers: horizontal bands stacked top→down, layer name tab on the left. */
    function drawAssemblyBands(geos) {
      var groups = app.assemblyGroups;
      if (!groups || !groups.length) return;
      var t = theme(), byId = Object.create(null);
      geos.forEach(function (g) { byId[g.node.id] = g; });
      var PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#A855F7', '#06B6D4', '#EF4444'];
      groups.forEach(function (grp, i) {
        var list = (grp.ids || []).map(function (id) { return byId[id]; }).filter(Boolean);
        if (!list.length) return;
        var hue = PALETTE[i % PALETTE.length];
        var label = grp.label || '';
        ctx.save();
        ctx.font = '700 14px "Segoe UI", "Microsoft YaHei", sans-serif';
        var tw = ctx.measureText(label).width;
        // 层带矩形直接使用布局给出的精确边界：每行首层带的左边缘落在同一条竖线上。
        var minX, minY, maxX, maxY;
        if (Number.isFinite(grp.left) && Number.isFinite(grp.top) && grp.right > grp.left && grp.bottom > grp.top) {
          minX = grp.left; minY = grp.top; maxX = grp.right; maxY = grp.bottom;
        } else {
          var fb = boundsOf(list);
          minX = fb.minX - Math.min(200, tw + 50); minY = fb.minY - 18;
          maxX = fb.maxX + 22; maxY = fb.maxY + 18;
        }
        roundRect(minX, minY, maxX - minX, maxY - minY, 14);
        ctx.fillStyle = hue + '1F'; ctx.fill();
        ctx.strokeStyle = hue + 'AA'; ctx.lineWidth = 1.8; ctx.stroke();
        // Left tab with the layer name (horizontal, clearly readable).
        var tabW = Math.min(184, tw + 36);
        roundRect(minX + 8, minY + 10, tabW, 28, 8);
        ctx.fillStyle = theme().card; ctx.fill();
        ctx.fillStyle = hue + '3A'; ctx.fill();
        ctx.strokeStyle = hue; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath();
        ctx.arc(minX + 21, minY + 24, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = hue; ctx.fill();
        ctx.font = '700 14px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = t.text;
        ctx.fillText(truncate(label, Math.max(40, tabW - 40)), minX + 32, minY + 24.5);
        ctx.restore();
      });
    }

    var TRACE_ROLE_COLOR = S.ROLE_TONE;

    /** Role chips drawn on a node: header-level fallback and per-member (定义/注册/激活…). */
    function drawRoleChips(g, roles, reserve) {
      var t = theme();
      // 成员级徽章贴在成员行旁；若该成员行被截断没显示，则退回标题栏，保证不丢标识。
      var visibleNames = null;
      function memberVisible(name) {
        if (!visibleNames) {
          visibleNames = Object.create(null);
          g.rows.forEach(function (row) {
            if (row.kind === 'member') visibleNames[row.member.name] = true;
            else if (row.kind === 'comp' && row.comp) visibleNames[row.comp.type] = true; // 组件行也能承接徽章
          });
        }
        return !!visibleNames[name];
      }
      var headerRoles = roles.filter(function (r) { return !r.member || !memberVisible(r.member); });
      if (headerRoles.length) {
        // reserve：右侧预留给类型字母徽标（C/GO/Co…）的空间，角色徽章从它左侧往左排
        var x = g.x + g.w - 9 - (reserve || 0) - 4;
        ctx.font = '600 10px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        for (var hi = headerRoles.length - 1; hi >= 0; hi--) {
          var hr = headerRoles[hi];
          var hc = TRACE_ROLE_COLOR[hr.role] || t.text2;
          var hw = ctx.measureText(hr.role).width + 16;
          x -= hw + 4;
          roundRect(x, g.y + 8, hw, 18, 9);
          ctx.fillStyle = t.card; ctx.fill();
          ctx.fillStyle = hc + '2E'; ctx.fill();
          ctx.strokeStyle = hc; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = hc;
          ctx.fillText(hr.role, x + hw / 2, g.y + 17.5);
        }
      }
      return headerRoles.length > 0;
    }

    /** Edges drawn for a trace: subscriber → definition (注册), firer → definition (激活). */
    function drawTraceLinks(geos) {
      var links = app.traceLinks;
      if (!links || !links.length) return;
      var t = theme(), byId = Object.create(null);
      geos.forEach(function (g) { byId[g.node.id] = g; });
      var li = 0;
      links.forEach(function (ln) {
        var a = byId[ln.from], b = byId[ln.to];
        if (!a || !b || ln.from === ln.to || !ln.label) return;
        var ac = center(a), bc = center(b);
        var dx = bc.x - ac.x, dy = bc.y - ac.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var p0 = edgePoint(a, dx, dy), p2 = edgePoint(b, -dx, -dy);
        var nx = -dy / len, ny = dx / len;
        var bend = Math.min(110, Math.max(36, len * 0.18));
        var ctrl = { x: (p0.x + p2.x) / 2 + nx * bend, y: (p0.y + p2.y) / 2 + ny * bend };
        // 带边 id 的链（环视图的逐边红链）参与悬停对应：记录几何供命中测试
        var isHl = false;
        if (ln.id) {
          traceGeomCache[ln.id] = { p0: p0, p2: p2, ctrl: ctrl };
          isHl = pairing.edges.has(ln.id) || (hover && hover.type === 'edge' && hover.id === ln.id);
        }
        ctx.save();
        ctx.strokeStyle = ln.color; ctx.lineWidth = isHl ? 3.4 : 2.2;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
        ctx.stroke();
        drawArrow(p2, bezier(p0, ctrl, p2, 0.9), 'triangle', ln.color, t.card);
        var mid = bezier(p0, ctrl, p2, 0.5);
        if (ln.id) {
          // 悬停对应的链不画常驻标签，完整对应由 callout 展示
          if (isHl) callouts.push({ edge: project().edges.find(function (e) { return e.id === ln.id; }), p0: p0, ctrl: ctrl, p2: p2 });
        } else {
          // 节点级链（注册/激活/写入/读取）：标签常驻，双向链按索引上下交错让开
          var labelY = mid.y + (li % 2 ? 16 : -16);
          li += 1;
          ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
          var tw = ctx.measureText(ln.label).width;
          roundRect(mid.x - tw / 2 - 9, labelY - 10, tw + 18, 20, 10);
          ctx.fillStyle = t.card; ctx.fill();
          ctx.strokeStyle = ln.color; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.fillStyle = ln.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ln.label, mid.x, labelY);
        }
        ctx.restore();
      });
    }

    /** 悬停边的完整对应提示：「源.字段 ▸ 目标.组件」，画在最上层。 */
    function drawCallouts() {
      if (!callouts.length) return;
      var t = theme();
      var byId = Object.create(null);
      project().nodes.forEach(function (n) { byId[n.id] = n; });
      ctx.save();
      ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      callouts.forEach(function (c) {
        var e = c.edge;
        var src = e && byId[e.from], dst = e && byId[e.to];
        if (!src || !dst) return;
        var field = e.label || e.sourceMember || (S.EDGE_KINDS[e.kind] || {}).label || '引用';
        var text = truncate(src.name + '.' + field + '  ▸  ' + dst.name + (e.targetMember ? '.' + e.targetMember : ''), 320);
        var mid = bezier(c.p0, c.ctrl, c.p2, 0.5);
        var ly = mid.y - 30;
        var tw = ctx.measureText(text).width;
        roundRect(mid.x - tw / 2 - 9, ly - 10, tw + 18, 20, 10);
        ctx.fillStyle = t.card; ctx.fill();
        ctx.strokeStyle = t.selection; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = t.text;
        ctx.fillText(text, mid.x, ly);
      });
      ctx.restore();
    }

    /** Column captions above a trace layout (定义 | 注册 | 激活 …). */
    function drawTraceHeaders() {
      var bounds = app.traceColumnBounds;
      if (!bounds || !bounds.length) return;
      var t = theme();
      bounds.forEach(function (b) {
        if (!b.label) return;
        var midX = (b.left + b.right) / 2;
        var cy = b.top - 26;
        ctx.save();
        ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
        var tw = ctx.measureText(b.label).width;
        roundRect(midX - tw / 2 - 9, cy - 10, tw + 18, 20, 10);
        ctx.fillStyle = t.panelAlt; ctx.fill();
        ctx.strokeStyle = t.border; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = t.text2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.label, midX, cy);
        ctx.restore();
      });
    }

    function render() {
      var p = project();
      view.scale = p.view.scale; view.offsetX = p.view.offsetX; view.offsetY = p.view.offsetY;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      drawGrid();
      if (!p.nodes.length) {
        ctx.fillStyle = theme().text3;
        ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('工程为空 · 点「扫描 Unity 工程」或把 Unity 工程文件夹拖进窗口', cw / 2, ch / 2 - 10);
        return;
      }
      ctx.save();
      ctx.translate(cw / 2 + view.offsetX, ch / 2 + view.offsetY);
      ctx.scale(view.scale, view.scale);
      var geos = visibleGeos();
      var edges = visibleEdgeList(geos);
      lastGeos = geos; lastEdges = edges;
      traceGeomCache = Object.create(null);
      callouts = [];
      var geoById = Object.create(null);
      geos.forEach(function (g) { geoById[g.node.id] = g; });
      computePairing(geoById);
      var selectedIds = app.selection;
      // 屏幕可见范围（世界坐标），用于剔除屏幕外的节点与连线。
      var v0 = toWorld(0, 0), v1 = toWorld(cw, ch);
      var vr = { x0: v0.x, y0: v0.y, x1: v1.x, y1: v1.y };
      var mg = 160 / view.scale;
      var drawn = [];
      for (var gi = 0; gi < geos.length; gi++) {
        var g0 = geos[gi];
        if (g0.x > vr.x1 + mg || g0.x + g0.w < vr.x0 - mg || g0.y > vr.y1 + mg || g0.y + g0.h < vr.y0 - mg) continue;
        drawn.push(g0);
      }
      drawAssemblyBands(geos);
      drawEdges(geos, edges, selectedIds, app.focusId, vr);
      drawTraceLinks(drawn);
      drawTraceHeaders();
      drawn.forEach(function (g) { drawNode(g, selectedIds, app.focusId); });
      drawCallouts();
      ctx.restore();
      drawMarquee();
      drawMinimap(geos);
      app.onRenderDone && app.onRenderDone({ nodes: geos.length, edges: edges.length });
    }

    function hitTest(sx, sy) {
      var w = toWorld(sx, sy);
      // 几何缓存由 render 维护：命中测试不再重建节点/边列表。
      var geos = lastGeos || visibleGeos();
      for (var i = geos.length - 1; i >= 0; i--) {
        var g = geos[i];
        if (w.x >= g.x && w.x <= g.x + g.w && w.y >= g.y && w.y <= g.y + g.h) {
          var row = g.rows.find(function (r) { return (r.kind === 'member' || r.kind === 'more' || r.kind === 'comp') && w.y >= g.y + r.y && w.y <= g.y + r.y + r.h; });
          if (row && row.kind === 'more') return { type: 'more', id: 'more:' + g.node.id, nodeId: g.node.id, geo: g, world: w };
          if (row && row.kind === 'comp') return { type: 'comp', id: 'comp:' + g.node.id + ':' + (row.comp.fileId || row.comp.type), nodeId: g.node.id, comp: row.comp, geo: g, world: w };
          return { type: row ? 'member' : 'node', id: row ? row.member.id : g.node.id, nodeId: g.node.id, geo: g, world: w };
        }
      }
      var edges = lastEdges || visibleEdgeList(geos);
      // trace 强调链（环视图红链等）画在最上层，优先命中
      var trace = app.traceLinks;
      if (trace && trace.length) {
        var tth = 9 / view.scale;
        for (var q = trace.length - 1; q >= 0; q--) {
          var tg = traceGeomCache[trace[q].id];
          if (!tg) continue;
          for (var tq = 0; tq <= 1; tq += 0.05) {
            var tp = bezier(tg.p0, tg.ctrl, tg.p2, tq);
            if (Math.abs(tp.x - w.x) < tth && Math.abs(tp.y - w.y) < tth) {
              var pe = project().edges.find(function (x) { return x.id === trace[q].id; });
              return { type: 'edge', id: trace[q].id, edge: pe || trace[q], world: w };
            }
          }
        }
      }
      var threshold = 7 / view.scale;
      for (var j = edges.length - 1; j >= 0; j--) {
        var geo = edgeGeomCache[edges[j].id];
        if (!geo) continue;
        for (var t = 0; t <= 1; t += 0.05) {
          var pt = bezier(geo.p0, geo.ctrl, geo.p2, t);
          if (Math.abs(pt.x - w.x) < threshold && Math.abs(pt.y - w.y) < threshold) {
            return { type: 'edge', id: edges[j].id, edge: edges[j], world: w };
          }
        }
      }
      return { type: 'canvas', world: w };
    }

    function commitView() {
      var p = project();
      p.view.scale = view.scale; p.view.offsetX = view.offsetX; p.view.offsetY = view.offsetY;
    }

    function zoom(factor, sx, sy) {
      var ax = sx === undefined ? cw / 2 : sx, ay = sy === undefined ? ch / 2 : sy;
      var before = toWorld(ax, ay);
      view.scale = S.clamp(view.scale * factor, 0.15, 4);
      view.offsetX = ax - cw / 2 - before.x * view.scale;
      view.offsetY = ay - ch / 2 - before.y * view.scale;
      commitView(); scheduleRender();
    }

    function fit() {
      var f = Layout.fitBounds(project(), { width: cw, height: ch });
      view.scale = f.scale; view.offsetX = f.offsetX; view.offsetY = f.offsetY;
      commitView(); render();
    }

    function flyTo(nodeId) {
      var n = Model.getNode(project(), nodeId);
      if (!n) return;
      var g = nodeGeo(n), c = center(g);
      view.offsetX = -c.x * view.scale;
      view.offsetY = -c.y * view.scale;
      commitView(); render();
    }

    function setMinimap(v) { showMinimap = !!v; render(); }

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = localPoint(e);
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      var p = localPoint(e), hit = hitTest(p.x, p.y);
      if (e.button === 1 || e.button === 2 || e.altKey) {
        pan = { x: p.x, y: p.y, ox: view.offsetX, oy: view.offsetY };
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (hit.type === 'edge') {
        app.setSelection(new Set(), hit.id);
        return;
      }
      if (hit.type === 'more') {
        // 点击「还有 N 项 / 收起」：展开或折叠该节点的成员列表
        if (app.expandedNodes.has(hit.nodeId)) app.expandedNodes.delete(hit.nodeId);
        else app.expandedNodes.add(hit.nodeId);
        invalidateGeo(); render();
        return;
      }
      if (hit.type === 'comp') {
        // 点击组件行：脚本组件跳到对应脚本节点，内置组件选中宿主 GameObject
        var target = null;
        if (hit.comp && hit.comp.nodeKey) {
          target = project().nodes.find(function (n) { return n.sourceKey === hit.comp.nodeKey; });
        }
        app.setSelection(new Set([target ? target.id : hit.nodeId]), null, null);
        return;
      }
      if (hit.type === 'node' || hit.type === 'member') {
        var additive = e.ctrlKey || e.shiftKey;
        var next = new Set(additive ? app.selection : []);
        if (additive && next.has(hit.nodeId)) next.delete(hit.nodeId); else next.add(hit.nodeId);
        app.setSelection(next, null, hit.type === 'member' ? hit.id : null);
        // 拖拽只改会话内的临时位置，用于解决个别遮挡；不入档、不参与扫描差异。
        drag = { start: hit.world, ids: Array.from(next), moved: false, orig: Object.create(null) };
        canvas.style.cursor = 'grabbing';
      } else {
        app.setSelection(new Set(), null, null);
        marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey };
      }
    });

    canvas.addEventListener('mousemove', function (e) {
      var p = localPoint(e), w = toWorld(p.x, p.y);
      if (pan) {
        view.offsetX = pan.ox + (p.x - pan.x);
        view.offsetY = pan.oy + (p.y - pan.y);
        commitView(); scheduleRender(); return;
      }
      if (drag) {
        var dx = w.x - drag.start.x, dy = w.y - drag.start.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;
        if (drag.moved) {
          drag.ids.forEach(function (id) {
            var n = Model.getNode(project(), id);
            if (n && !drag.orig[id]) drag.orig[id] = { x: n.position.x, y: n.position.y };
          });
          drag.ids.forEach(function (id) {
            var n = Model.getNode(project(), id);
            if (n && drag.orig[id]) { n.position.x = drag.orig[id].x + dx; n.position.y = drag.orig[id].y + dy; }
          });
          invalidateGeo(); scheduleRender();
        }
        return;
      }
      if (marquee) { marquee.x1 = p.x; marquee.y1 = p.y; scheduleRender(); return; }
      var hit = hitTest(p.x, p.y);
      var next = hit.type === 'canvas' ? null : { type: hit.type, id: hit.id, nodeId: hit.nodeId };
      var prev = hover;
      hover = next;
      var changed = (!!prev !== !!next) || (!!prev && !!next && (prev.type !== next.type || prev.id !== next.id));
      canvas.style.cursor = hit.type === 'node' || hit.type === 'member' || hit.type === 'more' || hit.type === 'comp' ? 'pointer' : (hit.type === 'edge' ? 'pointer' : 'default');
      if (changed) { app.onHover && app.onHover(hover); scheduleRender(); }
    });

    function endInteraction(e) {
      var p = e ? localPoint(e) : null;
      if (pan) { pan = null; canvas.style.cursor = 'default'; render(); return; }
      if (drag) {
        var moved = drag.moved;
        drag = null;
        canvas.style.cursor = 'default';
        if (moved) invalidateGeo();
        render(); return;
      }
      if (marquee) {
        var a = toWorld(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1));
        var b = toWorld(Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1));
        var sel = new Set(marquee.additive ? app.selection : []);
        if (Math.abs(marquee.x1 - marquee.x0) > 4 || Math.abs(marquee.y1 - marquee.y0) > 4) {
          visibleGeos().forEach(function (g) {
            if (g.x < b.x && g.x + g.w > a.x && g.y < b.y && g.y + g.h > a.y) sel.add(g.node.id);
          });
        }
        marquee = null; app.setSelection(sel, null, null); render();
      }
    }
    root.addEventListener('mouseup', endInteraction);
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var p = localPoint(e);
      app.onContextMenu && app.onContextMenu(e.clientX, e.clientY, hitTest(p.x, p.y));
    });
    canvas.addEventListener('dblclick', function (e) {
      var p = localPoint(e), hit = hitTest(p.x, p.y);
      app.onDoubleClick && app.onDoubleClick(hit);
    });

    return {
      element: canvas, render: render, resize: resize, fit: fit, flyTo: flyTo,
      zoom: zoom, hitTest: hitTest, toWorld: toWorld, toScreen: toScreen,
      nodeGeo: nodeGeo, invalidateGeo: invalidateGeo, visibleGeos: visibleGeos,
      setMinimap: setMinimap,
      // 测试/自动化钩子：直接设定 hover 状态并重绘（真实鼠标路径走 mousemove 处理器）
      debugSetHover: function (h) { hover = h; scheduleRender(); },
      debugPairing: function () { return { edges: Array.from(pairing.edges), rows: Array.from(pairing.rows) }; },
      getView: function () { return Object.assign({}, view); },
      toDataURL: function () {
        flushRender(); // 导出前先补上挂起的重绘，避免截到旧画面
        return canvas.toDataURL('image/png');
      }
    };
  }

  UA.Canvas = { create: create };
})(globalThis);
