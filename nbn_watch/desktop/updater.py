"""Auto-update for the packaged desktop app.

The community server publishes the latest build per platform
(``/api/app/latest?platform=…`` → version, https URL, sha256). A newer build is
downloaded next to the running executable, its SHA-256 is verified, and it
replaces the executable; the app then restarts itself. macOS .app bundles and
source installs are not replaced in place — the user gets the download link.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import niquests

from .. import __version__ as VERSION  # noqa: N812
from ..util import redact as _safe_error_message


@dataclass(frozen=True)
class Release:
    version: str
    url: str
    sha256: str
    notes: str = ""


def platform_key() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def parse_version(v: str) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in v.split("."))
    except ValueError:
        return (0,)


def newer(candidate: str, current: str = VERSION) -> bool:
    return parse_version(candidate) > parse_version(current)


def check(base_url: str, session: niquests.Session | None = None) -> Release | None:
    """The latest release if it is newer than this app; ``None`` otherwise or on error."""
    s = session or niquests.Session()
    try:
        resp = s.get(
            f"{base_url.rstrip('/')}/api/app/latest",
            params={"platform": platform_key()},
            timeout=10,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        rel = Release(
            str(data["version"]), str(data["url"]), str(data["sha256"]), str(data.get("notes", ""))
        )
    except (niquests.RequestException, ValueError, KeyError, TypeError) as e:
        print(f"update check failed: {_safe_error_message(e)}", file=sys.stderr)
        return None
    finally:
        if session is None:
            s.close()
    if not rel.url.startswith("https://") or len(rel.sha256) != 64:
        return None
    return rel if newer(rel.version) else None


def current_executable() -> Path:
    """The file to replace: the AppImage itself when running from one."""
    appimage = os.environ.get("APPIMAGE")
    return Path(appimage) if appimage else Path(sys.executable)


def can_self_replace() -> bool:
    """A single-file build (Windows .exe, Linux AppImage/binary) in a folder we can write.

    macOS .app bundles and system packages (.deb in /usr/bin) update by download.
    """
    if not getattr(sys, "frozen", False) or sys.platform == "darwin":
        return False
    return os.access(current_executable().parent, os.W_OK)


def download(rel: Release, target_dir: Path, session: niquests.Session | None = None) -> Path:
    """Download and verify; returns the new file. Raises ``ValueError`` on a bad hash."""
    s = session or niquests.Session()
    tmp = target_dir / f".nbn-watch-{rel.version}.download"
    digest = hashlib.sha256()
    try:
        resp = s.get(rel.url, timeout=300, stream=True)
        resp.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in resp.iter_content(1 << 16):
                if chunk:
                    digest.update(chunk)
                    fh.write(chunk)
    finally:
        if session is None:
            s.close()
    if digest.hexdigest() != rel.sha256:
        tmp.unlink(missing_ok=True)
        raise ValueError("downloaded update failed its SHA-256 check")
    if sys.platform != "win32":
        tmp.chmod(0o755)
    return tmp


def install(rel: Release, exe: Path | None = None) -> bool:  # pragma: no cover - replaces itself
    """Replace the running executable and restart. Returns False if not possible."""
    if not can_self_replace():
        return False
    exe = exe or current_executable()
    try:
        new = download(rel, exe.parent)
        if sys.platform == "win32":
            old = exe.with_suffix(".old.exe")
            old.unlink(missing_ok=True)
            exe.rename(old)  # a running .exe can be renamed but not overwritten
            new.rename(exe)
            subprocess.Popen([str(exe)], close_fds=True)
            os._exit(0)
        os.replace(new, exe)
        os.execv(str(exe), [str(exe), *sys.argv[1:]])
    except (OSError, ValueError, niquests.RequestException) as e:
        print(f"update failed: {_safe_error_message(e)}", file=sys.stderr)
        return False
    return True
