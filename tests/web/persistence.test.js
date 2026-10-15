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

// mode: 'ok' | 'fail' (native không ghi được đĩa) ; files: kết quả openTextFile
function mockScript(opts) {
  opts = opts || {};
  return `
  window.__msgs = [];
  window.__mode = ${JSON.stringify(opts.mode || 'ok')};
  window.__files = ${JSON.stringify(opts.files || {})};
  window.webkit = { messageHandlers: { gantt: { postMessage: function (m) {
    window.__msgs.push(JSON.parse(JSON.stringify(m)));
    var ok = function (d) { return Promise.resolve({ ok: true, data: d }); };
    if (m.cmd === 'storageSet' && window.__mode === 'fail')
      return Promise.resolve({ ok: false, error: 'write_failed', message: 'Không ghi được dữ liệu ra đĩa: disk full' });
    if (m.cmd === 'openTextFile') return ok(window.__files[(m.extensions || [])[0]] || false);
    if (m.cmd === 'backupNow') return ok(true);
    if (m.cmd === 'listCalendars') return ok([]);
    return ok(true);
  } } } };`;
}
function bridgeWith(storage) {
  return BRIDGE.replace('__GANTT_VERSION__', '"3.1.1"').replace('__GANTT_STORAGE__', JSON.stringify(storage));
}
const SAMPLE = [{ name: 'Môn A', category: 'Giảng dạy MBA', sessions: [{ num: 1, title: 'Buổi 1', teachDate: '2026-12-01', prepStart: '2026-11-29' }] }];

