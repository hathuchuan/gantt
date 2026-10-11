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

    private var window: NSWindow!
    private var webView: WKWebView!
    private var storage: StorageMirror!
    private let calendarBridge = CalendarBridge()

    private var snapshotTimer: Timer?

    private let isSelfTest = CommandLine.arguments.contains("--self-test")
    private var selfTestFinished = false

    private var appVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "dev"
    }

    // MARK: - Vòng đời ứng dụng

    func applicationDidFinishLaunching(_ notification: Notification) {
        storage = StorageMirror(directory: isSelfTest ? AppDelegate.prepareSelfTestDirectory() : StorageMirror.defaultDirectory)
        buildMainMenu()
        createWindow()
        loadPage()
        startSnapshotTimer()
        if isSelfTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
                self?.finishSelfTest(passed: false, detail: "timeout")
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
        guard webView != nil, let storage = storage else { return .terminateNow }
        snapshotTimer?.invalidate()
        // Chụp toàn bộ localStorage lần cuối (đồng thời bảo đảm các tin nhắn lưu đã tới nơi), rồi ghi ra đĩa.
        var replied = false
        let finish = {
            guard !replied else { return }
            replied = true
            storage.waitUntilFlushed()
            sender.reply(toApplicationShouldTerminate: true)
        }
        snapshotStorage { finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish() }
        return .terminateLater
    }

    // MARK: - Lưu dữ liệu bền vững

    // Lưới an toàn: ngoài việc ghi theo từng lần setItem, cứ vài giây lại chụp toàn bộ localStorage
    // của trang ra tệp, và chụp lần cuối khi thoát hoặc khi app mất focus.
    private static let snapshotScript = """
    (function () {
      var o = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          o[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return JSON.stringify(o);
    })()
    """

    private func snapshotStorage(completion: (() -> Void)? = nil) {
        guard let webView = webView, let storage = storage else {
            completion?()
            return
        }
        webView.evaluateJavaScript(AppDelegate.snapshotScript) { result, _ in
            if let text = result as? String,
               let data = text.data(using: .utf8),
               let entries = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] {
                storage.merge(entries)
            }
            completion?()
        }
    }

    private func startSnapshotTimer() {
        guard !isSelfTest else { return }
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.snapshotStorage()
        }
    }

    func applicationDidResignActive(_ notification: Notification) {
        snapshotStorage()
    }

    // MARK: - Cửa sổ & WebView

    private func createWindow() {
        let controller = WKUserContentController()
        controller.addScriptMessageHandler(self, contentWorld: .page, name: "gantt")
        controller.addUserScript(WKUserScript(source: makeBridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = controller
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

    private func makeBridgeScript() -> String {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let template = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("AcademicGantt: thiếu bridge.js trong gói ứng dụng")
            return ""
        }
        // Thay phiên bản trước để nội dung dữ liệu người dùng không bị quét lại.
        return template
            .replacingOccurrences(of: "__GANTT_VERSION__", with: jsonLiteral(appVersion))
            .replacingOccurrences(of: "__GANTT_STORAGE__", with: jsonLiteral(storage.initialValues))
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
        editMenu.addItem(withTitle: "Hoàn tác", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Làm lại", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
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

    @objc private func openDataFolder(_ sender: Any?) {
        NSWorkspace.shared.open(storage.directory)
    }

    @objc private func reloadPage(_ sender: Any?) {
        webView.reload()
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

    private func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = window, window.isVisible, window.attachedSheet == nil {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }

    // MARK: - Tự kiểm tra (CI): AcademicGantt --self-test

    private static func prepareSelfTestDirectory() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("AcademicGantt-selftest-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let seed = try? JSONSerialization.data(withJSONObject: ["__selftest_seed": "ok"]) {
            try? seed.write(to: dir.appendingPathComponent("storage.json"))
        }
        return dir
    }

    private func runSelfTest() {
        let script = """
        var r = {};
        r.title = document.title;
        r.bridge = !!(window.GanttNative && typeof GanttNative.fetchEvents === 'function');
        r.nativePicker = typeof GanttNative.openTextFile === 'function' && typeof GanttNative.saveState === 'function';
        r.bootState = !!GanttNative.bootState && GanttNative.bootState.__selftest_seed === 'ok';
        r.seedRestored = localStorage.getItem('__selftest_seed') === 'ok';
        r.courses = (typeof courses !== 'undefined' && Array.isArray(courses)) ? courses.length : -1;
        var picker = document.getElementById('macCalendarPicker');
        r.nativePanel = !!picker && picker.style.display !== 'none';
        var pong = await window.webkit.messageHandlers.gantt.postMessage({ cmd: 'ping' });
        r.ping = !!(pong && pong.ok);
        localStorage.setItem('__selftest_write', 'ok');
        GanttNative.saveState('__selftest_explicit', 'ok');
        await new Promise(function (resolve) { setTimeout(resolve, 500); });
        return JSON.stringify(r);
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                self.finishSelfTest(passed: false, detail: "JS error: \(error)")
            case .success(let value):
                var checks = ((try? JSONSerialization.jsonObject(with: Data(((value as? String) ?? "{}").utf8))) as? [String: Any]) ?? [:]
                self.storage.waitUntilFlushed()
                let fileText = (try? String(contentsOf: self.storage.file, encoding: .utf8)) ?? ""
                checks["storageFileWritten"] = fileText.contains("__selftest_write") && fileText.contains("__selftest_explicit")
                checks["calendarAuthStatus"] = CalendarBridge.authorizationStatusDescription
                let required = ["bridge", "nativePicker", "bootState", "seedRestored", "nativePanel", "ping", "storageFileWritten"]
                let passed = required.allSatisfy { (checks[$0] as? Bool) == true } && ((checks["courses"] as? Int) ?? 0) > 0
                self.finishSelfTest(passed: passed, detail: "\(checks)")
            }
        }
    }

    private func finishSelfTest(passed: Bool, detail: String) {
        guard isSelfTest, !selfTestFinished else { return }
        selfTestFinished = true
        print((passed ? "SELFTEST PASS " : "SELFTEST FAIL ") + detail)
        fflush(stdout)
        try? FileManager.default.removeItem(at: storage.directory)
        exit(passed ? 0 : 1)
    }
}

// MARK: - Cầu nối JS ↔ macOS

extension AppDelegate: WKScriptMessageHandlerWithReply {
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

        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else {
            reply(.failure(BridgeError(code: "invalid", message: "Yêu cầu không hợp lệ.")))
            return
        }

        switch cmd {
        case "ping":
            reply(.success(appVersion))
        case "storageSet":
            if let key = body["key"] as? String, let value = body["value"] as? String {
                storage.set(key, value)
            }
            reply(.success(true))
        case "storageRemove":
            if let key = body["key"] as? String {
                storage.remove(key)
            }
            reply(.success(true))
        case "storageClear":
            storage.clear()
            reply(.success(true))
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
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {
                reply(.success(false))
                return
            }
            do {
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard size <= 20_000_000 else {
                    reply(.failure(BridgeError(code: "too_large", message: "Tệp quá lớn (tối đa 20 MB).")))
                    return
                }
                let content = try String(contentsOf: url, encoding: .utf8)
                reply(.success(["name": url.lastPathComponent, "content": content]))
            } catch {
                reply(.failure(BridgeError(code: "failed", message: "Không đọc được tệp: \(error.localizedDescription)")))
            }
        }
    }

    private func saveTextFile(name: String, content: String, reply: @escaping (Result<Any, BridgeError>) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {
                reply(.success(false))
                return
            }
            do {
                try Data(content.utf8).write(to: url, options: .atomic)
                reply(.success(true))
            } catch {
                reply(.failure(BridgeError(code: "failed", message: error.localizedDescription)))
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
        if isSelfTest { runSelfTest() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finishSelfTest(passed: false, detail: "didFail: \(error)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finishSelfTest(passed: false, detail: "didFailProvisionalNavigation: \(error)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
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
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
}
