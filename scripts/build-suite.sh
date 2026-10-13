#!/usr/bin/env bash
# Build "Academic Gantt.app" + "MD Editor.app" và đóng gói CẢ HAI trong một DMG để cài một lần.
# Yêu cầu: macOS, Xcode Command Line Tools, Node 20+.
# Dùng: ./scripts/build-suite.sh            → dist/AcademicSuite-<version>.dmg
#       VERSION=3.2.0 ./scripts/build-suite.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
SUITE="Academic Suite"
VERSION="${VERSION:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT/macos/Info.plist")}"
DMG="$OUT/AcademicSuite-$VERSION.dmg"

rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> Academic Gantt"
SKIP_DMG=1 VERSION="$VERSION" "$ROOT/macos/build.sh"
GANTT_APP="$ROOT/macos/build/Academic Gantt.app"

echo "==> MD Editor"
(
  cd "$ROOT/md-editor"
  npm ci --no-audit --no-fund
  npm test
  rm -rf dist
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --universal
)
MD_APP="$(find "$ROOT/md-editor/dist" -maxdepth 2 -name 'MD Editor.app' -type d | head -n 1)"
[ -d "$MD_APP" ] || { echo "Không thấy MD Editor.app sau khi build" >&2; exit 1; }

echo "==> Đóng gói DMG"
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
ditto "$GANTT_APP" "$STAGE/Academic Gantt.app"
ditto "$MD_APP" "$STAGE/MD Editor.app"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/Đọc trước.txt" <<'TXT'
Cài đặt: kéo CẢ HAI ứng dụng (Academic Gantt và MD Editor) vào Applications.
Hai ứng dụng dùng độc lập được; khi cài cùng nhau, ⌘-nhấp một khối trên Gantt sẽ mở ghi chú của khối đó trong MD Editor.

Lần đầu mở, macOS báo "Apple không thể xác minh…" vì ứng dụng chưa công chứng. Chạy 1 lần trong Terminal:
  xattr -dr com.apple.quarantine "/Applications/Academic Gantt.app" "/Applications/MD Editor.app"
Hoặc System Settings → Privacy & Security → Open Anyway cho từng ứng dụng.

Mở mỗi ứng dụng ít nhất một lần để macOS đăng ký liên kết giữa chúng.
TXT
for ATTEMPT in 1 2 3; do
  if hdiutil create -volname "$SUITE" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null; then
    break
  fi
  [ "$ATTEMPT" -eq 3 ] && { echo "hdiutil thất bại" >&2; exit 1; }
  sleep 5
done
rm -rf "$STAGE"
echo "==> Xong: $DMG"
