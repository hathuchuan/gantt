const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HTML = 'file://' + path.join(ROOT, 'web', 'academic_gantt_planner.html');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'macos', 'Resources', 'bridge.js'), 'utf8');
let failures = 0;
function check(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) failures++; }

// Giả lập WKScriptMessageHandlerWithReply: postMessage trả về Promise
function mockScript(mode) {
  return `
  window.__msgs = [];
  window.__mode = ${JSON.stringify(mode)};
  window.webkit = { messageHandlers: { gantt: { postMessage: function (m) {
    window.__msgs.push(JSON.parse(JSON.stringify(m)));
    var ok = function (d) { return Promise.resolve({ ok: true, data: d }); };
    if (m.cmd === 'listCalendars') {
      if (window.__mode === 'denied') return Promise.resolve({ ok: false, error: 'denied', message: 'Chưa cấp quyền Lịch.' });
      return ok([
        { id: 'c1', title: 'FSB Giảng dạy', source: 'iCloud', color: '#ff0000' },
        { id: 'c2', title: 'Lịch', source: 'Exchange', color: '#00ff00' },
        { id: 'c3', title: 'Birthdays', source: 'Other', color: '#0000ff' },
        { id: 'c4', title: 'Home <b>x</b>', source: 'iCloud', color: '#123456' }
      ]);
    }
    if (m.cmd === 'fetchEvents') {
      window.__fetchedIds = m.calendarIds;
      var d = new Date(); d.setDate(d.getDate() + 3);
      var day = d.toISOString().slice(0, 10);
      var d2 = new Date(); d2.setDate(d2.getDate() + 10);
      var day2 = d2.toISOString().slice(0, 10);
      return ok([
        { title: 'Quản trị Chiến lược (1)', teachDate: day, calendar: 'FSB Giảng dạy', location: 'Phòng 301, FSB Keangnam', startTime: '08:30', durationHours: 3 },
        { title: 'Quản trị Chiến lược (2)', teachDate: day2, calendar: 'FSB Giảng dạy', location: 'Online Zoom', startTime: '13:30', durationHours: 2 }
      ]);
    }
    if (m.cmd === 'saveTextFile') return ok(true);
    if (m.cmd === 'openCalendarPrivacySettings') { window.__openedSettings = true; return ok(true); }
    return ok(true);
  } } } };`;
}
function bridgeWith(storage) {
  return BRIDGE.replace('__GANTT_VERSION__', '"3.0.0"').replace('__GANTT_STORAGE__', JSON.stringify(storage));
}

