using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AcademicGantt;

/// <summary>Cửa sổ chính: WebView2 chạy giao diện Gantt, cầu nối JS ↔ Windows (lưu dữ liệu, lịch, hộp thoại tệp).</summary>
public sealed class MainForm : Form
{
    private const string Origin = "https://gantt.local";
    private const long MaxFileBytes = 20_000_000;

    private readonly LaunchOptions _options;
    private readonly string _dataDir;
    private readonly Storage _storage;
    private readonly CalendarService _calendar = new();
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly System.Windows.Forms.Timer _watchdog = new() { Interval = 120_000 };
    private bool _selfTestStarted;
    private bool _reloadedForTest;
    private bool _finished;

    public MainForm(LaunchOptions options, string dataDir)
    {
        _options = options;
        _dataDir = dataDir;
        _storage = new Storage(dataDir);

        Text = "Academic Gantt";
        Width = 1440;
        Height = 920;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var menu = new MenuStrip();
        var file = new ToolStripMenuItem("&Tệp");
        file.DropDownItems.Add(new ToolStripMenuItem("Mở thư mục dữ liệu", null, (_, _) => OpenDataFolder()));
        file.DropDownItems.Add(new ToolStripSeparator());
        file.DropDownItems.Add(new ToolStripMenuItem("Thoát", null, (_, _) => Close()) { ShortcutKeyDisplayString = "Alt+F4" });
        var view = new ToolStripMenuItem("&Xem");
        view.DropDownItems.Add(new ToolStripMenuItem("Tải lại", null, (_, _) => _web.CoreWebView2?.Reload()) { ShortcutKeys = Keys.F5 });
        view.DropDownItems.Add(new ToolStripMenuItem("Phóng to", null, (_, _) => Zoom(+0.1)) { ShortcutKeyDisplayString = "Ctrl +" });
        view.DropDownItems.Add(new ToolStripMenuItem("Thu nhỏ", null, (_, _) => Zoom(-0.1)) { ShortcutKeyDisplayString = "Ctrl -" });
        view.DropDownItems.Add(new ToolStripMenuItem("Cỡ mặc định", null, (_, _) => _web.ZoomFactor = 1.0) { ShortcutKeyDisplayString = "Ctrl 0" });
        var help = new ToolStripMenuItem("T&rợ giúp");
        help.DropDownItems.Add(new ToolStripMenuItem("Về Academic Gantt", null, (_, _) => ShowAbout()));
        menu.Items.AddRange(new ToolStripItem[] { file, view, help });
        MainMenuStrip = menu;
        Controls.Add(_web);
        Controls.Add(menu);

        _watchdog.Tick += (_, _) => Finish(false, "quá thời gian chờ kiểm thử");
        Load += async (_, _) => await InitAsync();
        FormClosing += (_, _) =>
        {
            _storage.Flush();
            AppLog.Write("thoát");
        };
    }

    private void Zoom(double delta) => _web.ZoomFactor = Math.Clamp(_web.ZoomFactor + delta, 0.5, 3.0);

