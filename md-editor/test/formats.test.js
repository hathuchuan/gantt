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

const msgs = (html) => F.lintHtml(html).map((p) => p.severity[0] + ':' + p.message);

test('HTML lint: a clean page has no problems', () => {
  assert.deepStrictEqual(F.lintHtml(F.htmlTemplate({ cursor: false })), []);
  assert.deepStrictEqual(F.lintHtml('<ul><li>a<li>b</ul><table><tr><td>1<td>2</table><p>x<p>y'), []); // optional end tags
  assert.deepStrictEqual(F.lintHtml('<svg><path d="M0"/></svg><br><img src="a" alt="x"><!-- <b> -->'), []);
  assert.deepStrictEqual(F.lintHtml('<script>if (a < b && c > d) { x = "</p>" }</script>'), []);
  assert.deepStrictEqual(F.lintHtml(''), []);
});

test('HTML lint: tags that are not closed, or closed wrongly', () => {
  assert.deepStrictEqual(msgs('<div><span>hi</div>'), ['e:<span> is not closed before </div> — add </span>']);
  assert.deepStrictEqual(msgs('<div>hi'), ['e:<div> is never closed — add </div>']);
  assert.deepStrictEqual(msgs('<div></span></div>'), ['e:Unexpected </span> — there is no open <span> to close']);
  assert.deepStrictEqual(msgs('<b><i>x</b></i>').length, 2);
  const [p] = F.lintHtml('a\n<div><span>x</div>');
  assert.deepStrictEqual([p.line, p.col, p.len], [2, 6, 5]); // points at <span
});

test('HTML lint: broken tags, quotes, comments', () => {
  assert.match(msgs('<div <p>hi</p>')[0], /<div … is not finished/);
  assert.match(msgs('<a href="x>link</a>')[0], /quote after href= never closes|runs into another tag/);
  assert.match(msgs('<div class="a>text</div> <b class="y">z</b>')[1], /runs into another tag/);
  assert.match(msgs('<p id=>x</p>')[0], /has no value/);
  assert.match(msgs('<!-- never closed <p>x')[0], /comment never closes/);
  assert.match(msgs('<p>a</>')[0], /closing tag needs a name/);
  assert.match(msgs('<p>x <3 y</p>')[0], /^w:A lone “<”/);
  assert.match(msgs('<p>x</p ')[0], /not finished/);
});

test('HTML lint: warnings for things that work but are probably mistakes', () => {
  assert.deepStrictEqual(msgs('<img src="a.png">'), ['w:Add alt="…" to the image — it is read aloud and shown when the picture is missing']);
  assert.match(msgs('<p class="a" class="b">x</p>')[0], /^w:“class” is written twice/);
  assert.match(msgs('<p id="a">x</p><p id="a">y</p>')[0], /^w:id “a” is used more than once/);
  assert.match(msgs('<a href="x"id="y">z</a>')[0], /^w:Put a space/);
  assert.match(msgs('<br></br>')[0], /^w:<br> never has a closing tag/);
  assert.match(msgs('<html><body></body></html>')[0], /^w:Add <!doctype html>/);
  assert.match(msgs('<div/>')[0], /^w:In HTML <div \/> does not close itself/);
});

test('HTML lint: braces in <style> are checked', () => {
  assert.deepStrictEqual(msgs('<style>a { color: red; }</style>'), []);
  assert.deepStrictEqual(msgs('<style>a { content: "}"; } /* } */</style>'), []);
  assert.match(msgs('<style>a { color: red;</style><p>ok</p>')[0], /“\{” in the CSS is never closed/);
  assert.match(msgs('<style>a { } }</style>')[0], /Extra “\}” in the CSS/);
  const [p] = F.lintHtml('<style>\na {\n</style>');
  assert.strictEqual(p.line, 2);
});

test('lint() covers JSON too, and nothing for Markdown', () => {
  assert.deepStrictEqual(F.lint('json', '{"a": 1}'), []);
  assert.deepStrictEqual(F.lint('json', ''), []);
  const [p] = F.lint('json', '{"a": 1,}');
  assert.deepStrictEqual([p.severity, p.line, p.col, p.len], ['error', 1, 9, 1]);
  assert.deepStrictEqual(F.lint('md', '<div>'), []);
});

