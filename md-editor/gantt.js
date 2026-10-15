// Reads the Academic Gantt data (storage.json) and lists its time blocks.
// Block ids and labels mirror describeBlock() in the Gantt app (web/academic_gantt_planner.html):
//   "<courseId>|<kind>|<num>"  with kind = macro | session_prep | session_teach | eval | research_submit | consulting_deliverable
const pad = (n) => String(n).padStart(2, '0');

function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function themeOf(category) {
  const lower = String(category || '').toLowerCase();
  if (lower.includes('tư vấn')) return 'tv';
  if (lower.includes('nghiên cứu') || lower.includes('đề tài')) return 'nc';
  return 'teach';
}

function courseBlocks(c) {
  const out = [];
  const add = (kind, num, label, start, end, done) => {
    if (!start || !end) return;
    out.push({ id: `${c.id}|${kind}|${num}`, course: c.name || '', kind, label: String(label).trim(), start, end, done: !!done });
  };
  const theme = themeOf(c.category);
  const sessions = Array.isArray(c.sessions) ? c.sessions : [];

  if (theme === 'nc') {
    (c.submissions || []).forEach((s, i) => {
      const num = s.num || i + 1;
      add('research_submit', num, s.title || `Submit lần ${num}`, s.date, s.date, s.done);
    });
  } else if (theme === 'tv') {
    (c.deliverables || []).forEach((d, i) => {
      const num = d.num || i + 1;
      add('consulting_deliverable', num, d.title || `Sản phẩm ${num}`, d.date, d.date, d.done);
    });
  } else {
    const macroDays = c.macroDays === undefined || c.macroDays === null || isNaN(parseInt(c.macroDays, 10)) ? 7 : parseInt(c.macroDays, 10);
    if (macroDays > 0 && sessions.length) {
      const first = sessions[0].prepStart || sessions[0].teachDate;
      if (first) add('macro', 0, 'Đề cương', addDays(first, -macroDays), addDays(first, -1), c.macroDone);
    }
    sessions.forEach((s, i) => {
      const num = s.num || i + 1;
      const title = String(s.title || '').trim();
      const label = /^Buổi\s*\d+/i.test(title) ? title : `Buổi ${num}${title ? ': ' + title : ''}`;
      if (s.prepStart && s.teachDate && s.prepStart < s.teachDate) {
        add('session_prep', num, 'Prep ' + label.charAt(0).toLowerCase() + label.slice(1), s.prepStart, addDays(s.teachDate, -1), s.prepDone);
      }
      add('session_teach', num, label, s.teachDate, s.teachDate, s.teachDone);
    });
    if (c.hasEvaluation !== false) {
      if (c.evaluation) add('eval', 0, c.evaluation.name || 'Chấm thi', c.evaluation.start, c.evaluation.end, c.evaluation.done);
      (c.extraEvaluations || []).forEach((e, i) => {
        if (e) add('eval', i + 1, e.name || 'Chấm thi', e.start, e.end, e.done);
      });
    }
  }
  return out;
}

const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const diffDays = (a, b) => dayNumber(b) - dayNumber(a);

// Where a block stands today: done / overdue / active / upcoming, with day counts and the elapsed share of its span.
function blockStatus(b, today) {
  const totalDays = diffDays(b.start, b.end) + 1;
  const base = { totalDays };
  if (b.done) return { ...base, status: 'done', percent: 100, daysLeft: 0 };
  if (today < b.start) return { ...base, status: 'upcoming', percent: 0, daysTo: diffDays(today, b.start), daysLeft: diffDays(today, b.end) };
  if (today > b.end) return { ...base, status: 'overdue', percent: 100, daysLeft: diffDays(today, b.end) };
  const elapsed = diffDays(b.start, today) + 1;
  return { ...base, status: 'active', percent: Math.round((100 * elapsed) / totalDays), daysLeft: diffDays(today, b.end) };
}

// storage: parsed storage.json ({ academic_smart_gantt: "<json>", academic_smart_gantt_notes: "<json>" })
function readBlocks(storage, opts = {}) {
  let courses = [];
  let links = {};
  try {
    courses = JSON.parse(storage.academic_smart_gantt || '[]');
  } catch {
    courses = [];
  }
  try {
    links = JSON.parse(storage.academic_smart_gantt_notes || '{}') || {};
  } catch {
    links = {};
  }
  const since = opts.today && !opts.all ? addDays(opts.today, -(opts.sinceDays ?? 14)) : '';
  const blocks = [];
  for (const c of Array.isArray(courses) ? courses : []) {
    if (!c || !c.id || (opts.course && c.id !== opts.course)) continue;
    for (const b of courseBlocks(c)) {
      if (since && b.end < since) continue;
      const row = { ...b, notePath: (links[b.id] && links[b.id].path) || '' };
      if (opts.today) Object.assign(row, blockStatus(b, opts.today));
      blocks.push(row);
    }
  }
  return blocks.sort((a, b) => a.start.localeCompare(b.start) || a.course.localeCompare(b.course));
}

// File-system friendly name.
const safeName = (s, max = 80) =>
  String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim() || 'Untitled';

function noteFrontMatter({ block, course, label, start, end }) {
  const one = (v) => String(v || '').replace(/\s*\n\s*/g, ' ').trim();
  const lines = [`gantt-block: ${one(block)}`, `gantt-title: ${one(course)} — ${one(label)}`];
  if (start) lines.push(`gantt-start: ${one(start)}`);
  if (end) lines.push(`gantt-end: ${one(end)}`);
  return `---\n${lines.join('\n')}\n---\n\n# ${one(label) || one(course)}\n\n`;
}

