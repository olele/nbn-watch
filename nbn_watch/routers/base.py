"""Router driver contract.

A driver teaches nbn-watch to read one family of modems. It must:

1. ``matches(fp)`` — recognise the modem from what it publishes *before* login
   (login page HTML/title, server header, UPnP model). No credentials.
2. ``read(host, user, password)`` — log in and return a :class:`RouterReading`:
   the live connection (NBN vs mobile backup) and, if the modem keeps one,
   failover/failback events from its log.

Drivers never store or send credentials anywhere; they only talk to the modem
on the local network. See CONTRIBUTING.md for how to add one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, ClassVar, Literal

if TYPE_CHECKING:
    from datetime import datetime

    import niquests

WanState = Literal["nbn", "mobile"]


class RouterError(RuntimeError):
    """The modem could not be read."""


class LoginError(RouterError):
    """The modem rejected the admin username or password."""


class UnreachableError(RouterError):
    """Nothing answered at the modem's address."""


@dataclass(frozen=True)
class RouterEvent:
    timestamp: datetime  # modem local time (naive)
    kind: WanState  # the WAN the modem moved to
    message: str


@dataclass(frozen=True)
class RouterLive:
    """What the modem's status screen shows right now."""

    connection_type: str  # e.g. "Fibre/Cable", "Optus 4G", "NBN", "Mobile backup"
    on_mobile: bool  # traffic is going over the mobile (4G/5G) backup
    nbn_connected: bool  # the NBN link is up
    mobile_up: bool  # the mobile backup is registered / ready
    signal: str = ""  # e.g. "Good, -94.0 dBm"
    technology: str = ""  # "5G", "4G", "3G"

    @property
    def wan(self) -> WanState:
        return "mobile" if self.on_mobile else "nbn"

    @property
    def mobile_name(self) -> str:
        return self.technology or "Mobile"


@dataclass(frozen=True)
class RouterReading:
    live: RouterLive | None
    events: list[RouterEvent] = field(default_factory=list)


@dataclass(frozen=True)
class Fingerprint:
    """Pre-login facts about a modem (see :mod:`nbn_watch.probe`)."""

    html: str = ""
    title: str = ""
    server_header: str = ""
    realm: str = ""
    upnp_manufacturer: str = ""
    upnp_model: str = ""

    @property
    def text(self) -> str:
        return " ".join(
            (
                self.html,
                self.title,
                self.server_header,
                self.realm,
                self.upnp_manufacturer,
                self.upnp_model,
            )
        ).lower()


class Driver:
    id: ClassVar[str] = ""
    name: ClassVar[str] = ""  # shown to users, e.g. "Optus Smart Modem"
    isp: ClassVar[str] = ""
    experimental: ClassVar[bool] = False  # not yet confirmed on a real modem
    has_log: ClassVar[bool] = False  # can report past failover times
    default_user: ClassVar[str] = "admin"
    password_hint: ClassVar[str] = ""

    def matches(self, fp: Fingerprint) -> bool:
        raise NotImplementedError

    def read(
        self, host: str, user: str, password: str, session: niquests.Session | None = None
    ) -> RouterReading:
        raise NotImplementedError
