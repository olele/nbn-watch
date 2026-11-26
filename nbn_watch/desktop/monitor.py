"""Background loop for the desktop app: runs an engine cycle every few minutes."""

from __future__ import annotations

import json
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .. import engine
from ..community import CommunityState, ensure_device_id
from ..util import redact
from .settings import POLL_MINUTES, Settings

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# level -> (colour, headline). Colours follow Omarchy's default (Tokyo Night).
LEVELS: dict[str, tuple[str, str]] = {
    "setup": ("#565f89", "Set up your address"),
    "checking": ("#565f89", "Checking…"),
    "ok": ("#9ece6a", "NBN working"),
    "planned": ("#7aa2f7", "Planned NBN work"),
    "degraded": ("#e0af68", "NBN degraded"),
    "down": ("#f7768e", "NBN outage"),
    "mobile": ("#f7768e", "NBN down · on 4G backup"),
    "error": ("#565f89", "Could not check NBN"),
}


@dataclass
class AppStatus:
    level: str = "setup"
    details: list[str] = field(default_factory=list)  # short lines (tray menu, bar tooltip)
    checked_at: datetime | None = None
    rows: list[tuple[str, str]] = field(default_factory=list)  # label/value pairs (UI, bar panel)

    @property
    def colour(self) -> str:
        return LEVELS[self.level][0]

    @property
    def headline(self) -> str:
        return LEVELS[self.level][1]


def status_from(result: engine.CycleResult, settings: Settings, now: datetime) -> AppStatus:
    place = f"{settings.label} ({settings.address})" if settings.address else settings.label
    rows: list[tuple[str, str]] = [("🏠 Address", place)]
    details = [place]
    obs = result.router
    if obs is not None and obs.error is None:
        since = f" since {obs.state.since:%H:%M %d %b}" if obs.state.since else ""
        value = ("📶 on 4G backup" if obs.state.wan == "mobile" else "🌐 on NBN") + since
        rows.append((f"🛜 {settings.router_name or 'Router'}", value))
        details.append(f"Router: {value}")
    elif obs is not None:
        rows.append(("🛜 Router", "could not read the modem"))
    else:
        rows.append(("🛜 Router", "not connected (Settings → Router)"))
    nbn_co = result.status.description
    if obs is not None and obs.error is None and obs.state.wan == "nbn" and result.status.outage:
        nbn_co += " (their page lags; your modem is back on NBN)"
    rows.append(("🏢 NBN Co", nbn_co))
    details.append(f"NBN Co: {nbn_co}")
    sp = result.speed
    if sp.last_connection and sp.history.get(sp.last_connection) and sp.last_run:
        value = f"⬇️ {sp.history[sp.last_connection][-1]:.1f} Mbps at {sp.last_run:%H:%M}"
        rows.append(("🚀 Speed", value))
        details.append(f"Speed: {value}")
    rows.append(
        ("🔔 Alerts", "Telegram" if settings.telegram_linked else "off (Settings → Telegram)")
    )
    rows.append(("👥 Community map", "sharing your area" if settings.community else "off"))
    return AppStatus(result.level, details, now, rows)


class Monitor:
    """Owns settings and runs a check every ``POLL_MINUTES`` on a worker thread."""

    def __init__(
        self,
        home: Path,
        *,
        on_change: Callable[[AppStatus, AppStatus], None] | None = None,
        cycle: Callable[..., engine.CycleResult] | None = None,
    ) -> None:
        self.home = home
        self.settings_path = home / "settings.json"
        self.settings = Settings.load(self.settings_path)
        self.status = AppStatus("setup" if not self.settings.configured else "checking")
        self.on_change = on_change
        self._cycle = cycle or engine.run_cycle
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.write_status_file()

    @property
    def device_id(self) -> str:
        return ensure_device_id(self.home / "community_state.json")

    def update_settings(self, settings: Settings) -> None:
        with self._lock:
            if settings.loc_id != self.settings.loc_id:
                # New address: fresh NBN Co baseline and zone; keep the device id
                # (it is also the Telegram relay secret).
                (self.home / "engine_state.json").unlink(missing_ok=True)
                path = self.home / "community_state.json"
                state = CommunityState.load(path)
                state.zone = state.zone_checked = None
                state.save(path)
            old_router = (self.settings.router_ip, self.settings.router_driver)
            if (settings.router_ip, settings.router_driver) != old_router:
                (self.home / "router_state.json").unlink(missing_ok=True)
            self.settings = settings
            settings.save(self.settings_path)
        self.wake()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="nbn-watch-poll", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def wake(self) -> None:
        self._wake.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            self.check_now()
            self._wake.wait(POLL_MINUTES * 60)
            self._wake.clear()

    def check_now(self) -> AppStatus:
        with self._lock:
            if not self.settings.configured:
                return self._set(AppStatus("setup", ["Open NBN Watch and choose your address."]))
            try:
                s = self.settings
                result = self._cycle(s.engine_config(), self.home, s.notifier(self.device_id))
                new = status_from(result, s, datetime.now())
            except Exception as e:  # noqa: BLE001 - the loop must survive anything
                print(f"check failed: {redact(e)}", file=sys.stderr)
                new = AppStatus("error", ["Unexpected error; will retry."], datetime.now())
            return self._set(new)

    def write_status_file(self) -> None:
        """Status for desktop widgets (e.g. the Omarchy bar plugin) to watch."""
        st = self.status
        data: dict[str, Any] = {
            "level": st.level,
            "headline": st.headline,
            "colour": st.colour,
            "details": st.details,
            "rows": [list(r) for r in st.rows],
            "checked_at": st.checked_at.strftime("%H:%M %a %d %b") if st.checked_at else "",
            "setup_done": self.settings.setup_done,
        }
        try:
            tmp = self.home / "status.json.tmp"
            tmp.write_text(json.dumps(data, ensure_ascii=False))
            tmp.replace(self.home / "status.json")
        except OSError as e:
            print(f"status file not written: {e}", file=sys.stderr)

    def _set(self, new: AppStatus) -> AppStatus:
        old, self.status = self.status, new
        self.write_status_file()
        if self.on_change is not None and (old.level != new.level or old.details != new.details):
            try:
                self.on_change(old, new)
            except Exception as e:  # noqa: BLE001
                print(f"status callback failed: {redact(e)}", file=sys.stderr)
        return new
