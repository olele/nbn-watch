"""Start-at-login for Windows (Run key), macOS (LaunchAgent) and Linux (XDG autostart)."""

from __future__ import annotations

import contextlib
import os
import shlex
import sys
from pathlib import Path

LABEL = "au.nbnwatch.app"


def launch_command() -> list[str]:
    """Command that starts this app (packaged executable or ``python -m``)."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, "-m", "nbn_watch.desktop"]


def _mac_plist() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def _linux_desktop() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "autostart" / "nbn-watch.desktop"


if sys.platform == "win32":  # pragma: no cover - Windows only
    import subprocess
    import winreg

    _RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

    def _win_is_enabled() -> bool:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
                winreg.QueryValueEx(key, "NBN Watch")
                return True
        except OSError:
            return False

    def _win_set(enabled: bool, cmd: list[str]) -> None:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                value = subprocess.list2cmdline(cmd)
                winreg.SetValueEx(key, "NBN Watch", 0, winreg.REG_SZ, value)
            else:
                with contextlib.suppress(OSError):
                    winreg.DeleteValue(key, "NBN Watch")

else:

    def _win_is_enabled() -> bool:
        raise OSError("Windows only")

    def _win_set(enabled: bool, cmd: list[str]) -> None:
        raise OSError("Windows only")


def _platform() -> str:
    return sys.platform


def is_enabled(platform: str | None = None) -> bool:
    platform = platform or _platform()
    if platform == "win32":
        return _win_is_enabled()
    if platform == "darwin":
        return _mac_plist().exists()
    return _linux_desktop().exists()


def set_enabled(enabled: bool, platform: str | None = None) -> None:
    platform = platform or _platform()
    cmd = launch_command()
    if platform == "win32":
        _win_set(enabled, cmd)
        return
    target = _mac_plist() if platform == "darwin" else _linux_desktop()
    if not enabled:
        target.unlink(missing_ok=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if platform == "darwin":
        args = "".join(f"<string>{_xml(a)}</string>" for a in cmd)
        target.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
            '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0"><dict>'
            f"<key>Label</key><string>{LABEL}</string>"
            f"<key>ProgramArguments</key><array>{args}</array>"
            "<key>RunAtLoad</key><true/>"
            "</dict></plist>\n"
        )
    else:
        target.write_text(
            "[Desktop Entry]\nType=Application\nName=NBN Watch\n"
            f"Exec={shlex.join(cmd)}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n"
        )


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
