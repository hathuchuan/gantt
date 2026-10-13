# MD Editor

Trình soạn thảo Markdown tối giản cho macOS.

```
npm install
npm run build:helper   # macOS: biên dịch helper Calendar (cần Xcode command line tools)
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

## Gắn note vào sự kiện Calendar
`⇧⌘E` hoặc `/event`: chọn một sự kiện → note được lưu, sự kiện trong Calendar nhận link `mdeditor://…` (bấm để mở lại note), và note có front matter `event:` hiển thị ở Preview. Lần đầu macOS sẽ hỏi quyền truy cập Calendar.
