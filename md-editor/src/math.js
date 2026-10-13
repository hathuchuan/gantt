// marked extensions for LaTeX math: $inline$ and $$block$$.
// They emit inert placeholders; KaTeX renders them after sanitising (see app.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkedMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const block = {
    name: 'mathBlock',
    level: 'block',
    start: (src) => src.indexOf('$$'),
    tokenizer(src) {
      const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src);
      if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    },
    renderer: (t) => `<div class="math-ph" data-display="1" data-tex="${esc(t.text)}"></div>\n`,
  };

  const inline = {
    name: 'mathInline',
    level: 'inline',
    start: (src) => src.indexOf('$'),
    tokenizer(src) {
      // $x$ : no space just inside the delimiters, and not "$5 and $10"
      const m = /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(src);
      if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
    },
    renderer: (t) => `<span class="math-ph" data-tex="${esc(t.text)}"></span>`,
  };

  return { extensions: [block, inline] };
});
