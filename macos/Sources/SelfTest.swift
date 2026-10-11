import Cocoa
import WebKit

/// Tham số dòng lệnh dành cho kiểm thử tự động trên CI. Người dùng bình thường không bao giờ dùng tới.
///   --self-test                      kiểm tra nhanh: cầu nối JS, ghi dữ liệu, sao lưu, nhật ký
///   --selftest-phase write|write-silent|verify|reload   kịch bản "tắt rồi mở lại" (bắt buộc kèm --data-dir)
///   --selftest-exit terminate|close|hold                cách thoát sau pha write (hold: chờ bị kill -9)
///   --selftest-marker <chuỗi>        dấu hiệu để so khớp dữ liệu giữa pha write và pha verify
///   --data-dir <thư mục>             thư mục dữ liệu riêng cho bài kiểm tra
struct LaunchOptions {
    var smoke = false
    var phase: String?
    var exitMode = "terminate"
    var marker = "A"
    var dataDir: URL?

    init(_ arguments: [String]) {
        var index = 0
        while index < arguments.count {
            let next: String? = index + 1 < arguments.count ? arguments[index + 1] : nil
            switch arguments[index] {
            case "--self-test":
                smoke = true
            case "--selftest-phase":
                phase = next
                index += 1
            case "--selftest-exit":
                if let next = next { exitMode = next }
                index += 1
            case "--selftest-marker":
                if let next = next { marker = next }
                index += 1
            case "--data-dir":
                if let next = next { dataDir = URL(fileURLWithPath: next, isDirectory: true) }
                index += 1
            default:
                break
            }
            index += 1
        }
    }

    var isAnySelfTest: Bool { smoke || phase != nil }
}

