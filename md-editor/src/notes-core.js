// Pure helpers shared by the editor window (find, outline, wiki-link autocomplete, preview) and the
// main process (notes-index.js: whole-folder search, tags, backlinks).
// Headings, tags and [[wiki-links]] are all found with the same line scanner, which skips YAML front
// matter and fenced code blocks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  const frontMatterLength = (text) => {
    const m = FM_RE.exec(text);
    return m ? m[0].length : 0;
  };

  // Every line with its 1-based number and start offset; `code` = inside (or on the edge of) a fenced code
  // block, `fm` = inside the YAML front matter.
  function scanLines(text) {
    const out = [];
    const fmLen = frontMatterLength(text);
    let fence = null;
    let pos = 0;
    let n = 0;
    for (const raw of String(text).split('\n')) {
      n++;
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const start = pos;
      pos += raw.length + 1;
      const fm = start < fmLen;
      let code = false;
      if (!fm) {
        const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
          code = true;
          if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null;
        } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
          fence = { ch: m[1][0], len: m[1].length };
          code = true;
        }
      }
      out.push({ n, start, text: line, code, fm });
    }
    return out;
  }

  const blank = (s) => ' '.repeat(s.length);
  const INLINE_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  const maskCode = (line) => line.replace(INLINE_CODE, blank);

  // ---------- headings / outline ----------
  // Display text of a heading: inline Markdown removed.
  function plainInline(s) {
    return String(s)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__|~~|[*`])/g, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ATX headings (# … ######) outside code blocks and front matter: [{ level, text, line, offset }].
  function parseHeadings(text) {
    const out = [];
    for (const l of scanLines(text)) {
      if (l.code || l.fm) continue;
      const m = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(l.text);
      if (!m) continue;
      const t = plainInline(m[2]);
      if (t) out.push({ level: m[1].length, text: t, line: l.n, offset: l.start });
    }
    return out;
  }

  // Index of the last position that is <= `at` (-1 when `at` is above the first one). `positions` ascend.
  function activeIndex(positions, at) {
    let idx = -1;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] <= at) idx = i;
      else break;
    }
    return idx;
  }

  // ---------- find ----------
  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  // Every non-overlapping occurrence of `query`: [{ from, to }]. Case-insensitive unless `caseSensitive`.
  function findAll(text, query, caseSensitive, max = 20000) {
    if (!query) return [];
    const re = new RegExp(escapeRegExp(query), caseSensitive ? 'gu' : 'giu');
    const out = [];
    let m;
    while ((m = re.exec(text)) && out.length < max) {
      out.push({ from: m.index, to: m.index + m[0].length });
      if (!m[0].length) re.lastIndex++;
    }
    return out;
  }

  // Index of the first match at or after `pos` (wraps to 0); -1 when there are none.
  function startIndex(matches, pos) {
    if (!matches.length) return -1;
    const i = matches.findIndex((m) => m.from >= pos);
    return i === -1 ? 0 : i;
  }

  const stepIndex = (cur, count, dir) => (count ? (((cur + dir) % count) + count) % count : -1);
  const countLabel = (index, count, hasQuery) => (count ? `${index + 1}/${count}` : hasQuery ? 'No results' : '');

  // Short text around a hit, for result lists.
  function snippet(line, col = 0, len = 0, width = 100) {
    const t = String(line).replace(/\t/g, ' ');
    if (t.length <= width) return t.trim();
    const start = Math.max(0, Math.min(col - 30, t.length - width));
    const end = Math.min(t.length, Math.max(start + width, col + len + 20));
    return (start > 0 ? '…' : '') + t.slice(start, end).trim() + (end < t.length ? '…' : '');
  }

  // ---------- tags ----------
  const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '').replace(/^#/, '').trim();
  const norm = (s) => String(s).normalize('NFC');
  const tagKey = (t) => norm(t).toLowerCase();

  // `tags: [a, b]`, `tags: a, b` or a `tags:` list in the front matter → [{ tag, line }].
  function frontMatterTags(text) {
    const m = FM_RE.exec(text);
    if (!m) return [];
    const lines = m[1].split(/\r?\n/);
    const out = [];
    const add = (t, line) => {
      const tag = norm(unquote(t));
      if (tag && !/\s/.test(tag)) out.push({ tag, line });
    };
    for (let i = 0; i < lines.length; i++) {
      const k = /^tags?[ \t]*:[ \t]*(.*)$/i.exec(lines[i]);
      if (!k) continue;
      const val = k[1].trim().replace(/^\[|\]$/g, '').trim();
      const line = i + 2; // line 1 is the opening ---
      if (val) {
        const sep = val.includes(',') || /^\[/.test(k[1].trim()) ? /,/ : /\s+/;
        val.split(sep).forEach((t) => add(t, line));
      } else {
        for (let j = i + 1; j < lines.length; j++) {
          const li = /^[ \t]*-[ \t]+(.+?)[ \t]*$/.exec(lines[j]);
          if (!li) break;
          add(li[1], j + 2);
        }
      }
    }
    return out;
  }

  const TAG_RE = /(^|[^\p{L}\p{N}_/&#\\])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
  const MASKS = [/\[\[[^\]\n]*\]\]/g, /\]\([^)\n]*\)/g, /<!--[\s\S]*?-->/g, /<[^>\n]+>/g, /(?:https?|file):\/\/\S+/g];

  // Inline `#tag`s outside code, headings, links and front matter → [{ tag, line }]. Unicode letters (Vietnamese…) allowed;
  // a tag needs at least one letter (so `#1` and `&#39;` are not tags).
  function inlineTags(text) {
    const out = [];
    for (const l of scanLines(text)) {
      if (l.code || l.fm || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(l.text)) continue;
      let t = maskCode(l.text);
      for (const re of MASKS) t = t.replace(re, blank);
      TAG_RE.lastIndex = 0;
      let m;
      while ((m = TAG_RE.exec(t))) {
        const tag = norm(m[2].replace(/[-/]+$/, ''));
        if (/\p{L}/u.test(tag)) out.push({ tag, line: l.n });
      }
    }
    return out;
  }

  // All tags of a note, front matter first, one entry per tag (case-insensitive): [{ tag, line }].
  function noteTags(text) {
    const seen = new Set();
    const out = [];
    for (const t of [...frontMatterTags(text), ...inlineTags(text)]) {
      const k = tagKey(t.tag);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
    return out;
  }

  // ---------- [[wiki links]] ----------
  const WIKI_SRC = '\\[\\[([^\\[\\]|\\\\\\n]+?)(?:\\\\?\\|([^\\[\\]\\n]*?))?\\]\\]';
  const WIKI_ANCHORED = new RegExp('^' + WIKI_SRC);

  // `[[target]]` / `[[target|alias]]` outside code: [{ target, alias, line, col, raw, snippet }].
  function parseWikiLinks(text) {
    const out = [];
    for (const l of scanLines(text)) {
      if (l.code || l.fm) continue;
      const line = maskCode(l.text);
      const re = new RegExp(WIKI_SRC, 'g');
      let m;
      while ((m = re.exec(line))) {
        const target = m[1].trim();
        if (!target) continue;
        out.push({ target, alias: (m[2] || '').trim(), line: l.n, col: m.index, raw: m[0], snippet: snippet(l.text, m.index, m[0].length) });
      }
    }
    return out;
  }

  // The target of the [[link]] that contains `pos`, or ''.
  function wikiLinkAt(v, pos) {
    const ls = v.lastIndexOf('\n', pos - 1) + 1;
    const le = v.indexOf('\n', pos);
    const line = v.slice(ls, le === -1 ? v.length : le);
    const re = new RegExp(WIKI_SRC, 'g');
    let m;
    while ((m = re.exec(line))) {
      if (pos - ls >= m.index && pos - ls <= m.index + m[0].length) return m[1].trim();
    }
    return '';
  }

  // Name part of a link target: no #heading / ^block anchor, no .md extension.
  const linkName = (target) =>
    String(target)
      .replace(/[#^].*$/, '')
      .trim()
      .replace(/\.(md|markdown|txt)$/i, '');
  const linkKey = (target) => tagKey(linkName(target));

  // [[x]] / [[x|alias]] replaced by plain text (for exports); code is left alone.
  function wikiLinksToText(md) {
    const re = new RegExp('(`+)(?:[^`]|[^`][\\s\\S]*?[^`])\\1(?!`)|' + WIKI_SRC, 'g');
    return scanLines(md)
      .map((l) => (l.code || l.fm ? l.text : l.text.replace(re, (m, tick, target, alias) => (tick ? m : (alias || target).trim()))))
      .join('\n');
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // marked inline extension: [[x]] → <a class="wikilink" data-wiki="x">. The click is handled by the app.
  const markedWikiLink = {
    name: 'wikiLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenizer(src) {
      const m = WIKI_ANCHORED.exec(src);
      if (m && m[1].trim()) return { type: 'wikiLink', raw: m[0], target: m[1].trim(), alias: (m[2] || '').trim() };
    },
    renderer: (t) => `<a href="#" class="wikilink" data-wiki="${esc(t.target)}">${esc(t.alias || t.target)}</a>`,
  };

  // ---------- [[ autocomplete ----------
  // Typing `[[abc` → { query: 'abc', from } where `from` is the offset just after `[[`.
  function wikiQuery(v, caret) {
    const ls = v.lastIndexOf('\n', caret - 1) + 1;
    const m = /\[\[([^\[\]|\n]*)$/.exec(v.slice(ls, caret));
    return m ? { query: m[1], from: caret - m[1].length } : null;
  }

  // names: [{ name, title, rel }] → best matches first.
  function filterNames(names, query, limit = 8) {
    const q = tagKey(query.trim());
    const rank = (n) => {
      const name = tagKey(n.name);
      if (!q) return 0;
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      if (n.title && tagKey(n.title).includes(q)) return 2;
      return n.rel && tagKey(n.rel).includes(q) ? 3 : -1;
    };
    return names
      .map((n, i) => [rank(n), i, n])
      .filter((x) => x[0] >= 0)
      .sort((a, b) => a[0] - b[0] || a[2].name.length - b[2].name.length || a[1] - b[1])
      .slice(0, limit)
      .map((x) => x[2]);
  }

  // Accepting a suggestion: the typed part becomes the name and the link is closed (an auto-inserted `]]` is reused).
  function applyWikiChoice(v, caret, from, name) {
    const to = v.startsWith(']]', caret) ? caret + 2 : caret;
    const pos = from + name.length + 2;
    return { from, to, text: name + ']]', selStart: pos, selEnd: pos };
  }

  // ---------- front matter title ----------
  function frontMatterTitle(text) {
    const m = FM_RE.exec(text);
    const k = m && /^title[ \t]*:[ \t]*(.+?)[ \t]*$/im.exec(m[1]);
    return k ? unquote(k[1]) : '';
  }

  return {
    scanLines, frontMatterLength, plainInline, parseHeadings, activeIndex,
    escapeRegExp, findAll, startIndex, stepIndex, countLabel, snippet,
    frontMatterTags, inlineTags, noteTags, tagKey,
    parseWikiLinks, wikiLinkAt, linkName, linkKey, wikiLinksToText, markedWikiLink,
    wikiQuery, filterNames, applyWikiChoice, frontMatterTitle,
  };
});
