const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mammoth = require('mammoth');
const X = require('../export.js');
const Importer = require('../import.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdeditor-test-'));

test('image sizes are read from PNG headers', () => {
  assert.deepStrictEqual(X.imageInfo(PNG), { type: 'png', width: 1, height: 1 });
  assert.strictEqual(X.imageInfo(Buffer.from('not an image')), null);
});

test('Markdown → .docx keeps structure, text and pictures; a real .docx reads back', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'p ic.png'), PNG);
  const buf = await X.markdownToDocx(
    '# Title & more\n\nPara **bold** *it* ~~del~~ `a<b` $e=mc^2$ [link](https://x.com) &amp; done.\n\n> quote\n\n- one\n  - sub\n- [x] done\n\n1. a\n2. b\n\n| A | B |\n|:--|--:|\n| 1 | **2** |\n\n```js\nconst a = 1 < 2;\n```\n\n---\n\n$$\nx^2\n$$\n\n![pic](p%20ic.png)\n\n<!-- hidden -->\n',
    { baseDir: dir, title: 'T' }
  );
  assert.strictEqual(buf.subarray(0, 2).toString(), 'PK');
  const file = path.join(dir, 'out.docx');
  fs.writeFileSync(file, buf);
  const { value: html, messages } = await mammoth.convertToHtml({ path: file });
  assert.deepStrictEqual(messages, []);
  assert.match(html, /<h1>Title &amp; more<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<s>del<\/s>/);
  assert.match(html, /<a href="https:\/\/x\.com">link<\/a> &amp; done\./);
  assert.match(html, /<ul><li>one<ul><li>sub<\/li><\/ul><\/li><li>☑ done<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<table>.*<th><p><strong>A<\/strong><\/p><\/th>.*<td><p>1<\/p><\/td>/);
  assert.match(html, /const a = 1 &lt; 2;/);
  assert.match(html, /<img alt="pic" src="data:image\/png;base64,/);
  assert.ok(!/hidden/.test(html));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing picture becomes a visible placeholder instead of failing the export', async () => {
  const dir = tmp();
  const file = path.join(dir, 'o.docx');
  fs.writeFileSync(file, await X.markdownToDocx('![gone](nope.png)\n', { baseDir: dir }));
  assert.match((await mammoth.convertToHtml({ path: file })).value, /\[image: gone\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PDF page: base, stylesheets and a strict CSP', () => {
  const html = X.exportHtml('<p>hi</p>', '/tmp/some dir');
  assert.match(html, /<base href="file:\/\/\/tmp\/some%20dir\/">/);
  assert.match(html, /katex\.min\.css/);
  assert.match(html, /highlight\.css/);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(html, /<article id="preview"><p>hi<\/p><\/article>/);
});

test('import: .docx → Markdown with pictures saved next to the note; .html → Markdown', async () => {
  const dir = tmp();
  const docx = path.join(dir, 'src.docx');
  fs.writeFileSync(path.join(dir, 'p ic.png'), PNG);
  fs.writeFileSync(docx, await X.markdownToDocx('# Heading\n\nText with **bold**.\n\n- one\n- two\n\n![pic](p%20ic.png)\n', { baseDir: dir }));
  const out = path.join(dir, 'My note.md');
  const r = await Importer.convertFile(docx, out);
  assert.strictEqual(r.images, 1);
  assert.match(r.markdown, /^# Heading\n\nText with \*\*bold\*\*\.\n\n- one\n- two\n/);
  assert.match(r.markdown, /!\[pic\]\(My-note-image-1\.png\)/);
  assert.ok(fs.existsSync(path.join(dir, 'My-note-image-1.png')));

  const html = path.join(dir, 'page.html');
  fs.writeFileSync(html, '<html><body><h2>Hello</h2><p>a <em>b</em></p></body></html>');
  assert.strictEqual((await Importer.convertFile(html, path.join(dir, 'page.md'))).markdown, '## Hello\n\na *b*\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
