const test = require('node:test');
const assert = require('node:assert');
const { Marked } = require('marked');
const N = require('../src/notes-core.js');

test('headings: levels, offsets, lines; fenced code and front matter are ignored', () => {
  const md = '---\ntitle: X\n# not a heading\n---\n# Intro **bold** [link](u)\ntext\n```md\n# in code\n```\n~~~\n## also code\n~~~\n## Part two ##\n#hashtag\n####### seven\n###### six';
  const hs = N.parseHeadings(md);
  assert.deepStrictEqual(hs.map((h) => [h.level, h.text, h.line]), [[1, 'Intro bold link', 5], [2, 'Part two', 13], [6, 'six', 16]]);
  assert.strictEqual(md.slice(hs[1].offset, hs[1].offset + 2), '##');
  assert.deepStrictEqual(N.parseHeadings('```js\n# x\n````\n# after\n').map((h) => h.text), ['after']); // a longer fence still closes
  assert.deepStrictEqual(N.parseHeadings('````\n```\n# still code\n```\n````\n# real\n').map((h) => h.text), ['real']);
  assert.deepStrictEqual(N.parseHeadings(''), []);
});

test('heading text drops inline Markdown, wiki links and escapes', () => {
  assert.strictEqual(N.parseHeadings('## `code` and [[Note|alias]] \\# <b>x</b>')[0].text, 'code and alias # x');
});

test('activeIndex: the section at the top of the window', () => {
  assert.strictEqual(N.activeIndex([100, 400, 900], 50), -1);
  assert.strictEqual(N.activeIndex([100, 400, 900], 400), 1);
  assert.strictEqual(N.activeIndex([100, 400, 900], 5000), 2);
  assert.strictEqual(N.activeIndex([], 10), -1);
});

test('findAll: case toggle, Unicode, overlapping, regex characters taken literally', () => {
  assert.deepStrictEqual(N.findAll('Abc abc ABC', 'abc', false).map((m) => m.from), [0, 4, 8]);
  assert.deepStrictEqual(N.findAll('Abc abc ABC', 'abc', true).map((m) => m.from), [4]);
  assert.strictEqual(N.findAll('Đường đi', 'đ', false).length, 2);
  assert.deepStrictEqual(N.findAll('aaaa', 'aa', false), [{ from: 0, to: 2 }, { from: 2, to: 4 }]);
  assert.strictEqual(N.findAll('a.c abc (x)', '.', false).length, 1);
  assert.strictEqual(N.findAll('f(x) f(y)', 'f(', false).length, 2);
  assert.deepStrictEqual(N.findAll('abc', '', false), []);
  assert.strictEqual(N.findAll('a'.repeat(50), 'a', false, 10).length, 10);
});

test('find navigation: start at caret, wrap around, "3/12" label', () => {
  const ms = [{ from: 5, to: 6 }, { from: 20, to: 21 }, { from: 40, to: 41 }];
  assert.strictEqual(N.startIndex(ms, 0), 0);
  assert.strictEqual(N.startIndex(ms, 21), 2);
  assert.strictEqual(N.startIndex(ms, 99), 0);
  assert.strictEqual(N.startIndex([], 0), -1);
  assert.strictEqual(N.stepIndex(2, 3, 1), 0);
  assert.strictEqual(N.stepIndex(0, 3, -1), 2);
  assert.strictEqual(N.stepIndex(0, 0, 1), -1);
  assert.strictEqual(N.countLabel(2, 12, true), '3/12');
  assert.strictEqual(N.countLabel(-1, 0, true), 'No results');
  assert.strictEqual(N.countLabel(-1, 0, false), '');
});

test('snippet keeps the hit visible in long lines', () => {
  assert.strictEqual(N.snippet('  short line  '), 'short line');
  const long = 'x'.repeat(200) + 'NEEDLE' + 'y'.repeat(200);
  const s = N.snippet(long, 200, 6);
  assert.ok(s.includes('NEEDLE') && s.startsWith('…') && s.endsWith('…') && s.length < 160);
});

test('tags: inline, Unicode (Vietnamese), not in code / headings / links / numbers', () => {
  const md = [
    '# Heading #notatag',
    'Học #tiếng_việt và #Ý-tưởng, #done.',
    'Issue #12 and &#39; and #1a',
    '`#incode` and [a](#anchor) and https://x.com/page#frag and a#b',
    '```',
    '#fenced',
    '```',
    '(#paren) #a/b/ #Done',
  ].join('\n');
  assert.deepStrictEqual(N.noteTags(md).map((t) => t.tag), ['tiếng_việt', 'Ý-tưởng', 'done', '1a', 'paren', 'a/b']);
  assert.strictEqual(N.noteTags(md)[0].line, 2);
  assert.deepStrictEqual(N.noteTags('#Tag #tag #TAG').map((t) => t.tag), ['Tag']); // case-insensitive, first spelling kept
});

