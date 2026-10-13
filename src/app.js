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
  let slash = { items: [], index: 0, from: 0, query: '' };
  let docPath = null;
  let cmdConfig = {};
  let items = E.buildItems();

  marked.use({ extensions: MarkedMath.extensions });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

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
    const found = q ? E.filterSlash(q.query, items, { lineStart: q.lineStart }) : [];
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
  function eventChip(meta) {
    const chip = el('div', 'event-chip', '📅 ' + meta.event);
    const d = new Date(meta['event-start']);
    if (!isNaN(d)) {
      const fmt = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      chip.append(' · ' + d.toLocaleString(undefined, fmt));
    }
    return chip;
  }

  function renderPreview() {
    const fm = E.parseFrontMatter(editor.value);
    preview.innerHTML = DOMPurify.sanitize(marked.parse(fm.body, { gfm: true }));
    preview.querySelectorAll('.math-ph').forEach((node) => {
      try {
        katex.render(node.dataset.tex, node, { displayMode: node.dataset.display === '1', throwOnError: false, trust: false });
      } catch {
        node.textContent = node.dataset.tex;
      }
    });
    if (fm.meta.event) preview.prepend(eventChip(fm.meta));
  }

  function setMode(next) {
    const src = next === 'preview' ? editor : preview;
    const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    mode = next;
    document.body.dataset.mode = mode;
    hideSlash();
    if (mode === 'preview') {
      renderPreview();
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
    items = E.buildItems(cfg);
  }

  async function reloadCommands() {
    applyConfig(await api.loadCommands());
  }

  async function openCommandsSheet() {
    const cfg = await api.loadCommands();
    applyConfig(cfg);
    const all = E.buildItems(cmdConfig);
    const save = async () => {
      const disabled = all.filter((i) => !i.enabled).map((i) => i.key);
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

  // ---------- calendar events ----------
  const EVENT_ERRORS = {
    unavailable: 'Calendar integration is only available in the macOS app.',
    denied: 'Calendar access was denied. Allow MD Editor in System Settings → Privacy & Security → Calendars.',
  };

  function openEventSheet() {
    let events = [];
    let shown = [];
    let index = 0;
    const input = el('input', 'filter');
    input.type = 'text';
    input.placeholder = 'Filter events…';
    const status = el('p', 'note', 'Loading…');
    const list = el('div', 'events');

    const dayFmt = { weekday: 'long', day: 'numeric', month: 'long' };
    const timeFmt = { hour: '2-digit', minute: '2-digit' };

    function paint() {
      const q = input.value.trim().toLowerCase();
      shown = events.filter((e) => !q || e.title.toLowerCase().includes(q) || e.calendar.toLowerCase().includes(q));
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.replaceChildren();
      let day = '';
      shown.forEach((e, i) => {
        const start = new Date(e.start);
        const label = start.toLocaleDateString(undefined, dayFmt);
        if (label !== day) {
          day = label;
          list.append(el('div', 'cmd-group', label));
        }
        const row = el('div', 'event-row' + (i === index ? ' active' : ''));
        const when = e.allDay ? 'All day' : start.toLocaleTimeString(undefined, timeFmt);
        row.append(el('span', 'when', when), el('span', 'label', e.title), el('span', 'key', e.url.startsWith('mdeditor:') ? '📎 ' + e.calendar : e.calendar));
        row.addEventListener('click', () => attachEvent(e));
        list.append(row);
      });
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
      if (events.length) status.textContent = shown.length ? '' : 'No matching events.';
    }

    const token = openSheet(
      'Attach to calendar event',
      (body) => body.append(input, status, list),
      (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          index = Math.max(0, Math.min(shown.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
          paint();
        } else if (e.key === 'Enter' && shown[index]) {
          e.preventDefault();
          attachEvent(shown[index]);
        }
      }
    );
    input.addEventListener('input', () => {
      index = 0;
      paint();
    });
    input.focus();

    api.listEvents().then((r) => {
      if (sheetToken !== token) return;
      if (r.error) {
        status.textContent = EVENT_ERRORS[r.error] || 'Couldn’t read the calendar: ' + r.error;
        status.classList.add('error');
        return;
      }
      events = r.events;
      status.textContent = events.length ? '' : 'No events between last week and the next three weeks.';
      paint();
    });
  }

  // Links the note to the event (event gets a mdeditor:// link, note gets front matter).
  async function attachEvent(ev) {
    closeSheet();
    if (!(await save(false))) return; // the link needs a file path
    const r = await api.linkEvent({ id: ev.id, start: ev.start, file: docPath });
    if (r.error) return toast(EVENT_ERRORS[r.error] || 'Couldn’t update the event: ' + r.error);
    applyEdit(E.setEvent(editor.value, editor.selectionStart, editor.selectionEnd, ev));
    await save(false);
    toast('Attached to “' + ev.title + '”');
  }

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
    docPath = doc ? doc.path : null;
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
    docPath = doc.path;
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
    commands: openCommandsSheet,
    event: openEventSheet,
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

  addEventListener('focus', reloadCommands);
  reloadCommands();
  setNight(isNight());
  updateState();
  editor.focus();
})();
