#!/usr/bin/env bash
# Daily systemd user timer: copy router-support reports into GitHub issues.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT="$HOME/.config/systemd/user"
mkdir -p "$UNIT"
cat > "$UNIT/nbn-watch-router-issues.service" <<UNITEOF
[Unit]
Description=Sync NBN Watch router-support reports to GitHub issues and draft drivers

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=/usr/bin/bash -c 'set -a; . ./.env; set +a; exec $DIR/.venv/bin/python scripts/sync_router_issues.py'
# Then let an AI draft drivers for new captures (draft PRs only; see docs/ai-router-support.md).
ExecStart=/usr/bin/bash -c 'set -a; . ./.env; set +a; exec $DIR/.venv/bin/python scripts/ai_router_driver.py'
Environment=PATH=$PATH
TimeoutStartSec=3h
UNITEOF
cat > "$UNIT/nbn-watch-router-issues.timer" <<UNITEOF
[Unit]
Description=Daily router-support issue sync

[Timer]
OnCalendar=*-*-* 08:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNITEOF
systemctl --user daemon-reload
systemctl --user enable --now nbn-watch-router-issues.timer
systemctl --user list-timers nbn-watch-router-issues.timer --no-pager
