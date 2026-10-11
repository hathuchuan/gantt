#!/usr/bin/env bash
# Kiểm thử "tắt app rồi mở lại vẫn còn dữ liệu" trên bản .app thật (WKWebView thật, không giả lập).
#
# Mỗi kịch bản chạy app 2 lần với cùng một thư mục dữ liệu:
#   lần 1 (write)  tạo dự án bằng đúng hàm của giao diện, rồi thoát theo một cách
#   lần 2 (verify) mở lại, đọc dữ liệu và đối chiếu (dữ liệu phải có sẵn trong tệp trên đĩa lúc mở app)
#
# Dùng:  macos/tests/persist.sh "macos/build/Academic Gantt.app" [direct|open]
#   direct  chạy thẳng tệp thực thi (mặc định)
#   open    chạy qua LaunchServices (`open -n -W`), giống hệt khi người dùng bấm đúp trong Finder
set -u

APP="${1:?Cần đường dẫn tới Academic Gantt.app}"
LAUNCHER="${2:-direct}"
BIN="$APP/Contents/MacOS/AcademicGantt"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gantt-persist.XXXXXX")"
failures=0

cleanup() {
  pkill -9 -f "Academic Gantt.app/Contents/MacOS/AcademicGantt" 2>/dev/null || true
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
fail() { say "FAIL $*"; failures=$((failures + 1)); }
pass() { say "PASS $*"; }

# Chạy lệnh có giới hạn thời gian (macOS không có sẵn `timeout`). Trả về mã thoát của lệnh.
run_limited() {
  local seconds="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$seconds"; kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid"
  local rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return $rc
}

# launch <tệp log> <tham số app...>   (chờ tới khi app thoát; ghi stdout vào tệp log)
launch() {
  local out="$1"; shift
  : > "$out"
  if [ "$LAUNCHER" = "open" ]; then
    run_limited 120 open -n -W --stdout "$out" --stderr "$out.err" -a "$APP" --args "$@"
  else
    run_limited 90 "$BIN" "$@" > "$out" 2>&1
  fi
}

show_dir() {
  local data="$1"
  say "--- thư mục dữ liệu: $data"
  ls -la "$data" "$data/backups" 2>/dev/null | sed 's/^/    /'
  if [ -f "$data/app.log" ]; then
    say "--- app.log"
    sed 's/^/    /' "$data/app.log"
  fi
}

# Kịch bản ghi -> thoát -> mở lại.  scenario <tên> <cách thoát: terminate|close|kill9|kill9-silent>
scenario() {
  local name="$1" mode="$2"
  local tag="$name-$LAUNCHER"
  local data="$WORK/$tag dữ liệu"      # cố ý có dấu cách và chữ có dấu
  mkdir -p "$data"
  local out_w="$WORK/$tag.write.log" out_v="$WORK/$tag.verify.log"
  say ""
  say "=== [$tag] ghi dữ liệu, thoát bằng '$mode', rồi mở lại"

  case "$mode" in
    terminate|close)
      local t0 t1
      t0=$(date +%s)
      launch "$out_w" --selftest-phase write --selftest-exit "$mode" --selftest-marker "$tag" --data-dir "$data"
      t1=$(date +%s)
      if ! grep -q "PERSIST-WRITTEN" "$out_w"; then
        fail "[$tag] không ghi được dữ liệu thử"; cat "$out_w"; show_dir "$data"; return
      fi
      if [ $((t1 - t0)) -gt 30 ]; then
        fail "[$tag] app không thoát kịp thời sau khi ra lệnh thoát ($((t1 - t0)) giây)"
      else
        pass "[$tag] app thoát gọn sau $((t1 - t0)) giây"
      fi
      ;;
    kill9|kill9-silent)
      # kill9: dữ liệu phải có trên đĩa NGAY nhờ đường ghi thường (không kịp thoát êm).
      # kill9-silent: chặn đường gửi tin nhắn; dữ liệu chỉ có nhờ lưới an toàn "kéo trạng thái từ trang" (5 giây/lần).
      local phase="write" wait_s=1
      if [ "$mode" = "kill9-silent" ]; then phase="write-silent"; wait_s=9; fi
      : > "$out_w"
      if [ "$LAUNCHER" = "open" ]; then
        open -n --stdout "$out_w" --stderr "$out_w.err" -a "$APP" --args --selftest-phase "$phase" --selftest-exit hold --selftest-marker "$tag" --data-dir "$data"
        sleep 2
      else
        "$BIN" --selftest-phase "$phase" --selftest-exit hold --selftest-marker "$tag" --data-dir "$data" > "$out_w" 2>&1 &
      fi
      local i
      for i in $(seq 1 60); do
        grep -q "PERSIST-WRITTEN" "$out_w" 2>/dev/null && break
        grep -q "^PERSIST FAIL" "$out_w" 2>/dev/null && break
        sleep 1
      done
      if ! grep -q "PERSIST-WRITTEN" "$out_w"; then
        fail "[$tag] không ghi được dữ liệu thử"; cat "$out_w"; show_dir "$data"; cleanup; return
      fi
      sleep "$wait_s"
      pkill -9 -f "Academic Gantt.app/Contents/MacOS/AcademicGantt" 2>/dev/null
      sleep 1
      say "(đã kill -9 app sau ${wait_s}s)"
      ;;
    *)
      fail "[$tag] cách thoát không hợp lệ: $mode"; return ;;
  esac

  launch "$out_v" --selftest-phase verify --selftest-marker "$tag" --data-dir "$data"
  if grep -q "^PERSIST PASS" "$out_v"; then
    pass "[$tag] mở lại: dữ liệu còn nguyên"
  else
    fail "[$tag] mở lại: MẤT hoặc SAI dữ liệu"
    cat "$out_v"
    show_dir "$data"
  fi
}

