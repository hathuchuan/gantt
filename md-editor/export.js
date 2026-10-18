// Export a note as .docx (Markdown → Word) or .pdf (rendered HTML → Chromium print).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const docx = require('docx');
const { Marked } = require('./src/vendor/marked.umd.js');
const MarkedMath = require('./src/math.js');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, ExternalHyperlink,
  LevelFormat, AlignmentType, BorderStyle, ShadingType,
} = docx;

// ---------- Markdown → DOCX ----------
const PAGE_WIDTH = 11906; // A4 in twips
const PAGE_HEIGHT = 16838;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const MAX_IMAGE_PX = 600;
const MONO = 'Consolas';

const decode = (t) =>
  String(t == null ? '' : t)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, '&');

// Natural size of a PNG / JPEG / GIF (the formats Word embeds as they are).
function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { type: 'jpg', width: 400, height: 300 };
  }
  return null;
}

const INLINE_TAGS = {
  u: 'underline', mark: 'highlight', sub: 'sub', sup: 'sup', kbd: 'code',
  b: 'bold', strong: 'bold', i: 'italics', em: 'italics', s: 'strike', del: 'strike', strike: 'strike',
};

function runOptions(fmt) {
  const o = {};
  if (fmt.bold) o.bold = true;
  if (fmt.italics) o.italics = true;
  if (fmt.strike) o.strike = true;
  if (fmt.underline) o.underline = {};
  if (fmt.highlight) o.highlight = 'yellow';
  if (fmt.sub) o.subScript = true;
  if (fmt.sup) o.superScript = true;
  if (fmt.code) Object.assign(o, { font: MONO, size: 20, shading: { type: ShadingType.CLEAR, fill: 'F2F2F4', color: 'auto' } });
  if (fmt.math) Object.assign(o, { font: 'Cambria Math', italics: true });
  if (fmt.link) Object.assign(o, { color: '0563C1', underline: {} });
  return o;
}

function hrefOf(href, baseDir) {
  if (!href) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  if (href.startsWith('#')) return '';
  let p = href;
  try {
    p = decodeURI(href);
  } catch {}
  return pathToFileURL(path.resolve(baseDir || '.', p)).href;
}

