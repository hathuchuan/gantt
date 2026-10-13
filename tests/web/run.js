// Chạy lần lượt các bộ kiểm thử giao diện; thoát với mã khác 0 nếu có bộ nào thất bại.
//   node run.js                 chạy tất cả
//   SHOTS_DIR=/tmp/shots node run.js   đồng thời lưu ảnh chụp giao diện
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['features.test.js', 'persistence.test.js', 'native-bridge.test.js', 'note-links.test.js', 'ui-v2.test.js'];
let failed = 0;
for (const suite of suites) {
  console.log('\n===== ' + suite + ' =====');
  const res = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
}
console.log(failed ? '\n' + failed + ' bộ kiểm thử THẤT BẠI' : '\nTẤT CẢ BỘ KIỂM THỬ ĐỀU QUA');
process.exit(failed ? 1 : 0);
