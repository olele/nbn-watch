"""Telstra Smart Modem Gen 2 (Technicolor DJA0231) — EXPERIMENTAL.

Login is Technicolor's non-standard SRP-6a variant; the home page shows the
connection state as an ``img/status.png`` with class ``ok`` (NBN), ``backup``
(4G backup) or ``error`` (offline). The modem keeps no failover log we can
read, so changes are detected from that live state.

The SRP math follows the reverse-engineered client in
https://github.com/hatdz/telstra-smart-modem (MIT licence, (c) its authors).
Not yet confirmed on a real modem by nbn-watch — please report results.
"""

from __future__ import annotations

import hashlib
import re
import secrets

import niquests

from ..util import redact
from .base import (
    Driver,
    Fingerprint,
    LoginError,
    RouterError,
    RouterLive,
    RouterReading,
    UnreachableError,
)

_G = 2
_N = int(
    "ac6bdb41324a9a9bf166de5e1389582faf72b6651987ee07fc3192943db56050a37329cbb4a099ed8193e0757767a13dd"
    "52312ab4b03310dcd7f48a9da04fd50e8083969edb767b0cf6095179a163ab3661a05fbd5faaae82918a9962f0b93b855f9"
    "7993ec975eeaa80d740adbf4ff747359d041d5c33ea71d281e446b14773bca97b43a23fb801676bd207a436c6481f1d2b90"
    "78717461a5b9d32e688f87748544523b524b0d57d5ea77a2775d2ecfa032cfbdbf52fb3786160279004e57ae6af874e730"
    "3ce53299ccc041c7bc308d82a5698f3a8d0c38271ae35f8e9dbfbb694b5c803d89f7ae435de236d525f54759b65e372fcd"
    "68ef20fa7111f9e4aff73",
    16,
)
_K = int("05b9e8ef059c6b32ea59fc1d322d37f04aa30bae5aa9003b8321e21ddb04e300", 16)
_HNXORG = "4a76a9a2402bdd18123389b72ebbda50a30f65aedb90d7273130edea4b29cc4c"
_CSRF = re.compile(r'<meta[^>]+name=["\']CSRFtoken["\'][^>]+content=["\']([^"\']+)', re.I)
_STATUS = re.compile(r'<img[^>]+src=["\']img/status\.png["\'][^>]*class=["\']([\w-]+)', re.I)
_STATUS_ALT = re.compile(r'<img[^>]+class=["\']([\w-]+)[^>]*src=["\']img/status\.png', re.I)


def _hex(n: int) -> str:
    h = format(n, "x")
    return "0" + h if len(h) % 2 else h


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class SrpClient:
    """Client half of the modem's SRP variant."""

    def __init__(self, user: str, password: str, a: int | None = None) -> None:
        self.user, self.password = user, password
        self.a = a or secrets.randbits(256)
        self.A = pow(_G, self.a, _N)
        self.A_hex = _hex(self.A)

    def proof(self, s_hex: str, b_hex: str) -> str:
        b = int(b_hex, 16)
        u = int(_sha(self.A.to_bytes(256, "big") + b.to_bytes(256, "big")), 16)
        x = int(_sha(bytes.fromhex(s_hex + _sha(f"{self.user}:{self.password}".encode()))), 16)
        kgx = (_K * pow(_G, x, _N)) % _N
        secret = pow((b - kgx) % _N, (self.a + u * x) % _N, _N)
        key = _sha(secret.to_bytes(256, "big"))
        user_hash = _sha(self.user.encode())
        return _sha(bytes.fromhex(_HNXORG + user_hash + s_hex + self.A_hex + b_hex + key))


def parse_status(html: str) -> RouterLive | None:
    m = _STATUS.search(html) or _STATUS_ALT.search(html)
    if not m:
        return None
    state = m.group(1).lower()
    return RouterLive(
        connection_type={"ok": "NBN", "backup": "4G backup", "error": "Offline"}.get(state, state),
        on_mobile=state == "backup",
        nbn_connected=state == "ok",
        mobile_up=state == "backup",
        technology="4G" if state == "backup" else "",
    )


class TelstraGen2(Driver):
    id = "telstra_gen2"
    name = "Telstra Smart Modem Gen 2"
    isp = "Telstra"
    experimental = True
    password_hint = 'Default admin password is "Telstra" unless it was changed.'

    def matches(self, fp: Fingerprint) -> bool:
        text = fp.text
        return ("technicolor" in text or "telstra" in text) and (
            "srp" in text or "authenticate" in text
        )

    def read(
        self, host: str, user: str, password: str, session: niquests.Session | None = None
    ) -> RouterReading:
        own = session is None
        s = session or niquests.Session()
        base = f"http://{host}"
        try:
            home = s.get(base, timeout=10).text or ""
            m = _CSRF.search(home)
            if not m:
                raise RouterError("login token (CSRFtoken) not found")
            csrf = m.group(1)
            srp = SrpClient(user, password)
            first = s.post(
                f"{base}/authenticate",
                data={"CSRFtoken": csrf, "I": user, "A": srp.A_hex},
                timeout=10,
            )
            challenge = first.json() if first.status_code == 200 else {}
            if not (challenge.get("s") and challenge.get("B")):
                raise LoginError("the modem rejected the admin username")
            proof = srp.proof(challenge["s"], challenge["B"])
            second = s.post(
                f"{base}/authenticate", data={"CSRFtoken": csrf, "M": proof}, timeout=10
            )
            if second.status_code != 200 or not (second.json() or {}).get("M"):
                raise LoginError("the modem rejected the admin password")
            live = parse_status(s.get(base, timeout=10).text or "")
            if live is None:
                raise RouterError("logged in, but the status indicator was not found")
            return RouterReading(live, [])
        except (niquests.RequestException, ValueError) as e:
            if isinstance(e, ValueError) and not isinstance(e, niquests.RequestException):
                raise RouterError(f"unexpected modem response: {redact(e)}") from e
            raise UnreachableError(f"modem unreachable: {redact(e)}") from e
        finally:
            if own:
                s.close()