(async () => {
  const browser = await chromium.launch();
  const errors = (page) => page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });

  // ===== 1. Xác nhận lưu + chỉ báo =====
  {
    const page = await browser.newPage(); errors(page);
    await page.addInitScript(mockScript() + '\n' + bridgeWith({}));
    await page.goto(HTML);
    check('Chỉ báo lưu hiện trong ứng dụng', await page.evaluate(() => document.getElementById('saveStatus').style.display !== 'none'));
    check('Chỉ báo ban đầu (chưa lưu lần nào)', (await page.textContent('#saveStatus')).includes('Dữ liệu lưu trên máy'));
    const rev0 = await page.evaluate(() => GanttNative.rev);
    await page.evaluate(() => { courses[0].name = 'Đổi tên 1'; saveData(); });
    await page.waitForTimeout(100);
    check('rev tăng sau mỗi lần lưu', await page.evaluate((r) => GanttNative.rev > r, rev0));
    check('saveState được xác nhận -> chỉ báo "Đã lưu"', /Đã lưu \d\d:\d\d:\d\d/.test(await page.textContent('#saveStatus')), await page.textContent('#saveStatus'));
    check('Chỉ báo màu xanh', await page.evaluate(() => document.getElementById('saveStatus').classList.contains('ok')));
    check('saveStatus.ok = true', await page.evaluate(() => GanttNative.saveStatus.ok === true));
    check('writeStored vẫn giữ bản sao trong localStorage', await page.evaluate(() => (localStorage.getItem('academic_smart_gantt') || '').includes('Đổi tên 1')));
    await page.close();
  }

  // ===== 2. Native không ghi được đĩa =====
  {
    const page = await browser.newPage(); errors(page);
    await page.addInitScript(mockScript({ mode: 'fail' }) + '\n' + bridgeWith({}));
    await page.goto(HTML);
    await page.evaluate(() => { courses[0].name = 'Đổi tên khi đĩa đầy'; saveData(); });
    await page.waitForTimeout(100);
    check('Lỗi ghi -> chỉ báo đỏ', await page.evaluate(() => document.getElementById('saveStatus').classList.contains('bad')), await page.textContent('#saveStatus'));
    check('Lỗi ghi -> nội dung cảnh báo', (await page.textContent('#saveStatus')).includes('Chưa lưu được'));
    check('Lỗi ghi -> tooltip có lý do + gợi ý Xuất JSON', await page.evaluate(() => { var t = document.getElementById('saveStatus').title; return t.includes('disk full') && t.includes('Xuất JSON'); }));
    check('Lỗi ghi: trang vẫn hoạt động (dữ liệu trong bộ nhớ)', await page.evaluate(() => courses[0].name === 'Đổi tên khi đĩa đầy'));
    // Hết lỗi -> chỉ báo xanh trở lại ở lần lưu sau
    await page.evaluate(() => { window.__mode = 'ok'; courses[0].name = 'Đã hết lỗi'; saveData(); });
    await page.waitForTimeout(100);
    check('Hết lỗi -> chỉ báo xanh trở lại', await page.evaluate(() => document.getElementById('saveStatus').classList.contains('ok')));
    await page.close();
  }

  // ===== 3. Dữ liệu cũ trong localStorage (từ bản 3.0.x) =====
  {
    const page = await browser.newPage(); errors(page);
    // tệp trên đĩa thiếu khóa dự án, nhưng localStorage của WebView còn dữ liệu cũ
    await page.addInitScript(`localStorage.setItem('academic_smart_gantt', ${JSON.stringify(JSON.stringify(SAMPLE))}); localStorage.setItem('khac_khong_phai_cua_app', 'x');`);
    await page.addInitScript(mockScript() + '\n' + bridgeWith({}));
    await page.goto(HTML);
    check('Khôi phục dữ liệu cũ từ localStorage khi tệp thiếu', await page.evaluate(() => courses.length === 1 && courses[0].name === 'Môn A'), await page.evaluate(() => courses.map(c => c.name)));
    check('Dữ liệu cũ được ghi sang native', await page.evaluate(() => __msgs.some(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt' && m.value.includes('Môn A'))));
    check('Khóa lạ không bị nhập', await page.evaluate(() => !__msgs.some(m => m.key === 'khac_khong_phai_cua_app') && !('khac_khong_phai_cua_app' in GanttNative.bootState)));
    await page.close();

    // tệp trên đĩa có dữ liệu -> localStorage cũ KHÔNG được ghi đè
    const page2 = await browser.newPage(); errors(page2);
    const onDisk = [{ name: 'Môn trên đĩa', category: 'Giảng dạy MBA', sessions: [{ num: 1, title: 'Buổi 1', teachDate: '2026-12-01', prepStart: '2026-11-29' }] }];
    await page2.addInitScript(`localStorage.setItem('academic_smart_gantt', ${JSON.stringify(JSON.stringify(SAMPLE))});`);
    await page2.addInitScript(mockScript() + '\n' + bridgeWith({ academic_smart_gantt: JSON.stringify(onDisk) }));
    await page2.goto(HTML);
    check('Tệp trên đĩa luôn thắng localStorage cũ', await page2.evaluate(() => courses.length === 1 && courses[0].name === 'Môn trên đĩa'), await page2.evaluate(() => courses.map(c => c.name)));
    check('Không ghi đè tệp bằng dữ liệu cũ', await page2.evaluate(() => !__msgs.some(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt')));
    await page2.close();
  }

  // ===== 4. localStorage bị chặn hoàn toàn =====
  {
    const page = await browser.newPage(); errors(page);
    await page.addInitScript(`Object.defineProperty(window, 'localStorage', { get: function () { throw new DOMException('insecure', 'SecurityError'); } });`);
    await page.addInitScript(mockScript() + '\n' + bridgeWith({ academic_smart_gantt: JSON.stringify(SAMPLE) }));
    await page.goto(HTML);
    check('localStorage bị chặn: vẫn đọc được từ tệp', await page.evaluate(() => courses.length === 1 && courses[0].name === 'Môn A'));
    await page.evaluate(() => { courses[0].name = 'Vẫn lưu được'; saveData(); });
    await page.waitForTimeout(100);
    check('localStorage bị chặn: vẫn lưu + xác nhận', await page.evaluate(() => GanttNative.saveStatus.ok === true && __msgs.some(m => m.cmd === 'storageSet' && m.value.includes('Vẫn lưu được'))));
    await page.close();
  }

  // ===== 5. Nạp JSON: định dạng, BOM, sao lưu =====
  {
    const exported = JSON.stringify({ courses: SAMPLE, deletedRegistry: ['k1'] });
    const appStorage = JSON.stringify({
      academic_smart_gantt: JSON.stringify([{ name: 'Môn từ storage.json', category: 'Giảng dạy MBA', sessions: [{ num: 1, title: 'Buổi 1', teachDate: '2026-12-01', prepStart: '2026-11-29' }] }]),
      academic_smart_gantt_deleted: JSON.stringify(['dead-1', 'dead-2']),
      academic_smart_gantt_mac_calendars: '["c1"]'
    });
    const files = { json: { name: 'x.json', content: exported } };
    const page = await browser.newPage(); errors(page);
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message()); await d.accept(); });
    await page.addInitScript(mockScript({ files }) + '\n' + bridgeWith({}));
    await page.goto(HTML);

    await page.evaluate((c) => { __files.json = { name: 'x.json', content: c }; }, '\uFEFF' + exported);
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(250);
    check('Nạp JSON có BOM', await page.evaluate(() => courses.length === 1 && courses[0].name === 'Môn A'), dialogs);
    check('Đã sao lưu trước khi thay thế (import)', await page.evaluate(() => __msgs.some(m => m.cmd === 'backupNow' && m.label === 'import')));
    check('Sao lưu diễn ra TRƯỚC lần ghi mới', await page.evaluate(() => {
      var b = __msgs.findIndex(m => m.cmd === 'backupNow');
      var w = __msgs.findIndex(m => m.cmd === 'storageSet' && m.key === 'academic_smart_gantt' && m.value.includes('Môn A'));
      return b !== -1 && w !== -1 && b < w;
    }));
    check('Danh sách chặn được nạp', await page.evaluate(() => deletedRegistry.length === 1 && deletedRegistry[0] === 'k1'));

    // định dạng storage.json của ứng dụng
    dialogs.length = 0;
    await page.evaluate((c) => { __files.json = { name: 'storage.json', content: c }; }, appStorage);
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(250);
    check('Nạp storage.json của ứng dụng (khôi phục dữ liệu)', await page.evaluate(() => courses.length === 1 && courses[0].name === 'Môn từ storage.json'), await page.evaluate(() => courses.map(c => c.name)));
    check('storage.json: nạp cả danh sách chặn', await page.evaluate(() => deletedRegistry.join(',') === 'dead-1,dead-2'));
    check('storage.json: thông báo số dự án', dialogs.some(m => m.includes('Đã nạp 1 dự án')), dialogs);

    // tệp lạ
    dialogs.length = 0;
    await page.evaluate(() => { __files.json = { name: 'y.json', content: '{"hello":"world"}' }; });
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(250);
    check('Tệp JSON lạ -> báo lỗi rõ ràng, giữ nguyên dữ liệu', dialogs.some(m => m.includes('không phải dữ liệu của Academic Gantt')) && await page.evaluate(() => courses.length === 1 && courses[0].name === 'Môn từ storage.json'), dialogs);

    // storage.json hỏng bên trong
    dialogs.length = 0;
    await page.evaluate(() => { __files.json = { name: 'z.json', content: '{"academic_smart_gantt":"{khong phai json"}' }; });
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(250);
    check('storage.json hỏng bên trong -> báo lỗi, giữ nguyên dữ liệu', dialogs.some(m => m.includes('Không đọc được dữ liệu dự án')) && await page.evaluate(() => courses[0].name === 'Môn từ storage.json'), dialogs);

    // danh sách rỗng -> không thay thế, báo rõ
    dialogs.length = 0;
    await page.evaluate(() => { window.__msgs.length = 0; __files.json = { name: 'e.json', content: '[]' }; });
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(250);
    check('Nạp danh sách rỗng -> báo "không chứa dự án nào"', dialogs.some(m => m.includes('không chứa dự án nào')), dialogs);
    check('Nạp danh sách rỗng -> dữ liệu và đĩa không đổi', await page.evaluate(() => courses.length === 1 && courses[0].name === 'Môn từ storage.json' && !__msgs.some(m => m.cmd === 'storageSet' || m.cmd === 'backupNow')));
    dialogs.length = 0;
    await page.evaluate(() => { __files.json = { name: 'e2.json', content: '{"courses": []}' }; });
    await page.click('button[onclick="pickImportJson()"]');
    await page.waitForTimeout(250);
    check('Nạp {"courses": []} -> cũng không thay thế', dialogs.some(m => m.includes('không chứa dự án nào')) && await page.evaluate(() => courses[0].name === 'Môn từ storage.json'), dialogs);

    check('Không còn nút Khôi phục mẫu', await page.evaluate(() => !document.querySelector('button[onclick="resetSample()"]') && typeof window.resetSample === 'undefined'));
    await page.close();
  }

  // ===== 5b. Dữ liệu đã lưu không đọc được: không để bị ghi đè lặng lẽ =====
  {
    async function boot(rawValue) {
      const page = await browser.newPage(); errors(page);
      const dialogs = [];
      page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
      await page.addInitScript(mockScript() + '\n' + bridgeWith(rawValue === undefined ? {} : { academic_smart_gantt: rawValue }));
      await page.goto(HTML);
      await page.waitForTimeout(600);
      const msgs = await page.evaluate(() => __msgs.filter(m => m.cmd === 'storageSet').map(m => ({ key: m.key, value: m.value })));
      const names = await page.evaluate(() => courses.map(c => c.name));
      await page.close();
      return { dialogs, msgs, names };
    }
    let r = await boot('{broken json');
    check('JSON hỏng: hiển thị dữ liệu mẫu', r.names.length === 3 && r.names.includes('Kinh tế học Quản trị - MBA K28'), r.names);
    check('JSON hỏng: bản gốc được cất ở khóa riêng', r.msgs.some(m => m.key.startsWith('academic_smart_gantt_unreadable_') && m.value === '{broken json'), r.msgs.map(m => m.key));
    check('JSON hỏng: có cảnh báo cho người dùng', r.dialogs.some(m => m.includes('Không đọc được dữ liệu đã lưu')), r.dialogs);
    check('JSON hỏng: không ghi đè khóa dự án ngay lúc mở', !r.msgs.some(m => m.key === 'academic_smart_gantt'));

    r = await boot('{"a":1}');
    check('JSON hợp lệ nhưng không phải danh sách: coi như không đọc được', r.dialogs.some(m => m.includes('không phải là danh sách dự án')) && r.msgs.some(m => m.key.startsWith('academic_smart_gantt_unreadable_')), r.dialogs);

    r = await boot(JSON.stringify(SAMPLE));
    check('Dữ liệu tốt: không cảnh báo, không tạo khóa cất giữ', r.dialogs.length === 0 && !r.msgs.some(m => m.key.startsWith('academic_smart_gantt_unreadable_')) && r.names.length === 1 && r.names[0] === 'Môn A', r);

    r = await boot('[]');
    check('Danh sách rỗng: dữ liệu mẫu (như trước), không cảnh báo', r.dialogs.length === 0 && r.names.length === 3, r);

    r = await boot(undefined);
    check('Chưa có dữ liệu: dữ liệu mẫu, không cảnh báo', r.dialogs.length === 0 && r.names.length === 3, r);
  }

  // ===== 6. Trình duyệt thường (không có cầu nối) =====
  {
    const page = await browser.newPage(); errors(page);
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    await page.goto(HTML);
    check('Trình duyệt: không hiện chỉ báo lưu', await page.evaluate(() => document.getElementById('saveStatus').style.display === 'none'));
    await page.evaluate(() => { courses[0].name = 'Tên trình duyệt'; saveData(); });
    await page.reload();
    check('Trình duyệt: lưu & nạp lại', await page.evaluate(() => courses[0].name === 'Tên trình duyệt'));
    await page.evaluate(() => { backupBeforeReplace('x'); });
    check('Trình duyệt: backupBeforeReplace không lỗi', true);
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
