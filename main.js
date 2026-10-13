const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Gantt = require('./gantt');

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
          item('Link to Gantt Block…', 'CmdOrCtrl+Shift+E', 'gantt'),
          item('Show in Gantt', 'CmdOrCtrl+Shift+G', 'gantt-open'),
          item('Unlink from Gantt', null, 'gantt-unlink'),
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

// ---------- Academic Gantt integration ----------
// Gantt → note : mdeditor://note?block=…&course=…&label=…&start=…&end=…[&path=…]
// note → Gantt : academicgantt://open?block=…  |  link?block=…&path=…  |  unlink?block=…
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const ganttStorageFile = () => path.join(os.homedir(), 'Library', 'Application Support', 'AcademicGantt', 'storage.json');
const NOTE_RE = /\.(md|markdown|txt)$/i;

function notesDir() {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (typeof j.notesDir === 'string' && j.notesDir) return j.notesDir.replace(/^~(?=$|\/)/, os.homedir());
  } catch {}
  return path.join(os.homedir(), 'Documents', 'Gantt Notes');
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const askGantt = (action, params, activate) =>
  shell
    .openExternal(`academicgantt://${action}?` + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'), { activate })
    .then(() => ({}), () => ({ error: 'no-gantt' }));

// Creates the note for a block (or reuses the one already tagged with the same block id).
function createNote({ block, course, label, start, end }) {
  const dir = path.join(notesDir(), Gantt.safeName(course));
  fs.mkdirSync(dir, { recursive: true });
  const base = Gantt.safeName(label || block);
  for (let n = 1; ; n++) {
    const file = path.join(dir, base + (n > 1 ? ` ${n}` : '') + '.md');
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, Gantt.noteFrontMatter({ block, course, label, start, end }));
      return file;
    }
    if (fs.readFileSync(file, 'utf8').includes(`gantt-block: ${block}`)) return file;
  }
}

async function handleNoteUrl(q) {
  const block = q.get('block');
  if (!block) return;
  const existing = q.get('path');
  let file = existing && path.isAbsolute(existing) && NOTE_RE.test(existing) && fs.existsSync(existing) ? existing : null;
  if (!file) {
    file = createNote({ block, course: q.get('course') || 'Gantt', label: q.get('label') || '', start: q.get('start'), end: q.get('end') });
    askGantt('link', { block, path: file }, false); // runs in the background: don't steal focus from the editor
  }
  requestOpen(file);
}

ipcMain.handle('gantt:blocks', () => {
  try {
    const storage = JSON.parse(fs.readFileSync(ganttStorageFile(), 'utf8'));
    return { blocks: Gantt.readBlocks(storage, { today: localToday() }) };
  } catch {
    return { error: 'no-data' };
  }
});
ipcMain.handle('gantt:open', (_e, block) => (typeof block === 'string' ? askGantt('open', { block }, true) : { error: 'invalid' }));
ipcMain.handle('gantt:link', (_e, { block, file }) =>
  typeof block === 'string' && path.isAbsolute(String(file)) ? askGantt('link', { block, path: file }, false) : { error: 'invalid' }
);
ipcMain.handle('gantt:unlink', (_e, block) => (typeof block === 'string' ? askGantt('unlink', { block }, false) : { error: 'invalid' }));

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

// mdeditor://note?... (from Academic Gantt) and mdeditor://open?path=/abs/note.md
app.on('open-url', (e, url) => {
  e.preventDefault();
  try {
    const u = new URL(url);
    if (u.protocol !== 'mdeditor:') return;
    if (u.hostname === 'note') app.whenReady().then(() => handleNoteUrl(u.searchParams));
    else if (u.hostname === 'open') {
      const p = u.searchParams.get('path');
      if (p && path.isAbsolute(p) && NOTE_RE.test(p)) requestOpen(p);
    }
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
