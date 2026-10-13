// HTML (pasted from Word / Google Docs / a web page, or a converted .docx) → Markdown, via Turndown.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('turndown'), require('turndown-plugin-gfm'));
  else root.Html2Md = factory(root.TurndownService, root.turndownPluginGfm);
})(typeof self !== 'undefined' ? self : this, function (TurndownService, gfmPlugin) {
  const LIST_MARK = '\u0001';
  const styleOf = (node) => (node.getAttribute && node.getAttribute('style')) || '';
  const isMsoIgnore = (node) => node.nodeName === 'SPAN' && /mso-list:\s*ignore/i.test(styleOf(node));
  const BOLD = /font-weight:\s*(?:bold|[6-9]00)/i;
  const ITALIC = /font-style:\s*italic/i;
  const wrapMark = (mark) => (content) => (content.trim() ? content.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${mark}$2${mark}$3`) : content);

  function create() {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
    });
    td.use(gfmPlugin.gfm);
    td.addRule('strikethrough', {
      filter: ['del', 's', 'strike'],
      replacement: (content) => (content.trim() ? `~~${content}~~` : content),
    });

    // Google Docs wraps everything in <b style="font-weight:normal">.
    td.addRule('plainBold', {
      filter: (n) => n.nodeName === 'B' && /font-weight:\s*normal/i.test(styleOf(n)),
      replacement: (content) => content,
    });
    // Word / Google Docs mark bold and italic with inline styles on <span>.
    td.addRule('styledSpan', {
      filter: (n) => n.nodeName === 'SPAN' && !isMsoIgnore(n) && (BOLD.test(styleOf(n)) || ITALIC.test(styleOf(n))),
      replacement: (content, n) => {
        const s = styleOf(n);
        let out = content;
        if (ITALIC.test(s)) out = wrapMark('*')(out);
        if (BOLD.test(s)) out = wrapMark('**')(out);
        return out;
      },
    });
    // Word's hand-numbered / bulleted list markers.
    td.addRule('msoListMarker', { filter: isMsoIgnore, replacement: () => '' });
    td.addRule('msoList', {
      filter: (n) => n.nodeName === 'P' && /^MsoListParagraph/i.test(n.getAttribute('class') || ''),
      replacement: (content, n) => {
        const marker = Array.from(n.querySelectorAll('span')).find(isMsoIgnore);
        const ordered = marker && /^\s*(?:\d+|[a-z]|[ivxlc]+)[.)]/i.test(marker.textContent);
        const level = Number((/level(\d+)/i.exec(styleOf(n)) || [])[1]) || 1;
        return `\n${LIST_MARK}${'  '.repeat(level - 1)}${ordered ? '1. ' : '- '}${content.replace(/\s+/g, ' ').trim()}\n`;
      },
    });
    // Images that cannot travel in Markdown (local Word paths) are dropped; embedded ones stay as data: URIs for the app to save.
    td.addRule('localImage', {
      filter: (n) => n.nodeName === 'IMG' && /^(?:file|cid|blob):/i.test(n.getAttribute('src') || ''),
      replacement: () => '',
    });
    td.remove(['style', 'script', 'meta', 'link', 'title']);
    return td;
  }

  let shared;

  // Turndown pads list markers ("-   item"); tidy to one space, leaving fenced code alone.
  function tidyLists(md) {
    let fence = null;
    return md
      .split('\n')
      .map((line) => {
        const f = /^\s*(```+|~~~+)/.exec(line);
        if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
        return fence || f ? line : line.replace(/^(\s*(?:[-*+]|\d+\.))\s{2,}(?=\S)/, '$1 ');
      })
      .join('\n');
  }

  function fragmentOf(html) {
    const s = /<!--\s*StartFragment\s*-->/i.exec(html);
    const e = /<!--\s*EndFragment\s*-->/i.exec(html);
    return s && e && e.index > s.index ? html.slice(s.index + s[0].length, e.index) : html;
  }

  function toMarkdown(html) {
    shared = shared || create();
    let md = shared
      .turndown(fragmentOf(String(html || '')))
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+$/gm, '');
    // Word list paragraphs come out as separate blocks: pull consecutive items back together.
    md = md.replace(new RegExp(`\\n\\n(?=${LIST_MARK})`, 'g'), '\n').split(LIST_MARK).join('');
    return tidyLists(md.replace(/\n{3,}/g, '\n\n')).trim() + '\n';
  }

  // Worth converting on paste? Plain-text-ish HTML (code editors, terminals) should paste as it is.
  const STRUCTURE = /<(?:h[1-6]|ul|ol|li|table|blockquote|strong|b|em|i|a|img|pre|code)\b/i;
  function isRich(html) {
    const h = String(html || '');
    if (!STRUCTURE.test(h)) return false;
    if (/white-space:\s*pre/i.test(h) && /monospace|menlo|consolas|courier/i.test(h)) return false;
    return true;
  }

  return { toMarkdown, isRich };
});
