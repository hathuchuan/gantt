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
- Nút duy nhất (góc phải trên) hoặc `⌘/`: Preview ⇄ Edit. `⇧⌘D`: đổi sáng ⇄ tối (xem *Giao diện sáng / tối* bên dưới).
- `⌘B` `⌘I` `⇧⌘X` `⌘E` `⌘K` `⌘1-3`: định dạng. Enter tiếp tục list/to-do/quote, Tab/⇧Tab thụt lề, tự đóng `()` `[]` `{}` `` ` ``, ``` → code block, dán URL lên chữ đã chọn → link.

## Ảnh
- **Dán ảnh** (⌘V, ví dụ ảnh chụp màn hình) hoặc **kéo ảnh vào** cửa sổ: ảnh được lưu trong cùng thư mục với note (`image-YYYYMMDD-HHMMSS.png`, hoặc đúng tên file khi kéo thả; không ghi đè file có sẵn) và chèn `![](tên-ảnh.png)` tại con trỏ. Ảnh đã nằm sẵn trong thư mục của note thì chỉ chèn tham chiếu.
- Note chưa lưu thì hiện thông báo *Save the note first (⌘S)* — lưu note rồi dán/kéo lại.

## Code block
Khối code có ghi ngôn ngữ (` ```js `, ` ```python `, ` ```sql `…) được tô màu cú pháp ở Preview, theo cả Night mode; cũng áp dụng khi xuất PDF.

## Dán từ Word / web (HTML → Markdown)
Dán nội dung có định dạng (Word, Google Docs, trang web, hoặc copy từ Preview) sẽ tự đổi sang Markdown: heading, **đậm**/*nghiêng*, danh sách (kể cả danh sách của Word), bảng, link, code. Ảnh nhúng trong nội dung dán được lưu cạnh note (note chưa lưu thì bỏ qua ảnh). `⇧⌘V` = dán thành văn bản thường.
- **File → Import Word / HTML…**: chọn file `.docx`/`.html`, đặt tên note `.md` mới; ảnh trong `.docx` được lưu cạnh note.

## Xuất file
**File → Export → PDF…** hoặc **Word (.docx)…** (A4; bao gồm heading, danh sách, bảng, code, ảnh, công thức, link). Danh sách "Notes in this project" không đưa vào bản xuất.

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

## Trang web (.html) và JSON
Cùng một editor, cùng menu `/`, nhưng theo loại file (đuôi `.html`/`.htm` hoặc `.json`):
- **Tạo mới:** *File → New HTML Page* (`⌥⌘N`) hoặc *New JSON File* (`⌥⇧⌘N`); mở file có sẵn bằng `⌘O`. *Save As* chọn đuôi nào thì file thành loại đó. Menu `/` chỉ hiện lệnh của loại file đang soạn.
- **HTML — lệnh `/` tự sinh code:** `/page` (trang hoàn chỉnh, có sẵn giao diện đẹp, sáng/tối, thích ứng điện thoại), `/h1` `/p` `/link` `/button`, `/nav` `/hero` `/section` `/cols2` `/cols3` `/grid` `/card` `/footer`, `/image` `/figure` `/video`, `/list` `/table` `/details`, `/alert` `/warning` `/badge` `/quote` `/code`, `/form` `/input` `/select` `/checkbox`, `/css` (chèn lại bộ giao diện chuẩn). Gõ `/` rồi gõ tiếp chữ để lọc như ở Markdown; lệnh chèn xong sẽ bôi đen chỗ cần thay (ví dụ tên ảnh, địa chỉ link) và giữ đúng thụt lề.
- **HTML — gõ code đỡ sai:** gõ `<div>` thì tự thêm `</div>`; Enter giữ thụt lề và mở khung giữa thẻ mở/đóng; `⌘B` `⌘I` `⌘K` `⌘1-3` đổi thành `<strong>` `<em>` `<a>` `<h1-3>`; dán/kéo ảnh vào thì lưu cạnh file và chèn `<img>`.
- **HTML — xem trước:** `⌘/` hiện trang trong khung an toàn (không chạy script, không nạp CSS/JS từ ngoài). Muốn xem đúng như người truy cập: **File → Open Page in Browser** (`⌥⌘B`, tự lưu trước) hoặc `/browser`. **Export → PDF** in cả trang HTML.
- **JSON — lệnh `/`:** giá trị (`/string` `/number` `/true` `/null` `/object` `/array`), cặp tên:giá trị (`/pair` `/pairnumber` `/pairbool` `/pairobject` `/pairarray`), mẫu (`/person` `/records` `/package` `/settings`) và thao tác `/format` (thụt lề gọn), `/minify` (một dòng), `/sort` (sắp khóa A→Z), `/check` (tìm lỗi và nhảy tới đó). *Format → Format JSON* (`⌥⇧F`) = `/format`.
- **JSON — báo lỗi ngay:** cạnh tên file có nhãn `✓ JSON` hoặc `✗ line N` (bấm để nhảy tới lỗi); thông báo bằng lời dễ hiểu (thiếu dấu phẩy, dấu phẩy thừa, nháy đơn, thiếu `}`…). Gõ `"` `{` `[` tự đóng cặp. `⌘/` hiện **cây thu/gọn** của dữ liệu. Lưu ý: Format/Minify/Sort đọc rồi ghi lại JSON, nên số nguyên quá lớn (> 15 chữ số) có thể bị làm tròn và khóa trùng tên chỉ còn một.
- **Báo lỗi cú pháp (HTML và JSON):** vừa gõ vừa kiểm tra (sau ~0,4 giây). Chỗ sai được **gạch chân lượn sóng** (đỏ = lỗi, vàng = cảnh báo), cạnh tên file có nhãn `✓ HTML` / `✗ 2 errors` / `⚠ 1 warning` (bấm để nhảy tới lỗi kế tiếp), và cuối cửa sổ có **danh sách lỗi** kèm số dòng (bấm một dòng để nhảy tới đó; `✕` để ẩn, bấm nhãn để hiện lại). Thông báo bằng lời dễ hiểu.
  - HTML — lỗi: thẻ không đóng / đóng sai thứ tự (`<span> is not closed before </div>`), thẻ đóng thừa, thẻ thiếu `>`, dấu nháy của thuộc tính không đóng, chú thích `<!--` không đóng, `{` `}` trong `<style>` không khớp. Cảnh báo: ảnh thiếu `alt`, thuộc tính/`id` trùng, thiếu `<!doctype html>`, `<br></br>`, `<div/>`, dấu `<` lẻ loi. Thẻ có thể bỏ đóng (`<li>`, `<p>`, `<td>`…) không bị báo lỗi.
  - JSON — báo lỗi đầu tiên (dấu phẩy thừa/thiếu, nháy đơn, tên không có nháy kép, thiếu `}` `]`, chú thích…).
  - Không chạy JavaScript trong `<script>` nên lỗi JS không được kiểm tra.
