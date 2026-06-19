#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCTS="$ROOT/Products"
APP="$PRODUCTS/Pikiclaw.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
BINARY="$ROOT/.build/release/PikiclawMac"
ICON_SRC="$ROOT/Resources/AppIcon.svg"
ICON_BUILD="$ROOT/.build/app-icon"
ICONSET="$ICON_BUILD/AppIcon.iconset"

cd "$ROOT"
swift build -c release

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"
cp "$BINARY" "$MACOS/Pikiclaw"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Pikiclaw</string>
  <key>CFBundleIdentifier</key>
  <string>com.pikiclaw.macnative</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Pikiclaw</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Pikiclaw uses the microphone so Voice Assistant can capture delegated work requests.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Pikiclaw uses speech recognition to turn your spoken request into an agent delegation brief.</string>
</dict>
</plist>
PLIST

if [[ -f "$ICON_SRC" ]] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  rm -rf "$ICON_BUILD"
  mkdir -p "$ICONSET"
  MASTER="$ICON_BUILD/icon_1024.png"
  sips -s format png -z 1024 1024 "$ICON_SRC" --out "$MASTER" >/dev/null
  for size in 16 32 64 128 256 512 1024; do
    sips -z "$size" "$size" "$MASTER" --out "$ICON_BUILD/icon_${size}.png" >/dev/null
  done
  cp "$ICON_BUILD/icon_16.png" "$ICONSET/icon_16x16.png"
  cp "$ICON_BUILD/icon_32.png" "$ICONSET/icon_16x16@2x.png"
  cp "$ICON_BUILD/icon_32.png" "$ICONSET/icon_32x32.png"
  cp "$ICON_BUILD/icon_64.png" "$ICONSET/icon_32x32@2x.png"
  cp "$ICON_BUILD/icon_128.png" "$ICONSET/icon_128x128.png"
  cp "$ICON_BUILD/icon_256.png" "$ICONSET/icon_128x128@2x.png"
  cp "$ICON_BUILD/icon_256.png" "$ICONSET/icon_256x256.png"
  cp "$ICON_BUILD/icon_512.png" "$ICONSET/icon_256x256@2x.png"
  cp "$ICON_BUILD/icon_512.png" "$ICONSET/icon_512x512.png"
  cp "$ICON_BUILD/icon_1024.png" "$ICONSET/icon_512x512@2x.png"
  iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns"
fi

chmod +x "$MACOS/Pikiclaw"
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP" >/dev/null
fi
echo "$APP"
