# Widget iPhone — Tải công việc

1. Cài **Scriptable** (App Store, miễn phí) trên iPhone; bật iCloud Drive cho Scriptable.
2. Trên Mac: cập nhật Academic Gantt (bản mới ghi `gantt_courses.json` vào iCloud Drive → Scriptable mỗi lần lưu). Mở app và sửa/lưu 1 lần để tạo tệp.
3. Trong Scriptable: **+** → dán nội dung `ios/GanttWorkload.js` → đặt tên `GanttWorkload` (dán lại bản mới để có tính năng hoàn thành).
4. Màn hình chính: giữ → **+** → Scriptable → chọn cỡ → Edit Widget → Script: `GanttWorkload`.
5. Bấm vào nền widget → chọn Hôm nay / Ngày mai / ngày khác.

## Đánh dấu hoàn thành (đồng bộ về Mac)

- **Widget cỡ vừa / lớn:** bấm vào một dòng việc (○) → đánh dấu xong; Scriptable mở lên một lát rồi hiện widget đã cập nhật. Buổi dạy đã xong hiện ✓ (bấm lại để bỏ đánh dấu).
- **Widget nhỏ** (iOS chỉ cho một điểm chạm): bấm widget → **✅ Đánh dấu hoàn thành…** → chọn việc. **↩️ Hoàn tác việc vừa xong** để bỏ đánh dấu.
- **Cách đồng bộ:** widget ghi `gantt_actions.json` trong iCloud Drive/Scriptable; Academic Gantt trên Mac đọc mỗi 15 giây (và khi quay lại cửa sổ), áp dụng vào dự án, ghi `gantt_actions_ack.json` để xác nhận, rồi cập nhật lại `gantt_courses.json`. Mỗi tệp chỉ có một bên ghi nên iCloud không tạo bản xung đột. Việc chưa được Mac xác nhận vẫn được widget ẩn/hiện ✓ ngay.
- **Giới hạn:** cần mở app Academic Gantt trên Mac (cửa sổ có thể thu nhỏ) và iCloud Drive đã đồng bộ; iOS không cho nút bấm "trong widget" mà không mở Scriptable (đó là giới hạn của Scriptable, không phải của ứng dụng). Cách đi vòng nếu muốn không mở app: dùng Shortcuts + Siri gọi script `GanttWorkload`.
