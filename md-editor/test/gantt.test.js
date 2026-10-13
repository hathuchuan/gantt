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
  assert.deepStrictEqual(by('c1|macro|0'), { id: 'c1|macro|0', course: 'Quản trị Chiến lược', kind: 'macro', label: 'Đề cương', start: '2026-10-08', end: '2026-10-14', notePath: '' });
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
