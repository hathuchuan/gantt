const test = require('node:test');
const assert = require('node:assert');
const G = require('../gantt.js');

const courses = [
  {
    id: 'c1', name: 'Quản trị Chiến lược', category: 'Giảng dạy MBA', macroDays: 7, hasEvaluation: true,
    sessions: [
      { num: 1, title: 'Buổi 1: Giới thiệu', prepStart: '2026-10-15', teachDate: '2026-10-17' },
      { num: 2, title: 'Phân tích', prepStart: '2026-10-24', teachDate: '2026-10-24' },
    ],
    evaluation: { name: 'Chấm thi', start: '2026-11-01', end: '2026-11-10' },
  },
  { id: 'r1', name: 'Paper A', category: 'Nghiên cứu', submissions: [{ num: 1, title: 'Submit lần 1', date: '2026-12-01' }] },
  { id: 't1', name: 'Dự án X', category: 'Tư vấn', deliverables: [{ title: 'Final', date: '2026-09-01' }] },
];
const storage = {
  academic_smart_gantt: JSON.stringify(courses),
  academic_smart_gantt_notes: JSON.stringify({ 'c1|session_teach|1': { path: '/n/a.md' } }),
};

test('block ids, labels and dates mirror the Gantt app', () => {
  const blocks = G.readBlocks(storage);
  const by = (id) => blocks.find((b) => b.id === id);
  assert.deepStrictEqual(by('c1|macro|0'), { id: 'c1|macro|0', course: 'Quản trị Chiến lược', kind: 'macro', label: 'Đề cương', start: '2026-10-08', end: '2026-10-14', done: false, notePath: '' });
  assert.strictEqual(by('c1|session_prep|1').label, 'Prep buổi 1: Giới thiệu');
  assert.strictEqual(by('c1|session_prep|1').end, '2026-10-16');
  assert.strictEqual(by('c1|session_teach|1').label, 'Buổi 1: Giới thiệu'); // no "Buổi 1: Buổi 1:"
  assert.strictEqual(by('c1|session_teach|2').label, 'Buổi 2: Phân tích');
  assert.ok(!by('c1|session_prep|2')); // prepStart == teachDate → no prep bar
  assert.strictEqual(by('c1|eval|0').end, '2026-11-10');
  assert.strictEqual(by('r1|research_submit|1').start, '2026-12-01');
  assert.strictEqual(by('t1|consulting_deliverable|1').label, 'Final');
});

test('links and since filter', () => {
  const all = G.readBlocks(storage);
  assert.strictEqual(all.find((b) => b.id === 'c1|session_teach|1').notePath, '/n/a.md');
  const recent = G.readBlocks(storage, { today: '2026-10-20', sinceDays: 14 });
  assert.ok(!recent.some((b) => b.id.startsWith('t1')));
  assert.ok(recent.some((b) => b.id === 'c1|session_teach|1'));
  assert.deepStrictEqual(G.readBlocks({}), []);
  assert.deepStrictEqual(G.readBlocks({ academic_smart_gantt: '{bad' }), []);
});

test('safe names and note front matter', () => {
  assert.strictEqual(G.safeName('Buổi 1: A/B?'), 'Buổi 1- A-B-');
  assert.strictEqual(G.safeName('   '), 'Untitled');
  const fm = G.noteFrontMatter({ block: 'c1|session_teach|1', course: 'QTCL', label: 'Buổi 1', start: '2026-10-17', end: '2026-10-17' });
  assert.ok(fm.startsWith('---\ngantt-block: c1|session_teach|1\ngantt-title: QTCL — Buổi 1\n'));
  assert.ok(fm.endsWith('---\n\n# Buổi 1\n\n'));
});