# Tệp storage.json hỏng / rỗng: phải tự khôi phục từ bản sao lưu.
scenario_recovery() {
  local tag="recovery-$LAUNCHER"
  local data="$WORK/$tag dữ liệu"
  mkdir -p "$data"
  say ""
  say "=== [$tag] storage.json hỏng hoặc rỗng -> khôi phục từ bản sao lưu"
  launch "$WORK/$tag.w.log" --selftest-phase write --selftest-exit terminate --selftest-marker "$tag" --data-dir "$data"
  grep -q "PERSIST-WRITTEN" "$WORK/$tag.w.log" || { fail "[$tag] không ghi được dữ liệu thử"; show_dir "$data"; return; }
  # lần mở này tạo bản sao lưu từ tệp còn tốt
  launch "$WORK/$tag.v1.log" --selftest-phase verify --selftest-marker "$tag" --data-dir "$data"
  grep -q "^PERSIST PASS" "$WORK/$tag.v1.log" || { fail "[$tag] mở lại lần 1 thất bại"; cat "$WORK/$tag.v1.log"; show_dir "$data"; return; }
  if ls "$data/backups"/storage-*.json >/dev/null 2>&1; then pass "[$tag] đã có bản sao lưu theo mốc thời gian"; else fail "[$tag] chưa có bản sao lưu"; fi

  printf '{"academic_smart_gantt": "[{broken' > "$data/storage.json"      # tệp bị cắt dở
  launch "$WORK/$tag.v2.log" --selftest-phase verify --selftest-marker "$tag" --data-dir "$data"
  if grep -q "^PERSIST PASS" "$WORK/$tag.v2.log" && grep -q "loadedFrom=backup" "$WORK/$tag.v2.log"; then
    pass "[$tag] tệp hỏng: tự khôi phục từ bản sao lưu"
  else
    fail "[$tag] tệp hỏng: không khôi phục được"; cat "$WORK/$tag.v2.log"; show_dir "$data"
  fi

  printf '{}' > "$data/storage.json"                                       # tệp bị xóa trắng
  launch "$WORK/$tag.v3.log" --selftest-phase verify --selftest-marker "$tag" --data-dir "$data"
  if grep -q "^PERSIST PASS" "$WORK/$tag.v3.log" && grep -q "loadedFrom=backup" "$WORK/$tag.v3.log"; then
    pass "[$tag] tệp rỗng: tự khôi phục từ bản sao lưu"
  else
    fail "[$tag] tệp rỗng: không khôi phục được"; cat "$WORK/$tag.v3.log"; show_dir "$data"
  fi
}

# Tải lại trang (Cmd+R) và khôi phục tiến trình web không được làm dữ liệu quay về bản lúc mở app.
scenario_reload() {
  local tag="reload-$LAUNCHER"
  local data="$WORK/$tag dữ liệu"
  mkdir -p "$data"
  say ""
  say "=== [$tag] Tải lại trang không làm mất bản mới nhất"
  launch "$WORK/$tag.log" --selftest-phase reload --data-dir "$data"
  if grep -q "^PERSIST PASS" "$WORK/$tag.log"; then
    pass "[$tag] $(grep '^PERSIST PASS' "$WORK/$tag.log" | head -1)"
  else
    fail "[$tag] dữ liệu bị cũ hoặc mất sau khi tải lại"; cat "$WORK/$tag.log"; show_dir "$data"
  fi
}

say "App: $APP"
say "Chạy bằng: $LAUNCHER"
say "Thư mục tạm: $WORK"

scenario terminate terminate
scenario close close
scenario kill9 kill9
scenario kill9-silent kill9-silent
scenario_recovery
scenario_reload

# In nhật ký của một kịch bản để dễ đọc trong log CI
show_dir "$WORK/terminate-$LAUNCHER dữ liệu"

say ""
if [ "$failures" -eq 0 ]; then
  say "TẤT CẢ KỊCH BẢN ĐỀU QUA ($LAUNCHER)"
  exit 0
fi
say "$failures KỊCH BẢN THẤT BẠI ($LAUNCHER)"
exit 1
