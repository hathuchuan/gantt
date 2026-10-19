const test = require('node:test');
const assert = require('node:assert');
const Syntax = require('../src/syntax.js');

const unescape = (h) => h.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hl = Syntax.highlight;
const classes = (kind, text) => [...hl(kind, text).matchAll(/<span class="([^"]+)">([^<]*)</g)].map((m) => m[1] + ':' + unescape(m[2]));

const SAMPLES = {
  json: ['{"a": 1, "b": [true, false, null, -2.5e3], "c": {"d": "x\\"y"}}', '{\n  // note\n  "a": "unterminated\n}', '"', '{"a":', '/* open', '[1,,]', 'tru', '\\', '"a\\'],
  html: [
    '<!doctype html>\n<html lang="vi"><head><style>a:hover { color: #fff; margin: 0 auto } /* c */</style></head>\n<body class=x id = "y" data-a=\'1\'><p>a &amp; b &#169; <b>x</b></p><script>const a = "s"; if (a) { f(1) } // c\n</script><!-- c --></body></html>',
    '<div', '<div class="a', '<', '<<<', '</>', '<!--', '<!x', '<style>a{', '<script type="application/ld+json">{"a":1}</script>', '<a href=>x</a>', '&amp', 'a < b > c', '<p\n  a="1"\n  b>', '<svg><path d="M0"/></svg>',
  ],
  md: [
    '---\ntitle: Hi\ntags: [a]\n---\n\n# Heading **bold**\n\n- [ ] task `code` and *em* and ~~gone~~ [link](http://x.io) ![i](a.png) [[wiki]] $x^2$\n> quote\n1. one\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```json\n{"a": 1}\n```\n\n```html\n<b>x</b>\n```\n\n$$\nx\n$$\n\n<!-- c\nstill -->\n\n---\n',
    '```\nno close', '---\nnot front matter', '* * *', '<!-- open', '**', '`', '[', '[]()', '$', '#tag', '    indent', '~~~js\nlet a = 1\n~~~', '',
  ],
};

test('highlighting never changes the text, whatever it is', () => {
  for (const [kind, list] of Object.entries(SAMPLES)) {
    for (const t of list) assert.strictEqual(unescape(hl(kind, t)), t, kind + ': ' + JSON.stringify(t));
  }
});

test('random text round-trips too (no crash, no lost characters)', () => {
  const alphabet = ['<', '>', '/', '"', "'", '=', '!', '-', '`', '*', '_', '#', '$', '[', ']', '(', ')', '{', '}', ':', ',', '\n', ' ', '\\', '&', ';', 'a', 'b', '1', '|', '~', 'é', 'ế'];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 0; n < 1500; n++) {
    let t = '';
    for (let k = 0, len = Math.floor(rnd() * 60); k < len; k++) t += alphabet[Math.floor(rnd() * alphabet.length)];
    for (const kind of ['md', 'html', 'json']) assert.strictEqual(unescape(hl(kind, t)), t, kind + ': ' + JSON.stringify(t));
  }
});

test('JSON tokens', () => {
  assert.deepStrictEqual(classes('json', '{"a": [1, true, null, "x"]}'), [
    't-punct:{', 't-key:"a"', 't-punct::', 't-punct:[', 't-num:1', 't-punct:,', 't-kw:true', 't-punct:,', 't-null:null', 't-punct:,', 't-str:"x"', 't-punct:]', 't-punct:}',
  ]);
  assert.deepStrictEqual(classes('json', '"a\\"b" // c'), ['t-str:"a\\"b"', 't-comment:// c']);
  assert.deepStrictEqual(classes('json', '-2.5e3'), ['t-num:-2.5e3']);
});

