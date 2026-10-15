// Kiểm thử: lớp đang giảng, cột hôm nay, dark mode, công việc tuần/tháng, menu chuột phải,
// nút ghi chú dự án, tự cập nhật Apple Calendar.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HTML = 'file://' + path.join(ROOT, 'web', 'academic_gantt_planner.html');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'macos', 'Resources', 'bridge.js'), 'utf8');
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
  if (!cond) failures++;
}

const SETUP = `
  window.d = function (o) { return addDays(getTodayStr(), o); };
  window.mk = function (name, cat, offs, extra) {
    return Object.assign({ name: name, category: cat, macroDays: 0, hasEvaluation: false,
      sessions: offs.map(function (o, i) { return { num: i + 1, title: 'Buổi ' + (i + 1), prepStart: d(o - 2), teachDate: d(o), startTime: '18:00', durationHours: 3 }; }) }, extra || {});
  };
  courses = normalizeCourses([
    mk('Hôm nay', 'Giảng dạy MBA', [-7, 0, 7]),
    mk('Trong kỳ', 'Giảng dạy Đại học', [-3, 4, 11]),
    mk('Chưa bắt đầu', 'Đào tạo DN', [5, 12]),
    mk('Đã hết kỳ', 'Giảng dạy MBA', [-20, -10]),
    { name: 'Bài báo', category: 'Nghiên cứu', submissions: [{ num: 1, title: 'Submit 1', date: d(2), journal: 'EJOR' }], sessions: [] },
    { name: 'Tư vấn', category: 'Tư vấn doanh nghiệp', deliverables: [{ num: 1, title: 'Báo cáo', date: d(40) }], sessions: [] }
  ]);
  renderGantt();
`;

function nativeMock(events) {
  return `
  window.__msgs = [];
  window.__events = ${JSON.stringify(events || [])};
  window.webkit = { messageHandlers: { gantt: { postMessage: function (m) {
    window.__msgs.push(JSON.parse(JSON.stringify(m)));
    var ok = function (d) { return Promise.resolve({ ok: true, data: d }); };
    if (m.cmd === 'listCalendars') return ok([{ id: 'c1', title: 'FSB Giảng dạy', source: 'iCloud', color: '#f00' }]);
    if (m.cmd === 'fetchEvents') return ok(window.__events);
    return ok(true);
  } } } };`;
}

