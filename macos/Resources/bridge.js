// Cầu nối giữa trang HTML và ứng dụng macOS (được nạp trước mọi script của trang).
// - window.GanttNative: đọc Apple Calendar qua EventKit, lưu tệp xuất JSON.
// - Sao chép localStorage ra tệp trong ~/Library/Application Support/AcademicGantt
//   để dữ liệu bền vững và dễ sao lưu.
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

  function fireAndForget(cmd, payload) {
    call(cmd, payload).catch(function () {});
  }

  var saved = __GANTT_STORAGE__;

  window.GanttNative = {
    platform: 'macos-app',
    version: __GANTT_VERSION__,
    // Dữ liệu đã lưu trên đĩa lúc mở app: nguồn chuẩn để trang nạp lại.
    bootState: saved,
    // Lưu thẳng ra tệp, không phụ thuộc localStorage của WebView.
    saveState: function (key, value) {
      saved[String(key)] = String(value);
      fireAndForget('storageSet', { key: String(key), value: String(value) });
    },
    // Hộp thoại chọn tệp văn bản của macOS. Trả về { name, content } hoặc false nếu bấm Hủy.
    openTextFile: function (extensions) { return call('openTextFile', { extensions: extensions || [] }); },
    listCalendars: function () { return call('listCalendars'); },
    fetchEvents: function (calendarIds) { return call('fetchEvents', { calendarIds: calendarIds || [] }); },
    openCalendarPrivacySettings: function () { return call('openCalendarPrivacySettings'); },
    saveTextFile: function (fileName, content) {
      return call('saveTextFile', { fileName: String(fileName || 'export.txt'), content: String(content) });
    }
  };

  var ls;
  try { ls = window.localStorage; } catch (e) { return; }
  if (!ls) return;

  var proto = Storage.prototype;
  var origSet = proto.setItem;
  var origRemove = proto.removeItem;
  var origClear = proto.clear;

  try {
    // Tệp trên đĩa là nguồn chuẩn: nạp vào localStorage trước khi trang chạy.
    Object.keys(saved).forEach(function (k) { origSet.call(ls, k, saved[k]); });
    // Khóa chỉ có trong localStorage (VD: tệp bị xóa) thì ghi ngược ra tệp.
    for (var i = 0; i < ls.length; i++) {
      var key = ls.key(i);
      if (!Object.prototype.hasOwnProperty.call(saved, key)) {
        saved[key] = ls.getItem(key);
        fireAndForget('storageSet', { key: key, value: saved[key] });
      }
    }
  } catch (e) {}

  // bootState luôn phản ánh giá trị mới nhất để trang đọc lại không bị cũ.
  proto.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === ls) {
      saved[String(k)] = String(v);
      fireAndForget('storageSet', { key: String(k), value: String(v) });
    }
  };
  proto.removeItem = function (k) {
    origRemove.call(this, k);
    if (this === ls) {
      delete saved[String(k)];
      fireAndForget('storageRemove', { key: String(k) });
    }
  };
  proto.clear = function () {
    origClear.call(this);
    if (this === ls) {
      Object.keys(saved).forEach(function (key) { delete saved[key]; });
      fireAndForget('storageClear');
    }
  };
})();