test('HTML tokens: tags, attributes, values, comments, entities', () => {
  assert.deepStrictEqual(classes('html', '<a href="x" id=y>t &amp; u</a><!-- c -->'), [
    't-tag:<a', 't-attr:href', 't-punct:=', 't-str:"x"', 't-attr:id', 't-punct:=', 't-str:y', 't-tag:>', 't-ent:&amp;', 't-tag:</a', 't-tag:>', 't-comment:<!-- c -->',
  ]);
  assert.deepStrictEqual(classes('html', '<!doctype html>'), ['t-meta:<!doctype html>']);
  assert.ok(!hl('html', 'a < b').includes('<span'));
});

test('HTML: <style> is CSS and <script> is JavaScript (or JSON)', () => {
  const c = classes('html', '<style>a:hover { color: #fff; margin: 0 }</style>');
  assert.ok(c.includes('t-tag:a') && c.includes('t-attr:color') && c.includes('t-num:#fff') && c.includes('t-num:0'), c.join(' '));
  const j = classes('html', '<script>const a = f("x"); // hi\n</script>');
  assert.ok(j.includes('t-kw:const') && j.includes('t-fn:f') && j.includes('t-str:"x"') && j.includes('t-comment:// hi'), j.join(' '));
  assert.ok(classes('html', '<script type="application/ld+json">{"a": 1}</script>').includes('t-key:"a"'));
  assert.ok(!classes('html', '<script>if (a < b) {}</script>').some((x) => x.startsWith('t-tag:<b')));
});

test('Markdown tokens', () => {
  const c = classes('md', '# Title\nsome **b**\n- [ ] do `x` *i* ~~s~~ [t](u) [[w]] $m$\n> q\n---');
  for (const want of ['t-hmark:#', 't-bold:**b**', 't-list:-', 't-list:[ ] ', 't-code:`x`', 't-em:*i*', 't-strike:~~s~~', 't-link:[t]', 't-url:(u)', 't-wiki:[[w]]', 't-math:$m$', 't-quote:> ']) {
    assert.ok(c.includes(want), want + ' in ' + c.join(' | '));
  }
  assert.ok(classes('md', 'a\n---\n').includes('t-punct:---'));
});

test('Markdown: front matter, fences with a language, math blocks, comments', () => {
  const fm = classes('md', '---\ntitle: Hi\n---\nbody');
  assert.ok(fm.includes('t-meta:---') && fm.includes('t-attr:title'));
  assert.ok(!classes('md', '---\nnot closed').some((x) => x.startsWith('t-attr')));
  const f = classes('md', '```json\n{"a": 1}\n```');
  assert.ok(f.includes('t-fence:```json') && f.includes('t-key:"a"') && f.includes('t-fence:```'));
  assert.ok(classes('md', '```\nplain *x*\n```').includes('t-code:plain *x*'));
  assert.ok(!classes('md', '```\n# not a heading\n```').some((x) => x.startsWith('t-hmark')));
  assert.ok(classes('md', '$$\nx_1 *y*\n$$').includes('t-math:x_1 *y*'));
  assert.ok(classes('md', '<!-- a\n# b\n-->').includes('t-comment:# b'));
  assert.ok(!classes('md', '#tag').some((x) => x.startsWith('t-hmark')));
});

test('escaping: nothing from the text can become markup', () => {
  const h = hl('md', '<img src=x onerror=alert(1)> & <script>');
  assert.ok(!/<img|<script/.test(h));
  assert.strictEqual(unescape(h), '<img src=x onerror=alert(1)> & <script>');
});

test('fast enough for large files', () => {
  const big = ('{"key": "value", "n": 12.5, "list": [1, 2, 3], "ok": true}\n').repeat(4000);
  const md = ('# Title\n\nSome **bold** and `code` with [a link](http://x.io) here.\n- item *em*\n').repeat(4000);
  const page = '<div class="a" id="b"><p>text &amp; more</p></div>\n'.repeat(4000);
  for (const [kind, t] of [['json', big], ['md', md], ['html', page]]) {
    const start = Date.now();
    hl(kind, t);
    assert.ok(Date.now() - start < 1500, kind + ' took ' + (Date.now() - start) + 'ms for ' + t.length + ' chars');
  }
});
