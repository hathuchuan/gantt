(() => {
  const E = window.Editing;
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const preview = $('preview');
  const slashEl = $('slash');
  const docname = $('docname');

  let mode = 'edit';
  let name = 'Untitled';
  let saved = '';
  let slash = { items: [], index: 0, from: 0 };

  const isOpen = () => !slashEl.hidden;
  const isDirty = () => editor.value !== saved;

  // ---------- editing ----------
  function applyEdit(ed) {
    editor.focus();
    editor.setSelectionRange(ed.from, ed.to);
    if (ed.text === '') {
      if (ed.from !== ed.to) document.execCommand('delete');
    } else if (!document.execCommand('insertText', false, ed.text)) {
      editor.setRangeText(ed.text, ed.from, ed.to, 'end');
    }
    editor.setSelectionRange(ed.selStart, ed.selEnd);
    onInput();
  }

  function onInput() {
    updateState();
    updateSlash();
  }

  function updateState() {
    const dirty = isDirty();
    docname.textContent = name + (dirty ? ' •' : '');
    document.title = name;
    api.setState({ dirty, name });
  }

  editor.addEventListener('input', onInput);
  editor.addEventListener('click', hideSlash);
  editor.addEventListener('blur', hideSlash);

  editor.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // IME (e.g. Telex/VNI)
    if (isOpen() && slashKey(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const { value: v, selectionStart: s, selectionEnd: end } = editor;
    let ed = null;
    if (e.key === 'Enter' && !e.shiftKey) ed = E.onEnter(v, s, end);
    else if (e.key === 'Tab') {
      e.preventDefault();
      ed = E.onTab(v, s, end, e.shiftKey);
    } else if (e.key === 'Backspace') ed = E.onBackspace(v, s, end);
    else if (e.key.length === 1) ed = E.autoPair(v, s, end, e.key);

    if (ed) {
      e.preventDefault();
      applyEdit(ed);
    }
  });

  editor.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text/plain');
    const ed = E.pasteUrl(editor.value, editor.selectionStart, editor.selectionEnd, text);
    if (ed) {
      e.preventDefault();
      applyEdit(ed);
    }
  });

  function format(action) {
    const { value: v, selectionStart: s, selectionEnd: e } = editor;
    const marks = { bold: '**', italic: '*', strike: '~~', code: '`' };
    let ed;
    if (action in marks) ed = E.wrap(v, s, e, marks[action]);
    else if (action === 'link') ed = E.link(v, s, e);
    else if (/^h[123]$/.test(action)) ed = E.heading(v, s, Number(action[1]));
    if (ed) applyEdit(ed);
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

  function updateSlash() {
    const q = E.slashQuery(editor.value, editor.selectionStart);
    const items = q ? E.filterSlash(q.query) : [];
    if (!q || !items.length || editor.selectionStart !== editor.selectionEnd) return hideSlash();
    slash = { items, index: 0, from: q.from };
    renderSlash();
    const { x, y } = caretXY(q.from);
    slashEl.hidden = false;
    slashEl.style.left = Math.max(8, Math.min(x, innerWidth - slashEl.offsetWidth - 8)) + 'px';
    const below = y + slashEl.offsetHeight > innerHeight - 8;
    slashEl.style.top = (below ? Math.max(8, y - 28 - slashEl.offsetHeight) : y) + 'px';
  }

  function renderSlash() {
    slashEl.replaceChildren(
      ...slash.items.map((it, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        if (i === slash.index) li.className = 'active';
        li.append(it.label);
        const hint = document.createElement('span');
        hint.textContent = it.hint;
        li.append(hint);
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
    applyEdit(E.applySlash(editor.value, editor.selectionStart, slash.from, item));
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
  function setMode(next) {
    const src = next === 'preview' ? editor : preview;
    const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    mode = next;
    document.body.dataset.mode = mode;
    hideSlash();
    if (mode === 'preview') {
      preview.innerHTML = DOMPurify.sanitize(marked.parse(editor.value, { gfm: true }));
      preview.hidden = false;
      editor.hidden = true;
    } else {
      preview.hidden = true;
      editor.hidden = false;
      editor.focus();
    }
    const dst = mode === 'preview' ? preview : editor;
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
    $('toggle').title = mode === 'edit' ? 'Preview (⌘/)' : 'Edit (⌘/)';
  }

  $('toggle').addEventListener('click', () => setMode(mode === 'edit' ? 'preview' : 'edit'));

  preview.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
    else api.openExternal(a.href);
  });

  // ---------- theme ----------
  function setNight(on) {
    document.documentElement.dataset.theme = on ? 'dark' : 'light';
    try {
      localStorage.setItem('night', on ? '1' : '0');
    } catch {}
    api.setTheme(on);
  }
  const isNight = () => document.documentElement.dataset.theme === 'dark';

  // ---------- files ----------
  function loadDoc(doc) {
    editor.value = doc ? doc.content : '';
    saved = editor.value;
    name = doc ? doc.name : 'Untitled';
    let base = document.querySelector('base');
    if (!base) document.head.prepend((base = document.createElement('base')));
    if (doc) base.href = encodeURI('file://' + doc.dir + '/');
    else base.remove();
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    if (mode === 'preview') setMode('preview');
    updateState();
  }

  async function save(as) {
    const doc = await (as ? api.saveAs(editor.value) : api.save(editor.value));
    if (!doc) return false;
    saved = doc.content;
    name = doc.name;
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
    } catch {}
  }

  const actions = {
    toggle: () => setMode(mode === 'edit' ? 'preview' : 'edit'),
    night: () => setNight(!isNight()),
    save: () => save(false),
    'save-as': () => save(true),
    new: async () => {
      if (!(await canDiscard())) return;
      await api.newDoc();
      loadDoc(null);
      setMode('edit');
    },
    open: async () => {
      if (!(await canDiscard())) return;
      const doc = await api.openDialog();
      if (doc) loadDoc(doc);
    },
    'open-path': openPath,
    'save-and-close': async () => (await save(false)) && api.closeNow(),
  };

  api.onMenu((action, payload) => {
    if (action.startsWith('fmt:')) return mode === 'edit' && format(action.slice(4));
    actions[action]?.(payload);
  });

  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && /\.(md|markdown|txt)$/i.test(f.name)) openPath(api.pathForFile(f));
  });

  setNight(isNight());
  updateState();
  editor.focus();
})();
