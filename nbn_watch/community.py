"""Opt-in anonymous reports to the community map.

Only the NBN serving area (CSA), suburb, state/postcode, access technology and
the centre of the ~1 km grid square around the address are shared — never the
address, LOC ID (except encrypted, during an outage, if recovery watch is on),
router password or IP address. The device id is random.
"""

from __future__ import annotations

import json
import math
import secrets
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import niquests

from . import nbn_api
from .util import redact

if TYPE_CHECKING:
    from pathlib import Path

    from .router_watch import Observation
    from .speedtest import SpeedState

REPORT_VERSION = 1
ZONE_TTL = timedelta(days=7)
SPEED_MAX_AGE = timedelta(minutes=60)
GRID_DEG = 0.01  # ~1 km


def grid_centre(value: float) -> float:
    """Centre of the ``GRID_DEG`` cell containing ``value`` (never the exact spot)."""
    return round((math.floor(value / GRID_DEG) + 0.5) * GRID_DEG, 3)


@dataclass
class CommunityState:
    device_id: str = ""
    zone: nbn_api.Zone | None = None
    zone_checked: datetime | None = None
    last_sent: datetime | None = None

    @classmethod
    def load(cls, path: Path) -> CommunityState:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            z = data.get("zone")

            def dt(v: object) -> datetime | None:
                return datetime.fromisoformat(v) if isinstance(v, str) and v else None

            return cls(
                str(data.get("device_id", "")),
                nbn_api.Zone(**z) if isinstance(z, dict) else None,
                dt(data.get("zone_checked")),
                dt(data.get("last_sent")),
            )
        except FileNotFoundError:
            return cls()
        except (OSError, ValueError, TypeError, AttributeError) as e:
            print(f"community state unreadable: {redact(e)}", file=sys.stderr)
            return cls()

    def save(self, path: Path) -> None:
        data = {
            "device_id": self.device_id,
            "zone": asdict(self.zone) if self.zone else None,
            "zone_checked": self.zone_checked.isoformat() if self.zone_checked else None,
            "last_sent": self.last_sent.isoformat() if self.last_sent else None,
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        if sys.platform != "win32":
            tmp.chmod(0o600)  # the device id is also the alert-relay secret
        tmp.replace(path)


def ensure_device_id(path: Path) -> str:
    state = CommunityState.load(path)
    if not state.device_id:
        state.device_id = secrets.token_hex(16)
        state.save(path)
    return state.device_id


def nbn_state(status: nbn_api.NbnStatus) -> str:
    if status.error:
        return "error"
    if status.outage:
        return "unplanned"
    if status.degraded:
        return "degraded"
    if status.display.startswith("PLANNED"):
        return "planned"
    return "ok"


def build_report(
    state: CommunityState,
    status: nbn_api.NbnStatus,
    router: Observation | None,
    speed: SpeedState | None,
    now: datetime,
    *,
    watch_loc_id: str | None = None,
) -> dict[str, Any] | None:
    if state.zone is None or not state.device_id:
        return None
    connection, mobile_tech, mobile_since, nbn_since = "unknown", "", None, None
    if router is not None and router.error is None:
        connection = router.state.wan
        if router.live is not None:
            mobile_tech = router.live.technology
        if router.state.since:
            since = router.state.since.astimezone(UTC).isoformat(timespec="minutes")
            if connection == "mobile":
                mobile_since = since
            else:
                nbn_since = since
    down = None
    if (
        speed is not None
        and speed.last_run is not None
        and now - speed.last_run <= SPEED_MAX_AGE
        and speed.last_connection
        and (connection == "unknown" or speed.last_connection == connection)
    ):
        history = speed.history.get(speed.last_connection) or []
        if history:
            down = round(history[-1], 1)
    z = state.zone
    nbn = nbn_state(status)
    report: dict[str, Any] = {
        "v": REPORT_VERSION,
        "device": state.device_id,
        "zone": z.csa_id,
        "suburb": z.suburb,
        "state": z.state,
        "postcode": z.postcode,
        "lat": grid_centre(z.lat) if z.lat is not None else None,
        "lng": grid_centre(z.lng) if z.lng is not None else None,
        "tech": z.tech,
        "nbn": nbn,
        "connection": connection,
        "mobile_tech": mobile_tech if connection == "mobile" else "",
        "mobile_since": mobile_since,
        "nbn_since": nbn_since,
        "down_mbps": down,
    }
    # The router is authoritative; NBN Co's status decides only without one.
    problem = connection == "mobile" or (
        connection == "unknown" and nbn in ("unplanned", "degraded")
    )
    if problem and watch_loc_id:
        report["loc_id"] = watch_loc_id
    return report


def send_report(base_url: str, report: dict[str, Any]) -> bool:
    try:
        niquests.post(
            f"{base_url.rstrip('/')}/api/report", json=report, timeout=10
        ).raise_for_status()
        return True
    except niquests.RequestException as e:
        print(f"community report failed: {redact(e)}", file=sys.stderr)
        return False


def report_cycle(
    base_url: str,
    state_file: Path,
    loc_id: str,
    status: nbn_api.NbnStatus,
    router: Observation | None,
    speed: SpeedState | None,
    *,
    recovery_watch: bool,
    now: datetime,
) -> bool:
    """Send one report (refreshing the zone weekly). Never raises."""
    try:
        ensure_device_id(state_file)
        state = CommunityState.load(state_file)
        stale = state.zone_checked is None or now - state.zone_checked > ZONE_TTL
        if state.zone is None or stale:
            z = nbn_api.zone(loc_id)
            if z is not None:
                state.zone, state.zone_checked = z, now
        report = build_report(
            state, status, router, speed, now, watch_loc_id=loc_id if recovery_watch else None
        )
        sent = report is not None and send_report(base_url, report)
        if sent:
            state.last_sent = now
        state.save(state_file)
        return sent
    except Exception as e:  # noqa: BLE001 - reporting must never break monitoring
        print(f"community report error: {redact(e)}", file=sys.stderr)
        return False