test('findNote: given path, saved link, or a note tagged with the block anywhere in the notes folder', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-notes-'));
  const sub = path.join(root, 'Course', 'moved');
  fs.mkdirSync(sub, { recursive: true });
  const tag = (b) => G.noteFrontMatter({ block: b, course: 'C', label: 'L' });
  const one = path.join(sub, 'renamed.md');
  const ten = path.join(root, 'Course', 'ten.md');
  fs.writeFileSync(one, tag('c1|session_teach|1') + 'mine');
  fs.writeFileSync(ten, tag('c1|session_teach|10'));
  const stored = path.join(root, 'elsewhere.md');
  fs.writeFileSync(stored, 'plain');

  assert.strictEqual(G.blockOfText(tag('c1|x|1')), 'c1|x|1');
  assert.strictEqual(G.blockOfText('no front matter'), '');
  // 1. the path Gantt sent
  assert.strictEqual(G.findNote({ block: 'c1|session_teach|1', path: ten, notesDir: root }), ten);
  // 2. the link saved in Gantt's storage when the path is stale
  const storage = { academic_smart_gantt_notes: JSON.stringify({ 'c1|a|1': { path: stored } }) };
  assert.strictEqual(G.findNote({ block: 'c1|a|1', path: '/gone.md', storage, notesDir: root }), stored);
  // 3. scan: renamed/moved note is found by its front matter; block 1 is not confused with block 10
  assert.strictEqual(G.findNote({ block: 'c1|session_teach|1', path: '/gone.md', notesDir: root }), one);
  assert.strictEqual(G.findNote({ block: 'c1|session_teach|10', notesDir: root }), ten);
  assert.strictEqual(G.findNote({ block: 'c1|none|9', notesDir: root }), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('block status: done / overdue / active / upcoming with day counts', () => {
  const b = { start: '2026-10-10', end: '2026-10-19' };
  assert.deepStrictEqual(G.blockStatus({ ...b, done: true }, '2026-10-01'), { totalDays: 10, status: 'done', percent: 100, daysLeft: 0 });
  assert.deepStrictEqual(G.blockStatus(b, '2026-10-05'), { totalDays: 10, status: 'upcoming', percent: 0, daysTo: 5, daysLeft: 14 });
  assert.deepStrictEqual(G.blockStatus(b, '2026-10-14'), { totalDays: 10, status: 'active', percent: 50, daysLeft: 5 });
  assert.deepStrictEqual(G.blockStatus(b, '2026-10-19'), { totalDays: 10, status: 'active', percent: 100, daysLeft: 0 });
  assert.deepStrictEqual(G.blockStatus(b, '2026-10-22'), { totalDays: 10, status: 'overdue', percent: 100, daysLeft: -3 });
  assert.strictEqual(G.blockStatus({ start: '2026-10-17', end: '2026-10-17' }, '2026-10-17').totalDays, 1);
});

test('done flags come from the Gantt data; readBlocks can filter by course and show everything', () => {
  const done = JSON.parse(storage.academic_smart_gantt);
  done[0].macroDone = true;
  done[0].sessions[0].teachDone = true;
  const st = { ...storage, academic_smart_gantt: JSON.stringify(done) };
  const rows = G.readBlocks(st, { today: '2026-10-20', all: true, course: 'c1' });
  assert.ok(rows.every((r) => r.id.startsWith('c1|')));
  assert.ok(rows.some((r) => r.id === 'c1|macro|0' && r.done && r.status === 'done'));
  assert.ok(rows.some((r) => r.id === 'c1|session_teach|1' && r.done));
  assert.ok(rows.some((r) => r.id === 'c1|session_teach|2' && !r.done && r.status === 'upcoming'));
  const d = G.blockDetail({ block: 'c1|session_teach|2', storage: st, today: '2026-10-20' });
  assert.strictEqual(d.courseDone, 2);
  assert.strictEqual(d.courseTotal, 5);
  assert.strictEqual(G.blockDetail({ block: 'c1|none|9', storage: st, today: '2026-10-20' }), null);
});

test('projectNotes: notes of the same project from Gantt links and from front matter, in schedule order', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-proj-'));
  const dir = path.join(root, 'QTCL');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, block, label, start) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, G.noteFrontMatter({ block, course: 'Quản trị Chiến lược', label, start, end: start }));
    return f;
  };
  const two = write('b2.md', 'c1|session_teach|2', 'Buổi 2: Phân tích', '2026-10-24');
  const one = write('b1.md', 'c1|session_teach|1', 'Buổi 1: Giới thiệu', '2026-10-17');
  write('other.md', 'r1|research_submit|1', 'Submit lần 1', '2026-12-01'); // another project
  const linked = path.join(root, 'elsewhere.md');
  fs.writeFileSync(linked, 'plain');
  const st = { ...storage, academic_smart_gantt_notes: JSON.stringify({ 'c1|macro|0': { path: linked } }) };

  const r = G.projectNotes({ block: 'c1|session_teach|1', storage: st, notesDir: root, current: { block: 'c1|session_teach|1', path: one } });
  assert.strictEqual(r.course, 'Quản trị Chiến lược');
  assert.deepStrictEqual(r.notes.map((n) => n.block), ['c1|macro|0', 'c1|session_teach|1', 'c1|session_teach|2']);
  assert.deepStrictEqual(r.notes.map((n) => n.current), [false, true, false]);
  assert.strictEqual(r.notes[2].path, two);
  assert.strictEqual(r.notes[2].rel, 'b2.md');
  assert.strictEqual(r.notes[0].rel, '../elsewhere.md');
  assert.strictEqual(r.notes[2].label, 'Buổi 2: Phân tích');
  // a note whose link has not reached Gantt yet is still listed
  const lone = G.projectNotes({ block: 'zz|eval|0', storage: {}, notesDir: root, current: { block: 'zz|eval|0', path: two } });
  assert.deepStrictEqual(lone.notes.map((n) => n.block), ['zz|eval|0']);
  assert.deepStrictEqual(G.projectNotes({ block: '', storage: {} }), { course: '', notes: [] });
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- auto-updating /ganttblocks table (render + replace logic lives in src/editing.js) ----------
const E = require('../src/editing.js');
const NOW = new Date(2026, 9, 16);
const rows = (blocks) => G.readBlocks({ academic_smart_gantt: JSON.stringify(blocks) }, { today: '2026-10-16', all: true, course: 'c1' });
const tableFor = (done) => {
  const cs = JSON.parse(JSON.stringify(courses));
  cs[0].sessions[0].teachDone = done;
  return E.ganttBlocksBlock({ project: 'c1', course: 'Quản trị Chiến lược', blocks: rows(cs), now: NOW });
};

