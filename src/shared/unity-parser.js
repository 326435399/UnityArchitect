/* Unity project parser: .cs + .meta GUID index + prefab/scene/asset YAML + .asmdef. UMD. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var Cs = isNode ? require('./cs-parser.js') : root.UA.CsParser;
  var S = isNode ? require('./schema.js') : root.UA.Schema;
  var api = factory(Cs, S);
  if (isNode) module.exports = api;
  else { root.UA = root.UA || {}; root.UA.UnityParser = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cs, S) {
  'use strict';

  // ProjectSettings / Packages / Library are Unity's own data, never project architecture.
  var IGNORED_DIR = /^(Library|Temp|obj|Logs|UserSettings|ProjectSettings|Packages|PackagesCache|\.git|\.vs|\.idea|\.plastic|\.svn|Build|Builds|MemoryCaptures|Recordings)\//i;
  var META_RE = /^guid:\s*([0-9a-fA-F]{32})\s*$/m;
  var DOC_RE = /^---\s*!u!(\d+)\s*&(-?\d+)[^\r\n]*$/gm;
  var TEXT_EXT = /\.(cs|meta|prefab|unity|asset|asmdef|asmref|controller|mat|anim|physicMaterial|renderTexture|shader|json|txt)$/i;

  // Unity YAML classID → 内置组件名（GameObject 的组成里出现最多的那些）。
  var CLASS_NAMES = {
    '1': 'GameObject', '4': 'Transform', '224': 'RectTransform',
    '20': 'Camera', '23': 'MeshRenderer', '33': 'MeshFilter', '137': 'SkinnedMeshRenderer',
    '212': 'SpriteRenderer', '96': 'TrailRenderer', '120': 'LineRenderer',
    '54': 'Rigidbody', '143': 'CharacterController',
    '65': 'BoxCollider', '135': 'SphereCollider', '136': 'CapsuleCollider', '64': 'MeshCollider',
    '50': 'Rigidbody2D', '61': 'BoxCollider2D', '58': 'CircleCollider2D',
    '60': 'PolygonCollider2D', '68': 'EdgeCollider2D',
    '95': 'Animator', '111': 'Animation', '82': 'AudioSource', '81': 'AudioListener',
    '108': 'Light', '198': 'ParticleSystem', '199': 'ParticleSystemRenderer',
    '205': 'LODGroup', '222': 'CanvasRenderer', '223': 'Canvas', '225': 'CanvasGroup',
    '114': 'MonoBehaviour'
  };

  function normalizePath(p, rootPrefix) {
    var s = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (rootPrefix) {
      var rp = String(rootPrefix).replace(/\\/g, '/').replace(/\/$/, '');
      if (s.indexOf(rp) === 0) s = s.slice(rp.length).replace(/^\//, '');
    }
    var idx = s.search(/(?:^|\/)(Assets|Packages)\//);
    if (idx >= 0) s = s.slice(idx === 0 ? 0 : idx + 1);
    return s;
  }

  function isIgnored(path) {
    var parts = path.split('/');
    return parts.some(function (seg) { return IGNORED_DIR.test(seg + '/'); });
  }

  // 官方包脚本 meta（Library/PackageCache/**.cs.meta）只用来解析 GUID → 脚本名，
  // 让 EventSystem / StandaloneInputModule 等官方组件显示真实脚本名而不是 MonoBehaviour。
  var PKG_SCRIPT_META = /(?:^|\/)Library\/(?:PackageCache|UnityPackageCache)\/.+\.cs\.meta$/i;

  function shouldInclude(path) {
    if (!TEXT_EXT.test(path)) return false;
    if (PKG_SCRIPT_META.test('/' + String(path).replace(/^\/+/, ''))) return true;
    return !isIgnored(path);
  }

  /** Read guid -> asset path from every .meta file. */
  function buildGuidIndex(files) {
    var index = Object.create(null);
    files.forEach(function (f) {
      if (!/\.meta$/i.test(f.path)) return;
      var m = META_RE.exec(String(f.content || ''));
      if (!m) return;
      var assetPath = f.path.replace(/\.meta$/i, '');
      index[m[1].toLowerCase()] = assetPath;
    });
    return index;
  }

  /** Split a Unity YAML file into documents. */
  function parseYamlDocuments(content) {
    var text = String(content || '').replace(/^\uFEFF/, '');
    var docs = [], re = new RegExp(DOC_RE.source, 'gm'), m, starts = [];
    while ((m = re.exec(text)) !== null) starts.push({ classId: m[1], fileId: m[2], start: m.index, bodyStart: re.lastIndex });
    starts.forEach(function (s, i) {
      var end = i + 1 < starts.length ? starts[i + 1].start : text.length;
      docs.push({ classId: s.classId, fileId: s.fileId, body: text.slice(s.bodyStart, end) });
    });
    return docs;
  }

  // YAML 字段读取是解析最热的路径（每个文档要读 m_Name / m_Enabled / m_Script…），
  // 正则按 key 缓存复用，避免每行 new RegExp。
  var SCALAR_RE_CACHE = Object.create(null);
  function findScalar(body, key) {
    var re = SCALAR_RE_CACHE[key];
    // 值必须与键同行：`m_Name:` 为空时 \s* 会吞掉换行，把下一行（如 m_EditorClassIdentifier:）误当值
    if (!re) re = SCALAR_RE_CACHE[key] = new RegExp('^\\s*' + key + ':[ \\t]*(.+)$', 'm');
    var m = re.exec(body);
    return m ? m[1].trim() : '';
  }

  function scriptGuid(body) {
    var m = /m_Script:\s*\{[^}]*guid:\s*([0-9a-fA-F]{32})/i.exec(body);
    return m ? m[1].toLowerCase() : '';
  }

  // 文档级引用扫描用的正则（带 g，复用前需重置 lastIndex）。
  var FIELD_REF_RE = /\b([A-Za-z_]\w*):\s*\{[^}]*guid:\s*([0-9a-fA-F]{32})/g;
  var FILE_REF_RE = /\b([A-Za-z_]\w*):\s*\{\s*fileID:\s*(-?\d+)\s*\}/g;

  function gameObjectId(body) {
    var m = /m_GameObject:\s*\{\s*fileID:\s*(-?\d+)/.exec(body);
    return m ? m[1] : '';
  }

  function assetKind(path) {
    if (/\.prefab$/i.test(path)) return 'prefab';
    if (/\.unity$/i.test(path)) return 'scene';
    if (/\.asset$/i.test(path)) return 'scriptableObject';
    return 'asset';
  }

  function makeNode(key, kind, name, extra) {
    return Object.assign({
      sourceKey: key, kind: kind, name: name, fullName: name, namespace: '',
      baseTypes: [], guid: '', filePath: '', assembly: '', summary: '', note: '',
      tags: [], members: [], position: { x: 0, y: 0 }, visible: true,
      manual: false, color: ''
    }, extra || {});
  }

  /**
   * @param {Array<{path:string, content:string}>} files
   * @param {{rootPrefix?:string, maxFiles?:number, includePackages?:boolean, scope?:string}} options
   *   scope is accepted for compatibility but ignored: every scan now covers
   *   scripts + scene/prefab mounts + ScriptableObject asset instances.
   */
  function parseProject(files, options) {
    var opts = options || {};
    var t0 = Date.now();
    var warnings = [];
    var scope = 'standard';
    var fs = (Array.isArray(files) ? files : []).filter(function (f) {
      return f && typeof f.path === 'string' && typeof f.content === 'string' && shouldInclude(normalizePath(f.path, opts.rootPrefix));
    }).map(function (f) {
      return { path: normalizePath(f.path, opts.rootPrefix), content: f.content };
    });
    var maxFiles = opts.maxFiles || 20000;
    if (fs.length > maxFiles) {
      warnings.push({ type: 'limit', text: '文件数超过上限 ' + maxFiles + '，已截断' });
      fs = fs.slice(0, maxFiles);
    }
    if (!opts.includePackages) fs = fs.filter(function (f) { return f.path.indexOf('Packages/') !== 0; });

    var guidIndex = buildGuidIndex(fs);
    var guidByPath = Object.create(null);
    Object.keys(guidIndex).forEach(function (g) { guidByPath[guidIndex[g]] = g; });
    // 同一个 YAML 文件会被 SO / 预制体 / 主循环多次读取，文档切分只做一次。
    var docsCache = Object.create(null);
    function docsOf(f) {
      var d = docsCache[f.path];
      if (!d) d = docsCache[f.path] = parseYamlDocuments(f.content);
      return d;
    }
    var nodes = [], edges = [], nodeKeys = Object.create(null), nodeBySourceKey = Object.create(null);
    function pushNode(n) {
      if (!n.sourceKey || nodeKeys[n.sourceKey]) return null;
      nodeKeys[n.sourceKey] = true;
      nodeBySourceKey[n.sourceKey] = n;
      nodes.push(n);
      return n;
    }
    function pushEdge(fromKey, toKey, kind, sourceMember, label, targetMember, sourceComp) {
      if (!fromKey || !toKey || fromKey === toKey) return;
      // sourceComp 参与去重键：两个不同组件的同名字段（都叫 Data Base）是两条独立引用
      var key = 'auto:' + kind + ':' + fromKey + '>' + toKey + ':' + (sourceMember || '') + ':' + (sourceComp || '');
      edges.push({ sourceKey: key, fromKey: fromKey, toKey: toKey, kind: kind,
        sourceMember: sourceMember || '', label: label || '', targetMember: targetMember || '',
        sourceComp: sourceComp || '' });
    }

    // ---- C# types -------------------------------------------------------
    var csResults = [], typeBySimple = Object.create(null), typeByFull = Object.create(null);
    var csGuidToType = Object.create(null);
    var csFiles = fs.filter(function (f) { return /\.cs$/i.test(f.path); });
    csFiles.forEach(function (f) {
      var res = Cs.parseCsFile(f.path, f.content);
      csResults.push(res);
      (res.warnings || []).forEach(function (w) { warnings.push({ type: w.type, text: f.path + ': ' + w.text }); });
      res.types.forEach(function (t) {
        if (!typeBySimple[t.name]) typeBySimple[t.name] = t;
        else warnings.push({ type: 'duplicateType', text: t.name + ' 与 ' + typeBySimple[t.name].filePath + ' 重名' });
        typeByFull[t.fullName] = t;
      });
    });
    Object.keys(guidIndex).forEach(function (g) {
      var p = guidIndex[g];
      if (!/\.cs$/i.test(p)) return;
      var found = csResults.find(function (r) { return r.path === p && r.types.length; });
      if (found) {
        var baseName = p.split('/').pop().replace(/\.cs$/i, '');
        var main = found.types.find(function (t) { return t.name === baseName; }) || found.types[0];
        csGuidToType[g] = main.sourceKey;
      }
    });

    // 官方包脚本（Library/PackageCache）与任何 .cs.meta：guid → 脚本名（取自文件名）。
    // 组件清单里 m_Script 解析不出工程内脚本节点时用它回退，例如 EventSystem、StandaloneInputModule。
    var scriptNameByGuid = Object.create(null);
    fs.forEach(function (f) {
      if (!/\.cs\.meta$/i.test(f.path)) return;
      var m = META_RE.exec(String(f.content || ''));
      if (m) scriptNameByGuid[m[1].toLowerCase()] = f.path.split('/').pop().replace(/\.cs\.meta$/i, '');
    });

    // Combined method-body usage extraction needs the global view: declarations
    // and callers/subscribers usually live in different files.
    var eventNames = {}, methodNames = {}, fieldPropNames = {};
    csResults.forEach(function (res) {
      res.types.forEach(function (t) {
        t.members.forEach(function (m) {
          if (m.kind === 'event') eventNames[m.name] = true;
          else if (m.kind === 'method') methodNames[m.name] = true;
          else fieldPropNames[m.name] = true;
        });
      });
    });
    var resolveSimpleKey = function (simple) {
      var t = typeBySimple[simple] || typeByFull[simple];
      return t ? t.sourceKey : null;
    };
    var memberTypes = Object.create(null);
    csResults.forEach(function (res) {
      res.types.forEach(function (t) {
        var table = Object.create(null);
        t.members.forEach(function (m) { table[m.name] = m.type || m.returnType || ''; });
        memberTypes[t.sourceKey] = table;
      });
    });
    csResults.forEach(function (res) {
      res.types.forEach(function (t) {
        Cs.extractBodyUsages(t.members, t.sourceKey, {
          eventNames: eventNames, methodNames: methodNames, fieldPropNames: fieldPropNames,
          memberTypes: memberTypes, resolveSimple: resolveSimpleKey
        });
      });
    });

    // ---- asmdef: assembly info for the layered view (no graph nodes) ------
    // "Use GUIDs" mode: references entries are the guids of other .asmdef
    // assets (found in their .meta files), so we resolve them by name.
    var assemblies = [];
    var asmDirs = []; // { dir, name } for file-path → assembly mapping
    var asmRaws = [];
    fs.filter(function (f) { return /\.asmdef$/i.test(f.path); }).forEach(function (f) {
      var json;
      try {
        json = JSON.parse(String(f.content).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));
      } catch (e) {
        warnings.push({ type: 'asmdef', text: f.path + ' 不是合法 JSON' });
        return;
      }
      var name = json.name || f.path.split('/').pop().replace(/\.asmdef$/i, '');
      asmRaws.push({
        name: name,
        filePath: f.path,
        dir: f.path.replace(/[^/]+$/, ''),
        len: f.path.length - f.path.split('/').pop().length,
        ownGuid: (guidByPath[f.path] || '').toLowerCase(),
        refs: (Array.isArray(json.references) ? json.references : [])
          .map(function (r) { return String(r).replace(/^guid:/i, '').trim(); })
      });
    });
    var asmNameByGuid = Object.create(null);
    asmRaws.forEach(function (a) { if (a.ownGuid) asmNameByGuid[a.ownGuid] = a.name; });
    var GUID_RE = /^[0-9a-fA-F]{32}$/;
    asmRaws.forEach(function (a) {
      assemblies.push({
        name: a.name,
        filePath: a.filePath,
        refs: a.refs.map(function (r) {
          if (!GUID_RE.test(r)) return r; // plain assembly name
          return asmNameByGuid[r.toLowerCase()] || r;
        })
      });
      asmDirs.push({ dir: a.dir, name: a.name, len: a.len });
    });
    function asmNameForPath(p) {
      var best = null;
      asmDirs.forEach(function (d) {
        if (p.indexOf(d.dir) === 0 && (!best || d.len > best.len)) best = d;
      });
      return best ? best.name : '';
    }

    csResults.forEach(function (res) {
      res.types.forEach(function (t) {
        var isSO = t.baseTypes.indexOf('ScriptableObject') >= 0;
        var isMB = t.baseTypes.indexOf('MonoBehaviour') >= 0;
        var kind = t.kind === 'class' && isSO ? 'scriptableObject' : t.kind;
        var tags = [];
        if (isMB) tags.push('MonoBehaviour');
        if (isSO) tags.push('ScriptableObject');
        if (t.attributes.some(function (a) { return /DisallowMultipleComponent|RequireComponent/.test(a); })) tags.push('Component');
        pushNode(makeNode(t.sourceKey, kind, t.name, {
          fullName: t.fullName, namespace: t.namespace, baseTypes: t.baseTypes,
          outer: t.outer || '',
          filePath: t.filePath, tags: tags, assembly: asmNameForPath(t.filePath),
          members: t.members.map(function (m) {
            return {
              id: m.id, kind: m.kind, name: m.name, type: m.type, access: m.access,
              category: m.category, initialValue: m.initialValue, parameters: m.parameters,
              returnType: m.returnType, isStatic: m.isStatic, isSerialized: m.isSerialized,
              memberRefs: m.memberRefs || [],
              callTargets: m.callTargets || [],
              paramFlows: m.paramFlows || [],
              assignFlows: m.assignFlows || [],
              note: '', manual: false
            };
          })
        }));
      });
    });

    // 取容器类型最后一个顶层类型参数：Dictionary<string, TrackedRow> → 'TrackedRow'
    function lastTypeArg(inner) {
      var parts = [], depth = 0, start = 0;
      for (var i = 0; i < inner.length; i++) {
        var c = inner.charAt(i);
        if (c === '<' || c === '[') depth++;
        else if (c === '>') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
      }
      parts.push(inner.slice(start));
      var args = parts.map(function (x) { return x.trim(); }).filter(Boolean);
      return args.length ? args[args.length - 1] : '';
    }

    function resolveType(name) {
      var raw = typeByFull[name] || typeBySimple[name];
      if (raw) return raw;
      var stripped = String(name).replace(/<[\s\S]*$/, '').replace(/\[\s*\]$/, '').trim();
      var byStrip = typeBySimple[stripped] || null;
      if (byStrip) return byStrip;
      // 容器类型（List<T> / T[] / Dictionary<K,T>）解析失败时再试元素类型：
      // 引用容器等于引用其元素的数据类型。
      if (stripped !== name) {
        var m = /<([\s\S]*)>\s*\[\s*\]$|<([\s\S]*)>$/.exec(String(name));
        var el = m ? (m[1] || m[2]) : '';
        if (el) {
          var last = lastTypeArg(el);
          return (typeByFull[last] || typeBySimple[last]) || null;
        }
      }
      return null;
    }

    // ---- inheritance / type references ----------------------------------
    csResults.forEach(function (res) {
      res.types.forEach(function (t) {
        t.baseTypes.forEach(function (b) {
          var target = resolveType(b);
          if (!target) return;
          var kind = target.kind === 'interface' ? 'implement' : 'inherit';
          pushEdge(t.sourceKey, target.sourceKey, kind, '', b);
        });
        var seenEdges = Object.create(null);
        var isMB = t.baseTypes.indexOf('MonoBehaviour') >= 0;
        t.refs.forEach(function (r) {
          var target = resolveType(r.type);
          if (!target || target.sourceKey === t.sourceKey) return;
          var owner = t.members.find(function (m) { return m.id === r.memberId; });
          var kind = 'depend';
          if (r.relation === 'field') kind = (owner && (owner.isSerialized || (owner.access === 'public' && isMB))) ? 'serialize' : 'compose';
          else if (r.relation === 'aggregate') kind = 'aggregate';
          else if (r.relation === 'event') kind = 'event';
          else if (r.relation === 'param' || r.relation === 'return' || r.relation === 'depend' || r.relation === 'require') kind = 'depend';
          var key = t.sourceKey + '|' + target.sourceKey + '|' + kind + '|' + (r.memberId || '');
          if (seenEdges[key]) return;
          seenEdges[key] = true;
          pushEdge(t.sourceKey, target.sourceKey, kind, r.memberId || '', r.memberName || r.type);
        });
      });
    });

    // ---- ScriptableObject asset instances -------------------------------
    // A .asset file becomes a resource node only when its m_Script resolves to
    // a parsed script type; it then links to its class with a composition edge.
    var unknownGuids = Object.create(null);
    var unresolvedScriptComps = 0;
    var soAssetKeyByGuid = Object.create(null);
    fs.filter(function (f) { return /\.asset$/i.test(f.path); }).forEach(function (f) {
      var docs = docsOf(f);
      var doc = docs.find(function (d) { return scriptGuid(d.body); }) || docs[0];
      if (!doc) return;
      var sg = scriptGuid(doc.body);
      var typeKey = sg ? (csGuidToType[sg] || '') : '';
      if (!typeKey) {
        if (sg) unknownGuids[sg] = true;
        return;
      }
      var name = findScalar(doc.body, 'm_Name') || f.path.split('/').pop().replace(/\.asset$/i, '');
      var key = 'asset:' + f.path;
      pushNode(makeNode(key, 'scriptableObject', name, { filePath: f.path, guid: guidByPath[f.path] || '' }));
      pushEdge(key, typeKey, 'compose', '', 'SO 实例');
      var g = guidByPath[f.path];
      if (g) soAssetKeyByGuid[g.toLowerCase()] = key;
    });

    // ---- Unity YAML: scene / prefab mounts + serialized SO references ----
    // 预制体根对象索引：场景里的 PrefabInstance 通过 m_SourcePrefab 的 guid 指回它。
    var prefabRootByPath = Object.create(null), prefabRootByGuid = Object.create(null);
    fs.filter(function (f) { return /\.prefab$/i.test(f.path); }).forEach(function (f) {
      var pDocs = docsOf(f);
      var root = null;
      for (var pi = 0; pi < pDocs.length; pi++) {
        if (pDocs[pi].classId === '1' && !/m_CorrespondingSourceObject/.test(pDocs[pi].body)) { root = pDocs[pi]; break; }
      }
      if (!root) return;
      var rootKey = 'asset:' + f.path + '#' + root.fileId;
      prefabRootByPath[f.path] = rootKey;
      var pg = guidByPath[f.path];
      if (pg) prefabRootByGuid[pg.toLowerCase()] = rootKey;
    });

    var yamlFiles = fs.filter(function (f) { return /\.(prefab|unity|asset)$/i.test(f.path); });
    yamlFiles.forEach(function (f) {
      var isAssetFile = /\.asset$/i.test(f.path);
      var key = 'asset:' + f.path;
      var docs = docsOf(f);
      var docByFileId = Object.create(null);
      docs.forEach(function (d) {
        d.key = 'asset:' + f.path + '#' + d.fileId;
        docByFileId[d.fileId] = d;
      });

      var nodeByKey = Object.create(null);
      var compsByGo = Object.create(null);
      var compNameByFileId = Object.create(null);

      function goKeyOfDoc(doc) {
        if (!doc) return '';
        if (doc.classId === '1') return doc.aliasKey || doc.key;
        var gid = gameObjectId(doc.body);
        if (!gid) return '';
        var gdoc = docByFileId[gid];
        return gdoc ? (gdoc.aliasKey || gdoc.key) : '';
      }
      function parentGoKey(doc, depth) {
        if (!doc || depth > 4) return '';
        var m = /m_TransformParent:\s*\{\s*fileID:\s*(-?\d+)/.exec(doc.body);
        if (m) {
          var k = goKeyOfDoc(docByFileId[m[1]]);
          if (k) return k;
        }
        var inst = /m_PrefabInstance:\s*\{\s*fileID:\s*(-?\d+)/.exec(doc.body);
        if (inst && docByFileId[inst[1]]) return parentGoKey(docByFileId[inst[1]], depth + 1);
        return '';
      }
      var firstGoKey = '';
      docs.forEach(function (d) {
        if (!firstGoKey && d.classId === '1' && !/m_CorrespondingSourceObject/.test(d.body)) firstGoKey = d.key;
      });

      docs.forEach(function (d) {
        var name = findScalar(d.body, 'm_Name');
        var ownerKey = key;
        // 预制体实例里被 stripped 的文档：不单独建节点，记下它对应预制体里的哪个对象。
        var stripped = /m_CorrespondingSourceObject:\s*\{\s*fileID:\s*(-?\d+)[^}]*guid:\s*([0-9a-fA-F]{32})/.exec(d.body);
        if (stripped) {
          var sPath = guidIndex[stripped[2].toLowerCase()];
          d.aliasKey = sPath ? ('asset:' + sPath + '#' + stripped[1]) : '';
          return; // 实例上的组件与引用都属于预制体本体，不重复统计
        }
        // 预制体实例：场景对象 → 预制体根对象（compose · 预制体实例）
        if (d.classId === '1001') {
          var src = /m_SourcePrefab:\s*\{[^}]*guid:\s*([0-9a-fA-F]{32})/i.exec(d.body);
          var prefabRoot = src ? prefabRootByGuid[src[1].toLowerCase()] : '';
          var host = parentGoKey(d, 0) || firstGoKey || key;
          if (prefabRoot) pushEdge(host, prefabRoot, 'compose', '', '预制体实例');
          return;
        }
        if (d.classId === '1') { // GameObject
          ownerKey = d.key;
          var isPrefabRoot = prefabRootByPath[f.path] === d.key;
          var goNode = pushNode(makeNode(d.key, isPrefabRoot ? 'prefab' : 'gameObject', name || ('GameObject ' + d.fileId), {
            filePath: f.path, guid: '', tags: isPrefabRoot ? ['prefabRoot'] : [isAssetFile ? 'asset' : assetKind(f.path)]
          }));
          if (goNode) nodeByKey[d.key] = goNode;
        } else if ((d.classId === '114' || d.classId === '115') && !isAssetFile) { // 脚本组件
          var sg = scriptGuid(d.body);
          var typeKey = csGuidToType[sg] || '';
          var goId = gameObjectId(d.body);
          var goKey = goId ? (docByFileId[goId] ? docByFileId[goId].key : 'asset:' + f.path + '#' + goId) : key;
          if (typeKey) {
            // 脚本组件实例升为一等节点：GameObject -挂载→ 实例 -实例化→ 脚本类；
            // 实例序列化字段引用从实例出发，对象级与组件级关系自然分开。
            var clsNode = nodeBySourceKey[typeKey];
            var goDoc = goId ? docByFileId[goId] : null;
            var instKey = 'comp:' + f.path + '#' + d.fileId;
            var inst = pushNode(makeNode(instKey, 'component', clsNode ? clsNode.name : '', {
              filePath: f.path, guid: sg,
              members: clsNode ? clsNode.members.slice() : [],
              classKey: typeKey,
              mountedOn: goDoc ? (findScalar(goDoc.body, 'm_Name') || ('GameObject ' + goId)) : ''
            }));
            if (inst) {
              pushEdge(goKey, instKey, 'attach', '', '挂载 ' + inst.name);
              pushEdge(instKey, typeKey, 'instantiate', '', '实例化');
              ownerKey = instKey; // 序列化引用由「实例」持有，而不是GameObject
            }
          }
          if (ownerKey === key) ownerKey = goKey; // 未解析脚本（官方包/失效引用）：退回 GameObject 持有
        }
        // 组件清单：任何带 m_GameObject 的文档（Transform / Rigidbody / 自定义脚本…）
        var compGo = gameObjectId(d.body);
        if (compGo && !isAssetFile && d.classId !== '115') {
          var cname = CLASS_NAMES[d.classId] || ('Component(' + d.classId + ')');
          var cKey = '';
          var cIsScript = d.classId === '114';
          if (d.classId === '114') {
            var csg = scriptGuid(d.body);
            if (csg) {
              var ctKey = csGuidToType[csg] || '';
              if (ctKey) { cname = ctKey.split('#').pop().split('.').pop(); cKey = ctKey; }
              else cname = scriptNameByGuid[csg] || cname; // 官方包脚本（EventSystem 等）按 meta 文件名
            }
          }
          (compsByGo[compGo] = compsByGo[compGo] || []).push({
            type: cname, classId: d.classId, fileId: d.fileId,
            nodeKey: cKey, isScript: cIsScript, enabled: findScalar(d.body, 'm_Enabled') !== '0'
          });
          compNameByFileId[d.fileId] = cname; // fileID → 组件名：对象引用边要标出「被引用的具体组件」
          // 脚本组件没解析出名字（官方包脚本缺 PackageCache / 已删除脚本的失效引用）
          if (cIsScript && cname === 'MonoBehaviour') unresolvedScriptComps++;
        }
        // Serialized field references: `fieldName: {fileID: 0, guid: xxx}`.
        // Only script types and SO asset instances are followed; other resources
        // (textures, prefabs, audio...) are intentionally out of scope.
        FIELD_REF_RE.lastIndex = 0;
        var fr;
        // YAML 文档里绝大多数没有 guid/fileID 引用（地形、光照数据等），
        // 先用 indexOf 快速剪枝，避免在大文档上跑全量正则。
        if (d.body.indexOf('guid:') >= 0) {
          FIELD_REF_RE.lastIndex = 0;
          var fr;
          while ((fr = FIELD_REF_RE.exec(d.body)) !== null) {
            if (fr[1].indexOf('m_') === 0) continue; // m_Script & co are Unity plumbing
            var g = fr[2].toLowerCase();
            var targetKey = csGuidToType[g] || soAssetKeyByGuid[g] || null;
            if (!targetKey) {
              if (!guidIndex[g]) unknownGuids[g] = true;
              continue;
            }
            if (ownerKey === targetKey) continue;
            // 引用方组件名：标出「哪个脚本的哪个字段引用了它」
            pushEdge(ownerKey, targetKey, 'serialize', fr[1], fr[1], '',
              compNameByFileId[d.fileId] || CLASS_NAMES[d.classId] || '');
          }
        }
        // 同一文件内的对象引用（`fieldName: {fileID: 123}`）：指向别的 GameObject
        // 或它身上的组件时，落到那个 GameObject 上，标签用字段名，便于看对象间引用关系。
        if (d.body.indexOf('fileID:') >= 0) {
          FILE_REF_RE.lastIndex = 0;
          var rr;
          while ((rr = FILE_REF_RE.exec(d.body)) !== null) {
            if (rr[1].indexOf('m_') === 0) continue;
            var fid = rr[2];
            if (fid === '0' || fid === d.fileId || fid === compGo) continue;
            var targetDoc = docByFileId[fid];
            if (!targetDoc) continue;
            // 目标是已解析的脚本组件 → 直接连「目标组件实例」，组件级关系彻底分开
            if (targetDoc.classId === '114' || targetDoc.classId === '115') {
              var tTk = csGuidToType[scriptGuid(targetDoc.body)] || '';
              var tInstNode = tTk ? nodeBySourceKey['comp:' + f.path + '#' + fid] : null;
              if (tInstNode) {
                pushEdge(ownerKey, tInstNode.sourceKey, 'serialize', rr[1], rr[1], tInstNode.name,
                  compNameByFileId[d.fileId] || CLASS_NAMES[d.classId] || '');
                continue;
              }
            }
            var targetGoId = targetDoc.classId === '1' ? targetDoc.fileId : gameObjectId(targetDoc.body);
            if (!targetGoId || targetGoId === compGo) continue;
            var targetGoKey = targetDoc.aliasKey || ('asset:' + f.path + '#' + targetGoId);
            // fileID 直接指向组件（Transform / 脚本…）时，把组件名带上，环视图与追踪才能标出具体组件
            var tComp = targetDoc.classId === '1' ? '' :
              (compNameByFileId[fid] || CLASS_NAMES[targetDoc.classId] || '');
            pushEdge(ownerKey, targetGoKey, 'serialize', rr[1], rr[1], tComp,
              compNameByFileId[d.fileId] || CLASS_NAMES[d.classId] || '');
          }
        }
      });

      // 把组件清单挂到对应 GameObject 节点上（保持 YAML 文档顺序）。
      Object.keys(compsByGo).forEach(function (goId) {
        var n = nodeByKey['asset:' + f.path + '#' + goId];
        if (n) n.components = compsByGo[goId];
      });
    });

    // 同一脚本挂载在多个对象上时，实例名追加宿主对象名避免重名（PlayerMover @Player）
    var instByClass = Object.create(null);
    nodes.forEach(function (n) {
      if (n.kind !== 'component') return;
      (instByClass[n.classKey] = instByClass[n.classKey] || []).push(n);
    });
    Object.keys(instByClass).forEach(function (ck) {
      var list = instByClass[ck];
      if (list.length < 2) return;
      list.forEach(function (n) {
        n.name = n.fullName + ' @' + (n.mountedOn || '未命名');
      });
    });

    // Deduplicate edges by sourceKey.
    var seen = Object.create(null);
    edges = edges.filter(function (e) {
      if (seen[e.sourceKey]) return false;
      seen[e.sourceKey] = true;
      return true;
    }).filter(function (e) { return nodeKeys[e.fromKey] && nodeKeys[e.toKey]; });

    return {
      nodes: nodes,
      edges: edges,
      assemblies: assemblies,
      warnings: warnings,
      stats: {
        scope: scope,
        files: fs.length, csFiles: csFiles.length,
        types: csResults.reduce(function (a, r) { return a + r.types.length; }, 0),
        assets: yamlFiles.length,
        assemblies: assemblies.length,
        guidCount: Object.keys(guidIndex).length,
        unknownGuids: Object.keys(unknownGuids).length,
        unresolvedScriptComps: unresolvedScriptComps,
        nodes: nodes.length, edges: edges.length,
        elapsedMs: Date.now() - t0
      }
    };
  }

  return {
    normalizePath: normalizePath,
    parseProject: parseProject
  };
});
