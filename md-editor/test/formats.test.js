const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/formats.js');
const E = require('../src/editing.js');

const run = (v, ed) => {
  assert.ok(ed, 'expected an edit');
  const out = v.slice(0, ed.from) + ed.text + v.slice(ed.to);
  const sel = out.slice(ed.selStart, ed.selEnd);
  return out.slice(0, ed.selStart) + '|' + (sel ? sel + '|' : '') + out.slice(ed.selEnd);
};
const at = (v) => [v.replace('|', ''), v.indexOf('|')];

test('file kind comes from the extension', () => {
  assert.strictEqual(F.kindOf('a.html'), 'html');
  assert.strictEqual(F.kindOf('A.HTM'), 'html');
  assert.strictEqual(F.kindOf('data.json'), 'json');
  assert.strictEqual(F.kindOf('note.md'), 'md');
  assert.strictEqual(F.kindOf('Untitled'), 'md');
  assert.strictEqual(F.kindOf(undefined), 'md');
});

test('jsonCheck accepts valid JSON and describes the first mistake otherwise', () => {
  assert.ok(F.jsonCheck('{"a": [1, 2, {"b": null}], "c": "x"}').ok);
  assert.ok(F.jsonCheck(' [ ] ').ok);
  assert.ok(F.jsonCheck('"text"').ok);
  assert.strictEqual(F.jsonCheck('  \n').empty, true);
  const cases = [
    ['{"a": 1,}', 1, /Extra comma before “}”/],
    ['[1, 2,]', 1, /Extra comma before “]”/],
    ["{'a': 1}", 1, /double quotes/],
    ['{a: 1}', 1, /double quotes/],
    ['{"a" 1}', 1, /“:”/],
    ['{"a": 1 "b": 2}', 1, /comma/],
    ['{"a": 1', 1, /ends too early/],
    ['{"a": "x\ny"}', 1, /line break/],
    ['{"a": tru}', 1, /double quotes/],
    ['{"a": 01}', 1, /after the end|Expected|valid/],
    ['// c\n{}', 1, /Comments/],
    ['{} {}', 1, /after the end/],
  ];
  for (const [text, line, msg] of cases) {
    const r = F.jsonCheck(text);
    assert.strictEqual(r.ok, false, text);
    assert.match(r.message, msg, text);
    assert.ok(r.line >= line, text);
  }
  const r = F.jsonCheck('{\n  "a": 1,\n  "b": 2,\n}');
  assert.deepStrictEqual([r.line, r.col], [4, 1]);
});

test('every JSON the parser rejects gets a located error, and none that it accepts does', () => {
  const samples = ['{', '}', '[', '[,]', '{"a":}', '{"a":1,,}', '"abc', '"\\x"', '-', '1.', '.5', '[1 2]', 'nul', '{"a":1}}', '\u0000'];
  for (const s of samples) {
    let valid = true;
    try {
      JSON.parse(s);
    } catch {
      valid = false;
    }
    const r = F.jsonCheck(s);
    assert.strictEqual(r.ok, valid, JSON.stringify(s));
    if (!valid) assert.ok(r.message && r.line >= 1 && r.col >= 1, JSON.stringify(s));
  }
});

