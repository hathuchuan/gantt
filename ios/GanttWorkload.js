// Widget iPhone "Tải công việc" cho Academic Gantt Planner — chạy trong app Scriptable.
// Bấm vào widget → chọn ngày (hôm nay hoặc ngày khác) → widget hiển thị tải công việc ngày đó.
// Dữ liệu: gantt_courses.json do app Mac ghi vào iCloud Drive/Scriptable (xem ios/README.md).

const DATA_FILE = "gantt_courses.json";
const FOCUS_FILE = "gantt_focus.json";
const SCRIPT_NAME = Script.name();
const STAGES = {
  macro: { label: "Đề cương", color: "#a78bfa" },
  prep: { label: "Soạn bài", color: "#fb923c" },
  teach: { label: "Dạy", color: "#60a5fa" },
  eval: { label: "Chấm thi", color: "#34d399" },
};
const ORDER = { macro: 0, prep: 1, teach: 2, eval: 3 };

const fm = FileManager.iCloud();
const pad = (n) => String(n).padStart(2, "0");
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromStr = (s) => { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const vn = (s) => s.split("-").reverse().join("/");
const dayName = (s) => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][fromStr(s).getDay()];
const today = () => toStr(new Date());
const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); };

// ---- Ngày đang xem (tự về hôm nay khi sang ngày mới) ----
function readFocus() {
  try {
    const p = fm.joinPath(fm.documentsDirectory(), FOCUS_FILE);
    const f = JSON.parse(fm.readString(p));
    return f.setOn === today() ? f.date : today();
  } catch (e) { return today(); }
}
function writeFocus(date) {
  fm.writeString(fm.joinPath(fm.documentsDirectory(), FOCUS_FILE), JSON.stringify({ date, setOn: today() }));
}

// ---- Đọc dữ liệu ----
async function loadCourses() {
  const p = fm.joinPath(fm.documentsDirectory(), DATA_FILE);
  if (!fm.fileExists(p)) return null;
  if (!fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p);
  const raw = JSON.parse(fm.readString(p));
  return Array.isArray(raw) ? raw : null;
}

// ---- Tính tải công việc (giống updateWorkloadAlertBox trong web/academic_gantt_planner.html) ----
function theme(cat) {
  const l = String(cat || "").toLowerCase();
  if (l.includes("tư vấn")) return "tv";
  if (l.includes("nghiên cứu") || l.includes("đề tài")) return "nc";
  return "other";
}
function diff(a, b) { return Math.round((fromStr(b) - fromStr(a)) / 86400000); }
function fullyDone(c) {
  const s = c.sessions || [];
  let any = false;
  if ((parseInt(c.macroDays, 10) || 0) > 0 && s.length) { any = true; if (!c.macroDone) return false; }
  for (const x of s) {
    any = true;
    if (diff(x.prepStart, x.teachDate) > 0 && !x.prepDone) return false;
    if (!x.teachDone) return false;
  }
  if (c.hasEvaluation !== false) {
    for (const e of [c.evaluation, ...(c.extraEvaluations || [])]) {
      if (!e || !e.start || !e.end) continue;
      any = true;
      if (!e.done) return false;
    }
  }
  return any;
}
function timeRange(start, h) {
  const n = Math.round(parseFloat(h)); const dur = isNaN(n) ? 3 : n <= 1 ? 1 : n >= 3 ? 3 : 2;
  const st = String(start || "18:00").trim(); const p = st.split(":");
  if (p.length < 2 || isNaN(parseInt(p[0], 10))) return st;
  return `${st}-${pad((parseInt(p[0], 10) + dur) % 24)}:${p[1]}`;
}
function workFor(courses, f) {
  const items = [];
  const prep = new Set();
  for (const c of courses) {
    const t = theme(c.category);
    if (t !== "other" || fullyDone(c)) continue;
    const s = c.sessions || [];
    const md = parseInt(c.macroDays, 10) || 0;
    if (md > 0 && s.length && !c.macroDone) {
      const end = s[0].prepStart || s[0].teachDate;
      if (f >= addDays(end, -md) && f <= end) { items.push({ stage: "macro", name: c.name, detail: "Đề cương toàn khóa" }); prep.add(c.id); }
    }
    for (const x of s) {
      if (!x.prepDone && x.prepStart && x.teachDate && f >= x.prepStart && f < x.teachDate) {
        items.push({ stage: "prep", name: c.name, detail: `${x.title} (dạy ${vn(x.teachDate).slice(0, 5)})` });
        prep.add(c.id);
      }
    }
    if (s.length && f >= s[0].teachDate && f <= s[s.length - 1].teachDate) {
      const d = s.find((x) => x.teachDate === f);
      items.push({ stage: "teach", name: c.name, detail: d ? `${d.title} · ${timeRange(d.startTime || c.startTime, d.durationHours || c.durationHours)}` : "Đang trong kỳ dạy" });
    }
    if (c.hasEvaluation !== false) {
      for (const e of [c.evaluation, ...(c.extraEvaluations || [])]) {
        if (e && !e.done && e.start && e.end && f >= e.start && f <= e.end) {
          items.push({ stage: "eval", name: c.name, detail: `${e.name || "Chấm thi"} → ${vn(e.end).slice(0, 5)}` });
        }
      }
    }
  }
  items.sort((a, b) => ORDER[a.stage] - ORDER[b.stage]);
  return { items, prepCount: prep.size };
}

