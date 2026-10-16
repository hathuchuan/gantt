const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Gantt = require('./gantt');
const Exporter = require('./export');
const Importer = require('./import');
const NotesIndex = require('./notes-index');

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];

// One window per note. Each window has its own state, keyed by its webContents id.
const wins = new Map(); // webContents.id → { win, filePath, dirty, forceClose, ready, jump }
let pendingOpens = [];
let themePref = 'auto'; // 'auto' follows the system; 'light' / 'dark' are the user's manual choice
const themeItems = {};

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

const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff');

function createWindow(openPath, jump) {
  const from = focusedState();
  const at = from ? from.win.getPosition() : null;
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    ...(at ? { x: at[0] + 26, y: at[1] + 26 } : {}),
    minWidth: 420,
    minHeight: 320,
    show: false,
    backgroundColor: backgroundColor(),
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
  const st = { win, filePath: openPath || null, dirty: false, forceClose: false, ready: false, jump: jump || null };
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
// `jump` ({ line, col, len }) makes the note scroll to that spot once it is showing (the window fetches it with doc:take-jump).
function openFile(p, jump) {
  if (!p) return;
  for (const st of wins.values()) {
    if (samePath(st.filePath, p)) {
      if (st.win.isMinimized()) st.win.restore();
      st.win.show();
      st.win.focus();
      if (jump) {
        st.jump = jump;
        if (st.ready) send(st, 'jump');
      }
      return;
    }
  }
  const blank = [...wins.values()].find((st) => !st.filePath && !st.dirty);
  if (blank) {
    blank.filePath = p; // claim it now so a second request for the same file focuses this window
    blank.jump = jump || null;
    if (blank.ready) send(blank, 'open-path', p); // otherwise did-finish-load sends it
    blank.win.show();
    blank.win.focus();
  } else createWindow(p, jump);
}

function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(focusedState(), action) });
  const themeItem = (key, label) => (themeItems[key] = { label, type: 'radio', checked: themePref === key, click: () => applyThemePref(key) });
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
          { label: 'Import Word / HTML…', click: () => importDialog() },
          {
            label: 'Export',
            submenu: [item('PDF…', null, 'export-pdf'), item('Word (.docx)…', null, 'export-docx')],
          },
          { type: 'separator' },
          item('Link to Gantt Block…', 'CmdOrCtrl+Shift+E', 'gantt'),
          item('Show in Gantt', 'CmdOrCtrl+Shift+G', 'gantt-open'),
          item('Unlink from Gantt', null, 'gantt-unlink'),
          item('Update Project Notes List', null, 'project-notes'),
          item('Update Gantt Tables', null, 'gantt-tables'),
          { type: 'separator' },
          { label: 'Choose Notes Folder…', click: () => chooseNotesFolder() },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { label: 'Paste as Plain Text', accelerator: 'CmdOrCtrl+Shift+V', click: () => send(focusedState(), 'paste-plain', clipboard.readText()) },
          { role: 'selectAll' },
          { type: 'separator' },
          item('Find…', 'CmdOrCtrl+F', 'find'),
          item('Find Next', 'CmdOrCtrl+G', 'find-next'),
          item('Find Previous', 'CmdOrCtrl+Alt+G', 'find-prev'),
          item('Search Notes…', 'CmdOrCtrl+Shift+F', 'search-notes'),
        ],
      },
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
          item('Show Outline', 'CmdOrCtrl+Shift+O', 'outline'),
          item('Backlinks', 'CmdOrCtrl+Shift+B', 'backlinks'),
          { type: 'separator' },
          { label: 'Appearance', submenu: [themeItem('auto', 'Auto (follow system)'), themeItem('light', 'Light'), themeItem('dark', 'Dark')] },
          item('Toggle Night / Day', 'CmdOrCtrl+Shift+D', 'night'),
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

function readSettings() {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n');
}