test('tags in YAML front matter: inline list, comma list, block list', () => {
  const tags = (fm) => N.frontMatterTags(`---\n${fm}\n---\nbody #body`).map((t) => t.tag);
  assert.deepStrictEqual(tags('tags: [alpha, "Bê ta", #gamma]'), ['alpha', 'gamma']);
  assert.deepStrictEqual(tags('tags: one, two'), ['one', 'two']);
  assert.deepStrictEqual(tags('tags: one two'), ['one', 'two']);
  assert.deepStrictEqual(tags('title: T\ntags:\n  - x\n  - "y"\nother: 1'), ['x', 'y']);
  assert.strictEqual(N.frontMatterTags('---\ntags:\n  - x\n---\n')[0].line, 3);
  assert.deepStrictEqual(N.noteTags('---\ntags: [a]\n---\n#a #b').map((t) => t.tag), ['a', 'b']);
  assert.deepStrictEqual(N.frontMatterTags('no front matter'), []);
});

test('wiki links: target and alias, positions, code excluded', () => {
  const md = 'See [[Note One]] and [[Other|the other]]\n`[[inline]]` [[ x#Heading ]]\n```\n[[fenced]]\n```\n[[a\\|b]]';
  const ls = N.parseWikiLinks(md);
  assert.deepStrictEqual(ls.map((l) => [l.target, l.alias, l.line]), [['Note One', '', 1], ['Other', 'the other', 1], ['x#Heading', '', 2], ['a', 'b', 6]]);
  assert.strictEqual(ls[0].col, 4);
  assert.ok(ls[0].snippet.includes('[[Note One]]'));
  assert.strictEqual(N.wikiLinkAt('a [[Foo|bar]] b', 6), 'Foo');
  assert.strictEqual(N.wikiLinkAt('a [[Foo|bar]] b', 1), '');
  assert.strictEqual(N.linkKey('Note#Heading'), 'note');
  assert.strictEqual(N.linkKey('Folder/Note.md'), 'folder/note');
});

test('wikiLinksToText for exports leaves code alone', () => {
  assert.strictEqual(N.wikiLinksToText('[[a|Alias]] and [[b]] `[[c]]`\n```\n[[d]]\n```'), 'Alias and b `[[c]]`\n```\n[[d]]\n```');
});

test('marked renders [[links]] as clickable wikilink anchors (not inside code)', () => {
  const md = new Marked({ gfm: true });
  md.use({ extensions: [N.markedWikiLink] });
  const html = md.parse('Go to [[My Note]] or [[My Note|alias <b>]] and `[[code]]` and [[]] and [x](y)');
  assert.match(html, /<a href="#" class="wikilink" data-wiki="My Note">My Note<\/a>/);
  assert.match(html, /data-wiki="My Note">alias &lt;b&gt;<\/a>/);
  assert.match(html, /<code>\[\[code\]\]<\/code>/);
  assert.doesNotMatch(html, /data-wiki=""/);
  assert.match(html, /<a href="y">x<\/a>/);
});

test('[[ autocomplete: query detection, ranking, accepting a suggestion', () => {
  assert.deepStrictEqual(N.wikiQuery('see [[pro|', 10), null); // alias part: no suggestions
  assert.deepStrictEqual(N.wikiQuery('see [[pro', 9), { query: 'pro', from: 6 });
  assert.deepStrictEqual(N.wikiQuery('see [[pro]]', 9), { query: 'pro', from: 6 });
  assert.strictEqual(N.wikiQuery('see [pro', 8), null);
  assert.strictEqual(N.wikiQuery('[[a]] done', 10), null);
  assert.strictEqual(N.wikiQuery('[[a\nb', 5), null);
  const names = [
    { name: 'Roadmap', title: 'Project plan', rel: 'Roadmap.md' },
    { name: 'Project X', title: '', rel: 'a/Project X.md' },
    { name: 'My project', title: '', rel: 'My project.md' },
    { name: 'Other', title: 'About projects', rel: 'Other.md' },
  ];
  assert.deepStrictEqual(N.filterNames(names, 'proj').map((n) => n.name), ['Project X', 'My project', 'Other', 'Roadmap']);
  assert.strictEqual(N.filterNames(names, '').length, 4);
  assert.deepStrictEqual(N.filterNames(names, 'zzz'), []);
  assert.strictEqual(N.filterNames(names, '', 2).length, 2);
  // the auto-closed `]]` is reused
  const v = 'see [[pro]] tail';
  const ed = N.applyWikiChoice(v, 9, 6, 'Project X');
  assert.strictEqual(v.slice(0, ed.from) + ed.text + v.slice(ed.to), 'see [[Project X]] tail');
  assert.strictEqual(ed.selStart, 'see [[Project X]]'.length);
  const ed2 = N.applyWikiChoice('see [[pro', 9, 6, 'Z');
  assert.strictEqual('see [[pro'.slice(0, ed2.from) + ed2.text, 'see [[Z]]');
});

test('front matter title', () => {
  assert.strictEqual(N.frontMatterTitle('---\ntitle: "Kế hoạch Q4"\n---\n'), 'Kế hoạch Q4');
  assert.strictEqual(N.frontMatterTitle('# no front matter\ntitle: x'), '');
});
