#!/usr/bin/env bash
# Install NBN Watch for the current user (no root): ~/.local/bin + launcher (+ Omarchy bar widget).
#   packaging/linux/install.sh [path/to/nbn-watch or NBN-Watch-*.AppImage]
set -euo pipefail
SRC="${1:-dist/nbn-watch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin/nbn-watch"
[ -x "$SRC" ] || { echo "not found: $SRC" >&2; exit 1; }
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
pkill -x nbn-watch 2>/dev/null || true
install -m 755 "$SRC" "$BIN"
"$BIN" --write-icon "$HOME/.local/share/icons/hicolor/256x256/apps/nbn-watch.png"
sed "s|^Exec=nbn-watch|Exec=$BIN|" "$HERE/nbn-watch.desktop" > "$HOME/.local/share/applications/nbn-watch.desktop"
if command -v omarchy >/dev/null && [ -d "$HERE/../omarchy-plugin" ]; then
  DEST="$HOME/.config/omarchy/plugins/nbnwatch.status"
  mkdir -p "$DEST" && cp "$HERE/../omarchy-plugin/"{manifest.json,Panel.qml} "$DEST/"
  if ! jq -e '.bar.layout.right[]? | select(.id == "nbnwatch.status")' "$HOME/.config/omarchy/shell.json" >/dev/null 2>&1; then
    cp "$HOME/.config/omarchy/shell.json" "$HOME/.config/omarchy/shell.json.bak.$(date +%s)" 2>/dev/null || true
    omarchy plugin enable nbnwatch.status right >/dev/null 2>&1 || true
  fi
  echo "Omarchy bar widget installed"
fi
echo "Installed $BIN — start it from your app launcher or run: nbn-watch"
