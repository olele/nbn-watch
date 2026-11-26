"""Router drivers. Add a new modem family by writing a :class:`Driver` and
listing it in ``DRIVERS`` (see CONTRIBUTING.md)."""

from __future__ import annotations

from .base import (
    Driver,
    Fingerprint,
    LoginError,
    RouterError,
    RouterEvent,
    RouterLive,
    RouterReading,
    UnreachableError,
    WanState,
)
from .optus_hgw import OptusHgw
from .telstra_gen2 import TelstraGen2

DRIVERS: list[Driver] = [OptusHgw(), TelstraGen2()]

# Modems we can recognise but not read yet: the app asks for a diagnostic
# capture so a driver can be written (by a contributor or the AI pipeline).
KNOWN_UNSUPPORTED: list[tuple[str, tuple[str, ...]]] = [
    ("Telstra Smart Modem Gen 3/4", ("telstra smart modem", "arcadyan", "lh1000")),
    ("TP-Link (NBN) router", ("tp-link", "archer", "deco")),
    ("Netgear router", ("netgear",)),
    ("Google / Nest Wifi", ("nest wifi", "onhub", "google wifi")),
    ("ASUS router", ("asus", "asuswrt")),
]


def driver_for(fp: Fingerprint) -> Driver | None:
    return next((d for d in DRIVERS if d.matches(fp)), None)


def driver_by_id(driver_id: str | None) -> Driver | None:
    return next((d for d in DRIVERS if d.id == driver_id), None)


def known_name(fp: Fingerprint) -> str:
    text = fp.text
    for name, needles in KNOWN_UNSUPPORTED:
        if any(n in text for n in needles):
            return name
    return ""


__all__ = [
    "DRIVERS",
    "Driver",
    "Fingerprint",
    "LoginError",
    "RouterError",
    "RouterEvent",
    "RouterLive",
    "RouterReading",
    "UnreachableError",
    "WanState",
    "driver_by_id",
    "driver_for",
    "known_name",
]
