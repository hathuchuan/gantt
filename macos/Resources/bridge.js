// Cầu nối giữa trang HTML và ứng dụng macOS (được nạp trước mọi script của trang).
//
// Lưu dữ liệu:
//   - Tệp storage.json trong ~/Library/Application Support/AcademicGantt là nguồn chuẩn.
//   - Native tạo lại script này cho MỖI lần nạp / tải lại trang, nên GanttNative.bootState luôn là
//     bản mới nhất trên đĩa. Trang đọc từ bootState và ghi bằng GanttNative.saveState(key, value).
//   - saveState trả về Promise, chỉ thành công khi native đã ghi xuống đĩa; thất bại thì reject
//     và cập nhật saveStatus để giao diện cảnh báo người dùng.
(function () {
  var handlers = window.webkit && window.webkit.messageHandlers;
  var bridge = handlers && handlers.gantt;
  if (!bridge) return;

  function call(cmd, payload) {
    var msg = payload || {};
    msg.cmd = cmd;
    return bridge.postMessage(msg).then(function (res) {
      if (res && res.ok) return res.data;
      var err = new Error((res && res.message) || 'Lỗi không xác định từ ứng dụng.');
      err.code = (res && res.error) || 'failed';
      throw err;
    });
  }

  var KEY_PREFIX = 'academic_smart_gantt';
  var state = __GANTT_STORAGE__;

  var native = {
    platform: 'macos-app',
    version: __GANTT_VERSION__,
    // Dữ liệu trên đĩa lúc nạp trang; saveState cập nhật tại chỗ để luôn là bản mới nhất.
    bootState: state,
    // Tăng sau mỗi lần lưu. Native dùng để biết có gì mới cần kéo về hay không.
    rev: 0,
    // { ok, at (ms), error } của lần lưu gần nhất; onSaveStatus(status) được gọi mỗi khi đổi.
    saveStatus: { ok: true, at: null, error: null },
    onSaveStatus: null,

    saveState: function (key, value) {
      key = String(key);
      value = String(value);
      state[key] = value;
      native.rev++;
      return call('storageSet', { key: key, value: value }).then(function () {
        setStatus(true, null);
      }, function (err) {
        setStatus(false, err && err.message ? err.message : String(err));
        throw err;
      });
    },
    // Sao lưu nguyên trạng thái trên đĩa trước một thao tác phá hủy (nạp JSON, khôi phục mẫu).
    backupNow: function (label) { return call('backupNow', { label: String(label || 'manual') }); },
    // Hộp thoại chọn tệp văn bản của macOS. Trả về { name, content } hoặc false nếu bấm Hủy.
    openTextFile: function (extensions) { return call('openTextFile', { extensions: extensions || [] }); },
    listCalendars: function () { return call('listCalendars'); },
    fetchEvents: function (calendarIds) { return call('fetchEvents', { calendarIds: calendarIds || [] }); },
    openCalendarPrivacySettings: function () { return call('openCalendarPrivacySettings'); },
    saveTextFile: function (fileName, content) {
      return call('saveTextFile', { fileName: String(fileName || 'export.txt'), content: String(content) });
    }
  };

  function setStatus(ok, error) {
    native.saveStatus = { ok: ok, at: Date.now(), error: error };
    if (typeof native.onSaveStatus === 'function') {
      try { native.onSaveStatus(native.saveStatus); } catch (e) {}
    }
  }

  window.GanttNative = native;

  // Dữ liệu cũ nằm trong localStorage của WebView (bản 3.0.x / 3.1.0, hoặc bản sao phụ do trang ghi):
  // chỉ bổ sung những khóa mà tệp trên đĩa chưa có, tuyệt đối không ghi đè dữ liệu trong tệp.
  try {
    var ls = window.localStorage;
    for (var i = 0; ls && i < ls.length; i++) {
      var key = ls.key(i);
      if (key && key.indexOf(KEY_PREFIX) === 0 && !Object.prototype.hasOwnProperty.call(state, key)) {
        var value = ls.getItem(key);
        if (typeof value === 'string' && value !== '') {
          state[key] = value;
          native.rev++;
          call('storageSet', { key: key, value: value }).catch(function () {});
        }
      }
    }
  } catch (e) {}
})();
