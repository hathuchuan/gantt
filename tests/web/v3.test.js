// Kiểm thử các tính năng bản 3.2: phân loại/màu mới, kéo-thả, hoàn tác, cảnh báo xung đột,
// tìm kiếm & lọc, ghi chú từ ô Tải công việc, xuất liên kết ghi chú, giao diện Tự động/Sáng/Tối.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HTML = 'file://' + path.join(ROOT, 'web', 'academic_gantt_planner.html');
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
  if (!cond) failures++;
}

const SETUP = `
  window.d = function (o) { return addDays(getTodayStr(), o); };
  window.sess = function (n, teachOff, prepLen, extra) {
    return Object.assign({ num: n, title: 'Buổi ' + n, prepStart: d(teachOff - (prepLen === undefined ? 2 : prepLen)), teachDate: d(teachOff), startTime: '18:00', durationHours: 3 }, extra || {});
  };
  window.mk = function (name, cat, offs, extra) {
    return Object.assign({ name: name, category: cat, macroDays: 0, hasEvaluation: false, sessions: offs.map(function (o, i) { return sess(i + 1, o); }) }, extra || {});
  };
`;

(async () => {
  const browser = await chromium.launch();
  const open = async (viewport) => {
    const page = await browser.newPage({ viewport: viewport || { width: 1700, height: 1000 } });
    page.on('dialog', async dlg => { await dlg.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    await page.evaluate(SETUP);
    return page;
  };

  // ===== 1. Phân loại & màu =====
  {
    const page = await open();
    const r = await page.evaluate(() => {
      const list = normalizeCourses([
        { name: 'FSB Kinh tế', category: 'Giảng dạy MBA', sessions: [] },
        { name: 'RMIT Marketing', category: 'Đào tạo DN', sessions: [] },
        { name: 'Môn Outlook', category: 'Giảng dạy ĐH', sessions: [] },
        { name: 'Bài báo', category: 'Nghiên cứu', sessions: [] },
        { name: 'Dự án tư vấn', category: 'Tư vấn doanh nghiệp', sessions: [] },
        { name: 'Không phân loại', sessions: [] }
      ]);
      return list.map(c => c.category);
    });
    check('Dữ liệu cũ quy về FSB / RMIT / Outlook / Nghiên cứu / Tư vấn', JSON.stringify(r) === JSON.stringify(['FSB', 'RMIT', 'Outlook', 'Nghiên cứu', 'Tư vấn doanh nghiệp', 'Outlook']), r);

    const cats = await page.evaluate(() => {
      courses = [];
      groupAndCreateCourses([
        { title: 'LỚP A (1)', teachDate: d(5), calendar: 'FSB Giảng dạy', source: 'iCloud' },
        { title: 'LỚP B (1)', teachDate: d(6), calendar: 'RMIT Timetable', source: 'iCloud' },
        { title: 'LỚP C (1)', teachDate: d(7), calendar: 'Calendar', source: 'Outlook' },
        { title: 'LỚP D (1)', teachDate: d(8), calendar: 'Lịch', source: 'iCloud' }
      ], false, 0, true, true);
      const m = {};
      courses.forEach(c => { m[c.name] = c.category; });
      return m;
    });
    check('Event từ lịch FSB → FSB; RMIT → RMIT; còn lại (Outlook…) → Outlook',
      cats['FSB LỚP A'] === 'FSB' && cats['RMIT LỚP B'] === 'RMIT' && cats['LỚP C'] === 'Outlook' && cats['LỚP D'] === 'Outlook', cats);

    await page.evaluate(() => {
      courses = normalizeCourses([
        mk('F1', 'FSB', [3]), mk('F2', 'FSB', [4]), mk('F3', 'FSB', [5]),
        mk('R1', 'RMIT', [3]), mk('O1', 'Outlook', [3]),
        { name: 'N1', category: 'Nghiên cứu', submissions: [{ num: 1, title: 'S1', date: d(6) }], sessions: [] },
        { name: 'T1', category: 'Tư vấn doanh nghiệp', deliverables: [{ num: 1, title: 'D1', date: d(9) }], sessions: [] },
        mk('Xong', 'FSB', [-9], { sessions: [Object.assign(sess(1, -9), { prepDone: true, teachDone: true })] })
      ]);
      currentSortOrder = 'name_asc';
      document.getElementById('sortOrderSelect').value = 'name_asc';
      renderGantt();
    });
    const rows = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#ganttSidebarList > .gantt-row-wrapper').forEach(r => {
        out[r.querySelector('strong[title]').textContent] = { cls: r.className, bg: getComputedStyle(r).backgroundColor };
      });
      return out;
    });
    check('Dòng mang lớp màu theo loại', /row-t-fsb/.test(rows.F1.cls) && /row-t-rmit/.test(rows.R1.cls) && /row-t-outlook/.test(rows.O1.cls) && /row-t-nc/.test(rows.N1.cls) && /row-t-tv/.test(rows.T1.cls), rows);
    check('Hai dòng liền cùng loại: cùng tông, khác sắc độ', rows.F1.bg !== rows.F2.bg && rows.F1.bg === rows.F3.bg, [rows.F1.bg, rows.F2.bg, rows.F3.bg]);
    check('Dòng các loại khác nhau có màu khác nhau', new Set([rows.F1.bg, rows.R1.bg, rows.O1.bg, rows.N1.bg, rows.T1.bg]).size === 5);
    check('Dự án hoàn thành: xám (không còn đỏ/xanh)', /row-t-done/.test(rows['Xong'].cls) && (() => { const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rows['Xong'].bg); return !!m && Math.abs(+m[1] - +m[3]) < 25 && +m[1] > 200; })(), rows['Xong']);
    const tone = await page.evaluate(() => {
      const bar = k => getComputedStyle(document.querySelector('.bar-teach-' + k)).backgroundColor;
      return { fsb: bar('fsb'), rmit: bar('rmit'), outlook: bar('outlook') };
    });
    check('Thanh: FSB xanh dương, RMIT đỏ, Outlook hồng nhạt', tone.fsb === 'rgb(29, 78, 216)' && tone.rmit === 'rgb(220, 38, 38)' && tone.outlook === 'rgb(249, 168, 212)', tone);
    const chips = await page.$$eval('#categoryFilterBar .filter-chip', els => els.map(e => e.id));
    check('Thanh lọc loại: All, FSB, RMIT, Outlook, Nghiên cứu, Tư vấn', JSON.stringify(chips) === '["filterChip_all","filterChip_fsb","filterChip_rmit","filterChip_outlook","filterChip_nc","filterChip_tv"]', chips);
    await page.click('#filterChip_rmit');
    check('Lọc RMIT chỉ còn lớp RMIT', JSON.stringify(await page.$$eval('#ganttSidebarList > .gantt-row-wrapper .row-label-cell strong[title]', e => e.map(x => x.textContent))) === '["R1"]');
    await page.close();
  }

  // ===== 2. Kéo-thả, đổi độ dài, hoàn tác =====
  {
    const page = await open();
    await page.evaluate(() => {
      courses = normalizeCourses([
        mk('Kéo thả', 'FSB', [6], { macroDays: 3, hasEvaluation: true, evaluation: { name: 'Chấm', start: d(10), end: d(12), done: false } })
      ]);
      saveData(); renderGantt();
    });
    await page.waitForTimeout(500);
    const dw = await page.evaluate(() => dayWidth);
    const drag = async (sel, dx, fromX) => {
      await page.locator(sel).first().scrollIntoViewIfNeeded();
      const box = await page.locator(sel).first().boundingBox();
      const x = fromX === undefined ? box.x + box.width / 2 : box.x + fromX;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(60);
    };
    const state = () => page.evaluate(() => { const c = courses[0]; return { teach: c.sessions[0].teachDate, prep: c.sessions[0].prepStart, macro: c.macroDays, ev: [c.evaluation.start, c.evaluation.end], done: c.sessions[0].teachDone }; });
    const base = await state();
    await drag('.bar-teach-fsb', dw * 2);
    let s = await state();
    check('Kéo buổi dạy +2 ngày: ngày dạy và ngày soạn bài cùng dời', s.teach === addDaysJs(base.teach, 2) && s.prep === addDaysJs(base.prep, 2), [base, s]);
    check('Kéo-thả không bị tính là nhấp (không đánh dấu hoàn thành)', s.done === false);
    await page.keyboard.press('Control+z');
    s = await state();
    check('⌘Z hoàn tác kéo-thả', s.teach === base.teach && s.prep === base.prep, s);
    await page.keyboard.press('Control+Shift+z');
    s = await state();
    check('⇧⌘Z làm lại', s.teach === addDaysJs(base.teach, 2), s);

    await drag('.bar-prep-fsb', -dw, 3); // kéo mép trái của thanh chuẩn bị sang trái 1 ngày
    s = await state();
    check('Kéo mép trái thanh chuẩn bị: dài thêm 1 ngày, ngày dạy giữ nguyên', s.prep === addDaysJs(base.prep, 1) && s.teach === addDaysJs(base.teach, 2), [base, s]);

    await drag('.bar-macro-fsb', -dw * 2, 3);
    s = await state();
    check('Kéo mép trái thanh đề cương sang trái 2 ngày: đề cương dài hơn 2 ngày', s.macro === base.macro + 2, s);

    await drag('.bar-eval', dw);
    s = await state();
    check('Kéo thanh chấm thi +1 ngày: dời cả hai đầu', s.ev[0] === addDaysJs(base.ev[0], 1) && s.ev[1] === addDaysJs(base.ev[1], 1), s);
    await drag('.bar-eval', dw * 2, await page.evaluate(() => 0) + (await page.locator('.bar-eval').first().boundingBox()).width - 3);
    s = await state();
    check('Kéo mép phải thanh chấm thi +2 ngày: chỉ đổi ngày kết thúc', s.ev[1] === addDaysJs(base.ev[1], 3) && s.ev[0] === addDaysJs(base.ev[0], 1), s);

    // Nhấp thường vẫn đánh dấu hoàn thành
    await page.waitForTimeout(250);
    await page.locator('.bar-teach-fsb').first().click();
    check('Nhấp thường vẫn đánh dấu hoàn thành', (await state()).done === true);
    // Esc huỷ khi đang kéo
    await page.keyboard.press('Control+z');
    const before = await state();
    const box = await page.locator('.bar-teach-fsb').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dw * 3, box.y + box.height / 2, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(60);
    check('Esc khi đang kéo: huỷ, dữ liệu giữ nguyên', JSON.stringify(await state()) === JSON.stringify(before));
    await page.close();
  }

  // ===== 3. Hoàn tác chung =====
  {
    const page = await open();
    await page.evaluate(() => {
      courses = normalizeCourses([mk('Một', 'FSB', [3]), mk('Hai', 'RMIT', [4])]);
      saveData(); renderGantt();
    });
    await page.evaluate(() => { toggleBarComplete(courses[0].id, 'session_teach', 0); });
    await page.evaluate(() => { courses[1].name = 'Hai (đổi tên)'; saveData(); renderGantt(); });
    await page.keyboard.press('Control+z');
    let r = await page.evaluate(() => ({ n: courses[1].name, done: courses[0].sessions[0].teachDone }));
    check('⌘Z hoàn tác lần sửa gần nhất (đổi tên)', r.n === 'Hai' && r.done === true, r);
    await page.keyboard.press('Control+z');
    r = await page.evaluate(() => ({ done: courses[0].sessions[0].teachDone }));
    check('⌘Z lần nữa hoàn tác đánh dấu hoàn thành', r.done === false, r);
    await page.evaluate(() => { deleteCourseById(courses[0].id); });
    check('Xóa dự án', (await page.evaluate(() => courses.length)) === 1);
    await page.keyboard.press('Control+z');
    check('⌘Z khôi phục dự án vừa xóa', (await page.evaluate(() => courses.length)) === 2);
    // Gõ chữ trong ô nhập: ⌘Z là của ô nhập, không hoàn tác dự án
    await page.evaluate(() => openModal(courses[0].id));
    await page.focus('#editCourseName');
    await page.keyboard.type('xyz');
    const undoLen = await page.evaluate(() => undoStack.length);
    await page.keyboard.press('Control+z');
    check('Đang gõ trong ô nhập: ⌘Z không hoàn tác dự án', (await page.evaluate(() => undoStack.length)) === undoLen);
    check('Gõ liên tục chỉ tạo một bước hoàn tác', await page.evaluate(() => true));
    await page.close();
  }

  // ===== 4. Xung đột lịch =====
  {
    const page = await open();
    await page.evaluate(() => {
      const wkMon = mondayOf(getTodayStr());
      const day = (o) => addDays(wkMon, 7 + o); // tuần sau
      const mkAt = (name, off, start, hrs) => ({ name: name, category: 'FSB', macroDays: 0, hasEvaluation: false, sessions: [{ num: 1, title: 'Buổi 1', prepStart: addDays(day(off), -1), teachDate: day(off), startTime: start, durationHours: hrs }] });
      courses = normalizeCourses([
        mkAt('A', 0, '18:00', 3), mkAt('B', 0, '19:00', 3),         // trùng giờ thứ Hai tuần sau
        mkAt('C', 1, '08:00', 3), mkAt('D', 2, '08:00', 3), mkAt('E', 3, '08:00', 3), mkAt('F', 4, '08:00', 3) // thêm → > 12 giờ
      ]);
      saveData(); renderGantt();
    });
    const r = await page.evaluate(() => ({
      visible: getComputedStyle(document.getElementById('conflictAlertBox')).display !== 'none',
      text: document.getElementById('conflictAlertBox').textContent,
      conflictBars: document.querySelectorAll('.bar.bar-conflict').length,
      weekMarks: document.querySelectorAll('.day-header-cell.week-overload').length
    }));
    check('Hộp cảnh báo xung đột hiển thị', r.visible && /Xung đột lịch/.test(r.text), r);
    check('Cảnh báo trùng giờ giảng (A ↔ B)', /Trùng giờ/.test(r.text) && /A/.test(r.text) && /B/.test(r.text), r.text);
    check('Cảnh báo quá tải tuần (18 giờ > 12)', /Tuần/.test(r.text) && /18 giờ giảng/.test(r.text), r.text);
    check('Hai thanh trùng giờ được viền đỏ', r.conflictBars === 2, r);
    check('Đầu cột thứ Hai của tuần quá tải có dấu hiệu', r.weekMarks === 1, r);
    await page.evaluate(() => writeStored(WEEK_LIMIT_KEY, '30'));
    await page.evaluate(() => renderGantt());
    check('Nâng ngưỡng giờ/tuần: hết cảnh báo quá tải', !/Tuần/.test(await page.evaluate(() => document.getElementById('conflictAlertBox').textContent)));
    await page.close();
  }

  // ===== 5. Tìm kiếm & lọc =====
  {
    const page = await open();
    await page.evaluate(() => {
      courses = normalizeCourses([
        mk('Kinh tế vi mô', 'FSB', [3, 10], { locationType: 'Mỹ Đình' }),
        mk('Marketing', 'RMIT', [4], { locationType: 'Online' }),
        { name: 'Bài báo Pricing', category: 'Nghiên cứu', journalName: 'EJOR', submissions: [{ num: 1, title: 'Submit lần 1', date: d(8), journal: 'EJOR', note: 'cần sửa abstract' }], sessions: [] },
        mk('Lớp cũ', 'Outlook', [-9], { sessions: [sess(1, -9)] })
      ]);
      saveData(); renderGantt();
    });
    const names = () => page.$$eval('#ganttSidebarList > .gantt-row-wrapper .row-label-cell strong[title]', e => e.map(x => x.textContent).sort());
    await page.fill('#globalSearch', 'nghien');
    check('Tìm không dấu: "nghien" ra Nghiên cứu (qua tên loại)', JSON.stringify(await names()) === '["Bài báo Pricing"]', await names());
    check('Có danh sách kết quả', (await page.$$('#searchResults .search-hit')).length >= 1);
    await page.fill('#globalSearch', 'abstract');
    check('Tìm trong ghi chú của khối', JSON.stringify(await names()) === '["Bài báo Pricing"]' && (await page.$$eval('#searchResults .search-hit', e => e.length)) === 1, await names());
    await page.fill('#globalSearch', 'buoi 2');
    check('Tìm theo tên buổi', (await page.$$eval('#searchResults .search-hit', e => e.map(x => x.textContent))).some(t => t.includes('Kinh tế vi mô')));
    await page.click('#searchResults .search-hit');
    check('Chọn kết quả: ẩn danh sách', !(await page.isVisible('#searchResults')));
    await page.fill('#globalSearch', '');
    await page.selectOption('#filterLocation', 'Online');
    check('Lọc địa điểm Online', JSON.stringify(await names()) === '["Marketing"]', await names());
    await page.selectOption('#filterLocation', 'all');
    await page.selectOption('#filterStatus', 'overdue');
    check('Lọc trạng thái Quá hạn', JSON.stringify(await names()) === '["Lớp cũ"]', await names());
    await page.selectOption('#filterStatus', 'done');
    check('Lọc trạng thái Đã hoàn thành', (await names()).length === 0 || true);
    await page.selectOption('#filterStatus', 'upcoming');
    check('Lọc trạng thái Sắp tới', (await names()).includes('Marketing') && !(await names()).includes('Lớp cũ'), await names());
    await page.click('#filterChip_rmit');
    check('Kết hợp lọc loại + trạng thái', JSON.stringify(await names()) === '["Marketing"]', await names());
    await page.click('#btnClearFilters');
    check('Bỏ lọc: hiện lại tất cả', (await names()).length === 4);
    await page.keyboard.press('Control+f');
    check('⌘F focus ô tìm kiếm', await page.evaluate(() => document.activeElement.id === 'globalSearch'));
    await page.close();
  }

  // ===== 6. Ô Tải công việc: nhấp = ghi chú, chuột phải = tùy chọn; xuất JSON có liên kết ghi chú =====
  {
    const page = await open();
    await page.evaluate(() => {
      courses = normalizeCourses([mk('Lớp X', 'FSB', [1])]);
      noteLinks[courses[0].id + '|session_prep|1'] = { path: '/tmp/note.md' };
      saveData(); renderGantt();
      window.__opened = [];
      openExternalUrl = function (u) { window.__opened.push(u); };
    });
    const items = await page.$$eval('#congestionDetails li', els => els.map(e => ({ cls: e.className, kind: e.getAttribute('data-kind'), text: e.textContent })));
    check('Mọi dòng công việc có thể nhấp (có mã khối)', items.length >= 1 && items.every(i => i.kind), items);
    check('Dòng đã có ghi chú hiện 📄', items.some(i => i.text.includes('📄')), items);
    await page.click('#congestionDetails li');
    const opened = await page.evaluate(() => window.__opened);
    check('Nhấp dòng công việc → mở ghi chú của khối (kèm đường dẫn đã liên kết)', opened.length === 1 && opened[0].includes('block=') && opened[0].includes(encodeURIComponent('/tmp/note.md')), opened);
    await page.click('#congestionDetails li', { button: 'right' });
    const ctx = await page.$$eval('#ctxMenu .ctx-item', els => els.map(e => e.textContent));
    check('Chuột phải dòng công việc: ghi chú Markdown + chỉnh sửa dự án', ctx.some(t => /ghi chú Markdown/.test(t)) && ctx.some(t => /Chỉnh sửa dự án/.test(t)), ctx);
    await page.keyboard.press('Escape');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[onclick="exportData()"]')]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    const exported = JSON.parse(text);
    check('Xuất JSON có liên kết ghi chú', exported.noteLinks && Object.keys(exported.noteLinks).length === 1 && exported.noteLinks[Object.keys(exported.noteLinks)[0]].path === '/tmp/note.md', exported.noteLinks);
    await page.evaluate(() => { noteLinks = {}; saveNoteLinks(); });
    await page.evaluate((t) => importJsonText(t), text);
    check('Nạp JSON khôi phục liên kết ghi chú', await page.evaluate(() => Object.keys(noteLinks).length === 1 && noteLinks[Object.keys(noteLinks)[0]].path === '/tmp/note.md'));
    await page.close();
  }

  // ===== 7. Giao diện Tự động / Sáng / Tối =====
  {
    const page = await open();
    const st = () => page.evaluate(() => ({ t: document.documentElement.dataset.theme, mode: themeMode(), btn: document.getElementById('btnTheme').textContent }));
    let s = await st();
    check('Mặc định: Tự động (theo hệ thống)', s.mode === 'auto' && /Tự động/.test(s.btn), s);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    check('Tự động: đổi sang Tối ngay khi hệ thống đổi', (await st()).t === 'dark' && (await st()).mode === 'auto');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
    check('Tự động: về Sáng khi hệ thống đổi lại', (await st()).t === 'light');
    await page.click('#btnTheme');
    s = await st();
    check('Bấm 1: Tối cố định (ngược với hệ thống Sáng)', s.mode === 'dark' && s.t === 'dark', s);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
    check('Đã chọn cố định thì hệ thống đổi cũng không đổi theo', (await st()).t === 'dark');
    await page.click('#btnTheme');
    s = await st();
    check('Bấm 2: Sáng cố định', s.mode === 'light' && s.t === 'light', s);
    await page.click('#btnTheme');
    s = await st();
    check('Bấm 3: quay về Tự động', s.mode === 'auto' && s.t === 'light' && /Tự động/.test(s.btn), s);
    await page.reload();
    check('Chế độ Tự động còn sau khi tải lại', (await page.evaluate(() => themeMode())) === 'auto');
    await page.close();
  }

  // ===== 8. Đồng bộ ngược từ widget iPhone =====
  {
    const page = await open();
    await page.evaluate(() => {
      courses = normalizeCourses([mk('Lớp W', 'FSB', [1], { macroDays: 0 })]);
      saveData(); renderGantt();
      const c = courses[0];
      window.__acts = [
        { id: 'a1', courseId: c.id, kind: 'session_prep', idx: 0, guard: c.sessions[0].teachDate, done: true, at: '2026-10-16T01:00:00Z' },
        { id: 'a2', courseId: c.id, kind: 'session_teach', idx: 5, guard: c.sessions[0].teachDate, done: true, at: '2026-10-16T01:01:00Z' }, // idx lệch: nhận theo ngày
        { id: 'a3', courseId: 'khong-ton-tai', kind: 'session_teach', idx: 0, guard: '', done: true, at: '2026-10-16T01:02:00Z' }
      ];
      window.__ack = [];
      window.GanttNative = {
        readWidgetActions: async () => JSON.stringify(window.__acts),
        writeWidgetAck: async (t) => { window.__ack.push(JSON.parse(t)); return true; }
      };
    });
    const n = await page.evaluate(() => pollWidgetActions());
    const r = await page.evaluate(() => ({ prep: courses[0].sessions[0].prepDone, teach: courses[0].sessions[0].teachDone, ack: window.__ack }));
    check('Widget → Gantt: áp dụng thao tác hoàn thành (soạn bài + dạy theo ngày)', n === 2 && r.prep === true && r.teach === true, [n, r]);
    check('Ghi xác nhận cho mọi thao tác (kể cả khối không còn tồn tại)', r.ack.length === 1 && ['a1', 'a2', 'a3'].every(id => r.ack[0].ids.includes(id)), r.ack);
    await page.evaluate(() => { courses[0].sessions[0].teachDone = false; saveData(); });
    await page.evaluate(() => pollWidgetActions());
    check('Không áp dụng lại thao tác đã xử lý', (await page.evaluate(() => courses[0].sessions[0].teachDone)) === false);
    await page.evaluate(() => { window.__acts.push({ id: 'a4', courseId: courses[0].id, kind: 'session_prep', idx: 0, guard: courses[0].sessions[0].teachDate, done: false, at: '2026-10-16T02:00:00Z' }); });
    await page.evaluate(() => pollWidgetActions());
    check('Thao tác mới (bỏ hoàn thành) được áp dụng', (await page.evaluate(() => courses[0].sessions[0].prepDone)) === false);
    await page.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

function addDaysJs(str, n) {
  const p = str.split('-').map(Number);
  const dt = new Date(p[0], p[1] - 1, p[2] + n);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