- **Định dạng chữ trong HTML:** bôi đen chữ → hiện **thanh định dạng** nổi: **B** *I* ~~S~~ U, **A** (màu chữ: 10 màu + bảng màu tùy ý), ▮ (màu nền / bút dạ), `Aa` (cỡ chữ: nhỏ → rất lớn), `≡` (căn trái / giữa / phải / đều), 🔗 (link), `</>` (code), ⌫ (xóa định dạng). Định dạng lại cùng đoạn chữ thì sửa thẻ `<span>` đang có thay vì lồng thêm. Cùng chức năng có ở menu **Format** và phím tắt: `⌘B` đậm, `⌘I` nghiêng, `⇧⌘X` gạch ngang, `⌘U` gạch chân, `⇧⌘H` tô nổi, `⌘K` link, `⌘E` code, `⌘1-3` tiêu đề, `⌘\` xóa định dạng, `⌥⇧L/E/R` căn lề; menu còn có Text Color…, Highlight Color…, Text Size, Align, Bullet/Numbered List, Quote. Gõ lệnh `/` (không bôi đen) cũng chèn được: `/strike` `/bolditalic` `/red` `/orange` `/green` `/blue` `/purple` `/gray` `/yellowmark` `/big` `/huge` `/alignleft` `/aligncenter` `/alignright` `/justify`. `⌘U` và `⇧⌘H` dùng được cả trong ghi chú Markdown (chèn `<u>`, `<mark>`).
- **Lệnh riêng:** trong `commands.json` thêm `"kind": "html"` hoặc `"kind": "json"` vào lệnh tùy chỉnh (mặc định là Markdown). Bảng *Commands…* tắt/bật riêng từng loại (`html:table` khác `table` của Markdown). Biến dùng thêm được `{year}`.
- Các tính năng riêng của Markdown (Gantt, wiki link, backlinks, Word/PDF của ghi chú) không áp dụng cho file HTML/JSON; `⌘F` tìm trong văn bản ở chế độ Edit.

## Tìm trong ghi chú & Outline
- **`⌘F`** mở thanh tìm (cả Edit lẫn Preview): tìm ngay khi gõ, hiện số kết quả `3/12`, `Enter` / `⇧Enter` đến kết quả sau / trước (hoặc `⌘G` / `⌥⌘G`), nút `Aa` bật phân biệt hoa/thường, `Esc` đóng. Edit: mọi kết quả được tô vàng, kết quả hiện tại được chọn trong ô soạn thảo và cuộn vào tầm nhìn; Preview: tô bằng `<mark>`. Chọn sẵn một đoạn chữ rồi bấm `⌘F` thì đoạn đó thành từ khóa.
- **Outline `⇧⌘O`** (hoặc *View → Show Outline*): bảng bên trái liệt kê các heading `#`…`######` của note (thụt theo cấp, bỏ qua heading nằm trong code block và front matter). Bấm để nhảy tới heading (Edit và Preview); mục của phần đang xem được tô sáng khi cuộn.