test('text style: colour, background, size through one span', () => {
  const v = 'say hello now';
  assert.strictEqual(run(v, F.htmlStyle(v, 4, 9, 'color', '#e03131')), 'say <span style="color: #e03131">|hello|</span> now');
  const w = 'say <span style="color: #e03131">hello</span> now';
  const h0 = w.indexOf('hello');
  assert.strictEqual(run(w, F.htmlStyle(w, h0, h0 + 5, 'color', '#1c7ed6')), 'say <span style="color: #1c7ed6">|hello|</span> now'); // inside the span: edited, not nested
  assert.strictEqual(run(w, F.htmlStyle(w, 4, w.indexOf(' now'), 'font-size', '1.5em')), 'say <span style="color: #e03131; font-size: 1.5em">|hello|</span> now'); // whole span selected
  assert.strictEqual(run(w, F.htmlStyle(w, h0, h0 + 5, 'color', '')), 'say |hello| now'); // last property removed: the span goes
  assert.strictEqual(F.htmlStyle(v, 4, 9, 'color', ''), null);
  assert.strictEqual(run('x', F.htmlStyle('x', 1, 1, 'color', 'red')), 'x<span style="color: red">|</span>');
  const two = '<span style="color: red">a</span> <span style="color: blue">b</span>';
  assert.strictEqual(run(two, F.htmlStyle(two, 0, two.length, 'font-size', '2em')), '<span style="font-size: 2em">|' + two + '|</span>'); // not one span: wrap
  assert.strictEqual(F.cssSet('color: red; font-size: 2em', 'color', ''), 'font-size: 2em');
});

test('alignment edits the block tag or wraps the lines', () => {
  assert.strictEqual(run('<p>Hi</p>', F.htmlAlign('<p>Hi</p>', 4, 4, 'center')).replace('|', ''), '<p style="text-align: center">Hi</p>');
  const c = '  <h2 style="color: red; text-align: right">Hi</h2>';
  assert.strictEqual(run(c, F.htmlAlign(c, 30, 30, 'center')).replace('|', ''), '  <h2 style="color: red; text-align: center">Hi</h2>');
  assert.strictEqual(run(c, F.htmlAlign(c, 30, 30, 'left')).replace('|', ''), '  <h2 style="color: red">Hi</h2>');
  assert.strictEqual(F.htmlAlign('plain', 0, 0, 'left'), null);
  assert.strictEqual(run('  plain\n  two', F.htmlAlign('  plain\n  two', 3, 11, 'right')), '  <div style="text-align: right">\n    plain\n    two\n  </div>|');
});

test('lists and quotes from the selected lines', () => {
  const v = 'a\nb\n\nc';
  assert.strictEqual(run(v, F.htmlList(v, 0, v.length, 'ul')), '<ul>\n  <li>a</li>\n  <li>b</li>\n  <li>c</li>\n</ul>|');
  assert.strictEqual(run('  x', F.htmlList('  x', 2, 3, 'ol')), '  <ol>\n    <li>x</li>\n  </ol>|');
  assert.strictEqual(run('', F.htmlList('', 0, 0, 'ul')), '<ul>\n  <li>|</li>\n</ul>');
  assert.strictEqual(run('one', F.htmlList('one', 0, 3, 'blockquote')), '<blockquote>\n  one\n</blockquote>|');
});

test('remove formatting strips format tags but keeps the text', () => {
  const v = 'a <strong><em>word</em></strong> b';
  assert.strictEqual(run(v, F.htmlClear(v, v.indexOf('word'), v.indexOf('word') + 4)), 'a |word| b');
  const w = 'a <span style="color: red">x <b>y</b></span> b';
  assert.strictEqual(run(w, F.htmlClear(w, 2, w.indexOf(' b'))), 'a |x y| b');
  assert.strictEqual(F.htmlClear('plain text', 0, 5), null);
  assert.strictEqual(F.htmlClear('x', 0, 0), null);
  const link = 'see <a href="x">here</a>';
  assert.strictEqual(F.htmlClear(link, 4, link.length), null); // links are not "formatting"
});

test('formatting slash commands exist for web pages', () => {
  const keys = F.HTML_ITEMS.map((i) => i.key);
  for (const k of ['bold', 'italic', 'strike', 'underline', 'bolditalic', 'red', 'blue', 'yellowmark', 'big', 'huge', 'aligncenter', 'alignright', 'justify']) assert.ok(keys.includes(k), k);
  assert.strictEqual(new Set(F.ITEMS.map((i) => i.id)).size, F.ITEMS.length); // no duplicate ids
});
