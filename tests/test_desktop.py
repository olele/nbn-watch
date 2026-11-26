"""Desktop app: settings, monitor loop, local web API, app entry, probe, updater, theme."""

from __future__ import annotations

import hashlib
import http.client
import json
import sys
from datetime import datetime
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock, patch

import niquests
import pytest

from nbn_watch import engine, nbn_api, router_watch, speedtest
from nbn_watch import probe as router_probe
from nbn_watch.desktop import app, autostart, monitor, settings, theme, updater, web
from nbn_watch.routers import LoginError, RouterError, RouterLive, RouterReading, UnreachableError

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


@pytest.fixture()
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("NBN_WATCH_HOME", str(tmp_path / "data"))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    monkeypatch.setattr(autostart.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setattr(autostart, "_platform", lambda: "linux")  # never touch the registry
    return settings.data_dir()


CONFIGURED = settings.Settings(loc_id="LOC000000000042", address="12 Example St, Kew, VIC")


def result(
    code: str = "NO_OUTAGE", wan: str | None = None, speed: bool = False
) -> engine.CycleResult:
    obs = None
    if wan:
        obs = router_watch.Observation(
            None, router_watch.RouterState(wan, datetime(2026, 11, 26, 8, 39)), [], []
        )  # type: ignore[arg-type]
    sp = (
        speedtest.SpeedState({"nbn": [83.9]}, datetime(2026, 11, 26, 17, 54), "", "nbn")
        if speed
        else speedtest.SpeedState()
    )
    return engine.CycleResult(nbn_api.NbnStatus(code), obs, sp)


class TestSettings:
    def test_round_trip_and_config(self, home: Path) -> None:
        path = home / "settings.json"
        s = settings.Settings(
            loc_id="LOC1",
            router_ip="192.168.0.1",
            router_password="pw",
            router_driver="optus_hgw",
            community=True,
            telegram_linked=True,
        )
        s.save(path)
        assert settings.Settings.load(path) == s
        if sys.platform != "win32":
            assert oct(path.stat().st_mode & 0o777) == "0o600"
        cfg = s.engine_config()
        assert cfg.router is not None and cfg.router.driver_id == "optus_hgw" and cfg.community
        n = s.notifier("d" * 32)
        assert n.relay_url == settings.DEFAULT_COMMUNITY_URL and n.device_id == "d" * 32
        assert settings.Settings(loc_id="LOC1").engine_config().router is None
        assert not settings.Settings().notifier("x").enabled

    def test_bad_files(self, home: Path) -> None:
        path = home / "settings.json"
        for text in ("{bad", "[1]", '{"loc_id": {"x": 1}}'):
            path.write_text(text)
            settings.Settings.load(path)
        path.write_text('{"loc_id": "LOC1", "extra": 1}')
        assert settings.Settings.load(path).loc_id == "LOC1"

    def test_platform_dirs(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.delenv("NBN_WATCH_HOME", raising=False)
        monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
        monkeypatch.setattr(settings.Path, "home", lambda: tmp_path)
        monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
        for platform, part in (("win32", "appdata"), ("darwin", "Library"), ("linux", ".config")):
            monkeypatch.setattr(settings.sys, "platform", platform)
            assert part in str(settings.data_dir())


class TestAutostart:
    @pytest.mark.parametrize("platform", ["linux", "darwin"])
    def test_toggle(self, home: Path, platform: str) -> None:
        assert not autostart.is_enabled(platform)
        autostart.set_enabled(True, platform)
        assert autostart.is_enabled(platform)
        target = autostart._mac_plist() if platform == "darwin" else autostart._linux_desktop()
        assert "nbn_watch.desktop" in target.read_text(encoding="utf-8")
        autostart.set_enabled(False, platform)
        assert not autostart.is_enabled(platform)

    def test_frozen(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(autostart.sys, "frozen", True, raising=False)
        assert autostart.launch_command() == [autostart.sys.executable]


class TestMonitor:
    def test_status_rows(self, home: Path) -> None:
        s = settings.Settings(
            loc_id="LOC1", address="12 Example St", router_name="Optus Smart Modem", community=True
        )
        st = monitor.status_from(
            result("UNPLANNED_INPROGRESS", "nbn", speed=True), s, datetime(2026, 11, 26)
        )
        assert st.level == "ok" and st.headline == "NBN working"
        rows = dict(st.rows)
        assert "their page lags" in rows["🏢 NBN Co"] and rows["🛜 Optus Smart Modem"].startswith(
            "🌐 on NBN"
        )
        assert (
            rows["🚀 Speed"].startswith("⬇️ 83.9")
            and rows["👥 Community map"] == "sharing your area"
        )
        assert (
            monitor.status_from(result("UNPLANNED_INPROGRESS"), s, datetime.now()).level == "down"
        )
        assert monitor.status_from(
            result("NO_OUTAGE", "mobile"), s, datetime.now()
        ).headline.endswith("4G backup")

    def test_check_change_and_status_file(self, home: Path) -> None:
        CONFIGURED.save(home / "settings.json")
        changes: list[tuple[str, str]] = []
        cycle = MagicMock(return_value=result("UNPLANNED_INPROGRESS"))
        m = monitor.Monitor(
            home, on_change=lambda o, n: changes.append((o.level, n.level)), cycle=cycle
        )
        assert m.check_now().level == "down" and changes == [("checking", "down")]
        data = json.loads((home / "status.json").read_text(encoding="utf-8"))
        assert data["level"] == "down" and data["rows"][0][0] == "🏠 Address"
        cfg, path, notifier = cycle.call_args.args
        assert cfg.loc_id == CONFIGURED.loc_id and path == home and not notifier.enabled

    def test_setup_errors_and_settings(self, home: Path) -> None:
        assert monitor.Monitor(home).check_now().level == "setup"
        CONFIGURED.save(home / "settings.json")
        m = monitor.Monitor(
            home,
            cycle=MagicMock(side_effect=RuntimeError("boom")),
            on_change=MagicMock(side_effect=ValueError),
        )
        assert m.check_now().level == "error"
        device = m.device_id
        (home / "engine_state.json").write_text("{}")
        (home / "router_state.json").write_text("{}")
        m.update_settings(
            settings.Settings(
                loc_id="LOC000000000009", router_ip="192.168.0.1", router_driver="optus_hgw"
            )
        )
        assert (
            not (home / "engine_state.json").exists() and not (home / "router_state.json").exists()
        )
        assert m.device_id == device  # kept: it is the relay secret
        m.start()
        m.stop()
        assert m._thread is not None
        m._thread.join(2)


class Client:
    def __init__(self, url: str, token: str) -> None:
        self.port = int(url.rsplit(":", 1)[1])
        self.token = token
        self.cookie = ""

    def raw(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        host: str | None = None,
        token: str | None = None,
        raw: bytes | None = None,
    ) -> tuple[int, Any]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Host": host or f"127.0.0.1:{self.port}"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if token is not None:
            headers["X-NBN-Token"] = token
        data: Any = raw
        if body is not None:
            data = json.dumps(body)
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=headers)
        resp = conn.getresponse()
        text = resp.read().decode()
        self.last = resp
        try:
            return resp.status, json.loads(text)
        except ValueError:
            return resp.status, text

    def get(self, path: str) -> tuple[int, Any]:
        return self.raw("GET", path, token=self.token)

    def post(self, path: str, body: Any = None) -> tuple[int, Any]:
        return self.raw("POST", path, body if body is not None else {}, token=self.token)

    def login(self) -> None:
        assert self.raw("GET", f"/?t={self.token}")[0] == 303
        self.cookie = self.last.getheader("Set-Cookie", "").split(";")[0]


@pytest.fixture()
def ui(home: Path) -> Iterator[tuple[monitor.Monitor, Client, web.Api]]:
    m = monitor.Monitor(home, cycle=MagicMock(return_value=result()))
    server, url, token, api = web.start_server(m)
    try:
        yield m, Client(url, token), api
    finally:
        server.shutdown()


def fp(
    host: str, family: str | None, title: str = "", role: str = ""
) -> router_probe.RouterFingerprint:
    return router_probe.RouterFingerprint(
        host=host, reachable=True, family=family, title=title, role=role
    )


class TestWeb:
    def test_auth_guards(self, ui: tuple[monitor.Monitor, Client, web.Api]) -> None:
        _, c, _ = ui
        assert c.raw("GET", "/")[0] == 403
        assert c.raw("GET", f"/?t={c.token}", host="evil.example:80")[0] == 403
        assert c.raw("GET", "/health")[0] == 200
        c.login()
        status, html = c.raw("GET", "/")
        assert status == 200 and "NBN Watch Settings" in html and "--accent" in html
        assert c.raw("GET", "/api/state")[0] == 403  # cookie alone is not enough
        assert c.get("/api/state")[0] == 200  # header token works (CLI, bar plugin)
        assert c.get("/api/nope")[0] == 404 and c.post("/api/nope")[0] == 404
        assert c.raw("POST", "/api/check", "x", token=c.token)[0] == 400
        assert c.raw("GET", "/x.js")[0] == 404

    def test_wizard_flow(
        self, ui: tuple[monitor.Monitor, Client, web.Api], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        m, c, _ = ui
        state = c.get("/api/state")[1]
        assert not state["settings"]["setup_done"] and "router_password" not in state["settings"]
        assert state["drivers"][0]["id"] == "optus_hgw"
        match = nbn_api.AddressMatch("LOC000000000042", "12 Example St, Kew, VIC")
        with patch.object(web.nbn_api, "search", return_value=[match]):
            assert c.get("/api/search?q=12+example")[1]["results"][0]["loc_id"] == match.loc_id
        assert c.post("/api/address", {"loc_id": "nope"})[0] == 400
        assert c.post("/api/finish")[0] == 400
        assert c.post("/api/address", {"loc_id": match.loc_id, "address": match.address})[0] == 200
        modem, mesh = (
            fp("192.168.0.1", "optus_hgw", role="nbn_modem"),
            fp("192.168.86.1", None, "Nest Wifi", "wifi"),
        )
        modem.isp_brand = "Optus"
        monkeypatch.setattr(router_probe, "find_routers", lambda: [modem, mesh])
        monkeypatch.setattr(router_probe, "default_gateway", lambda: "192.168.86.1")
        routers = c.get("/api/routers")[1]["routers"]
        assert (
            routers[0]["nbn_modem"]
            and routers[0]["supported"]
            and "Optus device" in routers[0]["role"]
        )
        assert routers[1]["role"].startswith("Wi-Fi router") and "gateway" in routers[1]["role"]
        ok = router_probe.LoginResult(
            "ok", "Connected.", RouterLive("Fibre/Cable", False, True, True, "Good", "4G")
        )
        with patch.object(router_probe, "test_login", return_value=ok) as tl:
            res = c.post(
                "/api/router/test", {"host": "192.168.0.1", "user": "admin", "password": "pw"}
            )[1]
        assert res["live"]["nbn_connected"] and tl.call_args.args == (
            "192.168.0.1",
            "admin",
            "pw",
            "optus_hgw",
        )
        assert c.post("/api/router/test", {"host": "10.9.9.9"})[0] == 400
        save = {
            "host": "192.168.0.1",
            "user": "admin",
            "password": "pw",
            "name": "Optus Smart Modem",
            "family": "optus_hgw",
        }
        assert c.post("/api/router/save", save)[0] == 200
        assert (m.settings.router_password, m.settings.router_driver) == ("pw", "optus_hgw")
        c.post("/api/router/save", {**save, "password": ""})
        assert m.settings.router_password == "pw"
        with (
            patch.object(router_probe, "probe", return_value=mesh),
            patch.object(router_probe, "report_unsupported", return_value=True) as rep,
        ):
            assert c.post("/api/router/report", {"host": "192.168.86.1"})[1]["ok"]
            assert c.post("/api/router/report", {"host": "1.2.3.4"})[0] == 400
        assert "password" not in json.dumps(rep.call_args.args[1]).lower()
        prefs = {
            "community": False,
            "recovery_watch": False,
            "speedtest": True,
            "auto_update": True,
            "autostart": True,
        }
        assert (
            c.post("/api/prefs", prefs)[0] == 200
            and autostart.is_enabled()
            and not m.settings.community
        )
        assert c.post("/api/finish")[0] == 200 and m.settings.setup_done
        assert c.post("/api/check")[0] == 200
        assert (
            c.post("/api/router/save", {"clear": True})[0] == 200 and m.settings.router_driver == ""
        )

    def test_capture(
        self, ui: tuple[monitor.Monitor, Client, web.Api], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _, c, api = ui
        mesh = fp("192.168.86.1", None, "Nest Wifi")
        monkeypatch.setattr(router_probe, "find_routers", lambda: [mesh])
        monkeypatch.setattr(router_probe, "default_gateway", lambda: None)
        c.get("/api/routers")
        har = {
            "log": {
                "entries": [
                    {
                        "request": {
                            "method": "GET",
                            "url": "http://192.168.86.1/api/v1/status",
                            "headers": [],
                        },
                        "response": {
                            "status": 200,
                            "content": {
                                "mimeType": "application/json",
                                "text": '{"wan":"up","ssid":"Home"}',
                            },
                        },
                    }
                ]
            }
        }
        assert c.post("/api/capture/send")[0] == 400  # nothing yet
        status, data = c.raw(
            "POST",
            "/api/capture/preview?host=10.0.0.9",
            token=c.token,
            raw=json.dumps(har).encode(),
        )
        assert status == 400
        status, data = c.raw(
            "POST", "/api/capture/preview?host=192.168.86.1", token=c.token, raw=b"not json"
        )
        assert status == 400
        empty = {"log": {"entries": []}}
        assert (
            c.raw(
                "POST",
                "/api/capture/preview?host=192.168.86.1",
                token=c.token,
                raw=json.dumps(empty).encode(),
            )[0]
            == 400
        )
        status, data = c.raw(
            "POST",
            "/api/capture/preview?host=192.168.86.1",
            token=c.token,
            raw=json.dumps(har).encode(),
        )
        assert status == 200 and data["summary"]["requests_kept"] == 1
        with (
            patch.object(router_probe, "probe", return_value=mesh),
            patch.object(router_probe, "report_unsupported", return_value=True) as rep,
        ):
            assert c.post("/api/capture/send", {"credit": "  Kai from Geelong  "})[1]["ok"]
        sent = rep.call_args.args[1]
        assert sent["credit"] == "Kai from Geelong"
        assert sent["capture"]["entries"][0][
            "path"
        ] == "/api/v1/status" and "Home" not in json.dumps(sent)

    def test_telegram(
        self, ui: tuple[monitor.Monitor, Client, web.Api], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        m, c, _ = ui
        replies = {
            "/api/telegram/code": {
                "code": "NBNABCDEF",
                "bot": "FaMuLei_bot",
                "link": "https://t.me/x",
            },
            "/api/telegram/status": {"linked": True, "name": "Jo"},
            "/api/telegram/unlink": {"ok": True},
        }
        sent: list[dict[str, Any]] = []

        def fake_post(url: str, json: dict[str, Any], timeout: int) -> MagicMock:  # noqa: A002
            sent.append(json)
            path = "/" + url.split("/", 3)[3]
            return MagicMock(status_code=200, content=b"x", json=lambda: replies[path])

        monkeypatch.setattr(web.niquests, "post", fake_post)
        assert (
            c.post("/api/telegram/code")[1]["code"] == "NBNABCDEF"
            and sent[0]["device"] == m.device_id
        )
        assert (
            c.get("/api/telegram/status")[1] == {"linked": True, "name": "Jo"}
            and m.settings.telegram_linked
        )
        with patch("nbn_watch.notify.Notifier.send", return_value=True) as send:
            assert c.post("/api/telegram/test")[1]["ok"]
        assert send.call_args.args[0] == "NBN Watch: Test"
        assert c.post("/api/telegram/unlink")[0] == 200 and not m.settings.telegram_linked
        monkeypatch.setattr(
            web.niquests, "post", MagicMock(side_effect=niquests.ConnectionError("x"))
        )
        assert c.post("/api/telegram/code")[0] == 502
        monkeypatch.setattr(
            web.niquests,
            "post",
            lambda *a, **k: MagicMock(status_code=404, content=b"x", json=lambda: {"error": "no"}),
        )
        assert c.post("/api/telegram/code") == (502, {"error": "no"})

    def test_community(
        self, ui: tuple[monitor.Monitor, Client, web.Api], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _, c, _ = ui

        class Resp:
            status_code = 200

            def json(self) -> dict[str, object]:
                return {"active_users": 12, "recordings": 3, "note": "<b>"}

        monkeypatch.setattr(web.niquests, "get", lambda *a, **k: Resp())
        data = c.get("/api/community")[1]
        assert data["active_users"] == 12 and data["recordings"] == 3 and "note" not in data
        assert "Optus" in " ".join(data["supported_models"])

        def down(*a: object, **k: object) -> None:
            raise web.niquests.ConnectionError("offline")

        monkeypatch.setattr(web.niquests, "get", down)
        data = c.get("/api/community")[1]
        assert "active_users" not in data and data["supported_models"]

    def test_update(self, ui: tuple[monitor.Monitor, Client, web.Api]) -> None:
        _, c, api = ui
        assert c.get("/api/state")[1]["update"] is None
        api.update = updater.Release("9.9.9", "https://x/y", "a" * 64)
        assert c.get("/api/state")[1]["update"]["version"] == "9.9.9"
        assert c.post("/api/update/install")[0] == 400  # not a frozen build


class TestApp:
    def test_basics(self, home: Path, tmp_path: Path) -> None:
        assert app.tray_image("#f7768e").size == (64, 64)
        assert app.main(["--write-icon", str(tmp_path / "i.png")]) == 0
        assert app.existing_instance(home) is None
        (home / "ui.json").write_text(json.dumps({"url": "http://127.0.0.1:9", "token": "t"}))
        with patch.object(app.niquests, "get", return_value=MagicMock(status_code=200)):
            assert app.existing_instance(home) == "http://127.0.0.1:9/?t=t"
        with (
            patch.object(app, "existing_instance", return_value="http://x/?t=1"),
            patch.object(app.webbrowser, "open") as op,
        ):
            assert app.main([]) == 0
        op.assert_called_once_with("http://x/?t=1")

    def test_browser_only_and_check(self, home: Path) -> None:
        with (
            patch.object(app.webbrowser, "open") as opened,
            patch.object(app, "_wait_forever", side_effect=KeyboardInterrupt),
            patch.object(monitor.Monitor, "start"),
        ):
            assert app.main(["--no-tray"]) == 0
        assert "/?t=" in opened.call_args.args[0] and not (home / "ui.json").exists()
        m = monitor.Monitor(home)
        server, url, token, _ = web.start_server(m)
        try:
            (home / "ui.json").write_text(json.dumps({"url": url, "token": token}))
            with patch.object(m, "wake") as wake:
                assert app.main(["--check"]) == 0
            wake.assert_called_once()
            (home / "ui.json").write_text(json.dumps({"url": url, "token": "bad"}))
            assert app.main(["--check"]) == 1
        finally:
            server.shutdown()

    def test_update_loop(self, home: Path) -> None:
        m = monitor.Monitor(home)
        api = web.Api(m)
        stop = MagicMock()
        stop.wait.side_effect = [False, True]
        rel = updater.Release("9.9.9", "https://x/y", "a" * 64)
        with (
            patch.object(updater, "check", return_value=rel),
            patch.object(updater, "can_self_replace", return_value=True),
            patch.object(updater, "install") as install,
        ):
            app.update_loop(m, api, stop)
        assert api.update == rel
        install.assert_called_once_with(rel)


class TestProbe:
    LOGIN = (
        "<html><head><title>Optus</title></head><body><img src='data:image/gif;base64,"
        + "A" * 80
        + "'>"
        "<form action='login.cgi'><input name='usr' value='admin'><input type=password></form>"
        "<a href='/help.htm'>help</a><script src='/js/app.js'></script></body></html>"
    )

    def test_probe_identifies_from_raw_page(self) -> None:
        s = MagicMock()
        s.get.return_value = MagicMock(
            text=self.LOGIN,
            headers={"Server": "mini_httpd", "WWW-Authenticate": 'Basic realm="HGW"'},
            url="http://192.168.0.1/login.htm",
        )
        f = router_probe.probe("192.168.0.1", s, upnp=False)
        assert f.supported and f.family == "optus_hgw" and f.describe() == "Optus Smart Modem"
        assert "base64" not in f.login_page and "/help.htm" in f.paths
        payload = f.issue_payload(device="d" * 32, app_version="0.3.0")
        assert "raw_html" not in payload and "host" not in payload
        s.get.side_effect = niquests.ConnectionError("x")
        assert not router_probe.probe("10.0.0.1", s, upnp=False, quiet=True).reachable

    def test_describe_and_known(self) -> None:
        f = router_probe.RouterFingerprint(host="h", reachable=True, title="Nest Wifi")
        f.identify()
        assert f.known == "Google / Nest Wifi" and f.describe() == "Google / Nest Wifi"
        g = router_probe.RouterFingerprint(host="h", reachable=True, server_header="lighttpd")
        assert (
            "lighttpd" in g.describe()
            and router_probe.RouterFingerprint(host="h").describe() == "No router found"
        )

    def test_hops_and_roles(self, tmp_path: Path) -> None:
        out = " 1:  192.168.86.1   3.8ms\n 2:  192.168.0.1   2.6ms\n 3:  49.190.160.1  20ms\n 4:  no reply\n"
        hops = router_probe.parse_hops(out)
        assert (
            hops == ["192.168.86.1", "192.168.0.1", "49.190.160.1"]
            and router_probe.edge_router(hops) == "192.168.0.1"
        )
        assert router_probe.parse_hops("  1    <1 ms    <1 ms    <1 ms  192.168.1.1\n") == [
            "192.168.1.1"
        ]
        modem, mesh = (
            fp("192.168.0.1", None, "Telstra Smart Modem"),
            fp("192.168.86.1", None, "Nest Wifi"),
        )
        router_probe.assign_roles([modem, mesh], None)
        assert (modem.role, mesh.role, modem.isp_brand) == ("nbn_modem", "wifi", "Telstra")
        route = tmp_path / "route"
        route.write_text("Iface\tDestination\tGateway\nwlan0\t00000000\t0156A8C0\n")
        assert router_probe._linux_gateway(route) == "192.168.86.1"

    def test_find_routers(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(router_probe, "default_gateway", lambda: "192.168.86.1")
        monkeypatch.setattr(router_probe, "ssdp_description", lambda h: {})
        monkeypatch.setattr(
            router_probe, "trace_hops", lambda: ["192.168.86.1", "10.1.1.1", "1.2.3.4"]
        )
        login = TestProbe.LOGIN

        def fake_probe(h: str, **k: Any) -> router_probe.RouterFingerprint:
            if h == "192.168.86.1":
                return fp(h, None, "Nest Wifi")
            if h == "10.1.1.1":
                f = router_probe.RouterFingerprint(host=h, reachable=True, raw_html=login)
                return f
            return router_probe.RouterFingerprint(host=h)

        monkeypatch.setattr(router_probe, "probe", fake_probe)
        found = router_probe.find_routers()
        assert (
            found[0].host == "10.1.1.1"
            and found[0].role == "nbn_modem"
            and found[0].family == "optus_hgw"
        )
        assert router_probe.find_router().host == "10.1.1.1"

    def test_login_results(self) -> None:
        assert router_probe.test_login("h", "admin", "pw", None).status == "unsupported"
        assert router_probe.test_login("h", "admin", "", "optus_hgw").status == "bad_password"
        for err, expected in (
            (LoginError("x"), "bad_password"),
            (UnreachableError("x"), "unreachable"),
            (RouterError("x"), "error"),
        ):
            with patch("nbn_watch.routers.optus_hgw.OptusHgw.read", side_effect=err):
                assert router_probe.test_login("h", "admin", "pw", "optus_hgw").status == expected
        with patch(
            "nbn_watch.routers.optus_hgw.OptusHgw.read", return_value=RouterReading(None, [])
        ):
            assert router_probe.test_login("h", "admin", "pw", "optus_hgw").status == "error"
        live = RouterLive("Fibre", False, True, True)
        with patch(
            "nbn_watch.routers.telstra_gen2.TelstraGen2.read", return_value=RouterReading(live, [])
        ):
            r = router_probe.test_login("h", "", "pw", "telstra_gen2")
        assert r.status == "ok" and "experimental" in r.message

    def test_report(self) -> None:
        s = MagicMock()
        assert router_probe.report_unsupported("https://srv/", {"a": 1}, s)
        assert s.post.call_args.args[0] == "https://srv/api/router-issue"
        s.post.side_effect = niquests.ConnectionError("x")
        assert not router_probe.report_unsupported("https://srv", {}, s)


class TestUpdaterTheme:
    def test_check_and_download(self, tmp_path: Path) -> None:
        assert updater.newer("0.10.0", "0.9.9") and updater.parse_version("x") == (0,)
        s = MagicMock()
        s.get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"version": "9.0.0", "url": "https://x/a", "sha256": "b" * 64},
        )
        assert updater.check("https://srv", s) is not None
        s.get.return_value = MagicMock(status_code=404)
        assert updater.check("https://srv", s) is None
        s.get.side_effect = niquests.ConnectionError("x")
        assert updater.check("https://srv", s) is None
        data = b"build"
        s2 = MagicMock()
        s2.get.return_value = MagicMock(iter_content=lambda n: [data, b""])
        path = updater.download(
            updater.Release("9.0.0", "https://x", hashlib.sha256(data).hexdigest()), tmp_path, s2
        )
        assert path.read_bytes() == data
        with pytest.raises(ValueError):
            updater.download(updater.Release("9.0.0", "https://x", "0" * 64), tmp_path, s2)

    def test_theme(self, tmp_path: Path) -> None:
        f = tmp_path / "colors.toml"
        f.write_text('accent = "#ff0000"\nbackground = "nope"\n')
        assert (
            theme.load_theme(f)["accent"] == "#ff0000"
            and theme.load_theme(tmp_path / "x") == theme.DEFAULT
        )
        assert "--dark-background:" in theme.css_vars(theme.DEFAULT)
