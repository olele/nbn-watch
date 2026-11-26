"""Find and identify the home router, test the admin login, report unsupported models.

Used by the desktop setup wizard. Identification uses only what the router
publishes to the local network: its login page (title, server header) and its
UPnP device description (manufacturer / model). When a router is not one the
app can read yet, a fingerprint can be sent to the community server so support
can be added in a later app update. The admin password is never sent anywhere.
"""

from __future__ import annotations

import ipaddress
import platform
import re
import socket
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

import niquests

from .routers import (
    Fingerprint,
    LoginError,
    RouterError,
    RouterLive,
    UnreachableError,
    driver_by_id,
    driver_for,
    known_name,
)
from .util import redact as _safe_error_message

COMMON_GATEWAYS = ("192.168.0.1", "192.168.1.1", "10.0.0.138", "10.0.0.1", "192.168.1.254")
LOGIN_PAGE_MAX = 20_000


@dataclass
class RouterFingerprint:
    host: str
    reachable: bool = False
    title: str = ""
    server_header: str = ""
    realm: str = ""  # HTTP basic-auth realm, often the model name
    login_path: str = ""
    upnp_manufacturer: str = ""
    upnp_model: str = ""
    upnp_model_number: str = ""
    upnp_friendly: str = ""
    family: str | None = None  # driver id when a driver can read this modem
    known: str = ""  # recognised but not yet supported, e.g. "Telstra Smart Modem Gen 3/4"
    role: str = ""  # "nbn_modem" (connects to the internet) or "wifi" (behind it)
    isp_brand: str = ""  # e.g. "Optus" when the device is ISP-branded
    login_page: str = field(default="", repr=False)  # sanitised (safe to share)
    raw_html: str = field(default="", repr=False, compare=False)  # never shared; for identification
    paths: list[str] = field(default_factory=list)

    @property
    def supported(self) -> bool:
        return driver_by_id(self.family) is not None

    @property
    def experimental(self) -> bool:
        d = driver_by_id(self.family)
        return bool(d and d.experimental)

    def fingerprint(self) -> Fingerprint:
        return Fingerprint(
            html=self.raw_html or self.login_page,
            title=self.title,
            server_header=self.server_header,
            realm=self.realm,
            upnp_manufacturer=self.upnp_manufacturer,
            upnp_model=self.upnp_model,
        )

    def identify(self) -> None:
        d = driver_for(self.fingerprint())
        self.family = d.id if d else None
        self.known = "" if d else known_name(self.fingerprint())

    def describe(self) -> str:
        d = driver_by_id(self.family)
        if d:
            return d.name
        if self.known:
            return self.known
        model = " ".join(
            p for p in (self.upnp_manufacturer, self.upnp_model, self.upnp_model_number) if p
        )
        if model:
            return model
        if self.title:
            return self.title
        if self.realm:
            return self.realm
        if self.server_header:
            return f"Unknown router ({self.server_header})"
        return "Unknown router" if self.reachable else "No router found"

    def issue_payload(self, *, device: str, app_version: str, error: str = "") -> dict[str, Any]:
        data = asdict(self)
        for drop in (
            "host",
            "reachable",
            "family",
            "login_path",
            "role",
            "isp_brand",
            "known",
            "raw_html",
        ):
            data.pop(drop)
        data.update(
            device=device,
            gateway_vendor=self.upnp_manufacturer,
            os=f"{platform.system()} {platform.release()}"[:40],
            app_version=app_version,
            error=error[:300],
        )
        return data


# --------------------------------------------------------------------------
# Gateway discovery
# --------------------------------------------------------------------------


def _private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.version == 4 and addr.is_private and not addr.is_loopback


def _linux_gateway(route_file: Path = Path("/proc/net/route")) -> str | None:
    try:
        for line in route_file.read_text(encoding="utf-8").splitlines()[1:]:
            parts = line.split()
            if len(parts) > 2 and parts[1] == "00000000" and parts[2] != "00000000":
                raw = bytes.fromhex(parts[2])[::-1]
                return socket.inet_ntoa(raw)
    except (OSError, ValueError):
        pass
    return None


def _command_gateway(cmd: list[str], pattern: str) -> str | None:  # pragma: no cover - OS specific
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=5, check=False, creationflags=flags
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(pattern, out, re.MULTILINE)
    return m.group(1) if m else None


def default_gateway() -> str | None:
    """IPv4 default gateway (the home router), if it is a private address."""
    if sys.platform.startswith("linux"):
        gw = _linux_gateway()
    elif sys.platform == "darwin":  # pragma: no cover
        gw = _command_gateway(["route", "-n", "get", "default"], r"gateway:\s*(\S+)")
    elif sys.platform == "win32":  # pragma: no cover
        gw = _command_gateway(
            ["route", "print", "-4", "0.0.0.0"],
            r"^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)",
        )
    else:  # pragma: no cover
        gw = None
    return gw if gw and _private(gw) else None


