"""Client for NBN Co's public "check your address" service.

The same endpoints the nbnco.com.au network-status page uses: per-address
outage status, address details (serving area) and address search. Only ever
called for the user's own address.
"""

from __future__ import annotations

import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import niquests

from .util import redact

BASE = "https://places.nbnco.net.au/places"
HEADERS = {
    "Referer": "https://www.nbnco.com.au/support/network-status",
    "X-NBN-Recaptcha-Token": "nbn-watch",
}
_LOC = re.compile(r"^LOC\d{12}$")
_CSA = re.compile(r"^CSA\d{12}$")
_STATE_POSTCODE = re.compile(r"\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})\b")

# displayOutage value -> short description
DESCRIPTIONS = {
    "NO_OUTAGE": "no outage",
    "UNPLANNED_INPROGRESS": "unplanned outage",
    "UNPLANNED_RESOLVED": "unplanned outage (being resolved)",
    "DEGRADATION_INPROGRESS": "degraded service",
    "PLANNED_INPROGRESS": "planned work in progress",
    "PLANNED_UPCOMING": "planned work coming up",
}


@dataclass(frozen=True)
class NbnStatus:
    display: str  # NBN Co's displayOutage code, "" on error
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def description(self) -> str:
        if self.error:
            return "could not check"
        return DESCRIPTIONS.get(self.display, self.display.replace("_", " ").lower())

    @property
    def outage(self) -> bool:
        return self.display.startswith("UNPLANNED")

    @property
    def degraded(self) -> bool:
        return self.display.startswith("DEGRADATION")

    @property
    def planned_now(self) -> bool:
        return self.display == "PLANNED_INPROGRESS"


@dataclass(frozen=True)
class Zone:
    csa_id: str
    suburb: str = ""
    tech: str = ""
    state: str = ""
    postcode: str = ""
    lat: float | None = None  # exact; callers coarsen before sharing
    lng: float | None = None


@dataclass(frozen=True)
class AddressMatch:
    loc_id: str
    address: str


def _get(session: niquests.Session | None, url: str, timeout: float = 10) -> Any:
    s = session or niquests.Session()
    try:
        resp = s.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    finally:
        if session is None:
            s.close()


def check(loc_id: str, session: niquests.Session | None = None) -> NbnStatus:
    """Current NBN Co status for one address. Never raises."""
    url = f"{BASE}/v1/maintenance?locationId={loc_id}&uniqueid={int(time.time() * 1000)}"
    for attempt in (1, 2):
        try:
            data = _get(session, url)
        except (niquests.RequestException, ValueError) as e:
            if attempt == 2:
                print(f"nbn check failed: {redact(e)}", file=sys.stderr)
                return NbnStatus("", error=redact(e))
            time.sleep(0.5)
            continue
        if data is None:
            return NbnStatus("", error="address not found / not connected")
        display = data.get("displayOutage") if isinstance(data, dict) else None
        if not isinstance(display, str) or not display:
            return NbnStatus("", error="unexpected response")
        return NbnStatus(display, raw=data)
    return NbnStatus("", error="unreachable")  # pragma: no cover


def zone(loc_id: str, session: niquests.Session | None = None) -> Zone | None:
    """Serving area (CSA) and coarse location of an address; ``None`` on failure."""
    try:
        data = _get(session, f"{BASE}/v2/details/{loc_id}")
    except (niquests.RequestException, ValueError) as e:
        print(f"nbn zone lookup failed: {redact(e)}", file=sys.stderr)
        return None
    if not isinstance(data, dict):
        return None
    area = data.get("servingArea") or {}
    detail = data.get("addressDetail") or {}
    csa = area.get("csaId")
    if not isinstance(csa, str) or not _CSA.match(csa):
        return None
    lat, lng = detail.get("latitude"), detail.get("longitude")
    if not (isinstance(lat, int | float) and isinstance(lng, int | float)):
        lat = lng = None
    m = _STATE_POSTCODE.search(str(detail.get("formattedAddress") or ""))
    return Zone(
        csa_id=csa,
        suburb=str(area.get("description") or detail.get("locality") or "")[:40],
        tech=str(area.get("techType") or "")[:12],
        state=m.group(1) if m else "",
        postcode=m.group(2) if m else "",
        lat=float(lat) if lat is not None else None,
        lng=float(lng) if lng is not None else None,
    )


def search(query: str, session: niquests.Session | None = None) -> list[AddressMatch]:
    """Address suggestions (NBN locations only); empty on error or short input."""
    query = query.strip()
    if len(query) < 4:
        return []
    try:
        data = _get(session, f"{BASE}/v1/autocomplete?query={quote(query[:100])}")
    except (niquests.RequestException, ValueError) as e:
        print(f"address search failed: {redact(e)}", file=sys.stderr)
        return []
    out = []
    for item in (data or {}).get("suggestions") or []:
        if not isinstance(item, dict):
            continue
        loc, text = item.get("id"), item.get("formattedAddress")
        if isinstance(loc, str) and _LOC.match(loc) and isinstance(text, str):
            out.append(AddressMatch(loc, text[:120]))
    return out[:8]
