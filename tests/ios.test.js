// Kiểm thử widget iPhone (ios/GanttWorkload.js) với bản giả lập API Scriptable: hiển thị, bấm dòng để hoàn thành,
// lớp phủ thao tác chưa được Mac xác nhận, hoàn tác, việc quá hạn, Submit / sản phẩm, trạng thái đồng bộ về Mac.
const fs = require('fs');
const path = require('path');
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
  if (!cond) failures++;
}
const SRC = fs.readFileSync(path.join(__dirname, '..', 'ios', 'GanttWorkload.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const pad = (n) => String(n).padStart(2, '0');
const ds = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

async function run(files, opts) {
  opts = opts || {};
  const widgets = [];
  const notes = [];
  const fm = {
    documentsDirectory: () => '/docs',
    joinPath: (a, b) => a + '/' + b,
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    isFileDownloaded: () => true,
    downloadFileFromiCloud: async () => {},
    readString: (p) => files[p],
    writeString: (p, v) => { files[p] = v; },
  };
  class Color { constructor(h) { this.hex = h; } static white() { return new Color('#fff'); } }
  const Font = new Proxy({}, { get: () => () => ({}) });
  class Elem { constructor() { this.children = []; } addText(t) { const e = new Elem(); e.text = t; this.children.push(e); return e; } addStack() { const e = new Elem(); e.stack = true; this.children.push(e); return e; } addSpacer() {} centerAlignContent() {} }
  class ListWidget extends Elem { setPadding() {} async presentSmall() { widgets.push(this); } async presentMedium() { widgets.push(this); } async presentLarge() { widgets.push(this); } }
  class Alert { constructor() { this.actions = []; } addAction(t) { this.actions.push(t); } addCancelAction() {} async presentSheet() { return opts.choices && opts.choices.length ? opts.choices.shift() : -1; } async presentAlert() { return 0; } }
  class Notification { async schedule() { notes.push(this.title); } }
  const sandbox = {
    FileManager: { iCloud: () => fm },
    Script: { name: () => 'GanttWorkload', setWidget: (w) => widgets.push(w), complete() {} },
    config: { runsInWidget: !!opts.widget, widgetFamily: opts.family || 'medium' },
    args: { queryParameters: opts.query || {} },
    URLScheme: { forRunningScript: () => 'scriptable:///run/GanttWorkload' },
    Color, Font, ListWidget, Alert, Notification,
    DatePicker: { pickDate: async () => new Date() },
  };
  const names = Object.keys(sandbox);
  await new AsyncFunction(...names, SRC)(...names.map((n) => sandbox[n]));
  return { widgets, notes };
}
function rows(w) { return w.children.filter((c) => c.stack); }

(async () => {
  const courses = [{
    id: 'c1', name: 'Lớp A', category: 'FSB', macroDays: 0, hasEvaluation: false, startTime: '18:00', durationHours: 3,
    sessions: [
      { num: 1, title: 'Buổi 1', prepStart: ds(-1), teachDate: ds(1), startTime: '18:00', durationHours: 3 },
      { num: 2, title: 'Buổi 2', prepStart: ds(5), teachDate: ds(7) },
    ],
  }, {
    id: 'c2', name: 'Lớp B', category: 'RMIT', macroDays: 0, hasEvaluation: false, startTime: '08:00', durationHours: 3,
    sessions: [{ num: 1, title: 'Buổi 1', prepStart: ds(-2), teachDate: ds(0), prepDone: true, teachDone: false, startTime: '08:00', durationHours: 3 },
      { num: 2, title: 'Buổi 2', prepStart: ds(8), teachDate: ds(10) }],
  }];
  const files = { '/docs/gantt_courses.json': JSON.stringify(courses) };

  let r = await run(files, { widget: true });
  let rs = rows(r.widgets[0]);
  const urls = rs.map((x) => x.url || '');
  check('Widget hiển thị việc hôm nay (soạn bài A, dạy B)', rs.length === 2, rs.length);
  check('Mỗi dòng việc có URL bấm để hoàn thành', urls.every((u) => u.startsWith('scriptable:///run/GanttWorkload?toggle=')), urls);
  const req = JSON.parse(decodeURIComponent(urls[0].split('toggle=')[1]));
  check('URL chứa đúng khối cần đánh dấu', req.done === true && req.act.courseId === 'c1' && req.act.kind === 'session_prep' && req.act.idx === 0 && req.act.guard === ds(1), req);

  r = await run(files, { family: 'small', widget: true });
  check('Widget nhỏ: không gắn URL từng dòng (chỉ một điểm chạm)', rows(r.widgets[0]).every((x) => !x.url));

  // Bấm dòng → ghi thao tác
  r = await run(files, { query: { toggle: decodeURIComponent(urls[0].split('toggle=')[1]) } });
  let actions = JSON.parse(files['/docs/gantt_actions.json']);
  check('Bấm dòng: ghi 1 thao tác vào gantt_actions.json', actions.length === 1 && actions[0].kind === 'session_prep' && actions[0].done === true && actions[0].courseId === 'c1' && !!actions[0].id, actions);
  check('Có thông báo xác nhận', r.notes.length === 1 && /hoàn thành/.test(r.notes[0]), r.notes);

  // Lớp phủ: việc vừa xong biến mất khỏi widget dù Mac chưa xác nhận
  r = await run(files, { widget: true });
  rs = rows(r.widgets[0]);
  check('Việc vừa đánh dấu biến mất khỏi widget (lớp phủ chờ Mac)', rs.length === 1, rs.length);

  // Mac xác nhận → không phủ nữa (dữ liệu Mac là nguồn chuẩn)
  files['/docs/gantt_actions_ack.json'] = JSON.stringify({ ids: [actions[0].id] });
  r = await run(files, { widget: true });
  check('Sau khi Mac xác nhận: widget theo dữ liệu Mac (không phủ nữa)', rows(r.widgets[0]).length === 2);

  // Chọn từ danh sách (widget nhỏ) + hoàn tác
  delete files['/docs/gantt_actions_ack.json'];
  r = await run(files, { choices: [3, 0] }); // menu chính → "Đánh dấu hoàn thành…" → việc đầu tiên
  actions = JSON.parse(files['/docs/gantt_actions.json']);
  check('Chọn từ danh sách: ghi thao tác hoàn thành', actions.length === 2 && actions[1].done === true && actions[1].kind === 'session_teach' && actions[1].courseId === 'c2', actions);
  r = await run(files, { choices: [4] }); // "Hoàn tác việc vừa xong"
  actions = JSON.parse(files['/docs/gantt_actions.json']);
  check('Hoàn tác: ghi thao tác done=false cho khối vừa xong', actions.length === 3 && actions[2].done === false && actions[2].kind === 'session_teach', actions);
  r = await run(files, { widget: true });
  check('Sau hoàn tác: buổi dạy hiện lại chưa xong, việc soạn bài vẫn ẩn', rows(r.widgets[0]).length === 1 && !rows(r.widgets[0])[0].children.some((c) => c.text === '✓'));

  // Buổi dạy hôm nay: bấm = hoàn thành, hiển thị ✓ thay vì biến mất
  const teach = { courseId: 'c2', kind: 'session_teach', idx: 0, guard: ds(0), label: 'x' };
  await run(files, { query: { toggle: JSON.stringify({ act: teach, done: true }) } });
  r = await run(files, { widget: true });
  const texts = rows(r.widgets[0]).map((x) => x.children.map((c) => c.text).join(' '));
  check('Buổi dạy đã xong hiện dấu ✓ (không biến mất)', texts.some((t) => t.includes('✓') && t.includes('Lớp B')), texts);

  // Dòng cuối: trạng thái đồng bộ về Mac
  const foot = (w) => w.children.filter((c) => !c.stack && typeof c.text === 'string').map((c) => c.text).pop();
  check('Dòng cuối báo số việc chờ Mac nhận', /⏳ \d+ việc chờ Mac/.test(foot(r.widgets[0])), foot(r.widgets[0]));
  actions = JSON.parse(files['/docs/gantt_actions.json']);
  files['/docs/gantt_actions_ack.json'] = JSON.stringify({ ids: actions.map((a) => a.id), at: '2026-10-21T07:05:00Z' });
  r = await run(files, { widget: true });
  check('Mac đã nhận hết: dòng cuối hiện giờ Mac nhận', /✓ Mac nhận \d\d:\d\d/.test(foot(r.widgets[0])), foot(r.widgets[0]));

  // Hoàn tác lùi dần: mỗi lần bỏ đánh dấu một việc "xong" gần nhất
  const f2 = { '/docs/gantt_courses.json': JSON.stringify(courses) };
  await run(f2, { query: { toggle: JSON.stringify({ act: { courseId: 'c1', kind: 'session_prep', idx: 0, guard: ds(1), label: 'A' }, done: true }) } });
  await run(f2, { query: { toggle: JSON.stringify({ act: { courseId: 'c2', kind: 'session_teach', idx: 0, guard: ds(0), label: 'B' }, done: true }) } });
  await run(f2, { choices: [4] });
  await run(f2, { choices: [4] });
  let a2 = JSON.parse(f2['/docs/gantt_actions.json']);
  check('Hoàn tác 2 lần: bỏ đánh dấu lần lượt B rồi A', a2.length === 4 && a2[2].label === 'B' && a2[2].done === false && a2[3].label === 'A' && a2[3].done === false, a2.map((a) => a.label + ':' + a.done));

  // Việc quá hạn, Submit nghiên cứu và sản phẩm tư vấn đến hạn hôm nay
  const more = [{
    id: 'c3', name: 'Lớp C', category: 'FSB', macroDays: 0, hasEvaluation: false,
    sessions: [{ num: 1, title: 'Buổi 1', prepStart: ds(-6), teachDate: ds(-3), prepDone: true }],
  }, {
    id: 'r1', name: 'Bài báo X', category: 'Nghiên cứu', submissions: [{ title: 'Submit Q1', date: ds(0) }, { title: 'Bản sửa', date: ds(9) }],
  }, {
    id: 'r2', name: 'Bài báo Y', category: 'Nghiên cứu', reviewStatus: 'review', submissions: [{ title: 'Chờ', date: ds(-2) }],
  }, {
    id: 't1', name: 'DN Z', category: 'Tư vấn doanh nghiệp', deliverables: [{ title: 'Báo cáo', date: ds(-1) }],
  }];
  const f3 = { '/docs/gantt_courses.json': JSON.stringify(more) };
  r = await run(f3, { widget: true, family: 'large' });
  rs = rows(r.widgets[0]);
  const t3 = rs.map((x) => x.children.map((c) => c.text).join(' '));
  check('Hôm nay: có Submit đến hạn + việc quá hạn (dạy C, sản phẩm Z); bỏ qua bài đang chờ review', rs.length === 3 &&
    t3.some((t) => t.includes('Submit') && t.includes('Submit Q1')) &&
    t3.some((t) => t.includes('⚠️') && t.includes('Lớp C') && t.includes('trễ 3 ngày')) &&
    t3.some((t) => t.includes('⚠️') && t.includes('DN Z')) && !t3.some((t) => t.includes('Bài báo Y')), t3);
  check('Dòng tóm tắt đếm việc quá hạn', r.widgets[0].children.some((c) => c.text && c.text.includes('⚠️ 2 quá hạn')));
  const req3 = rs.map((x) => JSON.parse(decodeURIComponent(x.url.split('toggle=')[1])));
  check('Dòng Submit / sản phẩm có URL hoàn thành đúng khối', req3.some((q) => q.act.kind === 'research_submit' && q.act.courseId === 'r1' && q.act.guard === ds(0)) &&
    req3.some((q) => q.act.kind === 'consulting_deliverable' && q.act.courseId === 't1'), req3);
  // Chọn nhiều việc liền: menu → Đánh dấu hoàn thành… → chọn 0 → chọn 0 → Xong
  await run(f3, { choices: [3, 0, 0, -1] });
  const a3 = JSON.parse(f3['/docs/gantt_actions.json']);
  check('Chọn nhiều việc trong một lần mở', a3.length === 2 && a3[0].courseId !== a3[1].courseId && a3.every((a) => a.done), a3);
  r = await run(f3, { widget: true, family: 'large' });
  check('Sau khi chọn: hai việc đã xong biến mất (lớp phủ), còn 1', rows(r.widgets[0]).length === 1, rows(r.widgets[0]).length);
  // Ngày khác hôm nay: không kèm việc quá hạn
  f3['/docs/gantt_focus.json'] = JSON.stringify({ date: ds(9), setOn: ds(0) });
  r = await run(f3, { widget: true, family: 'large' });
  const t4 = rows(r.widgets[0]).map((x) => x.children.map((c) => c.text).join(' '));
  check('Xem ngày khác: chỉ việc của ngày đó (Submit bản sửa), không kèm quá hạn', t4.length === 1 && t4[0].includes('Bản sửa'), t4);

  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
