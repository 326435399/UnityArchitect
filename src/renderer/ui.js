/* DOM panels, dialogs and event delegation. All dynamic text is escaped. */
(function (root) {
  'use strict';
  var UA = root.UA, S = UA.Schema, Model = UA.Model, Analysis = UA.Analysis, Layout = UA.Layout;

  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function fmtTime(iso) {
    if (!iso) return '从未';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  /** 组件图标的字符近似（画布上是矢量图标，这里用彩色字符块代替）。 */
  var COMP_CHAR = {
    transform: '✛', rigidbody: '⊙', box: '□', mesh: '△', camera: '▣', light: '☀',
    audio: '♪', play: '▶', dots: '⁘', ui: '▤', nav: '➤', joint: '∞',
    grid: '▦', picture: '🖼', gear: '⚙', script: 'C#'
  };

  var MENUS = {
    file: [
      { label: '扫描 Unity 工程…（绑定目录）', action: 'scan' },
      { label: '重新扫描已绑定目录…', action: 'rescan' },
      { label: '选择文件夹（兼容模式）…', action: 'scan-legacy' },
      { label: '解除目录绑定', action: 'unlink-dir' },
      { sep: true },
      { label: '导出 PNG', action: 'export-png' },
      { label: '导出 Markdown', action: 'export-md' }
    ],
    view: [
      { label: '适应画布  F', action: 'fit' },
      { label: '放大', action: 'zoom-in' },
      { label: '缩小', action: 'zoom-out' },
      { sep: true },
      { label: '分层布局', action: 'layout-layered' },
      { label: '网格布局', action: 'layout-grid' },
      { sep: true },
      { label: '切换明暗主题', action: 'theme' },
      { label: '设置…', action: 'settings' }
    ],
    analyze: [
      { label: '依赖分析面板', action: 'tab-deps' },
      { label: '循环依赖', action: 'show-cycles' },
      { label: '扫描差异对比', action: 'show-diff' },
      { label: '孤立节点', action: 'show-isolated' }
    ],
    help: [
      { label: '使用说明…', action: 'show-help' },
      { label: '目录读取说明…', action: 'scan-help' },
      { label: '载入示例工程', action: 'load-demo' },
      { label: '关于 Unity Architect', action: 'about' }
    ]
  };

  var toastTimer = null;
  function toast(message, ms) {
    var node = el('toast');
    node.textContent = message;
    node.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.add('hidden'); }, ms || 2600);
  }

  function closeModal() { el('modal-root').innerHTML = ''; }
  function modal(opts) {
    var host = el('modal-root');
    var buttons = (opts.buttons || [{ label: '关闭', primary: true }]).map(function (b, i) {
      return '<button data-modal-btn="' + i + '"' + (b.primary ? ' class="primary"' : '') + '>' + esc(b.label) + '</button>';
    }).join('');
    host.innerHTML = '<div class="modal-backdrop"><div class="modal">' +
      '<div class="modal-head"><h2>' + esc(opts.title || '') + '</h2><button data-modal-close>×</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      '<div class="modal-foot">' + buttons + '</div></div></div>';
    host.querySelector('[data-modal-close]').onclick = closeModal;
    host.querySelector('.modal-backdrop').addEventListener('mousedown', function (e) {
      if (e.target === this) closeModal();
    });
    host.querySelectorAll('[data-modal-btn]').forEach(function (btn) {
      btn.onclick = function () {
        var def = (opts.buttons || [{}])[Number(btn.dataset.modalBtn)];
        if (def && def.onClick) { if (def.onClick(host) === false) return; }
        closeModal();
      };
    });
    return host;
  }

  function hideContext() { el('context-menu').classList.add('hidden'); }
  function contextMenu(x, y, items, app) {
    var menu = el('context-menu');
    menu.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<hr>';
      return '<button data-mi="' + i + '"' + (it.danger ? ' style="color:var(--danger)"' : '') + '>' + esc(it.label) + '</button>';
    }).join('');
    menu.style.left = Math.min(x, root.innerWidth - 190) + 'px';
    menu.style.top = Math.min(y, root.innerHeight - items.length * 30 - 30) + 'px';
    menu.classList.remove('hidden');
    menu.querySelectorAll('[data-mi]').forEach(function (b) {
      b.onclick = function () {
        var it = items[Number(b.dataset.mi)];
        hideContext();
        if (it && it.action) app.action(it.action, it.data || {});
      };
    });
  }

  function renderLegend(app) {
    var p = app.getProject();
    var host = el('legend');
    host.innerHTML = Object.keys(S.EDGE_KINDS).filter(function (k) { return p.settings.edgeFilter[k] !== false; })
      .map(function (k) {
        var s = S.EDGE_KINDS[k];
        return '<span><i style="border-color:' + S.edgeColor(k, p.view.theme) +
          (s.dash.length ? ';border-top-style:dashed' : '') + '"></i>' + esc(s.label) + '</span>';
      }).join('');
  }

  function renderLeft(app) {
    var p = app.getProject(), host = el('left-body');
    var q = String(app.treeQuery || '').trim().toLowerCase();
    // The panel search box filters the tree; on the 检索 tab it searches everything.
    var searchBox = document.getElementById('tree-search');
    if (searchBox) searchBox.placeholder = app.leftTab === 'search' ? '检索节点 / 成员 / 关系' : '筛选资源 / 成员';
    if (app.leftTab === 'filters') {
      var nodeKinds = Object.keys(S.NODE_KINDS).map(function (k) {
        var count = p.nodes.filter(function (n) { return n.kind === k; }).length;
        return '<div class="filter-row"><input type="checkbox" data-field="nodeFilter" data-id="' + k + '"' +
          (p.settings.nodeFilter[k] !== false ? ' checked' : '') + '>' +
          '<span class="swatch" style="background:' + S.kindColor(k, p.view.theme) + '"></span>' +
          '<span>' + esc(S.NODE_KINDS[k].label) + '</span><span class="num">' + count + '</span></div>';
      }).join('');
      var edgeKinds = Object.keys(S.EDGE_KINDS).map(function (k) {
        var count = p.edges.filter(function (e) { return e.kind === k; }).length;
        return '<div class="filter-row"><input type="checkbox" data-field="edgeFilter" data-id="' + k + '"' +
          (p.settings.edgeFilter[k] !== false ? ' checked' : '') + '>' +
          '<span class="swatch" style="background:' + S.edgeColor(k, p.view.theme) + '"></span>' +
          '<span>' + esc(S.EDGE_KINDS[k].label) + '</span><span class="num">' + count + '</span></div>';
      }).join('');
      host.innerHTML = '<div class="card"><h3>层级（一键切换）</h3><div class="kv">' +
        '<button class="tbtn" data-action="layer-preset" data-id="scripts">仅脚本</button>' +
        '<button class="tbtn" data-action="layer-preset" data-id="mounts">含挂载</button>' +
        '<button class="tbtn" data-action="layer-preset" data-id="all">全部</button></div>' +
        '<div style="font-size:11px;color:var(--text3);line-height:1.6;margin-top:6px">仅脚本：只保留脚本类型与脚本间依赖；「含挂载」额外显示脚本挂载在哪些 GameObject 上；「全部」再显示 SO 资源实例节点。扫描始终覆盖脚本、场景挂载与 SO 资源，这里只控制画布显示。</div></div>' +
        '<div class="card"><h3>节点类型</h3>' + nodeKinds + '</div>' +
        '<div class="card"><h3>关系类型</h3>' + edgeKinds + '</div>' +
        '<div class="card"><h3>显示</h3>' +
        '<div class="filter-row"><input type="checkbox" data-field="showMembers" data-id="1"' + (p.settings.showMembers ? ' checked' : '') + '><span>显示成员列表</span></div>' +
        '<div class="filter-row"><input type="checkbox" data-field="minimap" data-id="1"' + (app.showMinimap ? ' checked' : '') + '><span>显示小地图</span></div>' +
        '<div class="kv" style="margin-top:8px"><label>默认布局</label><select data-field="layout">' +
        ['layered', 'grid'].map(function (v) {
          return '<option value="' + v + '"' + (p.settings.layout === v ? ' selected' : '') + '>' +
            ({ layered: '分层', grid: '网格' })[v] + '</option>';
        }).join('') + '</select></div></div>' +
        '<div class="card"><h3>操作</h3><div class="kv"><button class="tbtn" data-action="layout-layered">重新布局</button>' +
        '<button class="tbtn" data-action="theme">切换主题</button></div></div>';
      return;
    }
    if (app.leftTab === 'search') {
      var sq = String(app.searchQuery || '').trim();
      var hits = sq ? Analysis.search(p, sq) : [];
      host.innerHTML = '<div class="card"><h3>检索 “' + esc(sq) + '” · ' + hits.length + ' 条</h3>' +
        (hits.length ? hits.map(function (h) {
          return '<div class="list-row"><span class="link" data-action="goto" data-id="' + esc(h.nodeId) + '">' + esc(h.label) + '</span>' +
            '<span class="tag">' + esc(h.sub) + '</span></div>';
        }).join('') : '<div class="empty">在左上角输入框输入关键字<br>可检索节点、成员、类型与关系</div>') + '</div>';
      return;
    }
    var groups = Object.create(null);
    p.nodes.forEach(function (n) {
      if (q) {
        var hay = [n.name, n.fullName, n.namespace, n.filePath, n.note].concat(n.members.map(function (m) { return m.name + ' ' + m.type; })).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      // SO 资源实例（.asset）与 SO 类定义、预制体是作用不同的三类资源，各自成组。
      var k = n.kind === 'scriptableObject' && /\.asset$/i.test(n.filePath || '') ? 'soAsset' : n.kind;
      (groups[k] = groups[k] || []).push(n);
    });
    // 分组顺序：跟随 NODE_KINDS，SO 资源组紧随 ScriptableObject 类之后。
    var groupOrder = [];
    Object.keys(S.NODE_KINDS).forEach(function (k) {
      groupOrder.push(k);
      if (k === 'scriptableObject') groupOrder.push('soAsset');
    });
    var html = groupOrder.filter(function (k) { return groups[k] && groups[k].length; }).map(function (k) {
      var collapsed = app.collapsedKinds.has(k);
      var list = groups[k].sort(function (a, b) { return a.name.localeCompare(b.name); });
      var gLabel = k === 'soAsset' ? 'SO 资源' : S.NODE_KINDS[k].label;
      var gColor = S.kindColor(k === 'soAsset' ? 'scriptableObject' : k, p.view.theme);
      return '<div class="tree-group"><div class="tree-head" data-action="toggle-group" data-id="' + k + '">' +
        (collapsed ? '▸' : '▾') + '<span class="swatch" style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + gColor + '"></span>' +
        '<span>' + esc(gLabel) + '</span><span class="count">' + list.length + '</span></div>' +
        (collapsed ? '' : list.map(function (n) {
          return '<div class="tree-item' + (app.selection.has(n.id) ? ' selected' : '') + (n.visible === false ? ' hidden-node' : '') + '" data-id="' + esc(n.id) + '">' +
            '<span class="eye" data-action="toggle-visible" data-id="' + esc(n.id) + '">' + (n.visible === false ? '○' : '●') + '</span>' +
            '<span class="name">' + esc(n.name) + '</span>' +
            (n.stale ? '<span class="badge" style="color:var(--danger)">失效</span>' : '') + '</div>';
        }).join('')) + '</div>';
    }).join('');
    host.innerHTML = html || '<div class="empty">没有匹配的资源<br>点「扫描 Unity 工程」，或直接把 Unity 工程文件夹拖进窗口</div>';
  }

  function edgeList(app, edges, dir) {
    var p = app.getProject();
    if (!edges.length) return '<div class="empty" style="padding:8px">无</div>';
    return edges.map(function (e) {
      var other = Model.getNode(p, dir === 'out' ? e.to : e.from);
      var style = S.EDGE_KINDS[e.kind] || S.EDGE_KINDS.depend;
      return '<div class="list-row"><span class="link" data-action="goto" data-id="' + esc(other ? other.id : '') + '">' +
        esc(other ? other.name : '?') + '</span><span class="tag">' + esc(style.label) +
        (e.label ? ' · ' + esc(e.label) : '') + '</span></div>';
    }).join('');
  }

  function memberGroups(members) {
    var groups = [
      { label: '变量', test: function (m) { return m.kind === 'field'; } },
      { label: '事件', test: function (m) { return m.kind === 'event'; } },
      { label: '属性', test: function (m) { return m.kind === 'property'; } },
      { label: '方法', test: function (m) { return m.kind === 'method'; } }
    ];
    return groups.map(function (g) {
      return { label: g.label, list: members.filter(g.test) };
    }).filter(function (g) { return g.list.length; });
  }

  var REF_ACTION_LABEL = {
    '': '定义', read: '读取', write: '写入', call: '调用',
    fire: '激活', subscribe: '注册', unsubscribe: '注销'
  };

  function traceDetailHtml(app) {
    var d = app.traceDetail;
    if (!d || !d.groups || !d.groups.length) return '';
    return '<div class="card"><h3>' + esc(d.title) + (d.stat ? ' · ' + esc(d.stat) : '') + '</h3>' +
      d.groups.map(function (g) {
        return '<div class="ref-group">' +
          '<div class="ref-class"><span class="link" data-action="goto" data-id="' + esc(g.id) + '">' + esc(g.name) + '</span>' +
          '<span class="tag">' + esc(g.kindLabel || '') + '</span></div>' +
          (g.rows || []).map(function (r) {
            return '<div class="ref-row"><span class="ref-action ' + esc(r.action || 'def') + '">' + esc(REF_ACTION_LABEL[r.action] || r.action || '') + '</span>' +
              '<span class="ref-body">' + esc(r.snippet || (r.via ? r.via : r.method)) + '</span></div>';
          }).join('') + '</div>';
      }).join('') + '</div>';
  }

  function memberRow(app, n, m) {
    var cnt = Analysis.refCount(app.getProject(), n.sourceKey, m.name);
    var btn = '';
    if (m.kind === 'event') {
      btn = '<button class="m-del" data-action="trace-event" data-event="' + esc(m.name) +
        '" data-type="' + esc(n.sourceKey || '') + '" title="查找所有引用：定义 / 注册 / 激活" style="color:var(--warn,#E0A040)">⚡</button>';
    } else if (m.kind === 'field' || m.kind === 'property') {
      btn = '<button class="m-del" data-action="trace-field" data-field="' + esc(m.name) +
        '" data-type="' + esc(n.sourceKey || '') + '" title="查找所有引用：声明 / 写入 / 读取" style="color:#58A6FF">⇥</button>';
    } else if (m.kind === 'method') {
      btn = '<button class="m-del" data-action="trace-method" data-method="' + esc(m.name) +
        '" data-type="' + esc(n.sourceKey || '') + '" title="查找所有引用：定义 / 调用" style="color:#A371F7">⇥</button>';
    }
    return '<div class="member-row"><span style="color:' + (S.ACCESS_COLORS[m.access] || 'var(--text2)') + '">' +
      (m.access === 'public' ? '+' : (m.access === 'private' ? '−' : '#')) + '</span>' +
      '<span class="m-name">' + esc(Layout.memberLine(m)) + '</span>' +
      (m.isSerialized ? '<span style="color:var(--success);font-size:10px" title="序列化字段">S</span>' : '') +
      (cnt ? '<span class="ref-count" title="被引用 ' + cnt + ' 处">' + cnt + '</span>' : '') +
      btn + '</div>';
  }

  function renderInspector(app) {
    var p = app.getProject(), host = el('right-body');
    var traceCard = traceDetailHtml(app);
    if (app.selectedEdgeId) {
      var e = Model.getEdge(p, app.selectedEdgeId);
      if (!e) { app.selectedEdgeId = null; return renderInspector(app); }
      var a = Model.getNode(p, e.from), b = Model.getNode(p, e.to);
      host.innerHTML = '<div class="card"><div class="field-title">关系</div>' +
        '<div class="field-sub">' + esc(a ? a.name : '?') + ' → ' + esc(b ? b.name : '?') + '</div>' +
        '<div class="kv"><label>类型</label><input value="' + esc((S.EDGE_KINDS[e.kind] || {}).label || e.kind) + '" disabled></div>' +
        '<div class="kv"><label>标签</label><input value="' + esc(e.label) + '" disabled></div>' +
        '<div class="kv"><label>来源成员</label><input value="' + esc(e.sourceMember) + '" disabled></div>' +
        '<div class="kv"><button class="tbtn" data-action="goto" data-id="' + esc(e.from) + '">定位来源</button>' +
        '<button class="tbtn" data-action="goto" data-id="' + esc(e.to) + '">定位目标</button></div></div>';
      return;
    }
    if (app.selection.size !== 1) {
      var sm = app.getSummary();
      host.innerHTML = traceCard + '<div class="card"><h3>工程概览</h3><div class="stat-grid">' +
        '<div class="stat"><b>' + sm.nodes + '</b><span>节点</span></div>' +
        '<div class="stat"><b>' + sm.edges + '</b><span>关系</span></div>' +
        '<div class="stat"><b>' + sm.cycles.length + '</b><span>循环依赖</span></div>' +
        '<div class="stat"><b>' + sm.isolated.length + '</b><span>孤立节点</span></div>' +
        '</div><div class="notice info">点击画布节点或左侧资源查看与编辑详情；按住 Ctrl 可多选，拖动画布空白可框选。</div></div>' +
        '<div class="card"><h3>连接度最高</h3>' + sm.topConnected.map(function (t) {
          return '<div class="list-row"><span class="link" data-action="goto" data-id="' + esc(t.id) + '">' + esc(t.name) + '</span><span class="tag">' + t.degree + ' 条关系</span></div>';
        }).join('') + '</div>';
      return;
    }
    var id = Array.from(app.selection)[0];
    var n = Model.getNode(p, id);
    if (!n) return;
    var idx = Analysis.buildIndex(p);
    var outs = idx.out[id] || [], ins = idx.inn[id] || [];
    var deg = Analysis.degrees(p, id, idx);
    var groups = memberGroups(n.members);
    var memberHtml = groups.map(function (g) {
      return '<div class="member-group">' + esc(g.label) + ' · ' + g.list.length + '</div>' +
        g.list.map(function (m) { return memberRow(app, n, m); }).join('');
    }).join('');
    var comps = Array.isArray(n.components) ? n.components : [];
    var compHtml = '';
    if (comps.length) {
      compHtml = '<div class="card"><h3>组件组成 · ' + comps.length + '</h3>' +
        comps.map(function (c, ci) {
          var sn = c.nodeKey ? p.nodes.find(function (x) { return x.sourceKey === c.nodeKey; }) : null;
          var spec = S.compIcon(c.type, !!(c.nodeKey || c.isScript));
          return '<div class="list-row"><span style="display:inline-block;min-width:22px;height:19px;line-height:19px;text-align:center;border-radius:4px;background:' + spec.color + '2E;color:' + spec.color + ';font-size:11px;font-weight:600">' +
            (COMP_CHAR[spec.glyph] || '⚙') + '</span>' +
            (sn ? '<span class="link" data-action="goto" data-id="' + esc(sn.id) + '">' + esc(c.type) + '</span>'
              : '<span>' + esc(c.type) + '</span>') +
            '<span class="tag">' + ((sn || c.isScript) ? '脚本' : '内置组件') + '</span>' +
            (c.enabled === false ? '<span class="tag">未启用</span>' : '') + '</div>';
        }).join('') + '</div>';
    }
    host.innerHTML = traceCard + '<div class="card"><div class="field-title">' + esc(n.name) + '</div>' +
      '<div class="field-sub">' + esc((S.NODE_KINDS[n.kind] || {}).label || '') + ' · ' + esc(n.fullName || '') + '</div>' +
      '<div>' + (n.tags || []).map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join('') +
      (n.stale ? '<span class="pill danger">已失效</span>' : '') + '</div>' +
      '<div style="margin-top:10px">' +
      '<div class="kv"><label>命名空间</label><input value="' + esc(n.namespace) + '" disabled></div>' +
      (n.outer ? '<div class="kv"><label>嵌套于</label><input value="' + esc(n.outer) + '" disabled></div>' : '') +
      '<div class="kv"><label>基类</label><input value="' + esc(n.baseTypes.join(', ')) + '" disabled></div>' +
      '<div class="kv"><label>文件路径</label><input value="' + esc(n.filePath || '—') + '" disabled></div>' +
      '<div class="kv"><label>批注</label><textarea data-field="nodeNote" data-id="' + esc(n.id) + '" placeholder="重新扫描会保留这里的批注">' + esc(n.note) + '</textarea></div>' +
      '</div><div class="kv" style="margin-top:8px"><button class="tbtn" data-action="goto" data-id="' + esc(n.id) + '">定位</button>' +
      '<button class="tbtn" data-action="focus">聚焦依赖</button></div></div>' +
      '<div class="card"><h3>成员 · ' + n.members.length + '</h3>' + (memberHtml || '<div class="empty" style="padding:8px">暂无成员</div>') + '</div>' +
      compHtml +
      '<div class="card"><h3>引用关系 · 入 ' + deg.in + ' / 出 ' + deg.out + '</h3>' +
      '<div class="kv" style="margin-bottom:8px">' +
      '<button class="tbtn" data-action="focus-side" data-id="in">聚焦 · 谁引用我</button>' +
      '<button class="tbtn" data-action="focus-side" data-id="out">聚焦 · 我依赖谁</button></div>' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:4px">被谁引用</div>' + edgeList(app, ins, 'in') +
      '<div style="font-size:11px;color:var(--text3);margin:9px 0 4px">引用了谁</div>' + edgeList(app, outs, 'out') + '</div>';
  }

  function renderDeps(app) {
    var p = app.getProject(), host = el('right-body'), sm = app.getSummary();
    var id = app.selection.size === 1 ? Array.from(app.selection)[0] : null;
    var idx = Analysis.buildIndex(p);
    var nodePart = '';
    if (id) {
      var n = Model.getNode(p, id);
      var nb1 = Analysis.neighbors(p, id, { direction: 'both', depth: 1, index: idx });
      var nb2 = Analysis.neighbors(p, id, { direction: 'both', depth: 2, index: idx });
      var nb3 = Analysis.neighbors(p, id, { direction: 'both', depth: 3, index: idx });
      nodePart = '<div class="card"><h3>' + esc(n.name) + ' 的依赖闭包</h3>' +
        '<div class="kv"><button class="tbtn" data-action="depth" data-id="1">1 跳 · ' + nb1.ids.length + '</button>' +
        '<button class="tbtn" data-action="depth" data-id="2">2 跳 · ' + nb2.ids.length + '</button>' +
        '<button class="tbtn" data-action="depth" data-id="3">3 跳 · ' + nb3.ids.length + '</button></div>' +
        '<div style="margin-top:6px">' + nb1.ids.slice(0, 12).map(function (x) {
          var t = Model.getNode(p, x);
          return '<span class="pill" data-action="goto" data-id="' + esc(x) + '" style="cursor:pointer">' + esc(t ? t.name : x) + '</span>';
        }).join('') + '</div></div>';
    }
    var cycles = sm.cycles.map(function (c, i) {
      return '<div class="notice danger">环 ' + (i + 1) + '（' + c.length + ' 个节点）：' +
        esc(c.nodeIds.map(function (x) { var t = Model.getNode(p, x); return t ? t.name : x; }).join(' → ')) +
        '</div>';
    }).join('');
    host.innerHTML = '<div class="card"><h3>全局统计</h3><div class="stat-grid">' +
      '<div class="stat"><b>' + sm.nodes + '</b><span>节点</span></div>' +
      '<div class="stat"><b>' + sm.edges + '</b><span>关系</span></div>' +
      '<div class="stat"><b>' + sm.cycles.length + '</b><span>环</span></div>' +
      '<div class="stat"><b>' + sm.isolated.length + '</b><span>孤立</span></div></div>' +
      '<div>' + Object.keys(sm.byKind).map(function (k) {
        return '<span class="pill">' + esc((S.EDGE_KINDS[k] || {}).label || k) + ' ' + sm.byKind[k] + '</span>';
      }).join('') + '</div></div>' + nodePart +
      '<div class="card"><h3>循环依赖</h3>' + (cycles || '<div class="notice info">未检测到循环依赖</div>') + '</div>' +
      '<div class="card"><h3>孤立节点 · ' + sm.isolated.length + '</h3>' +
      (sm.isolated.slice(0, 20).map(function (x) {
        var t = Model.getNode(p, x);
        return '<div class="list-row"><span class="link" data-action="goto" data-id="' + esc(x) + '">' + esc(t ? t.name : x) + '</span><span class="tag">无引用</span></div>';
      }).join('') || '<div class="empty" style="padding:8px">无</div>') + '</div>';
  }

  function renderProject(app) {
    var p = app.getProject(), host = el('right-body');
    var diff = app.getLastDiff();
    var diffHtml = diff ? '<div class="diff-list">' +
      (diff.addedNodes.length ? '<div class="pill success">新增节点 ' + diff.addedNodes.length + '</div>' : '') +
      (diff.removedNodes.length ? '<div class="pill danger">移除节点 ' + diff.removedNodes.length + '</div>' : '') +
      (diff.changedNodes.length ? '<div class="pill warn">成员变更 ' + diff.changedNodes.length + '</div>' : '') +
      (diff.addedEdges.length ? '<div class="pill success">新增关系 ' + diff.addedEdges.length + '</div>' : '') +
      (diff.removedEdges.length ? '<div class="pill danger">移除关系 ' + diff.removedEdges.length + '</div>' : '') +
      '</div>' : '<div class="empty" style="padding:8px">尚无扫描记录</div>';
    host.innerHTML = '<div class="card"><h3>工程信息</h3>' +
      '<div class="kv"><label>名称</label><input value="' + esc(p.meta.name) + '" disabled></div>' +
      '<div class="kv"><label>Unity 目录</label><input value="' + esc(p.meta.unityRoot || '未扫描') + '" disabled></div>' +
      '<div class="kv"><label>上次扫描</label><input value="' + esc(fmtTime(p.meta.lastScan)) + '" disabled></div>' +
      '<div class="kv"><label>软件版本</label><input value="v' + esc(S.APP_VERSION) + '" disabled></div></div>' +
      '<div class="card"><h3>最近扫描差异</h3>' + diffHtml +
      '<div style="margin-top:8px"><button class="tbtn" data-action="rescan">重新扫描已绑定目录</button>' +
      '<button class="tbtn" data-action="scan">换一个目录</button>' +
      '<button class="tbtn" data-action="show-diff">详细对比</button></div></div>' +
      '<div class="card"><h3>数据</h3>' +
      '<div class="kv"><button class="tbtn" data-action="load-demo">载入示例工程</button>' +
      '<button class="tbtn" data-action="export-md">导出清单</button></div>' +
      '<div class="kv" style="margin-top:6px"><button class="tbtn" data-action="remove-stale">清理失效节点</button></div></div>';
  }

  function renderRight(app) {
    if (app.rightTab === 'deps') renderDeps(app);
    else if (app.rightTab === 'project') renderProject(app);
    else renderInspector(app);
  }

  function renderStatus(app) {
    var p = app.getProject(), sm = app.getSummary();
    el('project-name').textContent = p.meta.name;
    var pathEl = el('project-path');
    if (pathEl) pathEl.textContent = p.meta.unityRoot && p.meta.unityRoot !== p.meta.name ? 'Unity 工程 · ' + p.meta.unityRoot : '';
    el('status-stats').textContent = sm.nodes + ' 节点 · ' + sm.edges + ' 关系 · 可见 ' + sm.visibleNodes +
      (sm.staleNodes ? ' · 失效 ' + sm.staleNodes : '');
    el('status-scan').textContent = '上次扫描 ' + fmtTime(p.meta.lastScan);
    el('zoom-label').textContent = Math.round(p.view.scale * 100) + '%';
    el('desktop-hint').textContent = UA.Bridge.isDesktop ? '桌面模式' : '浏览器模式（可绑定目录自动重扫 / 拖入文件夹）';
    var verEl = el('app-version');
    if (verEl) verEl.textContent = 'v' + S.APP_VERSION;
  }

  function renderAll(app) {
    syncToolbar(app);
    renderLeft(app); renderRight(app); renderStatus(app); renderLegend(app);
  }

  /** Selection changes only touch the inspector and status bar — the left tree is untouched. */
  function renderSelection(app) {
    syncToolbar(app);
    syncTreeSelection(app);
    renderRight(app);
    renderStatus(app);
  }

  /** Toggle tree highlight in place instead of rebuilding the whole node list. */
  function syncTreeSelection(app) {
    var host = el('left-body');
    if (!host || !app.selection) return;
    var items = host.querySelectorAll('.tree-item[data-id]');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('selected', app.selection.has(items[i].dataset.id));
    }
  }

  /** Light up toolbar buttons while a canvas mode (focus/trace/assembly/isolate) is on,
   *  and reflect the member-highlight toggles (事件/协程/UnityEvent/委托). */
  function syncToolbar(app) {
    var m = app.canvasMode;
    var active = {
      'focus': m === 'focus',
      'trace-event': m === 'event',
      'trace-field': m === 'field',
      'layout-assembly': m === 'assembly',
      'isolate': !!app.isolateSnapshot
    };
    document.querySelectorAll('.toolbar .tbtn[data-action]').forEach(function (b) {
      var on = !!active[b.dataset.action] ||
        (b.dataset.action === 'highlight-member' && app.memberHighlight && app.memberHighlight.has(b.dataset.id));
      b.classList.toggle('mode-on', on);
    });
  }

  function init(app) {
    document.addEventListener('click', function (e) {
      var menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) {
        var r = menuBtn.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 2, MENUS[menuBtn.dataset.menu] || [], app);
        return;
      }
      var act = e.target.closest('[data-action]');
      if (act) { e.stopPropagation(); hideContext(); app.action(act.dataset.action, act.dataset); return; }
      var tab = e.target.closest('.panel-tabs button');
      if (tab) { app.setTab(tab.closest('.panel-tabs').dataset.panel, tab.dataset.tab); return; }
      var treeItem = e.target.closest('.tree-item[data-id]');
      if (treeItem) { app.selectNode(treeItem.dataset.id, e.ctrlKey || e.shiftKey); return; }
      if (!e.target.closest('#context-menu')) hideContext();
    });
    document.addEventListener('change', function (e) {
      var f = e.target.closest('[data-field]');
      if (f) {
        var value = f.type === 'checkbox' ? f.checked : f.value;
        app.updateField(f.dataset.field, value, f.dataset.id);
      }
    });
    document.addEventListener('input', function (e) {
      if (e.target.id === 'tree-search') {
        // The same box filters the resource tree OR drives the 检索 tab.
        if (app.leftTab === 'search') { app.searchQuery = e.target.value; renderLeft(app); }
        else { app.treeQuery = e.target.value; renderLeft(app); }
      }
      if (e.target.id === 'global-search') {
        app.searchQuery = e.target.value;
        app.setTab('left', 'search');
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); hideContext(); } });
    root.addEventListener('resize', function () { app.resizeCanvas(); });
  }

  UA.UI = {
    esc: esc, el: el, init: init, renderAll: renderAll, renderSelection: renderSelection, renderLeft: renderLeft,
    renderRight: renderRight, renderStatus: renderStatus, renderLegend: renderLegend,
    toast: toast, modal: modal, closeModal: closeModal, contextMenu: contextMenu,
    hideContext: hideContext, fmtTime: fmtTime, MENUS: MENUS, syncToolbar: syncToolbar
  };
})(globalThis);