// The notes folder: where Gantt notes are created and the root of the whole-folder search (File → Choose Notes Folder…).
function notesDir() {
  const j = readSettings();
  if (typeof j.notesDir === 'string' && j.notesDir) return j.notesDir.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(os.homedir(), 'Documents', 'Gantt Notes');
}

async function chooseNotesFolder() {
  const parent = BrowserWindow.getFocusedWindow() || undefined;
  const cur = notesDir();
  const r = await dialog.showOpenDialog(parent, {
    title: 'Choose the notes folder',
    message: 'Search, tags and backlinks look through this folder (and the folder of the open note).',
    defaultPath: fs.existsSync(cur) ? cur : os.homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return;
  writeSettings({ notesDir: r.filePaths[0] });
  NotesIndex.forget();
  for (const st of wins.values()) send(st, 'notes-folder', r.filePaths[0]);
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
      fs.writeFileSync(file, Gantt.noteFrontMatter({ block, course, label, start, end }) + Gantt.EMPTY_PROJECT_NOTES);
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

// opts: { course, all } — every block of one project (course id) instead of just the recent / upcoming ones.
ipcMain.handle('gantt:blocks', (_e, opts) => {
  const storage = readGanttStorage();
  if (!storage) return { error: 'no-data' };
  const o = opts && typeof opts === 'object' ? opts : {};
  return { blocks: Gantt.readBlocks(storage, { today: localToday(), all: !!o.all, course: typeof o.course === 'string' ? o.course : '' }) };
});
// One block with its live status and project progress (null when Gantt no longer has it).
ipcMain.handle('gantt:block', (_e, block) => {
  const storage = readGanttStorage();
  if (!storage) return { error: 'no-data' };
  const b = typeof block === 'string' ? Gantt.blockDetail({ block, storage, today: localToday() }) : null;
  return b ? { block: b } : { error: 'not-found' };
});
// The notes of the same project as `block`; `file` is the asking note (links are relative to it).
ipcMain.handle('gantt:project-notes', (_e, { block, file }) => {
  if (typeof block !== 'string' || !block) return { error: 'invalid' };
  if (!readGanttStorage()) return { error: 'no-data' }; // keep the list the note already has
  const current = typeof file === 'string' && path.isAbsolute(file) ? { block, path: file } : null;
  return Gantt.projectNotes({ block, storage: readGanttStorage() || {}, notesDir: notesDir(), current });
});
ipcMain.handle('gantt:open', (_e, block) => (typeof block === 'string' ? askGantt('open', { block }, true) : { error: 'invalid' }));
ipcMain.handle('gantt:link', (_e, { block, file }) =>
  typeof block === 'string' && path.isAbsolute(String(file)) ? askGantt('link', { block, path: file }, false) : { error: 'invalid' }
);
ipcMain.handle('gantt:unlink', (_e, block) => (typeof block === 'string' ? askGantt('unlink', { block }, false) : { error: 'invalid' }));

// Gantt's storage.json is rewritten whenever Academic Gantt changes (including every Apple Calendar sync):
// tell the windows so the auto-updating tables follow. Polled with watchFile (it survives atomic rewrites and a
// folder that does not exist yet); debounced.
let ganttTimer = null;
function watchGanttStorage() {
  fs.watchFile(ganttStorageFile(), { interval: 2000, persistent: false }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
    clearTimeout(ganttTimer);
    ganttTimer = setTimeout(() => {
      for (const st of wins.values()) if (st.ready) send(st, 'gantt-changed');
    }, 600);
  });
}

// ---------- notes folder: search, tags, backlinks, [[wiki links]] ----------
const indexFor = (file) => {
  const f = typeof file === 'string' && path.isAbsolute(file) ? file : null;
  return NotesIndex.getIndex(NotesIndex.rootsFor({ file: f, notesDir: notesDir() }));
};
const strArg = (v) => (typeof v === 'string' ? v : '');

ipcMain.handle('notes:search', async (_e, { file, query, tag, caseSensitive } = {}) => {
  const index = await indexFor(file);
  const r = NotesIndex.search(index, strArg(query), { tag: strArg(tag), caseSensitive: !!caseSensitive });
  return { ...r, tags: NotesIndex.tagCounts(index), roots: index.roots, files: index.notes.size, scanTruncated: index.truncated };
});
ipcMain.handle('notes:backlinks', async (_e, { file } = {}) => {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return { backlinks: [] };
  return { backlinks: NotesIndex.backlinks(await indexFor(file), file) };
});
ipcMain.handle('notes:names', async (_e, { file } = {}) => ({ names: NotesIndex.names(await indexFor(file), strArg(file)) }));
// targets → { target: absolute path | null }
ipcMain.handle('notes:resolve', async (_e, { file, targets } = {}) => {
  const index = await indexFor(file);
  const map = {};
  for (const t of Array.isArray(targets) ? targets.slice(0, 500) : []) {
    const n = typeof t === 'string' ? NotesIndex.resolveLink(index, t, typeof file === 'string' ? file : '') : null;
    if (typeof t === 'string') map[t] = n ? n.path : null;
  }
  return { map };
});
ipcMain.handle('notes:open', (_e, { path: p, line, col, len } = {}) => {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !NOTE_RE.test(p) || !fs.existsSync(p)) return { error: 'not-found' };
  openFile(p, line ? { line: Number(line) || 1, col: Number(col) || 0, len: Number(len) || 0 } : null);
  return {};
});
// Click on [[target]]: open the note, or (after asking) create it beside the current note.
ipcMain.handle('notes:open-link', async (e, { file, target } = {}) => {
  const st = stateOf(e);
  if (typeof target !== 'string' || !target.trim()) return { error: 'invalid' };
  const from = typeof file === 'string' && path.isAbsolute(file) ? file : '';
  const hit = NotesIndex.resolveLink(await indexFor(from), target, from);
  if (hit) {
    openFile(hit.path);
    return { path: hit.path };
  }
  const info = NotesIndex.newNotePath({ target, fromFile: from, notesDir: notesDir() });
  const r = await dialog.showMessageBox(st.win, {
    type: 'question',
    message: `Create the note “${info.title}”?`,
    detail: `It doesn’t exist yet. A new note will be created in\n${info.dir}`,
    buttons: ['Create', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response !== 0) return { cancelled: true };
  try {
    const created = NotesIndex.createNote({ target, fromFile: from, notesDir: notesDir() });
    NotesIndex.forget();
    openFile(created);
    return { path: created, created: true };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('notes:choose-folder', () => chooseNotesFolder());
ipcMain.handle('doc:take-jump', (e) => {
  const st = stateOf(e);
  const j = st && st.jump;
  if (st) st.jump = null;
  return j || null;
});

// ---------- images pasted / dropped into a note: saved beside the note ----------
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|heic|avif)$/i;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

ipcMain.handle('image:save', async (e, { name, bytes, srcPath }) => {
  const st = stateOf(e);
  if (!st || !st.filePath) return { error: 'unsaved' };
  const dir = path.dirname(st.filePath);
  const given = String(name || '');
  if (!IMAGE_EXT_RE.test(given)) return { error: 'type' };
  // Already beside the note: just reference it.
  if (typeof srcPath === 'string' && srcPath && samePath(path.dirname(srcPath), dir) && fs.existsSync(srcPath)) return { name: path.basename(srcPath) };
  const data = Buffer.from(bytes || []);
  if (!data.length || data.length > MAX_IMAGE_BYTES) return { error: 'size' };
  const ext = path.extname(given).toLowerCase();
  const stem = Gantt.safeName(path.basename(given, path.extname(given)), 60);
  for (let n = 1; ; n++) {
    const file = stem + (n > 1 ? ` ${n}` : '') + ext;
    try {
      await fs.promises.writeFile(path.join(dir, file), data, { flag: 'wx' });
      return { name: file };
    } catch (err) {
      if (err.code !== 'EEXIST') return { error: 'write' };
    }
  }
});

// ---------- export / import ----------
async function askExportPath(st, ext, label) {
  const stem = st.filePath ? path.basename(st.filePath).replace(/\.[^.]+$/, '') : 'Untitled';
  const dir = st.filePath ? path.dirname(st.filePath) : app.getPath('documents');
  const r = await dialog.showSaveDialog(st.win, { defaultPath: path.join(dir, stem + '.' + ext), filters: [{ name: label, extensions: [ext] }] });
  return r.canceled ? null : r.filePath;
}

const baseDirOf = (st) => (st.filePath ? path.dirname(st.filePath) : undefined);

ipcMain.handle('export:pdf', async (e, { html }) => {
  const st = stateOf(e);
  const target = await askExportPath(st, 'pdf', 'PDF');
  if (!target) return null;
  try {
    await fs.promises.writeFile(target, await Exporter.htmlToPdf(String(html || ''), { baseDir: baseDirOf(st) }));
    return { path: target };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('export:docx', async (e, { markdown, title }) => {
  const st = stateOf(e);
  const target = await askExportPath(st, 'docx', 'Word document');
  if (!target) return null;
  try {
    await fs.promises.writeFile(target, await Exporter.markdownToDocx(String(markdown || ''), { baseDir: baseDirOf(st), title }));
    return { path: target };
  } catch (err) {
    return { error: err.message };
  }
});

// File → Import Word / HTML…: converts to Markdown, saves it as a new note (images go beside it) and opens it.
async function importDialog() {
  const parent = BrowserWindow.getFocusedWindow() || undefined;
  const pick = await dialog.showOpenDialog(parent, {
    properties: ['openFile'],
    filters: [{ name: 'Word / HTML', extensions: ['docx', 'html', 'htm'] }],
  });
  if (pick.canceled || !pick.filePaths[0]) return;
  const src = pick.filePaths[0];
  const out = await dialog.showSaveDialog(parent, {
    title: 'Save the imported note as',
    defaultPath: path.join(path.dirname(src), path.basename(src).replace(/\.[^.]+$/, '') + '.md'),
    filters: MD_FILTERS,
  });
  if (out.canceled || !out.filePath) return;
  try {
    const { markdown } = await Importer.convertFile(src, out.filePath);
    await fs.promises.writeFile(out.filePath, markdown, 'utf8');
    openFile(out.filePath);
  } catch (err) {
    dialog.showErrorBox('Couldn’t import this file', err.message);
  }
}

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
// ---------- appearance: Auto (follows the system, live) / Light / Dark ----------
const THEME_PREFS = ['auto', 'light', 'dark'];

function updateBackgrounds() {
  for (const st of wins.values()) if (!st.win.isDestroyed()) st.win.setBackgroundColor(backgroundColor());
}

function applyThemePref(pref, { persist = true } = {}) {
  if (!THEME_PREFS.includes(pref)) return;
  themePref = pref;
  // 'system' makes prefers-color-scheme in the windows track the OS, so Auto flips when the system does.
  nativeTheme.themeSource = pref === 'auto' ? 'system' : pref;
  updateBackgrounds();
  for (const [key, mi] of Object.entries(themeItems)) mi.checked = key === pref;
  if (persist) writeSettings({ theme: pref });
  for (const st of wins.values()) send(st, 'theme-pref', pref);
}

nativeTheme.on('updated', updateBackgrounds);
// { pref, stored }: `stored` is false until the user (or the first run of a window) has saved a choice.
ipcMain.handle('ui:get-theme-pref', () => ({ pref: themePref, stored: THEME_PREFS.includes(readSettings().theme) }));
ipcMain.on('ui:theme-pref', (_e, pref) => applyThemePref(pref));

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
  const saved = readSettings().theme;
  if (THEME_PREFS.includes(saved)) themePref = saved;
  nativeTheme.themeSource = themePref === 'auto' ? 'system' : themePref;
  buildMenu();
  watchGanttStorage();
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => NOTE_RE.test(a)).map((a) => path.resolve(a));
  const first = [...pendingOpens, ...args];
  pendingOpens = [];
  if (first.length) first.forEach(openFile);
  else createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
