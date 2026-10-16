# Academic Suite — Academic Gantt + MD Editor

Một repo, một bộ cài, hai ứng dụng macOS:

| Ứng dụng | Thư mục | Dùng để |
|---|---|---|
| **Academic Gantt** | `web/`, `macos/` | Lập kế hoạch giảng dạy / nghiên cứu / tư vấn trên Gantt, đọc Apple Calendar |
| **MD Editor** | `md-editor/` | Soạn ghi chú Markdown; mỗi ghi chú một cửa sổ riêng |

**Cài đặt một lần:** tải `AcademicSuite-<phiên bản>.dmg` (GitHub → Releases, hoặc Actions → artifact `AcademicSuite-macOS`), kéo cả hai ứng dụng vào Applications.

- **Dùng độc lập:** mỗi ứng dụng chạy riêng được, không cần ứng dụng kia.
- **Dùng cùng nhau:** ⌘-nhấp một khối trên Gantt → mở đúng ghi chú của khối trong MD Editor (chưa có thì tạo mới); trong MD Editor `⇧⌘G` → nhảy tới khối trên Gantt. Mở mỗi ứng dụng ít nhất một lần sau khi cài để macOS đăng ký liên kết.
- **Build bộ cài:** `./scripts/build-suite.sh` → `dist/AcademicSuite-<phiên bản>.dmg` (CI tự chạy ở job `suite`). Chi tiết riêng từng app: bên dưới (Gantt) và `md-editor/README.md`.

---

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

Thư mục dữ liệu: `~/Library/Application Support/AcademicGantt/` (mở nhanh bằng menu **Tệp → Mở thư mục dữ liệu**).

| Tệp / thư mục | Nội dung |
|---|---|
| `storage.json` | Dữ liệu chính. Ghi xuống đĩa ngay sau mỗi thay đổi (gộp trong 0,2 giây). Đây là nguồn chuẩn: lần mở sau app đọc từ đây. |
| `backups/` | Bản sao lưu tự động: mỗi lần mở app (nếu dữ liệu đã đổi), giữ 20 bản mới nhất. Ngoài ra có bản `...-import.json` được tạo ngay trước khi **Nạp JSON**. |
| `app.log` | Nhật ký chẩn đoán (đọc được gì lúc mở, ghi gì, thoát ra sao). Không chứa nội dung dự án. |
| `storage.bad-*.json` | Bản `storage.json` bị hỏng/rỗng đã được cất đi khi app tự khôi phục từ `backups/`. |

Cách app giữ dữ liệu an toàn:

- Mỗi lần lưu, app chỉ báo **💾 Đã lưu hh:mm:ss** (góc trên bên phải) sau khi dữ liệu đã nằm trên đĩa. Nếu không ghi được, chỉ báo chuyển đỏ **⚠️ Chưa lưu được dữ liệu**; khi đó hãy bấm **Xuất JSON** để sao lưu thủ công.
- Cứ 5 giây, khi app mất focus và khi thoát, app kéo thêm trạng thái trong bộ nhớ của trang ra đĩa (lưới an toàn).
- Ngoài `storage.json`, trang còn giữ một bản dự phòng trong bộ nhớ của WebView (`~/Library/WebKit/com.hathuchuan.academic-gantt`). Nếu `storage.json` và `backups/` đều mất, app tự lấy lại từ bản dự phòng này. Vì vậy chỉ xóa thư mục `AcademicGantt` thì dữ liệu sẽ được khôi phục lại từ bản dự phòng; muốn xóa một dự án hãy dùng nút xóa trong cửa sổ chỉnh sửa dự án.
- **Tải lại trang** (`⌘R`) và khi tiến trình web bị dừng, trang luôn được nạp với bản mới nhất trên đĩa, không quay về bản lúc mở app.
- `storage.json` thiếu / hỏng / rỗng mà đã có bản sao lưu → app tự khôi phục từ bản sao lưu mới nhất.
- Dữ liệu đã lưu nhưng không đọc được → bản gốc được cất nguyên vẹn ở khóa `academic_smart_gantt_unreadable_<thời gian>` trong `storage.json` và app báo cho bạn; app **không** lặng lẽ thay bằng dữ liệu mẫu rồi ghi đè.

