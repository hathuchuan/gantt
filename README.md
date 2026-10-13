# MD Editor

Trình soạn thảo Markdown tối giản cho macOS.

```
npm install
npm start
npm run dist           # đóng gói .dmg (chạy trên macOS)
npm test
```

## Cơ bản
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
Cần cài app [Academic Gantt](https://github.com/hathuchuan/gantt) (bản có nhánh `claude/gantt-note-links` trở lên) và mở nó ít nhất một lần.

- **Gantt → note:** ⌘-nhấp một khối trên Gantt (hoặc nhấp biểu tượng 📄) → mở note của khối; chưa có thì note mới được tạo trong `~/Documents/Gantt Notes/<dự án>/<khối>.md` và liên kết tự được gửi về Gantt.
- **Note → Gantt:** `⇧⌘G` (hoặc `/ganttopen`, hoặc bấm nhãn 🗓 ở Preview) → Gantt hiện ra, cuộn tới khối và nhấp nháy.
- **Gắn note có sẵn vào khối:** `⇧⌘E` hoặc `/gantt` → chọn khối (lọc theo tên); note được lưu và có front matter `gantt-block:`. *File → Unlink from Gantt* để gỡ.
- Đổi thư mục note: tạo `settings.json` trong `~/Library/Application Support/MD Editor/` với `{ "notesDir": "~/Notes/Gantt" }`.
