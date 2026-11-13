/* Unity Architect - shared schema. Runs in Node and browser (UMD). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.UA = root.UA || {}; root.UA.Schema = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var APP_VERSION = '2.8.1';

  /* ==================================================================
   * 关于页信息（帮助 → 关于）
   * 上传 Git / 分发给别人之前，把下面 4 个字段改成你自己的信息即可；
   * 不需要的字段写成空字符串 '' 就不会显示。
   * 修改后：网页版运行 npm run build:html 重新生成；
   *         桌面 exe 运行 node tools/pack-portable.js 重新打包。
   * ================================================================== */
  var ABOUT = {
    author:  '作者：菜鸟小熊',                                     // ← 改这里
    contact: '联系方式：B站-Destiny抉择',                          // ← 改这里（或留空）
    repo:    '开源地址：https://github.com/yourname/UnityArchitect', // ← 改成你的仓库地址
    license: '本项目以 MIT 协议开源，可自由使用与修改'              // ← 改这里（或留空）
  };

  var NODE_KINDS = {
    class:            { label: '脚本类',        color: '#185FA5', dark: '#85B7EB', badge: 'C' },
    interface:        { label: '接口',          color: '#534AB7', dark: '#AFA9EC', badge: 'I' },
    struct:           { label: '结构体',        color: '#0F6E56', dark: '#5DCAA5', badge: 'S' },
    enum:             { label: '枚举',          color: '#854F0B', dark: '#EF9F27', badge: 'E' },
    scriptableObject: { label: 'ScriptableObject', color: '#BA7517', dark: '#FAC775', badge: 'SO' },
    gameObject:       { label: 'GameObject',    color: '#1D9E75', dark: '#9FE1CB', badge: 'GO' },
    prefab:           { label: '预制体',        color: '#0F6E56', dark: '#5DCAA5', badge: 'P' },
    scene:            { label: '场景',          color: '#378ADD', dark: '#B5D4F4', badge: 'Sc' }
  };

  var EDGE_KINDS = {
    inherit:   { label: '继承',     color: '#534AB7', dark: '#AFA9EC', dash: [],     arrow: 'triangle',      width: 2.0 },
    implement: { label: '实现',     color: '#7F77DD', dark: '#CECBF6', dash: [7, 4], arrow: 'triangle',      width: 1.8 },
    compose:   { label: '组合',     color: '#185FA5', dark: '#85B7EB', dash: [],     arrow: 'diamond',       width: 2.0 },
    aggregate: { label: '聚合',     color: '#378ADD', dark: '#B5D4F4', dash: [],     arrow: 'hollowDiamond', width: 1.8 },
    depend:    { label: '依赖',     color: '#BA7517', dark: '#FAC775', dash: [6, 4], arrow: 'chevron',       width: 1.6 },
    event:     { label: '事件',     color: '#D4537E', dark: '#ED93B1', dash: [2, 3], arrow: 'chevron',       width: 1.6 },
    serialize: { label: '序列化引用', color: '#0F6E56', dark: '#5DCAA5', dash: [],   arrow: 'chevron',       width: 1.8 },
    attach:    { label: '挂载组件', color: '#1D9E75', dark: '#9FE1CB', dash: [4, 3], arrow: 'chevron',       width: 1.4 }
  };

  var ACCESS_COLORS = {
    public: '#3B6D11', private: '#A32D2D', protected: '#854F0B',
    internal: '#185FA5', 'protected internal': '#BA7517', 'private protected': '#993556'
  };

  /** 追踪角色配色：画布徽章与追踪箭头共用一份，避免两处漂移。 */
  var ROLE_TONE = {
    '定义': '#3FB950', '激活': '#E0A040', '注册': '#58A6FF', '注销': '#8B949E',
    '写入': '#F85149', '读取': '#39D2C0', '调用': '#A371F7', '字段类型': '#A371F7'
  };

  /** 成员高亮按钮：把某类"复杂"成员的文字换成醒目颜色，便于一眼定位。 */
  var MEMBER_HIGHLIGHTS = [
    { key: 'event',      label: '事件',      kinds: ['csharpEvent'],    color: '#FF4FC3' },
    { key: 'coroutine',  label: '协程',      kinds: ['coroutine'],      color: '#FFA640' },
    { key: 'unityEvent', label: 'UnityEvent', kinds: ['unityEvent'],    color: '#35E0FF' },
    { key: 'delegate',   label: '委托',      kinds: ['customDelegate'], color: '#FFE550' }
  ];
  /** 某成员 kind 在当前高亮开关下应使用的颜色；未开启返回 null（用默认文字色）。 */
  function highlightFor(kind, activeKeys) {
    if (!activeKeys || !activeKeys.size) return null;
    for (var i = 0; i < MEMBER_HIGHLIGHTS.length; i++) {
      var h = MEMBER_HIGHLIGHTS[i];
      if (activeKeys.has(h.key) && h.kinds.indexOf(kind) >= 0) return h.color;
    }
    return null;
  }
  var THEME = {
    light: {
      canvas: '#FAFAF8', grid: 'rgba(0,0,0,0.045)', card: '#FFFFFF', cardBorder: '#D3D1C7',
      header: '#F1EFE8', text: '#2C2C2A', text2: '#5F5E5A', text3: '#888780',
      selection: '#185FA5', panel: '#FFFFFF', panelAlt: '#F7F6F2', border: 'rgba(0,0,0,0.12)',
      tooltip: '#FFFFFF', dimmed: 'rgba(255,255,255,0.72)'
    },
    dark: {
      canvas: '#161A20', grid: 'rgba(255,255,255,0.045)', card: '#21262E', cardBorder: '#3A414B',
      header: '#1B2027', text: '#DCE3EC', text2: '#9AA5B1', text3: '#6E7885',
      selection: '#58A6FF', panel: '#1C2128', panelAlt: '#171B21', border: 'rgba(255,255,255,0.12)',
      tooltip: '#252B34', dimmed: 'rgba(22,26,32,0.75)'
    }
  };

  var idSeq = 0;
  function genId(prefix) {
    idSeq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + idSeq.toString(36) +
      '_' + Math.random().toString(36).slice(2, 7);
  }

  function nowIso() { return new Date().toISOString(); }

  function createEmptyProject(name) {
    return {
      meta: {
        name: name || '未命名工程',
        unityRoot: '',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastScan: null,
        appVersion: APP_VERSION
      },
      nodes: [],
      edges: [],
      assemblies: [],
      view: { scale: 1, offsetX: 0, offsetY: 0, theme: 'light' },
      settings: {
        showMembers: true,
        layout: 'layered',
        edgeFilter: Object.keys(EDGE_KINDS).reduce(function (acc, k) { acc[k] = true; return acc; }, {}),
        nodeFilter: Object.keys(NODE_KINDS).reduce(function (acc, k) { acc[k] = true; return acc; }, {})
      }
    };
  }

  /** Fill missing fields, drop dangling edges, deduplicate ids. Never throws on malformed input. */
  function normalizeProject(raw) {
    var p = createEmptyProject();
    if (!raw || typeof raw !== 'object') return p;
    if (raw.meta && typeof raw.meta === 'object') {
      ['name', 'unityRoot', 'createdAt', 'lastScan'].forEach(function (k) {
        if (typeof raw.meta[k] === 'string') p.meta[k] = raw.meta[k];
      });
      if (typeof raw.meta.updatedAt === 'string') p.meta.updatedAt = raw.meta.updatedAt;
    }
    if (raw.view && typeof raw.view === 'object') {
      if (Number.isFinite(raw.view.scale)) p.view.scale = clamp(raw.view.scale, 0.1, 4);
      if (Number.isFinite(raw.view.offsetX)) p.view.offsetX = raw.view.offsetX;
      if (Number.isFinite(raw.view.offsetY)) p.view.offsetY = raw.view.offsetY;
      if (raw.view.theme === 'dark' || raw.view.theme === 'light') p.view.theme = raw.view.theme;
    }
    if (raw.settings && typeof raw.settings === 'object') {
      var s = raw.settings;
      if (typeof s.showMembers === 'boolean') p.settings.showMembers = s.showMembers;
      if (typeof s.layout === 'string') p.settings.layout = s.layout;
      if (s.edgeFilter && typeof s.edgeFilter === 'object') Object.assign(p.settings.edgeFilter, s.edgeFilter);
      if (s.nodeFilter && typeof s.nodeFilter === 'object') Object.assign(p.settings.nodeFilter, s.nodeFilter);
    }

    // Assembly definitions are layer metadata (no graph nodes).
    p.assemblies = (Array.isArray(raw.assemblies) ? raw.assemblies : []).filter(function (a) {
      return a && typeof a.name === 'string' && a.name;
    }).map(function (a) {
      return {
        name: a.name,
        filePath: typeof a.filePath === 'string' ? a.filePath : '',
        refs: Array.isArray(a.refs) ? a.refs.filter(isString) : []
      };
    });

    var seen = Object.create(null);
    (Array.isArray(raw.nodes) ? raw.nodes : []).forEach(function (n) {
      if (!n || typeof n !== 'object' || typeof n.name !== 'string') return;
      // Manual / assembly content is legacy: this tool is scan-only now.
      if (n.kind === 'manual' || n.kind === 'assembly') return;
      var id = typeof n.id === 'string' && n.id ? n.id : genId('node');
      if (seen[id]) id = genId('node');
      seen[id] = true;
      p.nodes.push(normalizeNode(n, id));
    });
    var nodeIds = Object.create(null);
    p.nodes.forEach(function (n) { nodeIds[n.id] = true; });
    var edgeSeen = Object.create(null);
    (Array.isArray(raw.edges) ? raw.edges : []).forEach(function (e) {
      if (!e || !nodeIds[e.from] || !nodeIds[e.to]) return;
      if (e.kind === 'manual') return; // hand-drawn relations are no longer supported
      var id = typeof e.id === 'string' && e.id ? e.id : genId('edge');
      if (edgeSeen[id]) id = genId('edge');
      edgeSeen[id] = true;
      p.edges.push(normalizeEdge(e, id));
    });
    return p;
  }

  function normalizeNode(n, id) {
    var kind = NODE_KINDS[n.kind] ? n.kind : 'class';
    return {
      id: id,
      kind: kind,
      name: n.name,
      fullName: typeof n.fullName === 'string' ? n.fullName : n.name,
      namespace: typeof n.namespace === 'string' ? n.namespace : '',
      outer: typeof n.outer === 'string' ? n.outer : '',
      baseTypes: Array.isArray(n.baseTypes) ? n.baseTypes.filter(isString) : [],
      guid: typeof n.guid === 'string' ? n.guid : '',
      filePath: typeof n.filePath === 'string' ? n.filePath : '',
      assembly: typeof n.assembly === 'string' ? n.assembly : '',
      summary: typeof n.summary === 'string' ? n.summary : '',
      note: typeof n.note === 'string' ? n.note : '',
      tags: Array.isArray(n.tags) ? n.tags.filter(isString) : [],
      members: (Array.isArray(n.members) ? n.members : []).map(normalizeMember).filter(Boolean),
      // GameObject 组成：内置组件（Transform / Rigidbody…）与挂载的脚本（nodeKey 指回脚本节点）。
      components: (Array.isArray(n.components) ? n.components : []).filter(function (c) { return c && typeof c.type === 'string'; })
        .map(function (c) {
          return {
            type: c.type,
            classId: typeof c.classId === 'string' ? c.classId : '',
            fileId: typeof c.fileId === 'string' ? c.fileId : '',
            nodeKey: typeof c.nodeKey === 'string' ? c.nodeKey : '',
            isScript: !!c.isScript,
            enabled: c.enabled !== false
          };
        }),
      position: {
        x: Number.isFinite(n.position && n.position.x) ? n.position.x : 0,
        y: Number.isFinite(n.position && n.position.y) ? n.position.y : 0
      },
      visible: n.visible !== false,
      manual: !!n.manual,
      sourceKey: typeof n.sourceKey === 'string' ? n.sourceKey : '',
      stale: !!n.stale,
      color: typeof n.color === 'string' ? n.color : ''
    };
  }

  function normalizeMember(m) {
    if (!m || typeof m.name !== 'string') return null;
    return {
      id: typeof m.id === 'string' && m.id ? m.id : genId('mem'),
      kind: ['field', 'property', 'method', 'event'].indexOf(m.kind) >= 0 ? m.kind : 'field',
      name: m.name,
      type: typeof m.type === 'string' ? m.type : 'var',
      access: typeof m.access === 'string' ? m.access : 'private',
      category: typeof m.category === 'string' ? m.category : '',
      initialValue: typeof m.initialValue === 'string' ? m.initialValue : '',
      parameters: typeof m.parameters === 'string' ? m.parameters : '',
      returnType: typeof m.returnType === 'string' ? m.returnType : 'void',
      isStatic: !!m.isStatic,
      isSerialized: !!m.isSerialized,
      memberRefs: (Array.isArray(m.memberRefs) ? m.memberRefs : []).map(function (u) {
        if (!u || typeof u.name !== 'string' || !u.name) return null;
        return {
          type: typeof u.type === 'string' ? u.type : '',
          name: u.name,
          action: ['read', 'write', 'call', 'fire', 'subscribe', 'unsubscribe'].indexOf(u.action) >= 0 ? u.action : 'read',
          via: typeof u.via === 'string' ? u.via : '',
          snippet: typeof u.snippet === 'string' ? u.snippet : ''
        };
      }).filter(Boolean),
      callTargets: (Array.isArray(m.callTargets) ? m.callTargets : []).map(function (c) {
        if (!c || typeof c.member !== 'string' || !c.member) return null;
        return {
          type: typeof c.type === 'string' ? c.type : '',
          member: c.member,
          via: typeof c.via === 'string' ? c.via : '',
          args: (Array.isArray(c.args) ? c.args : []).filter(isString)
        };
      }).filter(Boolean),
      paramFlows: (Array.isArray(m.paramFlows) ? m.paramFlows : []).map(function (f) {
        if (!f || typeof f.param !== 'string' || typeof f.field !== 'string' || !f.param || !f.field) return null;
        return { param: f.param, field: f.field };
      }).filter(Boolean),
      assignFlows: (Array.isArray(m.assignFlows) ? m.assignFlows : []).map(function (f) {
        if (!f || typeof f.from !== 'string' || typeof f.type !== 'string' || typeof f.to !== 'string' || !f.to) return null;
        return { from: f.from, type: f.type, to: f.to };
      }).filter(Boolean),
      note: typeof m.note === 'string' ? m.note : '',
      manual: !!m.manual
    };
  }

  function normalizeEdge(e, id) {
    return {
      id: id,
      from: e.from,
      to: e.to,
      kind: EDGE_KINDS[e.kind] ? e.kind : 'depend',
      sourceMember: typeof e.sourceMember === 'string' ? e.sourceMember : '',
      label: typeof e.label === 'string' ? e.label : '',
      note: typeof e.note === 'string' ? e.note : '',
      manual: !!e.manual,
      stale: !!e.stale,
      sourceKey: typeof e.sourceKey === 'string' ? e.sourceKey : ''
    };
  }

  function isString(v) { return typeof v === 'string'; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** Unity 组件图标规格：按组件名（不区分大小写）匹配 → { color, glyph }。
   *  glyph 是图形种类键，画布用矢量小图标渲染，HTML 检查器用近似字符渲染。 */
  var COMP_ICON_RULES = [
    [/^transform$/,                                  '#7EA6F4', 'transform'],
    [/rigidbody|physics|constantforce/,              '#C88AE0', 'rigidbody'],
    [/collider|trigger/,                             '#8FD16A', 'box'],
    [/joint|hinge|spring|configurable/,              '#D8B45B', 'joint'],
    [/mesh/,                                         '#E0B25B', 'mesh'],
    [/camera/,                                       '#67D0D8', 'camera'],
    [/light/,                                        '#F2D75B', 'light'],
    [/audio/,                                        '#E88BB0', 'audio'],
    [/animator|animation|playable|director/,         '#B48AE8', 'play'],
    [/particle|effect|vfx|trail|line/,               '#7BD3B8', 'dots'],
    [/canvas|recttransform|image|text|button|panel|slider|scroll|toggle|dropdown|inputfield|layout|graphic|selector/, '#6E9BF0', 'ui'],
    [/navmesh|agent|pathfinding|ai|behaviour/,       '#8FD16A', 'nav'],
    [/terrain|tilemap|grid/,                         '#B0A068', 'grid'],
    [/render|sprite|texture|skybox|material/,        '#5BA8D8', 'picture'],
    [/flare|occlusion|occlusionculling|lod|billboard/, '#9AA4B2', 'gear']
  ];
  function compIcon(type, isScript) {
    if (isScript) return { color: '#4EA1FF', glyph: 'script' };
    var s = String(type || '').toLowerCase();
    for (var i = 0; i < COMP_ICON_RULES.length; i++) {
      if (COMP_ICON_RULES[i][0].test(s)) return { color: COMP_ICON_RULES[i][1], glyph: COMP_ICON_RULES[i][2] };
    }
    return { color: '#9AA4B2', glyph: 'gear' };
  }
  function kindColor(kind, theme) {
    var k = NODE_KINDS[kind];
    if (!k) k = NODE_KINDS.class;
    return theme === 'dark' ? k.dark : k.color;
  }
  /** 卡片右上角徽章：.asset 生成的 SO 资源实例标记为 SO.asset，与 SO 类定义区分。 */
  function kindBadge(node) {
    if (node && node.kind === 'scriptableObject' && /\.asset$/i.test(node.filePath || '')) return 'SO.asset';
    var k = NODE_KINDS[node && node.kind] || NODE_KINDS.class;
    return k.badge;
  }
  function edgeColor(kind, theme) {
    var k = EDGE_KINDS[kind];
    if (!k) k = EDGE_KINDS.depend;
    return theme === 'dark' ? k.dark : k.color;
  }

  return {
    APP_VERSION: APP_VERSION,
    ABOUT: ABOUT,
    ROLE_TONE: ROLE_TONE,
    MEMBER_HIGHLIGHTS: MEMBER_HIGHLIGHTS,
    highlightFor: highlightFor,
    NODE_KINDS: NODE_KINDS,
    EDGE_KINDS: EDGE_KINDS,
    ACCESS_COLORS: ACCESS_COLORS,
    kindBadge: kindBadge,
    THEME: THEME,
    genId: genId,
    nowIso: nowIso,
    createEmptyProject: createEmptyProject,
    normalizeProject: normalizeProject,
    normalizeNode: normalizeNode,
    normalizeEdge: normalizeEdge,
    normalizeMember: normalizeMember,
    kindColor: kindColor,
    edgeColor: edgeColor,
    compIcon: compIcon,
    clamp: clamp
  };
});
