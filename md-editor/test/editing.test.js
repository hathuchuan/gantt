const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/editing.js');

const run = (v, ed) => {
  assert.ok(ed, 'expected an edit');
  const out = v.slice(0, ed.from) + ed.text + v.slice(ed.to);
  const sel = out.slice(ed.selStart, ed.selEnd);
  return [out.slice(0, ed.selStart) + '|' + (sel ? sel + '|' : '') + out.slice(ed.selEnd)];
};
const at = (v) => { const i = v.indexOf('|'); return [v.replace('|', ''), i]; };

test('enter continues bullet, numbered and task lists', () => {
  let [v, i] = at('- one|');
  assert.deepStrictEqual(run(v, E.onEnter(v, i, i)), ['- one\n- |']);
  [v, i] = at('  9. nine|');
  assert.deepStrictEqual(run(v, E.onEnter(v, i, i)), ['  9. nine\n  10. |']);
  [v, i] = at('- [x] done|');
  assert.deepStrictEqual(run(v, E.onEnter(v, i, i)), ['- [x] done\n- [ ] |']);
});

test('enter on empty item leaves the list', () => {
  const [v, i] = at('- one\n- |');
  assert.deepStrictEqual(run(v, E.onEnter(v, i, i)), ['- one\n|']);
});

test('enter continues quotes; plain lines untouched', () => {
  let [v, i] = at('> hi|');
  assert.deepStrictEqual(run(v, E.onEnter(v, i, i)), ['> hi\n> |']);
  [v, i] = at('plain|');
  assert.strictEqual(E.onEnter(v, i, i), null);
});

test('tab indents / outdents lines', () => {
  let [v, i] = at('- a|');
  assert.deepStrictEqual(run(v, E.onTab(v, i, i, false)), ['  - a|']);
  [v, i] = at('  - a|');
  assert.deepStrictEqual(run(v, E.onTab(v, i, i, true)), ['- a|']);
  [v, i] = at('text|');
  assert.deepStrictEqual(run(v, E.onTab(v, i, i, false)), ['text  |']);
  assert.strictEqual(E.onTab('x', 1, 1, true), null);
  v = '- a\n- b';
  const ed = E.onTab(v, 0, v.length, false);
  assert.strictEqual(ed.text, '  - a\n  - b');
});

test('wrap toggles inline marks', () => {
  const v = 'hi world';
  assert.deepStrictEqual(run(v, E.wrap(v, 3, 8, '**')), ['hi **|world|**']);
  const w = 'hi **world**';
  assert.deepStrictEqual(run(w, E.wrap(w, 5, 10, '**')), ['hi |world|']);
  assert.deepStrictEqual(run(w, E.wrap(w, 3, 12, '**')), ['hi |world|']);
  assert.deepStrictEqual(run('x ', E.wrap('x ', 2, 2, '*')), ['x *|*']);
});

test('link and paste-url', () => {
  assert.deepStrictEqual(run('see docs', E.link('see docs', 4, 8)), ['see [docs](|url|)']);
  assert.deepStrictEqual(run('a', E.link('a', 1, 1)), ['a[|](url)']);
  const v = 'see docs';
  assert.deepStrictEqual(run(v, E.pasteUrl(v, 4, 8, 'https://x.io/a')), ['see [docs](https://x.io/a)|']);
  assert.strictEqual(E.pasteUrl(v, 4, 4, 'https://x.io'), null);
  assert.strictEqual(E.pasteUrl(v, 4, 8, 'not a url'), null);
});

test('auto pair, step over, wrap selection, backspace', () => {
  assert.deepStrictEqual(run('', E.autoPair('', 0, 0, '(')), ['(|)']);
  assert.strictEqual(E.autoPair('ab', 1, 1, '('), null);
  assert.deepStrictEqual(run('()', E.autoPair('()', 1, 1, ')')), ['()|']);
  assert.deepStrictEqual(run('hi', E.autoPair('hi', 0, 2, '_')), ['_|hi|_']);
  assert.deepStrictEqual(run('()', E.onBackspace('()', 1, 1)), ['|']);
  assert.strictEqual(E.onBackspace('(x)', 2, 2), null);
});

