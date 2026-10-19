// Syntax colouring for the source editor: Markdown, HTML and JSON (and the CSS / JavaScript inside a web page or a
// fenced code block). highlight(kind, text) returns HTML in which every character of `text` appears exactly once,
// in the same order, some of them wrapped in <span class="t-…">. The editor draws it behind the (transparent) textarea,
// so the text must never change — only its colour.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Syntax = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (cls, s) => (s ? (cls ? `<span class="${cls}">${esc(s)}</span>` : esc(s)) : '');

  // One regex made of the rules in order; the text between matches stays uncoloured.
  function rulesOf(rules) {
    const re = new RegExp(rules.map((r) => '(' + r[0] + ')').join('|'), 'g');
    return (text, onMatch) => {
      let out = '';
      let prev = 0;
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        let k = 1;
        while (m[k] === undefined) k++;
        out += esc(text.slice(prev, m.index)) + (onMatch ? onMatch(rules[k - 1][1], m[0]) : span(rules[k - 1][1], m[0]));
        prev = m.index + m[0].length;
      }
      return out + esc(text.slice(prev));
    };
  }

  // ---------- JSON ----------
  const jsonRules = rulesOf([
    ['//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)', 't-comment'],
    ['"(?:[^"\\\\\\n]|\\\\.)*"(?=[ \\t]*:)', 't-key'],
    ['"(?:[^"\\\\\\n]|\\\\.)*(?:"|(?=\\n)|$)', 't-str'],
    ['-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?', 't-num'],
    ['\\b(?:true|false)\\b', 't-kw'],
    ['\\bnull\\b', 't-null'],
    ['[{}\\[\\],:]', 't-punct'],
  ]);

  // ---------- CSS (inside <style>) ----------
  function css(text) {
    let depth = 0;
    return rulesOf([
      ['/\\*[\\s\\S]*?(?:\\*/|$)', 't-comment'],
      ['"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?', 't-str'],
      ['@[\\w-]+', 't-kw'],
      ['#[0-9a-fA-F]{3,8}\\b', 't-num'],
      ['-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|vmin|vmax|ch|s|ms|deg|fr)?\\b', 't-num'],
      ['[\\w-]+(?=[ \\t]*:(?!:))', 'prop'],
      ['[\\w-]+(?=\\()', 't-fn'],
      ['[{}();,:>+~]', 'punct'],
      ['[.#]?[A-Za-z_][\\w-]*', 'name'],
    ])(text, (cls, s) => {
      if (cls === 'punct') {
        if (s === '{') depth++;
        else if (s === '}') depth = Math.max(0, depth - 1);
        return span('t-punct', s);
      }
      if (cls === 'prop') return span(depth ? 't-attr' : 't-tag', s); // inside { } a property; outside a selector like a:hover
      if (cls === 'name') return depth ? span('', s) : span('t-tag', s);
      return span(cls, s);
    });
  }

  // ---------- JavaScript (inside <script>) ----------
  const JS_KEYWORDS = 'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|get|set';
  const js = rulesOf([
    ['//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)', 't-comment'],
    ['"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?|`(?:[^`\\\\]|\\\\[\\s\\S])*`?', 't-str'],
    ['\\b(?:0[xX][0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)\\b', 't-num'],
    ['\\b(?:true|false|null|undefined|NaN|Infinity)\\b', 't-null'],
    ['\\b(?:' + JS_KEYWORDS + ')\\b', 't-kw'],
    ['[A-Za-z_$][\\w$]*(?=\\s*\\()', 't-fn'],
  ]);

  // ---------- HTML ----------
  const ENTITY = /&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
  const text = (s) => {
    let out = '';
    let prev = 0;
    for (const m of s.matchAll(ENTITY)) {
      out += esc(s.slice(prev, m.index)) + span('t-ent', m[0]);
      prev = m.index + m[0].length;
    }
    return out + esc(s.slice(prev));
  };
  const sticky = (src) => new RegExp(src, 'y');
  const RE = {
    ws: sticky('\\s+'),
    end: sticky('/?>'),
    attr: sticky('[^\\s"\'<>/=]+'),
    eq: sticky('='),
    value: sticky('"[^"]*"?|\'[^\']*\'?|[^\\s"\'=<>`]+'),
    head: /^<\/?[a-zA-Z][\w:-]*/,
  };
  const at = (re, s, i) => {
    re.lastIndex = i;
    return re.exec(s);
  };

  function html(src) {
    const n = src.length;
    let out = '';
    let i = 0;
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt === -1) {
        out += text(src.slice(i));
        break;
      }
      out += text(src.slice(i, lt));
      i = lt;
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        const to = end === -1 ? n : end + 3;
        out += span('t-comment', src.slice(i, to));
        i = to;
        continue;
      }
      if (src[i + 1] === '!' || src[i + 1] === '?') {
        const end = src.indexOf('>', i);
        const to = end === -1 ? n : end + 1;
        out += span('t-meta', src.slice(i, to));
        i = to;
        continue;
      }
      const head = RE.head.exec(src.slice(i, i + 80));
      if (!head) {
        out += '&lt;';
        i++;
        continue;
      }
      const closing = src[i + 1] === '/';
      const name = head[0].replace(/^<\/?/, '').toLowerCase();
      out += span('t-tag', head[0]);
      let j = i + head[0].length;
      const tagStart = i;
      let ended = false;
      let selfClose = false;
      while (j < n) {
        let m;
        if ((m = at(RE.ws, src, j))) out += esc(m[0]);
        else if ((m = at(RE.end, src, j))) {
          out += span('t-tag', m[0]);
          ended = true;
          selfClose = m[0] === '/>';
          j += m[0].length;
          break;
        } else if (src[j] === '<') break;
        else if ((m = at(RE.attr, src, j))) out += span('t-attr', m[0]);
        else if ((m = at(RE.eq, src, j))) {
          out += span('t-punct', '=');
          j += 1;
          let w = at(RE.ws, src, j);
          if (w) {
            out += esc(w[0]);
            j += w[0].length;
          }
          const v = at(RE.value, src, j);
          if (v) {
            out += span('t-str', v[0]);
            j += v[0].length;
          }
          continue;
        } else {
          out += esc(src[j]);
          j++;
          continue;
        }
        j += m[0].length;
      }
      i = j;
      if (!ended || closing || selfClose || (name !== 'script' && name !== 'style')) continue;
      const m = new RegExp('</' + name + '(?=[\\s/>])', 'i').exec(src.slice(i));
      const body = m ? src.slice(i, i + m.index) : src.slice(i);
      const isJson = name === 'script' && /type\s*=\s*["']?[^"'>]*json/i.test(src.slice(tagStart, i));
      out += name === 'style' ? css(body) : isJson ? jsonRules(body) : js(body);
      i += body.length;
    }
    return out;
  }

  // ---------- Markdown ----------
  const inlineRules = rulesOf([
    ['(?:``[^\\n]+?``|`[^`\\n]+`)', 't-code'],
    ['<!--.*?-->', 't-comment'],
    ['!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)', 'link'],
    ['\\[\\[[^\\]\\n]+\\]\\]', 't-wiki'],
    ['\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__', 't-bold'],
    ['~~[^~\\n]+~~', 't-strike'],
    ['\\*[^*\\s][^*\\n]*\\*|(?<![\\w])_[^_\\s][^_\\n]*_(?![\\w])', 't-em'],
    ['\\$\\$[^$\\n]+\\$\\$|\\$[^$\\s][^$\\n]*\\$', 't-math'],
    ['</?[a-zA-Z][^>\\n]*>', 't-tag'],
    ['https?://[^\\s)<>\\]]+', 't-url'],
  ]);
  const inline = (line) =>
    inlineRules(line, (cls, s) => {
      if (cls !== 'link') return span(cls, s);
      const k = s.indexOf('](');
      return span('t-link', s.slice(0, k + 1)) + span('t-url', s.slice(k + 1));
    });

  const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#-]*)/;
  const LANGS = { json: jsonRules, jsonc: jsonRules, html: html, xml: html, svg: html, css: css, js: js, javascript: js, ts: js, typescript: js, jsx: js, tsx: js };

  function markdown(src) {
    const lines = src.split('\n');
    const out = [];
    let i = 0;
    // Front matter: a first line of --- and a later closing --- (or ...).
    const close = /^(?:---|\.\.\.)\s*$/;
    const frontEnd = /^---\s*$/.test(lines[0]) ? lines.findIndex((l, k) => k > 0 && close.test(l)) : -1;
    let math = false;
    let comment = false;
    while (i < lines.length) {
      const line = lines[i];
      if (i <= frontEnd) {
        const kv = /^([\w-]+)(:)(.*)$/.exec(line);
        out.push(i === 0 || i === frontEnd ? span('t-meta', line) : kv ? span('t-attr', kv[1]) + span('t-punct', kv[2]) + esc(kv[3]) : esc(line));
        i++;
        continue;
      }
      if (comment) {
        const end = line.indexOf('-->');
        if (end === -1) out.push(span('t-comment', line));
        else {
          comment = false;
          out.push(span('t-comment', line.slice(0, end + 3)) + inline(line.slice(end + 3)));
        }
        i++;
        continue;
      }
      const fence = FENCE.exec(line);
      if (fence && !math) {
        const mark = fence[2];
        const lang = fence[3].toLowerCase();
        out.push(span('t-fence', line));
        i++;
        const body = [];
        while (i < lines.length) {
          const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]);
          if (close && close[1][0] === mark[0] && close[1].length >= mark.length) break;
          body.push(lines[i++]);
        }
        const render = LANGS[lang];
        if (body.length) out.push(render ? render(body.join('\n')) : span('t-code', body.join('\n')));
        if (i < lines.length) out.push(span('t-fence', lines[i++]));
        continue;
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        math = !math;
        out.push(span('t-math', line));
      } else if (math) out.push(span('t-math', line));
      else {
        const open = line.indexOf('<!--');
        let m;
        if (open !== -1 && line.indexOf('-->', open) === -1) {
          comment = true;
          out.push(inline(line.slice(0, open)) + span('t-comment', line.slice(open)));
        } else if ((m = /^(\s{0,3}#{1,6})(\s.*|)$/.exec(line))) out.push(span('t-hmark', m[1]) + `<span class="t-h">${inline(m[2])}</span>`);
        else if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) out.push(span('t-punct', line));
        else if ((m = /^(\s*(?:>\s?)+)(.*)$/.exec(line))) out.push(span('t-quote', m[1]) + inline(m[2]));
        else if ((m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line))) out.push(esc(m[1]) + span('t-list', m[2]) + esc(m[3]) + span('t-list', m[4] || '') + inline(m[5]));
        else if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/.test(line)) out.push(span('t-punct', line));
        else if (/^\s*\|.*\|\s*$/.test(line)) out.push(line.split('|').map(inline).join(span('t-punct', '|')));
        else out.push(inline(line));
      }
      i++;
    }
    return out.join('\n');
  }

  // Beyond this size the editor shows plain text instead (colouring on every key would lag).
  const MAX_LENGTH = 300000;

  function highlight(kind, src) {
    return kind === 'html' ? html(src) : kind === 'json' ? jsonRules(src) : markdown(src);
  }

  return { highlight, MAX_LENGTH, esc };
});