function localImage(href, baseDir) {
  if (!href || /^(?:https?|data):/i.test(href)) return null;
  let p = href;
  try {
    p = decodeURI(href);
  } catch {}
  if (/^file:/i.test(p)) p = decodeURIComponent(new URL(p).pathname);
  else p = path.resolve(baseDir || '.', p);
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

function createMarked() {
  const m = new Marked({ gfm: true });
  m.use({ extensions: MarkedMath.extensions });
  return m;
}

async function markdownToDocx(markdown, { baseDir, title } = {}) {
  const tokens = createMarked().lexer(String(markdown || ''));
  let listCounter = 0;

  function inline(toks, fmt = {}) {
    const out = [];
    const cur = { ...fmt };
    for (const t of toks || []) {
      switch (t.type) {
        case 'text':
        case 'escape':
          if (t.tokens && t.tokens.length) out.push(...inline(t.tokens, cur));
          else if (t.text) out.push(new TextRun({ text: decode(t.text), ...runOptions(cur) }));
          break;
        case 'strong':
          out.push(...inline(t.tokens, { ...cur, bold: true }));
          break;
        case 'em':
          out.push(...inline(t.tokens, { ...cur, italics: true }));
          break;
        case 'del':
          out.push(...inline(t.tokens, { ...cur, strike: true }));
          break;
        case 'codespan':
          out.push(new TextRun({ text: decode(t.text), ...runOptions({ ...cur, code: true }) }));
          break;
        case 'mathInline':
          out.push(new TextRun({ text: t.text, ...runOptions({ ...cur, math: true }) }));
          break;
        case 'br':
          out.push(new TextRun({ break: 1 }));
          break;
        case 'link': {
          const children = inline(t.tokens, { ...cur, link: true });
          const link = hrefOf(t.href, baseDir);
          out.push(link ? new ExternalHyperlink({ link, children }) : children.length ? children[0] : new TextRun(''));
          if (!link) out.push(...children.slice(1));
          break;
        }
        case 'image': {
          const data = localImage(t.href, baseDir);
          const info = data && imageInfo(data);
          if (!info) {
            out.push(new TextRun({ text: `[image: ${decode(t.text) || t.href}]`, italics: true, color: '888888' }));
            break;
          }
          const k = Math.min(1, MAX_IMAGE_PX / (info.width || MAX_IMAGE_PX));
          out.push(
            new ImageRun({
              type: info.type,
              data,
              transformation: { width: Math.max(1, Math.round(info.width * k)), height: Math.max(1, Math.round(info.height * k)) },
              altText: { name: decode(t.text) || 'image', description: decode(t.text) || 'image', title: decode(t.text) || 'image' },
            })
          );
          break;
        }
        case 'html': {
          const raw = (t.text || t.raw || '').trim();
          if (/^<br\s*\/?>$/i.test(raw)) out.push(new TextRun({ break: 1 }));
          else {
            const m = /^<(\/?)([a-z]+)\b[^>]*>$/i.exec(raw);
            const key = m && INLINE_TAGS[m[2].toLowerCase()];
            if (key) cur[key] = !m[1];
          }
          break;
        }
        default:
          if (t.tokens) out.push(...inline(t.tokens, cur));
          else if (t.text) out.push(new TextRun({ text: decode(t.text), ...runOptions(cur) }));
      }
    }
    return out;
  }

  const quoteProps = (ctx) =>
    ctx.quote
      ? {
          indent: { left: 540 * ctx.quote },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'BBBBBB', space: 10 } },
        }
      : ctx.indent
        ? { indent: { left: ctx.indent } }
        : {};

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  function list(token, ctx) {
    const out = [];
    const id = ++listCounter;
    const level = ctx.level || 0;
    for (const item of token.items) {
      let first = true;
      const prefix = item.task ? [new TextRun({ text: item.checked ? '☑ ' : '☐ ' })] : [];
      for (const t of item.tokens) {
        if (t.type === 'checkbox' || t.type === 'space') continue;
        if ((t.type === 'text' || t.type === 'paragraph') && first) {
          first = false;
          out.push(
            new Paragraph({
              children: [...prefix, ...inline(t.tokens || [{ type: 'text', text: t.text }])],
              numbering: { reference: token.ordered ? 'ordered' : 'bullets', level: Math.min(level, 5), instance: id },
              spacing: { after: 60 },
            })
          );
        } else if (t.type === 'list') out.push(...list(t, { ...ctx, level: level + 1 }));
        else out.push(...block([t], { ...ctx, indent: (level + 1) * 720 }));
      }
    }
    return out;
  }

  function table(token) {
    const cols = token.header.length;
    const widths = Array.from({ length: cols }, () => Math.floor(CONTENT_WIDTH / cols));
    const alignment = (a) => (a === 'center' ? AlignmentType.CENTER : a === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT);
    const cell = (c, i, header) =>
      new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: header ? { type: ShadingType.CLEAR, fill: 'F2F2F4', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ alignment: alignment(token.align[i]), children: inline(c.tokens, header ? { bold: true } : {}) })],
      });
    return new Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnWidths: widths,
      rows: [
        new TableRow({ tableHeader: true, children: token.header.map((c, i) => cell(c, i, true)) }),
        ...token.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) })),
      ],
    });
  }

  function block(toks, ctx = {}) {
    const out = [];
    for (const t of toks) {
      switch (t.type) {
        case 'heading':
          out.push(new Paragraph({ heading: HEADINGS[Math.min(6, t.depth) - 1], children: inline(t.tokens), spacing: { before: 240, after: 120 } }));
          break;
        case 'paragraph':
        case 'text':
          out.push(new Paragraph({ children: inline(t.tokens || [{ type: 'text', text: t.text }]), spacing: { after: 140 }, ...quoteProps(ctx) }));
          break;
        case 'code': {
          const lines = String(t.text).replace(/\s+$/, '').split('\n');
          lines.forEach((line, i) =>
            out.push(
              new Paragraph({
                children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
                shading: { type: ShadingType.CLEAR, fill: 'F5F5F7', color: 'auto' },
                spacing: { after: i === lines.length - 1 ? 160 : 0 },
                ...quoteProps(ctx),
              })
            )
          );
          break;
        }
        case 'mathBlock':
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 160 },
              children: [new TextRun({ text: t.text, ...runOptions({ math: true }) })],
            })
          );
          break;
        case 'blockquote':
          out.push(...block(t.tokens, { ...ctx, quote: (ctx.quote || 0) + 1 }));
          break;
        case 'list':
          out.push(...list(t, ctx));
          break;
        case 'table':
          out.push(table(t), new Paragraph({ spacing: { after: 120 } }));
          break;
        case 'hr':
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } }, spacing: { after: 160 } }));
          break;
        default: // space, html comments and raw HTML blocks have no Word equivalent
          break;
      }
    }
    return out;
  }

  const bulletLevels = Array.from({ length: 6 }, (_, l) => ({
    level: l,
    format: LevelFormat.BULLET,
    text: ['•', '◦', '▪'][l % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } },
  }));
  const orderedLevels = Array.from({ length: 6 }, (_, l) => ({
    level: l,
    format: LevelFormat.DECIMAL,
    text: `%${l + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } },
  }));

  const children = block(tokens);
  const doc = new Document({
    creator: 'MD Editor',
    title: title || '',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'bullets', levels: bulletLevels },
        { reference: 'ordered', levels: orderedLevels },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        children: children.length ? children : [new Paragraph('')],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------- rendered HTML → PDF ----------
const SRC = path.join(__dirname, 'src');
const fileUrl = (p) => pathToFileURL(p).href;

const PRINT_CSS = `
html, body { height: auto; overflow: visible; background: #fff; color: #1d1d1f; }
body { transition: none; }
#preview { position: static; width: auto; height: auto; padding: 0; overflow: visible; font-size: 11.5pt; line-height: 1.6; }
#preview pre, #preview table, #preview img, #preview blockquote, #preview .math-ph { break-inside: avoid; }
#preview h1, #preview h2, #preview h3, #preview h4 { break-after: avoid; }
#preview pre { white-space: pre-wrap; word-break: break-word; }
#preview a { color: #0a6cff; }
`;

function exportHtml(bodyHtml, baseDir) {
  const base = baseDir ? `<base href="${fileUrl(baseDir.replace(/\/?$/, '/'))}">` : '';
  return `<!doctype html>
<html data-theme="light"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: https:; style-src file: 'unsafe-inline'; font-src file: data:">
${base}
<link rel="stylesheet" href="${fileUrl(path.join(SRC, 'vendor', 'katex.min.css'))}">
<link rel="stylesheet" href="${fileUrl(path.join(SRC, 'style.css'))}">
<link rel="stylesheet" href="${fileUrl(path.join(SRC, 'highlight.css'))}">
<style>${PRINT_CSS}</style>
</head><body><article id="preview">${bodyHtml}</article></body></html>`;
}

// `electron` is required lazily so the Markdown → DOCX half can run under plain Node (tests).
// A whole web page (not a note's body) is printed as written; <base> keeps its relative pictures and styles working.
function withBase(html, baseDir) {
  if (!baseDir) return html;
  const tag = `<base href="${fileUrl(baseDir.replace(/\/?$/, '/'))}">`;
  for (const re of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i]) {
    const m = re.exec(html);
    if (m) {
      const at = m.index + m[0].length;
      return html.slice(0, at) + (re.source.startsWith('<head') ? tag : `<head>${tag}</head>`) + html.slice(at);
    }
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html;
}

async function htmlToPdf(bodyHtml, { baseDir, raw } = {}) {
  const { BrowserWindow } = require('electron');
  const tmp = path.join(os.tmpdir(), `mdeditor-export-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, raw ? withBase(bodyHtml, baseDir) : exportHtml(bodyHtml, baseDir));
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await win.loadFile(tmp);
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.75, bottom: 0.75, left: 0.8, right: 0.8 },
    });
  } finally {
    win.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
}

module.exports = { markdownToDocx, htmlToPdf, exportHtml, withBase, imageInfo };
