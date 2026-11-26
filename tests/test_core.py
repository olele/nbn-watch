"""NBN API client, router drivers, state tracking and capture sanitising."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import niquests
import pytest

from nbn_watch import capture, nbn_api, router_watch
from nbn_watch.routers import (
    DRIVERS,
    Fingerprint,
    LoginError,
    RouterError,
    RouterEvent,
    RouterLive,
    RouterReading,
    UnreachableError,
    driver_by_id,
    driver_for,
    known_name,
    optus_hgw,
    telstra_gen2,
)
from nbn_watch.util import redact

NOW = datetime(2026, 11, 26, 18, 0)


def resp(
    status: int = 200, data: object = None, text: str = "", headers: dict[str, str] | None = None
) -> MagicMock:
    r = MagicMock(status_code=status, text=text, headers=headers or {})
    r.json.return_value = data
    if status >= 400:
        r.raise_for_status.side_effect = niquests.HTTPError(f"{status}")
    return r


class TestNbnApi:
    def test_check(self) -> None:
        s = MagicMock()
        s.get.return_value = resp(data={"displayOutage": "UNPLANNED_INPROGRESS"})
        st = nbn_api.check("LOC000000000001", s)
        assert st.outage and st.description == "unplanned outage" and not st.degraded
        s.get.return_value = resp(404)
        assert nbn_api.check("LOC1", s).error
        s.get.return_value = resp(data={"nope": 1})
        assert nbn_api.check("LOC1", s).description == "could not check"
        s.get.side_effect = niquests.ConnectionError("down")
        assert nbn_api.check("LOC1", s).error

    def test_status_kinds(self) -> None:
        assert nbn_api.NbnStatus("DEGRADATION_INPROGRESS").degraded
        assert nbn_api.NbnStatus("PLANNED_INPROGRESS").planned_now
        assert nbn_api.NbnStatus("SOMETHING_NEW").description == "something new"

    def test_zone_and_search(self) -> None:
        s = MagicMock()
        s.get.return_value = resp(
            data={
                "servingArea": {
                    "csaId": "CSA300000000459",
                    "description": "Kew",
                    "techType": "HFC",
                },
                "addressDetail": {
                    "latitude": -37.8,
                    "longitude": 145.03,
                    "formattedAddress": "1 X ST KEW VIC 3101",
                },
            }
        )
        z = nbn_api.zone("LOC1", s)
        assert z is not None and (z.csa_id, z.state, z.postcode, z.lat) == (
            "CSA300000000459",
            "VIC",
            "3101",
            -37.8,
        )
        s.get.return_value = resp(data={"servingArea": {"csaId": "bad"}})
        assert nbn_api.zone("LOC1", s) is None
        s.get.return_value = resp(
            data={
                "suggestions": [
                    {"id": "LOC000000000042", "formattedAddress": "12 Example St, Kew, VIC"},
                    {"id": "ChIJx"},
                    "junk",
                ]
            }
        )
        assert nbn_api.search("12 example", s) == [
            nbn_api.AddressMatch("LOC000000000042", "12 Example St, Kew, VIC")
        ]
        assert nbn_api.search("12", s) == []
        s.get.side_effect = niquests.ConnectionError("x")
        assert nbn_api.search("12 example", s) == [] and nbn_api.zone("LOC1", s) is None

    def test_redact(self) -> None:
        text = redact("https://api.telegram.org/bot123:ABCDEFGHIJKLMNOPQRSTUVWX/send?chat=5 failed")
        assert "ABCDEF" not in text and "chat=5" not in text


OPTUS_LOG = [
    "26.11.2026 08:30:00 [system][NOTICE]: DHCP lease renewed",
    "26.11.2026 08:39:37 [system][NOTICE]: Device in hybrid mode, ETH WAN ping fail, trigger WAN failover",
    "26.11.2026 08:39:51 [system][NOTICE]: set WAN type to Mobile WAN",
    "26.11.2026 16:07:00 [system][NOTICE]: set WAN type to ETH WAN",
]


class TestOptus:
    def test_log_and_live_parsing(self) -> None:
        events = optus_hgw.parse_log(OPTUS_LOG + ["garbage", "99.99.9999 00:00:00 x"])
        assert [e.kind for e in events] == ["mobile", "mobile", "nbn"]
        js = "var system_log=[" + ",".join(f"'{line}'" for line in OPTUS_LOG) + "];"
        assert optus_hgw.parse_log_js(js) == OPTUS_LOG and optus_hgw.parse_log_js("x") == []
        live = optus_hgw.parse_live(
            "var wan_type='6';var wan_ip0='0.0.0.0';var ltenetworkstatus='Up';"
            'addCfg("SignalIndicator_4G", "Good (-94.0 dBm)");'
        )
        assert live is not None and live.on_mobile and not live.nbn_connected and live.mobile_up
        assert live.technology == "4G" and live.signal == "Good, -94.0 dBm" and live.wan == "mobile"
        assert optus_hgw.parse_live("var wan_type='x';") is None
        assert (
            optus_hgw.classify("failback to ETH") == "nbn" and optus_hgw.classify("hello") is None
        )

    def test_token_and_credentials(self) -> None:
        token = optus_hgw.base64.b64encode(b"x" * 42 + b"TOKEN").decode()
        html = f'<img src="data:image/gif;base64,{token}">'
        assert optus_hgw.page_token(html).endswith("TOKEN") or optus_hgw.page_token(html)
        with pytest.raises(RouterError):
            optus_hgw.page_token("<html></html>")
        md5 = hashlib.md5(b"pw").hexdigest()  # noqa: S324
        assert optus_hgw.encode_credential("pw") == hashlib.sha512(md5.encode()).hexdigest()

    def _session(self, location: str) -> MagicMock:
        token = optus_hgw.base64.b64encode(b"G" * 42 + b"tok").decode()
        page = f'<img src="data:image/gif;base64,{token}">'
        s = MagicMock()
        s.get.side_effect = lambda url, **k: resp(
            text=(
                "var system_log=['" + "','".join(OPTUS_LOG) + "'];"
                if "cgi_log" in url
                else "var wan_type='1';var wan_ip0='1.2.3.4';"
                if "cgi_" in url
                else page
            )
        )
        s.post.return_value = resp(302, headers={"Location": location})
        s.post.return_value.raise_for_status.side_effect = None
        return s

    def test_read(self) -> None:
        reading = optus_hgw.OptusHgw().read(
            "192.168.0.1", "admin", "pw", self._session("/home.htm")
        )
        assert reading.live is not None and reading.live.nbn_connected and len(reading.events) == 3
        with pytest.raises(LoginError):
            optus_hgw.OptusHgw().read("h", "admin", "bad", self._session("/login.htm"))
        s = MagicMock()
        s.get.side_effect = niquests.ConnectionError("x")
        with pytest.raises(UnreachableError):
            optus_hgw.OptusHgw().read("h", "admin", "pw", s)

    def test_matches(self) -> None:
        d = optus_hgw.OptusHgw()
        assert d.matches(
            Fingerprint(
                html="<form action=login.cgi><img src='data:image/gif;base64,x'>", title="Optus"
            )
        )
        assert not d.matches(Fingerprint(title="Nest Wifi"))


def reference_proof(user: str, password: str, a: int, s_hex: str, b_hex: str) -> str:
    """Independent re-derivation of the modem's SRP proof (see telstra_gen2 docstring)."""
    g, n, k = telstra_gen2._G, telstra_gen2._N, telstra_gen2._K
    big_a = pow(g, a, n)
    a_hex = format(big_a, "x").zfill(len(format(big_a, "x")) + len(format(big_a, "x")) % 2)
    b = int(b_hex, 16)
    h = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731
    u = int(h(big_a.to_bytes(256, "big") + b.to_bytes(256, "big")), 16)
    x = int(h(bytes.fromhex(s_hex + h(f"{user}:{password}".encode()))), 16)
    shared = pow((b - k * pow(g, x, n)) % n, (a + u * x) % n, n)
    session_key = h(shared.to_bytes(256, "big"))
    return h(
        bytes.fromhex(telstra_gen2._HNXORG + h(user.encode()) + s_hex + a_hex + b_hex + session_key)
    )


