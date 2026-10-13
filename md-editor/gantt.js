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
  const add = (kind, num, label, start, end) => {
    if (!start || !end) return;
    out.push({ id: `${c.id}|${kind}|${num}`, course: c.name || '', kind, label: String(label).trim(), start, end });
  };
  const theme = themeOf(c.category);
  const sessions = Array.isArray(c.sessions) ? c.sessions : [];

  if (theme === 'nc') {
    (c.submissions || []).forEach((s, i) => {
      const num = s.num || i + 1;
      add('research_submit', num, s.title || `Submit lần ${num}`, s.date, s.date);
    });
  } else if (theme === 'tv') {
    (c.deliverables || []).forEach((d, i) => {
      const num = d.num || i + 1;
      add('consulting_deliverable', num, d.title || `Sản phẩm ${num}`, d.date, d.date);
    });
  } else {
    const macroDays = c.macroDays === undefined || c.macroDays === null || isNaN(parseInt(c.macroDays, 10)) ? 7 : parseInt(c.macroDays, 10);
    if (macroDays > 0 && sessions.length) {
      const first = sessions[0].prepStart || sessions[0].teachDate;
      if (first) add('macro', 0, 'Đề cương', addDays(first, -macroDays), addDays(first, -1));
    }
    sessions.forEach((s, i) => {
      const num = s.num || i + 1;
      const title = String(s.title || '').trim();
      const label = /^Buổi\s*\d+/i.test(title) ? title : `Buổi ${num}${title ? ': ' + title : ''}`;
      if (s.prepStart && s.teachDate && s.prepStart < s.teachDate) {
        add('session_prep', num, 'Prep ' + label.charAt(0).toLowerCase() + label.slice(1), s.prepStart, addDays(s.teachDate, -1));
      }
      add('session_teach', num, label, s.teachDate, s.teachDate);
    });
    if (c.hasEvaluation !== false && c.evaluation) {
      add('eval', 0, c.evaluation.name || 'Chấm thi', c.evaluation.start, c.evaluation.end);
    }
  }
  return out;
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
  const since = opts.today ? addDays(opts.today, -(opts.sinceDays ?? 14)) : '';
  const blocks = [];
  for (const c of Array.isArray(courses) ? courses : []) {
    if (!c || !c.id) continue;
    for (const b of courseBlocks(c)) {
      if (since && b.end < since) continue;
      blocks.push({ ...b, notePath: (links[b.id] && links[b.id].path) || '' });
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

module.exports = { readBlocks, courseBlocks, addDays, safeName, noteFrontMatter, blockOfText, findNote };
