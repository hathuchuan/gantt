// Widget iPhone "Tải công việc" cho Academic Gantt Planner — chạy trong app Scriptable.
// Bấm vào widget → chọn ngày (hôm nay hoặc ngày khác) → widget hiển thị tải công việc ngày đó.
// Bấm vào một dòng việc (widget cỡ vừa / lớn) hoặc "Đánh dấu hoàn thành…" → đánh dấu xong, tự đồng bộ về app Mac.
// Hôm nay: kèm các việc quá hạn chưa xong (⚠️) để đánh dấu luôn; dòng cuối cho biết còn bao nhiêu việc chờ Mac nhận.
// Đồng bộ ngược: widget ghi gantt_actions.json; app Mac áp dụng rồi ghi gantt_actions_ack.json.
// Dữ liệu: gantt_courses.json do app Mac ghi vào iCloud Drive/Scriptable (xem ios/README.md).

const DATA_FILE = "gantt_courses.json";
const FOCUS_FILE = "gantt_focus.json";
const ACTIONS_FILE = "gantt_actions.json";      // widget ghi (chỉ widget ghi tệp này)
const ACK_FILE = "gantt_actions_ack.json";      // app Mac ghi (chỉ app Mac ghi tệp này)
const ACK_KEEP_MS = 60 * 60 * 1000;             // giữ thao tác đã được Mac xác nhận thêm 1 giờ rồi dọn
const SCRIPT_NAME = Script.name();
const STAGES = {
  macro: { label: "Đề cương", color: "#a78bfa" },
  prep: { label: "Soạn bài", color: "#fb923c" },
  teach: { label: "Dạy", color: "#60a5fa" },
  eval: { label: "Chấm thi", color: "#34d399" },
  submit: { label: "Submit", color: "#c084fc" },
  deliv: { label: "Sản phẩm", color: "#4ade80" },
};
const ORDER = { macro: 0, prep: 1, teach: 2, eval: 3, submit: 4, deliv: 5 };

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

// ---- Thao tác đánh dấu hoàn thành (widget → Mac) ----
function docPath(name) { return fm.joinPath(fm.documentsDirectory(), name); }
async function readJson(name, fallback) {
  try {
    const p = docPath(name);
    if (!fm.fileExists(p)) return fallback;
    if (!fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p);
    const v = JSON.parse(fm.readString(p));
    return v === null || v === undefined ? fallback : v;
  } catch (e) { return fallback; }
}
async function loadActions() {
  const raw = await readJson(ACTIONS_FILE, []);
  return Array.isArray(raw) ? raw : [];
}
async function loadAck() {
  const raw = await readJson(ACK_FILE, {});
  return { ids: new Set(Array.isArray(raw.ids) ? raw.ids : []), at: raw.at || null };
}
async function loadAckedIds() { return (await loadAck()).ids; }
const actionKey = (a) => [a.courseId, a.kind, a.idx, a.guard || ""].join("|");
// Ghi thêm một thao tác; dọn các thao tác Mac đã xác nhận từ lâu.
async function appendAction(act, done) {
  const actions = await loadActions();
  const acked = await loadAckedIds();
  const now = Date.now();
  const kept = actions.filter((a) => !(acked.has(a.id) && now - Date.parse(a.at || 0) > ACK_KEEP_MS));
  kept.push({
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    courseId: act.courseId, kind: act.kind, idx: act.idx, guard: act.guard || "",
    label: act.label || "", done: !!done, at: new Date(now).toISOString(),
  });
  fm.writeString(docPath(ACTIONS_FILE), JSON.stringify(kept));
  return kept;
}
// Áp thao tác lên bản sao dữ liệu (giống applyWidgetAction trong web/academic_gantt_planner.html)
function applyAction(courses, a) {
  const c = courses.find((x) => x.id === a.courseId);
  if (!c) return;
  const done = a.done !== false;
  if (a.kind === "session_teach" || a.kind === "session_prep") {
    const list = c.sessions || [];
    let s = list[a.idx];
    if (a.guard && (!s || s.teachDate !== a.guard)) s = list.find((x) => x.teachDate === a.guard);
    if (!s) return;
    if (a.kind === "session_teach") s.teachDone = done; else s.prepDone = done;
  } else if (a.kind === "macro") {
    c.macroDone = done;
  } else if (a.kind === "eval") {
    const evs = [c.evaluation, ...(c.extraEvaluations || [])];
    let e = evs[a.idx];
    if (a.guard && (!e || e.start !== a.guard)) e = evs.find((x) => x && x.start === a.guard);
    if (e) e.done = done;
  } else if (a.kind === "research_submit" || a.kind === "consulting_deliverable") {
    const list = (a.kind === "research_submit" ? c.submissions : c.deliverables) || [];
    let it = list[a.idx];
    if (a.guard && (!it || it.date !== a.guard)) it = list.find((x) => x && x.date === a.guard);
    if (it) it.done = done;
  }
}
async function overlayPendingActions(courses) {
  const actions = await loadActions();
  if (!actions.length) return actions;
  const acked = await loadAckedIds();
  actions
    .filter((a) => !acked.has(a.id))                       // đã được Mac xác nhận thì dữ liệu Mac đã phản ánh
    .sort((x, y) => String(x.at).localeCompare(String(y.at)))
    .forEach((a) => applyAction(courses, a));
  return actions;
}

