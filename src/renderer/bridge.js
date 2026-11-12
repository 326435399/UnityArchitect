/* Browser bridge: real Unity project directory binding, auto re-scan and drag & drop.
   Works from file://, localhost and embedded previews. No native shell required. */
(function (root) {
  'use strict';
  var desktop = root.UADesktop || null; // kept for compatibility, not required
  // Single scan set: scripts + scene/prefab mounts + ScriptableObject assets
  // (+ .meta for GUID resolution). Unity's own infrastructure never enters.
  var SCAN_EXT = /\.(cs|meta|prefab|unity|asset|asmdef)$/i;
  var IGNORED_DIR = /^(Library|Temp|obj|Logs|UserSettings|ProjectSettings|Packages|PackagesCache|Recordings|\.git|\.vs|\.idea|\.plastic|\.svn|Build|Builds|MemoryCaptures|node_modules)$/i;
  var MAX_FILES = 20000;
  var MAX_BYTES = 48 * 1024 * 1024;
  var MAX_FILE_BYTES = 3 * 1024 * 1024;
  var HANDLE_KEY = 'unityRoot';
  var LS_KEY = 'ua.linkedDir';
  var dropHandlers = [];
  var memoryHandle = null;

  // Some browsers disable IndexedDB on file://; keep at least the binding name visible.
  function rememberName(name) {
    try { root.localStorage.setItem(LS_KEY, JSON.stringify({ name: name || 'Unity 工程', at: Date.now() })); }
    catch (e) { /* storage unavailable */ }
  }
  function remembered() {
    try {
      var v = JSON.parse(root.localStorage.getItem(LS_KEY) || 'null');
      return v && v.name ? v : null;
    } catch (e) { return null; }
  }

  function toast(message, ms) {
    try { if (root.UA && root.UA.UI && root.UA.UI.toast) root.UA.UI.toast(message, ms || 2600); }
    catch (e) { /* UI not ready */ }
  }
  function scanError(message, hint) {
    var err = new Error(message);
    err.scanHint = hint || '';
    return err;
  }
  function isIgnored(name) { return IGNORED_DIR.test(String(name || '')); }
  function isText(name) {
    return SCAN_EXT.test(String(name || ''));
  }

  /** Normalize a relative path so the parser always sees Assets/... or Packages/... */
  function toAssetPath(rel, rootName) {
    var s = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    var rn = String(rootName || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (rn && s.indexOf(rn + '/') === 0) s = s.slice(rn.length + 1);
    if (/^(assets|packages)$/i.test(rn)) s = rn + '/' + s;
    var idx = s.search(/(?:^|\/)(Assets|Packages)\//i);
    if (idx > 0) s = s.slice(idx + 1);
    return s;
  }

  function newState() {
    return { files: [], bytes: 0, pkgCount: 0, pkgBytes: 0, skipped: 0, truncated: false, lastNotice: 0 };
  }
  function addFile(state, path, size, text) {
    if (size > MAX_FILE_BYTES) { state.skipped++; return; }
    if (state.files.length >= MAX_FILES || state.bytes + size > MAX_BYTES) {
      state.truncated = true; return;
    }
    state.files.push({ path: path, content: text });
    state.bytes += size;
    if (state.files.length % 1200 === 0) toast('已读取 ' + state.files.length + ' 个文件…', 1200);
  }
  // 官方包脚本的 .cs.meta（每个不到 1KB）不计入 48MB 预算、不受主扫描截断影响：
  // 否则大工程（Assets > 48MB）会把预算耗尽，PackageCache 补读被 enough() 短路，
  // EventSystem / StandaloneInputModule 等组件就全部退化成 MonoBehaviour。
  var MAX_PKG_METAS = 12000;
  function addPkgMeta(state, path, size, text) {
    if (state.pkgCount >= MAX_PKG_METAS) return;
    state.pkgCount++;
    state.pkgBytes += size;
    state.files.push({ path: path, content: text });
  }
  function enough(state) { return state.files.length >= MAX_FILES || state.bytes >= MAX_BYTES; }

  function filesToResult(state, rootName, mode) {
    if (!state.files.length) {
      throw scanError('目录里没有可解析的文件',
        '请选择包含 Assets 文件夹的 Unity 工程根目录，或直接把 Assets 文件夹拖进窗口。支持 .cs / .prefab / .unity / .asset / .meta / .asmdef。');
    }
    // PackageCache 的 meta 先入队：排在 state.files 前部，
    // 即使工程文件数超过解析器上限也不会被截断丢掉。
    var pkg = [], rest = [];
    state.files.forEach(function (f) { (PKG_META_RE.test(f.path) ? pkg : rest).push(f); });
    var files = pkg.concat(rest).map(function (f) {
      return { path: toAssetPath(f.path, rootName), content: f.content };
    });
    if (!root.UA || !root.UA.UnityParser) throw scanError('解析器未加载', '请重新打开本 HTML 文件。');
    var parsed = root.UA.UnityParser.parseProject(files, {});
    if (!parsed || !parsed.nodes || !parsed.nodes.length) {
      throw scanError('解析完成但没有生成任何节点',
        '读到了 ' + files.length + ' 个文本文件，但没有识别出类型或资源。请确认选择的是 Unity 工程的 Assets 目录及其 .meta 文件。');
    }
    parsed.stats.scannedBytes = state.bytes + (state.pkgBytes || 0);
    parsed.stats.skippedFiles = state.skipped;
    parsed.stats.truncated = state.truncated;
    return {
      parsed: parsed, rootPath: rootName || 'Unity 工程', mode: mode,
      truncated: state.truncated, linked: mode === 'fsa'
    };
  }

  /* ---------- File System Access API (Chrome / Edge) ------------------- */
  async function readFsaHandle(handle, base, state) {
    var iter = handle.entries ? handle.entries() : handle.values();
    for await (var pair of iter) {
      if (enough(state)) { state.truncated = true; break; }
      var name, child;
      if (Array.isArray(pair)) { name = pair[0]; child = pair[1]; }
      else { name = pair.name; child = pair; }
      if (child.kind === 'directory') {
        if (isIgnored(name)) continue;
        await readFsaHandle(child, base + name + '/', state);
      } else if (child.kind === 'file' && isText(name, state)) {
        var file = await child.getFile();
        var size = typeof file.size === 'number' ? file.size : 0;
        if (size > MAX_FILE_BYTES || state.bytes + size > MAX_BYTES) { state.skipped++; continue; }
        var text = await file.text();
        addFile(state, base + name, size, text);
      }
    }
  }
  function scanHandle(handle) {
    var state = newState();
    var rootName = handle.name || 'Unity 工程';
    // 先读 PackageCache 的 .cs.meta（小文件），再扫 Assets 等，顺序保证官方脚本 GUID 一定入列。
    return Promise.resolve(scanPackageCacheFsa(handle, state))
      .then(function () { return readFsaHandle(handle, rootName + '/', state); })
      .then(function () { return filesToResult(state, rootName, 'fsa'); })
      .catch(function (e) {
        if (e && e.scanHint) throw e;
        throw scanError('读取目录失败：' + (e && e.message ? e.message : e),
          '请确认目录可访问，或改用「选择文件夹（兼容模式）」/ 直接拖入文件夹。');
      });
  }

  /* ---------- handle persistence (IndexedDB + in-memory fallback) ----- */
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('no-idb'));
      var req;
      try { req = root.indexedDB.open('ua-directory', 1); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        try { req.result.createObjectStore('handles'); } catch (e) { /* exists */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
      req.onblocked = function () { reject(new Error('idb-blocked')); };
    });
  }
  function saveHandle(handle) {
    memoryHandle = handle;
    rememberName(handle.name);
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, HANDLE_KEY);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
        tx.onabort = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; }); // memoryHandle still works this session
  }
  function loadHandle() {
    if (memoryHandle) return Promise.resolve(memoryHandle);
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('handles', 'readonly');
        var req = tx.objectStore('handles').get(HANDLE_KEY);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function clearHandle() {
    memoryHandle = null;
    try { root.localStorage.setItem(LS_KEY, ''); } catch (e) { /* storage unavailable */ }
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete(HANDLE_KEY);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }
  function linkedDir() {
    if (desktop) return Promise.resolve(null);
    return loadHandle().then(function (h) {
      if (!h) {
        var memo = remembered();
        return memo ? { name: memo.name, granted: false, permission: 'needs-rebind', ephemeral: true } : null;
      }
      var p = h.queryPermission ? h.queryPermission({ mode: 'read' }) : 'granted';
      return Promise.resolve(p).then(function (perm) {
        return { name: h.name || 'Unity 工程', granted: perm === 'granted', permission: perm };
      });
    }).catch(function () {
      var memo = remembered();
      return memo ? { name: memo.name, granted: false, permission: 'needs-rebind', ephemeral: true } : null;
    });
  }
  function rescanLinked() {
    return loadHandle().then(function (h) {
      if (!h) {
        var memo = remembered();
        throw scanError(memo ? '浏览器未保留「' + memo.name + '」的目录授权' : '尚未绑定 Unity 工程目录',
          memo ? '请点「扫描 Unity 工程」重新授权一次，或直接把工程文件夹拖入窗口。'
            : '先点「扫描 Unity 工程」选一次目录，之后打开本页就会自动重新读取。');
      }
      var p = h.queryPermission ? h.queryPermission({ mode: 'read' }) : 'granted';
      return Promise.resolve(p).then(function (perm) {
        if (perm !== 'granted') {
          throw scanError('目录读取授权已失效', '请再点一次「扫描 Unity 工程」重新授权，或直接把工程文件夹拖入窗口。');
        }
        toast('正在自动重新读取：' + (h.name || 'Unity 工程') + ' …');
        return scanHandle(h);
      });
    });
  }

  /* ---------- Library/PackageCache: official package script GUIDs -------- */
  /* 只读 *.cs.meta（每个不到 1KB），把官方包脚本（EventSystem、StandaloneInputModule
     等）的 GUID 解析成真实脚本名，组件清单不再显示一排 MonoBehaviour。 */
  var PKG_META_RE = /(?:^|\/)Library\/(?:PackageCache|UnityPackageCache)\/.+\.cs\.meta$/i;
  async function readPkgMetaFsa(dirHandle, base, state) {
    var iter = dirHandle.entries ? dirHandle.entries() : dirHandle.values();
    for await (var pair of iter) {
      var name = Array.isArray(pair) ? pair[0] : pair.name;
      var child = Array.isArray(pair) ? pair[1] : pair;
      if (child.kind === 'directory') await readPkgMetaFsa(child, base + name + '/', state);
      else if (child.kind === 'file' && /\.cs\.meta$/i.test(name)) {
        var file = await child.getFile();
        var text = await file.text();
        addPkgMeta(state, base + name, file.size, text);
      }
    }
  }
  async function scanPackageCacheFsa(rootHandle, state) {
    try {
      var lib = await rootHandle.getDirectoryHandle('Library');
      var pc = await lib.getDirectoryHandle('PackageCache');
      await readPkgMetaFsa(pc, 'Library/PackageCache/', state);
    } catch (e) { /* 没有 Library（只选了 Assets）时静默跳过 */ }
  }
  function readPkgMetaEntry(dirEntry, base, state) {
    return new Promise(function (resolve) {
      if (!dirEntry || typeof dirEntry.createReader !== 'function') return resolve();
      var reader = dirEntry.createReader();
      var all = [];
      (function batch() {
        reader.readEntries(function (list) {
          if (!list || !list.length) {
            Promise.all(all.map(function (e) {
              if (e.isDirectory) return readPkgMetaEntry(e, base + e.name + '/', state);
              if (e.isFile && /\.cs\.meta$/i.test(e.name)) {
                return new Promise(function (res) {
                  e.file(function (f) {
                    Promise.resolve(f.text()).then(function (t) { addPkgMeta(state, base + e.name, f.size, t); res(); }, res);
                  }, res);
                });
              }
              return Promise.resolve();
            })).then(resolve, resolve);
            return;
          }
          all = all.concat(Array.prototype.slice.call(list));
          batch();
        }, resolve);
      })();
    });
  }
  function scanPackageCacheEntry(rootEntry, state) {
    return new Promise(function (resolve) {
      if (!rootEntry || !rootEntry.isDirectory || typeof rootEntry.getDirectory !== 'function') return resolve();
      rootEntry.getDirectory('Library', { create: false }, function (lib) {
        lib.getDirectory('PackageCache', { create: false }, function (pc) {
          readPkgMetaEntry(pc, 'Library/PackageCache/', state).then(resolve, resolve);
        }, function () { resolve(); });
      }, function () { resolve(); });
    });
  }

  /* ---------- drag & drop a whole folder ------------------------------ */
  function readEntry(entry, base, state) {
    return new Promise(function (resolve) {
      if (!entry || enough(state)) { if (entry && enough(state)) state.truncated = true; return resolve(); }
      if (entry.isFile) {
        if (!isText(entry.name)) return resolve();
        entry.file(function (f) {
          var size = typeof f.size === 'number' ? f.size : 0;
          if (size > MAX_FILE_BYTES || state.bytes + size > MAX_BYTES) { state.skipped++; return resolve(); }
          Promise.resolve(f.text()).then(function (text) {
            addFile(state, base + entry.name, size, text); resolve();
          }).catch(resolve);
        }, resolve);
      } else if (entry.isDirectory) {
        if (isIgnored(entry.name)) return resolve();
        var reader = entry.createReader();
        var all = [];
        function batch() {
          reader.readEntries(function (list) {
            if (!list || !list.length) {
              Promise.all(all.map(function (e) {
                return readEntry(e, base + entry.name + '/', state);
              })).then(resolve, resolve);
              return;
            }
            all = all.concat(Array.prototype.slice.call(list));
            batch();
          }, resolve);
        }
        batch();
      } else resolve();
    });
  }
  function scanEntries(entries) {
    var state = newState();
    var rootName = entries.length === 1 && entries[0].isDirectory ? entries[0].name : '';
    // 拖拽路径同样先读 PackageCache，避免主目录扫描截断后丢掉官方脚本 GUID。
    return Promise.resolve(
        entries.length === 1 && entries[0].isDirectory ? scanPackageCacheEntry(entries[0], state) : null)
      .then(function () { return Promise.all(entries.map(function (e) { return readEntry(e, '', state); })); })
      .then(function () { return filesToResult(state, rootName, 'drop'); })
      .catch(function (e) {
        if (e && e.scanHint) throw e;
        throw scanError('读取拖入内容失败：' + (e && e.message ? e.message : e),
          '请拖入完整的 Unity 工程文件夹（含 Assets），或点「扫描 Unity 工程」选择目录。');
      });
  }
  function setDropOverlay(show) {
    try {
      var el = root.document && root.document.getElementById('drop-overlay');
      if (el) el.classList.toggle('hidden', !show);
    } catch (e) { /* no DOM */ }
  }
  function installDropTarget() {
    if (!root.document || !root.document.addEventListener) return;
    var doc = root.document, depth = 0;
    doc.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault(); depth++; setDropOverlay(true);
    });
    doc.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* ignore */ }
    });
    doc.addEventListener('dragleave', function (e) {
      e.preventDefault(); depth = Math.max(0, depth - 1);
      if (!depth) setDropOverlay(false);
    });
    doc.addEventListener('drop', function (e) {
      e.preventDefault(); depth = 0; setDropOverlay(false);
      var items = e.dataTransfer && e.dataTransfer.items;
      if (!items || !items.length) return;
      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
        if (en) entries.push(en);
      }
      if (!entries.length) {
        toast('请拖入文件夹或 .cs / .prefab 等文件'); return;
      }
      toast('正在读取拖入的目录…');
      scanEntries(entries).then(function (res) {
        dropHandlers.forEach(function (cb) { try { cb(null, res); } catch (err) { /* ignore */ } });
      }).catch(function (err) {
        dropHandlers.forEach(function (cb) { try { cb(err, null); } catch (e2) { /* ignore */ } });
      });
    });
  }

  /* ---------- webkitdirectory fallback -------------------------------- */
  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function pickDirectory() {
    return new Promise(function (resolve) {
      var input = document.getElementById('dir-input');
      if (!input) return resolve(null);
      input.value = '';
      input.onchange = function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) return resolve(null);
        var rootName = String(files[0].webkitRelativePath || files[0].name).split('/')[0];
        var state = newState();
        // PackageCache 的 meta 先入队（小文件、不计预算），其余文件照常。
        var pkgFiles = [], restFiles = [];
        files.forEach(function (f) {
          var rel0 = String(f.webkitRelativePath || f.name).replace(/\\/g, '/');
          (PKG_META_RE.test(rel0) ? pkgFiles : restFiles).push({ f: f, rel: rel0 });
        });
        var chain = Promise.resolve();
        pkgFiles.forEach(function (it) {
          chain = chain.then(function () {
            return Promise.resolve(it.f.text()).then(function (text) {
              addPkgMeta(state, it.rel, it.f.size || 0, text);
            }, function () { /* 读取失败跳过 */ });
          });
        });
        restFiles.forEach(function (it) {
          if (enough(state)) { state.truncated = true; return; }
          if (!isText(it.f.name)) return;
          var parts = it.rel.split('/');
          if (parts.slice(1, -1).some(isIgnored)) return;
          var size = typeof it.f.size === 'number' ? it.f.size : 0;
          if (size > MAX_FILE_BYTES) { state.skipped++; return; }
          chain = chain.then(function () {
            if (enough(state)) { state.truncated = true; return; }
            return Promise.resolve(it.f.text()).then(function (text) {
              addFile(state, it.rel, size, text);
            }).catch(function () { state.skipped++; });
          });
        });
        chain.then(function () {
          try { resolve(filesToResult(state, rootName, 'legacy')); }
          catch (e) { resolve({ error: e }); }
        });
      };
      // Must stay in the user-gesture stack; callers invoke this synchronously.
      input.click();
    });
  }
  function pickDirectoryLegacy() {
    return pickDirectory().then(function (r) {
      if (!r) return null;
      if (r.error) throw r.error;
      return r;
    });
  }

  /* ---------- public API ---------------------------------------------- */
  var api = {
    isDesktop: !!desktop,
    platform: desktop ? 'electron' : 'browser',

    exportFile: function (kind, content, suggested) {
      if (desktop) return desktop.exportFile(kind, content, suggested);
      if (kind === 'png') {
        // content is base64 (from canvas.toDataURL) — decode to real bytes,
        // otherwise the downloaded file is a text file and won't open.
        var bin = atob(content), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        download(suggested || 'export.png', bytes, 'image/png');
      } else {
        download(suggested || ('export.' + kind), content,
          kind === 'svg' ? 'image/svg+xml' : 'text/markdown');
      }
      return Promise.resolve({ ok: true });
    },

    /**
     * options: { rescan:bool, legacy:bool }
     * - default: showDirectoryPicker (persistent binding) with webkitdirectory fallback
     * - rescan: re-read the bound directory without any picker (auto scan on open)
     * - legacy: force the classic folder picker
     */
    scanUnity: function (options) {
      var opts = options || {};
      if (desktop) return desktop.scanUnity(opts);
      if (opts.rescan) return rescanLinked();
      if (opts.legacy || typeof root.showDirectoryPicker !== 'function') return pickDirectoryLegacy();
      var pending;
      try {
        pending = root.showDirectoryPicker({ mode: 'read', id: 'unity-project' });
      } catch (e) {
        return pickDirectoryLegacy(); // synchronous rejection: still inside the gesture
      }
      return Promise.resolve(pending).then(function (handle) {
        if (!handle) return null;
        return saveHandle(handle).then(function () { return scanHandle(handle); });
      }).catch(function (e) {
        if (!e) return null;
        if (e.name === 'AbortError') return null; // user cancelled
        if (e.scanHint) throw e;
        throw scanError('浏览器无法打开目录授权：' + (e.message || e),
          '常见于预览面板 / 内嵌窗口。请把 Unity 工程文件夹直接拖进窗口，或点「选择文件夹（兼容模式）」，或用 Chrome/Edge 本地双击打开本 HTML。');
      });
    },
    linkedDir: linkedDir,
    clearLinkedDir: function () { if (desktop) return Promise.resolve(); return clearHandle(); },
    onDropFiles: function (cb) { if (typeof cb === 'function') dropHandlers.push(cb); },

    loadDemo: function () {
      if (desktop) return desktop.loadDemo();
      return Promise.resolve(null);
    },
    setTitle: function (title) { if (desktop) desktop.setTitle(title); document.title = title; },
    onMenu: function (cb) { if (desktop) desktop.onMenu(cb); },
    quit: function () { if (desktop) desktop.quit(); }
  };

  root.UA = root.UA || {};
  root.UA.Bridge = api;
  api._internals = {
    toAssetPath: toAssetPath, filesToResult: filesToResult, newState: newState,
    addFile: addFile, addPkgMeta: addPkgMeta, readFsaHandle: readFsaHandle, readEntry: readEntry,
    scanEntries: scanEntries, scanHandle: scanHandle
  };
  installDropTarget();
})(globalThis);
