// Find bar (⌘F), side panel (outline ⇧⌘O, notes search ⇧⌘F, backlinks ⇧⌘B), [[wiki link]] autocomplete and the
// backlinks section of the preview. Plugs into app.js through window.AppCtx; the logic itself lives in notes-core.js.
(() => {
  const C = window.AppCtx;
  const N = window.NotesCore;
  const api = window.api;
  if (!C) return;
  const { editor, preview, el, toast, hooks, actions } = C;
  const $ = (id) => document.getElementById(id);
  const isEdit = () => C.getMode() === 'edit';
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ======================= find =======================
  const bar = $('findbar');
  const input = $('find-input');
  const countEl = $('find-count');
  const hl = $('hl');
  const find = { open: false, query: '', cs: false, matches: [], marks: [], index: -1 };
  const total = () => (isEdit() ? find.matches.length : find.marks.length);

  // Edit mode: the text sits invisibly behind the textarea with every hit marked, so hits stay visible while the
  // find field has the focus.
  function paintOverlay() {
    if (!find.open || !isEdit() || !find.matches.length) {
      hl.textContent = '';
      return;
    }
    hl.style.width = editor.clientWidth + 'px';
    const v = editor.value;
    let html = '';
    let prev = 0;
    find.matches.forEach((m, i) => {
      html += escHtml(v.slice(prev, m.from)) + `<mark${i === find.index ? ' class="cur"' : ''}>` + escHtml(v.slice(m.from, m.to)) + '</mark>';
      prev = m.to;
    });
    hl.innerHTML = html + escHtml(v.slice(prev)) + '\n';
    hl.scrollTop = editor.scrollTop;
  }

  function clearMarks() {
    if (find.marks.length || preview.querySelector('mark.find-hit')) {
      preview.querySelectorAll('mark.find-hit').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
      preview.normalize();
    }
    find.marks = [];
  }

  // Preview: wrap each hit (inside a single text node) in <mark class="find-hit">.
  function highlightPreview() {
    clearMarks();
    if (!find.query) return;
    const nodes = [];
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && n.parentElement && !n.parentElement.closest('.katex, .backlinks') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const ms = N.findAll(node.nodeValue, find.query, find.cs);
      if (!ms.length) continue;
      const frag = document.createDocumentFragment();
      let prev = 0;
      for (const m of ms) {
        frag.append(node.nodeValue.slice(prev, m.from), el('mark', 'find-hit', node.nodeValue.slice(m.from, m.to)));
        prev = m.to;
      }
      frag.append(node.nodeValue.slice(prev));
      node.replaceWith(frag);
    }
    find.marks = [...preview.querySelectorAll('mark.find-hit')];
  }

  function reveal(m) {
    const y = C.offsetsY([m.from])[0];
    if (y < editor.scrollTop + 48 || y > editor.scrollTop + editor.clientHeight - 96) editor.scrollTop = Math.max(0, y - editor.clientHeight / 3);
    hl.scrollTop = editor.scrollTop;
  }

  // Show the current match: count, highlight, and (Edit) select it in the textarea and scroll it into view.
  function show(scroll = true) {
    countEl.textContent = N.countLabel(find.index, total(), !!find.query);
    countEl.style.color = find.query && !total() ? '#d93025' : '';
    if (isEdit()) {
      const m = find.matches[find.index];
      if (m && scroll) {
        editor.setSelectionRange(m.from, m.to); // only when navigating — never while the user is typing in the note
        reveal(m);
      }
      paintOverlay();
    } else {
      find.marks.forEach((mk, i) => mk.classList.toggle('cur', i === find.index));
      const mk = find.marks[find.index];
      if (mk && scroll) mk.scrollIntoView({ block: 'center' });
    }
  }

  function run({ keep = false } = {}) {
    find.query = input.value;
    if (isEdit()) {
      clearMarks();
      find.matches = N.findAll(editor.value, find.query, find.cs);
    } else {
      find.matches = [];
      hl.textContent = '';
      highlightPreview();
    }
    const n = total();
    find.index = !n ? -1 : keep && find.index >= 0 && find.index < n ? find.index : isEdit() ? N.startIndex(find.matches, editor.selectionStart) : 0;
    show(!keep);
  }

  function openFind() {
    let seed = '';
    if (isEdit()) {
      const { selectionStart: s, selectionEnd: e, value: v } = editor;
      if (s !== e && e - s <= 120 && !v.slice(s, e).includes('\n')) seed = v.slice(s, e);
    } else seed = String(getSelection()).split('\n')[0].trim().slice(0, 120);
    find.open = true;
    bar.hidden = false;
    if (seed) input.value = seed;
    input.focus();
    input.select();
    run();
  }

  function closeFind() {
    if (!find.open) return;
    find.open = false;
    bar.hidden = true;
    clearMarks();
    hl.textContent = '';
    find.matches = [];
    if (isEdit()) editor.focus(); // the current match stays selected
  }

  function step(dir) {
    if (!total()) return;
    find.index = N.stepIndex(find.index, total(), dir);
    show();
  }

  input.addEventListener('input', () => run());
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  $('find-next').addEventListener('click', () => step(1));
  $('find-prev').addEventListener('click', () => step(-1));
  $('find-close').addEventListener('click', closeFind);
  $('find-case').addEventListener('click', () => {
    find.cs = !find.cs;
    $('find-case').setAttribute('aria-pressed', String(find.cs));
    run();
    input.focus();
  });
  // Esc in the text closes the bar too.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && find.open && !e.defaultPrevented && $('sheet').hidden && document.activeElement !== input) closeFind();
  });
  editor.addEventListener('scroll', () => {
    if (find.open && isEdit()) hl.scrollTop = editor.scrollTop;
  });

  let rerun = 0;
  const later = (fn) => {
    cancelAnimationFrame(rerun);
    rerun = requestAnimationFrame(fn);
  };

  actions.find = openFind;
  actions['find-next'] = () => (find.open && input.value ? step(1) : openFind());
  actions['find-prev'] = () => (find.open && input.value ? step(-1) : openFind());

  // ======================= side panel =======================
  const side = $('side');
  const sideBody = $('side-body');
  const tabs = [...document.querySelectorAll('#side-tabs button')];
  let sideTab = null;

  function openSide(tab) {
    sideTab = tab;
    side.hidden = false;
    document.body.dataset.side = '1';
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    ys = null;
    paintSide();
    later(() => {
      paintOverlay();
      markActive();
    });
  }

  function closeSide() {
    side.hidden = true;
    delete document.body.dataset.side;
    sideTab = null;
    ys = null;
    later(paintOverlay);
    if (isEdit()) editor.focus();
  }

  tabs.forEach((b) => b.addEventListener('click', () => openSide(b.dataset.tab)));

  function paintSide() {
    if (sideTab === 'outline') {
      headings = N.parseHeadings(editor.value);
      paintOutline();
    } else if (sideTab === 'search') paintSearch();
    else if (sideTab === 'links') paintLinks();
  }

  actions.outline = () => (!side.hidden && sideTab === 'outline' ? closeSide() : openSide('outline'));
  actions.backlinks = () => (!side.hidden && sideTab === 'links' ? closeSide() : openSide('links'));
  actions['search-notes'] = () => {
    const sel = isEdit() ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : String(getSelection());
    if (sel && sel.length <= 100 && !sel.includes('\n')) search.query = sel.trim();
    if (sideTab !== 'search' || side.hidden) openSide('search');
    else if (search.ui) search.ui.input.value = search.query;
    search.ui?.input.focus();
    search.ui?.input.select();
    if (search.ui) runSearch();
  };
  actions['notes-folder'] = (p) => {
    toast('Notes folder: ' + p);
    if (sideTab === 'search') runSearch();
  };

  // ---------- outline ----------
  let headings = [];
  let ys = null; // y of each heading in the textarea (cached; reset when the text or layout changes)
  const click = (node, fn) => node.addEventListener('click', fn);

  function paintOutline() {
    sideBody.replaceChildren();
    if (!headings.length) {
      sideBody.append(el('p', 'empty', 'No headings yet — start a line with # to add one.'));
      return;
    }
    const min = Math.min(...headings.map((h) => h.level));
    headings.forEach((h, i) => {
      const b = el('button', 'outline-item l' + h.level, h.text);
      b.style.paddingLeft = 8 + (h.level - min) * 14 + 'px';
      b.title = h.text;
      click(b, () => jumpHeading(i));
      sideBody.append(b);
    });
    markActive();
  }

  const previewHeadings = () => [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => !h.closest('.gantt-card, .backlinks'));

  // The rendered heading for outline entry i (by position; by text when the page has extra HTML headings).
  function previewHeading(i) {
    const doms = previewHeadings();
    if (doms.length === headings.length) return doms[i];
    const want = headings[i].text;
    const nth = headings.slice(0, i).filter((h) => h.text === want).length;
    return doms.filter((d) => N.plainInline(d.textContent) === want)[nth] || null;
  }

  function jumpHeading(i) {
    const h = headings[i];
    if (!h) return;
    if (isEdit()) {
      editor.focus();
      editor.setSelectionRange(h.offset, h.offset);
      editor.scrollTop = Math.max(0, C.offsetsY([h.offset])[0] - 24);
    } else previewHeading(i)?.scrollIntoView({ block: 'start' });
    setActive(i);
  }

  function setActive(idx) {
    sideBody.querySelectorAll('.outline-item').forEach((b, i) => b.classList.toggle('active', i === idx));
    sideBody.querySelector('.outline-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  // Highlight the section that is at the top of the window.
  function markActive() {
    if (side.hidden || sideTab !== 'outline' || !headings.length) return;
    let positions;
    let at;
    if (isEdit()) {
      if (!ys) ys = C.offsetsY(headings.map((h) => h.offset));
      positions = ys;
      at = editor.scrollTop + 80;
    } else {
      const base = preview.getBoundingClientRect().top;
      positions = headings.map((_, i) => {
        const node = previewHeading(i);
        return node ? node.getBoundingClientRect().top - base + preview.scrollTop : Infinity;
      });
      at = preview.scrollTop + 80;
    }
    setActive(N.activeIndex(positions, at));
  }

  let scrollFrame = 0;
  const onScroll = () => {
    if (side.hidden || sideTab !== 'outline' || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      markActive();
    });
  };
  editor.addEventListener('scroll', onScroll);
  preview.addEventListener('scroll', onScroll);

  let outlineTimer = 0;
  const outlineSoon = () => {
    if (side.hidden || sideTab !== 'outline') return;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => {
      ys = null;
      headings = N.parseHeadings(editor.value);
      paintOutline();
    }, 200);
  };

  // ---------- search across notes ----------
  const search = { query: '', tag: '', token: 0, timer: 0, ui: null };

  function hitNodes(text, q) {
    const ms = q ? N.findAll(text, q, false, 20) : [];
    if (!ms.length) return [text];
    const out = [];
    let prev = 0;
    for (const m of ms) {
      out.push(text.slice(prev, m.from), el('mark', '', text.slice(m.from, m.to)));
      prev = m.to;
    }
    out.push(text.slice(prev));
    return out;
  }

  const openResult = (r) =>
    api.notesOpen({ path: r.path, line: r.line, col: r.col, len: r.len }).then((res) => res && res.error && toast('That note no longer exists.'));

  // Rows grouped by note: [{ path, name, rel, line, snippet, … }] → file heading + one row per hit.
  function resultList(rows, q) {
    const box = el('div');
    let last = null;
    for (const r of rows) {
      if (r.path !== last) {
        last = r.path;
        const head = el('div', 'res-file', r.name);
        const dir = r.rel.includes('/') ? r.rel.slice(0, r.rel.lastIndexOf('/')) : '';
        if (dir) head.append(el('span', '', dir));
        head.title = r.path;
        box.append(head);
      }
      const row = el('button', 'res-row');
      const text = el('span', 'tx');
      text.append(...hitNodes(r.snippet, q));
      row.append(el('span', 'ln', String(r.line)), text);
      click(row, () => openResult(r));
      box.append(row);
    }
    return box;
  }

  function paintSearch() {
    sideBody.replaceChildren();
    const field = el('input', 'filter');
    field.type = 'text';
    field.placeholder = 'Search all notes…';
    field.spellcheck = false;
    field.value = search.query;
    const tagsBox = el('div', 'tag-cloud');
    const results = el('div');
    const foot = el('div', 'side-foot');
    sideBody.append(field, tagsBox, results, foot);
    search.ui = { input: field, tagsBox, results, foot };
    field.addEventListener('input', () => {
      search.query = field.value;
      clearTimeout(search.timer);
      search.timer = setTimeout(runSearch, 180);
    });
    field.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        field.blur();
        if (isEdit()) editor.focus();
      }
    });
    runSearch();
  }

  async function runSearch() {
    const ui = search.ui;
    if (!ui || sideTab !== 'search') return;
    const token = ++search.token;
    const r = await api.notesSearch({ file: C.getDocPath(), query: search.query, tag: search.tag });
    if (token !== search.token || search.ui !== ui || sideTab !== 'search' || !r) return;

    const chip = (tag, count) => {
      const b = el('button', 'tag-chip' + (N.tagKey(tag) === N.tagKey(search.tag) ? ' on' : ''), '#' + tag);
      if (count) b.append(el('i', '', String(count)));
      click(b, () => {
        search.tag = N.tagKey(tag) === N.tagKey(search.tag) ? '' : tag;
        runSearch();
      });
      return b;
    };
    const shown = r.tags.slice(0, 40);
    if (search.tag && !shown.some((t) => N.tagKey(t.tag) === N.tagKey(search.tag))) shown.unshift({ tag: search.tag, count: 0 });
    ui.tagsBox.replaceChildren(...shown.map((t) => chip(t.tag, t.count)));
    if (!shown.length) ui.tagsBox.append(el('span', 'empty', 'No #tags found yet. Tag a note with #idea or tags: [idea] in its front matter.'));

    ui.results.replaceChildren();
    if (!search.query.trim() && !search.tag) ui.results.append(el('p', 'empty', 'Type to search the text of every note, or pick a tag.'));
    else if (!r.results.length) ui.results.append(el('p', 'empty', 'No matches.'));
    else {
      const notes = new Set(r.results.map((x) => x.path)).size;
      ui.results.append(el('p', 'empty', `${r.results.length}${r.truncated ? '+' : ''} ${r.results.length === 1 ? 'match' : 'matches'} in ${notes} ${notes === 1 ? 'note' : 'notes'}`), resultList(r.results, search.query.trim()));
    }
    ui.foot.replaceChildren(`${r.files} notes in ${r.roots.map((p) => p.split('/').slice(-2).join('/')).join(' + ') || 'no folder'}${r.scanTruncated ? ' (stopped at the file limit)' : ''}. `);
    const change = el('button', '', 'Choose folder…');
    click(change, () => api.chooseNotesFolder());
    ui.foot.append(change);
  }

  // ---------- backlinks ----------
  async function paintLinks() {
    sideBody.replaceChildren();
    const file = C.getDocPath();
    if (!file) return void sideBody.append(el('p', 'empty', 'Save this note to see which notes link to it with [[its name]].'));
    sideBody.append(el('p', 'empty', 'Looking…'));
    const r = await api.notesBacklinks({ file });
    if (sideTab !== 'links' || C.getDocPath() !== file) return;
    sideBody.replaceChildren();
    if (!r || !r.backlinks.length) {
      sideBody.append(el('p', 'empty', 'No note links here yet. Link to this note from another one with [[name]] or [[name|alias]].'));
      return;
    }
    sideBody.append(el('p', 'empty', `${r.backlinks.length} ${r.backlinks.length === 1 ? 'link' : 'links'} from ${new Set(r.backlinks.map((b) => b.path)).size} notes`), resultList(r.backlinks, ''));
  }

  // Backlinks at the end of the preview.
  async function appendBacklinks() {
    const file = C.getDocPath();
    if (!file) return;
    const r = await api.notesBacklinks({ file });
    if (!r || !r.backlinks.length || isEdit() || C.getDocPath() !== file) return;
    preview.querySelector('.backlinks')?.remove();
    const sec = el('section', 'backlinks');
    sec.append(el('h4', '', `Backlinks (${r.backlinks.length})`));
    const groups = new Map();
    for (const b of r.backlinks) (groups.get(b.path) || groups.set(b.path, []).get(b.path)).push(b);
    for (const [path, rows] of groups) {
      const a = el('a', 'bl-row');
      a.href = '#';
      a.append(el('strong', '', rows[0].name));
      for (const b of rows) a.append(el('span', 'bl-snip', b.snippet));
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openResult({ path, line: rows[0].line });
      });
      sec.append(a);
    }
    preview.append(sec);
  }

  // [[links]] to notes that don't exist yet are dimmed.
  async function markWikiLinks() {
    if (!preview.querySelector('a.wikilink')) return;
    const targets = [...new Set([...preview.querySelectorAll('a.wikilink')].map((a) => a.dataset.wiki))];
    const r = await api.notesResolve({ file: C.getDocPath(), targets });
    if (!r || !r.map) return;
    for (const a of preview.querySelectorAll('a.wikilink')) {
      const hit = r.map[a.dataset.wiki];
      a.classList.toggle('missing', !hit);
      a.title = hit ? hit.split('/').pop() : 'Doesn’t exist yet — click to create it';
    }
  }

  // ======================= [[ autocomplete =======================
  const wikiEl = $('wiki');
  const wiki = { items: [], index: 0, from: 0, token: 0, names: null, file: undefined, at: 0, query: null };

  async function loadNames() {
    const file = C.getDocPath();
    if (wiki.names && wiki.file === file && Date.now() - wiki.at < 5000) return wiki.names;
    const r = await api.notesNames({ file });
    wiki.names = (r && r.names) || [];
    wiki.file = file;
    wiki.at = Date.now();
    return wiki.names;
  }

  const hideWiki = () => {
    wiki.token++;
    wikiEl.hidden = true;
    wiki.query = null;
  };

  function renderWiki() {
    wikiEl.replaceChildren(
      ...wiki.items.map((it, i) => {
        const li = el('li', i === wiki.index ? 'active' : '');
        li.setAttribute('role', 'option');
        const dir = it.rel.includes('/') ? it.rel.slice(0, it.rel.lastIndexOf('/')) : '';
        li.append(el('span', 'hint', '[[ ]]'), el('span', 'label', it.name), el('span', 'key', dir));
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          chooseWiki(i);
        });
        return li;
      })
    );
    wikiEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function updateWiki() {
    const q = isEdit() && editor.selectionStart === editor.selectionEnd ? N.wikiQuery(editor.value, editor.selectionStart) : null;
    if (!q) return hideWiki();
    const token = ++wiki.token;
    loadNames().then((names) => {
      if (token !== wiki.token) return;
      const items = N.filterNames(names, q.query);
      if (!items.length) return void (wikiEl.hidden = true);
      if (wiki.query !== q.query) wiki.index = 0;
      wiki.query = q.query;
      wiki.items = items;
      wiki.from = q.from;
      wiki.index = Math.min(wiki.index, items.length - 1);
      renderWiki();
      const { x, y } = C.caretXY(q.from);
      wikiEl.hidden = false;
      wikiEl.style.left = Math.max(8, Math.min(x, innerWidth - wikiEl.offsetWidth - 8)) + 'px';
      const below = y + wikiEl.offsetHeight > innerHeight - 8;
      wikiEl.style.top = (below ? Math.max(8, y - 28 - wikiEl.offsetHeight) : y) + 'px';
    });
  }

  function chooseWiki(i) {
    const it = wiki.items[i];
    if (!it) return;
    const ed = N.applyWikiChoice(editor.value, editor.selectionStart, wiki.from, it.name);
    hideWiki();
    C.applyEdit(ed);
  }

  editor.addEventListener(
    'keydown',
    (e) => {
      if (wikiEl.hidden || e.isComposing || e.keyCode === 229) return;
      const n = wiki.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') wiki.index = (wiki.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n, renderWiki();
      else if (e.key === 'Enter' || e.key === 'Tab') chooseWiki(wiki.index);
      else if (e.key === 'Escape') hideWiki();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );
  editor.addEventListener('input', updateWiki);
  editor.addEventListener('blur', hideWiki);
  editor.addEventListener('click', hideWiki);

  // ======================= hooks into the app =======================
  hooks.input.push(() => {
    if (find.open && isEdit()) later(() => run({ keep: true }));
    outlineSoon();
  });
  hooks.render.push(() => {
    if (find.open && !isEdit()) run({ keep: true });
    markWikiLinks();
    appendBacklinks();
    if (!side.hidden && sideTab === 'outline') outlineSoon();
  });
  hooks.mode.push(() => {
    hideWiki();
    ys = null;
    if (find.open) run();
    later(() => {
      paintOverlay();
      markActive();
    });
  });
  hooks.doc.push(() => {
    ys = null;
    if (find.open) run();
    if (!side.hidden) paintSide();
  });
  addEventListener('resize', () => {
    ys = null;
    paintOverlay();
  });
  addEventListener('focus', () => {
    if (!isEdit()) {
      markWikiLinks();
      appendBacklinks();
    }
    if (side.hidden) return;
    if (sideTab === 'search') runSearch();
    else if (sideTab === 'links') paintLinks();
  });
})();