// ---- Đọc dữ liệu ----
async function loadCourses() {
  const p = fm.joinPath(fm.documentsDirectory(), DATA_FILE);
  if (!fm.fileExists(p)) return null;
  if (!fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p);
  const raw = JSON.parse(fm.readString(p));
  if (!Array.isArray(raw)) return null;
  await overlayPendingActions(raw);
  return raw;
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
    if (t === "nc") {
      if (c.reviewStatus) continue; // đang chờ journal quyết định
      (c.submissions || []).forEach((x, i) => {
        if (x && !x.done && x.date === f) items.push({ stage: "submit", name: c.name, detail: x.title || `Submit lần ${i + 1}`,
          act: { courseId: c.id, kind: "research_submit", idx: i, guard: x.date, label: `${c.name} — ${x.title || "Submit"}` } });
      });
      continue;
    }
    if (t === "tv") {
      (c.deliverables || []).forEach((x, i) => {
        if (x && !x.done && x.date === f) items.push({ stage: "deliv", name: c.name, detail: x.title || `Sản phẩm ${i + 1}`,
          act: { courseId: c.id, kind: "consulting_deliverable", idx: i, guard: x.date, label: `${c.name} — ${x.title || "Sản phẩm"}` } });
      });
      continue;
    }
    if (fullyDone(c)) continue;
    const s = c.sessions || [];
    const md = parseInt(c.macroDays, 10) || 0;
    if (md > 0 && s.length && !c.macroDone) {
      const end = s[0].prepStart || s[0].teachDate;
      if (f >= addDays(end, -md) && f <= end) {
        items.push({ stage: "macro", name: c.name, detail: "Đề cương toàn khóa", act: { courseId: c.id, kind: "macro", idx: 0, guard: "", label: c.name + " — Đề cương" } });
        prep.add(c.id);
      }
    }
    s.forEach((x, i) => {
      if (!x.prepDone && x.prepStart && x.teachDate && f >= x.prepStart && f < x.teachDate) {
        items.push({ stage: "prep", name: c.name, detail: `${x.title} (dạy ${vn(x.teachDate).slice(0, 5)})`,
          act: { courseId: c.id, kind: "session_prep", idx: i, guard: x.teachDate, label: `${c.name} — Soạn ${x.title}` } });
        prep.add(c.id);
      }
    });
    if (s.length && f >= s[0].teachDate && f <= s[s.length - 1].teachDate) {
      const di = s.findIndex((x) => x.teachDate === f);
      const d = di >= 0 ? s[di] : null;
      items.push({ stage: "teach", name: c.name, done: !!(d && d.teachDone),
        detail: d ? `${d.title} · ${timeRange(d.startTime || c.startTime, d.durationHours || c.durationHours)}` : "Đang trong kỳ dạy",
        act: d ? { courseId: c.id, kind: "session_teach", idx: di, guard: d.teachDate, label: `${c.name} — Dạy ${d.title}` } : null });
    }
    if (c.hasEvaluation !== false) {
      [c.evaluation, ...(c.extraEvaluations || [])].forEach((e, i) => {
        if (e && !e.done && e.start && e.end && f >= e.start && f <= e.end) {
          items.push({ stage: "eval", name: c.name, detail: `${e.name || "Chấm thi"} → ${vn(e.end).slice(0, 5)}`,
            act: { courseId: c.id, kind: "eval", idx: i, guard: e.start, label: `${c.name} — ${e.name || "Chấm thi"}` } });
        }
      });
    }
  }
  items.sort((a, b) => ORDER[a.stage] - ORDER[b.stage]);
  // Đang xem hôm nay: thêm các việc đã quá hạn mà chưa đánh dấu (giống ô "Quá hạn" trên Mac)
  const late = f === today() ? overdueFor(courses, f).filter((o) => !items.some((it) => it.act && actionKey(it.act) === actionKey(o.act))) : [];
  return { items: items.concat(late), prepCount: prep.size, lateCount: late.length };
}