// ---- Widget ----
async function buildWidget(date) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0f172a");
  w.url = URLScheme.forRunningScript(); // bấm → chạy script trong app để chọn ngày
  w.setPadding(12, 14, 12, 14);

  const courses = await loadCourses();
  const isToday = date === today();
  const head = w.addText(isToday ? `Hôm nay · ${dayName(date)} ${vn(date).slice(0, 5)}` : `📅 ${dayName(date)} ${vn(date)}`);
  head.font = Font.boldSystemFont(13);
  head.textColor = new Color(isToday ? "#93c5fd" : "#fbbf24");

  if (!courses) {
    const t = w.addText("Chưa có dữ liệu. Mở app Mac Academic Gantt để xuất.");
    t.font = Font.systemFont(11); t.textColor = Color.white();
    return w;
  }
  const { items, prepCount } = workFor(courses, date);
  const red = prepCount >= 3;
  const sum = w.addText(red ? `🚨 Quá tải: ${prepCount} lớp đang chuẩn bị` : `🟢 Ổn định · ${items.length} việc`);
  sum.font = Font.semiboldSystemFont(12);
  sum.textColor = new Color(red ? "#f87171" : "#4ade80");
  w.addSpacer(5);

  const max = config.widgetFamily === "small" ? 3 : config.widgetFamily === "large" ? 11 : 5;
  if (!items.length) {
    const t = w.addText("Không có công việc.");
    t.font = Font.systemFont(11); t.textColor = new Color("#94a3b8");
  }
  items.slice(0, max).forEach((it, i) => {
    const r = w.addStack(); r.centerAlignContent(); r.spacing = 5;
    const tag = r.addText(STAGES[it.stage].label);
    tag.font = Font.boldSystemFont(9); tag.textColor = new Color(STAGES[it.stage].color);
    const txt = r.addText(config.widgetFamily === "small" ? it.name : `${it.name} — ${it.detail}`);
    txt.font = Font.systemFont(11); txt.textColor = Color.white(); txt.lineLimit = 1;
    w.addSpacer(2);
  });
  if (items.length > max) {
    const m = w.addText(`+${items.length - max} việc khác`);
    m.font = Font.systemFont(10); m.textColor = new Color("#94a3b8");
  }
  return w;
}

// ---- Chạy ----
if (config.runsInWidget) {
  Script.setWidget(await buildWidget(readFocus()));
} else {
  // Bấm vào widget (hoặc chạy trong app): chọn ngày
  const a = new Alert();
  a.title = "Xem tải công việc";
  a.message = `Đang xem: ${vn(readFocus())}`;
  a.addAction("Hôm nay");
  a.addAction("Ngày mai");
  a.addAction("Chọn ngày khác…");
  a.addCancelAction("Đóng");
  const i = await a.presentSheet();
  if (i >= 0) {
    let d = null;
    if (i === 0) d = today();
    else if (i === 1) d = addDays(today(), 1);
    else if (i === 2) { try { d = toStr(await DatePicker.pickDate(fromStr(readFocus()))); } catch (e) {} }
    if (d) {
      writeFocus(d);
      const w = await buildWidget(d);
      await w.presentMedium();
    }
  }
}
Script.complete();
