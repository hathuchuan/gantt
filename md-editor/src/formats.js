// HTML and JSON support for the editor: which file is which kind, the / commands for each, JSON checking and
// formatting, and the small typing helpers (auto-indent, auto-close) that code needs and Markdown does not.
// Like editing.js, every helper that touches text returns an "edit" ({ from, to, text, selStart, selEnd }) or null.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Formats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const edit = (from, to, text, selStart, selEnd = selStart) => ({ from, to, text, selStart, selEnd });
  const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
  const lineEnd = (v, i) => {
    const j = v.indexOf('\n', i);
    return j === -1 ? v.length : j;
  };

  // ---------- which kind of file ----------
  const KINDS = ['md', 'html', 'json'];
  function kindOf(name) {
    if (/\.(html?|xhtml)$/i.test(name || '')) return 'html';
    if (/\.(json|geojson)$/i.test(name || '')) return 'json';
    return 'md';
  }
  const EXT = { md: 'md', html: 'html', json: 'json' };

  // ---------- JSON ----------
  function lineCol(text, pos) {
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    return { line, col: pos - (before.lastIndexOf('\n') + 1) + 1 };
  }

  // Finds the first mistake in text that JSON.parse rejected, with a plain-language message.
  // It only has to be right about invalid input — valid JSON never reaches it.
  function findJsonError(t) {
    const n = t.length;
    let i = 0;
    const fail = (message, at = i) => {
      throw { pos: Math.min(at, n), message };
    };
    const ws = () => {
      while (i < n && ' \t\n\r'.includes(t[i])) i++;
    };
    const end = (what) => fail(`The text ends too early — ${what} is missing`, n);
    const str = () => {
      const start = i;
      i++;
      while (i < n) {
        const c = t[i];
        if (c === '"') return void i++;
        if (c === '\\') {
          const nx = t[i + 1];
          if (nx === undefined) break;
          if (nx === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(t.slice(i + 2, i + 6))) fail('A \\u escape needs 4 hex digits', i);
            i += 6;
          } else if ('"\\/bfnrt'.includes(nx)) i += 2;
          else fail(`“\\${nx}” is not a valid escape — write \\\\ for a backslash`, i);
        } else if (c < ' ') fail('A line break inside a string — write \\n instead', i);
        else i++;
      }
      fail('This string never closes — add the closing "', start);
    };
    const val = () => {
      ws();
      const c = t[i];
      if (c === undefined) end('a value');
      if (c === '{') {
        i++;
        ws();
        if (t[i] === '}') return void i++;
        for (;;) {
          ws();
          if (t[i] === undefined) end('“}”');
          if (t[i] === '}') fail('Extra comma before “}” — remove it');
          if (t[i] !== '"') fail(t[i] === "'" ? 'Use "double quotes" for names, not single quotes' : 'A name must be in "double quotes"');
          str();
          ws();
          if (t[i] !== ':') fail(t[i] === undefined ? 'The text ends too early — “:” is missing' : 'Expected “:” after the name');
          i++;
          val();
          ws();
          if (t[i] === ',') {
            i++;
            continue;
          }
          if (t[i] === '}') return void i++;
          if (t[i] === undefined) end('“}”');
          fail('Expected “,” or “}” here — is a comma missing?');
        }
      }
      if (c === '[') {
        i++;
        ws();
        if (t[i] === ']') return void i++;
        for (;;) {
          ws();
          if (t[i] === ']') fail('Extra comma before “]” — remove it');
          val();
          ws();
          if (t[i] === ',') {
            i++;
            continue;
          }
          if (t[i] === ']') return void i++;
          if (t[i] === undefined) end('“]”');
          fail('Expected “,” or “]” here — is a comma missing?');
        }
      }
      if (c === '"') return str();
      for (const lit of ['true', 'false', 'null']) {
        if (t.startsWith(lit, i)) return void (i += lit.length);
      }
      if (c === '-' || (c >= '0' && c <= '9')) {
        const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(t.slice(i));
        if (!m) fail('This is not a valid number');
        i += m[0].length;
        return;
      }
      if (c === "'") fail('Use "double quotes", not single quotes');
      if (c === '/') fail('Comments (// or /* */) are not allowed in JSON');
      if (/[A-Za-z_]/.test(c)) fail('Text values must be in "double quotes"');
      fail(`Unexpected “${c}”`);
    };
    try {
      val();
      ws();
      if (i < n) fail('Unexpected text after the end of the JSON');
    } catch (err) {
      if (err && typeof err.pos === 'number') return err;
      throw err;
    }
    return null;
  }

  // { ok: true, value } or { ok: false, empty?, pos, line, col, message }
  function jsonCheck(text) {
    if (!String(text).trim()) return { ok: false, empty: true, pos: 0, line: 1, col: 1, message: 'Empty — type { } for an object or [ ] for a list' };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      const err = findJsonError(text) || { pos: 0, message: 'Not valid JSON' };
      return { ok: false, pos: err.pos, ...lineCol(text, err.pos), message: err.message };
    }
  }

  const jsonFormat = (text, indent = 2) => {
    const r = jsonCheck(text);
    return r.ok ? JSON.stringify(r.value, null, indent) + '\n' : null;
  };
  const jsonMinify = (text) => {
    const r = jsonCheck(text);
    return r.ok ? JSON.stringify(r.value) + '\n' : null;
  };
  function sortKeys(x) {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
    return x;
  }
  const jsonSortKeys = (text) => {
    const r = jsonCheck(text);
    return r.ok ? JSON.stringify(sortKeys(r.value), null, 2) + '\n' : null;
  };

  // ---------- HTML page and styles ----------
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

  const CSS_RULES = [
    ':root { --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --accent: #0a6cff; --soft: #f5f5f7; }',
    '@media (prefers-color-scheme: dark) { :root { --bg: #1c1c1e; --fg: #f5f5f7; --muted: #98989d; --line: #38383a; --accent: #4c9bff; --soft: #2c2c2e; } }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }',
    '.container { max-width: 960px; margin: 0 auto; padding: 0 24px; }',
    'section { padding: 48px 0; }',
    'h1, h2, h3 { line-height: 1.25; }',
    'a { color: var(--accent); }',
    'img, video { max-width: 100%; border-radius: 8px; }',
    '.nav { display: flex; gap: 20px; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--line); }',
    '.nav a { text-decoration: none; color: inherit; }',
    '.nav .brand { font-weight: 700; margin-right: auto; }',
    '.hero { padding: 96px 24px; text-align: center; background: var(--soft); }',
    '.hero h1 { font-size: 2.8em; margin: 0 0 0.3em; }',
    '.hero p { color: var(--muted); font-size: 1.2em; margin: 0 auto 1.5em; max-width: 640px; }',
    '.btn { display: inline-block; padding: 10px 22px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }',
    '.btn.outline { background: transparent; color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent); }',
    '.grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }',
    '.cols-2, .cols-3 { display: grid; gap: 24px; }',
    '.cols-2 { grid-template-columns: repeat(2, 1fr); }',
    '.cols-3 { grid-template-columns: repeat(3, 1fr); }',
    '@media (max-width: 720px) { .cols-2, .cols-3 { grid-template-columns: 1fr; } }',
    '.card { padding: 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg); }',
    '.card h3 { margin-top: 0; }',
    '.alert { padding: 14px 18px; border-radius: 10px; background: var(--soft); border-left: 4px solid var(--accent); }',
    '.alert.warn { border-color: #ff9f0a; }',
    '.alert.ok { border-color: #30d158; }',
    '.alert.error { border-color: #ff453a; }',
    '.badge { display: inline-block; padding: 2px 10px; border-radius: 99px; background: var(--soft); font-size: 0.8em; font-weight: 600; }',
    '.muted { color: var(--muted); }',
    '.center { text-align: center; }',
    'table { border-collapse: collapse; width: 100%; }',
    'th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; }',
    'th { background: var(--soft); }',
    'blockquote { margin: 1em 0; padding: 0 1em; border-left: 3px solid var(--line); color: var(--muted); }',
    'pre { padding: 14px 16px; background: var(--soft); border-radius: 10px; overflow: auto; }',
    'code { font-family: ui-monospace, Menlo, monospace; }',
    'form { display: grid; gap: 14px; max-width: 480px; }',
    'label { display: grid; gap: 6px; font-weight: 600; }',
    'input, textarea, select { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: inherit; font: inherit; }',
    'details { padding: 12px 16px; border: 1px solid var(--line); border-radius: 10px; margin: 8px 0; }',
    'summary { cursor: pointer; font-weight: 600; }',
    'footer { padding: 32px 24px; text-align: center; color: var(--muted); border-top: 1px solid var(--line); }',
  ];
  const indentBy = (text, pad) => text.split('\n').map((l) => (l ? pad + l : l)).join('\n');
  const styleBlock = (pad = '') => `${pad}<style>\n${CSS_RULES.map((r) => pad + '  ' + r).join('\n')}\n${pad}</style>`;

  function htmlTemplate({ cursor = true } = {}) {
    return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trang mới</title>
${styleBlock('  ')}
</head>
<body>
  <section>
    <div class="container">
      <h1>Tiêu đề trang</h1>
      <p>${cursor ? '{cursor}' : ''}Viết nội dung của bạn ở đây. Gõ / để chèn tiêu đề, nút bấm, bảng, biểu mẫu…</p>
    </div>
  </section>
</body>
</html>
`;
  }

  // The text a brand-new empty file starts with.
  const templateFor = (kind) => (kind === 'html' ? htmlTemplate({ cursor: false }) : kind === 'json' ? '{\n  \n}\n' : '');

  // ---------- / commands ----------
  // `sel` finds the placeholder text inside `text`, so it is selected (and replaced) when the command is inserted.
  const sel = (text, needle) => {
    const a = text.indexOf(needle);
    return [a, a + needle.length];
  };
  const BLOCK = { block: true };
  const mk = (kind, group, key, label, hint, text, extra = {}) => ({ kind, id: kind + ':' + key, group, key, label, hint, text, ...extra });
  const H = (group, key, label, hint, text, extra) => mk('html', 'HTML · ' + group, key, label, hint, text, extra);
  const J = (group, key, label, hint, text, extra) => mk('json', 'JSON · ' + group, key, label, hint, text, extra);

  const T = {
    link: '<a href="https://">Văn bản liên kết</a>',
    button: '<a class="btn" href="#">Nút bấm</a>',
    image: '<img src="anh.jpg" alt="Mô tả ảnh">',
    video: '<video controls src="video.mp4"></video>',
    audio: '<audio controls src="am-thanh.mp3"></audio>',
    figure: '<figure>\n  <img src="anh.jpg" alt="Mô tả ảnh">\n  <figcaption>Chú thích ảnh</figcaption>\n</figure>',
  };

  const HTML_ITEMS = [
    H('Page', 'page', 'Full page (starter)', '📄', htmlTemplate(), BLOCK),
    H('Page', 'css', 'Standard styles (<style>)', '🎨', styleBlock(), BLOCK),
    H('Page', 'comment', 'Hidden comment', '<!', '<!-- {cursor} -->'),
    H('Page', 'browser', 'Open in browser', '🌐', null, { action: 'open-browser' }),

    H('Text', 'h1', 'Heading 1', 'H1', '<h1>{cursor}</h1>', BLOCK),
    H('Text', 'h2', 'Heading 2', 'H2', '<h2>{cursor}</h2>', BLOCK),
    H('Text', 'h3', 'Heading 3', 'H3', '<h3>{cursor}</h3>', BLOCK),
    H('Text', 'p', 'Paragraph', '¶', '<p>{cursor}</p>', BLOCK),
    H('Text', 'bold', 'Bold', 'B', '<strong>{cursor}</strong>'),
    H('Text', 'italic', 'Italic', 'I', '<em>{cursor}</em>'),
    H('Text', 'bolditalic', 'Bold italic', 'BI', '<strong><em>{cursor}</em></strong>'),
    H('Text', 'strike', 'Strikethrough', 'S̶', '<s>{cursor}</s>'),
    H('Text', 'underline', 'Underline', 'U', '<u>{cursor}</u>'),
    H('Text', 'highlight', 'Highlight', '▮', '<mark>{cursor}</mark>'),
    H('Text', 'small', 'Small text', 'a', '<small>{cursor}</small>'),
    H('Text', 'superscript', 'Superscript', 'x²', '<sup>{cursor}</sup>'),
    H('Text', 'subscript', 'Subscript', 'x₂', '<sub>{cursor}</sub>'),
    H('Text', 'inlinecode', 'Inline code', '`', '<code>{cursor}</code>'),
    H('Text', 'color', 'Coloured text', '🖍', '<span style="color: #e03131">{cursor}</span>'),
    ...[
      ['red', 'Red text', '#e03131'], ['orange', 'Orange text', '#f76707'], ['green', 'Green text', '#2f9e44'],
      ['blue', 'Blue text', '#1c7ed6'], ['purple', 'Purple text', '#7048e8'], ['gray', 'Gray text', '#868e96'],
    ].map(([key, label, c]) => H('Text', key, label, 'A', `<span style="color: ${c}">{cursor}</span>`)),
    H('Text', 'yellowmark', 'Yellow highlighter', '▮', '<span style="background-color: #fff3bf">{cursor}</span>'),
    H('Text', 'big', 'Larger text', 'A+', '<span style="font-size: 1.5em">{cursor}</span>'),
    H('Text', 'huge', 'Huge text', 'A++', '<span style="font-size: 2.2em">{cursor}</span>'),
    H('Text', 'alignleft', 'Align left', '⇤', '<div style="text-align: left">\n  {cursor}\n</div>', BLOCK),
    H('Text', 'aligncenter', 'Align center', '≡', '<div style="text-align: center">\n  {cursor}\n</div>', BLOCK),
    H('Text', 'alignright', 'Align right', '⇥', '<div style="text-align: right">\n  {cursor}\n</div>', BLOCK),
    H('Text', 'justify', 'Justify', '☰', '<div style="text-align: justify">\n  {cursor}\n</div>', BLOCK),
    H('Text', 'linebreak', 'Line break', '↵', '<br>\n'),
    H('Text', 'link', 'Link', '🔗', T.link, { select: sel(T.link, 'https://') }),
    H('Text', 'button', 'Button (link styled as button)', '▭', T.button, { select: sel(T.button, 'Nút bấm') }),

    H('Layout', 'container', 'Centered container', '▢', '<div class="container">\n  {cursor}\n</div>', BLOCK),
    H('Layout', 'section', 'Section with heading', '§', '<section>\n  <div class="container">\n    <h2>Tiêu đề phần</h2>\n    {cursor}\n  </div>\n</section>', BLOCK),
    H('Layout', 'nav', 'Navigation bar', '☰', '<nav class="nav">\n  <a class="brand" href="#">Tên trang</a>\n  <a href="#">Giới thiệu</a>\n  <a href="#">Dịch vụ</a>\n  <a href="#">Liên hệ</a>\n</nav>', BLOCK),
    H('Layout', 'hero', 'Hero banner', '★', '<header class="hero">\n  <h1>Tiêu đề lớn</h1>\n  <p>Một câu giới thiệu ngắn gọn.</p>\n  <a class="btn" href="#">Bắt đầu</a>\n</header>', BLOCK),
    H('Layout', 'cols2', 'Two columns', '▥', '<div class="cols-2">\n  <div>\n    {cursor}\n  </div>\n  <div>\n    \n  </div>\n</div>', BLOCK),
    H('Layout', 'cols3', 'Three columns', '▥', '<div class="cols-3">\n  <div>\n    {cursor}\n  </div>\n  <div>\n    \n  </div>\n  <div>\n    \n  </div>\n</div>', BLOCK),
    H('Layout', 'grid', 'Card grid (3 cards)', '▦', '<div class="grid">\n  <div class="card">\n    <h3>Thẻ 1</h3>\n    <p>{cursor}Nội dung.</p>\n  </div>\n  <div class="card">\n    <h3>Thẻ 2</h3>\n    <p>Nội dung.</p>\n  </div>\n  <div class="card">\n    <h3>Thẻ 3</h3>\n    <p>Nội dung.</p>\n  </div>\n</div>', BLOCK),
    H('Layout', 'card', 'Card', '▭', '<div class="card">\n  <h3>Tiêu đề thẻ</h3>\n  <p>{cursor}Nội dung.</p>\n</div>', BLOCK),
    H('Layout', 'center', 'Center content', '≡', '<div class="center">\n  {cursor}\n</div>', BLOCK),
    H('Layout', 'footer', 'Footer', '⊥', '<footer>\n  © {year} {cursor}Tên của bạn\n</footer>', BLOCK),
    H('Layout', 'divider', 'Divider', '—', '<hr>\n', BLOCK),

    H('Media', 'image', 'Image', '▣', T.image, { select: sel(T.image, 'anh.jpg') }),
    H('Media', 'figure', 'Image with caption', '▣', T.figure, { block: true, select: sel(T.figure, 'anh.jpg') }),
    H('Media', 'video', 'Video file', '▶', T.video, { block: true, select: sel(T.video, 'video.mp4') }),
    H('Media', 'audio', 'Audio file', '♪', T.audio, { block: true, select: sel(T.audio, 'am-thanh.mp3') }),

    H('Lists & tables', 'list', 'Bullet list', '•', '<ul>\n  <li>{cursor}</li>\n  <li></li>\n  <li></li>\n</ul>', BLOCK),
    H('Lists & tables', 'numbered', 'Numbered list', '1.', '<ol>\n  <li>{cursor}</li>\n  <li></li>\n  <li></li>\n</ol>', BLOCK),
    H('Lists & tables', 'table', 'Table', '▦', '<table>\n  <thead>\n    <tr><th>{cursor}Cột 1</th><th>Cột 2</th><th>Cột 3</th></tr>\n  </thead>\n  <tbody>\n    <tr><td></td><td></td><td></td></tr>\n    <tr><td></td><td></td><td></td></tr>\n  </tbody>\n</table>', BLOCK),
    H('Lists & tables', 'row', 'Table row', '▤', '<tr><td>{cursor}</td><td></td><td></td></tr>', BLOCK),
    H('Lists & tables', 'details', 'Collapsible section', '▸', '<details>\n  <summary>Câu hỏi hoặc tiêu đề</summary>\n  <p>{cursor}Nội dung ẩn.</p>\n</details>', BLOCK),

    H('Components', 'alert', 'Notice box', 'ⓘ', '<div class="alert">\n  {cursor}\n</div>', BLOCK),
    H('Components', 'warning', 'Warning box', '⚠', '<div class="alert warn">\n  {cursor}\n</div>', BLOCK),
    H('Components', 'success', 'Success box', '✓', '<div class="alert ok">\n  {cursor}\n</div>', BLOCK),
    H('Components', 'error', 'Error box', '✕', '<div class="alert error">\n  {cursor}\n</div>', BLOCK),
    H('Components', 'badge', 'Badge', '◖', '<span class="badge">{cursor}</span>'),
    H('Components', 'quote', 'Quote', '>', '<blockquote>\n  {cursor}\n</blockquote>', BLOCK),
    H('Components', 'code', 'Code block', '</>', '<pre><code>{cursor}</code></pre>', BLOCK),

    H('Form', 'form', 'Form (name, email, message)', '✉', '<form action="#" method="post">\n  <label>Họ tên\n    <input type="text" name="name" required>\n  </label>\n  <label>Email\n    <input type="email" name="email" required>\n  </label>\n  <label>Lời nhắn\n    <textarea name="message" rows="4"></textarea>\n  </label>\n  <button class="btn" type="submit">Gửi</button>\n</form>', BLOCK),
    H('Form', 'input', 'Text field', '▭', '<label>{cursor}Nhãn\n  <input type="text" name="ten-truong">\n</label>', BLOCK),
    H('Form', 'textarea', 'Multi-line field', '▤', '<label>{cursor}Nhãn\n  <textarea name="ten-truong" rows="4"></textarea>\n</label>', BLOCK),
    H('Form', 'select', 'Dropdown', '▾', '<label>{cursor}Nhãn\n  <select name="ten-truong">\n    <option>Lựa chọn 1</option>\n    <option>Lựa chọn 2</option>\n  </select>\n</label>', BLOCK),
    H('Form', 'checkbox', 'Checkbox', '☑', '<label><input type="checkbox" name="ten-truong"> {cursor}Nhãn</label>', BLOCK),
    H('Form', 'submit', 'Submit button', '➤', '<button class="btn" type="submit">{cursor}Gửi</button>', BLOCK),

    H('Insert', 'date', 'Today’s date', '📅', '{date}'),
    H('Insert', 'year', 'Current year', '©', '{year}'),
  ];

  const JSON_ITEMS = [
    J('Values', 'string', 'Text', '“ ”', '"{cursor}"'),
    J('Values', 'number', 'Number', '#', '0', { select: [0, 1] }),
    J('Values', 'true', 'true', '✓', 'true'),
    J('Values', 'false', 'false', '✗', 'false'),
    J('Values', 'null', 'null', '∅', 'null'),
    J('Values', 'object', 'Object { }', '{ }', '{\n  "{cursor}": ""\n}'),
    J('Values', 'array', 'List [ ]', '[ ]', '[\n  {cursor}\n]'),

    J('Pairs', 'pair', 'Name: text', '"k":', '"key": "value"', { select: [1, 4] }),
    J('Pairs', 'pairnumber', 'Name: number', '"k":#', '"key": 0', { select: [1, 4] }),
    J('Pairs', 'pairbool', 'Name: true/false', '"k":✓', '"key": true', { select: [1, 4] }),
    J('Pairs', 'pairnull', 'Name: null', '"k":∅', '"key": null', { select: [1, 4] }),
    J('Pairs', 'pairobject', 'Name: object', '"k":{ }', '"key": {\n  "{cursor}": ""\n}'),
    J('Pairs', 'pairarray', 'Name: list', '"k":[ ]', '"key": [\n  {cursor}\n]'),

    J('Templates', 'person', 'Person record', '👤', '{\n  "name": "{cursor}",\n  "email": "",\n  "age": 0,\n  "active": true,\n  "tags": []\n}', BLOCK),
    J('Templates', 'records', 'List of records', '☰', '[\n  { "id": 1, "name": "{cursor}" },\n  { "id": 2, "name": "" }\n]', BLOCK),
    J('Templates', 'package', 'package.json', '📦', '{\n  "name": "{cursor}",\n  "version": "1.0.0",\n  "description": "",\n  "main": "index.js",\n  "scripts": {\n    "start": "node index.js"\n  },\n  "license": "MIT"\n}', BLOCK),
    J('Templates', 'settings', 'Settings file', '⚙', '{\n  "theme": "light",\n  "language": "vi",\n  "{cursor}": true\n}', BLOCK),

    J('Actions', 'format', 'Format (indent neatly)', '⇥', null, { action: 'json-format' }),
    J('Actions', 'minify', 'Minify (one line)', '⇤', null, { action: 'json-minify' }),
    J('Actions', 'sort', 'Sort keys A→Z', 'A↓', null, { action: 'json-sort' }),
    J('Actions', 'check', 'Check for mistakes', '✓?', null, { action: 'json-check' }),
  ];

  const ITEMS = [...HTML_ITEMS, ...JSON_ITEMS];

  // ---------- typing helpers for code (HTML / JSON) ----------
  // Enter keeps the indentation of the line; after an opening { [ or tag it indents one level deeper, and when the
  // matching closer is right behind the caret it moves the closer to its own line.
  function onEnterCode(kind, v, s, e) {
    if (s !== e) return null;
    const ls = lineStart(v, s);
    const before = v.slice(ls, s);
    const indent = /^[ \t]*/.exec(before)[0];
    const trimmed = before.trimEnd();
    const last = trimmed.slice(-1);
    let closer = null;
    if (last === '{' || last === '[') closer = last === '{' ? '}' : ']';
    let tagClose = null;
    if (kind === 'html' && !closer) {
      const m = /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?(\/?)>$/.exec(trimmed);
      if (m && !m[2] && !VOID.has(m[1].toLowerCase())) tagClose = '</' + m[1];
    }
    if (!closer && !tagClose) return indent ? edit(s, s, '\n' + indent, s + 1 + indent.length) : null;
    const hasCloser = closer ? v[s] === closer : v.slice(s, s + tagClose.length).toLowerCase() === tagClose.toLowerCase();
    const inner = '\n' + indent + '  ';
    if (!hasCloser) return edit(s, s, inner, s + inner.length);
    return edit(s, s, inner + '\n' + indent, s + inner.length);
  }

  const JSON_NEXT_OK = /^$|^[\s,\]}:]/;
  // Auto-pairs quotes and brackets in JSON; auto-closes tags and quotes in HTML. Typing a closer steps over it.
  function autoPairCode(kind, v, s, e, ch) {
    if (kind === 'json') {
      const close = { '"': '"', '{': '}', '[': ']' }[ch];
      if (s !== e) return close ? edit(s, e, ch + v.slice(s, e) + close, s + 1, e + 1) : null;
      if ((ch === '"' || ch === '}' || ch === ']') && v[s] === ch) return edit(s, s, '', s + 1);
      if (!close) return null;
      if (ch === '"' && /[\w\\]/.test(v[s - 1] || '')) return null;
      return JSON_NEXT_OK.test(v.slice(s, s + 1)) ? edit(s, s, ch + close, s + 1) : null;
    }
    if (kind !== 'html' || s !== e) return null;
    if (ch === '"') {
      if (v[s] === '"') return edit(s, s, '', s + 1);
      return v[s - 1] === '=' ? edit(s, s, '""', s + 1) : null;
    }
    if (ch === '>') {
      const before = v.slice(lineStart(v, s), s);
      const m = /<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?$/.exec(before);
      if (!m || before.endsWith('/') || VOID.has(m[1].toLowerCase())) return null;
      if (v.slice(s, s + m[1].length + 2).toLowerCase() === '</' + m[1].toLowerCase()) return null;
      return edit(s, s, `></${m[1]}>`, s + 1);
    }
    return null;
  }

  // Backspace between an empty pair of quotes removes both.
  function onBackspaceCode(kind, v, s, e) {
    if (kind === 'md' || s !== e || s === 0) return null;
    return v[s - 1] === '"' && v[s] === '"' ? edit(s - 1, s + 1, '', s - 1) : null;
  }

  // ---------- HTML formatting shortcuts (⌘B, ⌘I, ⌘K, ⌘1-3) ----------
  function htmlWrap(v, s, e, tag) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const text = v.slice(s, e);
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      return edit(s, e, text.slice(open.length, -close.length), s, e - open.length - close.length);
    }
    if (s !== e && v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
      return edit(s - open.length, e + close.length, text, s - open.length, e - open.length);
    }
    if (s === e) return edit(s, s, open + close, s + open.length);
    return edit(s, e, open + text + close, s + open.length, e + open.length);
  }

  function htmlLink(v, s, e) {
    const text = v.slice(s, e) || 'Văn bản liên kết';
    return edit(s, e, `<a href="https://">${text}</a>`, s + 9, s + 17);
  }

  // Toggle <hN>…</hN> around the content of the current line.
  function htmlHeading(v, s, level) {
    const ls = lineStart(v, s);
    const le = lineEnd(v, s);
    const m = /^(\s*)<h([1-6])>(.*)<\/h\2>\s*$/.exec(v.slice(ls, le));
    const indent = m ? m[1] : /^\s*/.exec(v.slice(ls, le))[0];
    const body = m ? m[3] : v.slice(ls + indent.length, le).trim();
    const text = m && Number(m[2]) === level ? indent + body : `${indent}<h${level}>${body}</h${level}>`;
    const caret = m && Number(m[2]) === level ? ls + text.length : ls + indent.length + 4 + body.length;
    return edit(ls, le, text, body ? caret : ls + indent.length + 4);
  }

  // ---------- HTML references to dropped / pasted files ----------
  const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  const htmlImage = (rel, alt = '') => `<img src="${encPath(rel)}" alt="${escAttr(alt)}">`;
  const htmlFileLink = (p, text) => `<a href="file://${encPath(p)}">${escText(text || String(p).split('/').pop())}</a>`;

  // ---------- finding mistakes (syntax checking) ----------
  // Every problem: { pos, len, line, col, message, severity: 'error' | 'warning' }, sorted by position.
  const OPTIONAL_END = new Set(['html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'option', 'optgroup', 'rt', 'rp']);
  const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
  const MAX_PROBLEMS = 100;

  // CSS inside <style>: only the braces are checked (a missing } silently breaks everything after it).
  function lintCss(css, base, add) {
    const open = [];
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (c === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2);
        if (end === -1) return void add(base + i, 2, 'This CSS comment never closes — add */');
        i = end + 1;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
        if (css[j] !== c) return void add(base + i, 1, 'This CSS text in quotes never closes');
        i = j;
      } else if (c === '{') open.push(i);
      else if (c === '}') {
        if (!open.length) add(base + i, 1, 'Extra “}” in the CSS — there is no “{” for it');
        else open.pop();
      }
    }
    for (const i of open) add(base + i, 1, 'This “{” in the CSS is never closed — add “}”');
  }

  function lintHtml(text) {
    const problems = [];
    const add = (pos, len, message, severity = 'error') => {
      if (problems.length < MAX_PROBLEMS) problems.push({ pos, len, message, severity });
    };
    const n = text.length;
    const stack = [];
    const ids = new Map();
    let i = 0;
    const hasRoot = /<(?:html|head|body)[\s>]/i.test(text);
    if (hasRoot && !/^\s*<!doctype\s/i.test(text)) add(0, 1, 'Add <!doctype html> as the very first line so browsers use the modern rules', 'warning');

    scan: while (i < n) {
      const lt = text.indexOf('<', i);
      if (lt === -1) break;
      i = lt;
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        if (end === -1) {
          add(i, 4, 'This comment never closes — add -->');
          break;
        }
        i = end + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', i)) {
        const end = text.indexOf(']]>', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (text[i + 1] === '!' || text[i + 1] === '?') {
        const end = text.indexOf('>', i);
        if (end === -1) {
          add(i, 2, 'This declaration never ends — it is missing >');
          break;
        }
        i = end + 1;
        continue;
      }
      const closing = text[i + 1] === '/';
      const head = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(text.slice(i, i + 80));
      if (!head) {
        if (closing) add(i, 2, 'A closing tag needs a name, like </div>');
        else add(i, 1, 'A lone “<” — write &lt; when you mean the symbol', 'warning');
        i += closing ? 2 : 1;
        continue;
      }
      const name = head[1].toLowerCase();
      const tagLen = head[0].length;
      let j = i + tagLen;
      let selfClose = false;
      let ended = false;
      const attrs = new Set();
      while (j < n) {
        while (j < n && /\s/.test(text[j])) j++;
        const c = text[j];
        if (c === undefined || c === '<') break;
        if (c === '>') {
          ended = true;
          j++;
          break;
        }
        if (c === '/') {
          if (text[j + 1] === '>') {
            selfClose = true;
            ended = true;
            j += 2;
            break;
          }
          j++;
          continue;
        }
        const am = /^[^\s"'<>/=]+/.exec(text.slice(j, j + 200));
        if (!am) {
          add(j, 1, `Unexpected “${c}” inside <${name}> — a quote or = is out of place`);
          j++;
          continue;
        }
        const aname = am[0].toLowerCase();
        const aPos = j;
        j += am[0].length;
        if (!closing) {
          if (attrs.has(aname)) add(aPos, am[0].length, `“${aname}” is written twice on <${name}> — the second one is ignored`, 'warning');
          attrs.add(aname);
        }
        let k = j;
        while (k < n && /\s/.test(text[k])) k++;
        if (text[k] !== '=') continue;
        k++;
        while (k < n && /\s/.test(text[k])) k++;
        const q = text[k];
        let value = '';
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, k + 1);
          if (end === -1) {
            add(k, 1, `The quote after ${aname}= never closes — add a closing ${q}`);
            break scan;
          }
          value = text.slice(k + 1, end);
          if (/<\/?[a-zA-Z]/.test(value)) add(k, 1, `This ${aname}="…" runs into another tag — a closing ${q} is probably missing`);
          j = end + 1;
          if (text[j] !== undefined && !/[\s/>]/.test(text[j])) add(j, 1, 'Put a space between attributes', 'warning');
        } else {
          const um = /^[^\s"'=<>`]+/.exec(text.slice(k, k + 300));
          if (!um) {
            add(j, k - j + 1, `${aname}= has no value — write ${aname}="…"`);
            j = k;
            continue;
          }
          value = um[0];
          j = k + value.length;
        }
        if (aname === 'id' && !closing) {
          if (ids.has(value)) add(aPos, am[0].length, `id “${value}” is used more than once — each id must be unique`, 'warning');
          else ids.set(value, aPos);
        }
      }
      if (!ended) {
        add(i, tagLen, `<${name} … is not finished — it is missing its closing >`);
        i = j < n && text[j] === '<' ? j : n;
        continue;
      }
      const at = i;
      i = j;
      if (closing) {
        if (VOID.has(name)) {
          add(at, i - at, `<${name}> never has a closing tag — delete this`, 'warning');
          continue;
        }
        let idx = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].name === name) {
            idx = k;
            break;
          }
        }
        if (idx === -1) {
          add(at, i - at, `Unexpected </${name}> — there is no open <${name}> to close`);
          continue;
        }
        for (let k = stack.length - 1; k > idx; k--) {
          const o = stack[k];
          if (!OPTIONAL_END.has(o.name)) add(o.pos, o.len, `<${o.name}> is not closed before </${name}> — add </${o.name}>`);
        }
        stack.length = idx;
        continue;
      }
      if (name === 'img' && !attrs.has('alt')) add(at, tagLen, 'Add alt="…" to the image — it is read aloud and shown when the picture is missing', 'warning');
      if (VOID.has(name)) continue;
      const foreign = name === 'svg' || name === 'math' || stack.some((o) => o.name === 'svg' || o.name === 'math');
      if (selfClose) {
        if (foreign) continue;
        add(at, i - at, `In HTML <${name} /> does not close itself — write <${name}></${name}>`, 'warning');
      }
      stack.push({ name, pos: at, len: tagLen });
      if (RAW_TEXT.has(name) && !selfClose) {
        const m = new RegExp('</' + name + '(?=[\\s/>])', 'i').exec(text.slice(i));
        if (!m) {
          add(at, tagLen, `<${name}> is never closed — add </${name}>`);
          break;
        }
        if (name === 'style') lintCss(text.slice(i, i + m.index), i, add);
        i += m.index;
      }
    }
    for (let k = stack.length - 1; k >= 0; k--) {
      const o = stack[k];
      if (!OPTIONAL_END.has(o.name)) add(o.pos, o.len, `<${o.name}> is never closed — add </${o.name}>`);
    }
    return problems.sort((a, b) => a.pos - b.pos).map((p) => ({ ...p, ...lineCol(text, p.pos) }));
  }

  function lint(kind, text) {
    if (kind === 'html') return lintHtml(text);
    if (kind !== 'json') return [];
    const r = jsonCheck(text);
    return r.ok || r.empty ? [] : [{ pos: r.pos, len: 1, line: r.line, col: r.col, message: r.message, severity: 'error' }];
  }

  // ---------- HTML text formatting on the selection ----------
  const cssParse = (css) =>
    css.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.slice(0, x.indexOf(':')).trim().toLowerCase(), x.slice(x.indexOf(':') + 1).trim()]);
  // Set one CSS property in a style="" text (value null/'' removes it).
  const cssSet = (css, prop, value) =>
    cssParse(css).filter(([k]) => k !== prop).concat(value ? [[prop, value]] : []).map(([k, x]) => `${k}: ${x}`).join('; ');
  // True when every <span> inside `inner` is closed inside it (and no </span> closes one from outside).
  function spanBalanced(inner) {
    let depth = 0;
    for (const m of inner.matchAll(/<span[\s>]|<\/span>/g)) {
      depth += m[0][1] === '/' ? -1 : 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  // Colour, background, size… of the selected text through <span style="…">. Formatting the same text again edits
  // that span instead of nesting a new one; removing the last property removes the span.
  function htmlStyle(v, s, e, prop, value) {
    const text = v.slice(s, e);
    const rebuild = (from, to, css, inner) => {
      if (!css) return edit(from, to, inner, from, from + inner.length);
      const open = `<span style="${css}">`;
      return edit(from, to, open + inner + '</span>', from + open.length, from + open.length + inner.length);
    };
    const whole = /^<span style="([^"]*)">([\s\S]*)<\/span>$/.exec(text);
    if (whole && spanBalanced(whole[2])) return rebuild(s, e, cssSet(whole[1], prop, value), whole[2]);
    const around = /<span style="([^"]*)">$/.exec(v.slice(0, s));
    if (around && v.slice(e, e + 7) === '</span>' && spanBalanced(text)) {
      return rebuild(s - around[0].length, e + 7, cssSet(around[1], prop, value), text);
    }
    if (!value) return null;
    return rebuild(s, e, `${prop}: ${value}`, text);
  }

  const BLOCK_TAG = /^(\s*)<(p|h[1-6]|div|li|td|th|blockquote|section|header|footer|figure|nav|article|main|ul|ol|table)\b([^>]*)>/i;
  // Text alignment of the line(s) holding the selection: edits the style of the block tag that starts the line,
  // or wraps the lines in a <div> when there is none.
  function htmlAlign(v, s, e, value) {
    const ls = lineStart(v, s);
    const le = lineEnd(v, e > s && v[e - 1] === '\n' ? e - 1 : e);
    const block = v.slice(ls, le);
    const m = BLOCK_TAG.exec(block);
    if (m) {
      const sm = /\sstyle="([^"]*)"/.exec(m[3]);
      const css = cssSet(sm ? sm[1] : '', 'text-align', value === 'left' ? '' : value);
      const attrs = sm ? m[3].replace(sm[0], css ? ` style="${css}"` : '') : css ? `${m[3]} style="${css}"` : m[3];
      const text = `${m[1]}<${m[2]}${attrs}>` + block.slice(m[0].length);
      const d = text.length - block.length;
      return edit(ls, le, text, Math.max(ls, s + d), Math.max(ls, e + d));
    }
    if (value === 'left') return null;
    const indent = /^\s*/.exec(block)[0];
    const inner = block.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
    const text = `${indent}<div style="text-align: ${value}">\n${inner}\n${indent}</div>`;
    return edit(ls, le, text, ls + text.length);
  }

  // The selected lines become the items of a list (tag 'ul' or 'ol') or a quote ('blockquote').
  function htmlList(v, s, e, tag) {
    const ls = lineStart(v, s);
    const le = lineEnd(v, e > s && v[e - 1] === '\n' ? e - 1 : e);
    const lines = v.slice(ls, le).split('\n').filter((l) => l.trim());
    const indent = /^\s*/.exec(v.slice(ls, le))[0];
    if (tag === 'blockquote') {
      const text = `${indent}<blockquote>\n${(lines.length ? lines : ['']).map((l) => `${indent}  ${l.trim()}`).join('\n')}\n${indent}</blockquote>`;
      return edit(ls, le, text, lines.length ? ls + text.length : ls + indent.length + 14 + indent.length + 2);
    }
    const items = (lines.length ? lines : ['']).map((l) => `${indent}  <li>${l.trim()}</li>`);
    const text = `${indent}<${tag}>\n${items.join('\n')}\n${indent}</${tag}>`;
    return edit(ls, le, text, lines.length ? ls + text.length : ls + indent.length + tag.length + 2 + 1 + indent.length + 6);
  }

  const INLINE_FORMAT = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'span', 'code', 'font']);
  const INLINE_STRIP = new RegExp('</?(?:' + [...INLINE_FORMAT].join('|') + ')(?:\\s[^<>]*)?>', 'gi');
  // Remove bold / italic / colour… from the selection (and from the tags wrapped right around it).
  function htmlClear(v, s, e) {
    if (s === e) return null;
    let a = s;
    let b = e;
    for (let k = 0; k < 8; k++) {
      const om = /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?>$/.exec(v.slice(0, a));
      if (!om || !INLINE_FORMAT.has(om[1].toLowerCase())) break;
      const close = `</${om[1]}>`;
      if (v.slice(b, b + close.length).toLowerCase() !== close.toLowerCase()) break;
      a -= om[0].length;
      b += close.length;
    }
    const text = v.slice(a, b).replace(INLINE_STRIP, '');
    return text === v.slice(s, e) && a === s ? null : edit(a, b, text, a, a + text.length);
  }

  return {
    KINDS, EXT, kindOf, templateFor, ITEMS, HTML_ITEMS, JSON_ITEMS, CSS_RULES, VOID,
    jsonCheck, jsonFormat, jsonMinify, jsonSortKeys, lineCol,
    htmlTemplate, indentBy,
    onEnterCode, autoPairCode, onBackspaceCode,
    htmlWrap, htmlLink, htmlHeading, htmlImage, htmlFileLink,
    lint, lintHtml, htmlStyle, htmlAlign, htmlList, htmlClear, cssSet,
  };
});