### Khôi phục dữ liệu từ bản sao lưu

1. **Tệp → Mở thư mục dữ liệu** → vào `backups/` → chọn bản gần ngày bạn cần (tên có dạng `storage-20261011-054535.json`).
2. Trong app bấm **📤 Nạp JSON** → chọn tệp đó. **Nạp JSON** nhận cả tệp bạn xuất bằng **Xuất JSON** lẫn tệp `storage.json` / bản sao lưu của chính app.

## 3b. Có gì mới ở bản 3.1.x

- **Tải công việc:** mỗi công việc một dòng đánh số, màu chữ theo công đoạn (đề cương / soạn bài / giảng dạy / chấm thi).
- **Cảnh báo quá hạn:** khối công việc đã qua ngày kết thúc mà chưa đánh dấu hoàn thành sẽ có viền cam nhấp nháy + dấu `!` trên thanh Gantt, và được liệt kê trong ô Tải công việc (bấm vào để mở dự án).
- **Dự án nghiên cứu:** thêm trạng thái **⏳ Chờ review** và **❌ Rejected** (chọn trong cửa sổ chỉnh sửa). Thêm lần Submit mới sẽ tự bỏ trạng thái này.
- **Địa điểm:** thêm **Online** (tự nhận diện Zoom / Teams / Meet khi kéo từ Calendar).
- **Thời lượng:** 3 mức 3 / 2 / 1 tiếng.
- **Phím Esc** đóng cửa sổ chỉnh sửa dự án.
- **Sửa lỗi mất dữ liệu sau khi tắt/mở lại app** (xem mục 3): lưu có xác nhận + chỉ báo, nạp lại đúng bản mới nhất khi Tải lại, sao lưu tự động, tự khôi phục khi tệp hỏng, không ghi đè dữ liệu không đọc được.
- **Sửa nút Nạp JSON / chọn tệp .ics không phản ứng:** nay dùng hộp thoại chọn tệp của macOS; báo lỗi rõ ràng khi tệp sai (không còn im lặng); nhận cả `storage.json`; sao lưu trước khi thay thế dữ liệu.

## 3c. Ghi chú Markdown cho từng khối (liên kết 2 chiều với MD Editor)

- **⌘-nhấp** vào một thanh trên Gantt (hoặc nhấp biểu tượng 📄 trên thanh) → mở ghi chú của khối đó trong **MD Editor**; chưa có thì MD Editor tự tạo ghi chú mới rồi gửi đường dẫn về Gantt. Nhấp thường vẫn là đánh dấu hoàn thành.
- Từ MD Editor: `⇧⌘G` (hoặc bấm nhãn trên Preview) → Gantt hiện ra, cuộn tới đúng khối và nhấp nháy. `⇧⌘E` / `/gantt` để gắn một ghi chú có sẵn vào khối.
- Hai ứng dụng nói chuyện qua URL: `mdeditor://note?...` (Gantt → MD Editor) và `academicgantt://open|link|unlink?block=...` (MD Editor → Gantt). Mã khối có dạng `<mã dự án>|<loại>|<số>`.
- Liên kết lưu ở khóa `academic_smart_gantt_notes` trong `storage.json` (tách khỏi danh sách dự án nên không mất khi đồng bộ Calendar). **Xuất JSON** có thêm mục `noteLinks` (mã khối → đường dẫn ghi chú); **Nạp JSON** khôi phục lại các liên kết này.

## 3d. Giao diện mới