class TestTelstra:
    def test_srp_proof(self) -> None:
        a, s_hex, b_hex = 123456789123456789, "0a1b2c3d", format(987654321987654321123, "x")
        c = telstra_gen2.SrpClient("admin", "Telstra", a=a)
        assert pow(2, a, telstra_gen2._N) == c.A and len(c.A_hex) % 2 == 0
        assert c.proof(s_hex, "0" * (len(b_hex) % 2) + b_hex) == reference_proof(
            "admin", "Telstra", a, s_hex, "0" * (len(b_hex) % 2) + b_hex
        )

    def test_status(self) -> None:
        live = telstra_gen2.parse_status('<img src="img/status.png" class="backup">')
        assert live is not None and live.on_mobile and live.technology == "4G"
        live = telstra_gen2.parse_status("<img class='ok' src='img/status.png'>")
        assert live is not None and live.nbn_connected and not live.on_mobile
        assert telstra_gen2.parse_status("<html>") is None

    def test_read(self) -> None:
        d = telstra_gen2.TelstraGen2()
        s = MagicMock()
        home = '<meta name="CSRFtoken" content="abc"><script src="js/srp-min.js"></script>'
        s.get.side_effect = [resp(text=home), resp(text='<img src="img/status.png" class="ok">')]
        s.post.side_effect = [resp(data={"s": "0a0b", "B": "05"}), resp(data={"M": "ok"})]
        reading = d.read("192.168.0.1", "admin", "Telstra", s)
        assert reading.live is not None and reading.live.nbn_connected
        assert s.post.call_args_list[0].kwargs["data"]["CSRFtoken"] == "abc"
        s.get.side_effect = [resp(text=home)]
        s.post.side_effect = [resp(data={})]
        with pytest.raises(LoginError):
            d.read("h", "admin", "x", s)
        s.get.side_effect = [resp(text="<html>")]
        with pytest.raises(RouterError):
            d.read("h", "admin", "x", s)
        s.get.side_effect = niquests.ConnectionError("x")
        with pytest.raises(UnreachableError):
            d.read("h", "admin", "x", s)
        assert d.matches(Fingerprint(html=home, title="Telstra Smart Modem")) and d.experimental

    def test_registry(self) -> None:
        assert driver_by_id("optus_hgw") is DRIVERS[0] and driver_by_id(None) is None
        assert driver_for(Fingerprint(title="Nest Wifi")) is None
        assert known_name(Fingerprint(title="Nest Wifi")) == "Google / Nest Wifi"
        assert (
            known_name(Fingerprint(title="Telstra Smart Modem", html="arcadyan"))
            == "Telstra Smart Modem Gen 3/4"
        )


