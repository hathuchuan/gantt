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

// Giả lập cầu nối macOS. files: nội dung trả về cho openTextFile theo phần mở rộng.
function mockScript(files) {
  return `
  window.__msgs = [];
  window.__files = ${JSON.stringify(files || {})};
  window.webkit = { messageHandlers: { gantt: { postMessage: function (m) {
    window.__msgs.push(JSON.parse(JSON.stringify(m)));
    var ok = function (d) { return Promise.resolve({ ok: true, data: d }); };
    if (m.cmd === 'openTextFile') {
      var ext = (m.extensions || [])[0];
      return ok(window.__files[ext] || false);
    }
    if (m.cmd === 'listCalendars') return ok([]);
    return ok(true);
  } } } };`;
}
function bridgeWith(storage) {
  return BRIDGE.replace('__GANTT_VERSION__', '"3.1.0"').replace('__GANTT_STORAGE__', JSON.stringify(storage));
}

function runSetup(page, code) { return page.evaluate('(function(){' + SETUP_COURSES + code + '})()'); }
const SETUP_COURSES = `
  function dstr(offset) { return addDays(getTodayStr(), offset); }
  function mk(name, extra, sessions) { return Object.assign({ name: name, category: 'Giảng dạy MBA', macroDays: 0, hasEvaluation: false, sessions: sessions }, extra); }
  function sess(n, prepOff, teachOff, done) { return { num: n, title: 'Buổi ' + n, prepStart: dstr(prepOff), teachDate: dstr(teachOff), prepDone: !!done, teachDone: !!done, startTime: '18:00', durationHours: 3 }; }
`;