- **Cột trái:** lớp **giảng hôm nay** tô xanh lục đậm (kèm giờ giảng); lớp **đang trong kỳ giảng dạy** (hôm nay nằm giữa buổi đầu và buổi cuối nhưng không có buổi giảng) tô xanh lam nhạt.
- **Hôm nay:** cột hôm nay tô hồng nhạt trong suốt (không còn đường kẻ đỏ).
- **Sáng / Tối:** nút ở đầu trang; mặc định theo giao diện macOS, lựa chọn thủ công được ghi nhớ.
- **Công việc theo tuần / tháng:** nút **📋 Tuần / 📋 Tháng** trên thanh công cụ mở danh sách công việc kèm ngày (đề cương, soạn bài, giảng dạy, chấm thi, submit, sản phẩm), có ‹ › để đổi kỳ, tick để hoàn thành.
- **Ghi chú dự án:** nút **📝 Thêm ghi chú / 📄 Mở ghi chú** trong cửa sổ chỉnh sửa dự án mở MD Editor (khối `<mã dự án>|project|0`).
- **Tự cập nhật Apple Calendar:** khi mở ứng dụng, khi quay lại cửa sổ và mỗi 5 phút (các lịch đã chọn ở tab 🍎 Đồng Bộ Mac; cần bấm "Kéo Lịch" một lần để ghi nhớ lịch). Tắt được bằng ô tick trong tab đó.
- **Menu chuột phải:** trên khối (hoàn thành, ghi chú, chỉnh sửa, xem tuần/tháng), trên dự án ở cột trái (chỉnh sửa, ghi chú, hoàn thành cả dự án, tới khối kế tiếp, xóa), trên đầu cột ngày / vùng trống (chi tiết ngày, tải công việc, tuần/tháng, về hôm nay).

## 3e. Bản mới: phân loại màu, kéo-thả, hoàn tác, tìm kiếm

- **Phân loại & màu (không còn MBA / ĐH / DN):** event từ lịch **FSB** → xanh dương; **RMIT** → đỏ; **Outlook** (mọi lịch còn lại) → hồng nhạt; **Tư vấn doanh nghiệp** → xanh lá; **Nghiên cứu** → tím. Dữ liệu cũ tự quy đổi theo tiền tố tên (FSB…/RMIT…), còn lại thành Outlook. Đổi loại bất kỳ lúc nào trong cửa sổ chỉnh sửa dự án.
- **Màu dòng:** mỗi dòng mang màu của loại dự án (không còn xen kẽ trắng/xanh); hai dòng liền nhau cùng loại thay phiên hai sắc độ cùng tông. Dự án **đã hoàn thành** tô **xám**.
- **Kéo-thả:** kéo thanh để dời (buổi dạy / mốc Submit / sản phẩm / chấm thi; kéo buổi dạy thì ngày soạn bài đi theo); kéo **mép trái** thanh *soạn bài* hoặc *đề cương* để đổi độ dài; kéo **hai mép** thanh *chấm thi*. `Esc` khi đang kéo = hủy. Nhấp thường vẫn là đánh dấu hoàn thành. Lưu ý: buổi đã dời khỏi ngày trên Calendar sẽ được đồng bộ Calendar thêm lại ở ngày gốc (giống khi sửa ngày buổi trong cửa sổ chỉnh sửa).
- **⌘Z / ⇧⌘Z:** hoàn tác / làm lại mọi chỉnh sửa (kéo-thả, hoàn thành, sửa, xóa, nạp JSON…; tối đa 100 bước). Đang gõ chữ trong ô nhập thì ⌘Z là của ô nhập. Cập nhật tự động từ Calendar và từ widget không nằm trong lịch sử hoàn tác.
- **Sáng / Tối:** nút ở đầu trang xoay vòng **🌗 Tự động** (theo macOS, đổi ngay khi hệ thống đổi) → Sáng/Tối cố định → Tự động.
- **Tìm kiếm toàn cục & lọc:** ô tìm ở đầu biểu đồ (`⌘F`, không phân biệt dấu) tìm trong tên dự án, buổi, địa điểm, tạp chí, ghi chú; danh sách kết quả bấm để nhảy tới khối. Kết hợp với lọc **loại** (chip màu), **trạng thái** (chưa xong / đang diễn ra / sắp tới / quá hạn / chờ review / hoàn thành) và **địa điểm**; nút **✕ Bỏ lọc**.
- **Cảnh báo xung đột lịch:** hộp *Xung đột lịch* ở cột trái liệt kê (1) buổi giảng **trùng giờ** (thanh bị viền đỏ + ⚠️) và (2) tuần **quá tải** — quá 12 giờ giảng/tuần (đổi ngưỡng bằng nút ⚙️ Ngưỡng) hoặc có ngày ≥ 3 lớp cùng chuẩn bị (đầu cột thứ Hai của tuần đó có vạch cam 📊). Bấm một dòng để tới ngày đó.
- **Ô Tải công việc:** bấm vào **bất kỳ dòng công việc** (kể cả mục quá hạn) → mở/tạo ghi chú Markdown của khối; **chuột phải** → thêm/mở ghi chú hoặc chỉnh sửa dự án (và hoàn thành, xem tuần/tháng).
- **Widget iPhone:** có thể đánh dấu hoàn thành và tự đồng bộ về app Mac — xem `ios/README.md`.

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