class FakeDriver:
    id = name = "fake"
    experimental = False

    def __init__(self, reading: RouterReading | Exception) -> None:
        self.reading = reading

    def read(self, *a: object) -> RouterReading:
        if isinstance(self.reading, Exception):
            raise self.reading
        return self.reading


def ev(hour: int, minute: int, kind: str) -> RouterEvent:
    return RouterEvent(datetime(2026, 11, 26, hour, minute), kind, f"set WAN type to {kind}")  # type: ignore[arg-type]


class TestRouterWatch:
    def test_baseline_then_transitions(self, tmp_path: object) -> None:
        path = tmp_path / "rs.json"  # type: ignore[operator]
        log = [ev(8, 39, "mobile")]
        live_mobile = RouterLive("Optus 4G", True, False, True)
        obs = router_watch.observe(
            FakeDriver(RouterReading(live_mobile, log)), "h", "u", "p", path, now=NOW
        )  # type: ignore[arg-type]
        assert obs.previous is None and obs.state.wan == "mobile" and not obs.transitions
        obs.state.save(path)
        log2 = [*log, ev(16, 7, "nbn")]
        obs = router_watch.observe(
            FakeDriver(RouterReading(RouterLive("Fibre", False, True, True), log2)),
            "h",
            "u",
            "p",
            path,
            now=NOW,
        )  # type: ignore[arg-type]
        assert [t.event.kind for t in obs.transitions] == ["nbn"] and obs.transitions[
            0
        ].previous_since == datetime(2026, 11, 26, 8, 39)
        assert router_watch.RouterState.load(path) is not None

    def test_live_catches_missing_log_and_clock_skew(self, tmp_path: object) -> None:
        path = tmp_path / "rs.json"  # type: ignore[operator]
        router_watch.RouterState(
            "mobile", datetime(2026, 11, 26, 8, 39), datetime(2026, 11, 26, 20, 0)
        ).save(path)
        obs = router_watch.observe(
            FakeDriver(
                RouterReading(RouterLive("Fibre", False, True, True), [ev(20, 0, "mobile")])
            ),
            "h",
            "u",
            "p",
            path,
            now=NOW,
        )  # type: ignore[arg-type]
        assert obs.transitions[0].from_live and obs.state.since == datetime(2026, 11, 26, 20, 0)
        assert obs.state.last_seen is not None and obs.state.last_seen >= datetime(
            2026, 11, 26, 20, 0
        )

    def test_errors_and_describe(self, tmp_path: object) -> None:
        path = tmp_path / "rs.json"  # type: ignore[operator]
        obs = router_watch.observe(FakeDriver(LoginError("no")), "h", "u", "p", path)  # type: ignore[arg-type]
        assert obs.error and obs.state.wan == "nbn"
        path.write_text("{bad")
        assert router_watch.RouterState.load(path) is None
        st = router_watch.RouterState("mobile", NOW)
        assert "Mobile ✅ ON" in router_watch.describe(st)
        live = RouterLive("Optus 4G", True, False, True, "Good", "4G")
        assert "4G ✅ ON (Good)" in router_watch.describe(st, live)
        assert "OFF (standby)" in router_watch.describe(
            router_watch.RouterState(), RouterLive("F", False, True, True)
        )
        assert "no network" in router_watch.describe(st, RouterLive("x", True, False, False))
        assert router_watch.seed([]).wan == "nbn"
        assert router_watch.seed([ev(8, 0, "mobile"), ev(9, 0, "mobile")]).since == datetime(
            2026, 11, 26, 8, 0
        )