// Việc đã qua ngày kết thúc mà chưa xong (giống getOverdueBlocks trong web/academic_gantt_planner.html)
function overdueFor(courses, f) {
  const out = [];
  const push = (c, stage, detail, end, act) => {
    if (!end || end >= f) return;
    out.push({ stage, name: c.name, detail, late: diff(end, f), end, act: Object.assign({ courseId: c.id }, act) });
  };
  for (const c of courses) {
    const t = theme(c.category);
    if (t === "nc") {
      if (c.reviewStatus) continue;
      (c.submissions || []).forEach((x, i) => { if (x && !x.done) push(c, "submit", x.title || `Submit lần ${i + 1}`, x.date, { kind: "research_submit", idx: i, guard: x.date, label: `${c.name} — ${x.title || "Submit"}` }); });
    } else if (t === "tv") {
      (c.deliverables || []).forEach((x, i) => { if (x && !x.done) push(c, "deliv", x.title || `Sản phẩm ${i + 1}`, x.date, { kind: "consulting_deliverable", idx: i, guard: x.date, label: `${c.name} — ${x.title || "Sản phẩm"}` }); });
    } else {
      const s = c.sessions || [];
      const md = parseInt(c.macroDays, 10) || 0;
      if (md > 0 && s.length && !c.macroDone) push(c, "macro", "Đề cương toàn khóa", addDays(s[0].prepStart || s[0].teachDate, -1), { kind: "macro", idx: 0, guard: "", label: c.name + " — Đề cương" });
      s.forEach((x, i) => {
        const title = x.title || `Buổi ${x.num || i + 1}`;
        if (diff(x.prepStart, x.teachDate) > 0 && !x.prepDone) push(c, "prep", `Soạn ${title}`, addDays(x.teachDate, -1), { kind: "session_prep", idx: i, guard: x.teachDate, label: `${c.name} — Soạn ${title}` });
        if (!x.teachDone) push(c, "teach", `Dạy ${title}`, x.teachDate, { kind: "session_teach", idx: i, guard: x.teachDate, label: `${c.name} — Dạy ${title}` });
      });
      if (c.hasEvaluation !== false) {
        [c.evaluation, ...(c.extraEvaluations || [])].forEach((e, i) => {
          if (e && !e.done && e.start && e.end) push(c, "eval", e.name || "Chấm thi", e.end, { kind: "eval", idx: i, guard: e.start, label: `${c.name} — ${e.name || "Chấm thi"}` });
        });
      }
    }
  }
  out.sort((a, b) => a.end.localeCompare(b.end));
  return out;
}

