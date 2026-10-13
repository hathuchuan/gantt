const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');
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
          item('Attach to Calendar Event…', 'CmdOrCtrl+Shift+E', 'event'),
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
          { type: 'separator' },
          item('Commands…', null, 'commands'),
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

// ---------- custom commands (commands.json in the app data folder) ----------
const commandsFile = () => path.join(app.getPath('userData'), 'commands.json');
const COMMANDS_EXAMPLE = {
  disabled: [],
  custom: [
    {
      key: 'meeting',
      label: 'Meeting notes',
      hint: '📝',
      block: true,
      text: '## Meeting — {date}\n\n**Attendees:** {cursor}\n\n### Notes\n\n### Action items\n- [ ] ',
    },
  ],
};

function readCommands() {
  try {
    const j = JSON.parse(fs.readFileSync(commandsFile(), 'utf8'));
    return { disabled: Array.isArray(j.disabled) ? j.disabled : [], custom: Array.isArray(j.custom) ? j.custom : [], raw: j };
  } catch (err) {
    if (err.code === 'ENOENT') return { disabled: [], custom: [], raw: {} };
    return { disabled: [], custom: [], raw: null, error: 'commands.json is not valid JSON' };
  }
}

ipcMain.handle('commands:load', () => {
  const { disabled, custom, error } = readCommands();
  return { disabled, custom, error };
});
ipcMain.handle('commands:set-disabled', (_e, disabled) => {
  const cur = readCommands();
  if (cur.error) return { error: cur.error };
  const next = { ...cur.raw, disabled: [...new Set((disabled || []).filter((k) => typeof k === 'string'))] };
  fs.mkdirSync(path.dirname(commandsFile()), { recursive: true });
  fs.writeFileSync(commandsFile(), JSON.stringify(next, null, 2) + '\n');
  return {};
});
ipcMain.handle('commands:open-file', async () => {
  if (!fs.existsSync(commandsFile())) {
    fs.mkdirSync(path.dirname(commandsFile()), { recursive: true });
    fs.writeFileSync(commandsFile(), JSON.stringify(COMMANDS_EXAMPLE, null, 2) + '\n');
  }
  return shell.openPath(commandsFile());
});

// ---------- calendar (EventKit helper, macOS only) ----------
const helperPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'calendar-helper') : path.join(__dirname, 'build', 'calendar-helper');

function runHelper(args) {
  return new Promise((resolve) => {
    const bin = helperPath();
    if (process.platform !== 'darwin' || !fs.existsSync(bin)) {
      return resolve({ error: 'unavailable' });
    }
    execFile(bin, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      try {
        resolve({ data: JSON.parse(stdout) });
      } catch {
        resolve({ error: err ? err.message : 'bad output' });
      }
    });
  });
}

const isoSeconds = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

ipcMain.handle('calendar:list', async (_e, range) => {
  const day = 86400000;
  const from = new Date(range && range.from ? range.from : Date.now() - 7 * day);
  const to = new Date(range && range.to ? range.to : Date.now() + 21 * day);
  const r = await runHelper(['list', isoSeconds(from), isoSeconds(to)]);
  if (r.error) return { error: r.error };
  if (r.data && r.data.error) return { error: r.data.error };
  return { events: r.data };
});

ipcMain.handle('calendar:link', async (_e, { id, start, file }) => {
  if (!file || !path.isAbsolute(file)) return { error: 'note must be saved first' };
  const url = 'mdeditor://open?path=' + encodeURIComponent(file);
  const r = await runHelper(['link', String(id), String(start), url]);
  if (r.error) return { error: r.error };
  if (r.data && r.data.error) return { error: r.data.error };
  return {};
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

function requestOpen(p) {
  if (win) send('open-path', p);
  else pendingOpen = p;
}

app.on('open-file', (e, p) => {
  e.preventDefault();
  requestOpen(p);
});

// mdeditor://open?path=/abs/note.md — written into calendar events by "Attach to Calendar Event".
app.on('open-url', (e, url) => {
  e.preventDefault();
  try {
    const u = new URL(url);
    const p = u.protocol === 'mdeditor:' && u.searchParams.get('path');
    if (p && path.isAbsolute(p) && /\.(md|markdown|txt)$/i.test(p)) requestOpen(p);
  } catch {}
});

app.whenReady().then(() => {
  buildMenu();
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => /\.(md|markdown|txt)$/i.test(a));
  if (arg && !pendingOpen) pendingOpen = path.resolve(arg);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
