// Whole-notes-folder index (main process): full-text search, tags and [[wiki-link]] backlinks.
// Files are scanned recursively and cached by mtime + size, so a repeated search only stats the files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Core = require('./src/notes-core');
const Gantt = require('./gantt');

const NOTE_EXT = /\.(md|markdown|txt)$/i;
const SKIP_DIRS = new Set(['node_modules', 'Library', 'dist', 'build', 'Applications']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 6;

const stem = (file) => path.basename(file).replace(NOTE_EXT, '');

// One note: its text plus everything we derive from it.
function parseNote(text, file, stat = {}) {
  return {
    path: file,
    name: stem(file),
    title: Core.frontMatterTitle(text),
    text,
    tags: Core.noteTags(text),
    links: Core.parseWikiLinks(text),
    mtimeMs: stat.mtimeMs || 0,
    size: stat.size || 0,
  };
}

// Folders to index: the notes folder and the folder of the current note (when different and not nested in each other).
function rootsFor({ file, notesDir }) {
  const list = [notesDir, file && path.dirname(file)].filter((d) => d && fs.existsSync(d));
  const uniq = [...new Set(list.map((d) => path.resolve(d)))];
  return uniq.filter((d) => !uniq.some((o) => o !== d && d.startsWith(o + path.sep)));
}

const isBroadRoot = (d) => d === path.parse(d).root || d === os.homedir();

// Scans `roots` (recursively; a few levels deep) into { notes: Map(path → note), roots, truncated }.
// `cache` (Map path → note) is reused for files whose mtime and size did not change.
async function scan(roots, cache = new Map(), { maxFiles = 6000 } = {}) {
  const seen = new Set();
  const budget = { files: maxFiles };
  let truncated = false;

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isFile() && NOTE_EXT.test(e.name)) {
        if (seen.has(full)) continue;
        if (--budget.files < 0) {
          truncated = true;
          return;
        }
        seen.add(full);
        try {
          const st = await fs.promises.stat(full);
          if (st.size > MAX_FILE_BYTES) {
            seen.delete(full);
            continue;
          }
          const hit = cache.get(full);
          if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) continue;
          cache.set(full, parseNote(await fs.promises.readFile(full, 'utf8'), full, st));
        } catch {
          cache.delete(full);
          seen.delete(full);
        }
      } else if (e.isDirectory() && depth > 0 && !SKIP_DIRS.has(e.name)) {
        await walk(full, depth - 1);
        if (truncated) return;
      }
    }
  }

  for (const r of roots) await walk(r, isBroadRoot(r) ? 0 : MAX_DEPTH);

  // Forget notes that vanished (only within the scanned roots; other windows may use other roots).
  if (!truncated) {
    for (const p of [...cache.keys()]) {
      if (!seen.has(p) && roots.some((r) => p.startsWith(r + path.sep))) cache.delete(p);
    }
  }
  const notes = new Map([...seen].filter((p) => cache.has(p)).map((p) => [p, cache.get(p)]));
  return { notes, roots, truncated };
}

// ---------- queries (pure; operate on a scan result) ----------
const relOf = (index, file) => {
  const root = index.roots.find((r) => file.startsWith(r + path.sep));
  return (root ? path.relative(root, file) : path.basename(file)).split(path.sep).join('/');
};

const brief = (index, n, extra) => ({ path: n.path, name: n.name, rel: relOf(index, n.path), ...extra });

// Notes newest first.
const byRecent = (a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1);

