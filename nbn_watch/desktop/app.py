"""Desktop entry point: tray icon + local UI + background polling + auto-update."""

from __future__ import annotations

import json
import os
import sys
import threading
import webbrowser
from typing import TYPE_CHECKING, Any

import niquests

from . import autostart, updater
from .monitor import AppStatus, Monitor
from .settings import APP_NAME, data_dir
from .web import Api, start_server

if TYPE_CHECKING:
    from pathlib import Path

UPDATE_CHECK_SEC = 6 * 3600


def existing_instance(home: Path) -> str | None:
    """URL of an already-running instance's UI, if one answers."""
    try:
        info = json.loads((home / "ui.json").read_text(encoding="utf-8"))
        url, token = str(info["url"]), str(info["token"])
        if niquests.get(f"{url}/health", timeout=2).status_code == 200:
            return f"{url}/?t={token}"
    except (OSError, ValueError, KeyError, niquests.RequestException):
        pass
    return None


def request_check(home: Path) -> bool:
    """Ask the running instance to check now."""
    try:
        info = json.loads((home / "ui.json").read_text(encoding="utf-8"))
        resp = niquests.post(
            f"{info['url']}/api/check",
            json={},
            headers={"X-NBN-Token": str(info["token"]), "Host": info["url"].split("//", 1)[1]},
            timeout=5,
        )
        return resp.status_code == 200
    except (OSError, ValueError, KeyError, niquests.RequestException):
        return False


def tray_image(colour: str) -> Any:
    """Status dot in the Omarchy style: a filled circle with a soft dark ring."""
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((6, 6, 58, 58), fill="#1a1b26")
    draw.ellipse((14, 14, 50, 50), fill=colour)
    return img


def update_loop(monitor: Monitor, api: Api, stop: threading.Event) -> None:
    """Check for a newer build every few hours; install it if allowed."""
    delay = 60.0  # first check shortly after start, then every few hours
    while not stop.wait(delay):
        delay = UPDATE_CHECK_SEC
        rel = updater.check(monitor.settings.community_url)
        api.update = rel
        if rel and monitor.settings.auto_update and updater.can_self_replace():
            print(f"installing update {rel.version}", flush=True)
            updater.install(rel)  # restarts the app on success


def run_tray(monitor: Monitor, open_ui: Any) -> bool:  # pragma: no cover - needs a desktop
    """Run the tray icon on the main thread. Returns False if no tray is available."""
    if sys.platform.startswith("linux") and "PYSTRAY_BACKEND" not in os.environ:
        # Wayland desktops only show StatusNotifier (AppIndicator) icons.
        try:
            import gi  # type: ignore[import-not-found,unused-ignore]

            gi.require_version("AyatanaAppIndicator3", "0.1")
            os.environ["PYSTRAY_BACKEND"] = "appindicator"
        except (ImportError, ValueError):
            pass
    try:
        import pystray  # type: ignore[import-untyped,import-not-found,unused-ignore]
    except Exception as e:  # noqa: BLE001 - missing backend raises various errors
        print(f"tray unavailable ({e}); using browser only", file=sys.stderr)
        return False

    def quit_app(icon: Any, _item: Any) -> None:
        monitor.stop()
        icon.stop()

    def detail(i: int) -> Any:
        return pystray.MenuItem(
            lambda _item: monitor.status.details[i] if len(monitor.status.details) > i else "",
            None,
            enabled=False,
            visible=lambda _item: len(monitor.status.details) > i,
        )

    menu = pystray.Menu(
        pystray.MenuItem(lambda _i: f"● {monitor.status.headline}", None, enabled=False),
        *(detail(i) for i in range(5)),
        pystray.MenuItem(
            lambda _i: (
                f"Checked {monitor.status.checked_at:%H:%M}" if monitor.status.checked_at else ""
            ),
            None,
            enabled=False,
            visible=lambda _i: monitor.status.checked_at is not None,
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Open NBN Watch", lambda _i, _m: open_ui(), default=True),
        pystray.MenuItem("Check now", lambda _i, _m: monitor.wake()),
        pystray.MenuItem(
            "Start at login",
            lambda _i, _m: autostart.set_enabled(not autostart.is_enabled()),
            checked=lambda _i: autostart.is_enabled(),
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", quit_app),
    )
    icon = pystray.Icon("nbn-watch", tray_image(monitor.status.colour), APP_NAME, menu)

    def changed(old: AppStatus, new: AppStatus) -> None:
        icon.icon = tray_image(new.colour)
        icon.title = f"{APP_NAME}: {new.headline}"
        icon.update_menu()
        moved = old.level != new.level and old.level not in ("setup", "checking")
        if moved and getattr(icon, "HAS_NOTIFICATION", False):
            icon.notify("\n".join(new.details[:3]), f"{APP_NAME}: {new.headline}")

    monitor.on_change = changed
    try:
        icon.run(setup=lambda i: setattr(i, "visible", True))
    except Exception as e:  # noqa: BLE001
        print(f"tray failed ({e}); using browser only", file=sys.stderr)
        return False
    return True


def _wait_forever() -> None:
    threading.Event().wait()


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if "--write-icon" in args:  # used by the Linux installer
        target = args[args.index("--write-icon") + 1]
        img = tray_image("#7aa2f7").resize((256, 256))
        img.save(target)
        return 0
    home = data_dir()
    if "--check" in args:  # used by the Omarchy bar plugin's "Check now"
        return 0 if request_check(home) else 1
    running = existing_instance(home)
    if running:
        webbrowser.open(running)
        return 0

    monitor = Monitor(home)
    server, url, token, api = start_server(monitor)
    (home / "ui.json").write_text(json.dumps({"url": url, "token": token}), encoding="utf-8")
    if sys.platform != "win32":
        (home / "ui.json").chmod(0o600)
    login_url = f"{url}/?t={token}"
    print(f"{APP_NAME} running. Data: {home}", flush=True)

    def open_ui() -> None:
        webbrowser.open(login_url)

    stop = threading.Event()
    monitor.start()
    threading.Thread(target=update_loop, args=(monitor, api, stop), daemon=True).start()
    if not monitor.settings.setup_done or "--open" in args:
        open_ui()  # first run: straight into the setup wizard
    try:
        if "--no-tray" in args or not run_tray(monitor, open_ui):
            _wait_forever()  # browser-only mode: run until killed
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        monitor.stop()
        server.shutdown()
        (home / "ui.json").unlink(missing_ok=True)
    return 0