extension AppDelegate {
    static func prepareSelfTestDirectory() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("AcademicGantt-selftest-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let seed = try? JSONSerialization.data(withJSONObject: ["__selftest_seed": "ok"]) {
            try? seed.write(to: dir.appendingPathComponent("storage.json"))
        }
        return dir
    }

    // MARK: - Kiểm tra nhanh (--self-test)

    func runSelfTest() {
        let script = """
        var r = {};
        var g = window.GanttNative;
        r.title = document.title;
        r.bridge = !!(g && typeof g.fetchEvents === 'function');
        r.nativePicker = !!g && typeof g.openTextFile === 'function' && typeof g.saveState === 'function' && typeof g.backupNow === 'function';
        r.bootState = !!g && !!g.bootState && g.bootState.__selftest_seed === 'ok';
        r.courses = (typeof courses !== 'undefined' && Array.isArray(courses)) ? courses.length : -1;
        var picker = document.getElementById('macCalendarPicker');
        r.nativePanel = !!picker && picker.style.display !== 'none';
        var pong = await window.webkit.messageHandlers.gantt.postMessage({ cmd: 'ping' });
        r.ping = !!(pong && pong.ok);
        await g.saveState('__selftest_explicit', 'ok');
        r.acked = true;
        r.saveStatusOk = g.saveStatus.ok === true;
        r.backup = (await g.backupNow('selftest')) === true;
        return JSON.stringify(r);
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                self.failSelfTest("JS error: \(error)")
            case .success(let value):
                var checks = ((try? JSONSerialization.jsonObject(with: Data(((value as? String) ?? "{}").utf8))) as? [String: Any]) ?? [:]
                self.storage.waitUntilFlushed()
                AppLog.shared.flush()
                let fileText = (try? String(contentsOf: self.storage.file, encoding: .utf8)) ?? ""
                checks["storageFileWritten"] = fileText.contains("__selftest_explicit")
                let backups = (try? FileManager.default.contentsOfDirectory(atPath: self.storage.backupsDirectory.path)) ?? []
                checks["backupFile"] = backups.contains { $0.contains("selftest") }
                let logText = (try? String(contentsOf: self.storage.directory.appendingPathComponent("app.log"), encoding: .utf8)) ?? ""
                checks["logWritten"] = logText.contains("khởi động")
                checks["calendarAuthStatus"] = CalendarBridge.authorizationStatusDescription
                for (name, ok) in self.checkReadTextFile() { checks[name] = ok }
                let required = ["bridge", "nativePicker", "bootState", "nativePanel", "ping", "acked", "saveStatusOk",
                                "backup", "storageFileWritten", "backupFile", "logWritten",
                                "readUTF8", "readUTF8BOM", "readUTF16", "readMissingFails", "readPermissionHint", "permissionMapping"]
                let passed = required.allSatisfy { (checks[$0] as? Bool) == true } && ((checks["courses"] as? Int) ?? 0) > 0
                self.finishPhase(passed: passed, "\(checks)")
            }
        }
    }

    /// Đường đọc tệp của "Nạp JSON" và ".ics" (phần sau hộp thoại chọn tệp): UTF-8, UTF-8 có BOM, UTF-16, tệp không tồn tại.
    func checkReadTextFile() -> [String: Bool] {
        let dir = storage.directory.appendingPathComponent("readtest", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        func content(_ name: String, _ data: Data) -> String? {
            let url = dir.appendingPathComponent(name)
            try? data.write(to: url)
            if case .success(let value) = AppDelegate.readTextFile(at: url), let dict = value as? [String: String] {
                return dict["content"]
            }
            return nil
        }
        let json = "{\"courses\": [{\"name\": \"Môn Việt Nam\"}]}"
        var out: [String: Bool] = [:]
        out["readUTF8"] = content("a.json", Data(json.utf8)) == json
        out["readUTF8BOM"] = content("b.json", Data([0xEF, 0xBB, 0xBF] + Array(json.utf8))) == json
        out["readUTF16"] = content("c.json", json.data(using: .utf16) ?? Data()) == json
        var missingFails = false
        if case .failure = AppDelegate.readTextFile(at: dir.appendingPathComponent("khong-ton-tai.json")) { missingFails = true }
        out["readMissingFails"] = missingFails

        // Tệp không đọc được vì thiếu quyền (mô phỏng bằng chmod 000): phải trả về lỗi "permission" kèm hướng dẫn.
        let locked = dir.appendingPathComponent("locked.json")
        try? Data("{}".utf8).write(to: locked)
        chmod(locked.path, 0o000)
        var permissionReported = false
        if case .failure(let error) = AppDelegate.readTextFile(at: locked) {
            permissionReported = error.code == "permission" && error.message.contains("Files & Folders")
        }
        chmod(locked.path, 0o644)
        out["readPermissionHint"] = permissionReported
        out["permissionMapping"] =
            AppDelegate.isPermissionError(NSError(domain: NSCocoaErrorDomain, code: 257))
            && AppDelegate.isPermissionError(NSError(domain: NSCocoaErrorDomain, code: 513))
            && AppDelegate.isPermissionError(NSError(domain: NSPOSIXErrorDomain, code: 13))
            && !AppDelegate.isPermissionError(NSError(domain: NSCocoaErrorDomain, code: 260))
        return out
    }

    // MARK: - Kịch bản "tắt rồi mở lại" (--selftest-phase)

    // Tạo dự án bằng đúng hàm mà giao diện dùng (createCourseFromSessions -> saveData -> GanttNative.saveState).
    // silent=true: chặn đường gửi tin nhắn để kiểm tra lưới an toàn "kéo trạng thái từ trang".
    private static let jsCreate = """
    var name = 'PERSIST-TEST';
    if (silent) {
      var gn = window.GanttNative;
      gn.saveState = function (k, v) { gn.bootState[String(k)] = String(v); gn.rev++; return Promise.resolve(); };
    }
    createCourseFromSessions(name, [
      { teachDate: '2026-12-01', title: 'Buổi 1', location: 'Zoom', startTime: '09:00', durationHours: 1 },
      { teachDate: '2026-12-08', title: 'Buổi 2' }
    ], true, 7);
    var c = courses.find(function (x) { return x.name === name; });
    if (!c) { return JSON.stringify({ ok: false, error: 'khong tao duoc du an' }); }
    c.sessions[0].note = 'ghi-chu-' + marker;
    saveData();
    deletedRegistry.push('persist-test-key');
    saveDeletedRegistry();
    await new Promise(function (resolve) { setTimeout(resolve, 600); });
    var g2 = window.GanttNative;
    return JSON.stringify({ ok: true, courses: courses.length, rev: g2 ? g2.rev : -1, saveOk: g2 ? g2.saveStatus.ok : null });
    """

    private static let jsModify = """
    var c = courses.find(function (x) { return x.name === 'PERSIST-TEST'; });
    if (!c) { return JSON.stringify({ ok: false, error: 'khong thay du an' }); }
    c.sessions[0].note = 'ghi-chu-' + marker;
    saveData();
    await new Promise(function (resolve) { setTimeout(resolve, 600); });
    return JSON.stringify({ ok: true });
    """

    private static let jsVerify = """
    var c = courses.find(function (x) { return x.name === 'PERSIST-TEST'; });
    var s0 = c && c.sessions && c.sessions[0];
    var r = {
      found: !!c,
      note: !!s0 && s0.note === 'ghi-chu-' + marker,
      online: !!s0 && s0.locationType === 'Online',
      dur1: !!s0 && s0.durationHours === 1,
      registry: deletedRegistry.indexOf('persist-test-key') !== -1,
      total: courses.length
    };
    r.ok = r.found && r.note && r.online && r.dur1 && r.registry;
    return JSON.stringify(r);
    """

    func runPhase(_ phase: String) {
        switch phase {
        case "write":
            runWritePhase(silent: false)
        case "write-silent":
            runWritePhase(silent: true)
        case "verify":
            runVerifyPhase()
        case "reload":
            runReloadPhase()
        default:
            failSelfTest("phase không hợp lệ: \(phase)")
        }
    }

    private func runJS(_ body: String, arguments: [String: Any] = [:], completion: @escaping (Result<String, Error>) -> Void) {
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                completion(.success((value as? String) ?? ""))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    private func runWritePhase(silent: Bool) {
        runJS(AppDelegate.jsCreate, arguments: ["marker": options.marker, "silent": silent]) { [weak self] result in
            guard let self = self else { return }
            guard case .success(let text) = result, text.contains("\"ok\":true") else {
                self.failSelfTest("write: \(result)")
                return
            }
            AppLog.shared.write("self-test: đã ghi dữ liệu thử (\(self.options.exitMode))")
            print("PERSIST-WRITTEN \(text)")
            fflush(stdout)
            switch self.options.exitMode {
            case "close":
                self.window.performClose(nil)
            case "hold":
                break   // chờ bị kill -9 từ bên ngoài
            default:
                NSApp.terminate(nil)
            }
        }
    }

    private func runVerifyPhase() {
        runJS(AppDelegate.jsVerify, arguments: ["marker": options.marker]) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                self.failSelfTest("verify JS: \(error)")
            case .success(let text):
                // Dữ liệu phải có sẵn trong tệp lúc mở app (không chỉ trong localStorage của WebView).
                let onDisk = (self.storage.initialValues["academic_smart_gantt"] ?? "").contains("PERSIST-TEST")
                let pageOK = text.contains("\"ok\":true")
                self.finishPhase(passed: pageOK && onDisk,
                                 "verify page=\(text) onDiskAtLaunch=\(onDisk) loadedFrom=\(self.storage.loadedFrom.rawValue)")
            }
        }
    }

    private func verifyMarker(_ marker: String, label: String, onPass: @escaping () -> Void) {
        runJS(AppDelegate.jsVerify, arguments: ["marker": marker]) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                self.failSelfTest("\(label): JS \(error)")
            case .success(let text):
                if text.contains("\"ok\":true") {
                    onPass()
                } else {
                    self.failSelfTest("\(label): dữ liệu bị cũ hoặc mất: \(text)")
                }
            }
        }
    }

    // Một lần chạy: ghi A -> Tải lại -> thấy A, ghi B -> Tải lại -> thấy B (đúng bản mới nhất, không quay về bản lúc mở app)
    // -> giả lập tiến trình web bị dừng -> vẫn thấy B.
    private func runReloadPhase() {
        switch reloadStep {
        case 0:
            runJS(AppDelegate.jsCreate, arguments: ["marker": "A", "silent": false]) { [weak self] result in
                guard let self = self else { return }
                guard case .success(let text) = result, text.contains("\"ok\":true") else {
                    self.failSelfTest("reload/0: \(result)")
                    return
                }
                self.reloadStep = 1
                self.reloadPage(nil)
            }
        case 1:
            verifyMarker("A", label: "reload/1") { [weak self] in
                guard let self = self else { return }
                self.runJS(AppDelegate.jsModify, arguments: ["marker": "B"]) { result in
                    guard case .success(let text) = result, text.contains("\"ok\":true") else {
                        self.failSelfTest("reload/1 modify: \(result)")
                        return
                    }
                    self.reloadStep = 2
                    self.reloadPage(nil)
                }
            }
        case 2:
            verifyMarker("B", label: "reload/2") { [weak self] in
                guard let self = self else { return }
                self.storage.waitUntilFlushed()
                let fileText = (try? String(contentsOf: self.storage.file, encoding: .utf8)) ?? ""
                guard fileText.contains("ghi-chu-B") else {
                    self.failSelfTest("reload/2: tệp trên đĩa không chứa dữ liệu mới nhất")
                    return
                }
                self.reloadStep = 3
                self.webViewWebContentProcessDidTerminate(self.webView)
            }
        case 3:
            verifyMarker("B", label: "reload/3") { [weak self] in
                guard let self = self else { return }
                // Đối chứng: ghi C rồi tải lại THẲNG bằng webView.reload() (không qua reloadPage). Nhờ dựng lại script
                // ngay tại decidePolicyFor, trang vẫn phải thấy C; ghi lại kết quả để biết cơ chế có hoạt động thật không.
                self.runJS(AppDelegate.jsModify, arguments: ["marker": "C"]) { result in
                    guard case .success(let text) = result, text.contains("\"ok\":true") else {
                        self.failSelfTest("reload/3 modify: \(result)")
                        return
                    }
                    self.reloadStep = 4
                    self.webView.reload()
                }
            }
        default:
            runJS(AppDelegate.jsVerify, arguments: ["marker": "C"]) { [weak self] result in
                guard let self = self else { return }
                var pageSeesLatest = false
                if case .success(let text) = result { pageSeesLatest = text.contains("\"ok\":true") }
                self.storage.waitUntilFlushed()
                let fileText = (try? String(contentsOf: self.storage.file, encoding: .utf8)) ?? ""
                let fileHasLatest = fileText.contains("ghi-chu-C")
                self.finishPhase(passed: pageSeesLatest && fileHasLatest,
                                 "reload: bản mới nhất còn nguyên sau 2 lần Tải lại, 1 lần khôi phục tiến trình web và 1 lần tải lại thẳng (pageSeesLatest=\(pageSeesLatest) fileHasLatest=\(fileHasLatest))")
            }
        }
    }

    // MARK: - Kết thúc

    func failSelfTest(_ detail: String) {
        guard options.isAnySelfTest else { return }
        finishPhase(passed: false, detail)
    }

    func finishPhase(passed: Bool, _ detail: String) {
        guard !selfTestFinished else { return }
        selfTestFinished = true
        AppLog.shared.write("self-test \(passed ? "PASS" : "FAIL"): \(detail)")
        AppLog.shared.flush()
        print((options.smoke ? "SELFTEST " : "PERSIST ") + (passed ? "PASS " : "FAIL ") + detail)
        fflush(stdout)
        if options.smoke { try? FileManager.default.removeItem(at: storage.directory) }
        exit(passed ? 0 : 1)
    }
}
