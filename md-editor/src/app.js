(() => {
  const E = window.Editing;
  const F = window.Formats;
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const preview = $('preview');
  const slashEl = $('slash');
  const docname = $('docname');

  let mode = 'edit';
  let name = 'Untitled';
  let saved = '';
  let slash = { items: [], index: 0, from: 0, query: '' };
  let docPath = null;
  let cmdConfig = {};
  let items = E.buildItems({}, F.ITEMS);
  let kind = 'md'; // 'md' | 'html' | 'json' — decided by the file name

  marked.use({ extensions: [...MarkedMath.extensions, NotesCore.markedWikiLink] });
  // Other modules (panels.js: find, outline, notes search) plug into these.
  const hooks = { render: [], input: [], doc: [], mode: [] };
  const fire = (k) => hooks[k].forEach((f) => f());
  // DOMPurify's default drops file: links, which is what dropped files become.
  const SAFE_URI = /^(?:(?:https?|file|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const isOpen = () => !slashEl.hidden;
  const isDirty = () => editor.value !== saved;

  // ---------- editing ----------
  let applying = false; // the input event of our own edit is handled once, after the selection is restored
  function applyEdit(ed) {
    editor.focus();
    editor.setSelectionRange(ed.from, ed.to);
    applying = true;
    if (ed.text === '') {
      if (ed.from !== ed.to && !document.execCommand('delete')) editor.setRangeText('', ed.from, ed.to, 'end');
    } else if (!document.execCommand('insertText', false, ed.text)) {
      editor.setRangeText(ed.text, ed.from, ed.to, 'end');
    }
    applying = false;
    editor.setSelectionRange(ed.selStart, ed.selEnd);
    onInput();
  }

  function onInput() {
    updateState();
    updateLint();
    updateFmtBar();
    updateSlash();
    fire('input');
  }

  function updateState() {
    const dirty = isDirty();
    docname.textContent = name + (dirty ? ' •' : '');
    document.title = name;
    api.setState({ dirty, name });
  }

  editor.addEventListener('input', () => !applying && onInput());
  editor.addEventListener('click', (e) => {
    hideSlash();
    // ⌘-click a link in the source to open it.
    const caret = editor.selectionStart === editor.selectionEnd && e.metaKey;
    const wiki = caret ? NotesCore.wikiLinkAt(editor.value, editor.selectionStart) : '';
    if (wiki) return void api.notesOpenLink({ file: docPath, target: wiki });
    const href = caret ? E.linkAt(editor.value, editor.selectionStart) : '';
    if (href) api.openExternal(new URL(href, document.baseURI).href);
  });
  editor.addEventListener('blur', hideSlash);

  editor.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // IME (e.g. Telex/VNI)
    if (isOpen() && slashKey(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const { value: v, selectionStart: s, selectionEnd: end } = editor;
    const code = kind !== 'md';
    let ed = null;
    if (e.key === 'Enter' && !e.shiftKey) ed = code ? F.onEnterCode(kind, v, s, end) : E.onEnter(v, s, end);
    else if (e.key === 'Tab') {
      e.preventDefault();
      ed = E.onTab(v, s, end, e.shiftKey);
    } else if (e.key === 'Backspace') ed = (code && F.onBackspaceCode(kind, v, s, end)) || E.onBackspace(v, s, end);
    else if (e.key.length === 1) ed = code ? F.autoPairCode(kind, v, s, end, e.key) : E.autoPair(v, s, end, e.key);

    if (ed) {
      e.preventDefault();
      applyEdit(ed);
    }
  });

  editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    const text = cd.getData('text/plain');
    // A screenshot / copied picture: store it next to the note and insert ![](…) (or <img> in a web page).
    const picture = [...cd.files].find((f) => f.type.startsWith('image/'));
    if (picture && !text && kind !== 'json') {
      e.preventDefault();
      return void insertImages([{ file: picture, name: E.pastedImageName(new Date(), imageExt(picture.type)), alt: '' }]);
    }
    if (kind !== 'md') return; // code is pasted as plain text
    // Rich text from Word, Google Docs or a web page becomes Markdown.
    const html = cd.getData('text/html');
    if (html && Html2Md.isRich(html)) {
      e.preventDefault();
      return void pasteHtml(html);
    }
    const ed = E.pasteUrl(editor.value, editor.selectionStart, editor.selectionEnd, text);
    if (ed) {
      e.preventDefault();
      applyEdit(ed);
    }
  });

  // ---------- images (paste / drop) ----------
  const IMAGE_EXTS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/tiff': 'tiff', 'image/avif': 'avif' };
  const imageExt = (type) => IMAGE_EXTS[type] || 'png';
  const IMAGE_ERRORS = { type: 'That file type isn’t supported.', size: 'The image is empty or too large.', write: 'Couldn’t write the image next to the note.' };

  // Saves each image in the note's folder; resolves to the Markdown for the ones that worked.
  async function saveImages(items) {
    if (!docPath) {
      toast('Save the note first (⌘S) — images are stored in the same folder as the note.');
      return [];
    }
    const refs = [];
    for (const it of items) {
      const bytes = new Uint8Array(await it.file.arrayBuffer());
      const r = await api.saveImage({ name: it.name, bytes, srcPath: it.path });
      if (r.error) toast(r.error === 'unsaved' ? 'Save the note first (⌘S).' : IMAGE_ERRORS[r.error] || 'Couldn’t add the image.');
      else refs.push(kind === 'html' ? F.htmlImage(r.name, it.alt) : E.imageRef(r.name, it.alt));
    }
    return refs;
  }

  async function insertImages(items) {
    const refs = await saveImages(items);
    const ed = E.insertSnippets(editor.value, editor.selectionStart, editor.selectionEnd, refs);
    if (ed) applyEdit(ed);
  }

  // Markdown from pasted HTML: embedded (data:) pictures are saved beside the note, or dropped when it has no file yet.
  const DATA_IMG = /!\[([^\]]*)\]\(<?data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)>?\)/gi;
  async function pasteHtml(html) {
    let md = Html2Md.toMarkdown(html).replace(/\n+$/, '');
    const pics = [...md.matchAll(DATA_IMG)];
    if (pics.length) {
      if (!docPath) toast('Pictures in the pasted text were skipped — save the note first to keep them.');
      for (const m of pics) {
        let ref = '';
        if (docPath) {
          const bin = atob(m[3].replace(/\s/g, ''));
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          const file = new Blob([bytes]);
          const [saved] = await saveImages([{ file, name: E.pastedImageName(new Date(), imageExt('image/' + m[2].toLowerCase())), alt: m[1] }]);
          ref = saved || '';
        }
        md = md.replace(m[0], () => ref);
      }
    }
    if (!md.trim()) return;
    const s = editor.selectionStart;
    applyEdit({ from: s, to: editor.selectionEnd, text: md, selStart: s + md.length, selEnd: s + md.length });
  }

  // `spec` is a command ("bold") or a command with its value ("color:#e03131", "align:center"; "color:" removes it).
  function format(spec) {
    const cut = spec.indexOf(':');
    const action = cut < 0 ? spec : spec.slice(0, cut);
    const arg = cut < 0 ? '' : spec.slice(cut + 1);
    const { value: v, selectionStart: s, selectionEnd: e } = editor;
    if (kind === 'json') return;
    if (action === 'color-menu' || action === 'bg-menu') return openFmtPop(action === 'color-menu' ? 'color' : 'bg');
    const tags = { bold: 'strong', italic: 'em', strike: 's', underline: 'u', highlight: 'mark', sub: 'sub', sup: 'sup', small: 'small', code: 'code' };
    const css = { color: 'color', bg: 'background-color', size: 'font-size' };
    const marks = { bold: '**', italic: '*', strike: '~~', code: '`' };
    let ed;
    if (kind === 'html') {
      if (action in tags) ed = F.htmlWrap(v, s, e, tags[action]);
      else if (action === 'link') ed = F.htmlLink(v, s, e);
      else if (/^h[123]$/.test(action)) ed = F.htmlHeading(v, s, Number(action[1]));
      else if (action in css) ed = F.htmlStyle(v, s, e, css[action], arg);
      else if (action === 'align') ed = F.htmlAlign(v, s, e, arg);
      else if (action === 'ul' || action === 'ol') ed = F.htmlList(v, s, e, action);
      else if (action === 'quote') ed = F.htmlList(v, s, e, 'blockquote');
      else if (action === 'clear') ed = F.htmlClear(v, s, e);
    } else if (action in marks) ed = E.wrap(v, s, e, marks[action]);
    else if (action === 'link') ed = E.link(v, s, e);
    else if (/^h[123]$/.test(action)) ed = E.heading(v, s, Number(action[1]));
    else if (['underline', 'highlight', 'sub', 'sup'].includes(action)) ed = F.htmlWrap(v, s, e, tags[action]);
    if (ed) applyEdit(ed);
    else if (kind === 'html' && ['color', 'bg', 'size', 'align', 'clear'].includes(action) && s === e) toast('Select some text first.');
  }

  // ---------- slash menu ----------
  function caretXY(pos) {
    const cs = getComputedStyle(editor);
    const m = document.createElement('div');
    for (const p of ['font', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingRight', 'lineHeight']) {
      m.style[p] = cs[p];
    }
    Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', width: editor.clientWidth + 'px' });
    m.textContent = editor.value.slice(0, pos);
    const mark = document.createElement('span');
    mark.textContent = '​';
    m.appendChild(mark);
    document.body.appendChild(m);
    const r = editor.getBoundingClientRect();
    const xy = { x: r.left + mark.offsetLeft, y: r.top + mark.offsetTop - editor.scrollTop + parseFloat(cs.lineHeight) };
    m.remove();
    return xy;
  }

  // y (px, from the top of the scrollable text) of each text offset in `list` (ascending) — for outline and find.
  function offsetsY(list) {
    const cs = getComputedStyle(editor);
    const m = document.createElement('div');
    for (const p of ['font', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingRight', 'lineHeight']) {
      m.style[p] = cs[p];
    }
    Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', top: '0', left: '0', width: editor.clientWidth + 'px' });
    const v = editor.value;
    const marks = [];
    let prev = 0;
    for (const pos of list) {
      m.append(document.createTextNode(v.slice(prev, pos)));
      const mark = document.createElement('span');
      mark.textContent = '​';
      m.append(mark);
      marks.push(mark);
      prev = pos;
    }
    m.append(document.createTextNode(v.slice(prev)));
    document.body.appendChild(m);
    const ys = marks.map((mark) => mark.offsetTop);
    m.remove();
    return ys;
  }

  function updateSlash() {
    const q = E.slashQuery(editor.value, editor.selectionStart);
    const found = q ? E.filterSlash(q.query, items, { lineStart: q.lineStart, kind }) : [];
    if (!q || !found.length || editor.selectionStart !== editor.selectionEnd) return hideSlash();
    slash = { items: found, index: 0, from: q.from, query: q.query };
    renderSlash();
    const { x, y } = caretXY(q.from);
    slashEl.hidden = false;
    slashEl.style.left = Math.max(8, Math.min(x, innerWidth - slashEl.offsetWidth - 8)) + 'px';
    const below = y + slashEl.offsetHeight > innerHeight - 8;
    slashEl.style.top = (below ? Math.max(8, y - 28 - slashEl.offsetHeight) : y) + 'px';
  }

  // Bold the typed prefix so it is clear what the filter matched.
  function highlight(text, q) {
    if (!q || !text.toLowerCase().startsWith(q)) return [text];
    return [el('b', '', text.slice(0, q.length)), text.slice(q.length)];
  }

  function renderSlash() {
    slashEl.replaceChildren(
      ...slash.items.map((it, i) => {
        const li = el('li', i === slash.index ? 'active' : '');
        li.setAttribute('role', 'option');
        const label = el('span', 'label');
        label.append(...highlight(it.label, slash.query));
        const key = el('span', 'key');
        key.append('/', ...highlight(it.key, slash.query));
        li.append(el('span', 'hint', it.hint || ''), label, key);
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          chooseSlash(i);
        });
        return li;
      })
    );
    slashEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function hideSlash() {
    slashEl.hidden = true;
  }

  function chooseSlash(i) {
    const item = slash.items[i];
    hideSlash();
    if (item.action) {
      applyEdit({ from: slash.from, to: editor.selectionStart, text: '', selStart: slash.from, selEnd: slash.from });
      actions[item.action]?.();
      return;
    }
    applyEdit(E.applySlash(editor.value, editor.selectionStart, slash.from, item, undefined, { indent: kind !== 'md' }));
    hideSlash();
  }

  function slashKey(e) {
    const n = slash.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      slash.index = (slash.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderSlash();
    } else if (e.key === 'Enter' || e.key === 'Tab') chooseSlash(slash.index);
    else if (e.key === 'Escape') hideSlash();
    else return false;
    e.preventDefault();
    return true;
  }

  // ---------- preview / edit ----------
  // The block's dates and live progress, read from Academic Gantt each time the preview opens.
  function ganttCard(meta) {
    const card = el('div', 'gantt-card');
    card.append(ganttChip(meta));
    api.ganttBlock(meta['gantt-block']).then((r) => {
      if (!r || r.error || !card.isConnected) return;
      const b = r.block;
      const bar = el('div', 'gc-bar ' + b.status);
      const fill = el('i');
      fill.style.width = b.percent + '%';
      bar.append(fill);
      card.append(
        bar,
        el('div', 'gc-line ' + b.status, E.statusText(b) + ' · ' + b.percent + '% of ' + b.totalDays + (b.totalDays === 1 ? ' day' : ' days')),
        el('div', 'gc-line', 'Project: ' + b.courseDone + '/' + b.courseTotal + ' blocks done')
      );
    });
    return card;
  }

  function ganttChip(meta) {
    const chip = el('button', 'event-chip', '🗓 ' + (meta['gantt-title'] || meta['gantt-block']));
    const range = meta['gantt-start'] && meta['gantt-end'] ? (meta['gantt-start'] === meta['gantt-end'] ? meta['gantt-start'] : meta['gantt-start'] + ' → ' + meta['gantt-end']) : '';
    if (range) chip.append(' · ' + range);
    chip.title = 'Show in Academic Gantt (⇧⌘G)';
    chip.addEventListener('click', showInGantt);
    return chip;
  }

  // Markdown → sanitised HTML in `target`, with KaTeX math and syntax-coloured code.
  function renderInto(target, md) {
    target.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true }), { ALLOWED_URI_REGEXP: SAFE_URI });
    target.querySelectorAll('.math-ph').forEach((node) => {
      try {
        katex.render(node.dataset.tex, node, { displayMode: node.dataset.display === '1', throwOnError: false, trust: false });
      } catch {
        node.textContent = node.dataset.tex;
      }
    });
    target.querySelectorAll('pre code').forEach((node) => {
      const lang = (/(?:^|\s)language-([\w+#-]+)/.exec(node.className) || [])[1];
      if (!lang || !hljs.getLanguage(lang.toLowerCase())) return;
      node.innerHTML = hljs.highlight(node.textContent, { language: lang.toLowerCase(), ignoreIllegals: true }).value;
      node.classList.add('hljs');
    });
  }

  // A web page is shown as the browser would, in a frame that runs no scripts and cannot leave the page.
  function renderHtmlPreview() {
    const frame = document.createElement('iframe');
    frame.className = 'html-frame';
    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = editor.value;
    preview.replaceChildren(frame);
  }

  // JSON: a verdict line (valid, or where the first mistake is) and a collapsible tree.
  const describeJson = (v) =>
    Array.isArray(v) ? `a list of ${v.length} ${v.length === 1 ? 'item' : 'items'}` : v && typeof v === 'object' ? `an object with ${Object.keys(v).length} ${Object.keys(v).length === 1 ? 'key' : 'keys'}` : `a single ${v === null ? 'null' : typeof v} value`;

  function jsonTree(root) {
    let budget = 5000;
    const leaf = (v) => {
      const type = v === null ? 'null' : typeof v;
      let text = type === 'string' ? JSON.stringify(v) : String(v);
      if (text.length > 400) text = text.slice(0, 400) + '…';
      return el('span', 'jv ' + type, text);
    };
    const build = (key, v, depth) => {
      const label = key === null ? [] : [el('span', 'jk', String(key)), ': '];
      const container = v && typeof v === 'object';
      const entries = container ? (Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v)) : [];
      if (!container || !entries.length) {
        const row = el('div', 'jrow');
        row.append(...label, container ? el('span', 'jm', Array.isArray(v) ? '[ ]' : '{ }') : leaf(v));
        return row;
      }
      const box = el('details', 'jt');
      box.open = depth < 2;
      const head = el('summary');
      head.append(...label, el('span', 'jm', Array.isArray(v) ? `[ ${entries.length} ]` : `{ ${entries.length} }`));
      box.append(head);
      for (const [k, x] of entries) {
        if (budget-- <= 0) {
          box.append(el('div', 'jrow jm', '… more not shown — use Edit to see everything'));
          break;
        }
        box.append(build(k, x, depth + 1));
      }
      return box;
    };
    return build(null, root, 0);
  }

  function renderJsonPreview() {
    const r = F.jsonCheck(editor.value);
    const bar = el('div', 'json-bar ' + (r.ok ? 'ok' : 'bad'));
    preview.replaceChildren(bar);
    if (r.ok) {
      bar.textContent = '✓ Valid JSON — ' + describeJson(r.value);
      preview.append(jsonTree(r.value));
      return;
    }
    bar.textContent = r.empty ? r.message : `✗ Line ${r.line}, column ${r.col}: ${r.message}`;
    if (r.empty) return;
    const go = el('button', 'link', 'Show in editor');
    go.addEventListener('click', () => jumpTo({ line: r.line, col: r.col - 1, len: 1 }));
    bar.append(' ', go);
  }

  function renderPreview() {
    if (kind === 'html') renderHtmlPreview();
    else if (kind === 'json') renderJsonPreview();
    else {
      const fm = E.parseFrontMatter(editor.value);
      renderInto(preview, fm.body);
      if (fm.meta['gantt-block']) preview.prepend(ganttCard(fm.meta));
    }
    fire('render');
  }

  function setMode(next) {
    const src = next === 'preview' ? editor : preview;
    const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    mode = next;
    document.body.dataset.mode = mode;
    hideSlash();
    hideFmt();
    if (mode === 'preview') {
      renderPreview();
      preview.hidden = false;
      editor.hidden = true;
      refreshLive().then((changed) => changed && mode === 'preview' && renderPreview());
    } else {
      preview.hidden = true;
      editor.hidden = false;
      editor.focus();
    }
    const dst = mode === 'preview' ? preview : editor;
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
    $('toggle').title = mode === 'edit' ? 'Preview (⌘/)' : 'Edit (⌘/)';
    renderLint();
    fire('mode');
  }

  $('toggle').addEventListener('click', () => setMode(mode === 'edit' ? 'preview' : 'edit'));

  preview.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.classList.contains('wikilink')) return void api.notesOpenLink({ file: docPath, target: a.dataset.wiki });
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
    else api.openExternal(a.href);
  });

  // ---------- sheet (modal panel) + toast ----------
  const sheet = $('sheet');
  const sheetBody = $('sheet-body');
  let sheetKeys = null;
  let sheetToken = 0;

  function openSheet(title, build, onKey) {
    $('sheet-title').textContent = title;
    sheetBody.replaceChildren();
    sheetKeys = onKey || null;
    sheet.hidden = false;
    hideSlash();
    build(sheetBody);
    return ++sheetToken;
  }

  function closeSheet() {
    sheet.hidden = true;
    sheetKeys = null;
    sheetToken++;
    sheetBody.replaceChildren();
    if (mode === 'edit') editor.focus();
  }

  $('sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('mousedown', (e) => e.target === sheet && closeSheet());
  addEventListener(
    'keydown',
    (e) => {
      if (sheet.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet();
      } else if (sheetKeys) sheetKeys(e);
    },
    true
  );

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4000);
  }

  // ---------- commands (enable / disable / custom) ----------
  function applyConfig(cfg) {
    if (!cfg || cfg.error) return;
    cmdConfig = cfg;
    items = E.buildItems(cfg, F.ITEMS);
  }

  async function reloadCommands() {
    applyConfig(await api.loadCommands());
  }

  async function openCommandsSheet() {
    const cfg = await api.loadCommands();
    applyConfig(cfg);
    const all = E.buildItems(cmdConfig, F.ITEMS);
    const save = async () => {
      const disabled = all.filter((i) => !i.enabled).map((i) => i.id);
      await api.setDisabledCommands(disabled);
      applyConfig({ ...cmdConfig, disabled });
    };

    openSheet('Commands', (body) => {
      body.append(el('p', 'note', 'Untick the commands you don’t use — they disappear from the / menu.'));
      if (cfg.error) body.append(el('p', 'note error', cfg.error + '. Fix the file and reopen this panel.'));
      const list = el('div', 'cmd-list');
      let group = null;
      let rows = [];
      const flush = () => group && group.sync();
      for (const it of all) {
        if (!group || group.name !== it.group) {
          flush();
          const head = el('div', 'cmd-group');
          const title = el('span', '', it.group);
          const toggle = el('button', 'link', '');
          head.append(title, toggle);
          list.append(head);
          const mine = [];
          const self = {
            name: it.group,
            sync() {
              toggle.textContent = mine.some((r) => r.item.enabled) ? 'Turn all off' : 'Turn all on';
            },
          };
          group = self;
          toggle.addEventListener('click', () => {
            const on = !mine.some((r) => r.item.enabled);
            mine.forEach((r) => {
              r.item.enabled = on;
              r.box.checked = on;
            });
            self.sync();
            save();
          });
          rows = mine;
        }
        const row = el('label', 'cmd-row');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = it.enabled;
        const key = el('span', 'key', '/' + it.key);
        row.append(box, el('span', 'hint', it.hint || ''), el('span', 'label', it.label), key);
        const entry = { item: it, box };
        rows.push(entry);
        const g = group;
        box.addEventListener('change', () => {
          it.enabled = box.checked;
          g.sync();
          save();
        });
        list.append(row);
      }
      flush();
      body.append(list);

      const foot = el('div', 'sheet-foot');
      const edit = el('button', '', 'Edit custom commands…');
      edit.addEventListener('click', () => api.openCommandsFile());
      foot.append(edit, el('span', 'note', 'Saved in commands.json — templates support {date} {time} {weekday} and {cursor}.'));
      body.append(foot);
    });
  }

  // ---------- Academic Gantt ----------
  const GANTT_ERRORS = {
    'no-data': 'No Gantt data found. Open Academic Gantt once so it creates its data folder.',
    'no-gantt': 'Academic Gantt isn’t installed (or hasn’t been opened yet).',
  };

  function ganttBlockOfNote() {
    const { meta } = E.parseFrontMatter(editor.value);
    return meta['gantt-block'] ? meta : null;
  }

  async function showInGantt() {
    const meta = ganttBlockOfNote();
    if (!meta) return openGanttSheet();
    const r = await api.ganttOpen(meta['gantt-block']);
    if (r.error) toast(GANTT_ERRORS[r.error] || 'Couldn’t open Academic Gantt.');
  }

  async function unlinkFromGantt() {
    const meta = ganttBlockOfNote();
    if (!meta) return toast('This note isn’t linked to a Gantt block.');
    applyEdit(E.clearGantt(editor.value, editor.selectionStart, editor.selectionEnd));
    const bare = E.stripProjectNotes(editor.value);
    if (bare !== editor.value) applyEdit({ from: 0, to: editor.value.length, text: bare, selStart: 0, selEnd: 0 });
    await api.ganttUnlink(meta['gantt-block']);
    await save(false);
    toast('Unlinked from Gantt');
  }

  function openGanttSheet() {
    let blocks = [];
    let shown = [];
    let index = 0;
    const input = el('input', 'filter');
    input.type = 'text';
    input.placeholder = 'Filter blocks or courses…';
    const status = el('p', 'note', 'Loading…');
    const list = el('div', 'events');
    const current = (ganttBlockOfNote() || {})['gantt-block'];

    function paint() {
      const q = input.value.trim().toLowerCase();
      shown = blocks.filter((b) => !q || b.label.toLowerCase().includes(q) || b.course.toLowerCase().includes(q));
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.replaceChildren();
      let course = null;
      shown.forEach((b, i) => {
        if (b.course !== course) {
          course = b.course;
          list.append(el('div', 'cmd-group', course));
        }
        const row = el('div', 'event-row' + (i === index ? ' active' : ''));
        const when = b.start === b.end ? b.start.slice(5) : b.start.slice(5) + '→' + b.end.slice(5);
        const mark = b.id === current ? '✓ this note' : b.notePath ? '📄 has note' : '';
        row.append(el('span', 'when', when), el('span', 'label', b.label), el('span', 'key', mark));
        row.addEventListener('click', () => attachBlock(b));
        list.append(row);
      });
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
      if (blocks.length) status.textContent = shown.length ? '' : 'No matching blocks.';
    }

    const token = openSheet(
      'Link to Gantt block',
      (body) => body.append(input, status, list),
      (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          index = Math.max(0, Math.min(shown.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
          paint();
        } else if (e.key === 'Enter' && shown[index]) {
          e.preventDefault();
          attachBlock(shown[index]);
        }
      }
    );
    input.addEventListener('input', () => {
      index = 0;
      paint();
    });
    input.focus();

    api.ganttBlocks().then((r) => {
      if (sheetToken !== token) return;
      if (r.error) {
        status.textContent = GANTT_ERRORS[r.error] || 'Couldn’t read the Gantt data.';
        status.classList.add('error');
        return;
      }
      blocks = r.blocks;
      status.textContent = blocks.length ? '' : 'No blocks found (recent or upcoming).';
      paint();
    });
  }

  // ---------- notes of the same project ----------
  const commonEnds = (a, b) => {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0;
    while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    return [p, q];
  };

  // Replaces the whole text but keeps the caret and scroll where they were (the change is usually below or above them).
  function replaceText(next) {
    const prev = editor.value;
    const [p, q] = commonEnds(prev, next);
    const move = (pos) => (pos <= p ? pos : pos >= prev.length - q ? pos + next.length - prev.length : p);
    const [a, b, top] = [move(editor.selectionStart), move(editor.selectionEnd), editor.scrollTop];
    const clean = !isDirty();
    editor.value = next;
    editor.setSelectionRange(a, b);
    editor.scrollTop = top;
    if (clean) saved = next; // refreshing the list must not make a clean note look edited
    updateState();
  }

  // Keeps the "notes in this project" list between its markers current. With `insert`, adds it when the note has none.
  async function refreshProjectNotes({ insert = false } = {}) {
    const meta = ganttBlockOfNote();
    if (!meta || !docPath || (!insert && !E.hasProjectNotes(editor.value))) return false;
    const r = await api.ganttProjectNotes({ block: meta['gantt-block'], file: docPath });
    if (!r || r.error || !r.notes || !ganttBlockOfNote()) return false;
    const next = E.updateProjectNotes(editor.value, r, insert);
    if (next === null) return false;
    replaceText(next);
    return true;
  }

  async function projectNotesCommand() {
    if (!ganttBlockOfNote()) return toast('Link this note to a Gantt block first (⇧⌘E).');
    if (!docPath && !(await save(false))) return;
    if (mode === 'preview') setMode('edit');
    await refreshProjectNotes({ insert: true });
    toast('Project notes list is up to date');
  }

  // ---------- auto-updating Gantt tables ----------
  // Re-renders every <!-- gantt-blocks project="…" --> table from Gantt's data. Resolves true when the text changed,
  // false when it is already current, null when Gantt's data could not be read (the tables stay as they are).
  async function refreshGanttBlocks() {
    const projects = E.ganttBlocksProjects(editor.value);
    if (!projects.length) return false;
    const tables = new Map();
    const now = new Date();
    let unreadable = false;
    for (const project of projects) {
      const r = await api.ganttBlocks({ course: project, all: true });
      if (!r || r.error || !r.blocks) unreadable = true;
      else if (r.blocks.length) tables.set(project, E.ganttBlocksBlock({ project, course: r.blocks[0].course, blocks: r.blocks, now }));
    }
    if (!tables.size) return unreadable ? null : false;
    const next = E.updateGanttBlocks(editor.value, tables);
    if (next === null) return false;
    replaceText(next);
    return true;
  }

  // Everything that follows Gantt: the project notes list and the tasks tables.
  async function refreshLive() {
    if (kind !== 'md') return false;
    const notes = await refreshProjectNotes();
    const tables = await refreshGanttBlocks();
    return notes || tables === true;
  }

  async function updateGanttTablesCommand() {
    if (!E.hasGanttBlocks(editor.value)) return toast('No Gantt tables in this note — add one with /ganttblocks.');
    const changed = await refreshGanttBlocks();
    if (changed && mode === 'preview') renderPreview();
    toast(changed === null ? GANTT_ERRORS['no-data'] : changed ? 'Gantt tables updated' : 'Gantt tables are up to date');
  }

  // ---------- Gantt tasks table ----------
  function openProjectSheet(onPick) {
    const input = el('input', 'filter');
    input.type = 'text';
    input.placeholder = 'Filter projects…';
    const status = el('p', 'note', 'Loading…');
    const list = el('div', 'events');
    let projects = [];
    let shown = [];
    let index = 0;

    function paint() {
      const q = input.value.trim().toLowerCase();
      shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q));
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.replaceChildren();
      shown.forEach((p, i) => {
        const row = el('div', 'event-row' + (i === index ? ' active' : ''));
        row.append(el('span', 'label', p.name), el('span', 'key', p.count + ' blocks'));
        row.addEventListener('click', () => pick(p));
        list.append(row);
      });
      if (projects.length) status.textContent = shown.length ? '' : 'No matching projects.';
    }
    function pick(p) {
      closeSheet();
      onPick(p.id);
    }

    const token = openSheet(
      'Gantt tasks table — choose a project',
      (body) => body.append(input, status, list),
      (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          index = Math.max(0, Math.min(shown.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
          paint();
        } else if (e.key === 'Enter' && shown[index]) {
          e.preventDefault();
          pick(shown[index]);
        }
      }
    );
    input.addEventListener('input', () => {
      index = 0;
      paint();
    });
    input.focus();

    api.ganttBlocks({ all: true }).then((r) => {
      if (sheetToken !== token) return;
      if (r.error) {
        status.textContent = GANTT_ERRORS[r.error] || 'Couldn’t read the Gantt data.';
        status.classList.add('error');
        return;
      }
      const byId = new Map();
      for (const b of r.blocks) {
        const id = b.id.split('|')[0];
        byId.set(id, { id, name: b.course || id, count: (byId.get(id) || { count: 0 }).count + 1 });
      }
      projects = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      status.textContent = projects.length ? '' : 'No projects found in Academic Gantt.';
      paint();
    });
  }

  async function insertGanttTable(courseId) {
    const r = await api.ganttBlocks({ course: courseId, all: true });
    if (r.error) return toast(GANTT_ERRORS[r.error] || 'Couldn’t read the Gantt data.');
    if (!r.blocks.length) return toast('That project has no blocks.');
    if (mode === 'preview') setMode('edit');
    editor.focus();
    const block = E.ganttBlocksBlock({ project: courseId, course: r.blocks[0].course, blocks: r.blocks });
    // Running /ganttblocks again for the same project refreshes the table that is already there.
    const { edit, replaced } = E.upsertGanttBlocks(editor.value, editor.selectionStart, editor.selectionEnd, courseId, block);
    applyEdit(edit);
    if (replaced) toast('This note already has the table — refreshed it');
  }

  function ganttTableCommand() {
    const meta = ganttBlockOfNote();
    if (meta) insertGanttTable(meta['gantt-block'].split('|')[0]);
    else openProjectSheet(insertGanttTable);
  }

  // ---------- export ----------
  async function exportAs(format) {
    if (kind === 'json' || (kind === 'html' && format === 'docx')) return toast(kind === 'json' ? 'Export is for Markdown notes and web pages.' : 'Word export is for Markdown notes. A web page can be exported as PDF.');
    const body = E.stripProjectNotes(E.parseFrontMatter(editor.value).body);
    toast('Exporting…');
    let r;
    if (kind === 'html') r = await api.exportPdf({ html: editor.value, raw: true });
    else if (format === 'pdf') {
      const holder = document.createElement('div');
      renderInto(holder, body);
      holder.querySelectorAll('a.wikilink').forEach((a) => a.replaceWith(a.textContent)); // [[links]] are plain text on paper
      r = await api.exportPdf({ html: holder.innerHTML });
    } else r = await api.exportDocx({ markdown: NotesCore.wikiLinksToText(body), title: name.replace(/\.[^.]+$/, '') });
    if (!r) return void ($('toast').hidden = true);
    toast(r.error ? 'Couldn’t export: ' + r.error : 'Exported to ' + r.path.split('/').pop());
  }

  // Links this note to a Gantt block: the note gets front matter, Gantt stores the note's path.
  async function attachBlock(b) {
    closeSheet();
    if (!(await save(false))) return; // Gantt needs the file path
    const r = await api.ganttLink({ block: b.id, file: docPath });
    if (r.error) return toast(GANTT_ERRORS[r.error] || 'Couldn’t update Academic Gantt.');
    applyEdit(E.setGantt(editor.value, editor.selectionStart, editor.selectionEnd, { block: b.id, course: b.course, label: b.label, start: b.start, end: b.end }));
    await refreshProjectNotes({ insert: true });
    await save(false);
    toast('Linked to “' + b.label + '”');
  }

  // ---------- theme ----------
  // Auto (default) follows the system live; Light / Dark are the user's manual choice. The main process owns the
  // saved choice (settings.json) and keeps nativeTheme in step, so prefers-color-scheme tracks the OS while in Auto.
  const THEMES = ['auto', 'light', 'dark'];
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const isNight = () => document.documentElement.dataset.theme === 'dark';
  let themePref = THEMES.includes(document.documentElement.dataset.themePref) ? document.documentElement.dataset.themePref : 'auto';

  function applyTheme(pref) {
    if (THEMES.includes(pref)) themePref = pref;
    const dark = themePref === 'dark' || (themePref === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePref = themePref;
    try {
      localStorage.setItem('theme', themePref); // read by theme-init.js before the first paint
    } catch {}
  }

  // ⇧⌘D: flip to the other look and keep it (a manual choice). Back to Auto: View → Appearance.
  function toggleNight() {
    applyTheme(isNight() ? 'light' : 'dark');
    api.setThemePref(themePref);
  }

  darkQuery.addEventListener('change', () => themePref === 'auto' && applyTheme());
  api.getThemePref().then(({ pref, stored }) => {
    if (!stored && themePref !== 'auto') api.setThemePref(themePref); // first run after the Auto update: keep an earlier Night Mode choice
    else applyTheme(pref);
  });

  // ---------- files ----------
  function loadDoc(doc) {
    editor.value = doc ? doc.content : '';
    saved = editor.value;
    name = doc ? doc.name : 'Untitled';
    docPath = doc ? doc.path : null;
    let base = document.querySelector('base');
    if (!base) document.head.prepend((base = document.createElement('base')));
    if (doc && doc.dir) base.href = encodeURI('file://' + doc.dir + '/');
    else base.remove();
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    setKind(F.kindOf(name));
    if (mode === 'preview') setMode('preview');
    updateState();
    refreshLive().then((changed) => changed && mode === 'preview' && renderPreview());
    fire('doc');
  }

  async function save(as) {
    await refreshLive();
    const doc = await (as ? api.saveAs(editor.value, name) : api.save(editor.value, name));
    if (!doc) return false;
    saved = doc.content;
    name = doc.name;
    docPath = doc.path;
    if (F.kindOf(name) !== kind) {
      setKind(F.kindOf(name));
      if (mode === 'preview') setMode('preview');
    }
    updateState();
    return true;
  }

  // Resolves true when it is safe to replace the current document.
  async function canDiscard() {
    if (!isDirty()) return true;
    const choice = await api.confirmDiscard();
    return choice === 'discard' || (choice === 'save' && (await save(false)));
  }

  async function openPath(p) {
    if (!(await canDiscard())) return;
    try {
      loadDoc(await api.readPath(p));
    } catch {
      return;
    }
    takeJump();
  }

  // A search result / backlink asked for this note to open at a given line: { line, col, len }.
  function jumpTo({ line, col, len }) {
    if (mode === 'preview') setMode('edit');
    const lines = editor.value.split('\n');
    const at = Math.min(Math.max(1, line), lines.length) - 1;
    const start = lines.slice(0, at).reduce((n, l) => n + l.length + 1, 0);
    const from = start + (len ? Math.min(col, lines[at].length) : 0);
    const to = len ? from + len : start + lines[at].length;
    editor.focus();
    editor.setSelectionRange(from, to);
    editor.scrollTop = Math.max(0, offsetsY([from])[0] - editor.clientHeight / 3);
  }

  async function takeJump() {
    const j = await api.takeJump();
    if (j) jumpTo(j);
  }

  // ---------- kinds of file: web page and JSON ----------
  const statusEl = $('docstatus');
  const lintEl = $('lint');
  const problemsBox = $('problems');
  let lintTimer = 0;
  let problems = [];
  let panelClosed = false;
  let nextProblem = -1;

  function setKind(next) {
    kind = next;
    document.body.dataset.kind = kind;
    panelClosed = false;
    hideFmt();
    updateLint(true);
  }

  // Mistakes in the web page / JSON are found while typing (a moment after the last key): wavy underline in the
  // text, a list at the bottom, and a badge by the file name.
  function updateLint(now) {
    clearTimeout(lintTimer);
    if (kind === 'md') {
      problems = [];
      return renderLint();
    }
    const run = () => {
      problems = F.lint(kind, editor.value);
      nextProblem = -1;
      renderLint();
    };
    if (now) run();
    else lintTimer = setTimeout(run, 400);
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderLint() {
    const errors = problems.filter((p) => p.severity === 'error').length;
    const warnings = problems.length - errors;
    statusEl.hidden = kind === 'md' || !editor.value.trim();
    statusEl.className = errors ? 'bad' : warnings ? 'warn' : 'ok';
    statusEl.textContent = errors ? `✗ ${plural(errors, 'error')}` : warnings ? `⚠ ${plural(warnings, 'warning')}` : kind === 'json' ? '✓ JSON' : '✓ HTML';
    statusEl.title = problems.length ? problems[0].message + ' — click to go to the next problem' : 'No mistakes found';
    const show = kind !== 'md' && mode === 'edit' && problems.length > 0 && !panelClosed;
    problemsBox.hidden = !show;
    document.body.toggleAttribute('data-problems', show);
    if (show) {
      $('pb-title').textContent = [errors && plural(errors, 'error'), warnings && plural(warnings, 'warning')].filter(Boolean).join(' · ');
      $('pb-list').replaceChildren(
        ...problems.slice(0, 60).map((p) => {
          const li = el('li', p.severity);
          li.append(el('span', 'sev', p.severity === 'error' ? '✗' : '⚠'), el('span', 'where', `Line ${p.line}`), el('span', '', p.message));
          li.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            gotoProblem(p);
          });
          return li;
        })
      );
    }
    paintLint();
  }

  // The text again, invisible, behind the textarea with every problem underlined (same trick as find).
  function paintLint() {
    if (kind === 'md' || mode !== 'edit' || !problems.length) return void (lintEl.textContent = '');
    const v = editor.value;
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let html = '';
    let prev = 0;
    for (const p of problems) {
      let from = Math.min(p.pos, Math.max(0, v.length - 1));
      if (v[from] === '\n' && from > prev) from--;
      const to = Math.min(v.length, from + Math.max(1, p.len));
      if (from < prev || to <= from) continue;
      html += esc(v.slice(prev, from)) + `<mark class="${p.severity}">` + esc(v.slice(from, to)) + '</mark>';
      prev = to;
    }
    lintEl.style.width = editor.clientWidth + 'px';
    lintEl.innerHTML = html + esc(v.slice(prev)) + '\n';
    lintEl.scrollTop = editor.scrollTop;
  }

  function gotoProblem(p) {
    jumpTo({ line: p.line, col: p.col - 1, len: Math.max(1, p.len) });
  }

  editor.addEventListener('scroll', () => (lintEl.scrollTop = editor.scrollTop));
  addEventListener('resize', paintLint);
  $('pb-close').addEventListener('click', () => {
    panelClosed = true;
    renderLint();
  });
  statusEl.addEventListener('click', () => {
    if (panelClosed) {
      panelClosed = false;
      renderLint();
    }
    if (!problems.length) return;
    nextProblem = (nextProblem + 1) % problems.length;
    gotoProblem(problems[nextProblem]);
  });

  // ---------- text formatting bar (web pages) ----------
  // Appears over selected text in a .html file: bold, italic, colour, size, alignment… Menu items and shortcuts
  // (Format menu) do the same through format().
  const fmtbar = $('fmtbar');
  const fmtpop = $('fmtpop');
  const COLORS = ['#e03131', '#f76707', '#f59f00', '#2f9e44', '#1c7ed6', '#7048e8', '#d6336c', '#495057', '#000000', '#ffffff'];
  const MARKERS = ['#fff3bf', '#ffd8a8', '#d3f9d8', '#d0ebff', '#e5dbff', '#ffdeeb', '#e9ecef'];
  const BAR = [
    ['bold', 'B', 'Bold (⌘B)', 'b'], ['italic', 'I', 'Italic (⌘I)', 'i'], ['strike', 'S', 'Strikethrough (⇧⌘X)', 's'], ['underline', 'U', 'Underline (⌘U)', 'u'],
    null,
    ['pop:color', 'A', 'Text color'], ['pop:bg', '▮', 'Highlight color'], ['pop:size', 'Aa', 'Text size'], ['pop:align', '≡', 'Alignment'],
    null,
    ['link', '🔗', 'Link (⌘K)'], ['code', '</>', 'Code (⌘E)'], ['clear', '⌫', 'Remove formatting'],
  ];
  const POPS = {
    size: [['Small', '0.85em'], ['Normal', ''], ['Large', '1.25em'], ['Larger', '1.6em'], ['Huge', '2.2em']],
    align: [['Align left', 'left'], ['Center', 'center'], ['Align right', 'right'], ['Justify', 'justify']],
  };
  let popKind = '';

  for (const item of BAR) {
    if (!item) {
      fmtbar.append(el('span', 'sep'));
      continue;
    }
    const [id, label, title, cls] = item;
    const b = el('button', cls || '', label);
    b.title = title;
    b.addEventListener('click', () => (id.startsWith('pop:') ? togglePop(id.slice(4)) : (hidePop(), format(id))));
    fmtbar.append(b);
  }
  // Clicking the bar must not take the selection away from the text.
  for (const box of [fmtbar, fmtpop]) box.addEventListener('mousedown', (ev) => ev.target.tagName !== 'INPUT' && ev.preventDefault());

  function hidePop() {
    fmtpop.hidden = true;
    popKind = '';
  }

  function hideFmt() {
    fmtbar.hidden = true;
    hidePop();
  }

  function updateFmtBar() {
    const ok = kind === 'html' && mode === 'edit' && !isOpen() && sheet.hidden && editor.selectionStart !== editor.selectionEnd;
    if (!ok) return hideFmt();
    fmtbar.hidden = false;
    const { x, y } = caretXY(editor.selectionStart);
    const lh = parseFloat(getComputedStyle(editor).lineHeight) || 26;
    const left = Math.max(8, Math.min(x - 8, innerWidth - fmtbar.offsetWidth - 8));
    const above = y - lh - fmtbar.offsetHeight - 6;
    fmtbar.style.left = left + 'px';
    fmtbar.style.top = (above < 48 ? y + 8 : above) + 'px';
    if (!fmtpop.hidden) placePop();
  }

  function placePop() {
    fmtpop.style.left = fmtbar.style.left;
    fmtpop.style.top = fmtbar.offsetTop + fmtbar.offsetHeight + 4 + 'px';
  }

  function togglePop(type) {
    if (popKind === type) return hidePop();
    popKind = type;
    const swatches = (list, prop, none) => {
      const out = list.map((c) => {
        const b = el('button', 'swatch');
        b.style.background = c;
        b.title = c;
        b.addEventListener('click', () => format(prop + ':' + c));
        return b;
      });
      const reset = el('button', 'opt', none);
      reset.addEventListener('click', () => (format(prop + ':'), hidePop()));
      const picker = el('input');
      picker.type = 'color';
      picker.title = 'Any color…';
      picker.addEventListener('input', () => format(prop + ':' + picker.value));
      return [...out, picker, reset];
    };
    if (type === 'color') fmtpop.replaceChildren(...swatches(COLORS, 'color', 'Default color'));
    else if (type === 'bg') fmtpop.replaceChildren(...swatches(MARKERS, 'bg', 'No highlight'));
    else {
      fmtpop.replaceChildren(
        ...POPS[type].map(([label, value]) => {
          const b = el('button', 'opt', label);
          b.addEventListener('click', () => (format(type + ':' + value), hidePop()));
          return b;
        })
      );
    }
    fmtpop.hidden = false;
    placePop();
  }

  function openFmtPop(type) {
    if (kind !== 'html') return toast('Colors work in web pages (.html).');
    if (editor.selectionStart === editor.selectionEnd) return toast('Select some text first.');
    updateFmtBar();
    popKind = '';
    togglePop(type);
  }

  editor.addEventListener('mouseup', () => setTimeout(updateFmtBar));
  editor.addEventListener('keyup', updateFmtBar);
  editor.addEventListener('select', updateFmtBar);
  editor.addEventListener('scroll', updateFmtBar);
  editor.addEventListener('blur', () =>
    setTimeout(() => {
      if (document.activeElement !== editor && !fmtbar.contains(document.activeElement) && !fmtpop.contains(document.activeElement)) hideFmt();
    })
  );

  function transformJson(fn, done) {
    if (kind !== 'json') return toast('This command is for JSON files.');
    const out = fn(editor.value);
    if (out === null) return checkJson();
    if (mode === 'preview') setMode('edit');
    if (out === editor.value) return toast('Already ' + done.toLowerCase());
    applyEdit({ from: 0, to: editor.value.length, text: out, selStart: 0, selEnd: 0 });
    toast(done);
  }

  function checkJson() {
    if (kind !== 'json') return toast('This command is for JSON files.');
    const r = F.jsonCheck(editor.value);
    if (r.ok) return toast('✓ Valid JSON — ' + describeJson(r.value));
    toast(r.empty ? r.message : `✗ Line ${r.line}, column ${r.col}: ${r.message}`);
    if (!r.empty) jumpTo({ line: r.line, col: r.col - 1, len: 1 });
  }

  // The preview frame runs no scripts and loads no outside styles; the browser shows the page exactly as visitors see it.
  async function openInBrowser() {
    if (kind !== 'html') return toast('Open in Browser is for web pages (.html).');
    if (!docPath || isDirty()) {
      toast('Saving the page first…');
      if (!(await save(false))) return;
    }
    api.openExternal(encodeURI('file://' + docPath));
  }

  // File → New HTML Page / New JSON File: a starter text, saved as .html / .json.
  function newDoc(next) {
    if (!F.KINDS.includes(next)) return;
    loadDoc({ content: F.templateFor(next), name: 'Untitled.' + F.EXT[next], path: null, dir: null });
    if (next === 'html') {
      const at = editor.value.indexOf('Viết nội dung');
      editor.setSelectionRange(at, at);
    } else if (next === 'json') editor.setSelectionRange(4, 4);
    editor.focus();
  }

  const actions = {
    toggle: () => setMode(mode === 'edit' ? 'preview' : 'edit'),
    night: toggleNight,
    'theme-pref': applyTheme,
    'gantt-tables': updateGanttTablesCommand,
    'gantt-changed': () => {
      // Gantt's data changed (e.g. a Calendar sync): follow it, but never rewrite a note the user is typing in.
      if (mode === 'preview' || !isDirty()) refreshLive().then((changed) => changed && mode === 'preview' && renderPreview());
    },
    jump: takeJump,
    toast,
    commands: openCommandsSheet,
    gantt: openGanttSheet,
    'gantt-open': showInGantt,
    'gantt-unlink': unlinkFromGantt,
    'gantt-table': ganttTableCommand,
    'project-notes': projectNotesCommand,
    'new-kind': newDoc,
    'format-doc': () => (kind === 'json' ? actions['json-format']() : toast('Format works on JSON files.')),
    'json-format': () => transformJson(F.jsonFormat, 'Formatted'),
    'json-minify': () => transformJson(F.jsonMinify, 'Minified to one line'),
    'json-sort': () => transformJson(F.jsonSortKeys, 'Keys sorted A→Z'),
    'json-check': checkJson,
    'open-browser': openInBrowser,
    'export-pdf': () => exportAs('pdf'),
    'export-docx': () => exportAs('docx'),
    'paste-plain': (text) => {
      if (mode !== 'edit' || !text) return;
      const s = editor.selectionStart;
      applyEdit({ from: s, to: editor.selectionEnd, text, selStart: s + text.length, selEnd: s + text.length });
    },
    save: () => save(false),
    'save-as': () => save(true),
    'open-path': openPath,
    'save-and-close': async () => (await save(false)) && api.closeNow(),
  };

  api.onMenu((action, payload) => {
    if (action.startsWith('fmt:')) return mode === 'edit' && format(action.slice(4));
    actions[action]?.(payload);
  });

  addEventListener('dragover', (e) => e.preventDefault());
  // Dropping files into the note inserts links to them (text = file name); pictures are copied next to the note
  // and inserted as images. ⌘-click or click in Preview opens links.
  addEventListener('drop', async (e) => {
    e.preventDefault();
    const items = [...e.dataTransfer.files].map((file) => ({ file, path: api.pathForFile(file) }));
    if (!items.length) return;
    if (kind === 'json') return toast('Files can’t be dropped into a JSON file.');
    const isPicture = (it) => it.file.type.startsWith('image/') || E.isImageName(it.file.name);
    const pictures = items.filter(isPicture).map((it) => ({
      ...it,
      name: E.isImageName(it.file.name) ? it.file.name : E.pastedImageName(new Date(), imageExt(it.file.type)),
      alt: it.file.name.replace(/\.[^.]+$/, ''),
    }));
    const links = items.filter((it) => !isPicture(it) && it.path).map((it) => (kind === 'html' ? F.htmlFileLink(it.path) : E.fileLink(it.path)));
    if (!pictures.length && !links.length) return;
    if (mode === 'preview') setMode('edit');
    editor.focus();
    const snippets = [...(await saveImages(pictures)), ...links];
    const ed = E.insertSnippets(editor.value, editor.selectionStart, editor.selectionEnd, snippets);
    if (ed) applyEdit(ed);
  });

  addEventListener('focus', () => {
    reloadCommands();
    if (!isDirty() && sheet.hidden) refreshLive().then((changed) => changed && mode === 'preview' && renderPreview());
  });
  reloadCommands();
  applyTheme();
  updateState();
  updateLint(true);
  editor.focus();

  window.AppCtx = {
    editor, preview, el, toast, hooks, offsetsY, caretXY, applyEdit, setMode, jumpTo, actions,
    getMode: () => mode,
    getKind: () => kind,
    getDocPath: () => docPath,
    isDirty,
  };
})();
