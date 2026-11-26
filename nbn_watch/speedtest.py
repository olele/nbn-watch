"""Small HTTP speed test against Cloudflare's public speed-test endpoints.

Measures latency, download and upload throughput from this machine. The
payload size is chosen by the caller so a test over the (metered) mobile
backup stays small. Results describe this computer's path through the
router, so Wi-Fi can be the bottleneck rather than the NBN link.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import niquests

from .util import redact

SPEED_BASE = "https://speed.cloudflare.com"

# (download bytes, upload bytes)
SIZE_NBN = (25_000_000, 5_000_000)
SIZE_MOBILE = (10_000_000, 2_000_000)


@dataclass(frozen=True)
class SpeedResult:
    download_mbps: float
    upload_mbps: float
    latency_ms: float
    bytes_used: int
    error: str | None = None

    def describe(self) -> str:
        if self.error:
            return f"⚪ speed test failed ({self.error})"
        mb = self.bytes_used / 1_000_000
        return (
            f"⬇️ {self.download_mbps:.1f} Mbps · ⬆️ {self.upload_mbps:.1f} Mbps · "
            f"⏱️ {self.latency_ms:.0f} ms ping ({mb:.0f} MB used)"
        )


def _mbps(num_bytes: int, seconds: float) -> float:
    return num_bytes * 8 / max(seconds, 1e-6) / 1_000_000


def run_speedtest(
    download_bytes: int,
    upload_bytes: int,
    *,
    session: niquests.Session | None = None,
    base: str | None = None,
) -> SpeedResult:
    """Run latency, download and upload tests; never raises."""
    base = base or SPEED_BASE
    own = session is None
    s = session or niquests.Session()
    try:
        latencies: list[float] = []
        for _ in range(5):
            start = time.perf_counter()
            s.get(f"{base}/__down", params={"bytes": "0"}, timeout=10).raise_for_status()
            latencies.append((time.perf_counter() - start) * 1000)

        start = time.perf_counter()
        resp = s.get(f"{base}/__down", params={"bytes": str(download_bytes)}, timeout=60)
        resp.raise_for_status()
        received = len(resp.content or b"")
        download = _mbps(received, time.perf_counter() - start)

        payload = os.urandom(upload_bytes)
        start = time.perf_counter()
        s.post(f"{base}/__up", data=payload, timeout=60).raise_for_status()
        upload = _mbps(upload_bytes, time.perf_counter() - start)

        return SpeedResult(
            download_mbps=download,
            upload_mbps=upload,
            latency_ms=statistics.median(latencies[1:] or latencies),
            bytes_used=received + upload_bytes,
        )
    except niquests.RequestException as e:
        message = redact(e)
        print(f"speed test error: {message}", file=sys.stderr)
        return SpeedResult(0.0, 0.0, 0.0, 0, error=message)
    finally:
        if own:
            s.close()


def run_for_connection(on_mobile: bool) -> SpeedResult:
    """Run a speed test sized for the current connection."""
    down, up = SIZE_MOBILE if on_mobile else SIZE_NBN
    return run_speedtest(down, up)


# --------------------------------------------------------------------------
# Scheduled tests and speed-jump alerts
# --------------------------------------------------------------------------

ConnectionName = str  # "nbn" or "mobile"


@dataclass(frozen=True)
class SpeedConfig:
    interval_min: float = 30.0  # 0 disables scheduled tests
    on_mobile: bool = False  # run scheduled tests over the mobile backup
    jump_pct: float = 50.0  # % change vs baseline that counts as a big jump
    min_delta_mbps: float = 10.0  # ignore small absolute changes
    history: int = 6  # results kept per connection for the baseline
    state_file: Path = Path("speed_state.json")


@dataclass
class SpeedState:
    history: dict[ConnectionName, list[float]] = field(default_factory=dict)  # download Mbps
    last_run: datetime | None = None
    last_alert: str = ""  # "drop" / "rise" / "" — suppresses repeats in one direction
    last_connection: ConnectionName = ""  # connection of the most recent successful result

    @classmethod
    def load(cls, path: Path) -> SpeedState:
        try:
            data = json.loads(path.read_text())
            return cls(
                history={k: [float(x) for x in v] for k, v in data.get("history", {}).items()},
                last_run=datetime.fromisoformat(data["last_run"]) if data.get("last_run") else None,
                last_alert=str(data.get("last_alert", "")),
                last_connection=str(data.get("last_connection", "")),
            )
        except FileNotFoundError:
            return cls()
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as e:
            print(f"speed state unreadable, starting fresh: {redact(e)}", file=sys.stderr)
            return cls()

    def save(self, path: Path) -> None:
        data = {
            "history": self.history,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "last_alert": self.last_alert,
            "last_connection": self.last_connection,
        }
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(path)


@dataclass(frozen=True)
class SpeedJump:
    direction: str  # "drop" or "rise"
    baseline_mbps: float
    result: SpeedResult
    connection: ConnectionName


def detect_jump(
    state: SpeedState, connection: ConnectionName, result: SpeedResult, config: SpeedConfig
) -> SpeedJump | None:
    """Compare ``result`` with the median of recent results on the same connection."""
    previous = state.history.get(connection, [])
    if result.error or len(previous) < 2:
        return None
    baseline = statistics.median(previous)
    delta = result.download_mbps - baseline
    if baseline <= 0 or abs(delta) < config.min_delta_mbps:
        return None
    if abs(delta) / baseline * 100 < config.jump_pct:
        return None
    return SpeedJump("drop" if delta < 0 else "rise", baseline, result, connection)


def speed_due(state: SpeedState, config: SpeedConfig, on_mobile: bool, now: datetime) -> bool:
    if config.interval_min <= 0 or (on_mobile and not config.on_mobile):
        return False
    if state.last_run is None:
        return True
    return (now - state.last_run).total_seconds() >= config.interval_min * 60 - 30


def record_result(
    state: SpeedState,
    connection: ConnectionName,
    result: SpeedResult,
    config: SpeedConfig,
    now: datetime,
    *,
    detect: bool = True,
) -> SpeedJump | None:
    """Store ``result``; return a jump to announce (repeats in one direction suppressed)."""
    state.last_run = now
    if result.error:
        return None
    state.last_connection = connection
    jump = detect_jump(state, connection, result, config) if detect else None
    history = state.history.setdefault(connection, [])
    history.append(round(result.download_mbps, 2))
    del history[: -config.history]
    if jump is None:
        state.last_alert = ""
        return None
    if jump.direction == state.last_alert:
        return None
    state.last_alert = jump.direction
    return jump


def format_jump(jump: SpeedJump, nbn_status: str, router_line: str | None) -> tuple[str, str, str]:
    """Return (title, message, tags) for a speed-jump alert."""
    r = jump.result
    pct = (r.download_mbps - jump.baseline_mbps) / jump.baseline_mbps * 100
    via = "📶 mobile backup" if jump.connection == "mobile" else "🌐 NBN"
    if jump.direction == "drop":
        title = f"Speed Drop: {jump.baseline_mbps:.0f} → {r.download_mbps:.0f} Mbps"
        tags = "orange_circle,rocket"
        what = f"📉 Download speed dropped {abs(pct):.0f}% below normal"
    else:
        title = f"Speed Jump Up: {jump.baseline_mbps:.0f} → {r.download_mbps:.0f} Mbps"
        tags = "green_circle,rocket"
        what = f"📈 Download speed rose {pct:.0f}% above normal"
    lines = [
        what,
        f"🚀 Speed test (via {via}): {r.describe()}",
        f"📊 Normal: about {jump.baseline_mbps:.0f} Mbps down",
        "🔍 Detected by: NBN Watch speed test from this computer",
        f"🏢 NBN Co now: {nbn_status}",
    ]
    if router_line:
        lines.append(router_line)
    return title, "\n".join(lines), tags