## Tìm trong cả thư mục notes, tag, backlink
- **`⇧⌘F`** (*Edit → Search Notes…*) mở bảng **Search** bên trái: tìm toàn văn (không phân biệt hoa/thường) trong mọi note của thư mục notes (đệ quy, gồm `.md` `.markdown` `.txt`) **và** thư mục chứa note đang mở; mỗi kết quả hiện file, số dòng và đoạn trích. Bấm một kết quả → mở note (cửa sổ riêng, hoặc đưa cửa sổ đang mở lên trước) và chọn đúng chỗ đó.
- **Thư mục notes** mặc định là `~/Documents/Gantt Notes` (cũng là nơi Gantt tạo note mới); đổi bằng **File → Choose Notes Folder…** (lưu vào `settings.json`, khóa `notesDir`). Bỏ qua thư mục ẩn, `node_modules`, `Library`; quét tối đa ~6000 file, có cache theo thời gian sửa nên tìm lại rất nhanh.
- **Tag:** `#tag` trong văn bản (hỗ trợ chữ Unicode/tiếng Việt, ví dụ `#ý_tưởng`; không tính trong code, heading, link/URL, và `#12` không phải tag) và `tags: [a, b]` / `tags:` + danh sách `- a` trong front matter. Bảng Search có danh sách tag kèm số note; bấm một tag để lọc (kết hợp được với từ khóa), bấm lại để bỏ lọc.
- **Liên kết wiki:** `[[tên note]]` và `[[tên note|chữ hiển thị]]` — tên khớp với tên file bỏ đuôi `.md` (không phân biệt hoa/thường) hoặc `title:` trong front matter; `[[Thư mục/Tên]]` và `[[Tên#Heading]]` cũng được. Ở Preview là liên kết (gạch chấm; mờ nếu note chưa có); bấm để mở note. Note chưa có: hỏi xác nhận rồi tạo `Tên.md` **cùng thư mục** với note hiện tại. Ở Edit: `⌘`-nhấp vào `[[…]]` để mở. Khi xuất PDF/Word, `[[…]]` thành chữ thường.
- **Gõ `[[`** để hiện danh sách tên note gợi ý (↑/↓ chọn, Enter/Tab chèn, Esc đóng) — cùng kiểu menu `/`.
- **Backlinks:** cuối Preview có mục *Backlinks* liệt kê các note đang `[[liên kết]]` tới note này (kèm dòng chứa liên kết); cũng có trong tab **Backlinks** của bảng bên (`⇧⌘B`).

