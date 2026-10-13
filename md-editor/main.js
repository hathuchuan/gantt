const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Gantt = require('./gantt');

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];

// One window per note. Each window has its own state, keyed by its webContents id.
const wins = new Map(); // webContents.id → { win, filePath, dirty, forceClose, ready }
let pendingOpens = [];
let nightItem = null;

const stateOf = (e) => wins.get(e.sender.id);
const focusedState = () => {
  const w = BrowserWindow.getFocusedWindow();
  return w && wins.get(w.webContents.id);
};
const send = (st, action, payload) => st && !st.win.isDestroyed() && st.win.webContents.send('menu', action, payload);

function docInfo(p, content) {
  return { path: p, name: path.basename(p), dir: path.dirname(p), content };
}

const samePath = (a, b) => a && b && path.resolve(a) === path.resolve(b);

function createWindow(openPath) {
  const from = focusedState();
  const at = from ? from.win.getPosition() : null;
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    ...(at ? { x: at[0] + 26, y: at[1] + 26 } : {}),
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
  const id = win.webContents.id;
  const st = { win, filePath: openPath || null, dirty: false, forceClose: false, ready: false };
  wins.set(id, st);

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    st.ready = true;
    if (st.filePath) send(st, 'open-path', st.filePath);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (st.forceClose || !st.dirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: 'Save changes before closing?',
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) send(st, 'save-and-close');
    else if (choice === 1) {
      st.forceClose = true;
      win.close();
    }
  });
  win.on('closed', () => wins.delete(id));
  return st;
}

// Opens a note in its own window; focuses the window that already has it; reuses an untouched blank window.
function openFile(p) {
  if (!p) return;
  for (const st of wins.values()) {
    if (samePath(st.filePath, p)) {
      if (st.win.isMinimized()) st.win.restore();
      st.win.show();
      st.win.focus();
      return;
    }
  }
  const blank = [...wins.values()].find((st) => !st.filePath && !st.dirty);
  if (blank) {
    blank.filePath = p; // claim it now so a second request for the same file focuses this window
    if (blank.ready) send(blank, 'open-path', p); // otherwise did-finish-load sends it
    blank.win.show();
    blank.win.focus();
  } else createWindow(p);
}

function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(focusedState(), action) });
  nightItem = { label: 'Night Mode', type: 'checkbox', accelerator: 'CmdOrCtrl+Shift+D', click: () => send(focusedState(), 'night') };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'File',
        submenu: [
          { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
          { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openDialog() },
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

async function saveTo(st, target, content) {
  await fs.promises.writeFile(target, content, 'utf8');
  const moved = !samePath(st.filePath, target);
  st.filePath = target;
  // A note linked to a Gantt block that is saved under a new name/place: tell Gantt where it went.
  const block = Gantt.blockOfText(content);
  if (moved && block) askGantt('link', { block, path: target }, false);
  return docInfo(target, content);
}

async function askSavePath(st) {
  const r = await dialog.showSaveDialog(st.win, {
    defaultPath: st.filePath || 'Untitled.md',
    filters: MD_FILTERS,
  });
  return r.canceled ? null : r.filePath;
}

async function openDialog() {
  const parent = BrowserWindow.getFocusedWindow() || undefined;
  const r = await dialog.showOpenDialog(parent, { properties: ['openFile', 'multiSelections'], filters: MD_FILTERS });
  if (!r.canceled) r.filePaths.forEach(openFile);
}

async function readDoc(st, p) {
  let content;
  try {
    content = await fs.promises.readFile(p, 'utf8');
  } catch (err) {
    if (samePath(st.filePath, p)) st.filePath = null;
    throw err;
  }
  st.filePath = p;
  app.addRecentDocument(p);
  return docInfo(p, content);
}

ipcMain.handle('file:read', (e, p) => readDoc(stateOf(e), p));
ipcMain.handle('file:save', async (e, content) => {
  const st = stateOf(e);
  const target = st.filePath || (await askSavePath(st));
  return target ? saveTo(st, target, content) : null;
});
ipcMain.handle('file:save-as', async (e, content) => {
  const st = stateOf(e);
  const target = await askSavePath(st);
  return target ? saveTo(st, target, content) : null;
});
ipcMain.handle('doc:confirm-discard', async (e) => {
  const st = stateOf(e);
  const r = await dialog.showMessageBox(st.win, {
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
    if (Gantt.blockOfText(fs.readFileSync(file, 'utf8')) === block) return file;
  }
}

function readGanttStorage() {
  try {
    return JSON.parse(fs.readFileSync(ganttStorageFile(), 'utf8'));
  } catch {
    return null;
  }
}

// ⌘-click on a Gantt block: open that block's note. A new note is created only when none exists anywhere.
async function handleNoteUrl(q) {
  const block = q.get('block');
  if (!block) return;
  const given = q.get('path');
  let file = Gantt.findNote({ block, path: given, storage: readGanttStorage(), notesDir: notesDir() });
  if (!file) file = createNote({ block, course: q.get('course') || 'Gantt', label: q.get('label') || '', start: q.get('start'), end: q.get('end') });
  // Gantt's link is missing or stale (note moved/renamed, or the first "link" message got lost): repair it in the background.
  if (!samePath(given, file)) askGantt('link', { block, path: file }, false);
  openFile(file);
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

ipcMain.on('doc:state', (e, s) => {
  const st = stateOf(e);
  if (!st) return;
  st.dirty = !!s.dirty;
  st.win.setTitle(s.name);
  st.win.setDocumentEdited(st.dirty);
  st.win.setRepresentedFilename(st.filePath || '');
});
ipcMain.on('win:close-now', (e) => {
  const st = stateOf(e);
  if (!st) return;
  st.forceClose = true;
  st.win.close();
});
ipcMain.on('ui:theme', (_e, dark) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  for (const st of wins.values()) st.win.setBackgroundColor(dark ? '#1c1c1e' : '#ffffff');
  if (nightItem) nightItem.checked = !!dark;
});

// Links dropped into a note or written by hand: file:// opens the file (notes open in their own window), web links open in the browser.
const RISKY_EXT = /\.(app|command|sh|bash|zsh|terminal|workflow|action|pkg|dmg|jar|scpt|scptd|js|py|pl|rb|exe|bat|cmd)$/i;
function openLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (['http:', 'https:', 'mailto:'].includes(u.protocol)) return void shell.openExternal(u.href);
  if (u.protocol !== 'file:') return;
  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return;
  }
  if (!fs.existsSync(p)) return void dialog.showMessageBox({ type: 'info', message: 'File not found', detail: p });
  if (NOTE_RE.test(p)) openFile(p);
  else if (RISKY_EXT.test(p)) shell.showItemInFolder(p); // never run a program because a note links to it
  else shell.openPath(p);
}
ipcMain.on('shell:open', (_e, url) => openLink(String(url)));

app.on('open-file', (e, p) => {
  e.preventDefault();
  if (app.isReady()) openFile(p);
  else pendingOpens.push(p);
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
      if (p && path.isAbsolute(p) && NOTE_RE.test(p)) app.whenReady().then(() => openFile(p));
    }
  } catch {}
});

app.whenReady().then(() => {
  buildMenu();
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => NOTE_RE.test(a)).map((a) => path.resolve(a));
  const first = [...pendingOpens, ...args];
  pendingOpens = [];
  if (first.length) first.forEach(openFile);
  else createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
