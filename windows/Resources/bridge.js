// Cầu nối giữa trang HTML và ứng dụng Windows (WebView2). Ứng dụng chèn script này vào đầu trang
// mỗi lần nạp / tải lại, kèm bản dữ liệu mới nhất trên đĩa, nên GanttNative.bootState luôn là bản mới nhất.
//   - Tệp storage.json trong %LOCALAPPDATA%\AcademicGantt là nguồn chuẩn.
//   - saveState trả về Promise, chỉ thành công khi native đã ghi xuống đĩa.
(function () {
  var wv = window.chrome && window.chrome.webview;
  if (!wv) return;

  var pending = {};
  var nextId = 1;
  wv.addEventListener('message', function (ev) {
    var res = ev.data;
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch (e) { return; } }
    if (!res || res.id === undefined || !pending[res.id]) return;
    var p = pending[res.id];
    delete pending[res.id];
    p(res);
  });

  function post(msg) {
    return new Promise(function (resolve) {
      var id = nextId++;
      pending[id] = resolve;
      msg.id = id;
      wv.postMessage(msg);
    });
  }

  function call(cmd, payload) {
    var msg = payload || {};
    msg.cmd = cmd;
    return post(msg).then(function (res) {
      if (res && res.ok) return res.data;
      var err = new Error((res && res.message) || 'Lỗi không xác định từ ứng dụng.');
      err.code = (res && res.error) || 'failed';
      throw err;
    });
  }

  var KEY_PREFIX = 'academic_smart_gantt';
  var state = __GANTT_STORAGE__;

  var native = {
    platform: 'windows-app',
    version: __GANTT_VERSION__,
    bootState: state,
    rev: 0,
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
    backupNow: function (label) { return call('backupNow', { label: String(label || 'manual') }); },
    // Hộp thoại chọn tệp của Windows. Trả về { name, content } hoặc false nếu bấm Hủy.
    openTextFile: function (extensions) { return call('openTextFile', { extensions: extensions || [] }); },
    listCalendars: function () { return call('listCalendars'); },
    fetchEvents: function (calendarIds) { return call('fetchEvents', { calendarIds: calendarIds || [] }); },
    openCalendarPrivacySettings: function () { return call('openCalendarPrivacySettings'); },
    saveTextFile: function (fileName, content) {
      return call('saveTextFile', { fileName: String(fileName || 'export.txt'), content: String(content) });
    },
    // Chỉ dùng cho kiểm thử tự động.
    _call: call
  };

  function setStatus(ok, error) {
    native.saveStatus = { ok: ok, at: Date.now(), error: error };
    if (typeof native.onSaveStatus === 'function') {
      try { native.onSaveStatus(native.saveStatus); } catch (e) {}
    }
  }

  window.GanttNative = native;

  // Dữ liệu cũ trong localStorage của WebView: chỉ bổ sung khóa mà tệp trên đĩa chưa có, không ghi đè.
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
