const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/html2md.js');

test('web / Word HTML becomes Markdown (headings, emphasis, links, lists, tables, code)', () => {
  const md = H.toMarkdown(
    '<html><head><title>x</title><style>p{}</style></head><body><h1>Hi</h1><p>Some <b>bold</b> and <i>it</i> <a href="http://a.com">l</a> <s>gone</s></p>' +
      '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>x</li></ol>' +
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
      '<pre><code class="language-js">let a = 1;\nlet b;</code></pre><blockquote>q</blockquote><img src="pic.png" alt="p"></body></html>'
  );
  assert.strictEqual(
    md,
    '# Hi\n\nSome **bold** and *it* [l](http://a.com) ~~gone~~\n\n- a\n- b\n    - c\n\n1. x\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nlet a = 1;\nlet b;\n```\n\n> q\n\n![p](pic.png)\n'
  );
});

test('Google Docs wrapper and styled spans', () => {
  assert.strictEqual(
    H.toMarkdown('<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span> <span style="font-style:italic;">it</span> plain</p></b>'),
    '**Bold** *it* plain\n'
  );
});

test('Word list paragraphs become real lists, with levels', () => {
  const md = H.toMarkdown(
    '<!--StartFragment--><p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><![if !supportLists]><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span><![endif]>First</p>' +
      '<p class=MsoListParagraphCxSpMiddle style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">o<span>&nbsp;</span></span>Nested</p>' +
      '<p class=MsoListParagraphCxSpLast style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>Num</p><p>After</p><!--EndFragment-->'
  );
  assert.strictEqual(md, '- First\n  - Nested\n1. Num\n\nAfter\n');
});

test('local Word pictures are dropped; embedded ones are kept for the app to save', () => {
  assert.strictEqual(H.toMarkdown('<p>a<img src="file:///C:/x.png">b</p>'), 'ab\n');
  assert.match(H.toMarkdown('<p><img src="data:image/png;base64,AAAA" alt="z"></p>'), /!\[z\]\(data:image\/png;base64,AAAA\)/);
});

test('only structured HTML is converted on paste; code-editor HTML is left alone', () => {
  assert.strictEqual(H.isRich('<p>a <b>b</b></p>'), true);
  assert.strictEqual(H.isRich('<a href="x">link</a>'), true);
  assert.strictEqual(H.isRich('<span>plain</span>'), false);
  assert.strictEqual(H.isRich('<div style="font-family: Menlo, monospace; white-space: pre"><b>x</b></div>'), false);
});