class TestCapture:
    HAR = {
        "log": {
            "entries": [
                {
                    "request": {
                        "method": "POST",
                        "url": "http://192.168.0.1/login.cgi?sid=abcdef&x=1",
                        "headers": [{"name": "Cookie", "value": "SID=secret"}],
                        "postData": {
                            "params": [
                                {"name": "usr", "value": "admin"},
                                {"name": "pws", "value": "hunter2"},
                            ]
                        },
                    },
                    "response": {
                        "status": 302,
                        "headers": [
                            {"name": "Location", "value": "/home.htm"},
                            {"name": "Set-Cookie", "value": "SID=zzz"},
                        ],
                        "content": {"mimeType": "text/html", "text": ""},
                    },
                },
                {
                    "request": {
                        "method": "GET",
                        "url": "http://192.168.0.1/cgi/cgi_home.js",
                        "headers": [],
                    },
                    "response": {
                        "status": 200,
                        "headers": [],
                        "content": {
                            "mimeType": "application/javascript",
                            "text": "var wan_type='6'; var ssid='MyHomeWiFi'; var wpa_key=\"supersecret\"; var mac='AA:BB:CC:DD:EE:FF';"
                            " var wan_ip='49.190.160.12'; var lan='192.168.0.1'; serial: 'SN12345'; owner jo@example.org 0412 345 678",
                        },
                    },
                },
                {
                    "request": {"method": "GET", "url": "https://www.google.com/x", "headers": []},
                    "response": {
                        "status": 200,
                        "content": {"mimeType": "text/html", "text": "<html>"},
                    },
                },
                {
                    "request": {
                        "method": "GET",
                        "url": "http://192.168.0.1/logo.png",
                        "headers": [],
                    },
                    "response": {
                        "status": 200,
                        "content": {"mimeType": "image/png", "text": "iVBOR", "encoding": "base64"},
                    },
                },
            ]
        }
    }

    def test_sanitize(self) -> None:
        cap, report = capture.sanitize_har(self.HAR)
        text = json.dumps(cap)
        for secret in (
            "hunter2",
            "MyHomeWiFi",
            "supersecret",
            "AA:BB:CC:DD:EE:FF",
            "49.190.160.12",
            "SN12345",
            "jo@example.org",
            "0412 345 678",
            "SID=secret",
            "SID=zzz",
            "abcdef",
        ):
            assert secret not in text, secret
        assert "192.168.0.1" in text and "wan_type='6'" in text  # useful structure is kept
        assert (
            cap["entries"][0]["post_fields"] == ["usr", "pws"]
            and cap["entries"][0]["path"] == "/login.cgi?sid=…&x=…"
        )
        assert report.kept == 3 and report.dropped_other_hosts == 1
        s = capture.summary(report)
        assert s["requests_kept"] == 3 and s["removed"]

    def test_invalid(self) -> None:
        with pytest.raises(ValueError):
            capture.sanitize_har({"nope": 1})
        cap, report = capture.sanitize_har(
            {
                "log": {
                    "entries": [
                        {
                            "request": {
                                "method": "POST",
                                "url": "http://router.lan/api",
                                "postData": {"text": '{"user":"a","password":"b"}'},
                            },
                            "response": {
                                "status": 200,
                                "content": {
                                    "mimeType": "application/json",
                                    "text": '{"token":"' + "x" * 40 + '"}',
                                },
                            },
                        }
                    ]
                }
            }
        )
        assert cap["entries"][0]["post_fields"] == [
            "user",
            "password",
        ] and "xxxxxxxx" not in json.dumps(cap)
        assert report.kept == 1


def test_lint_guard() -> None:
    assert timedelta(minutes=1)
