"""Per-user settings for the desktop app, stored as JSON in the data directory."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from ..engine import Config, RouterSettings
from ..notify import Notifier

APP_NAME = "NBN Watch"
DEFAULT_COMMUNITY_URL = "https://nbn-community.nbnstatus.workers.dev"
POLL_MINUTES = 5


def data_dir() -> Path:
    """Per-user data directory (``NBN_WATCH_HOME`` overrides)."""
    override = os.environ.get("NBN_WATCH_HOME")
    if override:
        path = Path(override).expanduser()
    elif sys.platform == "win32":
        path = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / APP_NAME
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_NAME
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
        path = Path(base) / "nbn-watch"
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Settings:
    loc_id: str = ""
    address: str = ""  # formatted address shown in messages (never uploaded)
    label: str = "Home"
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    community: bool = False  # explicit opt-in to anonymous zone reports
    community_url: str = DEFAULT_COMMUNITY_URL
    recovery_watch: bool = True  # let the server check NBN for recovery while offline
    router_ip: str = ""  # optional: Optus HGW router failover detection
    router_password: str = ""
    router_user: str = "admin"
    router_name: str = ""  # detected model, e.g. "Optus Smart Modem"
    router_driver: str = ""  # driver id, e.g. "optus_hgw"
    speedtest: bool = True
    telegram_linked: bool = False  # linked to the community bot (alerts via relay)
    auto_update: bool = True
    setup_done: bool = False  # first-run wizard finished

    @property
    def configured(self) -> bool:
        return bool(self.loc_id)

    @classmethod
    def load(cls, path: Path) -> Settings:
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return cls()
        if not isinstance(data, dict):
            return cls()
        known = {f.name for f in fields(cls)}
        clean = {k: v for k, v in data.items() if k in known}
        try:
            return cls(**clean)
        except TypeError:
            return cls()

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2))
        if sys.platform != "win32":
            tmp.chmod(0o600)  # contains bot token / router password
        tmp.replace(path)

    def engine_config(self) -> Config:
        router = None
        if self.router_ip and self.router_password and self.router_driver:
            router = RouterSettings(
                self.router_driver,
                self.router_ip,
                self.router_user or "admin",
                self.router_password,
            )
        return Config(
            loc_id=self.loc_id,
            label=self.label or "Home",
            address=self.address,
            router=router,
            speedtest=self.speedtest,
            community_url=self.community_url,
            community=self.community,
            recovery_watch=self.recovery_watch,
        )

    def notifier(self, device_id: str) -> Notifier:
        return Notifier(
            relay_url=self.community_url if self.telegram_linked else "",
            device_id=device_id if self.telegram_linked else "",
            bot_token=self.telegram_bot_token,
            chat_id=self.telegram_chat_id,
        )
