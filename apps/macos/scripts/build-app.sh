#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCTS="$ROOT/Products"
APP="$PRODUCTS/Pikiclaw.app"
APP_BUNDLE_NAME="Pikiclaw.app"
INSTALL_DIR="/Applications"
INSTALL_APP=0
OPEN_APP=0
SIGN_IDENTITY="${PIKICLAW_CODESIGN_IDENTITY:--}"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
BINARY="$ROOT/.build/release/PikiclawMac"
ICON_SRC="$ROOT/Resources/AppIcon.svg"
ICON_BUILD="$ROOT/.build/app-icon"
ICONSET="$ICON_BUILD/AppIcon.iconset"
BUNDLE_ID="com.pikiclaw.macnative"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

usage() {
  cat <<'USAGE'
Usage: apps/macos/scripts/build-app.sh [options]

Builds the macOS native Pikiclaw app into apps/macos/Products/Pikiclaw.app.

Options:
  --install              Copy the built app to /Applications/Pikiclaw.app.
  --open                 Open the app after building. With --install, opens the
                         /Applications copy; otherwise opens the Products copy.
  --install-dir <dir>    Install directory for --install. Defaults to /Applications.
  --sign-identity <id>   codesign identity. Defaults to PIKICLAW_CODESIGN_IDENTITY
                         or ad-hoc "-". Use a stable identity to reduce repeated
                         macOS microphone/speech permission prompts after rebuilds.
  -h, --help             Show this help.

Canonical dev loop:
  apps/macos/scripts/build-app.sh --install --open
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install)
      INSTALL_APP=1
      ;;
    --open)
      OPEN_APP=1
      ;;
    --install-dir)
      shift
      [ "$#" -gt 0 ] || { echo "--install-dir requires a path" >&2; exit 2; }
      INSTALL_DIR="$1"
      ;;
    --sign-identity)
      shift
      [ "$#" -gt 0 ] || { echo "--sign-identity requires a codesign identity" >&2; exit 2; }
      SIGN_IDENTITY="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

quit_installed_app() {
  local installed_app="$1"
  local executable="$installed_app/Contents/MacOS/Pikiclaw"
  local waited=0

  if ! pgrep -f "$executable" >/dev/null 2>&1; then
    return 0
  fi

  echo "Quitting running $installed_app before install..."
  /usr/bin/osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  while pgrep -f "$executable" >/dev/null 2>&1; do
    if [ "$waited" -ge 15 ]; then
      echo "Pikiclaw is still running. Quit it, then rerun this command." >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

sign_app() {
  local app_path="$1"
  /usr/bin/xattr -cr "$app_path" 2>/dev/null || true
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign "$SIGN_IDENTITY" "$app_path" >/dev/null
  fi
}

install_app() {
  local installed_app="$INSTALL_DIR/$APP_BUNDLE_NAME"
  mkdir -p "$INSTALL_DIR"
  quit_installed_app "$installed_app"
  rm -rf "$installed_app"
  /usr/bin/ditto "$APP" "$installed_app"
  sign_app "$installed_app"
  touch "$installed_app"

  if [ -x "$LSREGISTER" ]; then
    "$LSREGISTER" -u "$APP" >/dev/null 2>&1 || true
    "$LSREGISTER" -f "$installed_app" >/dev/null 2>&1 || true
  fi

  echo "Installed $installed_app"
  if [ "$OPEN_APP" = "1" ]; then
    open "$installed_app"
  fi
}

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
sign_app "$APP"
echo "Built $APP"

if [ "$INSTALL_APP" = "1" ]; then
  install_app
elif [ "$OPEN_APP" = "1" ]; then
  open "$APP"
fi
