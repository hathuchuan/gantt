// Liên kết 2 chiều khối Gantt <-> ghi chú Markdown (MD Editor)
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HTML = 'file://' + path.join(ROOT, 'web', 'academic_gantt_planner.html');
let failures = 0;
function check(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) failures++; }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++; });
  page.on('dialog', d => d.accept());
  await page.goto(HTML);
  await page.evaluate(() => {
    window.__opened = [];
    window.__saved = {};
    window.GanttNative = {
      openURL: function (u) { window.__opened.push(u); return Promise.resolve(true); },
      saveState: function (k, v) { window.__saved[k] = v; return Promise.resolve(); }
    };
  });

  const bars = await page.$$eval('.bar[data-block-id]', els => els.map(e => e.getAttribute('data-block-id')));
  check('các thanh có data-block-id', bars.length > 0, bars.slice(0, 3));
  const teachId = bars.find(id => id.split('|')[1] === 'session_teach');
  check('có thanh buổi dạy', !!teachId, teachId);
  const sel = '.bar[data-block-id="' + teachId + '"]';

  // nhấp thường vẫn đổi trạng thái hoàn thành
  const doneBefore = await page.$eval(sel, e => e.classList.contains('is-done'));
  await page.click(sel);
  const doneAfter = await page.$eval(sel, e => e.classList.contains('is-done'));
  check('nhấp thường đổi trạng thái hoàn thành', doneBefore !== doneAfter);
  await page.click(sel);

  // ⌘-nhấp: mở / tạo ghi chú
  await page.click(sel, { modifiers: ['Meta'] });
  const url1 = await page.evaluate(() => window.__opened[0]);
  check('⌘-nhấp gọi mdeditor://note', !!url1 && url1.indexOf('mdeditor://note?') === 0, url1);
  check('URL chứa block, course, label', /block=/.test(url1) && /course=/.test(url1) && /label=/.test(url1) && /start=/.test(url1));
  check('chưa có path khi chưa liên kết', !/[?&]path=/.test(url1));
  const stillSame = await page.$eval(sel, e => e.classList.contains('is-done'));
  check('⌘-nhấp không đổi trạng thái hoàn thành', stillSame === doneBefore);

  // MD Editor gửi link về
  const handled = await page.evaluate(id => window.ganttHandleURL('academicgantt://link?block=' + encodeURIComponent(id) + '&path=' + encodeURIComponent('/Users/a b/Notes/n.md')), teachId);
  check('ganttHandleURL(link) trả true', handled === true);
  check('biểu tượng 📄 xuất hiện trên thanh', (await page.$$(sel + ' .note-link')).length === 1);
  const stored = await page.evaluate(() => JSON.parse(window.__saved['academic_smart_gantt_notes'] || '{}'));
  check('liên kết được lưu', stored[teachId] && stored[teachId].path === '/Users/a b/Notes/n.md', stored);

  await page.evaluate(() => { window.__opened = []; });
  await page.click(sel + ' .note-link');
  const url2 = await page.evaluate(() => window.__opened[0]);
  check('nhấp 📄 mở ghi chú đã liên kết (kèm path)', !!url2 && url2.indexOf('path=' + encodeURIComponent('/Users/a b/Notes/n.md')) !== -1, url2);
  check('nhấp 📄 không đổi trạng thái hoàn thành', (await page.$eval(sel, e => e.classList.contains('is-done'))) === doneBefore);

  // MD Editor yêu cầu hiển thị khối
  await page.evaluate(id => window.ganttHandleURL('academicgantt://open?block=' + encodeURIComponent(id)), teachId);
  check('academicgantt://open làm khối nhấp nháy', await page.$eval(sel, e => e.classList.contains('block-flash')));

  // gỡ liên kết
  await page.evaluate(id => window.ganttHandleURL('academicgantt://unlink?block=' + encodeURIComponent(id)), teachId);
  check('unlink gỡ biểu tượng 📄', (await page.$$(sel + ' .note-link')).length === 0);

  check('URL sai bị bỏ qua', (await page.evaluate(() => window.ganttHandleURL('https://x.y'))) === false);
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
