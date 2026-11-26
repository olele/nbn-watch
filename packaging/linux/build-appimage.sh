#!/usr/bin/env bash
# Wrap the PyInstaller binary in an AppImage (runs on most x86_64 distros).
#   packaging/linux/build-appimage.sh dist/nbn-watch VERSION
set -euo pipefail
BIN="$1"; VERSION="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
APPDIR="$(mktemp -d)/NBN_Watch.AppDir"
mkdir -p "$APPDIR/usr/bin"
install -m 755 "$BIN" "$APPDIR/usr/bin/nbn-watch"
cp "$HERE/nbn-watch.desktop" "$APPDIR/nbn-watch.desktop"
"$BIN" --write-icon "$APPDIR/nbn-watch.png"
cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/nbn-watch" "$@"
RUN
chmod +x "$APPDIR/AppRun"
TOOL="$(mktemp -d)/appimagetool"
curl -fsSL -o "$TOOL" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x "$TOOL"
ARCH=x86_64 "$TOOL" --appimage-extract-and-run "$APPDIR" "NBN-Watch-${VERSION}-x86_64.AppImage"
