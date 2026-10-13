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
  const WRAP_ONLY = new Set(['*', '_', '~', '"']);
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

  const today = () => new Date().toISOString().slice(0, 10);
  const SLASH_ITEMS = [
    { key: 'h1', label: 'Heading 1', hint: '#', text: '# ' },
    { key: 'h2', label: 'Heading 2', hint: '##', text: '## ' },
    { key: 'h3', label: 'Heading 3', hint: '###', text: '### ' },
    { key: 'list', label: 'Bullet list', hint: '-', text: '- ' },
    { key: 'numbered', label: 'Numbered list', hint: '1.', text: '1. ' },
    { key: 'todo', label: 'To-do list', hint: '[ ]', text: '- [ ] ' },
    { key: 'quote', label: 'Quote', hint: '>', text: '> ' },
    { key: 'code', label: 'Code block', hint: '```', text: '```\n\n```', caret: 4 },
    { key: 'table', label: 'Table', hint: '|', text: '| Column | Column |\n| --- | --- |\n|  |  |', select: [2, 8] },
    { key: 'link', label: 'Link', hint: '[]()', text: '[text](url)', select: [1, 5] },
    { key: 'image', label: 'Image', hint: '![]()', text: '![alt](url)', select: [2, 5] },
    { key: 'divider', label: 'Divider', hint: '---', text: '---\n' },
    { key: 'date', label: 'Today’s date', hint: '', get text() { return today(); } },
  ];

  // Detects "/query" typed at the start of a line.
  function slashQuery(v, s) {
    const ls = lineStart(v, s);
    const m = /^(\s*)\/([\w-]*)$/.exec(v.slice(ls, s));
    return m ? { query: m[2].toLowerCase(), from: ls + m[1].length } : null;
  }

  function filterSlash(query) {
    const hit = (i) => i.key.includes(query) || i.label.toLowerCase().includes(query);
    const items = SLASH_ITEMS.filter(hit);
    return items.sort((a, b) => Number(b.key.startsWith(query)) - Number(a.key.startsWith(query)));
  }

  function applySlash(v, s, from, item) {
    const text = item.text;
    const [a, b] = item.select || [item.caret ?? text.length, item.caret ?? text.length];
    return edit(from, s, text, from + a, from + b);
  }

  return { onEnter, onTab, wrap, link, pasteUrl, autoPair, onBackspace, heading, slashQuery, filterSlash, applySlash, SLASH_ITEMS };
});
