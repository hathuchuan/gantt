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

test('slash commands', () => {
  assert.strictEqual(E.slashQuery('abc /', 5), null);
  const v = 'x\n  /tod';
  const q = E.slashQuery(v, v.length);
  assert.deepStrictEqual(q, { query: 'tod', from: 4 });
  const items = E.filterSlash(q.query);
  assert.strictEqual(items[0].key, 'todo');
  assert.deepStrictEqual(run(v, E.applySlash(v, v.length, q.from, items[0])), ['x\n  - [ ] |']);
  const code = E.SLASH_ITEMS.find((i) => i.key === 'code');
  assert.deepStrictEqual(run('/', E.applySlash('/', 1, 0, code)), ['```\n|\n```']);
});
