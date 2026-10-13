const test = require('node:test');
const assert = require('node:assert');
const { Marked } = require('marked');
const M = require('../src/math.js');

const md = new Marked({ gfm: true });
md.use({ extensions: M.extensions });

test('inline math becomes a placeholder', () => {
  const html = md.parse('Energy $E=mc^2$ here');
  assert.match(html, /<span class="math-ph" data-tex="E=mc\^2"><\/span>/);
});

test('block math', () => {
  const html = md.parse('$$\n\\int_0^1 x\\,dx\n$$\n');
  assert.match(html, /<div class="math-ph" data-display="1" data-tex="\\int_0\^1 x\\,dx">/);
});

test('prices are not math', () => {
  const html = md.parse('It costs $5 and $10 total');
  assert.doesNotMatch(html, /math-ph/);
});

test('tex is attribute-escaped', () => {
  const html = md.parse('$a<b "x"$');
  assert.match(html, /data-tex="a&lt;b &quot;x&quot;"/);
});
