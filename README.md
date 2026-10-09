# Academic Gantt Planner — ứng dụng macOS

Ứng dụng macOS độc lập: giao diện Gantt (`web/academic_gantt_planner.html`) chạy trong cửa sổ riêng và **đọc trực tiếp Apple Calendar qua EventKit**. Không cần Python, Terminal hay `sync_server.py`.

## 1. Cài đặt trên máy bất kỳ (macOS 11 trở lên, Apple Silicon hoặc Intel)

1. Lấy tệp `AcademicGantt-<phiên bản>.dmg`:
   - GitHub → **Releases** → tải DMG; hoặc
   - GitHub → **Actions** → lượt chạy "Build macOS app" mới nhất → **Artifacts** → `AcademicGantt-macOS` (tệp zip chứa DMG).
2. Mở DMG → kéo **Academic Gantt** vào thư mục **Applications**.
3. Mở lần đầu: macOS báo *"Apple không thể xác minh…"* vì ứng dụng chưa được Apple công chứng (notarize).
   - Bấm **Done** → **System Settings → Privacy & Security** → kéo xuống, bấm **Open Anyway** → nhập mật khẩu máy.
   - Hoặc chạy 1 lệnh trong Terminal: `xattr -dr com.apple.quarantine "/Applications/Academic Gantt.app"`
4. Trong ứng dụng: tab **🍎 Đồng Bộ Mac** → bấm **Allow / Cho phép** khi được hỏi quyền Lịch → tick các lịch cần lấy → **🔄 Kéo Lịch Từ Apple Calendar**.

Bước 3 chỉ làm 1 lần cho mỗi máy.

## 2. Chuyển dữ liệu từ bản HTML cũ

Dữ liệu cũ nằm trong trình duyệt, ứng dụng không tự đọc được:

1. Mở bản HTML cũ trong trình duyệt → **📥 Xuất JSON**.
2. Mở ứng dụng → **📤 Nạp JSON** → chọn tệp vừa xuất.

## 3. Dữ liệu được lưu ở đâu

- `~/Library/Application Support/AcademicGantt/storage.json` — ghi lại sau mỗi thay đổi.
- `storage.backup.json` — bản của lần mở trước.
- Mở nhanh: menu **Tệp → Mở thư mục dữ liệu**.

## 4. Những gì thay đổi so với `sync_server.py`

| Hạng mục | Trước (HTML + `sync_server.py`) | Nay (ứng dụng) |
|---|---|---|
| Cách chạy | Chạy Python trong Terminal + mở HTML | Mở 1 ứng dụng |
| Đọc lịch | AppleScript (chậm), cổng `127.0.0.1:8765` | EventKit (nhanh), không mở cổng mạng |
| Sự kiện lặp lại | Tự phân tích RRULE (chỉ DAILY/WEEKLY) | macOS tự khai triển mọi kiểu lặp, kể cả buổi bị hủy/dời |
| Chọn lịch | Cố định theo tên: FSB, RMIT, Outlook, Calendar, Lịch, Work | Danh sách tick chọn; mặc định tick theo đúng các từ khóa trên |
| Địa điểm, giờ học | Không lấy | Lấy địa điểm, giờ bắt đầu, thời lượng |
| Phạm vi | Hôm nay → +180 ngày | Giữ nguyên |

Tệp HTML vẫn mở được bằng trình duyệt như cũ: khi đó nó dùng `legacy/sync_server.py`.

## 5. Build phiên bản mới

- **Tự động (khuyến nghị):** push lên GitHub → workflow `Build macOS app` build DMG, chạy tự kiểm tra, đưa DMG vào Artifacts. Muốn có link tải cố định: tạo **Release** với tag dạng `v3.1.0` → DMG được gắn vào Release, số phiên bản lấy từ tag.
- **Trên máy Mac:** cài Xcode Command Line Tools một lần (`xcode-select --install`), rồi chạy `./macos/build.sh`. Kết quả nằm trong `macos/build/`.
- **Sửa giao diện:** chỉ sửa `web/academic_gantt_planner.html` rồi build lại.

## 6. Xử lý sự cố

- **Không đọc được lịch:** System Settings → Privacy & Security → Calendars → bật **Academic Gantt** (Full Access).
- **Cập nhật bản mới xong thì mất quyền Lịch:** chạy `tccutil reset Calendar com.hathuchuan.academic-gantt`, mở lại ứng dụng và cấp quyền lại.
- **Muốn bỏ hẳn cảnh báo ở bước 3:** cần tài khoản Apple Developer (99 USD/năm) để ký Developer ID và notarize.

## Cấu trúc thư mục

```
web/academic_gantt_planner.html   Giao diện (dùng chung cho ứng dụng và trình duyệt)
macos/Sources/*.swift             Ứng dụng: cửa sổ WebView, EventKit, lưu dữ liệu
macos/Resources/bridge.js         Cầu nối JS ↔ macOS (window.GanttNative)
macos/Info.plist, AppIcon.png     Thông tin gói và biểu tượng
macos/build.sh                    Build .app universal + DMG
.github/workflows/build-macos.yml Build tự động trên GitHub Actions
legacy/sync_server.py             Server cũ, chỉ cần khi mở HTML bằng trình duyệt
```