(async () => {
  const browser = await chromium.launch();

  // 1) Chế độ ứng dụng macOS
  {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.addInitScript(mockScript('ok') + '\n' + bridgeWith({ __seed: 'from-file' }));
    await page.goto(HTML);
    check('GanttNative có mặt', await page.evaluate(() => !!window.GanttNative && GanttNative.version === '3.0.0'));
    check('bootState nạp từ tệp trên đĩa', await page.evaluate(() => GanttNative.bootState.__seed) === 'from-file');
    check('Nhãn nguồn = ứng dụng macOS', (await page.textContent('#macSyncSource')).includes('Ứng dụng macOS'));
    check('Hiện bảng chọn lịch', await page.evaluate(() => document.getElementById('macCalendarPicker').style.display !== 'none'));
    const before = await page.evaluate(() => courses.length);
    await page.click('#tabBtnMac');
    await page.waitForSelector('#macCalendarList input[type=checkbox]');
    const checked = await page.$$eval('#macCalendarList input', els => els.map(e => [e.value, e.checked]));
    check('Mặc định tick theo từ khóa (FSB, Lịch)', JSON.stringify(checked) === JSON.stringify([['c1', true], ['c2', true], ['c3', false], ['c4', false]]), checked);
    check('Tên lịch được escape', (await page.innerHTML('#macCalendarList')).includes('Home &lt;b&gt;x&lt;/b&gt;'));
    // Bỏ tick c2, kiểm tra lưu lựa chọn
    await page.click('#macCalendarList input[value=c2]');
    const sel = await page.evaluate(() => localStorage.getItem('academic_smart_gantt_mac_calendars'));
    check('Lưu lựa chọn lịch', sel === '["c1"]', sel);
    check('Lựa chọn được mirror ra native', await page.evaluate(() => __msgs.some(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt_mac_calendars')));
    await page.click('button[onclick="syncFromMacCalendar()"]');
    await page.waitForFunction(() => window.__fetchedIds);
    await page.waitForTimeout(200);
    check('Chỉ lấy lịch đã chọn', JSON.stringify(await page.evaluate(() => __fetchedIds)) === '["c1"]');
    check('Thông báo đồng bộ', dialogs.some(m => m.includes('Dự án thêm mới: 1')), dialogs);
    const course = await page.evaluate(() => courses.find(c => c.name === 'Quản trị Chiến lược'));
    check('Tạo dự án từ lịch', !!course && courses_len_ok(before), null);
    function courses_len_ok() { return true; }
    if (course) {
      const s = course.sessions;
      check('Buổi 1: Keangnam 08:30 3h', s[0].locationType === 'Keangnam' && s[0].startTime === '08:30' && s[0].durationHours === 3, s[0]);
      check('Buổi 2: Zoom -> Online 13:30 2h', s[1].locationType === 'Online' && s[1].locationCustom === '' && s[1].startTime === '13:30' && s[1].durationHours === 2, s[1]);
    }
    check('Dữ liệu dự án mirror ra native', await page.evaluate(() => __msgs.some(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt' && m.value.includes('Quản trị Chiến lược'))));
    // Đồng bộ lần 2: không nhân đôi
    dialogs.length = 0;
    await page.click('button[onclick="syncFromMacCalendar()"]');
    await page.waitForTimeout(300);
    check('Đồng bộ lại không nhân đôi', dialogs.some(m => m.includes('Dự án thêm mới: 0') && m.includes(': 1')), dialogs);
    // Xuất JSON qua native
    await page.evaluate(() => exportData());
    const save = await page.evaluate(() => __msgs.find(m => m.cmd === 'saveTextFile'));
    check('Xuất JSON qua hộp thoại lưu macOS', !!save && /^academic_smart_gantt_\d{4}-\d{2}-\d{2}\.json$/.test(save.fileName) && JSON.parse(save.content).courses.length > 0, save && save.fileName);
    // Bỏ tick hết → cảnh báo
    dialogs.length = 0;
    await page.click('#macCalendarList input[value=c1]');
    await page.click('button[onclick="syncFromMacCalendar()"]');
    await page.waitForTimeout(200);
    check('Cảnh báo khi không chọn lịch', dialogs.some(m => m.includes('ít nhất 1 lịch')), dialogs);
    await page.close();
  }

  // 2) Lựa chọn lịch đã lưu được tôn trọng + dữ liệu khôi phục từ tệp
  {
    const page = await browser.newPage();
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    const stored = { academic_smart_gantt: JSON.stringify([{ name: 'Môn từ tệp', sessions: [] }]), academic_smart_gantt_mac_calendars: '["c3"]' };
    await page.addInitScript(mockScript('ok') + '\n' + bridgeWith(stored));
    await page.goto(HTML);
    const names = await page.evaluate(() => courses.map(c => c.name));
    check('Nạp dữ liệu dự án từ tệp', names.length === 1 && names[0] === 'Môn từ tệp', names);
    await page.click('#tabBtnMac');
    await page.waitForSelector('#macCalendarList input[type=checkbox]');
    const checked = await page.$$eval('#macCalendarList input', els => els.filter(e => e.checked).map(e => e.value));
    check('Dùng lựa chọn lịch đã lưu', JSON.stringify(checked) === '["c3"]', checked);
    await page.close();
  }

  // 3) Bị từ chối quyền Lịch
  {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.addInitScript(mockScript('denied') + '\n' + bridgeWith({}));
    await page.goto(HTML);
    await page.click('#tabBtnMac');
    await page.waitForSelector('#macCalendarList button');
    check('Hiện lỗi + nút mở cài đặt', (await page.textContent('#macCalendarList')).includes('Chưa cấp quyền Lịch'));
    await page.click('button[onclick="syncFromMacCalendar()"]');
    await page.waitForTimeout(300);
    check('Hỏi mở cài đặt quyền (confirm)', dialogs.some(m => m.startsWith('confirm:') && m.includes('Mở phần cài đặt quyền Lịch')), dialogs);
    check('Đã mở cài đặt sau khi đồng ý', await page.evaluate(() => !!window.__openedSettings));
    await page.close();
  }

  // 4) Mở bằng trình duyệt (không có app): giữ hành vi cũ
  {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
    await page.goto(HTML);
    check('Trình duyệt: ẩn bảng chọn lịch', await page.evaluate(() => document.getElementById('macCalendarPicker').style.display === 'none'));
    check('Trình duyệt: nhãn dịch vụ ngầm', (await page.textContent('#macSyncSource')).includes('127.0.0.1:8765'));
    await page.click('#tabBtnMac');
    await page.click('button[onclick="syncFromMacCalendar()"]');
    await page.waitForTimeout(1500);
    check('Trình duyệt: báo lỗi kết nối sync_server', dialogs.some(m => m.includes('Không kết nối được dịch vụ ngầm')), dialogs);
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
