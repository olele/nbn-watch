"""Local web UI server for the desktop app, bound to 127.0.0.1.

Access needs a random per-launch token: the tray opens ``/?t=<token>``, which
sets a SameSite=Strict HttpOnly cookie. Every API call must also carry the
token in an ``X-NBN-Token`` header (CSRF guard), and the Host header must be
the loopback address (DNS-rebinding guard).
"""

from __future__ import annotations

import hmac
import json
import secrets
import sys
import threading
from dataclasses import asdict, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

import niquests

from .. import __version__ as VERSION  # noqa: N812
from .. import capture, nbn_api
from ..notify import Notifier
from ..routers import DRIVERS
from ..util import redact as _safe_error_message
from . import autostart, updater
from .theme import css_vars, load_theme
from .ui import render_page

if TYPE_CHECKING:
    from .monitor import Monitor

COOKIE = "nbn_desktop"
MAX_BODY = 16_384
MAX_CAPTURE_BODY = 40_000_000  # HAR files from the browser can be large


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _community(monitor: Monitor, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call the community server as this device."""
    payload = {"device": monitor.device_id, **(body or {})}
    url = f"{monitor.settings.community_url.rstrip('/')}{path}"
    try:
        resp = niquests.post(url, json=payload, timeout=15)
        data = resp.json() if resp.content else {}
    except (niquests.RequestException, ValueError) as e:
        raise ApiError(502, f"community server unreachable: {_safe_error_message(e)}") from e
    if resp.status_code is None or resp.status_code >= 400:
        raise ApiError(502, str(data.get("error") or f"community server error {resp.status_code}"))
    return data if isinstance(data, dict) else {}


class Api:
    """JSON endpoints used by the single-page UI."""

    def __init__(self, monitor: Monitor) -> None:
        self.monitor = monitor
        self._routers: list[Any] = []
        self.update: updater.Release | None = None
        self._capture: dict[str, Any] | None = None  # sanitised, awaiting the user's OK

    # -- read ---------------------------------------------------------------
    def state(self) -> dict[str, Any]:
        m = self.monitor
        s = asdict(m.settings)
        for secret in ("router_password", "telegram_bot_token"):
            s[f"{secret}_set"] = bool(s.pop(secret))
        s["autostart"] = autostart.is_enabled()
        st = m.status
        upd = None
        if self.update is not None:
            upd = {
                "version": self.update.version,
                "url": self.update.url,
                "can_install": updater.can_self_replace(),
            }
        return {
            "version": VERSION,
            "settings": s,
            "telegram_bot": "FaMuLei_bot",
            "drivers": [
                {"id": d.id, "name": d.name, "experimental": d.experimental} for d in DRIVERS
            ],
            "status": {
                "level": st.level,
                "headline": st.headline,
                "colour": st.colour,
                "rows": st.rows,
                "checked_at": f"{st.checked_at:%H:%M %a %d %b}" if st.checked_at else "",
            },
            "update": upd,
        }

    def search(self, q: str) -> dict[str, Any]:
        return {"results": [asdict(r) for r in nbn_api.search(q[:100])]}

    def routers(self) -> dict[str, Any]:
        from ..probe import default_gateway, find_routers

        self._routers = find_routers()
        gateway = default_gateway()
        out = []
        for fp in self._routers:
            parts = []
            if fp.role == "nbn_modem":
                parts.append("NBN modem · connects to the internet")
            elif fp.role == "wifi":
                parts.append("Wi-Fi router behind the modem")
            if fp.isp_brand:
                parts.append(f"{fp.isp_brand} device")
            if fp.host == gateway:
                parts.append("this computer's gateway")
            out.append(
                {
                    "host": fp.host,
                    "name": fp.describe(),
                    "supported": fp.supported,
                    "experimental": fp.experimental,
                    "known": fp.known,
                    "family": fp.family,
                    "nbn_modem": fp.role == "nbn_modem",
                    "role": " · ".join(parts),
                }
            )
        return {"routers": out}

    # -- write --------------------------------------------------------------
    def address(self, body: dict[str, Any]) -> dict[str, Any]:
        loc, address = str(body.get("loc_id", "")), str(body.get("address", ""))[:120]
        if not (loc.startswith("LOC") and loc[3:].isdigit() and len(loc) == 15):
            raise ApiError(400, "choose an address")
        label = (str(body.get("label") or "Home")).strip()[:30] or "Home"
        self.monitor.update_settings(
            replace(self.monitor.settings, loc_id=loc, address=address, label=label)
        )
        return {"ok": True}

    def router_test(self, body: dict[str, Any]) -> dict[str, Any]:
        from ..probe import test_login

        host = str(body.get("host", ""))
        known = {fp.host: fp for fp in self._routers}
        if host not in known and host != self.monitor.settings.router_ip:
            raise ApiError(400, "unknown router")
        password = str(body.get("password", "")) or self.monitor.settings.router_password
        family = known[host].family if host in known else self.monitor.settings.router_driver
        r = test_login(host, str(body.get("user") or "admin"), password, family)
        live = None
        if r.live is not None:
            live = {
                "wan": r.live.wan,
                "nbn_connected": r.live.nbn_connected,
                "mobile_up": r.live.mobile_up,
                "technology": r.live.technology,
                "signal": r.live.signal,
            }
        return {"status": r.status, "message": r.message, "live": live}

    def router_save(self, body: dict[str, Any]) -> dict[str, Any]:
        s = self.monitor.settings
        if body.get("clear"):
            new = replace(s, router_ip="", router_password="", router_name="", router_driver="")
        else:
            new = replace(
                s,
                router_ip=str(body.get("host", ""))[:64],
                router_user=str(body.get("user") or "admin")[:40],
                router_password=str(body.get("password", "")) or s.router_password,
                router_name=str(body.get("name", ""))[:80],
                router_driver=str(body.get("family") or s.router_driver)[:40],
            )
        self.monitor.update_settings(new)
        return {"ok": True}

    def router_report(self, body: dict[str, Any]) -> dict[str, Any]:
        from ..probe import probe, report_unsupported

        host = str(body.get("host", ""))
        if host not in {fp.host for fp in self._routers}:
            raise ApiError(400, "unknown router")
        fp = probe(host)
        payload = fp.issue_payload(device=self.monitor.device_id, app_version=VERSION)
        return {"ok": report_unsupported(self.monitor.settings.community_url, payload)}

    def telegram_code(self) -> dict[str, Any]:
        return _community(self.monitor, "/api/telegram/code")

    def telegram_status(self) -> dict[str, Any]:
        data = _community(self.monitor, "/api/telegram/status")
        linked = bool(data.get("linked"))
        if linked != self.monitor.settings.telegram_linked:
            self.monitor.update_settings(replace(self.monitor.settings, telegram_linked=linked))
        return {"linked": linked, "name": data.get("name", "")}

    def telegram_test(self) -> dict[str, Any]:
        n = Notifier(
            relay_url=self.monitor.settings.community_url, device_id=self.monitor.device_id
        )
        ok = n.send(
            "NBN Watch: Test",
            f"🏠 {self.monitor.settings.label}: Telegram alerts are working.",
            icons="test",
        )
        return {"ok": ok}

    def capture_preview(self, raw: bytes, host: str) -> dict[str, Any]:
        """Sanitise a HAR on this computer and show the user what would be sent."""
        if host not in {fp.host for fp in self._routers}:
            raise ApiError(400, "choose the modem first")
        try:
            har = json.loads(raw.decode("utf-8", "replace"))
            cap, report = capture.sanitize_har(har)
        except ValueError as e:
            raise ApiError(400, f"that file isn't a browser HAR recording ({e})") from e
        if report.kept == 0:
            raise ApiError(
                400,
                "the recording has no requests to your modem — record while using its admin page",
            )
        self._capture = {"host": host, "capture": cap}
        return {"summary": capture.summary(report), "bytes": len(json.dumps(cap))}

    def capture_send(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        from ..probe import probe, report_unsupported

        if self._capture is None:
            raise ApiError(400, "nothing to send")
        fp = probe(self._capture["host"])
        payload = fp.issue_payload(device=self.monitor.device_id, app_version=VERSION)
        payload["capture"] = self._capture["capture"]
        credit = str((body or {}).get("credit", "")).strip()[:40]
        if credit:
            payload["credit"] = credit  # opt-in name for the Hall of Fame
        ok = report_unsupported(self.monitor.settings.community_url, payload)
        if ok:
            self._capture = None
        return {"ok": ok}

    def community(self) -> dict[str, Any]:
        """Aggregate community numbers (no personal data) plus what this build supports."""
        from ..routers import DRIVERS

        data: dict[str, Any] = {}
        url = self.monitor.settings.community_url.rstrip("/")
        if url:
            try:
                resp = niquests.get(f"{url}/api/community", timeout=8)
                if resp.status_code == 200 and isinstance(resp.json(), dict):
                    data = {k: v for k, v in resp.json().items() if isinstance(v, int)}
            except (niquests.RequestException, ValueError):
                pass
        data["supported_models"] = [d.name for d in DRIVERS]
        return data

    def telegram_unlink(self) -> dict[str, Any]:
        _community(self.monitor, "/api/telegram/unlink")
        self.monitor.update_settings(replace(self.monitor.settings, telegram_linked=False))
        return {"ok": True}

    def prefs(self, body: dict[str, Any]) -> dict[str, Any]:
        s = self.monitor.settings

        def flag(name: str) -> bool:
            return bool(body.get(name, getattr(s, name)))

        new = replace(
            s,
            community=flag("community"),
            recovery_watch=flag("recovery_watch"),
            speedtest=flag("speedtest"),
            auto_update=flag("auto_update"),
        )
        want = bool(body.get("autostart", autostart.is_enabled()))
        try:
            if want != autostart.is_enabled():
                autostart.set_enabled(want)
        except OSError as e:
            print(f"autostart change failed: {e}", file=sys.stderr)
        self.monitor.update_settings(new)
        return {"ok": True}

    def finish(self) -> dict[str, Any]:
        if not self.monitor.settings.configured:
            raise ApiError(400, "choose an address first")
        self.monitor.update_settings(replace(self.monitor.settings, setup_done=True))
        return {"ok": True}

    def check(self) -> dict[str, Any]:
        self.monitor.wake()
        return {"ok": True}

    def update_install(self) -> dict[str, Any]:
        if self.update is None or not updater.can_self_replace():
            raise ApiError(400, "no installable update")
        threading.Thread(target=updater.install, args=(self.update,), daemon=True).start()
        return {"ok": True}


def make_handler(api: Api, token: str, port_ref: list[int]) -> type[BaseHTTPRequestHandler]:
    theme = css_vars(load_theme())

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

        def _host_ok(self) -> bool:
            host = self.headers.get("Host", "")
            return host in (f"127.0.0.1:{port_ref[0]}", f"localhost:{port_ref[0]}")

        def _authed(self) -> bool:
            for part in self.headers.get("Cookie", "").split(";"):
                name, _, value = part.strip().partition("=")
                if name == COOKIE and hmac.compare_digest(value, token):
                    return True
            return False

        def _api_ok(self) -> bool:
            # The secret token in a custom header is enough (browsers cannot send
            # it cross-site); the cookie is only how the page itself gets it.
            given = self.headers.get("X-NBN-Token", "")
            return bool(given) and hmac.compare_digest(given, token)

        def _send(
            self, status: int, body: bytes, ctype: str, extra: dict[str, str] | None = None
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
            )
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, data: object) -> None:
            self._send(status, json.dumps(data).encode(), "application/json")

        def _call(self, fn: Any) -> None:
            try:
                self._json(200, fn())
            except ApiError as e:
                self._json(e.status, {"error": str(e)})

        def do_GET(self) -> None:  # noqa: N802
            if not self._host_ok():
                return self._send(403, b"forbidden", "text/plain")
            url = urlparse(self.path)
            qs = {k: v[0] for k, v in parse_qs(url.query).items()}
            if url.path == "/health":
                return self._send(200, b"ok", "text/plain")
            if "t" in qs and hmac.compare_digest(qs["t"], token):
                cookie = f"{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/"
                return self._send(303, b"", "text/plain", {"Location": "/", "Set-Cookie": cookie})
            if url.path == "/":
                if not self._authed():
                    msg = b"<p>Open NBN Watch from its tray icon.</p>"
                    return self._send(403, msg, "text/html; charset=utf-8")
                return self._send(200, render_page(theme, token), "text/html; charset=utf-8")
            if not url.path.startswith("/api/"):
                return self._send(404, b"not found", "text/plain")
            if not self._api_ok():
                return self._json(403, {"error": "forbidden"})
            routes = {
                "/api/state": api.state,
                "/api/search": lambda: api.search(qs.get("q", "")),
                "/api/routers": api.routers,
                "/api/telegram/status": api.telegram_status,
                "/api/community": api.community,
            }
            fn = routes.get(url.path)
            if fn is None:
                return self._json(404, {"error": "not found"})
            return self._call(fn)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            limit = MAX_CAPTURE_BODY if path == "/api/capture/preview" else MAX_BODY
            declared = int(self.headers.get("Content-Length") or 0)
            if declared > limit:
                return self._json(413, {"error": "file too large"})
            raw = self.rfile.read(declared)
            if not self._host_ok() or not self._api_ok():
                return self._json(403, {"error": "forbidden"})
            if path == "/api/capture/preview":
                host = parse_qs(urlparse(self.path).query).get("host", [""])[0]
                return self._call(lambda: api.capture_preview(raw, host))
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                return self._json(400, {"error": "invalid json"})
            if not isinstance(body, dict):
                return self._json(400, {"error": "invalid json"})
            routes = {
                "/api/address": lambda: api.address(body),
                "/api/router/test": lambda: api.router_test(body),
                "/api/router/save": lambda: api.router_save(body),
                "/api/router/report": lambda: api.router_report(body),
                "/api/telegram/code": api.telegram_code,
                "/api/telegram/test": api.telegram_test,
                "/api/telegram/unlink": api.telegram_unlink,
                "/api/prefs": lambda: api.prefs(body),
                "/api/finish": api.finish,
                "/api/check": api.check,
                "/api/update/install": api.update_install,
                "/api/capture/send": lambda: api.capture_send(body),
            }
            fn = routes.get(path)
            if fn is None:
                return self._json(404, {"error": "not found"})
            return self._call(fn)

    return Handler


def start_server(monitor: Monitor, port: int = 0) -> tuple[ThreadingHTTPServer, str, str, Api]:
    """Start the UI on 127.0.0.1; returns (server, base_url, token, api)."""
    token = secrets.token_urlsafe(24)
    port_ref = [port]
    api = Api(monitor)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(api, token, port_ref))
    port_ref[0] = server.server_address[1]
    threading.Thread(target=server.serve_forever, name="nbn-ui", daemon=True).start()
    return server, f"http://127.0.0.1:{port_ref[0]}", token, api