// Full-text search → [{ path, name, rel, line, col, len, snippet }]. `tag` restricts to notes carrying it;
// with a tag and no text, one row per note (at the line where the tag appears).
function search(index, query, { caseSensitive = false, tag = '', limit = 300, perFile = 30 } = {}) {
  const q = String(query || '').trim();
  const tk = tag ? Core.tagKey(tag.replace(/^#/, '')) : '';
  if (!q && !tk) return { results: [], truncated: false };
  const results = [];
  let truncated = false;
  for (const n of [...index.notes.values()].sort(byRecent)) {
    const mine = tk ? n.tags.find((t) => Core.tagKey(t.tag) === tk) : null;
    if (tk && !mine) continue;
    const lines = n.text.split(/\r?\n/);
    if (!q) {
      results.push(brief(index, n, { line: mine.line, col: 0, len: 0, snippet: Core.snippet(lines[mine.line - 1] || '') }));
    } else {
      let count = 0;
      for (let i = 0; i < lines.length && count < perFile; i++) {
        for (const m of Core.findAll(lines[i], q, caseSensitive, perFile)) {
          if (count++ >= perFile) break;
          results.push(brief(index, n, { line: i + 1, col: m.from, len: m.to - m.from, snippet: Core.snippet(lines[i], m.from, m.to - m.from) }));
        }
      }
    }
    if (results.length >= limit) {
      truncated = true;
      break;
    }
  }
  return { results: results.slice(0, limit), truncated };
}

// Tags with the number of notes that use them: [{ tag, count }], most used first.
function tagCounts(index) {
  const map = new Map();
  for (const n of index.notes.values()) {
    for (const t of n.tags) {
      const k = Core.tagKey(t.tag);
      const e = map.get(k) || { tag: t.tag, count: 0 };
      e.count++;
      map.set(k, e);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ---------- wiki links ----------
function lookups(index) {
  if (index._byName) return index;
  const byName = new Map();
  const byTitle = new Map();
  const push = (m, k, n) => (m.get(k) || m.set(k, []).get(k)).push(n);
  for (const n of index.notes.values()) {
    push(byName, Core.tagKey(n.name), n);
    if (n.title) push(byTitle, Core.tagKey(n.title), n);
  }
  index._byName = byName;
  index._byTitle = byTitle;
  return index;
}

// Which note does `[[target]]` (written in `fromFile`) point to? File name without extension first, then the
// front-matter title; the closest one wins when several match. Returns the note or null.
function resolveLink(index, target, fromFile) {
  lookups(index);
  const key = Core.linkKey(target);
  if (!key) return null;
  const slash = key.lastIndexOf('/');
  const leaf = slash === -1 ? key : key.slice(slash + 1);
  let found = index._byName.get(leaf) || (slash === -1 ? index._byTitle.get(key) : null) || [];
  if (slash !== -1) found = found.filter((n) => Core.tagKey(n.path.replace(NOTE_EXT, '')).endsWith('/' + key));
  if (!found.length) return null;
  const dir = fromFile ? path.dirname(fromFile) : '';
  const dist = (n) => {
    const rel = path.relative(dir, path.dirname(n.path));
    return rel === '' ? 0 : rel.split(path.sep).length;
  };
  return [...found].sort((a, b) => (dir ? dist(a) - dist(b) : 0) || (a.path < b.path ? -1 : 1))[0];
}

// Notes that link to `file` → [{ path, name, rel, line, snippet }] (one row per link).
function backlinks(index, file) {
  const out = [];
  for (const n of [...index.notes.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (n.path === file) continue;
    for (const l of n.links) {
      const to = resolveLink(index, l.target, n.path);
      if (to && to.path === file) out.push(brief(index, n, { line: l.line, snippet: l.snippet }));
    }
  }
  return out;
}

// Everything `[[` can complete to: [{ name, title, rel }].
function names(index, exceptFile) {
  return [...index.notes.values()]
    .filter((n) => n.path !== exceptFile)
    .map((n) => ({ name: n.name, title: n.title, rel: relOf(index, n.path) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Where a click on a missing [[target]] creates the note: beside the current note (or in the notes folder).
function newNotePath({ target, fromFile, notesDir }) {
  const dir = fromFile ? path.dirname(fromFile) : notesDir;
  const leaf = Core.linkName(target).split('/').pop();
  return { dir, file: path.join(dir, Gantt.safeName(leaf) + '.md'), title: leaf.trim() };
}

function createNote(info) {
  const { dir, file, title } = newNotePath(info);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${title}\n\n`);
  return file;
}

// ---------- cached index per set of roots ----------
const caches = new Map(); // roots key → { cache: Map, index, at, pending }
const FRESH_MS = 1500;

async function getIndex(roots, { force = false } = {}) {
  const key = roots.join('\n');
  const slot = caches.get(key) || caches.set(key, { cache: new Map(), index: null, at: 0, pending: null }).get(key);
  if (slot.pending) return slot.pending;
  if (!force && slot.index && Date.now() - slot.at < FRESH_MS) return slot.index;
  slot.pending = scan(roots, slot.cache)
    .then((index) => {
      slot.index = index;
      slot.at = Date.now();
      return index;
    })
    .finally(() => (slot.pending = null));
  return slot.pending;
}

const forget = () => caches.clear();

module.exports = { parseNote, rootsFor, scan, search, tagCounts, resolveLink, backlinks, names, newNotePath, createNote, getIndex, forget, relOf };
