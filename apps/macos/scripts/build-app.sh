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
BUILD_STATE_DIR="${PIKICLAW_MACOS_BUILD_STATE_DIR:-$ROOT/.build/pikiclaw-build-coordinator}"
BUILD_LOCK_DIR="$BUILD_STATE_DIR/lock"
BUILD_REQUESTS_DIR="$BUILD_STATE_DIR/requests"
BUILD_COMPLETED_DIR="$BUILD_STATE_DIR/completed"
BUILD_DEBOUNCE_SECONDS="${PIKICLAW_MACOS_BUILD_DEBOUNCE_SECONDS:-1}"
BUILD_POLL_SECONDS="${PIKICLAW_MACOS_BUILD_POLL_SECONDS:-1}"
BUILD_REQUEST_ID="$(date +%s)-$$-$RANDOM"
BUILD_REQUEST_FILE="$BUILD_REQUESTS_DIR/$BUILD_REQUEST_ID"
BUILD_COMPLETED_FILE="$BUILD_COMPLETED_DIR/$BUILD_REQUEST_ID"
BUILD_LOCK_HELD=0
ORIGINAL_ARGS=("$@")

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
    codesign --force --deep --sign "$SIGN_IDENTITY" "$app_path" >/dev/null || return $?
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

build_bundle() {
  cd "$ROOT" || return $?
  swift build -c release || return $?

  rm -rf "$APP" || return $?
  mkdir -p "$MACOS" "$RESOURCES" || return $?
  cp "$BINARY" "$MACOS/Pikiclaw" || return $?

  cat > "$CONTENTS/Info.plist" <<'PLIST' || return $?
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
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSExceptionDomains</key>
    <dict>
      <key>xia01-i01-dkr01.int.rclabenv.com</key>
      <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key>
        <true/>
        <key>NSIncludesSubdomains</key>
        <true/>
      </dict>
    </dict>
  </dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>Pikiclaw uses the microphone so Voice Assistant can capture delegated work requests.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Pikiclaw uses speech recognition to turn your spoken request into an agent delegation brief.</string>
</dict>
</plist>
PLIST

  if [[ -f "$ICON_SRC" ]] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    rm -rf "$ICON_BUILD" || return $?
    mkdir -p "$ICONSET" || return $?
    local master="$ICON_BUILD/icon_1024.png"
    sips -s format png -z 1024 1024 "$ICON_SRC" --out "$master" >/dev/null || return $?
    for size in 16 32 64 128 256 512 1024; do
      sips -z "$size" "$size" "$master" --out "$ICON_BUILD/icon_${size}.png" >/dev/null || return $?
    done
    cp "$ICON_BUILD/icon_16.png" "$ICONSET/icon_16x16.png" || return $?
    cp "$ICON_BUILD/icon_32.png" "$ICONSET/icon_16x16@2x.png" || return $?
    cp "$ICON_BUILD/icon_32.png" "$ICONSET/icon_32x32.png" || return $?
    cp "$ICON_BUILD/icon_64.png" "$ICONSET/icon_32x32@2x.png" || return $?
    cp "$ICON_BUILD/icon_128.png" "$ICONSET/icon_128x128.png" || return $?
    cp "$ICON_BUILD/icon_256.png" "$ICONSET/icon_128x128@2x.png" || return $?
    cp "$ICON_BUILD/icon_256.png" "$ICONSET/icon_256x256.png" || return $?
    cp "$ICON_BUILD/icon_512.png" "$ICONSET/icon_256x256@2x.png" || return $?
    cp "$ICON_BUILD/icon_512.png" "$ICONSET/icon_512x512.png" || return $?
    cp "$ICON_BUILD/icon_1024.png" "$ICONSET/icon_512x512@2x.png" || return $?
    iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns" || return $?
  fi

  chmod +x "$MACOS/Pikiclaw" || return $?
  sign_app "$APP" || return $?
  echo "Built $APP"
}

cleanup_build_lock() {
  if [ "$BUILD_LOCK_HELD" = "1" ]; then
    rm -rf "$BUILD_LOCK_DIR"
    BUILD_LOCK_HELD=0
  fi
}

cleanup_on_exit() {
  local status=$?
  cleanup_build_lock
  if [ "$status" -ne 0 ] && [ ! -f "$BUILD_COMPLETED_FILE" ]; then
    rm -f "$BUILD_REQUEST_FILE"
  fi
}

trap cleanup_on_exit EXIT

