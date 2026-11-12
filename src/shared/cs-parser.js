/* Lightweight C# structural parser: types, members, base types, type references. UMD.
   Intentionally dependency-free and tolerant of incomplete code. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.UA = root.UA || {}; root.UA.CsParser = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PRIMITIVES = new Set(['void', 'var', 'int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte',
    'float', 'double', 'decimal', 'bool', 'char', 'string', 'object', 'dynamic', 'nint', 'nuint']);
  var MODIFIERS = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const',
    'virtual', 'override', 'abstract', 'sealed', 'partial', 'new', 'async', 'extern', 'unsafe',
    'volatile', 'event', 'implicit', 'explicit', 'required', 'file', 'ref', 'in', 'out', 'params']);
  var CONTAINERS = new Set(['List', 'IList', 'IEnumerable', 'ICollection', 'IReadOnlyList', 'HashSet',
    'Dictionary', 'Queue', 'Stack', 'Array', 'T[]', 'IReadOnlyCollection', 'IReadOnlyDictionary']);
  var UNITY_EVENT = /^(UnityEvent|UnityEvent<|\bAction\b|\bFunc\b|\bdelegate\b)/;

  /** Replace comments and string/char literal contents with spaces, preserving offsets and newlines. */
  function stripLiterals(src) {
    if (typeof src !== 'string') return '';
    var out = src.split('');
    var i = 0, n = src.length;
    var blank = function (from, to) {
      for (var k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    };
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') {
        var end = src.indexOf('\n', i); if (end < 0) end = n;
        blank(i, end); i = end; continue;
      }
      if (c === '/' && d === '*') {
        var end2 = src.indexOf('*/', i + 2); if (end2 < 0) end2 = n; else end2 += 2;
        blank(i, end2); i = end2; continue;
      }
      if (c === '"' || c === "'" || (c === '@' && d === '"')) {
        var quoteAt = c === '@' ? i + 1 : i;
        var q = src[quoteAt], j = quoteAt + 1;
        if (c === '@') blank(i, i + 1);
        while (j < n) {
          if (src[j] === '\\' && c !== '@') { j += 2; continue; }
          if (src[j] === q) { if (c === '@' && src[j + 1] === q) { j += 2; continue; } j++; break; }
          j++;
        }
        blank(quoteAt + 1, j - 1);
        i = j; continue;
      }
      i++;
    }
    return out.join('');
  }

  /** Map every brace to its matching close brace, ignoring literals. */
  function braceMap(src) {
    var stack = [], pairs = Object.create(null);
    for (var i = 0; i < src.length; i++) {
      if (src[i] === '{') stack.push(i);
      else if (src[i] === '}' && stack.length) { var o = stack.pop(); pairs[o] = i; }
    }
    return pairs;
  }

  function splitTopLevel(text, sep) {
    var parts = [], depth = 0, start = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '(' || c === '[' || c === '<' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '>' || c === '}') depth = Math.max(0, depth - 1);
      else if (c === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function cleanType(t) {
    return String(t || '').replace(/\s+/g, ' ').trim()
      .replace(/\bwhere\b.*$/, '').replace(/\?/g, '').trim();
  }

  function extractTypeNames(typeExpr) {
    var names = [];
    var re = /[A-Za-z_]\w*/g, m;
    while ((m = re.exec(typeExpr || '')) !== null) {
      var w = m[0];
      if (PRIMITIVES.has(w) || MODIFIERS.has(w) || w === 'typeof' || w.length === 1) continue;
      if (names.indexOf(w) < 0) names.push(w);
    }
    return names;
  }

  function namespaceRanges(src) {
    var ranges = [], re = /\bnamespace\s+([A-Za-z_][\w.]*)\s*([{;])/g, m;
    var pairs = braceMap(src);
    while ((m = re.exec(src)) !== null) {
      var open = src.indexOf('{', m.index);
      if (m[2] === ';' || open < 0 || !Number.isFinite(pairs[open])) {
        ranges.push({ name: m[1], start: m.index, end: src.length });
      } else {
        ranges.push({ name: m[1], start: open, end: pairs[open] });
      }
    }
    return ranges;
  }

  function namespaceAt(ranges, pos) {
    var best = '', bestSpan = Infinity;
    ranges.forEach(function (r) {
      if (pos > r.start && pos < r.end && (r.end - r.start) < bestSpan) { best = r.name; bestSpan = r.end - r.start; }
    });
    return best;
  }

  function categoryFor(m) {
    if (m.kind === 'property') return 'property';
    if (m.kind === 'event') {
      return /UnityEvent/.test(m.type) ? 'unityEvent' : 'csharpEvent';
    }
    if (m.kind === 'method') {
      if (/IEnumerator/.test(m.returnType)) return 'coroutine';
      if (m.isStatic) return 'staticMethod';
      if (/virtual|abstract|override/.test(m.modifiers || '')) return 'virtualMethod';
      return 'method';
    }
    if (/^(const|static\s+const)/.test(m.modifiers || '')) return 'constant';
    if (m.kind === 'field' || m.kind === 'property') {
      // 自定义委托类型的字段（MyHandler/xxxDelegate/xxxCallback），Action/Func 已归入 event。
      if (/(Handler|Delegate|Callback)(<|$|\s)/.test(m.type || '')) return 'customDelegate';
    }
    if (m.isStatic) return 'staticField';
    if (m.isSerialized) return 'serializedField';
    return 'instanceField';
  }

  function parseMember(text, ownerKey, warnings, block) {
    var raw = text.trim();
    if (!raw || /^(class|interface|struct|enum|delegate|namespace|#|using|\[assembly)/.test(raw)) return null;
    function topLevelChar(s, ch) {
      var depth = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (c === '(' || c === '[' || c === '<' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '>' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === ch && depth === 0) return i;
      }
      return -1;
    }
    var attrs = [], attrRe = /^\s*\[([^\]]*)\]\s*/, am;
    while ((am = attrRe.exec(raw)) !== null) {
      attrs.push(am[1].trim());
      raw = raw.slice(am[0].length);
    }
    var isSerialized = /SerializeField|SerializeReference/.test(attrs.join(' '));

    var mods = [], modRe = /^\s*(public|private|protected|internal|static|readonly|const|virtual|override|abstract|sealed|partial|new|async|extern|unsafe|volatile|event)\b\s*/;
    var mm, isStatic = false, access = 'private', isEventKw = false;
    while ((mm = modRe.exec(raw)) !== null) {
      var w = mm[1];
      mods.push(w);
      if (w === 'static' || w === 'const') isStatic = true;
      if (w === 'event') isEventKw = true;
      if (['public', 'private', 'protected', 'internal'].indexOf(w) >= 0) access = w;
      raw = raw.slice(mm[0].length);
    }
    raw = raw.trim();
    if (!raw || raw === '}') return null;

    // Expression-bodied members (`M() => expr;` / `P => expr;`): splitMembers gives
    // them no block, so recover the body from the top-level `=>`. The char scan
    // stops at the first top-level '=', leaving `> expr` in the tail.
    var eqPos = topLevelChar(raw, '=');
    var initialValue = eqPos >= 0 ? raw.slice(eqPos + 1).trim() : '';
    var exprBody = '';
    if (/^>\s*/.test(initialValue)) {
      exprBody = initialValue.replace(/^>\s*/, '').replace(/;\s*$/, '').trim();
      initialValue = '';
    }
    var declText = (eqPos >= 0 ? raw.slice(0, eqPos) : raw).trim();
    var isMethod = declText.indexOf('(') >= 0 &&
      /^[A-Za-z_][\w<>,.?\[\]\s]*?\s+[A-Za-z_]\w*\s*(?:<[^>]*>)?\s*\(/.test(declText);
    var isProperty = !isMethod && (block ? /\b(get|set|init)\b/.test(block) : !!exprBody);
    var kind, name, type, returnType = 'void', parameters = '', refs = [];

    if (isMethod) {
      kind = 'method';
      var paren = declText.indexOf('(');
      var head = declText.slice(0, paren).trim();
      var close = findMatching(declText, paren, '(', ')');
      if (close < 0) return null;
      parameters = declText.slice(paren + 1, close).replace(/\s+/g, ' ').trim();
      var tail = declText.slice(close + 1).trim();
      var nameMatch = /([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*$/.exec(head);
      if (!nameMatch) return null;
      name = nameMatch[1];
      type = cleanType(head.slice(0, nameMatch.index));
      returnType = type || 'void';
      if (/where\s+/.test(tail)) tail = tail.split(/\bwhere\b/)[0].trim();
      void tail;
      extractTypeNames(parameters).forEach(function (t) { refs.push({ type: t, relation: 'param' }); });
      extractTypeNames(returnType).forEach(function (t) { refs.push({ type: t, relation: 'return' }); });
    } else {
      var parts = splitTopLevel(declText, ',');
      var first = parts[0] || '';
      var nm = /([A-Za-z_]\w*)\s*(?:\[\s*\])?\s*$/.exec(first);
      if (!nm) return null;
      name = nm[1];
      type = cleanType(first.slice(0, nm.index) + (/\]\s*$/.test(first.slice(0, nm.index)) ? '[]' : ''));
      if (!type) type = 'var';
      var container = Array.from(CONTAINERS).some(function (c) { return type.indexOf(c) === 0; }) || /\[\s*\]\s*$/.test(first);
      kind = isEventKw || UNITY_EVENT.test(type) ? 'event' : (isProperty ? 'property' : 'field');
      extractTypeNames(type).forEach(function (t) {
        refs.push({ type: t, relation: kind === 'event' ? 'event' : (container ? 'aggregate' : 'field') });
      });
      if (parts.length > 1) {
        parts.slice(1).forEach(function (p) {
          var extra = /^\s*([A-Za-z_]\w*)/.exec(p);
          if (extra) warnings.push({ type: 'multiField', text: name + ', ' + extra[1] });
        });
      }
    }

    var member = {
      id: 'mem:' + ownerKey + '#' + kind + ':' + name,
      kind: kind, name: name, type: type, access: access,
      initialValue: initialValue, parameters: parameters, returnType: returnType,
      isStatic: isStatic, isSerialized: isSerialized,
      attributes: attrs, modifiers: mods.join(' '), manual: false,
      note: ''
    };
    member.category = categoryFor(member);
    // Method bodies and property accessor bodies are scanned once per project
    // by extractBodyUsages (cross-file, needs the global member-name index).
    if ((isMethod || isProperty) && (block || exprBody)) member._body = block || exprBody;
    return { member: member, refs: refs };
  }

  var WRITE_OP = '(?:\\+=|-=|\\*=|/=|%=|\\|=|&=|\\^=|<<=|>>=|=(?!=))';

  /** Walk left over an identifier/dot/?. chain and return the receiver expression (no trailing dot). */
  function receiverChain(body, idx) {
    var end = idx;
    while (end > 0 && /[A-Za-z0-9_?]/.test(body[end - 1])) end--;
    // The chain may end right at the token (no dot) — walk left only through dots.
    var start = end;
    while (start > 1 && body[start - 1] === '.') {
      var s2 = start - 1;
      while (s2 > 0 && /[A-Za-z0-9_?]/.test(body[s2 - 1])) s2--;
      if (s2 >= start - 1) break;
      start = s2;
    }
    var text = body.slice(start, end).replace(/\?\s*\./g, '.').replace(/\s+/g, '').replace(/\.$/, '');
    return { expr: text, dotted: start < end };
  }

  function snippetOf(body, idx) {
    var ls = body.lastIndexOf('\n', idx) + 1;
    var le = body.indexOf('\n', idx);
    if (le < 0) le = body.length;
    return body.slice(ls, le).replace(/\s+/g, ' ').trim().slice(0, 96);
  }

  /**
   * Combined method-body scan (runs once per project, in unity-parser).
   * Produces Visual-Studio-style "find all references" records plus data-flow hints.
   *
   * ctx = {
   *   eventNames:     { name: true }   all event members project-wide
   *   methodNames:    { name: true }   all method members project-wide
   *   fieldPropNames: { name: true }   all field/property members project-wide
   *   memberTypes:    { typeKey: { memberName: declaredTypeText } }
   *   resolveSimple:  simpleName -> typeKey | null
   * }
   *
   * Stored on the containing member (method or property accessor) as
   * memberRefs = [{ type, name, action, via, snippet }]:
   * - type   : typeKey of the class whose member is referenced, when the receiver
   *            chain resolves (`db.State.Changed` → G1State); '' = name-only match.
   * - action : read | write | call | fire | subscribe | unsubscribe
   * - via    : receiver expression text ('db.State')
   * - snippet: the source line, for the VS-style reference list.
   * Also keeps paramFlows / assignFlows / callTargets for the data-flow graph.
   */
  function extractBodyUsages(members, owner, ctx) {
    ctx = ctx || {};
    var eventNames = ctx.eventNames || {};
    var methodNames = ctx.methodNames || {};
    var fieldPropNames = ctx.fieldPropNames || {};
    var resolveSimple = ctx.resolveSimple || function () { return null; };
    var memberTypes = ctx.memberTypes || {};
    var fieldsByName = Object.create(null);
    members.forEach(function (m) {
      if (m.kind === 'field' || m.kind === 'property') {
        fieldsByName[m.name] = String(m.type || '').replace(/<.*$/, '').replace(/\[\s*\]$/, '').trim();
      }
    });
    var ownerTable = memberTypes[owner] || null;

    /** Resolve a dotted receiver chain (e.g. db.State) to the type of the whole expression. */
    function resolveChain(tokens) {
      var tKey = null;
      for (var i = 0; i < tokens.length; i++) {
        if (i === 0) {
          var t0 = fieldsByName[tokens[0]];
          tKey = t0 ? resolveSimple(t0) : resolveSimple(tokens[0]); // field or static type
          if (!tKey) return null;
        } else {
          var table = memberTypes[tKey];
          var declared = table ? table[tokens[i]] : '';
          if (!declared) return null;
          tKey = resolveSimple(String(declared).replace(/<.*$/, '').replace(/\[\s*\]$/, '').trim());
          if (!tKey) return null;
        }
      }
      return tKey;
    }

    members.forEach(function (mm) {
      var body = mm._body;
      delete mm._body;
      if (!body || (mm.kind !== 'method' && mm.kind !== 'property')) return;
      var params = splitTopLevel(String(mm.parameters || ''), ',').map(function (pp) {
        var ids = pp.match(/[A-Za-z_]\w*/g);
        return ids && ids.length ? ids[ids.length - 1] : '';
      }).filter(Boolean);
      var isParam = function (n) { return params.indexOf(n) >= 0; };
      var isField = function (n) { return fieldsByName[n] !== undefined; };

      var refs = [], seen = Object.create(null);
      function push(type, name, action, via, snippet) {
        var k = type + '|' + name + '|' + action;
        if (seen[k]) return;
        seen[k] = true;
        refs.push({ type: type, name: name, action: action, via: via || '', snippet: snippet || '' });
      }

      var tokenRe = /\b[A-Za-z_]\w*\b/g;
      var tm;
      while ((tm = tokenRe.exec(body)) !== null) {
        var name = tm[0];
        var isEvt = !!eventNames[name], isMth = !!methodNames[name], isFld = !!fieldPropNames[name];
        if (!isEvt && !isMth && !isFld) continue;
        var idx = tm.index;
        var chain = receiverChain(body, idx);
        var after = body.slice(idx + name.length);
        var snip = snippetOf(body, idx);

        // Attribute the reference to a declaring class when the receiver resolves.
        // （receiverChain.expr 已是不含最后成员的接收者表达式；解析不到类型的
        // 引用 type 为空串，trace/refCount/导出层一律不计入，避免同名误报。）
        var type = '';
        if (chain.dotted && chain.expr) {
          type = resolveChain(chain.expr.split('.')) || '';
        } else if (isField(name) || (ownerTable && ownerTable[name])) {
          type = owner; // bare member of this class (this.x, own methods, own events)
        }
        var via = chain.dotted ? chain.expr : '';

        var writeOp = /^\s*(\+\+|--)/.test(after) ||
          /^\s*(?:\+=|-=|\*=|\/=|%=|\|=|&=|\^=|<<=|>>=|=(?!=))/.test(after);
        var fireCall = /^\s*(?:\?\s*\.|\.)\s*Invoke\s*\(/.test(after);
        var directCall = /^\s*\(/.test(after);
        var plusMinus = /^\s*(\+=|-)/.exec(after);

        if (plusMinus && isEvt) {
          push(type, name, plusMinus[1][0] === '+' ? 'subscribe' : 'unsubscribe', via, snip);
        } else if (writeOp && isFld) {
          push(type, name, 'write', via, snip);
        } else if (fireCall && isEvt) {
          push(type, name, 'fire', via, snip);
        } else if (directCall) {
          if (isMth) push(type, name, 'call', via, snip);
          else if (isEvt) push(type, name, 'fire', via, snip);
        } else if (isFld) {
          push(type, name, 'read', via, snip);
        } else if (isMth) {
          push(type, name, 'read', via, snip); // method group (e.g. += Refresh)
        }
      }
      if (refs.length) mm.memberRefs = refs;

      if (mm.kind !== 'method') return;

      // ---- data-flow extraction (kept for the multi-hop flow graph) --------
      var paramFlows = [], assignFlows = [], calls = [];
      // Calls: receiver.Method(args) with resolvable receiver; argument names kept
      // so the flow tracer can follow values passed into another class.
      var callRe = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
      var cm;
      while ((cm = callRe.exec(body)) !== null) {
        var ct = fieldsByName[cm[1]];
        if (!ct) continue;
        var ctKey = resolveSimple(ct);
        if (!ctKey) continue;
        var openParen = cm.index + cm[0].length - 1;
        var closeParen = findMatching(body, openParen, '(', ')');
        if (closeParen < 0) continue;
        var argNames = splitTopLevel(body.slice(openParen + 1, closeParen), ',').map(function (a) {
          var simple = /^this\s*\.\s*([A-Za-z_]\w*)$/.exec(a) || /^([A-Za-z_]\w*)$/.exec(a);
          var nm = simple ? simple[1] : '';
          return (nm && (isField(nm) || isParam(nm))) ? nm : '';
        });
        if (!argNames.some(Boolean)) continue;
        var sig = ctKey + '#' + cm[2] + '#' + argNames.join('|');
        if (calls.some(function (c) { return c._sig === sig; })) continue;
        calls.push({ type: ctKey, member: cm[2], via: cm[1], args: argNames, _sig: sig });
      }
      // Data flow 1: `field = param` — an inbound argument stored into this class.
      var paramFlowRe = /\b(?:this\s*\.\s*)?([A-Za-z_]\w*)\s*=(?!=)\s*(?:this\s*\.\s*)?([A-Za-z_]\w*)\s*[;,}]/g;
      var fm;
      while ((fm = paramFlowRe.exec(body)) !== null) {
        var lhs = fm[1], rhs = fm[2];
        if (lhs === rhs) continue;
        if (isField(lhs) && isParam(rhs) && !isField(rhs)) {
          if (!paramFlows.some(function (f) { return f.param === rhs && f.field === lhs; })) {
            paramFlows.push({ param: rhs, field: lhs });
          }
        }
      }
      // Data flow 2: `receiver.field = fieldOrParam` — a value handed to another object.
      var crossAssignRe = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=(?!=)\s*(?:this\s*\.\s*)?([A-Za-z_]\w*)\s*[;,}]/g;
      var xm;
      while ((xm = crossAssignRe.exec(body)) !== null) {
        var xr = fieldsByName[xm[1]];
        if (!xr) continue;
        var xrKey = resolveSimple(xr);
        if (!xrKey || xrKey === owner) continue;
        var src = xm[3];
        if (!isField(src) && !isParam(src)) continue;
        if (assignFlows.some(function (f) { return f.from === src && f.type === xrKey && f.to === xm[2]; })) continue;
        assignFlows.push({ from: src, type: xrKey, to: xm[2] });
      }

      if (calls.length) {
        calls.forEach(function (c) { delete c._sig; });
        mm.callTargets = calls;
      }
      if (paramFlows.length) mm.paramFlows = paramFlows;
      if (assignFlows.length) mm.assignFlows = assignFlows;
    });
  }

  function findMatching(text, openAt, open, close) {
    var depth = 0;
    for (var i = openAt; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  /** Split a class body into member declarations, skipping nested block bodies. */
  function splitMembers(body) {
    var out = [], buf = '', depth = 0;
    for (var i = 0; i < body.length; i++) {
      var c = body[i];
      if (c === '{') {
        depth++;
        if (depth === 1) {
          var header = buf.trim();
          buf = '';
          // Find the matching close brace and skip its contents.
          var close = findMatching(body, i, '{', '}');
          if (close < 0) break;
          var inner = body.slice(i + 1, close);
          if (header) out.push({ text: header, block: inner });
          i = close; depth = 0;
          continue;
        }
        continue;
      }
      if (c === ';') {
        var stmt = buf.trim();
        if (stmt) out.push({ text: stmt, block: '' });
        buf = '';
        continue;
      }
      if (depth === 0) buf += c;
    }
    if (buf.trim()) out.push({ text: buf.trim(), block: '' });
    return out;
  }

  function parseCsFile(path, content) {
    var warnings = [];
    var src = stripLiterals(String(content || ''));
    var pairs = braceMap(src);
    var nsRanges = namespaceRanges(src);
    var typeRe = /\b(class|interface|struct|enum)\s+([A-Za-z_]\w*)\s*(?:<([^<>]*(?:<[^<>]*>[^<>]*)*)>)?\s*(?::\s*([^{;]+?))?\s*\{/g;
    var types = [], m;
    var usedKeys = Object.create(null);
    var normPath = String(path || '').replace(/\\/g, '/');

    while ((m = typeRe.exec(src)) !== null) {
      var open = src.lastIndexOf('{', m.index + m[0].length - 1);
      var close = pairs[open];
      if (!Number.isFinite(close)) { warnings.push({ type: 'unbalanced', text: m[2] }); continue; }
      // Skip types nested inside another type body.
      var nested = types.some(function (t) { return m.index > t._start && m.index < t._end; });
      if (nested) { warnings.push({ type: 'nestedType', text: m[2] }); continue; }
      var ns = namespaceAt(nsRanges, m.index);
      var fullName = ns ? ns + '.' + m[2] : m[2];
      var kind = m[1] === 'interface' ? 'interface' : (m[1] === 'struct' ? 'struct' : (m[1] === 'enum' ? 'enum' : 'class'));
      var key = 'cs:' + normPath + '#' + fullName;
      if (usedKeys[key]) continue;
      usedKeys[key] = true;

      var baseTypes = [];
      var baseRaw = (m[4] || '').split(/\bwhere\b/)[0];
      splitTopLevel(baseRaw, ',').forEach(function (b) {
        var clean = cleanType(b).replace(/<[^>]*>/g, '').trim();
        var nm2 = /([A-Za-z_]\w*)\s*$/.exec(clean);
        if (nm2 && nm2[1] !== m[2]) baseTypes.push(nm2[1]);
      });
      var attrStart = Math.max(0, src.lastIndexOf('}', m.index - 1) + 1);
      var prefix = src.slice(Math.max(0, m.index - 220), m.index);
      var typeAttrs = [];
      var ar = /\[([^\]]*)\]/g, am2;
      while ((am2 = ar.exec(prefix)) !== null) typeAttrs.push(am2[1].trim());
      void attrStart;

      var body = src.slice(open + 1, close);
      var members = [], refs = [];
      splitMembers(body).forEach(function (stmt) {
        var parsed = parseMember(stmt.text, key, warnings, stmt.block);
        if (!parsed) return;
        members.push(parsed.member);
        parsed.refs.forEach(function (r) {
          refs.push({ type: r.type, relation: r.relation, memberId: parsed.member.id, memberName: parsed.member.name });
        });
      });
      // Event usages are extracted project-wide by unity-parser (cross-file).
      typeAttrs.forEach(function (a) {
        var tm = /typeof\s*\(\s*([A-Za-z_]\w*)/.exec(a);
        if (tm) extractTypeNames(tm[1]).forEach(function (t) {
          refs.push({ type: t, relation: 'require', memberId: '', memberName: '' });
        });
      });
      // Method bodies: GetComponent<T>() / FindObjectOfType<T>() style runtime lookups.
      var callRe = /\b(?:GetComponent|AddComponent|FindObjectOfType|FindFirstObjectByType|GetComponentInChildren|GetComponentInParent|RequireComponent)\s*<([A-Za-z_]\w*)>/g;
      var cm;
      while ((cm = callRe.exec(body)) !== null) refs.push({ type: cm[1], relation: 'depend', memberId: '', memberName: '' });
      var callRe2 = /\b(?:GetComponent|AddComponent|FindObjectOfType)\s*\(\s*typeof\s*\(\s*([A-Za-z_]\w*)/g;
      while ((cm = callRe2.exec(body)) !== null) refs.push({ type: cm[1], relation: 'depend', memberId: '', memberName: '' });

      types.push({
        sourceKey: key, name: m[2], fullName: fullName, namespace: ns, kind: kind,
        filePath: normPath, baseTypes: baseTypes, attributes: typeAttrs,
        members: members, refs: refs, _start: open, _end: close
      });
      typeRe.lastIndex = close + 1;
    }
    types.forEach(function (t) { delete t._start; delete t._end; });
    return { path: normPath, types: types, warnings: warnings };
  }

  return {
    parseCsFile: parseCsFile,
    extractBodyUsages: extractBodyUsages
  };
});
