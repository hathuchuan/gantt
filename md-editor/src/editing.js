// Pure text-editing helpers. Every function returns an "edit" describing a
// replacement of v[from..to) with `text` plus the caret selection afterwards,
// or null when it has nothing to do.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Editing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIST_RE = /^(\s*)(?:([-*+])|(\d+)\.)(\s+)(\[[ xX]\]\s+)?/;
  const QUOTE_RE = /^\s*(?:>\s?)+/;
  const PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`' };
  const WRAP_ONLY = new Set(['*', '_', '~', '"', '$']);
  const CLOSERS = new Set([')', ']', '}', '`']);
  const URL_RE = /^https?:\/\/\S+$/;

  const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
  const lineEnd = (v, i) => {
    const j = v.indexOf('\n', i);
    return j === -1 ? v.length : j;
  };
  const edit = (from, to, text, selStart, selEnd = selStart) => ({ from, to, text, selStart, selEnd });

  // Enter: continue lists / task lists / quotes, or leave them when the item is empty.
  function onEnter(v, s, e) {
    if (s !== e) return null;
    const ls = lineStart(v, s);
    const line = v.slice(ls, lineEnd(v, s));

    const m = LIST_RE.exec(line);
    if (m) {
      if (s - ls < m[0].length) return null;
      if (line.slice(m[0].length).trim() === '') return edit(ls, ls + line.length, '', ls);
      const marker = m[2] ? m[2] : parseInt(m[3], 10) + 1 + '.';
      const ins = '\n' + m[1] + marker + m[4] + (m[5] ? '[ ] ' : '');
      return edit(s, s, ins, s + ins.length);
    }

    const q = QUOTE_RE.exec(line);
    if (q) {
      if (s - ls < q[0].length) return null;
      if (line.slice(q[0].length).trim() === '') return edit(ls, ls + line.length, '', ls);
      const ins = '\n' + q[0];
      return edit(s, s, ins, s + ins.length);
    }
    return null;
  }

  // Tab / Shift+Tab: indent or outdent the selected lines (2 spaces).
  function onTab(v, s, e, shift) {
    const ls = lineStart(v, s);
    const le = lineEnd(v, e > s && v[e - 1] === '\n' ? e - 1 : e);
    const block = v.slice(ls, le);
    if (!shift && s === e && !LIST_RE.test(block)) return edit(s, s, '  ', s + 2);

    const lines = block.split('\n');
    const out = lines.map((l) => (shift ? l.replace(/^(?: {1,2}|\t)/, '') : '  ' + l));
    const text = out.join('\n');
    if (text === block) return null;
    const first = out[0].length - lines[0].length;
    const total = text.length - block.length;
    const ns = Math.max(ls, s + first);
    const ne = s === e ? ns : Math.max(ns, e + total);
    return edit(ls, le, text, ns, ne);
  }

  // Cmd+B / Cmd+I / ... : toggle an inline mark around the selection.
  function wrap(v, s, e, mark) {
    const ml = mark.length;
    const sel = v.slice(s, e);
    if (sel.length >= 2 * ml && sel.startsWith(mark) && sel.endsWith(mark)) {
      return edit(s, e, sel.slice(ml, -ml), s, e - 2 * ml);
    }
    const doubled = mark === '*' && (v[s - 2] === '*' || v[e + 1] === '*');
    if (!doubled && s !== e && v.slice(s - ml, s) === mark && v.slice(e, e + ml) === mark) {
      return edit(s - ml, e + ml, sel, s - ml, e - ml);
    }
    if (s === e) return edit(s, s, mark + mark, s + ml);
    return edit(s, e, mark + sel + mark, s + ml, e + ml);
  }

  // Cmd+K: turn the selection into a link and select the placeholder URL.
  function link(v, s, e) {
    const sel = v.slice(s, e);
    if (URL_RE.test(sel)) return edit(s, e, `[](${sel})`, s + 1);
    if (s === e) return edit(s, s, '[](url)', s + 1);
    const urlStart = s + sel.length + 3;
    return edit(s, e, `[${sel}](url)`, urlStart, urlStart + 3);
  }

  // Pasting a URL over selected text makes a link.
  function pasteUrl(v, s, e, clip) {
    const url = clip.trim();
    const sel = v.slice(s, e);
    if (s === e || sel.includes('\n') || !URL_RE.test(url)) return null;
    const text = `[${sel}](${url})`;
    return edit(s, e, text, s + text.length);
  }

  // Typing an opening bracket/backtick auto-closes it; typing the closer steps over it;
  // typing a mark with a selection wraps the selection.
  function autoPair(v, s, e, ch) {
    if (s !== e) {
      if (!(ch in PAIRS) && !WRAP_ONLY.has(ch)) return null;
      const close = PAIRS[ch] || ch;
      return edit(s, e, ch + v.slice(s, e) + close, s + 1, e + 1);
    }
    if (CLOSERS.has(ch) && v[s] === ch) return edit(s, s, '', s + 1);
    if (!(ch in PAIRS)) return null;
    if (ch === '`' && v.slice(s - 2, s) === '``' && v.slice(lineStart(v, s), s - 2).trim() === '') {
      return edit(s, s, '`\n\n```', s + 2);
    }
    if (ch === '`' && /\w/.test(v[s - 1] || '')) return null;
    if (v[s] !== undefined && !/[\s)\]}.,;:]/.test(v[s])) return null;
    return edit(s, s, ch + PAIRS[ch], s + 1);
  }

  // Backspace between an empty pair removes both characters.
  function onBackspace(v, s, e) {
    if (s !== e || s === 0) return null;
    return PAIRS[v[s - 1]] === v[s] ? edit(s - 1, s + 1, '', s - 1) : null;
  }

  // Cmd+1..3: toggle a heading level on the current line.
  function heading(v, s, level) {
    const ls = lineStart(v, s);
    const le = lineEnd(v, s);
    const line = v.slice(ls, le);
    const m = /^(#{1,6})\s+/.exec(line);
    const body = line.slice(m ? m[0].length : 0);
    const text = m && m[1].length === level ? body : '#'.repeat(level) + ' ' + body;
    return edit(ls, le, text, ls + text.length);
  }

  // ---------- slash commands ----------
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Variables usable in command text: {date} {time} {datetime} {weekday}; {cursor} marks the caret.
  function expand(text, now) {
    return text.replace(/\{(date|time|datetime|weekday)\}/g, (_, k) =>
      k === 'date' ? fmtDate(now) : k === 'time' ? fmtTime(now) : k === 'weekday' ? WEEKDAYS[now.getDay()] : fmtDate(now) + ' ' + fmtTime(now)
    );
  }

  const it = (group, key, label, hint, text, extra) => ({ group, key, label, hint, text, ...extra });
  const BLOCK = { block: true };
  const SLASH_ITEMS = [
    it('Blocks', 'h1', 'Heading 1', '#', '# ', BLOCK),
    it('Blocks', 'h2', 'Heading 2', '##', '## ', BLOCK),
    it('Blocks', 'h3', 'Heading 3', '###', '### ', BLOCK),
    it('Blocks', 'list', 'Bullet list', '•', '- ', BLOCK),
    it('Blocks', 'numbered', 'Numbered list', '1.', '1. ', BLOCK),
    it('Blocks', 'todo', 'To-do list', '☐', '- [ ] ', BLOCK),
    it('Blocks', 'quote', 'Quote', '>', '> ', BLOCK),
    it('Blocks', 'code', 'Code block', '</>', '```\n{cursor}\n```', BLOCK),
    it('Blocks', 'table', 'Table', '▦', '| Column | Column |\n| --- | --- |\n|  |  |', { block: true, select: [2, 8] }),
    it('Blocks', 'divider', 'Divider', '—', '---\n', BLOCK),

    it('Text', 'bold', 'Bold', 'B', '**{cursor}**'),
    it('Text', 'italic', 'Italic', 'I', '*{cursor}*'),
    it('Text', 'bolditalic', 'Bold italic', 'BI', '***{cursor}***'),
    it('Text', 'strike', 'Strikethrough', 'S̶', '~~{cursor}~~'),
    it('Text', 'inlinecode', 'Inline code', '`', '`{cursor}`'),
    it('Text', 'highlight', 'Highlight', '▮', '<mark>{cursor}</mark>'),
    it('Text', 'underline', 'Underline', 'U', '<u>{cursor}</u>'),
    it('Text', 'superscript', 'Superscript', 'x²', '<sup>{cursor}</sup>'),
    it('Text', 'subscript', 'Subscript', 'x₂', '<sub>{cursor}</sub>'),
    it('Text', 'keyboard', 'Keyboard key', '⌘', '<kbd>{cursor}</kbd>'),
    it('Text', 'comment', 'Hidden comment', '<!', '<!-- {cursor} -->'),
    it('Text', 'link', 'Link', '🔗', '[text](url)', { select: [1, 5] }),
    it('Text', 'image', 'Image', '▣', '![alt](url)', { select: [2, 5] }),

    it('Insert', 'date', 'Today’s date', '📅', '{date}'),
    it('Insert', 'time', 'Current time', '🕒', '{time}'),
    it('Insert', 'gantt', 'Link to Gantt block', '🗓', null, { action: 'gantt' }),
    it('Insert', 'ganttopen', 'Show in Gantt', '↗', null, { action: 'gantt-open' }),

    it('Math', 'math', 'Inline math', '$', '${cursor}$'),
    it('Math', 'mathblock', 'Math block', '$$', '$$\n{cursor}\n$$', BLOCK),
    it('Math', 'align', 'Aligned equations', '=', '$$\n\\begin{aligned}\n{cursor}\n\\end{aligned}\n$$', BLOCK),
    it('Math', 'frac', 'Fraction', 'a/b', '\\frac{{cursor}}{}'),
    it('Math', 'sqrt', 'Square root', '√', '\\sqrt{{cursor}}'),
    it('Math', 'root', 'Nth root', 'ⁿ√', '\\sqrt[n]{{cursor}}'),
    it('Math', 'power', 'Superscript (math)', 'xⁿ', '^{{cursor}}'),
    it('Math', 'index', 'Subscript (math)', 'xₙ', '_{{cursor}}'),
    it('Math', 'sum', 'Sum', 'Σ', '\\sum_{i=1}^{n} {cursor}'),
    it('Math', 'prod', 'Product', 'Π', '\\prod_{i=1}^{n} {cursor}'),
    it('Math', 'int', 'Integral', '∫', '\\int_{a}^{b} {cursor}\\,dx'),
    it('Math', 'lim', 'Limit', 'lim', '\\lim_{x \\to \\infty} {cursor}'),
    it('Math', 'partial', 'Partial derivative', '∂', '\\frac{\\partial {cursor}}{\\partial x}'),
    it('Math', 'matrix', 'Matrix', '[ ]', '\\begin{pmatrix} {cursor} & \\\\ & \\end{pmatrix}'),
    it('Math', 'cases', 'Cases', '{', '\\begin{cases} {cursor} & \\text{if } \\\\ & \\text{otherwise} \\end{cases}'),
    it('Math', 'vec', 'Vector', '→', '\\vec{{cursor}}'),
    it('Math', 'hat', 'Hat', 'x̂', '\\hat{{cursor}}'),
    it('Math', 'bar', 'Overline', 'x̄', '\\overline{{cursor}}'),
    it('Math', 'dot', 'Time derivative', 'ẋ', '\\dot{{cursor}}'),
    it('Math', 'text', 'Text in math', 'T', '\\text{{cursor}}'),
    it('Math', 'mathbf', 'Math bold', '𝐱', '\\mathbf{{cursor}}'),
    it('Math', 'mathcal', 'Calligraphic', '𝓛', '\\mathcal{{cursor}}'),
    it('Math', 'mathbb', 'Blackboard bold', 'ℝ', '\\mathbb{{cursor}}'),
    ...[
      ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'],
      ['theta', 'θ'], ['lambda', 'λ'], ['mu', 'μ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'],
      ['phi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
    ].map(([n, g]) => it('Math', n, n[0].toUpperCase() + n.slice(1), g, '\\' + n)),
    ...[
      ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Pi', 'Π'], ['Sigma', 'Σ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
    ].map(([n, g]) => it('Math', n, n + ' (capital)', g, '\\' + n)),
    ...[
      ['times', '×'], ['cdot', '·'], ['pm', '±'], ['leq', '≤'], ['geq', '≥'], ['neq', '≠'], ['approx', '≈'], ['equiv', '≡'],
      ['to', '→'], ['implies', '⇒'], ['iff', '⇔'], ['in', '∈'], ['subset', '⊂'], ['cup', '∪'], ['cap', '∩'],
      ['forall', '∀'], ['exists', '∃'], ['nabla', '∇'], ['infty', '∞'], ['ldots', '…'],
    ].map(([n, g]) => it('Math', n, n[0].toUpperCase() + n.slice(1), g, '\\' + n)),
  ];

  // Combine built-ins with the user's commands.json ({ disabled: [keys], custom: [{key,label,text,...}] }).
  function buildItems(config = {}) {
    const disabled = new Set(Array.isArray(config.disabled) ? config.disabled : []);
    const custom = (Array.isArray(config.custom) ? config.custom : [])
      .filter((c) => c && typeof c.key === 'string' && /^[\w-]+$/.test(c.key) && typeof c.text === 'string')
      .map((c) => ({
        group: 'Custom',
        key: c.key,
        label: typeof c.label === 'string' && c.label ? c.label : c.key,
        hint: typeof c.hint === 'string' ? c.hint : '',
        text: c.text,
        block: !!c.block,
        custom: true,
      }));
    const overridden = new Set(custom.map((c) => c.key));
    return SLASH_ITEMS.filter((i) => !overridden.has(i.key))
      .concat(custom)
      .map((i) => ({ ...i, enabled: !disabled.has(i.key) }));
  }

  // Detects "/query" typed at the start of a line, or "/query" (1+ chars) after whitespace mid-line.
  function slashQuery(v, s) {
    const ls = lineStart(v, s);
    const before = v.slice(ls, s);
    let m = /^(\s*)\/([\w-]*)$/.exec(before);
    if (m) return { query: m[2].toLowerCase(), from: ls + m[1].length, lineStart: true };
    m = /(?:^|\s)\/([\w-]+)$/.exec(before);
    return m ? { query: m[1].toLowerCase(), from: s - m[1].length - 1, lineStart: false } : null;
  }

  // Prefix filter: "h" keeps commands starting with h, "he" narrows further, ...
  function filterSlash(query, items = SLASH_ITEMS, opts = {}) {
    const atLineStart = opts.lineStart !== false;
    const q = query.toLowerCase();
    const pool = items.filter((i) => i.enabled !== false && (atLineStart || !i.block));
    if (!q) return pool;
    const rank = (i) => (i.key.toLowerCase().startsWith(q) ? 0 : i.label.toLowerCase().startsWith(q) ? 1 : -1);
    return pool
      .map((i, idx) => [rank(i), idx, i])
      .filter((x) => x[0] >= 0)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map((x) => x[2]);
  }

  function applySlash(v, s, from, item, now = new Date()) {
    let text = expand(item.text || '', now);
    let a;
    let b;
    if (item.select) [a, b] = item.select;
    else {
      const c = text.indexOf('{cursor}');
      text = text.split('{cursor}').join('');
      a = b = c >= 0 ? c : text.length;
    }
    return edit(from, s, text, from + a, from + b);
  }

  // ---------- links to local files ----------
  // `[file name](file:///path/file%20name.pdf)` — the link text defaults to the file name.
  function fileLink(p) {
    const parts = String(p).split('/');
    const name = parts[parts.length - 1] || String(p);
    const enc = (x) => encodeURIComponent(x).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `[${name.replace(/[\\\[\]*_`<>~]/g, '\\$&')}](file://${parts.map(enc).join('/')})`;
  }

  // Replace the selection with links to the dropped files (one per line when there are several).
  function dropFiles(v, s, e, paths) {
    const links = paths.filter(Boolean).map(fileLink);
    if (!links.length) return null;
    const lead = s > 0 && !/\s/.test(v[s - 1]) ? ' ' : '';
    const trail = e < v.length && !/\s/.test(v[e]) ? ' ' : '';
    const text = lead + links.join('\n') + trail;
    const caret = s + lead.length + links.join('\n').length;
    return edit(s, e, text, caret);
  }

  // The target of the Markdown link `[text](target)` that contains position `pos`, or ''.
  function linkAt(v, pos) {
    const ls = lineStart(v, pos);
    const line = v.slice(ls, lineEnd(v, pos));
    const re = /\[(?:\\.|[^\]\\])*\]\(([^)\s]*)\)/g;
    let m;
    while ((m = re.exec(line))) {
      if (pos - ls >= m.index && pos - ls <= m.index + m[0].length) return m[1];
    }
    return '';
  }

  // ---------- Academic Gantt link (front matter) ----------
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  const GANTT_KEYS = /^gantt-(block|title|start|end):/;

  function parseFrontMatter(v) {
    const m = FM_RE.exec(v);
    if (!m) return { meta: {}, body: v, length: 0, lines: [] };
    const lines = m[1].split(/\r?\n/);
    const meta = {};
    for (const line of lines) {
      const k = /^([\w-]+):\s*(.*)$/.exec(line);
      if (k) meta[k[1]] = k[2].trim();
    }
    return { meta, body: v.slice(m[0].length), length: m[0].length, lines };
  }

  const one = (x) => String(x == null ? '' : x).replace(/\s*\n\s*/g, ' ').trim();

  // Attach (or replace) the Gantt block link in the document's front matter.
  function setGantt(v, s, e, info) {
    const fm = parseFrontMatter(v);
    const lines = [`gantt-block: ${one(info.block)}`, `gantt-title: ${one(info.course)} — ${one(info.label)}`];
    if (info.start) lines.push(`gantt-start: ${one(info.start)}`);
    if (info.end) lines.push(`gantt-end: ${one(info.end)}`);
    const text = `---\n${lines.concat(fm.lines.filter((l) => !GANTT_KEYS.test(l))).join('\n')}\n---\n` + (fm.length ? '' : '\n');
    const delta = text.length - fm.length;
    return edit(0, fm.length, text, Math.max(text.length, s + delta), Math.max(text.length, e + delta));
  }

  // Remove the Gantt keys (and the whole front matter block when nothing else is left).
  function clearGantt(v, s, e) {
    const fm = parseFrontMatter(v);
    if (!fm.length) return null;
    const rest = fm.lines.filter((l) => !GANTT_KEYS.test(l) && l.trim() !== '');
    if (rest.length === fm.lines.filter((l) => l.trim() !== '').length) return null;
    const text = rest.length ? `---\n${rest.join('\n')}\n---\n` : '';
    const delta = text.length - fm.length;
    return edit(0, fm.length, text, Math.max(text.length, s + delta), Math.max(text.length, e + delta));
  }

  return {
    onEnter, onTab, wrap, link, pasteUrl, autoPair, onBackspace, heading,
    slashQuery, filterSlash, applySlash, buildItems, SLASH_ITEMS,
    parseFrontMatter, setGantt, clearGantt, fileLink, dropFiles, linkAt,
  };
});