try_acquire_build_lock() {
  mkdir -p "$BUILD_STATE_DIR" "$BUILD_REQUESTS_DIR" "$BUILD_COMPLETED_DIR"
  if mkdir "$BUILD_LOCK_DIR" 2>/dev/null; then
    BUILD_LOCK_HELD=1
    printf '%s\n' "$$" > "$BUILD_LOCK_DIR/pid"
    return 0
  fi

  local owner_pid=""
  if [ -f "$BUILD_LOCK_DIR/pid" ]; then
    owner_pid="$(cat "$BUILD_LOCK_DIR/pid" 2>/dev/null || true)"
  fi
  if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
    rm -rf "$BUILD_LOCK_DIR"
    if mkdir "$BUILD_LOCK_DIR" 2>/dev/null; then
      BUILD_LOCK_HELD=1
      printf '%s\n' "$$" > "$BUILD_LOCK_DIR/pid"
      return 0
    fi
  fi

  return 1
}

pending_request_count() {
  local count=0
  local request
  for request in "$BUILD_REQUESTS_DIR"/*; do
    [ -f "$request" ] || continue
    count=$((count + 1))
  done
  printf '%s\n' "$count"
}

mark_requests_complete() {
  local exit_code="$1"
  shift

  local request
  for request in "$@"; do
    [ -f "$request" ] || continue
    local request_id
    request_id="$(basename "$request")"
    printf '%s\n' "$exit_code" > "$BUILD_COMPLETED_DIR/$request_id"
    rm -f "$request"
  done
}

run_build_owner() {
  local pass=0

  while true; do
    sleep "$BUILD_DEBOUNCE_SECONDS"

    local requests=()
    local request
    for request in "$BUILD_REQUESTS_DIR"/*; do
      [ -f "$request" ] || continue
      requests+=("$request")
    done

    if [ "${#requests[@]}" -eq 0 ]; then
      break
    fi

    pass=$((pass + 1))
    if [ "$pass" -eq 1 ]; then
      echo "Starting shared Pikiclaw macOS rebuild (${#requests[@]} request(s))..."
    else
      echo "New rebuild request arrived while building; running one more shared rebuild (${#requests[@]} request(s))..."
    fi

    local build_exit=0
    set +e
    build_bundle
    build_exit=$?
    set -e

    mark_requests_complete "$build_exit" "${requests[@]}"
    if [ "$build_exit" -ne 0 ]; then
      local remaining=()
      for request in "$BUILD_REQUESTS_DIR"/*; do
        [ -f "$request" ] || continue
        remaining+=("$request")
      done
      if [ "${#remaining[@]}" -gt 0 ]; then
        mark_requests_complete "$build_exit" "${remaining[@]}"
      fi
      return "$build_exit"
    fi

    if [ "$(pending_request_count)" = "0" ]; then
      break
    fi
  done
}

write_build_request() {
  mkdir -p "$BUILD_STATE_DIR" "$BUILD_REQUESTS_DIR" "$BUILD_COMPLETED_DIR"
  {
    printf 'pid=%s\n' "$$"
    printf 'created_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'args=%s\n' "$*"
  } > "$BUILD_REQUEST_FILE"
}

run_coalesced_build() {
  write_build_request "$@"

  local announced_wait=0
  while [ ! -f "$BUILD_COMPLETED_FILE" ]; do
    if try_acquire_build_lock; then
      local owner_exit=0
      run_build_owner || owner_exit=$?
      cleanup_build_lock
      if [ "$owner_exit" -ne 0 ] && [ ! -f "$BUILD_COMPLETED_FILE" ]; then
        return "$owner_exit"
      fi
    else
      if [ "$announced_wait" = "0" ]; then
        echo "Another Pikiclaw macOS rebuild is running; waiting to reuse the shared result..."
        announced_wait=1
      fi
      sleep "$BUILD_POLL_SECONDS"
    fi
  done

  local build_exit
  build_exit="$(cat "$BUILD_COMPLETED_FILE" 2>/dev/null || printf '1')"
  rm -f "$BUILD_COMPLETED_FILE"
  if [ "$build_exit" != "0" ]; then
    echo "Shared Pikiclaw macOS rebuild failed (exit $build_exit)." >&2
    return "$build_exit"
  fi
}

run_coalesced_build "${ORIGINAL_ARGS[@]}"

if [ "$INSTALL_APP" = "1" ]; then
  install_app
elif [ "$OPEN_APP" = "1" ]; then
  open "$APP"
fi