test('format, minify and sort keys', () => {
  assert.strictEqual(F.jsonFormat('{"b":1,"a":[1,2]}'), '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
  assert.strictEqual(F.jsonMinify('{ "b": 1,\n "a": [1, 2] }'), '{"b":1,"a":[1,2]}\n');
  assert.strictEqual(F.jsonSortKeys('{"b":1,"a":{"d":1,"c":2}}'), '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n');
  assert.strictEqual(F.jsonFormat('{oops'), null);
});

test('enter keeps indentation and opens a level after { [ and tags', () => {
  let [v, i] = at('{|}');
  assert.strictEqual(run(v, F.onEnterCode('json', v, i, i)), '{\n  |\n}');
  [v, i] = at('  "a": [|]');
  assert.strictEqual(run(v, F.onEnterCode('json', v, i, i)), '  "a": [\n    |\n  ]');
  [v, i] = at('  "a": 1,|');
  assert.strictEqual(run(v, F.onEnterCode('json', v, i, i)), '  "a": 1,\n  |');
  [v, i] = at('{|');
  assert.strictEqual(run(v, F.onEnterCode('json', v, i, i)), '{\n  |');
  [v, i] = at('plain|');
  assert.strictEqual(F.onEnterCode('json', v, i, i), null);
  [v, i] = at('<div class="a">|</div>');
  assert.strictEqual(run(v, F.onEnterCode('html', v, i, i)), '<div class="a">\n  |\n</div>');
  [v, i] = at('  <ul>|');
  assert.strictEqual(run(v, F.onEnterCode('html', v, i, i)), '  <ul>\n    |');
  [v, i] = at('  <br>|');
  assert.strictEqual(run(v, F.onEnterCode('html', v, i, i)), '  <br>\n  |');
  [v, i] = at('<img src="a.png" />|');
  assert.strictEqual(F.onEnterCode('html', v, i, i), null);
});

test('JSON quotes and brackets pair up and step over', () => {
  let [v, i] = at('{|}');
  assert.strictEqual(run(v, F.autoPairCode('json', v, i, i, '"')), '{"|"}');
  [v, i] = at('{"a|"}');
  assert.strictEqual(run(v, F.autoPairCode('json', v, i, i, '"')), '{"a"|}');
  [v, i] = at('[|]');
  assert.strictEqual(run(v, F.autoPairCode('json', v, i, i, ']')), '[]|');
  [v, i] = at('|');
  assert.strictEqual(run(v, F.autoPairCode('json', v, i, i, '{')), '{|}');
  [v, i] = at('{"a": 12|3}');
  assert.strictEqual(F.autoPairCode('json', v, i, i, '"'), null);
  assert.strictEqual(run('x', F.autoPairCode('json', 'x', 0, 1, '"')), '"|x|"');
  assert.strictEqual(F.autoPairCode('json', '', 0, 0, 'a'), null);
  [v, i] = at('{""|}');
  assert.strictEqual(run(v, F.onBackspaceCode('json', v, i - 1, i - 1)), '{|}');
  assert.strictEqual(F.onBackspaceCode('md', '""', 1, 1), null);
});

test('HTML: > closes the tag, = opens quotes, void tags are left alone', () => {
  let [v, i] = at('<div|');
  assert.strictEqual(run(v, F.autoPairCode('html', v, i, i, '>')), '<div>|</div>');
  [v, i] = at('  <a href="x"|');
  assert.strictEqual(run(v, F.autoPairCode('html', v, i, i, '>')), '  <a href="x">|</a>');
  [v, i] = at('<br|');
  assert.strictEqual(F.autoPairCode('html', v, i, i, '>'), null);
  [v, i] = at('<br /|');
  assert.strictEqual(F.autoPairCode('html', v, i, i, '>'), null);
  [v, i] = at('<p|</p>');
  assert.strictEqual(F.autoPairCode('html', v, i, i, '>'), null);
  [v, i] = at('1 > 2|');
  assert.strictEqual(F.autoPairCode('html', v, i, i, '>'), null);
  [v, i] = at('<a href=|');
  assert.strictEqual(run(v, F.autoPairCode('html', v, i, i, '"')), '<a href="|"');
  [v, i] = at('<a href="x|">');
  assert.strictEqual(run(v, F.autoPairCode('html', v, i, i, '"')), '<a href="x"|>');
  assert.strictEqual(F.autoPairCode('md', 'x', 1, 1, '>'), null);
});

test('HTML shortcuts: wrap, link, heading', () => {
  assert.strictEqual(run('hi world', F.htmlWrap('hi world', 3, 8, 'strong')), 'hi <strong>|world|</strong>');
  assert.strictEqual(run('hi <strong>world</strong>', F.htmlWrap('hi <strong>world</strong>', 11, 16, 'strong')), 'hi |world|');
  assert.strictEqual(run('x ', F.htmlWrap('x ', 2, 2, 'em')), 'x <em>|</em>');
  assert.strictEqual(run('see docs', F.htmlLink('see docs', 4, 8)), 'see <a href="|https://|">docs</a>');
  assert.strictEqual(run('Title', F.htmlHeading('Title', 2, 1)), '<h1>Title|</h1>');
  assert.strictEqual(run('  Title', F.htmlHeading('  Title', 2, 2)), '  <h2>Title|</h2>');
  assert.strictEqual(run('<h2>Title</h2>', F.htmlHeading('<h2>Title</h2>', 3, 2)), 'Title|');
  assert.strictEqual(run('<h2>Title</h2>', F.htmlHeading('<h2>Title</h2>', 3, 3)), '<h3>Title|</h3>');
  assert.strictEqual(run('', F.htmlHeading('', 0, 1)), '<h1>|</h1>');
});

test('references to dropped files', () => {
  assert.strictEqual(F.htmlImage('my pic.png', 'A "cat"'), '<img src="my%20pic.png" alt="A &quot;cat&quot;">');
  assert.strictEqual(F.htmlFileLink('/a b/c.pdf'), '<a href="file:///a%20b/c.pdf">c.pdf</a>');
});

test('slash menu is filtered by file kind', () => {
  const items = E.buildItems({}, F.ITEMS);
  const keys = (q, kind, o) => E.filterSlash(q, items, { kind, ...o }).map((i) => i.key);
  assert.ok(keys('h1', 'html').includes('h1'));
  assert.ok(keys('h1', 'md').includes('h1'));
  assert.deepStrictEqual(E.filterSlash('h1', items, { kind: 'html' }).map((i) => i.id), ['html:h1']);
  assert.deepStrictEqual(E.filterSlash('h1', items, { kind: 'md' }).map((i) => i.id), ['h1']);
  assert.deepStrictEqual(keys('h1', 'json'), []);
  assert.ok(keys('pair', 'json').includes('pairnumber'));
  assert.ok(!keys('pair', 'md').length);
  assert.ok(keys('', 'html').length > 40 && keys('', 'json').length > 15);
  assert.ok(!keys('page', 'html', { lineStart: false }).includes('page')); // block commands hidden mid-line
});

test('items with the same key in different kinds are enabled / disabled independently', () => {
  const items = E.buildItems({ disabled: ['html:table'] }, F.ITEMS);
  assert.strictEqual(items.find((i) => i.id === 'html:table').enabled, false);
  assert.strictEqual(items.find((i) => i.id === 'table').enabled, true);
  const custom = E.buildItems({ custom: [{ key: 'table', kind: 'html', text: '<table>' }, { key: 'x', kind: 'nope', text: 'y' }] }, F.ITEMS);
  assert.strictEqual(custom.filter((i) => i.id === 'html:table').length, 1);
  assert.strictEqual(custom.find((i) => i.id === 'html:table').custom, true);
  assert.strictEqual(custom.find((i) => i.id === 'table').custom, undefined);
  assert.strictEqual(custom.find((i) => i.key === 'x').kind, 'md');
});

test('applying a command in code keeps the indentation of its line', () => {
  const item = F.HTML_ITEMS.find((i) => i.key === 'card');
  const v = '<body>\n  /card';
  const q = E.slashQuery(v, v.length);
  const out = run(v, E.applySlash(v, v.length, q.from, item, new Date(), { indent: true }));
  assert.strictEqual(out, '<body>\n  <div class="card">\n    <h3>Tiêu đề thẻ</h3>\n    <p>|Nội dung.</p>\n  </div>');
  const sel = F.HTML_ITEMS.find((i) => i.key === 'figure');
  const w = '  /fig';
  const r = E.applySlash(w, w.length, 2, sel, new Date(), { indent: true });
  assert.strictEqual(r.text.slice(r.selStart - 2, r.selEnd - 2), 'anh.jpg');
  const none = E.applySlash(w, w.length, 2, sel, new Date());
  assert.strictEqual(none.text.slice(none.selStart - 2, none.selEnd - 2), 'anh.jpg');
});

test('the page template and the year variable', () => {
  const page = F.htmlTemplate();
  assert.match(page, /^<!doctype html>/);
  assert.ok(page.includes('{cursor}') && !F.htmlTemplate({ cursor: false }).includes('{cursor}'));
  assert.ok(page.includes('.container') && page.includes('.btn'));
  const footer = F.HTML_ITEMS.find((i) => i.key === 'footer');
  assert.match(E.applySlash('/', 1, 0, footer, new Date(2030, 0, 1)).text, /© 2030/);
  assert.strictEqual(F.templateFor('md'), '');
  assert.ok(F.jsonCheck(F.templateFor('json')).ok);
});

test('every ready-made JSON command produces valid JSON where it should', () => {
  const now = new Date();
  for (const key of ['person', 'records', 'package', 'settings']) {
    const item = F.JSON_ITEMS.find((i) => i.key === key);
    const r = E.applySlash('/', 1, 0, item, now);
    // fill the placeholder the cursor stands on
    const json = r.text.replace(/"(")/g, '"$1');
    assert.ok(F.jsonCheck(json).ok, key + ': ' + json);
  }
});
