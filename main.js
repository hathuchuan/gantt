const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];

let win = null;
let filePath = null;
let dirty = false;
let forceClose = false;
let pendingOpen = null;
let nightItem = null;

const send = (action, payload) => win && !win.isDestroyed() && win.webContents.send('menu', action, payload);

function docInfo(p, content) {
  return { path: p, name: path.basename(p), dir: path.dirname(p), content };
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 420,
    minHeight: 320,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      send('open-path', pendingOpen);
      pendingOpen = null;
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (forceClose || !dirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: 'Save changes before closing?',
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) send('save-and-close');
    else if (choice === 1) {
      forceClose = true;
      win.close();
    }
  });
  win.on('closed', () => {
    win = null;
    filePath = null;
    dirty = false;
    forceClose = false;
  });
}

function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(action) });
  nightItem = { label: 'Night Mode', type: 'checkbox', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('night') };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'File',
        submenu: [
          item('New', 'CmdOrCtrl+N', 'new'),
          item('Open…', 'CmdOrCtrl+O', 'open'),
          { type: 'separator' },
          item('Save', 'CmdOrCtrl+S', 'save'),
          item('Save As…', 'CmdOrCtrl+Shift+S', 'save-as'),
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'Format',
        submenu: [
          item('Bold', 'CmdOrCtrl+B', 'fmt:bold'),
          item('Italic', 'CmdOrCtrl+I', 'fmt:italic'),
          item('Strikethrough', 'CmdOrCtrl+Shift+X', 'fmt:strike'),
          item('Inline Code', 'CmdOrCtrl+E', 'fmt:code'),
          item('Link', 'CmdOrCtrl+K', 'fmt:link'),
          { type: 'separator' },
          item('Heading 1', 'CmdOrCtrl+1', 'fmt:h1'),
          item('Heading 2', 'CmdOrCtrl+2', 'fmt:h2'),
          item('Heading 3', 'CmdOrCtrl+3', 'fmt:h3'),
        ],
      },
      {
        label: 'View',
        submenu: [
          item('Toggle Preview / Edit', 'CmdOrCtrl+/', 'toggle'),
          nightItem,
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ])
  );
}

async function saveTo(target, content) {
  await fs.promises.writeFile(target, content, 'utf8');
  filePath = target;
  return docInfo(target, content);
}

async function askSavePath() {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: filePath || 'Untitled.md',
    filters: MD_FILTERS,
  });
  return r.canceled ? null : r.filePath;
}

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: MD_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});

async function readDoc(p) {
  const content = await fs.promises.readFile(p, 'utf8');
  filePath = p;
  app.addRecentDocument(p);
  return docInfo(p, content);
}

ipcMain.handle('file:read', (_e, p) => readDoc(p));
ipcMain.handle('file:save', async (_e, content) => {
  const target = filePath || (await askSavePath());
  return target ? saveTo(target, content) : null;
});
ipcMain.handle('file:save-as', async (_e, content) => {
  const target = await askSavePath();
  return target ? saveTo(target, content) : null;
});
ipcMain.handle('file:new', () => {
  filePath = null;
});
ipcMain.handle('doc:confirm-discard', async () => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    message: 'Save changes to this document?',
    detail: 'Your changes will be lost if you don’t save them.',
    buttons: ['Save', 'Don’t Save', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  return ['save', 'discard', 'cancel'][r.response];
});

ipcMain.on('doc:state', (_e, s) => {
  dirty = !!s.dirty;
  if (!win) return;
  win.setTitle(s.name);
  win.setDocumentEdited(dirty);
  win.setRepresentedFilename(filePath || '');
});
ipcMain.on('win:close-now', () => {
  forceClose = true;
  win && win.close();
});
ipcMain.on('ui:theme', (_e, dark) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  if (win) win.setBackgroundColor(dark ? '#1c1c1e' : '#ffffff');
  if (nightItem) nightItem.checked = !!dark;
});
ipcMain.on('shell:open', (_e, url) => {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.href);
  } catch {}
});

app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win) send('open-path', p);
  else pendingOpen = p;
});

app.whenReady().then(() => {
  buildMenu();
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => /\.(md|markdown|txt)$/i.test(a));
  if (arg && !pendingOpen) pendingOpen = path.resolve(arg);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
