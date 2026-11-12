'use strict';
const fs = require('fs');
const path = require('path');
const Parser = require('../src/shared/unity-parser.js');

// 与浏览器版 SCAN_EXT 保持一致：脚本 + 场景/预制体挂载 + SO 资源 + 程序集定义。
// 解析器已忽略 scope 参数（全量解析），这里不再按 scope 收窄文件集合。
const SCAN_EXT = /\.(cs|meta|prefab|unity|asset|asmdef)$/i;
const IGNORED = /^(Library|Temp|obj|Logs|UserSettings|ProjectSettings|Packages|PackagesCache|Recordings|\.git|\.vs|\.idea|\.plastic|\.svn|Build|Builds|MemoryCaptures|node_modules)$/i;
const MAX_FILES = 20000;
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

function walk(dir, root, state, ext) {
  if (state.files.length >= MAX_FILES || state.bytes >= MAX_BYTES) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const entry of entries) {
    if (state.files.length >= MAX_FILES || state.bytes >= MAX_BYTES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED.test(entry.name)) continue;
      walk(full, root, state, ext);
    } else if (entry.isFile() && ext.test(entry.name)) {
      let stat;
      try { stat = fs.statSync(full); } catch (e) { continue; }
      if (stat.size > MAX_FILE_BYTES || state.bytes + stat.size > MAX_BYTES) continue;
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
      const rel = path.relative(root, full).replace(/\\/g, '/');
      state.files.push({ path: rel, content });
      state.bytes += stat.size;
    }
  }
}

/** Light pass over Library/PackageCache collecting only *.cs.meta (tiny files)
 *  so official package scripts (EventSystem, StandaloneInputModule, …) can be
 *  resolved from their GUID to a real script name. */
function walkPkgMeta(dir, root, state) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const entry of entries) {
    if (state.files.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPkgMeta(full, root, state);
    } else if (entry.isFile() && /\.cs\.meta$/i.test(entry.name)) {
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
      state.files.push({ path: path.relative(root, full).replace(/\\/g, '/'), content });
    }
  }
}

/** Scan a Unity project directory and return a parsed graph (small IPC payload). */
function scan(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) throw new Error('目录不存在');
  // Selecting the Assets folder itself still needs the Assets/ prefix in node paths.
  const base = path.basename(rootPath);
  const root = /^(Assets|Packages)$/i.test(base) ? path.dirname(rootPath) : rootPath;
  const state = { files: [], bytes: 0 };
  // PackageCache 的 .cs.meta 先入队（排在前部，不会被解析器文件数上限截断）。
  walkPkgMeta(path.join(root, 'Library', 'PackageCache'), root, state);
  walkPkgMeta(path.join(root, 'Library', 'UnityPackageCache'), root, state);
  walk(rootPath, root, state, SCAN_EXT);
  const parsed = Parser.parseProject(state.files, { rootPrefix: root });
  parsed.stats.scannedBytes = state.bytes;
  return { parsed, rootPath, truncated: state.files.length >= MAX_FILES || state.bytes >= MAX_BYTES };
}

module.exports = { scan, TEXT_EXT: SCAN_EXT, IGNORED, SCAN_EXT };