// Trạng thái đồng bộ về Mac: số việc widget đã ghi mà Mac chưa xác nhận, giờ Mac xác nhận gần nhất.
async function syncStatus() {
  const actions = await loadActions();
  const ack = await loadAck();
  const pending = actions.filter((a) => !ack.ids.has(a.id)).length;
  let at = null;
  if (ack.at) { const d = new Date(ack.at); if (!isNaN(d)) at = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  return { pending, at };
}

// ---- Widget ----
async function buildWidget(date) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0f172a");
  w.url = URLScheme.forRunningScript(); // bấm → chạy script trong app để chọn ngày
  w.setPadding(12, 14, 12, 14);
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

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
  const { items, prepCount, lateCount } = workFor(courses, date);
  const red = prepCount >= 3;
  const lateTxt = lateCount ? ` · ⚠️ ${lateCount} quá hạn` : "";
  const sum = w.addText((red ? `🚨 Quá tải: ${prepCount} lớp đang chuẩn bị` : `🟢 Ổn định · ${items.length - lateCount} việc`) + lateTxt);
  sum.font = Font.semiboldSystemFont(12);
  sum.textColor = new Color(red ? "#f87171" : "#4ade80");
  w.addSpacer(5);

  const max = config.widgetFamily === "small" ? 3 : config.widgetFamily === "large" ? 11 : 5;
  if (!items.length) {
    const t = w.addText("Không có công việc.");
    t.font = Font.systemFont(11); t.textColor = new Color("#94a3b8");
  }
  const small = config.widgetFamily === "small";
  items.slice(0, max).forEach((it, i) => {
    const r = w.addStack(); r.centerAlignContent(); r.spacing = 5;
    // Widget cỡ vừa / lớn: bấm vào dòng việc = đánh dấu hoàn thành (hoặc bỏ đánh dấu nếu đã xong)
    if (!small && it.act) r.url = URLScheme.forRunningScript() + "?toggle=" + encodeURIComponent(JSON.stringify({ act: it.act, done: !it.done }));
    if (it.act) {
      const box = r.addText(it.done ? "✓" : "○");
      box.font = Font.boldSystemFont(11); box.textColor = new Color(it.done ? "#4ade80" : "#64748b");
    }
    const tag = r.addText((it.late ? "⚠️" : "") + STAGES[it.stage].label);
    tag.font = Font.boldSystemFont(9); tag.textColor = new Color(it.late ? "#fb923c" : STAGES[it.stage].color);
    const txt = r.addText(small ? it.name : `${it.name} — ${it.detail}${it.late ? ` (trễ ${it.late} ngày)` : ""}`);
    txt.font = Font.systemFont(11); txt.textColor = it.done ? new Color("#64748b") : Color.white(); txt.lineLimit = 1;
    w.addSpacer(2);
  });
  // Dòng cuối: số việc còn lại + trạng thái đồng bộ về Mac (gộp một dòng để vừa widget cỡ vừa)
  const st = await syncStatus();
  const foot = [];
  if (items.length > max) foot.push(`+${items.length - max} việc khác`);
  else if (!small && items.some((it) => it.act)) foot.push("Chạm ○ để hoàn thành");
  if (st.pending) foot.push(`⏳ ${st.pending} việc chờ Mac`);
  else if (st.at) foot.push(`✓ Mac nhận ${st.at}`);
  if (foot.length) {
    const m = w.addText(foot.join(" · "));
    m.font = Font.systemFont(9); m.textColor = new Color(st.pending ? "#fbbf24" : "#94a3b8"); m.lineLimit = 1;
  }
  return w;
}