## Giao diện sáng / tối
Mặc định là **Auto**: theo giao diện của macOS và đổi ngay khi hệ thống đổi (tự chuyển sáng/tối theo giờ…). **View → Appearance** có ba lựa chọn: *Auto*, *Light*, *Dark*. `⇧⌘D` (*Toggle Night / Day*) đổi sang giao diện còn lại và nhớ lựa chọn đó (chế độ thủ công) cho đến khi bạn chọn lại *Auto*. Lựa chọn lưu trong `settings.json` (khóa `theme`: `auto` / `light` / `dark`); người đã bật Night Mode trước đây giữ nguyên Dark.

## Math (LaTeX)
`$E=mc^2$` (inline) và `$$ … $$` (block) được render bằng KaTeX trong Preview.

## Liên kết 2 chiều với Academic Gantt
Dùng được khi đã cài Academic Gantt (bộ cài chung `AcademicSuite-*.dmg` có sẵn cả hai) và mở nó ít nhất một lần; không cài thì MD Editor vẫn dùng bình thường.

- **Gantt → note:** ⌘-nhấp một khối trên Gantt (hoặc nhấp biểu tượng 📄) → mở note của khối; MD Editor tìm note đã có (theo đường dẫn Gantt gửi, liên kết lưu trong Gantt, hoặc front matter `gantt-block:` trong thư mục note — kể cả khi bạn đã đổi tên/di chuyển file) và chỉ tạo note mới khi chưa có ở đâu; note mới được tạo trong `~/Documents/Gantt Notes/<dự án>/<khối>.md` và liên kết tự được gửi về Gantt.
- **Note → Gantt:** `⇧⌘G` (hoặc `/ganttopen`, hoặc bấm nhãn 🗓 ở Preview) → Gantt hiện ra, cuộn tới khối và nhấp nháy.
- **Gắn note có sẵn vào khối:** `⇧⌘E` hoặc `/gantt` → chọn khối (lọc theo tên); note được lưu và có front matter `gantt-block:`. *File → Unlink from Gantt* để gỡ.
- **Danh sách note cùng dự án (tự cập nhật):** note gắn với khối Gantt có đoạn giữa `<!-- project-notes -->` … `<!-- /project-notes -->` liệt kê mọi note cùng dự án (theo thứ tự lịch, link tương đối, note hiện tại in đậm). Note tạo từ Gantt hoặc vừa gắn bằng `⇧⌘E` có sẵn đoạn này; note cũ thì chạy `/projectnotes` (hoặc *File → Update Project Notes List*). Danh sách tự làm mới khi mở note, khi cửa sổ được focus (nếu note chưa sửa), khi vào Preview và khi lưu. *Unlink from Gantt* gỡ luôn đoạn này.
- **Tiến độ khối ngay trong note:** Preview của note gắn khối hiện thẻ: ngày, thanh tiến độ, trạng thái (xong / đang làm / sắp tới / trễ hạn, còn bao nhiêu ngày) và tiến độ cả dự án (`x/y` khối đã xong) — đọc trực tiếp từ Gantt mỗi lần mở Preview.
- **`/ganttblocks` (bảng tự cập nhật):** chèn bảng *Task | Start | Deadline | Days | Status* của cả dự án (dự án của note; note chưa gắn khối thì hiện danh sách dự án để chọn), bọc giữa `<!-- gantt-blocks project="<id dự án>" -->` … `<!-- /gantt-blocks -->`. Bảng được dựng lại từ dữ liệu Gantt (`storage.json`) khi mở note, khi cửa sổ được focus (nếu note chưa sửa), khi vào Preview, khi lưu, và **ngay khi `storage.json` đổi trên đĩa** — Academic Gantt ghi lại file này mỗi lần đồng bộ Apple Calendar nên bảng đi theo lịch. *File → Update Gantt Tables* để làm mới thủ công. Chạy `/ganttblocks` lần nữa cho cùng dự án thì làm mới bảng sẵn có chứ không chèn thêm bản thứ hai (dự án khác thì thêm bảng riêng). Đừng sửa tay nội dung giữa hai dấu — sẽ bị ghi đè. Bảng *snapshot* chèn bằng bản cũ (không có dấu) vẫn là bảng thường, không bị đụng tới; muốn tự cập nhật thì xóa đi và chạy lại `/ganttblocks`.
- Đổi thư mục note: **File → Choose Notes Folder…**, hoặc sửa `settings.json` trong `~/Library/Application Support/MD Editor/` — `{ "notesDir": "~/Notes/Gantt", "theme": "auto" }`.