test('triple backtick expands to a code fence', () => {
  assert.deepStrictEqual(run('``', E.autoPair('``', 2, 2, '`')), ['```\n|\n```']);
});

test('heading toggles', () => {
  assert.deepStrictEqual(run('title', E.heading('title', 2, 2)), ['## title|']);
  assert.deepStrictEqual(run('# title', E.heading('# title', 3, 2)), ['## title|']);
  assert.deepStrictEqual(run('## title', E.heading('## title', 3, 2)), ['title|']);
});

test('slash query: line start and inline', () => {
  assert.strictEqual(E.slashQuery('abc /', 5), null);
  assert.strictEqual(E.slashQuery('a/b', 3), null);
  assert.deepStrictEqual(E.slashQuery('x\n  /tod', 8), { query: 'tod', from: 4, lineStart: true });
  assert.deepStrictEqual(E.slashQuery('see /fr', 7), { query: 'fr', from: 4, lineStart: false });
  assert.deepStrictEqual(E.slashQuery('/', 1), { query: '', from: 0, lineStart: true });
});

test('slash filter is a progressive prefix filter', () => {
  const keys = (q, o) => E.filterSlash(q, E.buildItems(), o).map((i) => i.key);
  const h = keys('h');
  assert.ok(h.includes('h1') && h.includes('highlight') && h.includes('hat'));
  const all = E.buildItems();
  assert.ok(h.every((k) => { const i = all.find((x) => x.key === k); return k.startsWith('h') || i.label.toLowerCase().startsWith('h'); }));
  assert.deepStrictEqual(keys('he'), ['h1', 'h2', 'h3']); // label prefix "Heading"
  assert.deepStrictEqual(keys('hi'), ['highlight', 'comment']); // key match first, then label ("Hidden comment")
  assert.deepStrictEqual(keys('hig'), ['highlight']);
  assert.ok(keys('').length > 50);
  // label prefix also matches ("Bullet list" via b)
  assert.ok(keys('b').includes('list'));
  // block commands are hidden mid-line
  assert.ok(!keys('h', { lineStart: false }).includes('h1'));
  assert.ok(keys('h', { lineStart: false }).includes('highlight'));
});

test('apply slash: cursor token, select, variables', () => {
  const v = 'x\n  /tod';
  const q = E.slashQuery(v, v.length);
  const todo = E.filterSlash(q.query, E.buildItems())[0];
  assert.strictEqual(todo.key, 'todo');
  assert.deepStrictEqual(run(v, E.applySlash(v, v.length, q.from, todo)), ['x\n  - [ ] |']);
  const get = (k) => E.SLASH_ITEMS.find((i) => i.key === k);
  assert.deepStrictEqual(run('/', E.applySlash('/', 1, 0, get('code'))), ['```\n|\n```']);
  assert.deepStrictEqual(run('/fr', E.applySlash('/fr', 3, 0, get('frac'))), ['\\frac{|}{}']);
  assert.deepStrictEqual(run('/m', E.applySlash('/m', 2, 0, get('math'))), ['$|$']);
  const now = new Date(2026, 9, 3, 9, 5);
  const tpl = { text: '## {weekday} {date} {time}\n{cursor}!' };
  assert.deepStrictEqual(run('/', E.applySlash('/', 1, 0, tpl, now)), ['## Saturday 2026-10-03 09:05\n|!']);
});

test('custom commands, overrides and disabling', () => {
  const items = E.buildItems({
    disabled: ['divider'],
    custom: [{ key: 'mtg', label: 'Meeting', text: '# Meeting' }, { key: 'bad key', text: 'x' }, { key: 'h1', text: '# {cursor}' }, { key: 'nope' }],
  });
  assert.strictEqual(items.find((i) => i.key === 'divider').enabled, false);
  assert.ok(!E.filterSlash('div', items).length);
  assert.strictEqual(E.filterSlash('mt', items)[0].custom, true);
  assert.strictEqual(items.filter((i) => i.key === 'h1').length, 1);
  assert.strictEqual(items.find((i) => i.key === 'h1').custom, true);
  assert.ok(!items.some((i) => i.key === 'bad key' || i.key === 'nope'));
});

