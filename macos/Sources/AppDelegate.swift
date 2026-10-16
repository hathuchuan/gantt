import Cocoa
import WebKit

@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        // NSApplication.delegate là tham chiếu yếu: giữ delegate sống suốt vòng đời ứng dụng.
        withExtendedLifetime(delegate) {
            app.run()
        }
    }

    var window: NSWindow!
    var webView: WKWebView!
    var storage: StorageMirror!
    let calendarBridge = CalendarBridge()
    let userContent = WKUserContentController()
    let options = LaunchOptions(CommandLine.arguments)

    var snapshotTimer: Timer?
    var lastPulledRev = -1
    var terminating = false

    // Trạng thái của các bài tự kiểm tra (xem SelfTest.swift)
    var selfTestFinished = false
    var reloadStep = 0

    // academicgantt://... nhận được trước khi trang nạp xong được giữ lại rồi chuyển cho trang sau (xem NoteLinks).
    var pendingAppURLs: [String] = []
    var pageReady = false

    var appVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "dev"
    }

    // MARK: - Vòng đời ứng dụng

    func applicationDidFinishLaunching(_ notification: Notification) {
        let dataDirectory: URL
        if options.smoke {
            dataDirectory = AppDelegate.prepareSelfTestDirectory()
        } else if options.phase != nil {
            guard let custom = options.dataDir else {
                print("SELFTEST FAIL các bài kiểm tra --selftest-phase bắt buộc phải có --data-dir (để không đụng vào dữ liệu thật)")
                fflush(stdout)
                exit(2)
            }
            dataDirectory = custom
        } else {
            dataDirectory = StorageMirror.defaultDirectory
        }

        AppLog.shared.configure(directory: dataDirectory)
        AppLog.shared.write("khởi động \(appVersion) · macOS \(ProcessInfo.processInfo.operatingSystemVersionString) · \(dataDirectory.path)")
        storage = StorageMirror(directory: dataDirectory)
        let loaded = storage.stats()
        AppLog.shared.write("đã nạp dữ liệu: nguồn=\(storage.loadedFrom.rawValue), \(loaded.keys) khóa, \(loaded.bytes) byte")

        buildMainMenu()
        createWindow()
        loadPage()
        startSnapshotTimer()
        if options.isAnySelfTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
                self?.failSelfTest("timeout")
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard webView != nil, storage != nil else { return .terminateNow }
        if terminating { return .terminateLater }
        terminating = true
        snapshotTimer?.invalidate()
        AppLog.shared.write("thoát: lưu lần cuối")

        // Kéo toàn bộ trạng thái trang về (đồng thời bảo đảm mọi tin nhắn lưu gửi trước đó đã tới nơi),
        // ghi xuống đĩa rồi mới cho phép thoát.
        var finished = false
        let finish = { [weak self] in
            guard !finished, let self = self else { return }
            finished = true
            let clean = self.storage.waitUntilFlushed()
            let stats = self.storage.stats()
            AppLog.shared.write("thoát: đã ghi \(stats.keys) khóa, \(stats.bytes) byte, sạch=\(clean)")
            AppLog.shared.flush()
            sender.reply(toApplicationShouldTerminate: true)
        }
        pullPageState(force: true) { finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish() }
        return .terminateLater
    }

    func applicationDidResignActive(_ notification: Notification) {
        pullPageState(force: false)
    }

    // MARK: - Lưu dữ liệu bền vững

    // Nguồn chuẩn là tệp storage.json; mỗi lần trang gọi GanttNative.saveState, dữ liệu được gửi sang native
    // và ghi xuống đĩa. Ngoài ra, cứ vài giây (và khi thoát / mất focus) native kéo thêm trạng thái trong bộ
    // nhớ của trang (GanttNative.bootState) về làm lưới an toàn nếu một tin nhắn nào đó bị thất lạc.
    // Trang luôn được nạp với bản mới nhất trên đĩa (xem installBridgeScript) nên bản kéo về không bao giờ cũ hơn.

    func pullPageState(force: Bool, completion: (() -> Void)? = nil) {
        guard let webView = webView, let storage = storage else {
            completion?()
            return
        }
        let script = """
        (function (last) {
          var g = window.GanttNative;
          if (!g || !g.bootState) return null;
          if (last >= 0 && g.rev === last) return null;
          return JSON.stringify({ rev: g.rev, state: g.bootState });
        })(\(force ? -1 : lastPulledRev))
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            if let text = result as? String,
               let data = text.data(using: .utf8),
               let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let state = object["state"] as? [String: String] {
                if let rev = object["rev"] as? Int { self?.lastPulledRev = rev }
                storage.merge(state)
            } else if let error = error {
                AppLog.shared.write("kéo trạng thái từ trang thất bại: \(error.localizedDescription)")
            }
            completion?()
        }
    }

    private func startSnapshotTimer() {
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.pullPageState(force: false)
        }
    }

    // MARK: - Cửa sổ & WebView

    private func createWindow() {
        userContent.addScriptMessageHandler(self, contentWorld: .page, name: "gantt")
        installBridgeScript()

        let config = WKWebViewConfiguration()
        config.userContentController = userContent
        config.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.pageZoom = savedZoom
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1480, visible.width * 0.92), height: min(940, visible.height * 0.92))
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Academic Gantt Planner"
        window.minSize = NSSize(width: 960, height: 600)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("AcademicGanttMainWindow")
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadPage() {
        guard let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            webView.loadHTMLString("<h2 style='font-family:-apple-system'>Không tìm thấy giao diện (web/index.html) trong gói ứng dụng.</h2>", baseURL: nil)
            return
        }
        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    /// Nhúng bản dữ liệu MỚI NHẤT trên đĩa vào script cầu nối. Phải gọi lại trước mỗi lần nạp lại trang,
    /// nếu không trang sẽ khởi động bằng dữ liệu cũ của lúc mở app.
    func installBridgeScript() {
        userContent.removeAllUserScripts()
        userContent.addUserScript(WKUserScript(source: makeBridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func makeBridgeScript() -> String {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let template = try? String(contentsOf: url, encoding: .utf8) else {
            AppLog.shared.write("thiếu bridge.js trong gói ứng dụng")
            return ""
        }
        // Thay phiên bản trước để nội dung dữ liệu người dùng không bị quét lại.
        return template
            .replacingOccurrences(of: "__GANTT_VERSION__", with: jsonLiteral(appVersion))
            .replacingOccurrences(of: "__GANTT_STORAGE__", with: jsonLiteral(storage.snapshot()))
    }

    private func jsonLiteral(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    // MARK: - Menu

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Giới thiệu Academic Gantt", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ẩn Academic Gantt", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Ẩn ứng dụng khác", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Hiện tất cả", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Thoát Academic Gantt", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        addSubmenu(appMenu, title: "Academic Gantt", to: mainMenu)

        let fileMenu = NSMenu(title: "Tệp")
        fileMenu.addItem(menuItem("Mở thư mục dữ liệu", #selector(openDataFolder(_:)), ""))
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Đóng cửa sổ", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        addSubmenu(fileMenu, title: "Tệp", to: mainMenu)

        let editMenu = NSMenu(title: "Sửa")
        // ⌘Z / ⇧⌘Z: hoàn tác thao tác trên Gantt (trang tự trả "chưa xử lý" khi đang gõ chữ → dùng hoàn tác của ô nhập)
        editMenu.addItem(menuItem("Hoàn tác", #selector(ganttUndo(_:)), "z"))
        let redo = menuItem("Làm lại", #selector(ganttRedo(_:)), "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cắt", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Sao chép", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Dán", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Chọn tất cả", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        addSubmenu(editMenu, title: "Sửa", to: mainMenu)

        let viewMenu = NSMenu(title: "Xem")
        viewMenu.addItem(menuItem("Tải lại", #selector(reloadPage(_:)), "r"))
        viewMenu.addItem(.separator())
        viewMenu.addItem(menuItem("Phóng to", #selector(ganttZoomIn(_:)), "="))
        viewMenu.addItem(menuItem("Thu nhỏ", #selector(ganttZoomOut(_:)), "-"))
        viewMenu.addItem(menuItem("Kích thước thực", #selector(ganttZoomReset(_:)), "0"))
        viewMenu.addItem(.separator())
        let fullScreen = viewMenu.addItem(withTitle: "Toàn màn hình", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        addSubmenu(viewMenu, title: "Xem", to: mainMenu)

        let windowMenu = NSMenu(title: "Cửa sổ")
        windowMenu.addItem(withTitle: "Thu nhỏ xuống Dock", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Phóng cửa sổ", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        addSubmenu(windowMenu, title: "Cửa sổ", to: mainMenu)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    private func addSubmenu(_ submenu: NSMenu, title: String, to menu: NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        menu.addItem(item)
    }

    private func menuItem(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    @objc func ganttUndo(_ sender: Any?) { runPageHistory(redo: false) }
    @objc func ganttRedo(_ sender: Any?) { runPageHistory(redo: true) }

    private func runPageHistory(redo: Bool) {
        guard let webView = webView else { return }
        let name = redo ? "ganttRedo" : "ganttUndo"
        let script = "(function(){return window.\(name) ? window.\(name)(true) : false;})()"
        webView.evaluateJavaScript(script) { result, _ in
            if let handled = result as? Bool, handled { return }
            NSApp.sendAction(Selector((redo ? "redo:" : "undo:")), to: nil, from: nil)
        }
    }

    @objc private func openDataFolder(_ sender: Any?) {
        NSWorkspace.shared.open(storage.directory)
    }

    @objc func reloadPage(_ sender: Any?) {
        AppLog.shared.write("tải lại trang")
        // Lưu trạng thái hiện tại trước, rồi dựng lại script cầu nối từ bản mới nhất để trang không quay về dữ liệu cũ.
        pullPageState(force: true) { [weak self] in
            guard let self = self else { return }
            self.installBridgeScript()
            self.webView.reload()
        }
    }

    private var savedZoom: CGFloat {
        let zoom = UserDefaults.standard.double(forKey: "pageZoom")
        return zoom > 0 ? CGFloat(zoom) : 1.0
    }

    private func setZoom(_ zoom: CGFloat) {
        let value = min(max(zoom, 0.5), 2.5)
        webView.pageZoom = value
        UserDefaults.standard.set(Double(value), forKey: "pageZoom")
    }

    @objc private func ganttZoomIn(_ sender: Any?) { setZoom(webView.pageZoom + 0.1) }
    @objc private func ganttZoomOut(_ sender: Any?) { setZoom(webView.pageZoom - 0.1) }
    @objc private func ganttZoomReset(_ sender: Any?) { setZoom(1.0) }

    // MARK: - Hộp thoại

    private func makeAlert(_ message: String) -> NSAlert {
        let alert = NSAlert()
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if let newline = text.firstIndex(of: "\n") {
            alert.messageText = String(text[..<newline])
            alert.informativeText = String(text[text.index(after: newline)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            alert.messageText = text
        }
        return alert
    }

    func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if options.isAnySelfTest {
            // Chạy tự động không có người bấm: ghi lại rồi coi như bấm nút đầu tiên.
            AppLog.shared.write("self-test: bỏ qua hộp thoại '\(alert.messageText)'")
            completion(.alertFirstButtonReturn)
            return
        }
        if let window = window, window.isVisible, window.attachedSheet == nil {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }

    /// Hộp thoại mở/lưu tệp: dạng sheet gắn vào cửa sổ chính; nếu cửa sổ đang bận (đã có sheet khác
    /// hoặc không hiện) thì mở hộp thoại độc lập để không bao giờ "im lặng không phản ứng".
    func present(_ panel: NSSavePanel, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = window, window.isVisible, window.attachedSheet == nil {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
    }
}

// MARK: - Cầu nối JS ↔ macOS

extension AppDelegate: WKScriptMessageHandlerWithReply {
    /// Chỉ nhận tin nhắn từ khung chính đang hiển thị một tệp cục bộ (trang trong gói ứng dụng).
    /// Điều hướng sang trang web bên ngoài đã bị chặn ở decidePolicyFor; kiểm tra thêm ở đây để phòng thủ.
    private func isTrusted(_ message: WKScriptMessage) -> Bool {
        guard message.frameInfo.isMainFrame else { return false }
        if message.frameInfo.securityOrigin.protocol == "file" { return true }
        if message.webView?.url?.isFileURL == true { return true }
        return message.frameInfo.request.url?.isFileURL == true
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let reply: (Result<Any, BridgeError>) -> Void = { result in
            let payload: [String: Any]
            switch result {
            case .success(let data):
                payload = ["ok": true, "data": data]
            case .failure(let error):
                payload = ["ok": false, "error": error.code, "message": error.message]
            }
            if Thread.isMainThread {
                replyHandler(payload, nil)
            } else {
                DispatchQueue.main.async { replyHandler(payload, nil) }
            }
        }

        guard isTrusted(message),
              let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else {
            AppLog.shared.write("từ chối tin nhắn: mainFrame=\(message.frameInfo.isMainFrame) origin=\(message.frameInfo.securityOrigin.protocol) url=\(message.webView?.url?.absoluteString ?? "nil")")
            reply(.failure(BridgeError(code: "invalid", message: "Yêu cầu không hợp lệ.")))
            return
        }

        switch cmd {
        case "ping":
            reply(.success(appVersion))
        case "storageSet":
            guard let key = body["key"] as? String, let value = body["value"] as? String else {
                reply(.failure(BridgeError(code: "invalid", message: "Thiếu khóa hoặc giá trị cần lưu.")))
                return
            }
            // Chỉ trả lời sau khi dữ liệu đã nằm trên đĩa, để trang biết lần lưu có thành công hay không.
            storage.set(key, value) { error in
                if let error = error {
                    reply(.failure(BridgeError(code: "write_failed", message: "Không ghi được dữ liệu ra đĩa: \(error.localizedDescription)")))
                } else {
                    reply(.success(true))
                }
            }
        case "storageRemove":
            if let key = body["key"] as? String {
                storage.remove(key)
            }
            reply(.success(true))
        case "storageClear":
            storage.clear()
            reply(.success(true))
        case "backupNow":
            let label = body["label"] as? String ?? "manual"
            let done = storage.backupNow(label: label)
            AppLog.shared.write("sao lưu trước '\(label)': \(done ? "đã tạo" : "bỏ qua")")
            reply(.success(done))
        case "listCalendars":
            calendarBridge.listCalendars { reply($0.map { $0 as Any }) }
        case "fetchEvents":
            let ids = body["calendarIds"] as? [String] ?? []
            calendarBridge.fetchEvents(calendarIds: ids) { reply($0.map { $0 as Any }) }
        case "openCalendarPrivacySettings":
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") {
                NSWorkspace.shared.open(url)
            }
            reply(.success(true))
        case "readWidgetActions":
            reply(.success(WidgetBridge.readActions()))
        case "writeWidgetAck":
            reply(.success(WidgetBridge.writeAck(body["content"] as? String ?? "")))
        case "openURL":
            openMarkdownEditorURL(body["url"] as? String, reply: reply)
        case "openTextFile":
            openTextFile(extensions: body["extensions"] as? [String] ?? [], reply: reply)
        case "saveTextFile":
            saveTextFile(name: body["fileName"] as? String ?? "export.txt",
                         content: body["content"] as? String ?? "",
                         reply: reply)
        default:
            reply(.failure(BridgeError(code: "unsupported", message: "Lệnh không được hỗ trợ: \(cmd)")))
        }
    }

    private func openTextFile(extensions: [String], reply: @escaping (Result<Any, BridgeError>) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if !extensions.isEmpty { panel.allowedFileTypes = extensions }
        present(panel) { response in
            guard response == .OK, let url = panel.url else {
                reply(.success(false))
                return
            }
            reply(AppDelegate.readTextFile(at: url))
        }
    }

    /// Đọc tệp văn bản (UTF-8 có/không BOM, hoặc UTF-16). Tách riêng khỏi hộp thoại để kiểm thử được.
    static func readTextFile(at url: URL) -> Result<Any, BridgeError> {
        do {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            guard size <= 20_000_000 else {
                return .failure(BridgeError(code: "too_large", message: "Tệp quá lớn (tối đa 20 MB)."))
            }
            let data = try Data(contentsOf: url)
            guard let text = decodeText(data) else {
                return .failure(BridgeError(code: "decode_failed", message: "Không đọc được nội dung tệp (không phải văn bản UTF-8 / UTF-16)."))
            }
            return .success(["name": url.lastPathComponent, "content": text])
        } catch {
            if isPermissionError(error) {
                return .failure(BridgeError(code: "permission", message: permissionHint(reading: true)))
            }
            return .failure(BridgeError(code: "failed", message: "Không đọc được tệp: \(error.localizedDescription)"))
        }
    }

    /// macOS bảo vệ riêng Downloads / Desktop / Documents: nếu người dùng đã từ chối cấp quyền thì đọc/ghi tệp ở đó bị chặn.
    static func isPermissionError(_ error: Error) -> Bool {
        func check(_ ns: NSError) -> Bool {
            if ns.domain == NSCocoaErrorDomain && (ns.code == 257 || ns.code == 513) { return true }   // đọc / ghi không có quyền
            if ns.domain == NSPOSIXErrorDomain && (ns.code == Int(EPERM) || ns.code == Int(EACCES)) { return true }
            return false
        }
        let ns = error as NSError
        if check(ns) { return true }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError { return check(underlying) }
        return false
    }

    static func permissionHint(reading: Bool) -> String {
        let verb = reading ? "đọc" : "ghi"
        return "macOS chưa cho phép Academic Gantt \(verb) tệp trong thư mục này (Downloads, Desktop, Documents được bảo vệ riêng).\n"
            + "Cách xử lý: vào System Settings → Privacy & Security → Files & Folders (hoặc Full Disk Access), bật Academic Gantt rồi thử lại; "
            + "hoặc chọn một thư mục không bị bảo vệ, ví dụ thư mục Home."
    }

    static func decodeText(_ data: Data) -> String? {
        if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]) {
            return String(data: data, encoding: .utf16)
        }
        if let text = String(data: data, encoding: .utf8) {
            return text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        }
        return String(data: data, encoding: .utf16)
    }

    private func saveTextFile(name: String, content: String, reply: @escaping (Result<Any, BridgeError>) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        present(panel) { response in
            guard response == .OK, let url = panel.url else {
                reply(.success(false))
                return
            }
            do {
                try Data(content.utf8).write(to: url, options: .atomic)
                reply(.success(true))
            } catch {
                if AppDelegate.isPermissionError(error) {
                    reply(.failure(BridgeError(code: "permission", message: AppDelegate.permissionHint(reading: false))))
                } else {
                    reply(.failure(BridgeError(code: "failed", message: error.localizedDescription)))
                }
            }
        }
    }
}

// MARK: - Điều hướng

extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        if url.isFileURL || scheme == "about" {
            // Mọi lần nạp khung chính (mở app, Tải lại, khôi phục tiến trình web, điều hướng) đều phải nhận script
            // cầu nối dựng từ bản dữ liệu mới nhất trên đĩa; nếu không trang sẽ khởi động bằng dữ liệu cũ.
            if navigationAction.targetFrame?.isMainFrame ?? true {
                pageReady = false
                installBridgeScript()
            }
            decisionHandler(.allow)
            return
        }
        // Liên kết web mở bằng trình duyệt mặc định, không thay thế giao diện ứng dụng.
        if ["http", "https", "mailto"].contains(scheme), navigationAction.targetFrame?.isMainFrame ?? true {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lastPulledRev = -1
        pageReady = true
        flushPendingAppURLs()
        if options.smoke {
            runSelfTest()
        } else if let phase = options.phase {
            runPhase(phase)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        AppLog.shared.write("nạp trang thất bại: \(error)")
        failSelfTest("didFail: \(error)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        AppLog.shared.write("nạp trang thất bại (provisional): \(error)")
        failSelfTest("didFailProvisionalNavigation: \(error)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        AppLog.shared.write("tiến trình web bị dừng, nạp lại trang")
        // Không còn kéo được trạng thái từ trang; dựng lại script từ bản đã có trên đĩa rồi nạp lại.
        installBridgeScript()
        webView.reload()
    }
}

// MARK: - alert / confirm / prompt / chọn tệp

extension AppDelegate: WKUIDelegate {
    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = makeAlert(message)
        alert.addButton(withTitle: "OK")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = makeAlert(message)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Hủy")
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = makeAlert(prompt)
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Hủy")
        alert.window.initialFirstResponder = field
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        present(panel) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
}
