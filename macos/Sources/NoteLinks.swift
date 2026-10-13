import Cocoa
import WebKit

// Liên kết 2 chiều giữa khối Gantt và ghi chú Markdown trong MD Editor.
//   Gantt → note : trang gọi GanttNative.openURL("mdeditor://note?...") → mở MD Editor.
//   note → Gantt : MD Editor mở academicgantt://open?block=… (đưa khối lên màn hình)
//                  hoặc academicgantt://link?block=…&path=… (lưu đường dẫn ghi chú, không giành focus).
// Trang xử lý URL trong window.ganttHandleURL (web/academic_gantt_planner.html).
extension AppDelegate {
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme?.lowercased() == "academicgantt" {
            AppLog.shared.write("nhận URL: \(url.host ?? "?")")
            pendingAppURLs.append(url.absoluteString)
            // "open" đưa cửa sổ lên trước; "link"/"unlink" chạy nền để không cướp focus của MD Editor.
            if url.host?.lowercased() == "open", let window = window {
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
        }
        if pageReady { flushPendingAppURLs() }
    }

    func flushPendingAppURLs() {
        guard pageReady, webView != nil, !pendingAppURLs.isEmpty else { return }
        let urls = pendingAppURLs
        pendingAppURLs.removeAll()
        for url in urls {
            guard let data = try? JSONSerialization.data(withJSONObject: [url], options: []),
                  let array = String(data: data, encoding: .utf8) else { continue }
            let script = "(function(){var u=\(array)[0];if(window.ganttHandleURL){return window.ganttHandleURL(u);}return false;})()"
            webView.evaluateJavaScript(script) { _, error in
                if let error = error {
                    AppLog.shared.write("xử lý URL thất bại: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Chỉ cho phép mở mdeditor:// (MD Editor); từ chối mọi scheme khác.
    func openMarkdownEditorURL(_ string: String?, reply: @escaping (Result<Any, BridgeError>) -> Void) {
        guard let string = string, let url = URL(string: string), url.scheme?.lowercased() == "mdeditor" else {
            reply(.failure(BridgeError(code: "invalid", message: "Địa chỉ không hợp lệ.")))
            return
        }
        if NSWorkspace.shared.open(url) {
            reply(.success(true))
        } else {
            reply(.failure(BridgeError(code: "no_handler", message: "Chưa cài MD Editor (hoặc chưa mở lần nào). Hãy cài và mở MD Editor một lần rồi thử lại.")))
        }
    }
}