test('ganttBlocksBlock: markers with the project id, caption with date, table, blank line before the end marker', () => {
  const b = tableFor(false);
  const lines = b.split('\n');
  assert.strictEqual(lines[0], '<!-- gantt-blocks project="c1" -->');
  assert.strictEqual(lines[1], '**Quản trị Chiến lược** — tasks & deadlines (as of 2026-10-16)');
  assert.strictEqual(lines[3], '| Task | Start | Deadline | Days | Status |');
  assert.strictEqual(lines[lines.length - 2], '');
  assert.strictEqual(lines[lines.length - 1], '<!-- /gantt-blocks -->');
  assert.ok(b.includes('| Buổi 1: Giới thiệu | 2026-10-17 | 2026-10-17 | 1 | ⏳ Starts in 1 day |'));
  assert.deepStrictEqual(E.ganttBlocksProjects('x\n' + b + '\ny'), ['c1']);
  assert.ok(E.hasGanttBlocks(b) && !E.hasGanttBlocks('| Task | Start |\n| --- | --- |'));
  // odd project ids survive the round trip
  const odd = E.ganttBlocksBlock({ project: 'a"b-->c%', course: 'C', blocks: rows(courses).slice(0, 1), now: NOW });
  assert.strictEqual(odd.split('\n').length > 3, true);
  assert.deepStrictEqual(E.ganttBlocksProjects(odd), ['a"b-->c%']);
});