- **Tự động (khuyến nghị):** push lên GitHub → workflow `Build macOS app` build DMG, chạy tự kiểm tra và bộ kiểm thử "tắt/mở lại app" (`macos/tests/persist.sh`, chạy app thật rồi thoát bằng ⌘Q / đóng cửa sổ / `kill -9` / tệp hỏng / tải lại trang), đưa DMG vào Artifacts. Muốn có link tải cố định: tạo **Release** với tag dạng `v3.1.1` → DMG được gắn vào Release, số phiên bản lấy từ tag.
- **Kiểm thử giao diện (Chromium):** `cd tests/web && npm install && npx playwright install chromium && node run.js` (cũng chạy tự động trên GitHub Actions). Các bộ test kiểm tra tải công việc, quá hạn, trạng thái review, địa điểm Online, thời lượng, phím Esc, nạp/xuất JSON, lưu dữ liệu và khôi phục khi dữ liệu hỏng, phân loại màu, kéo-thả, hoàn tác, xung đột lịch, tìm kiếm/lọc và widget iPhone.
- **Trên máy Mac:** cài Xcode Command Line Tools một lần (`xcode-select --install`), rồi chạy `./macos/build.sh`. Kết quả nằm trong `macos/build/`.
- **Sửa giao diện:** chỉ sửa `web/academic_gantt_planner.html` rồi build lại.

## 6. Xử lý sự cố

- **Mất dữ liệu sau khi mở lại app:** mở **Tệp → Mở thư mục dữ liệu**, xem `backups/` và làm theo mục "Khôi phục dữ liệu từ bản sao lưu". Nếu vẫn lặp lại, gửi tệp `app.log` (không chứa nội dung dự án) để biết app đã đọc/ghi gì.
- **Không đọc được lịch:** System Settings → Privacy & Security → Calendars → bật **Academic Gantt** (Full Access).
- **Cập nhật bản mới xong thì mất quyền Lịch:** chạy `tccutil reset Calendar com.hathuchuan.academic-gantt`, mở lại ứng dụng và cấp quyền lại.
- **Muốn bỏ hẳn cảnh báo ở bước 3:** cần tài khoản Apple Developer (99 USD/năm) để ký Developer ID và notarize.

## Cấu trúc thư mục

```
web/academic_gantt_planner.html   Giao diện (dùng chung cho ứng dụng và trình duyệt)
macos/Sources/*.swift             Ứng dụng: cửa sổ WebView, EventKit, lưu dữ liệu
macos/Resources/bridge.js         Cầu nối JS ↔ macOS (window.GanttNative)
macos/tests/persist.sh            Kiểm thử "tắt rồi mở lại app" trên bản .app thật (chạy trong CI)
tests/web/                        Kiểm thử giao diện bằng Playwright + Chromium
macos/Info.plist, AppIcon.png     Thông tin gói và biểu tượng
macos/build.sh                    Build .app universal + DMG
.github/workflows/build-macos.yml Build tự động trên GitHub Actions
legacy/sync_server.py             Server cũ, chỉ cần khi mở HTML bằng trình duyệt
```
