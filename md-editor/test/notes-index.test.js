const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const I = require('../notes-index.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-index-'));
  const w = (rel, text) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return f;
  };
  const files = {
    plan: w('Kế hoạch.md', '---\ntitle: Project Plan\ntags: [work, q4]\n---\n# Kế hoạch\nLàm #việc quan trọng. See [[Ideas]] and [[idea list|the list]].\nSecond line mentions ROADMAP.\n'),
    ideas: w('sub/Ideas.md', '# Ideas\nlink back: [[kế hoạch]] and [[Project Plan]]\n`[[Kế hoạch]]` is code\n#work #idea\n'),
    list: w('sub/Idea List.md', 'roadmap again\n[[Ideas]]\n'),
    other: w('other/Ideas.md', 'a second Ideas note, links [[Ideas]]\n'),
    txt: w('notes.txt', 'plain roadmap text\n'),
    hidden: w('.hidden/secret.md', 'roadmap secret\n'),
    junk: w('node_modules/pkg/readme.md', 'roadmap in node_modules\n'),
    image: w('pic.png', 'not a note'),
  };
  return { root, files };
}

test('scan finds notes recursively, skipping hidden folders, node_modules and non-notes', async () => {
  const { root, files } = fixture();
  const index = await I.scan([root]);
  assert.deepStrictEqual([...index.notes.keys()].sort(), [files.plan, files.ideas, files.list, files.other, files.txt].sort());
  const plan = index.notes.get(files.plan);
  assert.strictEqual(plan.name, 'Kế hoạch');
  assert.strictEqual(plan.title, 'Project Plan');
  assert.deepStrictEqual(plan.tags.map((t) => t.tag), ['work', 'q4', 'việc']);
  assert.deepStrictEqual(plan.links.map((l) => l.target), ['Ideas', 'idea list']);
  assert.strictEqual(I.relOf(index, files.ideas), 'sub/Ideas.md');
  fs.rmSync(root, { recursive: true, force: true });
});

test('cache: unchanged files are reused, changed ones are re-read, deleted ones vanish', async () => {
  const { root, files } = fixture();
  const cache = new Map();
  const a = await I.scan([root], cache);
  const before = a.notes.get(files.list);
  const b = await I.scan([root], cache);
  assert.strictEqual(b.notes.get(files.list), before); // same object: not re-read
  fs.writeFileSync(files.list, 'changed content with roadmap\n');
  fs.utimesSync(files.list, new Date(), new Date(Date.now() + 5000));
  const c = await I.scan([root], cache);
  assert.notStrictEqual(c.notes.get(files.list), before);
  assert.match(c.notes.get(files.list).text, /^changed/);
  fs.unlinkSync(files.list);
  const d = await I.scan([root], cache);
  assert.ok(!d.notes.has(files.list) && !cache.has(files.list));
  fs.rmSync(root, { recursive: true, force: true });
});

