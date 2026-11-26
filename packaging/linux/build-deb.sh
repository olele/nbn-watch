#!/usr/bin/env bash
# Build a .deb (Ubuntu / Debian / Mint / Pop!_OS).
#   packaging/linux/build-deb.sh dist/nbn-watch VERSION
set -euo pipefail
BIN="$1"; VERSION="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d)/nbn-watch_${VERSION}_amd64"
mkdir -p "$ROOT/DEBIAN" "$ROOT/usr/bin" "$ROOT/usr/share/applications" "$ROOT/usr/share/icons/hicolor/256x256/apps"
install -m 755 "$BIN" "$ROOT/usr/bin/nbn-watch"
cp "$HERE/nbn-watch.desktop" "$ROOT/usr/share/applications/"
"$BIN" --write-icon "$ROOT/usr/share/icons/hicolor/256x256/apps/nbn-watch.png"
cat > "$ROOT/DEBIAN/control" <<CTL
Package: nbn-watch
Version: ${VERSION}
Section: net
Priority: optional
Architecture: amd64
Maintainer: NBN Watch contributors <noreply@github.com>
Description: Know the moment your NBN drops
 Router-level NBN outage detection, 4G backup tracking, Telegram alerts
 and a community outage map for Australia.
CTL
dpkg-deb -Zxz --build --root-owner-group "$ROOT" "nbn-watch_${VERSION}_amd64.deb"