test('front matter: attach, replace and clear the Gantt link', () => {
  const info = { block: 'c1|session_teach|1', course: 'QTCL', label: 'Buổi 1', start: '2026-10-17', end: '2026-10-17' };
  const apply = (v, ed) => v.slice(0, ed.from) + ed.text + v.slice(ed.to);
  let v = 'hello';
  let ed = E.setGantt(v, 0, 0, info);
  v = apply(v, ed);
  assert.strictEqual(v, '---\ngantt-block: c1|session_teach|1\ngantt-title: QTCL — Buổi 1\ngantt-start: 2026-10-17\ngantt-end: 2026-10-17\n---\n\nhello');
  assert.strictEqual(ed.selStart, v.length - 5);
  const p = E.parseFrontMatter(v);
  assert.strictEqual(p.meta['gantt-block'], 'c1|session_teach|1');
  assert.strictEqual(p.body, '\nhello');
  // clearing removes the whole block when only Gantt keys were there
  assert.strictEqual(apply(v, E.clearGantt(v, 0, 0)), '\nhello');
  // replacing keeps other keys
  v = '---\ntags: a\ngantt-block: old\ngantt-title: Old\n---\nbody';
  v = apply(v, E.setGantt(v, 0, 0, info));
  assert.ok(v.includes('tags: a') && !v.includes('Old') && v.endsWith('---\nbody'));
  v = apply(v, E.clearGantt(v, 0, 0));
  assert.strictEqual(v, '---\ntags: a\n---\nbody');
  assert.strictEqual(E.clearGantt('plain', 0, 0), null);
});

test('dropped files become links named after the file', () => {
  assert.strictEqual(E.fileLink('/Users/a/My Docs/báo cáo (v2).pdf'), '[báo cáo (v2).pdf](file:///Users/a/My%20Docs/b%C3%A1o%20c%C3%A1o%20%28v2%29.pdf)');
  assert.strictEqual(E.fileLink('/x/a_b[1].md'), '[a\\_b\\[1\\].md](file:///x/a_b%5B1%5D.md)');
  const ed = E.dropFiles('see: ', 5, 5, ['/a/one.pdf', '/a/two.png']);
  assert.strictEqual(ed.text, '[one.pdf](file:///a/one.pdf)\n[two.png](file:///a/two.png)');
  const mid = E.dropFiles('ab', 1, 1, ['/a/x.pdf']);
  assert.strictEqual(mid.text, ' [x.pdf](file:///a/x.pdf) ');
  assert.strictEqual(E.dropFiles('', 0, 0, []), null);
});

test('linkAt finds the target of the link under the caret', () => {
  const v = 'one [a](file:///x/a.pdf) and [b](https://e.com)\nnext';
  assert.strictEqual(E.linkAt(v, 8), 'file:///x/a.pdf');
  assert.strictEqual(E.linkAt(v, 35), 'https://e.com');
  assert.strictEqual(E.linkAt(v, 1), '');
  assert.strictEqual(E.linkAt(v, 26), '');
  assert.strictEqual(E.linkAt(E.fileLink('/u/a b.pdf'), 3), 'file:///u/a%20b.pdf');
});

test('image references are relative and percent-encoded; pasted images get a timestamp name', () => {
  assert.strictEqual(E.imageRef('my pic (1).png', 'a'), '![a](my%20pic%20%281%29.png)');
  assert.strictEqual(E.imageRef('image.png'), '![](image.png)');
  assert.strictEqual(E.pastedImageName(new Date(2026, 9, 13, 14, 5, 9), 'png'), 'image-20261013-140509.png');
  assert.ok(E.isImageName('A.JPG') && E.isImageName('x.webp') && !E.isImageName('x.pdf'));
});

test('insertSnippets puts one snippet per line with spacing around it', () => {
  const [v, i] = at('see|');
  assert.deepStrictEqual(run(v, E.insertSnippets(v, i, i, ['![](a.png)', '![](b.png)'])), ['see ![](a.png)\n![](b.png)|']);
  assert.strictEqual(E.insertSnippets('x', 0, 0, []), null);
});

