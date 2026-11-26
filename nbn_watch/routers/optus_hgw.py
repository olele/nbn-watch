"""Optus Smart Modem / Ultra WiFi Modem (Arcadyan HGW firmware, e.g. JD6970-A).

Confirmed on a real modem. Login hashes the credentials as SHA-512(MD5-hex),
every data request needs the anti-CSRF token embedded in the referring page,
and the system log records the WAN failover to "Mobile WAN" and back.
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
import time
from datetime import datetime

import niquests

from ..util import redact
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

TS_FORMAT = "%d.%m.%Y %H:%M:%S"
_LOG_LINE = re.compile(r"^\s*(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2})\s+(?:\[[^\]]*\])*:?\s*(.*)$")
_SET_WAN = re.compile(r"set WAN type to\s+(.+)", re.IGNORECASE)
_TO_MOBILE = re.compile(r"trigger WAN failover|ETH WAN ping fail", re.IGNORECASE)
_TO_NBN = re.compile(r"failback|back to (?:ETH|Ethernet)", re.IGNORECASE)
_MOBILE_WORDS = re.compile(r"mobile|lte|4g|5g|cellular|usb", re.IGNORECASE)
# Index = the modem's wan_type (mirrors typeList in its home.htm).
_WAN_TYPES = ["FTTN/FTTB", "Fibre/Cable", "FTTN/FTTB", "", "", "", "Optus 4G"]


def classify(message: str) -> WanState | None:
    m = _SET_WAN.search(message)
    if m:
        return "mobile" if _MOBILE_WORDS.search(m.group(1)) else "nbn"
    if _TO_NBN.search(message):
        return "nbn"
    if _TO_MOBILE.search(message):
        return "mobile"
    return None


def parse_log(entries: list[str]) -> list[RouterEvent]:
    events = []
    for entry in entries:
        m = _LOG_LINE.match(entry)
        if not m:
            continue
        try:
            ts = datetime.strptime(m.group(1), TS_FORMAT)
        except ValueError:
            continue
        message = m.group(2).strip()
        kind = classify(message)
        if kind is not None:
            events.append(RouterEvent(ts, kind, message))
    events.sort(key=lambda e: e.timestamp)
    return events


def parse_log_js(text: str) -> list[str]:
    m = re.search(r"var system_log=\[(.*)\];", text, re.S)
    if not m:
        return []
    return [re.sub(r"\\(.)", r"\1", raw) for raw in re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))]


def encode_credential(value: str) -> str:
    md5_hex = hashlib.md5(value.encode()).hexdigest()  # noqa: S324 - modem protocol
    return hashlib.sha512(md5_hex.encode()).hexdigest()


def page_token(html: str) -> str:
    """Anti-CSRF token: base64 appended after a 1x1 GIF in a ``data:`` image."""
    m = re.search(r"data:image[^\"' ]+", html)
    if not m:
        raise RouterError("page token not found")
    data = m.group(0).split("base64,", 1)[-1]
    try:
        return base64.b64decode(data[56:]).decode()
    except (ValueError, UnicodeDecodeError) as e:
        raise RouterError("page token not decodable") from e


def _cgi_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for name, value in re.findall(r"var\s+(\w+)\s*=\s*'([^']*)'", text):
        values.setdefault(name, value)
    for name, value in re.findall(r'addCfg\("([^"]+)",\s*(?:"[^"]*",\s*)?"([^"]*)"\)', text):
        values.setdefault(name, value.strip())
    return values


def parse_live(text: str) -> RouterLive | None:
    values = _cgi_values(text)
    wan_type = values.get("wan_type", "")
    if not wan_type.isdigit():
        return None
    index = int(wan_type)
    connection = _WAN_TYPES[index] if index < len(_WAN_TYPES) else ""
    nbn_ip = values.get("wan_ppp_ip0") or values.get("wan_ip0", "")
    if nbn_ip in ("", "0.0.0.0"):
        nbn_ip = values.get("wan_ip0", "")
    lte = values.get("ltenetworkstatus") or values.get("networkstatus", "")
    technology, signal = "", values.get("signalstrength", "")
    for gen in ("5G", "4G", "3G"):
        indicator = values.get(f"SignalIndicator_{gen}", "")
        if indicator and indicator != "No signal":
            technology, signal = gen, indicator
            break
    return RouterLive(
        connection_type=connection or f"type {index}",
        on_mobile=index == 6,
        nbn_connected=nbn_ip not in ("", "0.0.0.0"),
        mobile_up=lte.lower() == "up",
        signal="" if signal == "No signal" else re.sub(r"\s*\(([^)]*)\)", r", \1", signal),
        technology=technology,
    )


class OptusHgw(Driver):
    id = "optus_hgw"
    name = "Optus Smart Modem"
    isp = "Optus"
    has_log = True
    password_hint = "Printed on the modem's sticker (back or bottom)."

    def matches(self, fp: Fingerprint) -> bool:
        text = fp.text
        return "login.cgi" in text and "data:image/gif" in text and "optus" in text

    def read(
        self, host: str, user: str, password: str, session: niquests.Session | None = None
    ) -> RouterReading:
        own = session is None
        s = session or niquests.Session()
        base = f"http://{host}"
        headers = {"Referer": f"{base}/login.htm"}

        def cgi(page: str, names: list[str]) -> str:
            token = page_token(s.get(f"{base}/{page}", headers=headers, timeout=10).text or "")
            parts = []
            for name in names:
                resp = s.get(
                    f"{base}/cgi/cgi_{name}.js",
                    params={"_tn": token, "_t": str(int(time.time() * 1000))},
                    headers={"Referer": f"{base}/{page}"},
                    timeout=10,
                )
                resp.raise_for_status()
                parts.append(resp.text or "")
            return "\n".join(parts)

        try:
            login_token = page_token(
                s.get(f"{base}/login.htm", headers=headers, timeout=10).text or ""
            )
            resp = s.post(
                f"{base}/login.cgi",
                data={
                    "usr": encode_credential(user),
                    "pws": encode_credential(password),
                    "nextp": "home.htm",
                    "httoken": login_token,
                },
                headers=headers,
                allow_redirects=False,
                timeout=10,
            )
            if not (resp.headers.get("Location", "") or "").endswith("home.htm"):
                raise LoginError("the modem rejected the admin username or password")
            events = parse_log(parse_log_js(cgi("log.htm", ["log"])))
            try:
                live = parse_live(cgi("home.htm", ["landing", "common", "mobile_info"]))
            except (niquests.RequestException, RouterError) as e:
                print(f"optus live status unavailable: {redact(e)}", file=sys.stderr)
                live = None
            return RouterReading(live, events)
        except niquests.RequestException as e:
            raise UnreachableError(f"modem unreachable: {redact(e)}") from e
        finally:
            if own:
                s.close()
