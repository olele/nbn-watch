"""Engine cycles, alerts, notifications, community reports and speed tests."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import niquests
import pytest

from nbn_watch import community, engine, nbn_api, router_watch, speedtest
from nbn_watch.notify import Notifier
from nbn_watch.routers import RouterEvent, RouterLive, RouterReading

if TYPE_CHECKING:
    from pathlib import Path

NOW = datetime(2026, 11, 26, 18, 0)


class Recorder(Notifier):
    def __init__(self, ok: bool = True) -> None:
        super().__init__(relay_url="https://srv", device_id="d" * 32)
        object.__setattr__(self, "sent", [])
        object.__setattr__(self, "ok", ok)

    def send(self, title: str, message: str, *, icons: str = "", silent: bool = False) -> bool:
        self.sent.append((title, message, icons, silent))  # type: ignore[attr-defined]
        return self.ok  # type: ignore[attr-defined,no-any-return]


def status(code: str) -> nbn_api.NbnStatus:
    return nbn_api.NbnStatus(code)


CFG = engine.Config(
    loc_id="LOC000000000042", label="Home", address="12 Example St", speedtest=False
)


def run(
    cfg: engine.Config, home: Path, n: Notifier, code: str, now: datetime = NOW, **kw: object
) -> engine.CycleResult:
    return engine.run_cycle(cfg, home, n, now=now, check=lambda loc: status(code), **kw)  # type: ignore[arg-type]


class TestNbnCoAlerts:
    def test_baseline_then_outage_then_resolved(self, tmp_path: Path) -> None:
        n = Recorder()
        assert run(CFG, tmp_path, n, "NO_OUTAGE").level == "ok" and n.sent == []  # type: ignore[attr-defined]
        r = run(CFG, tmp_path, n, "UNPLANNED_INPROGRESS", NOW + timedelta(minutes=5))
        assert r.level == "down" and n.sent[-1][0] == "NBN Co: Outage Detected"  # type: ignore[attr-defined]
        assert "12 Example St" in n.sent[-1][1] and n.sent[-1][2] == "down,nbnco"  # type: ignore[attr-defined]
        run(CFG, tmp_path, n, "UNPLANNED_INPROGRESS", NOW + timedelta(minutes=10))
        assert len(n.sent) == 1  # type: ignore[attr-defined]  # no repeat
        run(CFG, tmp_path, n, "NO_OUTAGE", NOW + timedelta(hours=2))
        assert n.sent[-1][0] == "NBN Co: Outage Resolved" and "1h 55m" in n.sent[-1][1]  # type: ignore[attr-defined]

    def test_degraded_planned_and_errors(self, tmp_path: Path) -> None:
        n = Recorder()
        run(CFG, tmp_path, n, "NO_OUTAGE")
        assert run(CFG, tmp_path, n, "PLANNED_INPROGRESS").level == "planned"
        assert n.sent[-1][0] == "NBN Co: Planned Work Started" and n.sent[-1][3]  # type: ignore[attr-defined]  # silent
        run(CFG, tmp_path, n, "DEGRADATION_INPROGRESS")
        assert n.sent[-1][0] == "NBN Co: Degraded Service"  # type: ignore[attr-defined]
        r = engine.run_cycle(
            CFG, tmp_path, n, now=NOW, check=lambda loc: nbn_api.NbnStatus("", error="x")
        )
        assert r.level == "error" and len(n.sent) == 2  # type: ignore[attr-defined]  # errors never alert

    def test_failed_send_is_retried(self, tmp_path: Path) -> None:
        run(CFG, tmp_path, Recorder(), "NO_OUTAGE")
        bad = Recorder(ok=False)
        r = run(CFG, tmp_path, bad, "UNPLANNED_INPROGRESS")
        assert r.alerts_failed == 1
        good = Recorder()
        run(CFG, tmp_path, good, "UNPLANNED_INPROGRESS")
        assert good.sent[0][0] == "NBN Co: Outage Detected"  # type: ignore[attr-defined]

    def test_corrupt_state(self, tmp_path: Path) -> None:
        (tmp_path / "engine_state.json").write_text("{bad")
        assert engine.EngineState.load(tmp_path / "engine_state.json").announced == ""


class TestRouterAlerts:
    def reading(self, mobile: bool, events: list[RouterEvent]) -> RouterReading:
        live = RouterLive(
            "Optus 4G" if mobile else "Fibre/Cable",
            mobile,
            not mobile,
            True,
            "Good",
            "4G" if mobile else "",
        )
        return RouterReading(live, events)

    def test_failover_and_failback(self, tmp_path: Path) -> None:
        cfg = engine.Config(
            loc_id="LOC1",
            label="Home",
            router=engine.RouterSettings("optus_hgw", "h", "admin", "pw"),
            speedtest=True,
        )
        n = Recorder()
        failover = RouterEvent(
            datetime(2026, 11, 26, 8, 39), "mobile", "set WAN type to Mobile WAN"
        )
        back = RouterEvent(datetime(2026, 11, 26, 16, 7), "nbn", "set WAN type to ETH WAN")
        speed = lambda mobile: speedtest.SpeedResult(80.0, 20.0, 9.0, 30_000_000)  # noqa: E731
        with patch(
            "nbn_watch.routers.optus_hgw.OptusHgw.read", return_value=self.reading(False, [])
        ):
            r = run(cfg, tmp_path, n, "NO_OUTAGE", speedtest=speed)
        assert r.router is not None and r.router.previous is None and n.sent == []  # type: ignore[attr-defined]
        with patch(
            "nbn_watch.routers.optus_hgw.OptusHgw.read", return_value=self.reading(True, [failover])
        ):
            r = run(cfg, tmp_path, n, "UNPLANNED_INPROGRESS", speedtest=speed)
        assert r.level == "mobile"
        titles = [s[0] for s in n.sent]  # type: ignore[attr-defined]
        assert "Router: NBN Lost → 4G Backup ON" in titles and "NBN Co: Outage Detected" in titles
        with patch(
            "nbn_watch.routers.optus_hgw.OptusHgw.read",
            return_value=self.reading(False, [failover, back]),
        ):
            r = run(cfg, tmp_path, n, "UNPLANNED_INPROGRESS", speedtest=speed)
        title, message, icons, _ = n.sent[-1]  # type: ignore[attr-defined]
        assert title == "Router: NBN Back → Mobile OFF" and icons == "up,router"
        assert "Time on mobile backup: 7h 28m" in message and "Speed test now" in message
        assert r.level == "ok"  # modem beats NBN Co's lagging outage

    def test_router_failure_and_failed_alert(self, tmp_path: Path) -> None:
        from nbn_watch.routers import LoginError

        cfg = engine.Config(
            loc_id="LOC1",
            router=engine.RouterSettings("optus_hgw", "h", "admin", "pw"),
            speedtest=False,
        )
        with patch("nbn_watch.routers.optus_hgw.OptusHgw.read", side_effect=LoginError("no")):
            r = run(cfg, tmp_path, Recorder(), "UNPLANNED_INPROGRESS")
        assert r.router is not None and r.router.error and r.level == "down"
        assert "could not read" in engine.router_line(r.router)
        router_watch.RouterState("nbn", NOW, NOW - timedelta(hours=1)).save(
            tmp_path / "router_state.json"
        )
        ev = RouterEvent(NOW - timedelta(minutes=5), "mobile", "set WAN type to Mobile WAN")
        with patch(
            "nbn_watch.routers.optus_hgw.OptusHgw.read", return_value=self.reading(True, [ev])
        ):
            run(cfg, tmp_path, Recorder(ok=False), "NO_OUTAGE")
        assert router_watch.RouterState.load(tmp_path / "router_state.json").wan == "nbn"  # type: ignore[union-attr]

    def test_lines(self) -> None:
        assert engine.router_line(None) == "🛜 Router: not connected"
        assert engine.nbn_co_line(nbn_api.NbnStatus("", error="x")).startswith("⚪")
        assert engine.nbn_co_line(status("PLANNED_INPROGRESS")).startswith("🚧")
        assert engine._duration(90061) == "1d 1h"


class TestSpeedLane:
    def test_scheduled_test_and_jump(self, tmp_path: Path) -> None:
        cfg = engine.Config(loc_id="LOC1", speedtest=True)
        speedtest.SpeedState({"nbn": [100.0, 100.0]}, None, "", "nbn").save(
            tmp_path / "speed_state.json"
        )
        n = Recorder()
        run(
            cfg,
            tmp_path,
            n,
            "NO_OUTAGE",
            speedtest=lambda m: speedtest.SpeedResult(20.0, 5.0, 9.0, 1),
        )
        assert n.sent[-1][0].startswith("Speed Drop") and n.sent[-1][2] == "down,speed"  # type: ignore[attr-defined]


class TestCommunity:
    def test_report_cycle(self, tmp_path: Path) -> None:
        zone = nbn_api.Zone("CSA300000000459", "Kew", "HFC", "VIC", "3101", -37.80123, 145.03789)
        cfg = engine.Config(loc_id="LOC000000000042", community=True, community_url="https://srv")
        with (
            patch.object(nbn_api, "zone", return_value=zone),
            patch.object(community.niquests, "post", return_value=MagicMock()) as post,
        ):
            run(cfg, tmp_path, Recorder(), "UNPLANNED_INPROGRESS")
        body = post.call_args.kwargs["json"]
        assert (body["lat"], body["lng"], body["nbn"], body["connection"]) == (
            -37.805,
            145.035,
            "unplanned",
            "unknown",
        )
        assert body["loc_id"] == "LOC000000000042"  # outage + no modem -> recovery watch
        assert "12 Example" not in str(body) and len(body["device"]) == 32
        state = community.CommunityState.load(tmp_path / "community_state.json")
        assert state.zone == zone and state.last_sent == NOW

    def test_router_is_authoritative_and_errors(self, tmp_path: Path) -> None:
        st = community.CommunityState("d" * 32, nbn_api.Zone("CSA300000000459"))
        obs = router_watch.Observation(
            None, router_watch.RouterState("nbn", NOW), [], [], RouterLive("F", False, True, True)
        )
        rep = community.build_report(
            st, status("UNPLANNED_INPROGRESS"), obs, None, NOW, watch_loc_id="LOC1"
        )
        assert rep is not None and "loc_id" not in rep and rep["nbn_since"]
        assert (
            community.build_report(community.CommunityState(), status("NO_OUTAGE"), None, None, NOW)
            is None
        )
        with patch.object(community.niquests, "post", side_effect=niquests.ConnectionError("x")):
            assert not community.send_report("https://srv", {"v": 1})
        with patch.object(community, "ensure_device_id", side_effect=RuntimeError("boom")):
            assert not community.report_cycle(
                "https://srv",
                tmp_path / "c.json",
                "LOC1",
                status("NO_OUTAGE"),
                None,
                None,
                recovery_watch=True,
                now=NOW,
            )
        (tmp_path / "c.json").write_text("{bad")
        assert community.CommunityState.load(tmp_path / "c.json").device_id == ""
        assert community.grid_centre(-37.80999) == -37.805
        assert community.nbn_state(nbn_api.NbnStatus("", error="x")) == "error"
        assert community.nbn_state(status("DEGRADATION_INPROGRESS")) == "degraded"
        assert community.nbn_state(status("PLANNED_UPCOMING")) == "planned"


class TestNotifier:
    def test_channels(self) -> None:
        n = Notifier(
            relay_url="https://srv/", device_id="d" * 32, bot_token="123:abc", chat_id="42"
        )
        with patch("nbn_watch.notify.niquests.post", return_value=MagicMock()) as post:
            assert n.send("T", "M", icons="down,router", silent=True)
        relay, tg = post.call_args_list
        assert relay.args[0] == "https://srv/api/notify" and relay.kwargs["json"]["emoji"] == "🔴🛜"
        assert (
            "api.telegram.org/bot123:abc" in tg.args[0]
            and tg.kwargs["json"]["disable_notification"]
        )
        with patch("nbn_watch.notify.niquests.post", side_effect=niquests.ConnectionError("x")):
            assert not n.send("T", "M")
        assert not Notifier().enabled


class TestSpeedtest:
    def test_run(self) -> None:
        s = MagicMock()
        s.get.return_value = MagicMock(content=b"x" * 1000)
        r = speedtest.run_speedtest(1000, 500, session=s)
        assert r.error is None and r.bytes_used == 1500 and "Mbps" in r.describe()
        s.get.side_effect = niquests.ConnectionError("x")
        assert "failed" in speedtest.run_speedtest(1, 1, session=s).describe()

    @pytest.mark.parametrize("mobile", [True, False])
    def test_sizes(self, mobile: bool) -> None:
        with patch.object(speedtest, "run_speedtest") as run_:
            speedtest.run_for_connection(mobile)
        assert run_.call_args.args == (speedtest.SIZE_MOBILE if mobile else speedtest.SIZE_NBN)
