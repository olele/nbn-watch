"""One monitoring cycle: NBN Co status, the modem, alerts, speed test, community.

The modem is the real-time source of truth: when it is readable, "on NBN" means
working even while NBN Co's status page still lists an outage (it often lags).
NBN Co's status decides only when no modem is connected.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING

from . import community, nbn_api, router_watch
from .routers import driver_by_id
from .speedtest import (
    SpeedConfig,
    SpeedResult,
    SpeedState,
    format_jump,
    record_result,
    run_for_connection,
    speed_due,
)
from .util import redact

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from .notify import Notifier


@dataclass(frozen=True)
class RouterSettings:
    driver_id: str
    host: str
    user: str
    password: str = field(repr=False)


@dataclass(frozen=True)
class Config:
    loc_id: str
    label: str = "Home"
    address: str = ""
    router: RouterSettings | None = None
    speedtest: bool = True
    community_url: str = ""
    community: bool = False
    recovery_watch: bool = True

    @property
    def place(self) -> str:
        return f"{self.label} ({self.address})" if self.address else self.label


@dataclass
class EngineState:
    announced: str = ""  # NBN Co condition last announced: ok | outage | degraded | planned
    since: datetime | None = None

    @classmethod
    def load(cls, path: Path) -> EngineState:
        try:
            data = json.loads(path.read_text())
            since = data.get("since")
            return cls(
                str(data.get("announced", "")), datetime.fromisoformat(since) if since else None
            )
        except FileNotFoundError:
            return cls()
        except (OSError, ValueError, TypeError, AttributeError) as e:
            print(f"engine state unreadable: {redact(e)}", file=sys.stderr)
            return cls()

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(
                {
                    "announced": self.announced,
                    "since": self.since.isoformat() if self.since else None,
                }
            )
        )
        tmp.replace(path)


@dataclass
class CycleResult:
    status: nbn_api.NbnStatus
    router: router_watch.Observation | None
    speed: SpeedState
    alerts_sent: int = 0
    alerts_failed: int = 0

    @property
    def level(self) -> str:
        wan = self.router.state.wan if self.router and not self.router.error else None
        if wan == "mobile":
            return "mobile"
        if wan == "nbn":
            return "ok"  # the modem is authoritative
        if self.status.error:
            return "error"
        if self.status.outage:
            return "down"
        if self.status.degraded:
            return "degraded"
        if self.status.planned_now:
            return "planned"
        return "ok"


def _condition(status: nbn_api.NbnStatus) -> str:
    if status.outage:
        return "outage"
    if status.degraded:
        return "degraded"
    if status.planned_now:
        return "planned"
    return "ok"


def _duration(seconds: float) -> str:
    minutes = max(int(seconds) // 60, 0)
    d, h, m = minutes // 1440, (minutes // 60) % 24, minutes % 60
    return f"{d}d {h}h" if d else f"{h}h {m}m" if h else f"{m}m"


def router_line(obs: router_watch.Observation | None) -> str:
    if obs is None:
        return "🛜 Router: not connected"
    if obs.error:
        return "🛜 Router: ⚪ could not read the modem"
    return f"🛜 Router: {router_watch.describe(obs.state, obs.live)}"


def nbn_co_line(status: nbn_api.NbnStatus) -> str:
    if status.error:
        return "⚪ could not check"
    icon = (
        "🔴" if status.outage else "🟠" if status.degraded else "🚧" if status.planned_now else "🟢"
    )
    return f"{icon} {status.description}"


def nbn_co_alert(
    cfg: Config,
    before: str,
    after: str,
    status: nbn_api.NbnStatus,
    obs: router_watch.Observation | None,
    since: datetime | None,
    now: datetime,
) -> tuple[str, str, str, bool] | None:
    """(title, message, icons, silent) for an NBN Co status change, or None."""
    lines = [f"🏠 {cfg.place}", f"🕐 {now:%H:%M %a %d %b}"]
    if after in ("outage", "degraded", "planned") and before != after:
        title = {
            "outage": "NBN Co: Outage Detected",
            "degraded": "NBN Co: Degraded Service",
            "planned": "NBN Co: Planned Work Started",
        }[after]
        icons = {"outage": "down,nbnco", "degraded": "degraded,nbnco", "planned": "planned,nbnco"}[
            after
        ]
        lines += [
            f"🏢 NBN Co: {status.description}",
            "🔍 Detected by: NBN Co network status",
            router_line(obs),
        ]
        return title, "\n".join(lines), icons, after == "planned"
    if after == "ok" and before in ("outage", "degraded"):
        lines += ["🏢 NBN Co: no outage reported", "🔍 Recovery seen on: NBN Co network status"]
        if since:
            lines.append(f"⏱️ NBN Co listed it for {_duration((now - since).total_seconds())}")
        lines.append(router_line(obs))
        return "NBN Co: Outage Resolved", "\n".join(lines), "up,nbnco", False
    return None


def router_alert(
    cfg: Config,
    t: router_watch.Transition,
    obs: router_watch.Observation,
    status: nbn_api.NbnStatus,
    driver_name: str,
) -> tuple[str, str, str]:
    e = t.event
    source = "status page" if t.from_live else "failover log"
    now_line = f"🛜 Router now: {router_watch.describe(obs.state, obs.live)}"
    if e.kind == "mobile":
        backup = obs.live.mobile_name if obs.live else "Mobile"
        lines = [
            f"🏠 {cfg.place}: NBN connection lost, switched to {backup} backup",
            f"🕐 {e.timestamp:%H:%M:%S %a %d %b}",
            f"🔍 Detected by: {driver_name} ({source})",
            now_line,
            f"🏢 NBN Co now: {nbn_co_line(status)}",
        ]
        return f"Router: NBN Lost → {backup} Backup ON", "\n".join(lines), "down,router"
    lines = [
        f"🏠 {cfg.place}: NBN connection back, mobile backup off",
        f"🕐 {e.timestamp:%H:%M:%S %a %d %b}",
        f"🔍 Recovery detected by: {driver_name} ({source})",
    ]
    if t.previous_since is not None:
        on_backup = _duration((e.timestamp - t.previous_since).total_seconds())
        lines.append(f"⏱️ Time on mobile backup: {on_backup}")
    lines += [now_line, f"🏢 NBN Co now: {nbn_co_line(status)}"]
    return "Router: NBN Back → Mobile OFF", "\n".join(lines), "up,router"


def run_cycle(
    cfg: Config,
    home: Path,
    notifier: Notifier,
    *,
    now: datetime | None = None,
    check: Callable[[str], nbn_api.NbnStatus] = nbn_api.check,
    speedtest: Callable[[bool], SpeedResult] = run_for_connection,
) -> CycleResult:
    now = now or datetime.now()
    status = check(cfg.loc_id)

    # --- modem ---
    obs = None
    driver = driver_by_id(cfg.router.driver_id) if cfg.router else None
    if cfg.router and driver:
        obs = router_watch.observe(
            driver,
            cfg.router.host,
            cfg.router.user,
            cfg.router.password,
            home / "router_state.json",
            now=now,
        )
        if obs.error:
            print(f"router read failed: {obs.error}", file=sys.stderr)

    speed_cfg = SpeedConfig(
        interval_min=30.0 if cfg.speedtest else 0.0, state_file=home / "speed_state.json"
    )
    speed = SpeedState.load(speed_cfg.state_file)
    result = CycleResult(status, obs, speed)

    def deliver(title: str, message: str, icons: str, silent: bool = False) -> bool:
        ok = notifier.send(title, message, icons=icons, silent=silent) if notifier.enabled else True
        if ok:
            result.alerts_sent += int(notifier.enabled)
        else:
            result.alerts_failed += 1
        return ok

    # --- modem transitions (baseline silently on first contact) ---
    recovered = False
    if obs is not None and obs.error is None and driver is not None:
        state = obs.previous.copy() if obs.previous else obs.state
        if obs.previous is not None:
            for t in obs.transitions:
                title, message, icons = router_alert(cfg, t, obs, status, driver.name)
                if t.event.kind == "nbn" and cfg.speedtest:
                    r = speedtest(False)
                    record_result(speed, "nbn", r, speed_cfg, now, detect=False)
                    message += f"\n🚀 Speed test now (via 🌐 NBN): {r.describe()}"
                    recovered = True
                if not deliver(title, message, icons):
                    break  # retried next cycle: state stops before this transition
                state.wan, state.since, state.last_seen = (
                    t.event.kind,
                    t.event.timestamp,
                    t.event.timestamp,
                )
            else:
                state = obs.state
        state.save(home / "router_state.json")

    # --- NBN Co changes (only from successful checks) ---
    if not status.error:
        es = EngineState.load(home / "engine_state.json")
        after = _condition(status)
        if not es.announced:
            es = EngineState(after, now)  # first run: baseline, no alert
        elif after != es.announced:
            alert = nbn_co_alert(cfg, es.announced, after, status, obs, es.since, now)
            if alert is None or deliver(*alert):
                es = EngineState(after, now)
        es.save(home / "engine_state.json")

    # --- scheduled speed test + jump alerts ---
    on_mobile = obs is not None and obs.error is None and obs.state.wan == "mobile"
    if not recovered and speed_due(speed, speed_cfg, on_mobile, now):
        conn = "mobile" if on_mobile else "nbn"
        r = speedtest(on_mobile)
        jump = record_result(speed, conn, r, speed_cfg, now)
        if jump is not None:
            title, message, tags = format_jump(jump, nbn_co_line(status), router_line(obs))
            icons = ("down" if jump.direction == "drop" else "up") + ",speed"
            if not deliver(title, message, icons):
                speed.last_alert = ""  # retry the alert on the next test
    speed.save(speed_cfg.state_file)

    # --- community map ---
    if cfg.community and cfg.community_url:
        community.report_cycle(
            cfg.community_url,
            home / "community_state.json",
            cfg.loc_id,
            status,
            obs,
            speed,
            recovery_watch=cfg.recovery_watch,
            now=now,
        )
    return result
