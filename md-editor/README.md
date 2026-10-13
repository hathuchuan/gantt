# MD Editor

Trình soạn thảo Markdown tối giản cho macOS.

```
npm install
npm start
npm run dist           # đóng gói .dmg (chạy trên macOS)
npm test
```

## Cơ bản
- **Nhiều ghi chú cùng lúc:** mỗi ghi chú mở trong một cửa sổ riêng (`⌘N` cửa sổ mới, `⌘O` mở một hoặc nhiều file; mở lại file đang mở thì cửa sổ đó được đưa lên trước).
- **Kéo file thả vào cửa sổ ghi chú:** chèn liên kết `[tên file](file:///…)` tại con trỏ (tên liên kết mặc định là tên file). Nhấp vào liên kết ở Preview, hoặc `⌘`-nhấp ở chế độ Edit để mở file; liên kết tới file `.md` mở trong cửa sổ MD Editor mới, file chương trình (.app, .sh…) chỉ được hiện trong Finder.
- Nút duy nhất (góc phải trên) hoặc `⌘/`: Preview ⇄ Edit. `⇧⌘D`: Night mode.
- `⌘B` `⌘I` `⇧⌘X` `⌘E` `⌘K` `⌘1-3`: định dạng. Enter tiếp tục list/to-do/quote, Tab/⇧Tab thụt lề, tự đóng `()` `[]` `{}` `` ` ``, ``` → code block, dán URL lên chữ đã chọn → link.

## Lệnh `/`
- Gõ `/` đầu dòng (hoặc `/chữ` giữa dòng) để mở menu. Gõ tiếp chữ cái để lọc theo tiền tố: `h` → các lệnh bắt đầu bằng h, `he` → thu hẹp tiếp. ↑/↓ chọn, Enter/Tab chèn, Esc đóng.
- Nhóm: Blocks, Text (bold, italic, highlight, …), Insert, Math (fraction, sum, integral, matrix, chữ Hy Lạp, ký hiệu…).
- **Format → Commands…**: bật/tắt từng lệnh.
- **Lệnh tùy chỉnh / template**: *Commands… → Edit custom commands…* mở `commands.json`:

```json
{
  "disabled": ["divider"],
  "custom": [
    { "key": "meeting", "label": "Meeting notes", "hint": "📝", "block": true,
      "text": "## Meeting — {date}\n\n**Attendees:** {cursor}\n\n### Notes\n" }
  ]
}
```
  Biến: `{date}` `{time}` `{weekday}` `{cursor}` (vị trí con trỏ). `block: true` = chỉ hiện ở đầu dòng.

## Math (LaTeX)
`$E=mc^2$` (inline) và `$$ … $$` (block) được render bằng KaTeX trong Preview.

## Liên kết 2 chiều với Academic Gantt
Dùng được khi đã cài Academic Gantt (bộ cài chung `AcademicSuite-*.dmg` có sẵn cả hai) và mở nó ít nhất một lần; không cài thì MD Editor vẫn dùng bình thường.

- **Gantt → note:** ⌘-nhấp một khối trên Gantt (hoặc nhấp biểu tượng 📄) → mở note của khối; MD Editor tìm note đã có (theo đường dẫn Gantt gửi, liên kết lưu trong Gantt, hoặc front matter `gantt-block:` trong thư mục note — kể cả khi bạn đã đổi tên/di chuyển file) và chỉ tạo note mới khi chưa có ở đâu; note mới được tạo trong `~/Documents/Gantt Notes/<dự án>/<khối>.md` và liên kết tự được gửi về Gantt.
- **Note → Gantt:** `⇧⌘G` (hoặc `/ganttopen`, hoặc bấm nhãn 🗓 ở Preview) → Gantt hiện ra, cuộn tới khối và nhấp nháy.
- **Gắn note có sẵn vào khối:** `⇧⌘E` hoặc `/gantt` → chọn khối (lọc theo tên); note được lưu và có front matter `gantt-block:`. *File → Unlink from Gantt* để gỡ.
- Đổi thư mục note: tạo `settings.json` trong `~/Library/Application Support/MD Editor/` với `{ "notesDir": "~/Notes/Gantt" }`.