# --------------------------------------------------------------------------
# Fingerprinting
# --------------------------------------------------------------------------

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_VALUE_RE = re.compile(r"""(value\s*=\s*)(["'])(.*?)\2""", re.I | re.S)
_DATA_URI_RE = re.compile(r"data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{40,}")
_LINK_RE = re.compile(r"""(?:href|src|action)\s*=\s*["']([^"'#?]+)""", re.I)


def sanitize_page(html: str) -> str:
    """Login page for support issues: no form values, no embedded tokens."""
    text = _VALUE_RE.sub(r"\1\2\2", html)
    text = _DATA_URI_RE.sub("data:[removed]", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text[:LOGIN_PAGE_MAX]


def ssdp_description(host: str, timeout: float = 2.0) -> dict[str, str]:
    """UPnP device description of ``host`` (manufacturer/model), if it answers SSDP."""
    msg = (
        b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\n'
        b"MX: 1\r\nST: upnp:rootdevice\r\n\r\n"
    )
    location = None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
            sock.settimeout(timeout)
            sock.sendto(msg, ("239.255.255.250", 1900))
            while location is None:
                data, (addr, _port) = sock.recvfrom(4096)
                if addr != host:
                    continue
                m = re.search(rb"^location:\s*(\S+)", data, re.I | re.M)
                if m:
                    location = m.group(1).decode(errors="replace")
    except OSError:
        return {}
    if location is None or urlparse(location).hostname != host:
        return {}
    try:
        xml = niquests.get(location, timeout=3).text or ""
        root = ElementTree.fromstring(xml)
    except (niquests.RequestException, ElementTree.ParseError):
        return {}

    def find(tag: str) -> str:
        for el in root.iter():
            if el.tag.rsplit("}", 1)[-1] == tag and el.text:
                return el.text.strip()[:120]
        return ""

    return {
        "upnp_manufacturer": find("manufacturer"),
        "upnp_model": find("modelName"),
        "upnp_model_number": find("modelNumber"),
        "upnp_friendly": find("friendlyName"),
    }


def probe(
    host: str,
    session: niquests.Session | None = None,
    *,
    upnp: bool = True,
    timeout: float = 5,
    quiet: bool = False,
) -> RouterFingerprint:
    """Identify the router at ``host``. Never raises."""
    fp = RouterFingerprint(host=host)
    s = session or niquests.Session()
    try:
        resp = s.get(f"http://{host}/", timeout=timeout, allow_redirects=True)
        fp.reachable = True
        fp.server_header = (resp.headers.get("Server") or "")[:120]
        auth = resp.headers.get("WWW-Authenticate") or ""
        m = re.search(r'realm="([^"]*)"', auth)
        fp.realm = m.group(1)[:120] if m else ""
        html = resp.text or ""
        fp.login_path = urlparse(str(resp.url or "")).path or "/"
        title = _TITLE_RE.search(html)
        fp.title = re.sub(r"\s+", " ", title.group(1)).strip()[:120] if title else ""
        fp.raw_html = html[:200_000]
        fp.login_page = sanitize_page(html)
        base = f"http://{host}{fp.login_path}"
        seen: list[str] = []
        for link in _LINK_RE.findall(html):
            path = urlparse(urljoin(base, link)).path
            if path and path not in seen and urlparse(urljoin(base, link)).hostname == host:
                seen.append(path[:80])
        fp.paths = seen[:40]
    except niquests.RequestException as e:
        if not quiet:
            print(f"router probe failed: {_safe_error_message(e)}", file=sys.stderr)
    finally:
        if session is None:
            s.close()
    if upnp and fp.reachable:
        for key, value in ssdp_description(host).items():
            setattr(fp, key, value)
    fp.identify()
    return fp


# Australian NBN providers whose branded modems usually face the NBN.
ISP_BRANDS = (
    "Optus",
    "Telstra",
    "TPG",
    "iiNet",
    "Aussie Broadband",
    "Vodafone",
    "Dodo",
    "Belong",
    "Superloop",
    "Exetel",
    "Internode",
    "Tangerine",
    "Spintel",
    "Launtel",
    "Foxtel",
    "Southern Phone",
    "Kogan",
    "Leaptel",
)


def detect_isp_brand(fp: RouterFingerprint) -> str:
    text = " ".join(
        (
            fp.title,
            fp.server_header,
            fp.realm,
            fp.upnp_manufacturer,
            fp.upnp_model,
            fp.upnp_friendly,
            fp.login_page[:5000],
        )
    ).lower()
    for brand in ISP_BRANDS:
        if re.search(rf"\b{re.escape(brand.lower())}\b", text):
            return brand
    return ""


def parse_hops(output: str, target: str = "1.1.1.1") -> list[str]:
    """IPv4 hops in order from tracepath / traceroute / tracert output."""
    hops: list[str] = []
    for line in output.splitlines():
        m = re.match(r"\s*\d+\??:?\s+(?:(?:<?\d+\s*ms|\*)\s+)*(\d+\.\d+\.\d+\.\d+)", line)
        ip = m.group(1) if m else None
        if ip and ip != target and ip not in hops:
            hops.append(ip)
    return hops


def trace_hops(target: str = "1.1.1.1", max_hops: int = 5) -> list[str]:
    """Hops towards the internet using the OS tool (no root needed)."""
    if sys.platform == "win32":  # pragma: no cover
        cmd = ["tracert", "-d", "-h", str(max_hops), "-w", "800", target]
    elif sys.platform == "darwin":  # pragma: no cover
        cmd = ["traceroute", "-n", "-m", str(max_hops), "-w", "1", "-q", "1", target]
    else:
        cmd = ["tracepath", "-n", "-m", str(max_hops), target]
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=25, check=False, creationflags=flags
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return parse_hops(out, target)


def edge_router(hops: list[str]) -> str | None:
    """The last private hop before the first public one: the modem facing the NBN."""
    edge = None
    for ip in hops:
        if not _private(ip):
            break
        edge = ip
    return edge


def assign_roles(found: list[RouterFingerprint], edge: str | None) -> None:
    for fp in found:
        fp.isp_brand = detect_isp_brand(fp)
    for fp in found:
        if edge:
            fp.role = "nbn_modem" if fp.host == edge else "wifi"
        elif len(found) == 1 or fp.isp_brand:
            fp.role = "nbn_modem"  # no path info: an ISP-branded box faces the NBN
        else:
            fp.role = "wifi"


def find_routers() -> list[RouterFingerprint]:
    """All routers on the way to the internet, the NBN-facing modem first.

    Homes often chain a mesh Wi-Fi router (e.g. Nest Wifi) behind the ISP
    modem. The modem is found from the network path (the last private hop
    before the internet), falling back to ISP branding (Optus, Telstra, …).
    """
    from concurrent.futures import ThreadPoolExecutor

    gateway = default_gateway()
    hosts = list(dict.fromkeys([h for h in (gateway,) if h] + list(COMMON_GATEWAYS)))
    with ThreadPoolExecutor(max_workers=len(hosts) + 1) as pool:
        hops_future = pool.submit(trace_hops)
        probes = pool.map(lambda h: probe(h, upnp=False, timeout=2, quiet=True), hosts)
        found = [fp for fp in probes if fp.reachable]
        hops = hops_future.result()
    known = {fp.host for fp in found}
    for ip in hops:  # private hops may use addresses outside COMMON_GATEWAYS
        if _private(ip) and ip not in known:
            fp = probe(ip, upnp=False, timeout=2, quiet=True)
            if fp.reachable:
                found.append(fp)
    with ThreadPoolExecutor(max_workers=max(1, len(found))) as pool:
        upnps = list(pool.map(lambda f: ssdp_description(f.host), found))
    for fp, upnp in zip(found, upnps, strict=True):
        for key, value in upnp.items():
            setattr(fp, key, value)
        fp.identify()
    assign_roles(found, edge_router(hops))
    found.sort(
        key=lambda f: (f.role != "nbn_modem", not f.supported, not f.isp_brand, f.host != gateway)
    )
    return found


def find_router() -> RouterFingerprint:
    found = find_routers()
    return found[0] if found else RouterFingerprint(host="")


# --------------------------------------------------------------------------
# Login test
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class LoginResult:
    status: str  # ok | bad_password | unreachable | unsupported | error
    message: str
    live: RouterLive | None = None


def test_login(host: str, user: str, password: str, family: str | None) -> LoginResult:
    driver = driver_by_id(family)
    if driver is None:
        return LoginResult(
            "unsupported",
            "This modem isn't supported yet. Send a diagnostic capture and we'll add it.",
        )
    if not password:
        return LoginResult("bad_password", "Enter the modem's admin password.")
    try:
        reading = driver.read(host, user or driver.default_user, password)
    except LoginError:
        return LoginResult("bad_password", "The modem rejected the admin username or password.")
    except UnreachableError:
        return LoginResult("unreachable", "Could not reach the modem at that address.")
    except RouterError as e:
        return LoginResult("error", f"Logged in, but could not read the modem: {e}")
    if reading.live is None and not reading.events:
        return LoginResult("error", "Logged in, but the modem returned no status or log.")
    note = (
        " (experimental driver — please tell us if it looks wrong)" if driver.experimental else ""
    )
    return LoginResult(
        "ok", f"Connected. NBN and mobile-backup status can be read.{note}", reading.live
    )


def report_unsupported(
    base_url: str, payload: dict[str, Any], session: niquests.Session | None = None
) -> bool:
    s = session or niquests.Session()
    try:
        resp = s.post(f"{base_url.rstrip('/')}/api/router-issue", json=payload, timeout=15)
        resp.raise_for_status()
        return True
    except niquests.RequestException as e:
        print(f"router issue upload failed: {_safe_error_message(e)}", file=sys.stderr)
        return False
    finally:
        if session is None:
            s.close()