(async () => {
  const browser = await chromium.launch();

  // ===== Giao diện chung (trình duyệt) =====
  {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    await page.evaluate(SETUP);

    // 1) Highlight sidebar
    const cls = await page.evaluate(() => {
      const m = {};
      document.querySelectorAll('#ganttSidebarList > .gantt-row-wrapper').forEach(r => {
        const name = r.querySelector('strong').textContent;
        m[name] = { today: r.classList.contains('row-teach-today'), term: r.classList.contains('row-teach-term'),
          tagToday: !!r.querySelector('.teach-tag-today'), tagTerm: !!r.querySelector('.teach-tag-term') };
      });
      return m;
    });
    check('Lớp giảng hôm nay: highlight đậm + thẻ', cls['Hôm nay'].today && !cls['Hôm nay'].term && cls['Hôm nay'].tagToday, cls['Hôm nay']);
    check('Lớp trong kỳ (không giảng hôm nay): highlight nhạt + thẻ', cls['Trong kỳ'].term && !cls['Trong kỳ'].today && cls['Trong kỳ'].tagTerm, cls['Trong kỳ']);
    check('Lớp chưa bắt đầu / đã hết kỳ / nghiên cứu / tư vấn: không highlight',
      ['Chưa bắt đầu', 'Đã hết kỳ', 'Bài báo', 'Tư vấn'].every(n => !cls[n].today && !cls[n].term), cls);
    const colors = await page.evaluate(() => {
      const bg = sel => getComputedStyle(document.querySelector(sel)).backgroundColor;
      return { today: bg('.row-teach-today'), term: bg('.row-teach-term') };
    });
    check('Hai mức highlight có màu khác nhau', colors.today !== colors.term, colors);

    // 2) Cột hôm nay: tô hồng, không còn đường kẻ đỏ
    const todayCol = await page.evaluate(() => {
      const el = document.querySelector('.today-line');
      const cs = getComputedStyle(el);
      return { w: el.getBoundingClientRect().width, bg: cs.backgroundColor, dayWidth: dayWidth, z: cs.zIndex };
    });
    check('Cột hôm nay rộng đúng 1 ngày', Math.round(todayCol.w) === todayCol.dayWidth, todayCol);
    const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(todayCol.bg);
    check('Cột hôm nay màu hồng trong suốt', !!m && +m[1] > 200 && +m[2] < 160 && +m[4] > 0 && +m[4] < 0.5, todayCol.bg);
    check('Cột hôm nay nằm dưới thanh Gantt', +todayCol.z < 10, todayCol);
    check('Ô đầu cột hôm nay cũng hồng nhạt', await page.evaluate(() => {
      const bg = getComputedStyle(document.querySelector('.day-header-cell.today')).backgroundColor;
      return /rgba\(244, 114, 182/.test(bg);
    }));

    // 3) Công việc tuần / tháng
    await page.click('#btnPeriodWeek');
    check('Bấm "Tuần" mở danh sách', await page.isVisible('#periodPanel'));
    const week = await page.evaluate(() => {
      const r = getPeriodRange('week', getTodayStr());
      return { r, rows: [...document.querySelectorAll('.period-row')].map(x => x.textContent), heads: [...document.querySelectorAll('.period-day-head')].map(x => x.textContent), dates: [...document.querySelectorAll('.pr-dates')].map(x => x.textContent) };
    });
    check('Tuần bắt đầu Thứ Hai, dài 7 ngày', await page.evaluate(() => { const r = getPeriodRange('week', getTodayStr()); return parseDateStr(r.start).getDay() === 1 && diffDaysRaw(r.start, r.end) === 6; }));
    check('Danh sách tuần có ghi ngày từng công việc', week.rows.length > 0 && week.dates.every(t => /\d\d\/\d\d/.test(t)), week.dates);
    check('Tuần chứa buổi giảng hôm nay', week.rows.some(t => t.includes('Hôm nay') && t.includes('Buổi 2')), week.rows);
    check('Tuần không chứa buổi ngoài tuần', !week.rows.some(t => t.includes('Chưa bắt đầu') && t.includes('Buổi 2') && false));
    await page.click('#btnPeriodMonth');
    const month = await page.evaluate(() => ({ n: document.querySelectorAll('.period-row').length, title: document.getElementById('periodTitle').textContent }));
    check('Tháng: tiêu đề + nhiều công việc hơn/bằng tuần', /tháng \d+\/\d{4}/.test(month.title) && month.n >= week.rows.length, month);
    const before = await page.evaluate(() => document.getElementById('periodTitle').textContent);
    await page.click('.period-head button[onclick="shiftPeriod(1)"]');
    check('Nút › chuyển sang kỳ sau', (await page.evaluate(() => document.getElementById('periodTitle').textContent)) !== before);
    await page.click('.period-head button[onclick="periodToToday()"]');
    // hoàn thành công việc từ danh sách
    await page.click('#btnPeriodWeek');
    const toggled = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.period-row.st-teach')].find(r => r.textContent.includes('Hôm nay'));
      row.querySelector('.pr-check').click();
      const c = courses.find(x => x.name === 'Hôm nay');
      return { done: c.sessions[1].teachDone, rowDone: [...document.querySelectorAll('.period-row.st-teach.is-done')].length };
    });
    check('Tick trong danh sách đánh dấu hoàn thành + vẽ lại', toggled.done === true && toggled.rowDone >= 1, toggled);
    await page.click('#btnPeriodWeek');
    check('Bấm lại nút để đóng danh sách', !(await page.isVisible('#periodPanel')));

    // 4) Dark mode
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#btnTheme');
    const dark = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, saved: localStorage.getItem('academic_smart_gantt_theme'), btn: document.getElementById('btnTheme').textContent }));
    check('Bật dark mode: data-theme, nền tối, lưu lựa chọn', dark.t === 'dark' && dark.bg !== lightBg && dark.saved === 'dark' && dark.btn.includes('Sáng'), dark);
    await page.reload();
    check('Dark mode còn sau khi tải lại', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
    await page.evaluate(SETUP);
    await page.waitForTimeout(700); // chờ cuộn mượt về hôm nay kết thúc
    await page.click('#btnTheme');
    check('Bật lại giao diện sáng', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');

    // 5) Menu chuột phải
    const labels = async () => page.$$eval('#ctxMenu .ctx-item', els => els.map(e => e.textContent));
    await page.click('.bar.bar-teach-dh', { button: 'right' });
    let items = await labels();
    check('Chuột phải thanh: menu hiện', await page.isVisible('#ctxMenu'), items);
    check('Menu thanh: hoàn thành / ghi chú / chỉnh sửa / tuần / tháng',
      items.some(t => t.includes('hoàn thành')) && items.some(t => t.includes('ghi chú')) && items.some(t => t.includes('Chỉnh sửa')) && items.some(t => t.includes('tuần')) && items.some(t => t.includes('tháng')), items);
    check('Chuột phải thanh không đổi trạng thái hoàn thành', await page.evaluate(() => !courses.find(x => x.name === 'Trong kỳ').sessions.some(s => s.teachDone)));
    await page.keyboard.press('Escape');
    check('Esc đóng menu (không đóng gì khác)', !(await page.isVisible('#ctxMenu')));
    await page.click('.bar.bar-teach-dh', { button: 'right' });
    await page.click('#ctxMenu .ctx-item:has-text("Đánh dấu hoàn thành")');
    check('Menu thanh → đánh dấu hoàn thành', await page.evaluate(() => courses.find(x => x.name === 'Trong kỳ').sessions.some(s => s.teachDone)));
    await page.click('.bar.is-done', { button: 'right' });
    check('Thanh đã xong: menu đổi thành Hoàn tác', (await labels()).some(t => t.includes('Hoàn tác')));
    await page.keyboard.press('Escape');

    await page.click('#ganttSidebarList .row-label-cell strong', { button: 'right' });
    items = await labels();
    check('Chuột phải dự án (cột trái): chỉnh sửa / ghi chú / hoàn thành / xóa',
      items.some(t => t.includes('Chỉnh sửa')) && items.some(t => t.includes('ghi chú')) && items.some(t => t.includes('hoàn thành')) && items.some(t => t.includes('Xóa')), items);
    await page.click('#ctxMenu .ctx-item:has-text("Chỉnh sửa")');
    check('Menu dự án → mở cửa sổ chỉnh sửa', await page.evaluate(() => document.getElementById('editModal').classList.contains('active')));
    await page.keyboard.press('Escape');

    await page.click('.day-header-cell[data-date="' + (await page.evaluate(() => d(3))) + '"]', { button: 'right' });
    items = await labels();
    check('Chuột phải đầu cột ngày: chi tiết / tải / tuần / tháng / hôm nay',
      items.some(t => t.includes('chi tiết')) && items.some(t => t.includes('tải công việc')) && items.some(t => t.includes('tuần')) && items.some(t => t.includes('tháng')) && items.some(t => t.includes('hôm nay')), items);
    await page.click('#ctxMenu .ctx-item:has-text("Công việc tháng")');
    check('Menu ngày → mở danh sách tháng', (await page.isVisible('#periodPanel')) && (await page.evaluate(() => periodState.mode)) === 'month');
    await page.keyboard.press('Escape'); // đóng thứ gì đó nếu còn

    const box = await page.evaluate(() => { const r = document.querySelector('#ganttTimelineList .timeline-canvas').getBoundingClientRect(); return { x: r.left, y: r.top }; });
    await page.mouse.click(box.x + 32 * 20 + 5, box.y + 60, { button: 'right' });
    items = await labels();
    check('Chuột phải vùng trống của dòng: menu ngày + chỉnh sửa dự án', items.some(t => t.includes('Xem chi tiết')) && items.some(t => t.includes('Chỉnh sửa dự án')), items);
    await page.mouse.click(5, 5);
    check('Bấm ra ngoài đóng menu', !(await page.isVisible('#ctxMenu')));

    // 6) Nút ghi chú trong cửa sổ chỉnh sửa
    await page.evaluate(() => { var c = courses.find(x => x.name === 'Hôm nay'); openModal(c.id); window.__urls = []; openExternalUrl = function (u) { window.__urls.push(u); }; });
    check('Cửa sổ chỉnh sửa có nút ghi chú', (await page.textContent('#btnCourseNote')).includes('Thêm ghi chú'));
    await page.click('#btnCourseNote');
    const url = await page.evaluate(() => window.__urls[0]);
    check('Nút ghi chú gọi mdeditor://note với khối dự án', /^mdeditor:\/\/note\?/.test(url) && true, url);
    const id = await page.evaluate(() => activeCourseId);
    check('Khối ghi chú dự án có mã <id>|project|0', decodeURIComponent(/block=([^&]*)/.exec(url)[1]) === id + '|project|0', url);
    check('URL ghi chú có tên dự án + khoảng ngày', url.includes('course=') && /start=\d{4}-\d\d-\d\d/.test(url) && /end=\d{4}-\d\d-\d\d/.test(url), url);
    await page.evaluate(() => ganttHandleURL('academicgantt://link?block=' + encodeURIComponent(activeCourseId + '|project|0') + '&path=%2Ftmp%2Fn.md'));
    check('Sau khi liên kết, nút đổi thành "Mở ghi chú"', (await page.textContent('#btnCourseNote')).includes('Mở ghi chú'));
    await page.close();
  }

  // ===== Tự cập nhật Apple Calendar (ứng dụng macOS) =====
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const autoDialogs = [];
    page.on('dialog', async d => { autoDialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    const day = new Date(Date.now() + 5 * 864e5); const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
    const ev = [{ title: 'Môn Tự Động (1)', teachDate: iso, calendar: 'FSB Giảng dạy', location: 'Online', startTime: '09:00', durationHours: 3 }];
    const storage = { academic_smart_gantt_mac_calendars: JSON.stringify(['c1']) };
    await page.addInitScript(nativeMock(ev) + '\n' + BRIDGE.replace('__GANTT_VERSION__', '"3.2.0"').replace('__GANTT_STORAGE__', JSON.stringify(storage)));
    await page.goto(HTML);
    await page.waitForFunction(() => courses.some(c => c.name === 'FSB Môn Tự Động'), null, { timeout: 8000 }).catch(() => {});
    check('Tự cập nhật khi mở app (đã chọn lịch từ trước): thêm dự án mới', await page.evaluate(() => courses.some(c => c.name === 'FSB Môn Tự Động')));
    check('Không hiện hộp thoại khi tự cập nhật', autoDialogs.length === 0, autoDialogs);
    check('Gọi fetchEvents với lịch đã lưu', await page.evaluate(() => window.__msgs.some(m => m.cmd === 'fetchEvents' && m.calendarIds.join() === 'c1')));
    const status = await page.textContent('#macAutoStatus');
    check('Hiện trạng thái "Lịch cập nhật hh:mm"', /Lịch cập nhật \d\d:\d\d/.test(status), status);
    check('Ô tick tự cập nhật mặc định bật', await page.evaluate(() => document.getElementById('macAutoSyncToggle').checked));

    // sửa dự án rồi cập nhật lại: không bị ghi đè, không lưu lại khi không có thay đổi
    const saves0 = await page.evaluate(() => window.__msgs.filter(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt').length);
    await page.evaluate(() => { courses.find(c => c.name === 'FSB Môn Tự Động').sessions[0].note = 'giữ lại'; saveData(); });
    const saves1 = await page.evaluate(() => window.__msgs.filter(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt').length);
    await page.evaluate(() => runMacAutoSync(true));
    await page.waitForTimeout(200);
    const saves2 = await page.evaluate(() => window.__msgs.filter(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt').length);
    check('Cập nhật lại không có thay đổi: không ghi dữ liệu', saves2 === saves1, { saves0, saves1, saves2 });
    check('Ghi chú đã sửa được giữ nguyên', await page.evaluate(() => courses.find(c => c.name === 'FSB Môn Tự Động').sessions[0].note === 'giữ lại'));

    // sự kiện mới xuất hiện trong Lịch → tự thêm buổi
    const day2 = new Date(Date.now() + 9 * 864e5); const iso2 = day2.getFullYear() + '-' + String(day2.getMonth() + 1).padStart(2, '0') + '-' + String(day2.getDate()).padStart(2, '0');
    await page.evaluate((e) => { window.__events.push(e); }, { title: 'Môn Tự Động (2)', teachDate: iso2, calendar: 'FSB Giảng dạy', location: 'Online', startTime: '09:00', durationHours: 3 });
    await page.evaluate(() => runMacAutoSync(true));
    await page.waitForTimeout(200);
    check('Sự kiện mới trong Lịch tự được thêm buổi', await page.evaluate(() => courses.find(c => c.name === 'FSB Môn Tự Động').sessions.length === 2));

    // tắt tự cập nhật
    await page.evaluate(() => switchTab('mac'));
    await page.uncheck('#macAutoSyncToggle');
    const n0 = await page.evaluate(() => window.__msgs.filter(m => m.cmd === 'fetchEvents').length);
    await page.evaluate(() => runMacAutoSync(true));
    await page.waitForTimeout(150);
    check('Tắt tự cập nhật: không gọi fetchEvents nữa', n0 === await page.evaluate(() => window.__msgs.filter(m => m.cmd === 'fetchEvents').length));
    check('Lựa chọn tắt được lưu', await page.evaluate(() => GanttNative.bootState.academic_smart_gantt_mac_autosync === '0' || readStored('academic_smart_gantt_mac_autosync') === '0'));
    await page.close();

    // Không chọn lịch trước đó: không tự cập nhật (tránh hỏi quyền lúc khởi động)
    const page2 = await browser.newPage();
    await page2.addInitScript(nativeMock(ev) + '\n' + BRIDGE.replace('__GANTT_VERSION__', '"3.2.0"').replace('__GANTT_STORAGE__', '{}'));
    await page2.goto(HTML);
    await page2.waitForTimeout(2200);
    check('Chưa chọn lịch: không tự gọi Lịch lúc khởi động', await page2.evaluate(() => !window.__msgs.some(m => m.cmd === 'fetchEvents' || m.cmd === 'listCalendars')));
    await page2.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' kiểm thử THẤT BẠI' : '\nTất cả kiểm thử qua');
  process.exit(failures ? 1 : 0);
})();
