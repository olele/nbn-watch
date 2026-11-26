"""Diagnostic capture: help add support for a new modem without sharing passwords.

The user records a HAR file in their browser (DevTools → Network → "Save all
as HAR") while logging in to the modem and opening its status / log pages.
This module keeps only requests to the modem, removes everything personal or
secret, and produces a compact capture a contributor (or the AI pipeline) can
turn into a driver. Sanitising happens on the user's computer before upload,
and the user sees a summary first.

Removed: cookies, auth headers, form/JSON/query *values* (names are kept),
passwords, Wi-Fi names and keys, MAC addresses, public IP addresses, IPv6,
e-mail addresses, phone numbers, serial numbers and anything that looks like a
token. Kept: URL paths, parameter names, status codes, content types and the
(sanitised) page / script / JSON text of the modem's web UI.
"""

from __future__ import annotations

import ipaddress
import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlparse

CAPTURE_FORMAT = "nbnw-capture-1"
MAX_BODY = 40_000  # per response
MAX_TOTAL = 450_000
TEXT_TYPES = ("html", "javascript", "json", "xml", "text/plain", "text/css")
SECRET_KEYS = re.compile(
    r"(pass(word|wd|phrase)?|pwd|psk|wpa|wep|key|secret|token|session|sid|auth|csrf|nonce|"
    r"ssid|essid|serial|sn\b|imei|imsi|iccid|mac|bssid|pin|puk|username|user|login|email|phone|msisdn)",
    re.I,
)
_MAC = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_IPV6 = re.compile(r"\b(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_PHONE = re.compile(r"(?<![\w.])(?:\+?61|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}(?![\w.])")
_LONG_TOKEN = re.compile(r"\b[A-Za-z0-9+/=_-]{32,}\b")
# key: "value" / key='value' / key=value / "key":"value" / <input name=key value=...>
_KV = re.compile(
    r"""(?P<k>["']?(?P<name>[A-Za-z_][\w.-]{0,40})["']?\s*[:=]\s*)(?P<q>["'])(?P<v>[^"'\n]{0,300})(?P=q)""",
)
_INPUT_VALUE = re.compile(r"""(<input\b[^>]*\bvalue\s*=\s*)(["'])[^"']*\2""", re.I)
_HIDDEN_HEADERS = {"cookie", "set-cookie", "authorization", "proxy-authorization", "x-csrf-token"}


@dataclass
class Report:
    entries: int = 0
    kept: int = 0
    dropped_other_hosts: int = 0
    redactions: dict[str, int] = field(default_factory=dict)
    pages: list[str] = field(default_factory=list)

    def count(self, what: str, n: int = 1) -> None:
        if n:
            self.redactions[what] = self.redactions.get(what, 0) + n


def _private_host(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return ip.version == 4 and ip.is_private
    except ValueError:
        return host.endswith((".lan", ".home", ".local", ".gateway")) or host in ("router", "modem")


def scrub_text(text: str, report: Report) -> str:
    """Remove secrets and personal data from page / script / JSON text."""

    def kv(m: re.Match[str]) -> str:
        if SECRET_KEYS.search(m.group("name")) and m.group("v"):
            report.count("secret values")
            return f"{m.group('k')}{m.group('q')}[removed]{m.group('q')}"
        return m.group(0)

    text = _KV.sub(kv, text)
    text, n = _INPUT_VALUE.subn(r"\1\2\2", text)
    report.count("form values", n)

    def ip(m: re.Match[str]) -> str:
        try:
            addr = ipaddress.ip_address(m.group(0))
        except ValueError:
            return m.group(0)
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_unspecified
            or str(addr).startswith("255.")
        ):
            return m.group(0)
        report.count("public IP addresses")
        return "203.0.113.1"  # documentation range

    text = _IPV4.sub(ip, text)
    for pattern, name, repl in (
        (_MAC, "MAC addresses", "00:00:5E:00:53:00"),
        (_IPV6, "IPv6 addresses", "2001:db8::1"),
        (_EMAIL, "e-mail addresses", "user@example.com"),
        (_PHONE, "phone numbers", "0400 000 000"),
        (_LONG_TOKEN, "tokens", "[token]"),
    ):
        text, n = pattern.subn(repl, text)
        report.count(name, n)
    return text


def _scrub_query(url: str, report: Report) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return parsed.path or "/"
    names = [k for k, _ in parse_qsl(parsed.query, keep_blank_values=True)]
    report.count("query values", len(names))
    return f"{parsed.path or '/'}?" + "&".join(f"{k}=…" for k in names)


def _post_fields(request: dict[str, Any], report: Report) -> list[str]:
    post = request.get("postData") or {}
    names = [str(p.get("name", ""))[:60] for p in post.get("params") or [] if isinstance(p, dict)]
    text = post.get("text")
    if not names and isinstance(text, str) and text:
        try:
            data = json.loads(text)
            names = list(data)[:60] if isinstance(data, dict) else []
        except ValueError:
            names = [k for k, _ in parse_qsl(text, keep_blank_values=True)][:60]
    report.count("form values", len(names))
    return names


def sanitize_har(har: dict[str, Any]) -> tuple[dict[str, Any], Report]:
    """Return (capture, report). Raises ValueError for something that isn't a HAR."""
    entries = (har.get("log") or {}).get("entries") if isinstance(har, dict) else None
    if not isinstance(entries, list):
        raise ValueError("not a HAR file (no log.entries)")
    report = Report(entries=len(entries))
    out: list[dict[str, Any]] = []
    total = 0
    for entry in entries:
        req = entry.get("request") or {}
        resp = entry.get("response") or {}
        url = str(req.get("url", ""))
        host = urlparse(url).hostname or ""
        if not _private_host(host):
            report.dropped_other_hosts += 1
            continue
        content = resp.get("content") or {}
        mime = str(content.get("mimeType", "")).split(";")[0].lower()
        body = content.get("text") if isinstance(content.get("text"), str) else ""
        if content.get("encoding") == "base64":
            body = ""  # images and other binaries are not useful
        if body and any(t in mime for t in TEXT_TYPES):
            body = scrub_text(body[:MAX_BODY], report)
        else:
            body = ""
        if total + len(body) > MAX_TOTAL:
            body = ""
        total += len(body)
        headers = [
            {
                "name": h.get("name", ""),
                "value": "[removed]"
                if h.get("name", "").lower() in _HIDDEN_HEADERS
                else str(h.get("value", ""))[:200],
            }
            for h in (resp.get("headers") or [])
            if isinstance(h, dict)
            and h.get("name", "").lower()
            in ("content-type", "location", "server", "www-authenticate", "set-cookie")
        ]
        req_headers = [h.get("name", "") for h in (req.get("headers") or []) if isinstance(h, dict)]
        if any(h.lower() in _HIDDEN_HEADERS for h in req_headers):
            report.count("cookies / auth headers")
        path = _scrub_query(url, report)
        out.append(
            {
                "method": str(req.get("method", "GET"))[:10],
                "path": scrub_text(path, report),
                "status": resp.get("status"),
                "mime": mime[:60],
                "post_fields": _post_fields(req, report),
                "response_headers": headers,
                "body": body,
            }
        )
        if mime.endswith("html") and path not in report.pages:
            report.pages.append(path)
    report.kept = len(out)
    capture = {"format": CAPTURE_FORMAT, "entries": out, "redactions": report.redactions}
    return capture, report


def summary(report: Report) -> dict[str, Any]:
    return {
        "requests_kept": report.kept,
        "requests_dropped": report.entries - report.kept,
        "other_sites_dropped": report.dropped_other_hosts,
        "pages": report.pages[:30],
        "removed": report.redactions,
    }
