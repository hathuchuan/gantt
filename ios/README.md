# Widget iPhone — Tải công việc

1. Cài **Scriptable** (App Store, miễn phí) trên iPhone; bật iCloud Drive cho Scriptable.
2. Trên Mac: cập nhật Academic Gantt (bản mới ghi `gantt_courses.json` vào iCloud Drive → Scriptable mỗi lần lưu). Mở app và sửa/lưu 1 lần để tạo tệp.
3. Trong Scriptable: **+** → dán nội dung `ios/GanttWorkload.js` → đặt tên `GanttWorkload` (dán lại bản mới để có tính năng hoàn thành).
4. Màn hình chính: giữ → **+** → Scriptable → chọn cỡ → Edit Widget → Script: `GanttWorkload`.
5. Bấm vào nền widget → chọn Hôm nay / Ngày mai / ngày khác.

## Đánh dấu hoàn thành (đồng bộ về Mac)

- **Widget cỡ vừa / lớn:** bấm vào một dòng việc (○) → đánh dấu xong; Scriptable mở lên một lát rồi hiện widget đã cập nhật. Buổi dạy đã xong hiện ✓ (bấm lại để bỏ đánh dấu).
- **Widget nhỏ** (iOS chỉ cho một điểm chạm): bấm widget → **✅ Đánh dấu hoàn thành…** → chọn việc; danh sách hiện lại để chọn tiếp nhiều việc, bấm **Xong** để kết thúc. **↩️ Hoàn tác việc vừa xong** bỏ đánh dấu việc gần nhất (bấm tiếp để lùi thêm).
- **Việc đánh dấu được:** đề cương, soạn bài, buổi dạy, chấm thi, **Submit** (nghiên cứu) và **Sản phẩm** (tư vấn) đến hạn trong ngày đang xem. Khi xem **hôm nay**, widget kèm cả các việc **quá hạn** chưa xong (⚠️, ghi số ngày trễ) để đánh dấu luôn; dòng tóm tắt đếm số việc quá hạn.
- **Trạng thái đồng bộ:** dòng cuối widget hiện **⏳ N việc chờ Mac** (Mac chưa nhận) hoặc **✓ Mac nhận hh:mm** (lần app Mac xác nhận gần nhất). Menu khi bấm widget cũng ghi trạng thái này.
- **Cách đồng bộ:** widget ghi `gantt_actions.json` trong iCloud Drive/Scriptable. Academic Gantt trên Mac theo dõi thư mục này: áp dụng **ngay khi iCloud tải tệp về** (dự phòng: hỏi lại mỗi 15 giây, khi quay lại cửa sổ và khi đóng cửa sổ chỉnh sửa dự án), ghi `gantt_actions_ack.json` để xác nhận, rồi cập nhật `gantt_courses.json`. Mỗi tệp chỉ có một bên ghi nên iCloud không tạo bản xung đột; app Mac đọc/ghi qua cơ chế phối hợp tệp của iCloud và tự yêu cầu tải về nếu macOS đã "tối ưu dung lượng" tệp. Việc chưa được Mac xác nhận vẫn được widget ẩn/hiện ✓ ngay.
- **Trên Mac:** mỗi lần nhận, app báo `📱 iPhone: ✅ <việc>`; tab **🍎 Đồng Bộ Mac** → mục **📱 Widget iPhone → Mac** liệt kê các việc nhận gần đây (việc không còn khối tương ứng — đã xóa / đổi ngày — bị gạch ngang) và nút ↻ để đọc ngay. Thay đổi từ widget không nằm trong lịch sử ⌘Z.
- **Giới hạn:** cần mở app Academic Gantt trên Mac (cửa sổ có thể thu nhỏ) và iCloud Drive đã đồng bộ; iOS không cho nút bấm "trong widget" mà không mở Scriptable (đó là giới hạn của Scriptable, không phải của ứng dụng). Cách đi vòng nếu muốn không mở app: dùng Shortcuts + Siri gọi script `GanttWorkload`.