(async () => {
  const browser = await chromium.launch();

  // ===== 1. Thời lượng 3 mức, Online, Esc =====
  {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);

    const opts = async (sel) => page.$$eval(sel + ' option', els => els.map(e => e.value));
    check('Thời lượng (tạo mới): 3,2,1', JSON.stringify(await opts('#commonDurationHours')) === '["3","2","1"]', await opts('#commonDurationHours'));
    check('Thời lượng (chỉnh sửa): 3,2,1', JSON.stringify(await opts('#editDurationHours')) === '["3","2","1"]');
    check('Địa điểm (tạo mới) có Online', (await opts('#commonLocationSelect')).includes('Online'));
    check('Địa điểm (chỉnh sửa) có Online', (await opts('#editLocationSelect')).includes('Online'));

    const r = await page.evaluate(() => ({
      c: [clampDuration(1), clampDuration(2), clampDuration(3), clampDuration(0.5), clampDuration(4), clampDuration(1.4), clampDuration('x', 2), clampDuration(undefined)],
      l1: parseLocationToPreset('Zoom Meeting').locationType,
      l2: parseLocationToPreset('https://teams.microsoft.com/l/meetup-join/abc').locationType,
      l3: parseLocationToPreset('Phòng 301, Keangnam').locationType,
      l4: parseLocationToPreset('Online').locationType,
      l5: parseLocationToPreset('Trường ABC').locationType,
      disp: getDisplayLocation('Online', ''),
      fmt: formatTimeRange('18:00', 1)
    }));
    check('clampDuration', JSON.stringify(r.c) === '[1,2,3,1,3,1,2,3]', r.c);
    check('Nhận diện Online (Zoom/Teams/Online)', r.l1 === 'Online' && r.l2 === 'Online' && r.l4 === 'Online', r);
    check('Địa điểm khác không bị nhận nhầm', r.l3 === 'Keangnam' && r.l5 === 'Khác', r);
    check('Hiển thị Online + giờ 1h', r.disp === 'Online' && r.fmt === '18:00 - 19:00 (1h)', r);

    // .ics 1 tiếng
    const ics = await page.evaluate(() => parseICS('BEGIN:VEVENT\nSUMMARY:Môn A (1)\nDTSTART:20261020T090000\nDTEND:20261020T100000\nLOCATION:Zoom\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Môn A (2)\nDTSTART:20261021T090000\nDTEND:20261021T110000\nEND:VEVENT').map(s => s.durationHours));
    check('.ics: 1h và 2h được giữ nguyên', JSON.stringify(ics) === '[1,2]', ics);

    // Dòng buổi học trong modal có 3 mức + Online
    await page.evaluate(() => openModal(courses[0].id));
    const rowOpts = await page.$$eval('#s_dur_0 option', els => els.map(e => e.value));
    const rowLoc = await page.$$eval('#s_loc_type_0 option', els => els.map(e => e.value));
    check('Dòng buổi: thời lượng 3,2,1', JSON.stringify(rowOpts) === '["3","2","1"]', rowOpts);
    check('Dòng buổi: có Online', rowLoc.includes('Online'), rowLoc);
    await page.selectOption('#s_dur_0', '1');
    await page.selectOption('#s_loc_type_0', 'Online');
    const saved = await page.evaluate(() => ({ d: courses[0].sessions[0].durationHours, l: courses[0].sessions[0].locationType }));
    check('Chọn 1h + Online được lưu', saved.d === 1 && saved.l === 'Online', saved);

    // Esc đóng modal
    check('Modal đang mở', await page.evaluate(() => document.getElementById('editModal').classList.contains('active')));
    await page.keyboard.press('Escape');
    check('Esc đóng cửa sổ chỉnh sửa', await page.evaluate(() => !document.getElementById('editModal').classList.contains('active') && activeCourseId === null));
    await page.keyboard.press('Escape'); // không lỗi khi modal đã đóng
    await page.close();
  }

  // ===== 2. Danh sách công việc (Tải công việc ổn định) =====
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    await runSetup(page, `
      courses = normalizeCourses([
        mk('Môn A đề cương', { macroDays: 7 }, [ sess(1, 3, 6) ]),
        mk('Môn B soạn bài', {}, [ sess(1, -1, 2) ]),
        mk('Môn C đang dạy', {}, [ sess(1, -3, -1, true), sess(2, 1, 1), sess(3, 4, 4) ].map(function(s, i) { if (i === 1) { s.teachDate = dstr(0); s.prepStart = dstr(0); } if (i === 2) { s.teachDate = dstr(3); s.prepStart = dstr(3); } return s; })),
        mk('Môn D chấm thi', { hasEvaluation: true, evaluation: { start: dstr(-1), end: dstr(3), name: 'Chấm thi cuối kỳ', done: false } }, [ sess(1, -9, -8, true) ])
      ]);
      renderGantt();`);
    const box = await page.evaluate(() => ({
      cls: document.getElementById('workloadAlertBox').className,
      title: document.getElementById('alertTitleText').textContent,
      items: Array.from(document.querySelectorAll('#congestionDetails ol.workload-list > li')).map(li => ({ cls: li.className, text: li.textContent, color: getComputedStyle(li).color, display: getComputedStyle(li).display, top: li.getBoundingClientRect().top })),
      listStyle: getComputedStyle(document.querySelector('#congestionDetails ol.workload-list')).listStyleType
    }));
    check('Trạng thái ổn định', box.cls.includes('normal') && /Ổn Định/.test(box.title), box);
    check('4 công việc, mỗi việc một dòng (li)', box.items.length === 4, box.items.map(i => i.text));
    const stages = box.items.map(i => i.cls.replace('wl-', ''));
    check('Thứ tự công đoạn: đề cương → soạn bài → giảng dạy → chấm thi', JSON.stringify(stages) === '["macro","prep","teach","eval"]', stages);
    const tops = box.items.map(i => i.top);
    check('Các dòng xuống hàng (vị trí dọc tăng dần)', tops.every((t, i) => i === 0 || t > tops[i - 1]), tops);
    check('Danh sách đánh số', box.listStyle === 'decimal', box.listStyle);
    check('Màu chữ khác nhau theo công đoạn', new Set(box.items.map(i => i.color)).size === 4, box.items.map(i => i.color));
    check('Dòng giảng dạy ghi giờ buổi hôm nay', box.items[2].text.includes('Dạy Buổi 2') && box.items[2].text.includes('18:00 - 21:00 (3h)'), box.items[2].text);
    check('Có nhãn công đoạn', box.items[0].text.includes('Đề cương') && box.items[1].text.includes('Soạn bài'), box.items.map(i => i.text));
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'workload.png'), clip: { x: 0, y: 60, width: 520, height: 420 } });

    // Trạng thái quá tải (>= 3 lớp chuẩn bị) vẫn liệt kê theo dòng
    await runSetup(page, `
      courses = normalizeCourses([ mk('X1', {}, [ sess(1, -1, 2) ]), mk('X2', {}, [ sess(1, -1, 2) ]), mk('X3', {}, [ sess(1, -1, 2) ]) ]);
      renderGantt();`);
    const red = await page.evaluate(() => ({ cls: document.getElementById('workloadAlertBox').className, n: document.querySelectorAll('#congestionDetails ol.workload-list > li').length }));
    check('Quá tải: vẫn danh sách đánh số', red.cls.includes('danger') && red.n === 3, red);
    await page.close();
  }

  // ===== 3. Cảnh báo quá hạn =====
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    await runSetup(page, `
      courses = normalizeCourses([
        mk('Quá hạn A', {}, [ sess(1, -4, -2, false) ]),
        mk('Đúng hạn B', {}, [ sess(1, 0, 3, false) ]),
        mk('Đã xong C', {}, [ sess(1, -4, -2, true) ]),
        { name: 'NC quá hạn', category: 'Nghiên cứu', submissions: [{ num: 1, title: 'Submit lần 1', date: dstr(-3), done: false }] },
        { name: 'NC chờ review', category: 'Nghiên cứu', reviewStatus: 'under_review', submissions: [{ num: 1, title: 'Submit lần 1', date: dstr(-3), done: false }] },
        { name: 'TV quá hạn', category: 'Tư vấn doanh nghiệp', deliverables: [{ num: 1, title: 'Báo cáo', date: dstr(-1), done: false }] }
      ]);
      renderGantt();`);
    const o = await page.evaluate(() => ({
      list: getOverdueBlocks().map(b => b.courseName + '|' + b.stage + '|' + b.daysLate),
      boxVisible: getComputedStyle(document.getElementById('overdueAlertBox')).display !== 'none',
      title: (document.querySelector('#overdueAlertBox .overdue-title') || {}).textContent,
      lis: document.querySelectorAll('#overdueAlertBox li').length,
      bars: Array.from(document.querySelectorAll('.bar.is-overdue')).map(b => b.textContent.trim()),
      doneOverdue: document.querySelectorAll('.bar.is-done.is-overdue').length
    }));
    check('Quá hạn: đúng các khối (kể cả NC/TV, bỏ qua đã xong & chờ review)',
      JSON.stringify(o.list.sort()) === JSON.stringify(['NC quá hạn|submit|3', 'Quá hạn A|prep|3', 'Quá hạn A|teach|2', 'TV quá hạn|deliv|1'].sort()), o.list);
    check('Hộp cảnh báo quá hạn hiển thị', o.boxVisible && /\(4\)/.test(o.title) && o.lis === 4, o);
    check('Thanh Gantt quá hạn được đánh dấu', o.bars.length === 4 && o.bars.every(t => t.startsWith('!')), o.bars);
    check('Thanh đã xong không bị cảnh báo', o.doneOverdue === 0);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'overdue.png'), clip: { x: 0, y: 60, width: 520, height: 520 } });

    // Nhấp vào mục cảnh báo mở dự án
    await page.click('#overdueAlertBox li');
    check('Nhấp mục quá hạn mở cửa sổ dự án', await page.evaluate(() => document.getElementById('editModal').classList.contains('active')));
    await page.keyboard.press('Escape');

    // Đánh dấu hoàn thành -> hết cảnh báo
    await page.evaluate(() => { courses[0].sessions[0].prepDone = true; courses[0].sessions[0].teachDone = true; saveData(); renderGantt(); });
    check('Hoàn thành xong thì hết cảnh báo khối đó', await page.evaluate(() => getOverdueBlocks().filter(b => b.courseName === 'Quá hạn A').length === 0));
    // Không có quá hạn -> ẩn hộp
    await page.evaluate(() => { courses = normalizeCourses([{ name: 'OK', category: 'Giảng dạy MBA', sessions: [{ num: 1, title: 'Buổi 1', prepStart: addDays(getTodayStr(), 1), teachDate: addDays(getTodayStr(), 3) }], hasEvaluation: false, macroDays: 0 }]); renderGantt(); });
    check('Không quá hạn thì ẩn hộp', await page.evaluate(() => getComputedStyle(document.getElementById('overdueAlertBox')).display === 'none'));
    await page.close();
  }

  // ===== 4. Trạng thái dự án nghiên cứu =====
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    await page.evaluate(`(function(){
      courses = normalizeCourses([{ name: 'Bài báo X', category: 'Nghiên cứu', journalName: 'EJOR',
        submissions: [{ num: 1, title: 'Submit lần 1', date: addDays(getTodayStr(), -20), journal: 'EJOR', done: true }] }]);
      renderGantt();})()`);
    const id = await page.evaluate(() => courses[0].id);
    const before = await page.evaluate(() => ({ done: isCourseFullyCompleted(courses[0]), badge: document.querySelector('#researchCountdownList .countdown-badge').textContent }));
    check('Mặc định: submit xong hết = Đã hoàn thành', before.done && /Đã hoàn thành/.test(before.badge), before);

    await page.evaluate((id) => openModal(id), id);
    const rvOpts = await page.$$eval('#editReviewStatus option', els => els.map(e => e.value));
    check('Menu trạng thái có 3 lựa chọn', JSON.stringify(rvOpts) === '["","under_review","rejected"]', rvOpts);

    await page.selectOption('#editReviewStatus', 'under_review');
    let s = await page.evaluate(() => ({
      status: courses[0].reviewStatus, done: isCourseFullyCompleted(courses[0]),
      badge: document.querySelector('#researchCountdownList .countdown-badge').textContent,
      badgeCls: document.querySelector('#researchCountdownList .countdown-badge').className,
      sub: document.querySelector('#researchCountdownList .countdown-item div div').textContent,
      row: document.getElementById('ganttSidebarList').textContent,
      overdue: getOverdueBlocks().length, bars: document.querySelectorAll('.bar.is-overdue').length
    }));
    check('Chờ review: badge + không còn "hoàn thành"', s.status === 'under_review' && !s.done && s.badge.includes('Chờ review') && s.badgeCls.includes('review'), s);
    check('Chờ review: dòng Gantt hiện trạng thái', s.row.includes('Chờ review') && !s.row.includes('Đã hoàn thành tất cả'), s.row.slice(0, 200));
    check('Chờ review: hiện ngày Submit gần nhất', s.sub.includes('Submit gần nhất'), s.sub);

    await page.selectOption('#editReviewStatus', 'rejected');
    s = await page.evaluate(() => ({
      badge: document.querySelector('#researchCountdownList .countdown-badge').textContent,
      cls: document.querySelector('#researchCountdownList .countdown-badge').className,
      row: document.getElementById('ganttSidebarList').textContent
    }));
    check('Rejected: badge + dòng Gantt', s.badge.includes('Rejected') && s.cls.includes('rejected') && s.row.includes('Rejected'), s);

    // Thêm lần Submit mới -> trở về theo hạn
    await page.click('button[onclick="addModalSubmissionRow()"]');
    s = await page.evaluate(() => ({ status: courses[0].reviewStatus, sel: document.getElementById('editReviewStatus').value, badge: document.querySelector('#researchCountdownList .countdown-badge').textContent }));
    check('Thêm Submit mới -> bỏ trạng thái', s.status === '' && s.sel === '' && /Còn \d+ ngày/.test(s.badge), s);

    // Lưu & nạp lại giữ trạng thái; dữ liệu cũ không có trường vẫn hợp lệ
    await page.selectOption('#editReviewStatus', 'under_review');
    const persisted = await page.evaluate(() => normalizeCourses(JSON.parse(localStorage.getItem('academic_smart_gantt')))[0].reviewStatus);
    check('Trạng thái được lưu', persisted === 'under_review', persisted);
    check('Giá trị lạ -> rỗng', await page.evaluate(() => normalizeCourses([{ name: 'a', category: 'Nghiên cứu', reviewStatus: 'zzz', submissions: [] }])[0].reviewStatus === ''));

    // Ẩn dự án hoàn thành: dự án chờ review vẫn hiển thị
    await page.evaluate(() => { hideCompletedCourses = true; renderGantt(); });
    check('Chờ review không bị ẩn bởi "ẩn dự án hoàn thành"', await page.evaluate(() => document.getElementById('researchCountdownList').textContent.includes('Bài báo X')));
    // Hoàn thành toàn bộ -> xóa trạng thái
    await page.evaluate(() => { hideCompletedCourses = false; markEntireCourseCompletedFromModal(); });
    s = await page.evaluate(() => ({ status: courses[0].reviewStatus, done: isCourseFullyCompleted(courses[0]) }));
    check('"Hoàn thành toàn bộ" xóa trạng thái chờ', s.status === '' && s.done, s);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'review.png'), clip: { x: 0, y: 60, width: 560, height: 700 } });
    await page.close();
  }

  // ===== 5. Nạp JSON / .ics =====
  const sampleExport = JSON.stringify({ courses: [{ name: 'Môn từ JSON', category: 'Giảng dạy MBA', sessions: [{ num: 1, title: 'Buổi 1', teachDate: '2026-11-01', prepStart: '2026-10-30' }] }], deletedRegistry: ['sync_x'] });
  {
    // 5a. App macOS: hộp thoại native
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.addInitScript(mockScript({ json: { name: 'x.json', content: sampleExport }, ics: { name: 'lich.ics', content: 'BEGIN:VEVENT\nSUMMARY:Kinh tế vi mô (1)\nDTSTART:20261105T083000\nDTEND:20261105T093000\nLOCATION:Zoom\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Kinh tế vi mô (2)\nDTSTART:20261112T083000\nDTEND:20261112T103000\nEND:VEVENT' } }) + '\n' + bridgeWith({}));
    await page.goto(HTML);
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForFunction(() => courses.length === 1 && courses[0].name === 'Môn từ JSON');
    check('Nạp JSON (native): thay dữ liệu + thông báo', dialogs.some(m => m.includes('Đã nạp 1 dự án')), dialogs);
    check('Nạp JSON: khôi phục danh sách chặn', await page.evaluate(() => deletedRegistry.length === 1));
    check('Nạp JSON: đã lưu ra native', await page.evaluate(() => __msgs.some(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt' && m.value.includes('Môn từ JSON'))));

    await page.evaluate(() => switchTab('ical'));
    await page.click('#icalFileInput');
    await page.waitForFunction(() => document.getElementById('icalPickedName').textContent.includes('lich.ics'));
    check('.ics (native): hiện tên tệp đã chọn', true);
    dialogs.length = 0;
    await page.click('button[onclick="processIcalImport()"]');
    await page.waitForFunction(() => courses.some(c => c.name === 'Kinh tế vi mô'));
    const c = await page.evaluate(() => courses.find(c => c.name === 'Kinh tế vi mô').sessions.map(s => [s.locationType, s.startTime, s.durationHours]));
    check('.ics (native): tạo dự án, Online (kế thừa lớp) + 1h/2h', JSON.stringify(c) === '[["Online","08:30",1],["Online","08:30",2]]', c);
    check('.ics: xóa lựa chọn sau khi nạp', await page.evaluate(() => document.getElementById('icalPickedName').textContent === ''));
    // Bấm Hủy hộp thoại: không đổi gì
    await page.evaluate(() => { window.__files = {}; });
    const n = await page.evaluate(() => courses.length);
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(150);
    check('Hủy hộp thoại: không thay đổi dữ liệu', await page.evaluate((n) => courses.length === n, n));
    await page.close();
  }
  {
    // 5b. Trình duyệt: <input type=file> + chọn lại cùng một tệp
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    const file = (name, text) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.setInputFiles('#importJsonFile', file('a.json', sampleExport));
    await page.waitForFunction(() => courses.length === 1 && courses[0].name === 'Môn từ JSON');
    check('Nạp JSON (trình duyệt) hoạt động', dialogs.some(m => m.includes('Đã nạp 1 dự án')), dialogs);
    check('Ô chọn tệp được reset (chọn lại cùng tệp vẫn chạy)', await page.evaluate(() => document.getElementById('importJsonFile').value === ''));
    dialogs.length = 0;
    await page.setInputFiles('#importJsonFile', file('b.json', '{not json'));
    await page.waitForTimeout(200);
    check('JSON hỏng -> báo lỗi', dialogs.some(m => m.includes('không đúng định dạng JSON')), dialogs);
    dialogs.length = 0;
    await page.setInputFiles('#importJsonFile', file('c.json', '{"foo": 1}'));
    await page.waitForTimeout(200);
    check('JSON sai cấu trúc -> báo lỗi (không im lặng)', dialogs.some(m => m.includes('không có danh sách "courses"')), dialogs);
    await page.close();
  }

  // ===== 6. Lưu & khôi phục dữ liệu qua các lần mở app =====
  {
    const page = await browser.newPage();
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.addInitScript(mockScript() + '\n' + bridgeWith({}));
    await page.goto(HTML);
    await page.evaluate(() => {
      courses.push(normalizeCourses([{ name: 'Môn do tôi thêm', category: 'Giảng dạy MBA', sessions: [{ num: 1, title: 'Buổi 1', teachDate: '2026-12-01', prepStart: '2026-11-29' }] }])[0]);
      saveData();
    });
    await page.waitForTimeout(100);
    const written = await page.evaluate(() => {
      var last = {};
      __msgs.filter(m => m.cmd === 'storageSet').forEach(m => { last[m.key] = m.value; });
      return last;
    });
    check('Mỗi lần lưu gửi dữ liệu ra native', !!written.academic_smart_gantt && written.academic_smart_gantt.includes('Môn do tôi thêm'));
    check('bootState luôn là bản mới nhất', await page.evaluate(() => GanttNative.bootState.academic_smart_gantt.includes('Môn do tôi thêm')));
    await page.close();

    // Mở lại app với dữ liệu đọc từ tệp
    const page2 = await browser.newPage();
    page2.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page2.addInitScript(mockScript() + '\n' + bridgeWith(written));
    await page2.goto(HTML);
    const names = await page2.evaluate(() => courses.map(c => c.name));
    check('Mở lại app: dữ liệu còn nguyên', names.includes('Môn do tôi thêm'), names);
    await page2.close();

    // localStorage của WebView bị trống/cũ nhưng tệp trên đĩa còn dữ liệu -> vẫn dùng dữ liệu trên đĩa
    const page3 = await browser.newPage();
    page3.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    // mô phỏng WebView không cho đọc/ghi localStorage (SecurityError)
    await page3.addInitScript(`Object.defineProperty(window, 'localStorage', { get: function () { throw new DOMException('insecure', 'SecurityError'); } });`);
    await page3.addInitScript(mockScript() + '\n' + bridgeWith(written));
    await page3.goto(HTML);
    const names3 = await page3.evaluate(() => courses.map(c => c.name));
    check('localStorage hỏng: vẫn khôi phục từ tệp trên đĩa', names3.includes('Môn do tôi thêm'), names3);
    await page3.evaluate(() => { courses[0].name = 'Đổi tên khi localStorage hỏng'; saveData(); });
    await page3.waitForTimeout(100);
    check('localStorage hỏng: vẫn lưu được ra tệp', await page3.evaluate(() => __msgs.some(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt' && m.value.includes('Đổi tên khi localStorage hỏng'))));
    await page3.close();
  }

  // ===== 7. Mở bằng trình duyệt: không phụ thuộc cầu nối =====
  {
    const page = await browser.newPage();
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    await page.evaluate(() => { courses[0].name = 'Tên mới'; saveData(); });
    await page.reload();
    check('Trình duyệt: lưu & nạp lại bằng localStorage', await page.evaluate(() => courses[0].name === 'Tên mới'));
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
