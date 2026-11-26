"""Track the modem's connection (NBN vs mobile backup) between checks.

Works with any driver: events from the modem's log (when it keeps one) give
exact switch times; the live status catches anything the log missed.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from .routers import RouterError, RouterEvent, RouterLive, WanState
from .util import redact

if TYPE_CHECKING:
    from pathlib import Path

    from .routers import Driver


@dataclass
class RouterState:
    wan: WanState = "nbn"
    since: datetime | None = None  # when the modem entered ``wan``
    last_seen: datetime | None = None  # newest processed event

    def to_json(self) -> dict[str, str | None]:
        return {
            "wan": self.wan,
            "since": self.since.isoformat() if self.since else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
        }

    @classmethod
    def load(cls, path: Path) -> RouterState | None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            print(f"router state unreadable, re-seeding: {redact(e)}", file=sys.stderr)
            return None

        def dt(v: object) -> datetime | None:
            return datetime.fromisoformat(v) if isinstance(v, str) and v else None

        if not isinstance(data, dict):
            return None
        return cls(
            "mobile" if data.get("wan") == "mobile" else "nbn",
            dt(data.get("since")),
            dt(data.get("last_seen")),
        )

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.to_json(), indent=2), encoding="utf-8")
        tmp.replace(path)

    def copy(self) -> RouterState:
        return RouterState(self.wan, self.since, self.last_seen)


@dataclass(frozen=True)
class Transition:
    event: RouterEvent
    previous_since: datetime | None  # when the previous state began

    @property
    def from_live(self) -> bool:
        return self.event.message.startswith("Status page:")


@dataclass
class Observation:
    previous: RouterState | None
    state: RouterState  # after applying everything seen this check
    transitions: list[Transition]
    processed: list[RouterEvent]
    live: RouterLive | None = None
    error: str | None = None


def plan(
    state: RouterState, events: list[RouterEvent]
) -> tuple[list[Transition], list[RouterEvent]]:
    """Transitions for events newer than ``state``; same-kind bursts collapse into one."""
    wan, since = state.wan, state.since
    transitions: list[Transition] = []
    processed: list[RouterEvent] = []
    for event in events:
        if state.last_seen is not None and event.timestamp <= state.last_seen:
            continue
        processed.append(event)
        if event.kind != wan:
            transitions.append(Transition(event, since))
            wan, since = event.kind, event.timestamp
    return transitions, processed


def seed(events: list[RouterEvent]) -> RouterState:
    """Baseline from the current log without alerting."""
    if not events:
        return RouterState()
    wan: WanState = events[-1].kind
    since = events[-1].timestamp
    for event in reversed(events):
        if event.kind != wan:
            break
        since = event.timestamp
    return RouterState(wan, since, events[-1].timestamp)


def observe(
    driver: Driver,
    host: str,
    user: str,
    password: str,
    state_file: Path,
    *,
    now: datetime | None = None,
) -> Observation:
    previous = RouterState.load(state_file)
    try:
        reading = driver.read(host, user, password)
    except RouterError as e:
        return Observation(previous, (previous or RouterState()).copy(), [], [], error=redact(e))
    events, live = reading.events, reading.live
    now = (now or datetime.now()).replace(microsecond=0)

    if previous is None:
        state = seed(events)
        if live is not None and live.wan != state.wan:
            state = RouterState(live.wan, now, state.last_seen)
        return Observation(None, state, [], events, live)

    transitions, processed = plan(previous, events)
    after = previous.copy()
    for t in transitions:
        after.wan, after.since = t.event.kind, t.event.timestamp
    if processed:
        after.last_seen = processed[-1].timestamp
    # The live status is authoritative "now". Never stamp the synthetic event
    # before log lines already seen (the modem clock may run ahead of ours).
    if live is not None and live.wan != after.wan:
        stamp = max([now, *(t for t in (after.since, after.last_seen) if t is not None)])
        latest = max((e.timestamp for e in events), default=stamp)
        nbn = "connected" if live.nbn_connected else "disconnected"
        synthetic = RouterEvent(stamp, live.wan, f"Status page: {live.connection_type}, NBN {nbn}")
        transitions.append(Transition(synthetic, after.since))
        processed.append(synthetic)
        after.wan, after.since, after.last_seen = live.wan, stamp, max(stamp, latest)
    return Observation(previous, after, transitions, processed, live)


def describe(state: RouterState, live: RouterLive | None = None) -> str:
    """E.g. 'NBN ❌ disconnected · 📶 4G ✅ ON (Good, -94.0 dBm) since 08:39 26 Nov'."""
    when = f" since {state.since:%H:%M %d %b}" if state.since else ""
    if live is None:
        if state.wan == "mobile":
            return f"NBN ❌ down · 📶 Mobile ✅ ON{when}"
        return f"NBN ✅ connected · 📶 Mobile OFF{when}"
    nbn = "NBN ✅ connected" if live.nbn_connected else "NBN ❌ disconnected"
    signal = f" ({live.signal})" if live.signal else ""
    if live.on_mobile:
        name = live.mobile_name
        mobile = f"📶 {name} ✅ ON{signal}" if live.mobile_up else f"📶 {name} ⚠️ ON but no network"
    else:
        mobile = f"📶 {live.mobile_name} OFF (standby)" if live.mobile_up else "📶 Mobile OFF"
    return f"{nbn} · {mobile}{when}"