// ---------- finding the note that belongs to a block ----------
const fs = require('fs');
const nodePath = require('path');

const NOTE_EXT = /\.(md|markdown|txt)$/i;

// The `gantt-block:` value of a note's front matter ('' when it has none).
function blockOfText(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || '').replace(/^﻿/, ''));
  const line = fm && /^gantt-block:[ \t]*(.+?)[ \t]*$/m.exec(fm[1]);
  return line ? line[1] : '';
}

function readHead(file, bytes = 4096) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, bytes, 0));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const usable = (p) => typeof p === 'string' && nodePath.isAbsolute(p) && NOTE_EXT.test(p) && fs.existsSync(p);

// Looks through `dir` (a few levels deep) for a note tagged with `block`.
function scanForBlock(dir, block, depth = 4, budget = { files: 3000 }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = nodePath.join(dir, e.name);
    if (e.isFile() && NOTE_EXT.test(e.name)) {
      if (--budget.files < 0) return null;
      if (blockOfText(readHead(full)) === block) return full;
    }
  }
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const hit = scanForBlock(nodePath.join(dir, e.name), block, depth - 1, budget);
        if (hit) return hit;
      }
    }
  }
  return null;
}

// Where is the note of `block`? Tries the path Gantt sent, then the link saved in Gantt's storage,
// then any note in the notes folder whose front matter names the block (e.g. renamed or moved there).
function findNote({ block, path: given, storage, notesDir }) {
  if (usable(given)) return given;
  let links = {};
  try {
    links = JSON.parse((storage && storage.academic_smart_gantt_notes) || '{}') || {};
  } catch {}
  const saved = links[block] && links[block].path;
  if (usable(saved)) return saved;
  return (notesDir && scanForBlock(notesDir, block)) || null;
}

// ---------- notes of one project ----------
const courseIdOf = (block) => String(block || '').split('|')[0];

// All `key: value` pairs of a note's front matter.
function metaOfText(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || '').replace(/^﻿/, ''));
  const meta = {};
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const k = /^([\w-]+):[ \t]*(.*?)[ \t]*$/.exec(line);
      if (k) meta[k[1]] = k[2];
    }
  }
  return meta;
}

function walkNotes(dir, visit, depth = 4, budget = { files: 3000 }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = nodePath.join(dir, e.name);
    if (e.isFile() && NOTE_EXT.test(e.name)) {
      if (--budget.files < 0) return;
      visit(full);
    } else if (e.isDirectory() && depth > 0) walkNotes(full, visit, depth - 1, budget);
  }
}

const slashPath = (p) => String(p).split(nodePath.sep).join('/');

// Every note that belongs to the same Gantt project (course) as `block`, in schedule order.
// Sources: links saved in Gantt, plus notes in the notes folder whose front matter names a block of the project.
// `current` ({ block, path }) is the note asking; it is always part of the answer and flagged.
function projectNotes({ block, storage, notesDir, current }) {
  const course = courseIdOf(block);
  if (!course) return { course: '', notes: [] };
  const known = new Map(readBlocks(storage || {}).map((b) => [b.id, b]));
  const found = new Map(); // block id → { block, path, meta }

  let links = {};
  try {
    links = JSON.parse((storage && storage.academic_smart_gantt_notes) || '{}') || {};
  } catch {}
  for (const [id, l] of Object.entries(links)) {
    if (courseIdOf(id) === course && l && usable(l.path)) found.set(id, { block: id, path: l.path, meta: {} });
  }
  if (notesDir) {
    walkNotes(notesDir, (file) => {
      const meta = metaOfText(readHead(file));
      const id = meta['gantt-block'];
      if (id && courseIdOf(id) === course && !found.has(id)) found.set(id, { block: id, path: file, meta });
    });
  }
  if (current && current.block && courseIdOf(current.block) === course && current.path) {
    found.set(current.block, { ...(found.get(current.block) || {}), block: current.block, path: current.path, meta: (found.get(current.block) || {}).meta || {} });
  }

  let courseName = '';
  const notes = [...found.values()].map((f) => {
    const k = known.get(f.block);
    const title = String(f.meta['gantt-title'] || '');
    const cut = title.indexOf(' — ');
    if (k && k.course) courseName = k.course;
    else if (cut > 0 && !courseName) courseName = title.slice(0, cut);
    return {
      block: f.block,
      path: f.path,
      label: (k && k.label) || (cut > 0 ? title.slice(cut + 3) : title) || nodePath.basename(f.path).replace(NOTE_EXT, ''),
      start: (k && k.start) || f.meta['gantt-start'] || '',
      end: (k && k.end) || f.meta['gantt-end'] || '',
      current: !!(current && current.block === f.block),
      rel: current && current.path ? slashPath(nodePath.relative(nodePath.dirname(current.path), f.path)) : '',
    };
  });
  notes.sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
  return { course: courseName, notes };
}

// One block with its live status and the progress of its whole project.
function blockDetail({ block, storage, today }) {
  const course = courseIdOf(block);
  const all = readBlocks(storage || {}, { today, all: true, course });
  const b = all.find((x) => x.id === block);
  if (!b) return null;
  return { ...b, courseDone: all.filter((x) => x.done).length, courseTotal: all.length };
}

// Empty marker pair; MD Editor fills it with the list of the project's notes when the note is opened (same markers as src/editing.js).
const EMPTY_PROJECT_NOTES = '<!-- project-notes -->\n<!-- /project-notes -->\n';

module.exports = { EMPTY_PROJECT_NOTES, readBlocks, courseBlocks, addDays, safeName, noteFrontMatter, blockOfText, findNote, metaOfText, projectNotes, blockDetail, blockStatus, courseIdOf };