test('insertBlock keeps a blank line before and after', () => {
  assert.strictEqual(E.insertBlock('ab', 1, 1, 'T').text, '\n\nT\n\n');
  assert.strictEqual(E.insertBlock('a\n\nb', 3, 3, 'T').text, 'T\n\n');
  assert.strictEqual(E.insertBlock('', 0, 0, 'T').text, 'T\n');
});

const PROJECT = {
  course: 'QTCL',
  notes: [
    { label: 'Buổi 1', start: '2026-10-17', end: '2026-10-17', rel: 'b 1.md', current: true },
    { label: 'Prep: [2]', start: '2026-10-24', end: '2026-10-26', rel: '../x/b2.md' },
    { label: 'Far', start: '', end: '', path: '/abs/far.md' },
  ],
};

test('project notes list: current note bold, others relative links, markers kept', () => {
  const b = E.projectNotesBlock(PROJECT);
  assert.strictEqual(
    b,
    [
      '<!-- project-notes -->',
      '**Notes in this project — QTCL**',
      '',
      '- **Buổi 1** · 2026-10-17 ← this note',
      '- [Prep: \\[2\\]](../x/b2.md) · 2026-10-24 → 2026-10-26',
      '- [Far](file:///abs/far.md)',
      '<!-- /project-notes -->',
    ].join('\n')
  );
});

test('updateProjectNotes refreshes in place, appends only on request, and is a no-op when current', () => {
  const body = '# T\n\ntext\n';
  assert.strictEqual(E.updateProjectNotes(body, PROJECT, false), null);
  const added = E.updateProjectNotes(body, PROJECT, true);
  assert.ok(added.startsWith('# T\n\ntext\n\n<!-- project-notes -->') && added.endsWith('<!-- /project-notes -->\n'));
  assert.strictEqual(E.updateProjectNotes(added, PROJECT, true), null);
  const changed = E.updateProjectNotes(added + 'after\n', { ...PROJECT, notes: PROJECT.notes.slice(0, 1) }, false);
  assert.ok(changed.includes('- **Buổi 1**') && !changed.includes('Far') && changed.endsWith('after\n'));
  assert.ok(E.hasProjectNotes(added) && !E.hasProjectNotes(body));
  assert.strictEqual(E.stripProjectNotes(added), '# T\n\ntext\n');
});

test('gantt tasks table', () => {
  const t = E.ganttTable([
    { label: 'A|B', start: '2026-10-01', end: '2026-10-02', totalDays: 2, status: 'active', daysLeft: 1 },
    { label: 'C', start: '2026-10-01', end: '2026-10-01', totalDays: 1, status: 'done' },
    { label: 'D', start: '2026-09-01', end: '2026-09-02', totalDays: 2, status: 'overdue', daysLeft: -3 },
    { label: 'E', start: '2026-11-01', end: '2026-11-02', totalDays: 2, status: 'upcoming', daysTo: 0, daysLeft: 1 },
  ]).split('\n');
  assert.strictEqual(t[0], '| Task | Start | Deadline | Days | Status |');
  assert.strictEqual(t[2], '| A\\|B | 2026-10-01 | 2026-10-02 | 2 | 🔄 In progress — 1 day left |');
  assert.strictEqual(t[3], '| C | 2026-10-01 | 2026-10-01 | 1 | ✅ Done |');
  assert.ok(t[4].endsWith('⚠️ Overdue by 3 days |'));
  assert.ok(t[5].endsWith('⏳ Starts today |'));
});

test('slash menu offers /ganttblocks and /projectnotes', () => {
  const keys = E.SLASH_ITEMS.filter((i) => i.action).map((i) => i.key + ':' + i.action);
  assert.ok(keys.includes('ganttblocks:gantt-table') && keys.includes('projectnotes:project-notes'));
  assert.deepStrictEqual(E.filterSlash('ganttb').map((i) => i.key), ['ganttblocks']);
});