    private void OpenDataFolder()
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", $"\"{_dataDir}\"") { UseShellExecute = true }); } catch { }
    }

    private void ShowAbout()
    {
        MessageBox.Show(this,
            $"Academic Gantt {Program.Version}\nBản dành cho Windows (đọc ứng dụng Lịch / Outlook).\n\nThư mục dữ liệu:\n{_dataDir}",
            "Về Academic Gantt", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    // ---- Khởi tạo WebView2 ----

    private async Task InitAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(_dataDir, "WebView2"));
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (Exception e) when (e is WebView2RuntimeNotFoundException || e is System.Runtime.InteropServices.COMException)
        {
            AppLog.Write("WebView2 không khởi tạo được: " + e.Message);
            if (_options.IsAnySelfTest) { Finish(false, "WebView2: " + e.Message); return; }
            var answer = MessageBox.Show(this,
                "Máy này chưa có Microsoft Edge WebView2 Runtime (thành phần miễn phí của Windows) nên chưa hiển thị được giao diện.\n\n" +
                "Bấm OK để mở trang tải về, cài xong hãy mở lại Academic Gantt.",
                "Academic Gantt", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
            if (answer == DialogResult.OK) OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnResourceRequested;
        core.WebMessageReceived += OnMessage;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        };
        core.NavigationCompleted += OnNavigationCompleted;
        core.ProcessFailed += (_, e) =>
        {
            AppLog.Write("tiến trình WebView2 dừng: " + e.ProcessFailedKind);
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
            BeginInvoke(() => _web.CoreWebView2?.Reload());   // nạp lại với bản dữ liệu mới nhất trên đĩa
        };

        if (_options.IsAnySelfTest) _watchdog.Start();
        core.Navigate(Origin + "/index.html");
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
            return;
        e.Cancel = true;
        OpenExternal(e.Uri);
    }

    private static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u)) return;
        if (u.Scheme is not ("http" or "https" or "mailto")) return;
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }

    // ---- Phục vụ trang: HTML nhúng trong .exe + script cầu nối kèm dữ liệu mới nhất ----

    private static string ReadResource(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
                      ?? throw new InvalidOperationException("Thiếu tài nguyên " + name);
        using var r = new StreamReader(s, Encoding.UTF8);
        return r.ReadToEnd();
    }

    /// <summary>Dựng lại cho MỖI lần nạp trang (mở app, Tải lại), nên trang luôn khởi động bằng dữ liệu mới nhất trên đĩa.</summary>
    private string BuildPage()
    {
        var html = ReadResource("index.html");
        var state = JsonSerializer.Serialize(_storage.Snapshot());   // bộ mã hóa mặc định thoát cả '<' và ký tự không phải ASCII
        var bridge = ReadResource("bridge.js")
            .Replace("__GANTT_STORAGE__", state)
            .Replace("__GANTT_VERSION__", JsonSerializer.Serialize(Program.Version));
        var tag = "<script>" + bridge + "</script>";
        var idx = html.IndexOf("<head>", StringComparison.OrdinalIgnoreCase);
        return idx < 0 ? tag + html : html.Insert(idx + "<head>".Length, tag);
    }

    private void OnResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = _web.CoreWebView2.Environment;
        string path;
        try { path = new Uri(e.Request.Uri).AbsolutePath; } catch { path = "/"; }
        if (path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
        {
            var bytes = Encoding.UTF8.GetBytes(BuildPage());
            e.Response = env.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK",
                "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
        }
        else
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
        }
    }

    // ---- Cầu nối JS ↔ Windows ----

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
        long id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            id = root.GetProperty("id").GetInt64();
            var cmd = root.GetProperty("cmd").GetString() ?? "";
            var data = await Dispatch(cmd, root);
            Reply(id, true, data, null, null);
        }
        catch (BridgeError be)
        {
            Reply(id, false, null, be.Code, be.Message);
        }
        catch (Exception ex)
        {
            AppLog.Write("lỗi cầu nối: " + ex);
            Reply(id, false, null, "failed", ex.Message);
        }
    }

    private void Reply(long id, bool ok, object? data, string? error, string? message)
    {
        if (id == 0 || _web.CoreWebView2 == null) return;
        var json = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["id"] = id, ["ok"] = ok, ["data"] = data, ["error"] = error, ["message"] = message
        });
        try { _web.CoreWebView2.PostWebMessageAsJson(json); } catch { /* cửa sổ đang đóng */ }
    }

    private async Task<object?> Dispatch(string cmd, JsonElement body)
    {
        switch (cmd)
        {
            case "ping":
                return Program.Version;
            case "storageSet":
            {
                if (!body.TryGetProperty("key", out var k) || !body.TryGetProperty("value", out var v)
                    || k.ValueKind != JsonValueKind.String || v.ValueKind != JsonValueKind.String)
                    throw new BridgeError("invalid", "Thiếu khóa hoặc giá trị cần lưu.");
                // Chỉ trả lời sau khi dữ liệu đã nằm trên đĩa, để trang biết lần lưu có thành công hay không.
                var error = await _storage.SetAsync(k.GetString()!, v.GetString()!);
                if (error != null) throw new BridgeError("write_failed", "Không ghi được dữ liệu ra đĩa: " + error);
                return true;
            }
            case "storageRemove":
                if (body.TryGetProperty("key", out var rk) && rk.ValueKind == JsonValueKind.String) _storage.Remove(rk.GetString()!);
                return true;
            case "storageClear":
                _storage.Clear();
                return true;
            case "backupNow":
            {
                var label = body.TryGetProperty("label", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString()! : "manual";
                var done = _storage.BackupNow(label);
                AppLog.Write($"sao lưu trước '{label}': {(done ? "đã tạo" : "bỏ qua")}");
                return done;
            }
            case "listCalendars":
                return await _calendar.ListAsync();
            case "fetchEvents":
            {
                var ids = new List<string>();
                if (body.TryGetProperty("calendarIds", out var arr) && arr.ValueKind == JsonValueKind.Array)
                    foreach (var x in arr.EnumerateArray()) if (x.ValueKind == JsonValueKind.String) ids.Add(x.GetString()!);
                return await _calendar.FetchAsync(ids);
            }
            case "openCalendarPrivacySettings":
                try { Process.Start(new ProcessStartInfo("ms-settings:privacy-calendar") { UseShellExecute = true }); } catch { }
                return true;
            case "openTextFile":
            {
                var exts = new List<string>();
                if (body.TryGetProperty("extensions", out var ea) && ea.ValueKind == JsonValueKind.Array)
                    foreach (var x in ea.EnumerateArray()) if (x.ValueKind == JsonValueKind.String) exts.Add(x.GetString()!.TrimStart('.'));
                return OpenTextFile(exts);
            }
            case "saveTextFile":
            {
                var name = body.TryGetProperty("fileName", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString()! : "export.txt";
                var content = body.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString()! : "";
                return SaveTextFile(name, content);
            }
            case "selftestResult":
                if (!_options.IsAnySelfTest) throw new BridgeError("unsupported", "Lệnh không được hỗ trợ: " + cmd);
                OnSelfTestResult(body.GetProperty("result").GetString() ?? "{}");
                return true;
            default:
                throw new BridgeError("unsupported", "Lệnh không được hỗ trợ: " + cmd);
        }
    }

    private object OpenTextFile(List<string> extensions)
    {
        using var dlg = new OpenFileDialog { CheckFileExists = true, Multiselect = false };
        if (extensions.Count > 0)
        {
            var pattern = string.Join(";", extensions.Select(x => "*." + x));
            dlg.Filter = $"Tệp {string.Join(", ", extensions)} ({pattern})|{pattern}|Mọi tệp (*.*)|*.*";
        }
        if (dlg.ShowDialog(this) != DialogResult.OK) return false;
        return ReadTextFile(dlg.FileName);
    }

    /// <summary>Đọc tệp văn bản (UTF-8 có/không BOM hoặc UTF-16). Tách riêng khỏi hộp thoại để kiểm thử được.</summary>
    public static Dictionary<string, string> ReadTextFile(string path)
    {
        try
        {
            if (new FileInfo(path).Length > MaxFileBytes)
                throw new BridgeError("too_large", "Tệp quá lớn (tối đa 20 MB).");
            var text = TextCodec.Decode(File.ReadAllBytes(path))
                       ?? throw new BridgeError("decode_failed", "Không đọc được nội dung tệp (không phải văn bản UTF-8 / UTF-16).");
            return new Dictionary<string, string> { ["name"] = Path.GetFileName(path), ["content"] = text };
        }
        catch (UnauthorizedAccessException)
        {
            throw new BridgeError("permission", PermissionHint(true));
        }
        catch (BridgeError) { throw; }
        catch (Exception e)
        {
            throw new BridgeError("failed", "Không đọc được tệp: " + e.Message);
        }
    }

    private static string PermissionHint(bool reading) =>
        $"Windows không cho phép Academic Gantt {(reading ? "đọc" : "ghi")} tệp trong thư mục này " +
        "(thường do \"Truy cập thư mục được kiểm soát\" của Windows Security hoặc quyền thư mục).\n" +
        "Cách xử lý: chọn thư mục khác (ví dụ Documents hoặc Desktop của bạn), hoặc cho phép Academic Gantt trong Windows Security → Ransomware protection.";

    private object SaveTextFile(string name, string content)
    {
        using var dlg = new SaveFileDialog { FileName = name, OverwritePrompt = true };
        var ext = Path.GetExtension(name).TrimStart('.');
        dlg.Filter = ext.Length > 0 ? $"Tệp {ext} (*.{ext})|*.{ext}|Mọi tệp (*.*)|*.*" : "Mọi tệp (*.*)|*.*";
        if (dlg.ShowDialog(this) != DialogResult.OK) return false;
        try
        {
            File.WriteAllText(dlg.FileName, content, new UTF8Encoding(false));
            return true;
        }
        catch (UnauthorizedAccessException) { throw new BridgeError("permission", PermissionHint(false)); }
        catch (Exception e) { throw new BridgeError("failed", e.Message); }
    }

    // ---- Kiểm thử tự động (CI) ----

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!_options.IsAnySelfTest) return;
        if (!e.IsSuccess) { Finish(false, "không nạp được trang: " + e.WebErrorStatus); return; }
        if (_selfTestStarted) return;
        if (_options.Phase == "reload" && !_reloadedForTest)
        {
            _reloadedForTest = true;
            _web.CoreWebView2.Reload();   // lần nạp thứ hai phải thấy dữ liệu mới nhất trên đĩa
            return;
        }
        _selfTestStarted = true;
        RunSelfTestScript();
    }

    private const string JsCreate = """
        var name = 'PERSIST-TEST';
        createCourseFromSessions(name, [
          { teachDate: '2026-12-01', title: 'Buổi 1', location: 'Zoom', startTime: '09:00', durationHours: 1 },
          { teachDate: '2026-12-08', title: 'Buổi 2' }
        ], true, 7);
        var c = courses.find(function (x) { return x.name === name; });
        if (!c) { r.ok = false; r.error = 'khong tao duoc du an'; }
        else {
          c.sessions[0].note = 'ghi-chu-' + marker;
          saveData();
          deletedRegistry.push('persist-test-key');
          saveDeletedRegistry();
          await new Promise(function (resolve) { setTimeout(resolve, 600); });
          r.ok = true; r.saveOk = g.saveStatus.ok;
        }
        """;

    private const string JsVerify = """
        var c = courses.find(function (x) { return x.name === 'PERSIST-TEST'; });
        var s0 = c && c.sessions && c.sessions[0];
        r.found = !!c;
        r.note = !!s0 && s0.note === 'ghi-chu-' + marker;
        r.online = !!s0 && s0.locationType === 'Online';
        r.dur1 = !!s0 && s0.durationHours === 1;
        r.registry = deletedRegistry.indexOf('persist-test-key') !== -1;
        r.ok = r.found && r.note && r.online && r.dur1 && r.registry;
        """;

    private const string JsSmoke = """
        r.platform = g.platform === 'windows-app';
        r.bridge = typeof g.fetchEvents === 'function' && typeof g.openTextFile === 'function'
          && typeof g.saveState === 'function' && typeof g.backupNow === 'function';
        r.bootState = !!g.bootState && g.bootState.__selftest_seed === 'ok';
        r.courses = (typeof courses !== 'undefined' && Array.isArray(courses)) ? courses.length : -1;
        var picker = document.getElementById('macCalendarPicker');
        r.nativePanel = !!picker && picker.style.display !== 'none';
        r.tabLabel = (document.getElementById('tabBtnMac').textContent || '').indexOf('Windows') !== -1;
        r.ping = (await g._call('ping')) !== undefined;
        await g.saveState('__selftest_explicit', 'ok');
        r.acked = true;
        r.saveStatusOk = g.saveStatus.ok === true;
        r.backup = (await g.backupNow('selftest')) === true;
        try { var cals = await g.listCalendars(); r.calendars = 'ok:' + cals.length; }
        catch (err) { r.calendars = 'err:' + err.code; }
        """;

    private void RunSelfTestScript()
    {
        string body = _options.Smoke ? JsSmoke : _options.Phase == "write" ? JsCreate : JsVerify;
        var script = "(async function () { var r = {}; var g = window.GanttNative; var marker = " +
                     JsonSerializer.Serialize(_options.Marker) + "; try { " + body +
                     " } catch (err) { r.ok = false; r.error = String(err && err.stack || err); }" +
                     " await g._call('selftestResult', { result: JSON.stringify(r) }); })();";
        _ = _web.CoreWebView2.ExecuteScriptAsync(script);
    }

    private void OnSelfTestResult(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var r = doc.RootElement;
        bool Flag(string name) => r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

        if (_options.Smoke)
        {
            _storage.Flush();
            var fileText = File.Exists(_storage.File) ? File.ReadAllText(_storage.File) : "";
            var backups = Directory.Exists(_storage.BackupsDirectory) ? Directory.GetFiles(_storage.BackupsDirectory) : Array.Empty<string>();
            var logPath = Path.Combine(_dataDir, "app.log");
            var logText = File.Exists(logPath) ? File.ReadAllText(logPath) : "";
            var checks = new Dictionary<string, bool>
            {
                ["platform"] = Flag("platform"), ["bridge"] = Flag("bridge"), ["bootState"] = Flag("bootState"),
                ["nativePanel"] = Flag("nativePanel"), ["tabLabel"] = Flag("tabLabel"), ["ping"] = Flag("ping"),
                ["acked"] = Flag("acked"), ["saveStatusOk"] = Flag("saveStatusOk"), ["backup"] = Flag("backup"),
                ["courses"] = r.TryGetProperty("courses", out var cn) && cn.ValueKind == JsonValueKind.Number && cn.GetInt32() > 0,
                ["calendarsAnswered"] = r.TryGetProperty("calendars", out var cal) && (cal.GetString() ?? "").Length > 0,
                ["storageFileWritten"] = fileText.Contains("__selftest_explicit"),
                ["backupFile"] = backups.Any(b => b.Contains("selftest")),
                ["logWritten"] = logText.Contains("khởi động"),
            };
            foreach (var kv in CheckTextCodec()) checks[kv.Key] = kv.Value;
            var failed = checks.Where(kv => !kv.Value).Select(kv => kv.Key).ToList();
            Finish(failed.Count == 0, $"{r} | thiếu: [{string.Join(", ", failed)}]");
            return;
        }

        if (_options.Phase == "write")
        {
            if (!Flag("ok")) { Finish(false, r.ToString()); return; }
            if (_options.ExitMode == "hold") { WriteResult(true, "write xong, chờ bị kill: " + r); return; }
            Finish(true, r.ToString());
            return;
        }
        Finish(Flag("ok"), r.ToString());
    }

    private static Dictionary<string, bool> CheckTextCodec()
    {
        var json = "{\"courses\": [{\"name\": \"Môn Việt Nam\"}]}";
        var utf8 = Encoding.UTF8.GetBytes(json);
        return new Dictionary<string, bool>
        {
            ["readUTF8"] = TextCodec.Decode(utf8) == json,
            ["readUTF8BOM"] = TextCodec.Decode(new byte[] { 0xEF, 0xBB, 0xBF }.Concat(utf8).ToArray()) == json,
            ["readUTF16"] = TextCodec.Decode(Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(json)).ToArray()) == json,
            ["readInvalidFails"] = TextCodec.Decode(new byte[] { 0xC3, 0x28 }) == null
        };
    }

    private void WriteResult(bool passed, string detail)
    {
        try { File.WriteAllText(Path.Combine(_dataDir, "selftest-result.txt"), (passed ? "PASS " : "FAIL ") + detail); } catch { }
    }

    private void Finish(bool passed, string detail)
    {
        if (_finished) return;
        _finished = true;
        _watchdog.Stop();
        AppLog.Write("kiểm thử " + (passed ? "đạt" : "KHÔNG đạt") + ": " + detail);
        WriteResult(passed, detail);
        Environment.ExitCode = passed ? 0 : 1;
        if (_options.Phase == "write" && _options.ExitMode == "hold" && passed) return;
        Close();
    }
}
