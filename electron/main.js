'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const scanner = require('./scanner');

let win = null;
const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
const SMOKE_RESULT = path.join(__dirname, '..', 'tests', '.smoke-result.json');

function writeSmoke(code, payload) {
  const data = JSON.stringify(Object.assign({ ok: code === 0 }, payload || {}), null, 2);
  try { fs.writeFileSync(SMOKE_RESULT, data, 'utf8'); } catch (e) { /* best effort */ }
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'smoke-result.json'), data, 'utf8');
  } catch (e) { /* best effort */ }
  app.exit(code);
}

function send(action, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('menu-action', action, payload || {});
}

const menuTemplate = [
  {
    label: '文件', submenu: [
      { label: '扫描 Unity 工程…', click: () => send('scan') },
      { type: 'separator' },
      { label: '导出 PNG', click: () => send('export-png') },
      { label: '导出 Markdown', click: () => send('export-md') },
      { type: 'separator' },
      { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
    ]
  },
  {
    label: '编辑', submenu: [
      { label: '聚焦依赖', click: () => send('focus') },
      { label: '取消聚焦', click: () => send('unfocus') }
    ]
  },
  {
    label: '视图', submenu: [
      { label: '适应画布', accelerator: 'F', click: () => send('fit') },
      { label: '分层布局', accelerator: 'L', click: () => send('layout-layered') },
      { label: '切换主题', click: () => send('theme') },
      { type: 'separator' },
      { label: '重新载入', accelerator: 'CmdOrCtrl+R', click: () => { if (win) win.reload(); } }
    ]
  },
  {
    label: '分析', submenu: [
      { label: '依赖分析', click: () => send('tab-deps') },
      { label: '循环依赖', click: () => send('show-cycles') },
      { label: '扫描差异', click: () => send('show-diff') },
      { label: '孤立节点', click: () => send('show-isolated') }
    ]
  },
  {
    label: '帮助', submenu: [
      { label: '载入示例工程', click: () => send('load-demo') },
      { label: '关于', click: () => send('about') }
    ]
  }
];

function createWindow() {
  win = new BrowserWindow({
    width: 1520, height: 940, minWidth: 1080, minHeight: 660,
    title: 'Unity Architect', backgroundColor: '#F4F5F7', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function probeBrowserMode(done) {
  const w = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const errors = [];
  w.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  w.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      const probe = `({
        isDesktop: UA.Bridge.isDesktop,
        modules: ['Schema','Model','CsParser','UnityParser','Analysis','Layout','Canvas','UI','Bridge'].filter(k => !!UA[k]),
        canvas: !!document.querySelector('canvas.graph-canvas'),
        app: !!UA.App
      })`;
      w.webContents.executeJavaScript(probe).then((r) => {
        const ok = !r.isDesktop && r.modules.length === 9 && r.canvas && r.app && errors.length === 0;
        w.destroy();
        done({ ok: ok, probe: r, errors: errors });
      }).catch((e) => { w.destroy(); done({ ok: false, error: e.message, errors: errors }); });
    }, 1200);
  });
  w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

function createSmokeWindow() {
  win = new BrowserWindow({
    show: false, width: 1400, height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      const probe = `({
        hasUA: typeof UA !== 'undefined',
        hasApp: !!(window.UA && UA.App),
        modules: ['Schema','Model','CsParser','UnityParser','Analysis','Layout','Canvas','UI','Bridge'].filter(k => !!(window.UA && UA[k])),
        canvas: !!document.querySelector('canvas.graph-canvas'),
        nodes: window.UA && UA.App ? UA.App.getProject().nodes.length : -1,
        panels: document.querySelectorAll('.panel-tabs').length,
        title: document.title
      })`;
      win.webContents.executeJavaScript(probe).then((r) => {
        const ok = r.hasUA && r.hasApp && r.modules.length === 9 && r.canvas && r.panels === 2 && errors.length === 0;
        probeBrowserMode((browser) => {
          writeSmoke(ok && browser.ok ? 0 : 1, { probe: r, errors: errors, browser: browser });
        });
      }).catch((e) => writeSmoke(1, { error: e.message, errors: errors }));
    }, 1500);
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  setTimeout(() => writeSmoke(1, { error: 'timeout', errors: errors }), 20000);
}

function registerIpc() {
  ipcMain.handle('export-file', async (_e, { kind, content, suggested }) => {
    const ext = kind === 'png' ? 'png' : 'md';
    const r = await dialog.showSaveDialog(win, {
      title: '导出文件', defaultPath: suggested || ('export.' + ext),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    const buffer = kind === 'png' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    fs.writeFileSync(r.filePath, buffer);
    return { ok: true, filePath: r.filePath };
  });
  ipcMain.handle('scan-unity', async (_e, opts) => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择 Unity 工程根目录（包含 Assets 文件夹）', properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths.length) return null;
    return scanner.scan(r.filePaths[0], opts || {});
  });
  ipcMain.handle('load-demo', async () => null);
  ipcMain.on('set-title', (_e, title) => { if (win && !win.isDestroyed()) win.setTitle(title || 'Unity Architect'); });
  ipcMain.on('app-quit', () => app.quit());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    registerIpc();
    if (isSmoke) { createSmokeWindow(); return; }
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
