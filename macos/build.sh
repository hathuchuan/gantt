#!/usr/bin/env bash
# Build "Academic Gantt.app" (universal: Apple Silicon + Intel) và đóng gói DMG để cài trên máy khác.
# Yêu cầu: macOS + Xcode Command Line Tools (xcode-select --install).
# Dùng: ./macos/build.sh            → macos/build/AcademicGantt-<version>.dmg
#       VERSION=3.1.0 ./macos/build.sh
#       SKIP_DMG=1 ./macos/build.sh   → chỉ tạo .app (scripts/build-suite.sh dùng cách này)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAC="$ROOT/macos"
BUILD="$MAC/build"
APP_NAME="Academic Gantt"
EXEC="AcademicGantt"
MIN_MACOS="11.0"
VERSION="${VERSION:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$MAC/Info.plist")}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
APP="$BUILD/$APP_NAME.app"
DMG="$BUILD/AcademicGantt-$VERSION.dmg"

rm -rf "$BUILD"
mkdir -p "$BUILD"

echo "==> Biên dịch Swift (phiên bản $VERSION)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
for ARCH in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -parse-as-library \
    -sdk "$SDK" -target "$ARCH-apple-macos$MIN_MACOS" \
    "$MAC"/Sources/*.swift -o "$BUILD/$EXEC-$ARCH"
done
lipo -create "$BUILD/$EXEC-arm64" "$BUILD/$EXEC-x86_64" -output "$BUILD/$EXEC"

echo "==> Đóng gói $APP_NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$BUILD/$EXEC" "$APP/Contents/MacOS/$EXEC"
cp "$MAC/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy \
  -c "Set :CFBundleShortVersionString $VERSION" \
  -c "Set :CFBundleVersion $BUILD_NUMBER" \
  "$APP/Contents/Info.plist"
cp "$MAC/Resources/bridge.js" "$APP/Contents/Resources/bridge.js"
cp "$ROOT/web/academic_gantt_planner.html" "$APP/Contents/Resources/web/index.html"

echo "==> Tạo biểu tượng"
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$MAC/AppIcon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  sips -z "$((SIZE * 2))" "$((SIZE * 2))" "$MAC/AppIcon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> Ký ad-hoc"
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"

if [ -n "${SKIP_DMG:-}" ]; then
  rm -rf "$BUILD/AppIcon.iconset" "$BUILD/$EXEC" "$BUILD/$EXEC-arm64" "$BUILD/$EXEC-x86_64"
  echo "==> Xong (không tạo DMG): $APP"
  exit 0
fi

echo "==> Tạo DMG"
STAGE="$BUILD/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"
# hdiutil thỉnh thoảng báo "Resource busy" trên máy CI: thử lại vài lần.
for ATTEMPT in 1 2 3; do
  if hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null; then
    break
  fi
  [ "$ATTEMPT" -eq 3 ] && { echo "hdiutil thất bại" >&2; exit 1; }
  sleep 5
done

rm -rf "$STAGE" "$ICONSET" "$BUILD/$EXEC" "$BUILD/$EXEC-arm64" "$BUILD/$EXEC-x86_64"
echo "==> Xong:"
echo "    App: $APP"
echo "    DMG: $DMG"