test('updateGanttBlocks rewrites only what is between the markers; no-op when current', () => {
  const doc = '# Notes\n\nbefore\n\n' + tableFor(false) + '\n\nafter text\n';
  assert.strictEqual(E.updateGanttBlocks(doc, new Map([['c1', tableFor(false)]])), null); // unchanged
  const out = E.updateGanttBlocks(doc, new Map([['c1', tableFor(true)]]));
  assert.ok(out.startsWith('# Notes\n\nbefore\n\n<!-- gantt-blocks project="c1" -->'));
  assert.ok(out.endsWith('<!-- /gantt-blocks -->\n\nafter text\n'));
  assert.ok(out.includes('✅ Done') && !doc.includes('✅ Done'));
  // a project Gantt no longer has (no entry) keeps its old table; text the user wrote inside the markers is replaced
  assert.strictEqual(E.updateGanttBlocks(doc, new Map([['zz', 'x']])), null);
  const edited = doc.replace('| Task |', '| MY EDIT |');
  assert.ok(!E.updateGanttBlocks(edited, new Map([['c1', tableFor(false)]])).includes('MY EDIT'));
  // two tables for two projects are refreshed independently
  const two = doc + '\n' + tableFor(false).replace('project="c1"', 'project="r1"');
  const r = E.updateGanttBlocks(two, new Map([['r1', '<!-- gantt-blocks project="r1" -->\nNEW\n<!-- /gantt-blocks -->']]));
  assert.ok(r.includes('NEW') && r.includes('project="c1"') && r.includes('Buổi 1'));
  assert.deepStrictEqual(E.ganttBlocksProjects(two), ['c1', 'r1']);
});

test('/ganttblocks inserts once: running it again refreshes in place instead of duplicating the markers', () => {
  const v = '# Plan\n\nintro\n';
  const first = E.upsertGanttBlocks(v, v.length, v.length, 'c1', tableFor(false));
  assert.strictEqual(first.replaced, false);
  const doc = v.slice(0, first.edit.from) + first.edit.text + v.slice(first.edit.to);
  assert.strictEqual((doc.match(/<!-- gantt-blocks /g) || []).length, 1);
  assert.ok(doc.startsWith('# Plan\n\nintro\n\n<!-- gantt-blocks project="c1" -->') && doc.endsWith('<!-- /gantt-blocks -->\n'));

  const caret = doc.length;
  const second = E.upsertGanttBlocks(doc, caret, caret, 'c1', tableFor(true));
  assert.strictEqual(second.replaced, true);
  const doc2 = doc.slice(0, second.edit.from) + second.edit.text + doc.slice(second.edit.to);
  assert.strictEqual((doc2.match(/<!-- gantt-blocks /g) || []).length, 1);
  assert.strictEqual((doc2.match(/<!-- \/gantt-blocks -->/g) || []).length, 1);
  assert.ok(doc2.includes('✅ Done') && doc2.startsWith('# Plan\n\nintro\n\n'));
  assert.ok(second.edit.selStart <= doc2.length);

  // another project may have its own table in the same note
  const other = E.upsertGanttBlocks(doc2, doc2.length, doc2.length, 'r1', tableFor(false).replace('project="c1"', 'project="r1"'));
  assert.strictEqual(other.replaced, false);
});

test('an old snapshot table (no markers) is left alone by every refresh', () => {
  const legacy = '**QT** — tasks & deadlines (as of 2026-09-01)\n\n' + E.ganttTable(rows(courses)) + '\n';
  assert.deepStrictEqual(E.ganttBlocksProjects(legacy), []);
  assert.strictEqual(E.updateGanttBlocks(legacy, new Map([['c1', tableFor(false)]])), null);
});