// ---- Đánh dấu hoàn thành ----
async function showWidget(date) {
  const w = await buildWidget(date);
  if (config.widgetFamily === "small") await w.presentSmall();
  else if (config.widgetFamily === "large") await w.presentLarge();
  else await w.presentMedium();
}
async function toggleFromURL(param) {
  let req;
  try { req = JSON.parse(param); } catch (e) { return; }
  if (!req || !req.act) return;
  await appendAction(req.act, req.done);
  const n = new Notification();
  n.title = req.done ? "✅ Đã đánh dấu hoàn thành" : "↩️ Đã bỏ đánh dấu";
  n.body = (req.act.label || "") + " — sẽ đồng bộ về app Mac";
  n.sound = null;
  await n.schedule();
  await showWidget(readFocus());
}
// Chọn lần lượt nhiều việc: danh sách hiện lại sau mỗi lần chọn, bấm "Xong" để kết thúc.
async function pickToComplete(date) {
  let marked = 0;
  for (;;) {
    const courses = await loadCourses();
    if (!courses) return;
    const { items } = workFor(courses, date);
    const pending = items.filter((it) => it.act && !it.done);
    const a = new Alert();
    a.title = "Đánh dấu hoàn thành";
    a.message = pending.length
      ? `Việc ngày ${vn(date)} — chọn việc đã xong${marked ? ` (đã đánh dấu ${marked})` : ""}`
      : (marked ? `Đã đánh dấu ${marked} việc.` : "Không còn việc nào chưa xong.");
    pending.forEach((it) => a.addAction(`${it.late ? "⚠️ " : ""}${STAGES[it.stage].label} · ${it.name} — ${it.detail}`));
    a.addCancelAction(marked ? "Xong" : "Đóng");
    const i = await a.presentSheet();
    if (i < 0 || i >= pending.length) break;
    await appendAction(pending[i].act, true);
    marked++;
  }
  if (marked) await showWidget(date);
}
// Bỏ đánh dấu việc gần nhất còn đang ở trạng thái "xong" (bấm nhiều lần để lùi tiếp).
async function undoLast() {
  const actions = await loadActions();
  const latest = new Map();
  actions.forEach((a) => latest.set(actionKey(a), a));
  const last = [...latest.values()].filter((a) => a.done).sort((x, y) => String(x.at).localeCompare(String(y.at))).pop();
  if (!last) {
    const a = new Alert(); a.title = "Không có việc nào để hoàn tác"; a.addCancelAction("Đóng"); await a.presentAlert();
    return;
  }
  await appendAction(last, false);
  const n = new Notification();
  n.title = "↩️ Đã bỏ đánh dấu";
  n.body = (last.label || "") + " — sẽ đồng bộ về app Mac";
  n.sound = null;
  await n.schedule();
  await showWidget(readFocus());
}

// ---- Chạy ----
if (config.runsInWidget) {
  Script.setWidget(await buildWidget(readFocus()));
} else if (args.queryParameters && args.queryParameters.toggle) {
  await toggleFromURL(args.queryParameters.toggle);
} else {
  // Bấm vào widget (hoặc chạy trong app): chọn ngày / đánh dấu hoàn thành
  const a = new Alert();
  a.title = "Tải công việc";
  const st = await syncStatus();
  a.message = `Đang xem: ${vn(readFocus())}` + (st.pending ? `\n⏳ ${st.pending} việc chờ app Mac nhận` : (st.at ? `\n✓ App Mac nhận lần cuối lúc ${st.at}` : ""));
  a.addAction("Hôm nay");
  a.addAction("Ngày mai");
  a.addAction("Chọn ngày khác…");
  a.addAction("✅ Đánh dấu hoàn thành…");
  a.addAction("↩️ Hoàn tác việc vừa xong");
  a.addCancelAction("Đóng");
  const i = await a.presentSheet();
  if (i >= 0 && i <= 2) {
    let d = null;
    if (i === 0) d = today();
    else if (i === 1) d = addDays(today(), 1);
    else if (i === 2) { try { d = toStr(await DatePicker.pickDate(fromStr(readFocus()))); } catch (e) {} }
    if (d) {
      writeFocus(d);
      await showWidget(d);
    }
  } else if (i === 3) {
    await pickToComplete(readFocus());
  } else if (i === 4) {
    await undoLast();
  }
}
Script.complete();