test('maxFiles stops the scan and says so', async () => {
  const { root } = fixture();
  const index = await I.scan([root], new Map(), { maxFiles: 2 });
  assert.strictEqual(index.truncated, true);
  assert.ok(index.notes.size <= 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('search: case-insensitive, with file, line and snippet; tag filter; limits', async () => {
  const { root, files } = fixture();
  const index = await I.scan([root]);
  const r = I.search(index, 'roadmap').results;
  assert.deepStrictEqual(r.map((x) => [x.name, x.line]).sort(), [['Idea List', 1], ['Kế hoạch', 7], ['notes', 1]]);
  const hit = r.find((x) => x.name === 'Kế hoạch');
  assert.strictEqual(hit.snippet, 'Second line mentions ROADMAP.');
  assert.strictEqual(hit.col, 21);
  assert.strictEqual(hit.len, 7);
  assert.strictEqual(hit.path, files.plan);
  assert.strictEqual(hit.rel, 'Kế hoạch.md');
  assert.strictEqual(I.search(index, 'roadmap', { caseSensitive: true }).results.length, 2);
  assert.strictEqual(I.search(index, 'LÀM').results.length, 1); // Vietnamese case folding
  assert.deepStrictEqual(I.search(index, '   ').results, []);
  // tag filter: with text, and alone (one row per note at the tag's line)
  assert.deepStrictEqual(I.search(index, 'roadmap', { tag: '#work' }).results.map((x) => x.name), ['Kế hoạch']);
  const tagged = I.search(index, '', { tag: 'work' }).results;
  assert.deepStrictEqual(tagged.map((x) => x.name).sort(), ['Ideas', 'Kế hoạch']);
  assert.strictEqual(tagged.find((x) => x.name === 'Ideas').line, 4);
  assert.strictEqual(tagged.find((x) => x.name === 'Kế hoạch').line, 3); // front matter line
  const lim = I.search(index, 'a', { limit: 3 });
  assert.strictEqual(lim.results.length, 3);
  assert.strictEqual(lim.truncated, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('tag counts: notes per tag, most used first', async () => {
  const { root } = fixture();
  const counts = I.tagCounts(await I.scan([root]));
  assert.deepStrictEqual(counts.map((t) => [t.tag, t.count]), [['work', 2], ['idea', 1], ['q4', 1], ['việc', 1]]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveLink: file name, case, front-matter title, folder paths, closest wins', async () => {
  const { root, files } = fixture();
  const index = await I.scan([root]);
  const r = (t, from) => (I.resolveLink(index, t, from) || {}).path || null;
  assert.strictEqual(r('Kế hoạch', files.ideas), files.plan);
  assert.strictEqual(r('KẾ HOẠCH.md', files.ideas), files.plan);
  assert.strictEqual(r('Project Plan', files.ideas), files.plan); // front-matter title
  assert.strictEqual(r('Kế hoạch#Heading', files.ideas), files.plan); // anchors ignored
  assert.strictEqual(r('idea list', files.plan), files.list);
  assert.strictEqual(r('missing', files.plan), null);
  assert.strictEqual(r('', files.plan), null);
  // two notes named Ideas: the one in the same folder as the linking note wins
  assert.strictEqual(r('Ideas', files.list), files.ideas);
  assert.strictEqual(r('Ideas', files.other), files.other);
  assert.strictEqual(r('other/Ideas', files.plan), files.other);
  assert.strictEqual(r('sub/ideas', files.plan), files.ideas);
  assert.strictEqual(r('nope/Ideas', files.plan), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('backlinks: notes linking to a note, with line and snippet; code and self links ignored', async () => {
  const { root, files } = fixture();
  const index = await I.scan([root]);
  const back = I.backlinks(index, files.plan);
  assert.deepStrictEqual(back.map((b) => [b.name, b.line]), [['Ideas', 2], ['Ideas', 2]]); // [[kế hoạch]] and [[Project Plan]]; the code one is skipped
  assert.ok(back[0].snippet.includes('[[kế hoạch]]'));
  assert.strictEqual(back[0].path, files.ideas);
  // [[Ideas]] from sub/ resolves to the Ideas.md in sub/. From the notes root both are one folder away: alphabetical path decides (other/).
  assert.deepStrictEqual(I.backlinks(index, files.ideas).map((b) => b.name), ['Idea List']);
  assert.deepStrictEqual(I.backlinks(index, files.other).map((b) => b.name), ['Kế hoạch']); // its own [[Ideas]] is not a backlink
  fs.rmSync(root, { recursive: true, force: true });
});

test('names for [[ autocomplete exclude the current note', async () => {
  const { root, files } = fixture();
  const names = I.names(await I.scan([root]), files.plan);
  assert.ok(!names.some((n) => n.name === 'Kế hoạch'));
  assert.deepStrictEqual(names.map((n) => n.rel).filter((r) => r.endsWith('Ideas.md')).sort(), ['other/Ideas.md', 'sub/Ideas.md']);
  assert.strictEqual(names.find((n) => n.name === 'Idea List').rel, 'sub/Idea List.md');
  fs.rmSync(root, { recursive: true, force: true });
});

test('creating the target of a missing link: beside the current note, safe name, never overwrites', () => {
  const { root, files } = fixture();
  const info = I.newNotePath({ target: 'New: idea/Deep Dive#h', fromFile: files.ideas, notesDir: root });
  assert.strictEqual(info.dir, path.dirname(files.ideas));
  assert.strictEqual(info.file, path.join(path.dirname(files.ideas), 'Deep Dive.md'));
  assert.strictEqual(info.title, 'Deep Dive');
  const made = I.createNote({ target: 'Fresh Note', fromFile: files.ideas, notesDir: root });
  assert.strictEqual(made, path.join(path.dirname(files.ideas), 'Fresh Note.md'));
  assert.strictEqual(fs.readFileSync(made, 'utf8'), '# Fresh Note\n\n');
  fs.writeFileSync(made, 'mine');
  I.createNote({ target: 'Fresh Note', fromFile: files.ideas, notesDir: root });
  assert.strictEqual(fs.readFileSync(made, 'utf8'), 'mine');
  // an unsaved note has no folder: the notes folder is used
  assert.strictEqual(I.newNotePath({ target: 'X', fromFile: '', notesDir: root }).dir, root);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rootsFor: notes folder + the note folder, nested folders collapse, missing ones dropped', () => {
  const { root, files } = fixture();
  const sub = path.dirname(files.ideas);
  assert.deepStrictEqual(I.rootsFor({ file: files.ideas, notesDir: root }), [path.resolve(root)]);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-else-'));
  assert.deepStrictEqual(I.rootsFor({ file: path.join(elsewhere, 'a.md'), notesDir: root }).sort(), [path.resolve(root), path.resolve(elsewhere)].sort());
  assert.deepStrictEqual(I.rootsFor({ file: null, notesDir: root }), [path.resolve(root)]);
  assert.deepStrictEqual(I.rootsFor({ file: path.join(sub, 'x.md'), notesDir: '/definitely/not/here' }), [path.resolve(sub)]);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

test('getIndex caches per set of roots and can be forced to rescan', async () => {
  const { root, files } = fixture();
  I.forget();
  const a = await I.getIndex([root]);
  assert.strictEqual(await I.getIndex([root]), a); // fresh: same scan
  fs.writeFileSync(path.join(root, 'late.md'), 'late arrival');
  assert.ok(!(await I.getIndex([root])).notes.has(path.join(root, 'late.md')));
  assert.ok((await I.getIndex([root], { force: true })).notes.has(path.join(root, 'late.md')));
  assert.ok(files.plan);
  I.forget();
  fs.rmSync(root, { recursive: true, force: true });
});
