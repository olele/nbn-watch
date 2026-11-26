"""Alert delivery: the community Telegram bot (relay) and/or your own bot."""

from __future__ import annotations

import html
import sys
from dataclasses import dataclass

import niquests

from .util import redact

# What happened (first icon) and who noticed (second icon).
EMOJI = {
    "down": "🔴",
    "up": "🟢",
    "degraded": "🟠",
    "planned": "🚧",
    "info": "ℹ️",
    "test": "✅",
    "nbnco": "🏢",
    "router": "🛜",
    "speed": "🚀",
}


@dataclass(frozen=True)
class Notifier:
    relay_url: str = ""  # community server; sends to the chat linked to this device
    device_id: str = ""
    bot_token: str = ""  # optional: your own Telegram bot
    chat_id: str = ""

    @property
    def enabled(self) -> bool:
        return bool((self.relay_url and self.device_id) or (self.bot_token and self.chat_id))

    def send(self, title: str, message: str, *, icons: str = "", silent: bool = False) -> bool:
        """True when at least one channel accepted the alert."""
        emoji = "".join(EMOJI.get(i, "") for i in icons.split(",") if i)
        ok = False
        if self.relay_url and self.device_id:
            ok |= self._relay(title, message, emoji, silent)
        if self.bot_token and self.chat_id:
            ok |= self._telegram(title, message, emoji, silent)
        return ok

    def _relay(self, title: str, message: str, emoji: str, silent: bool) -> bool:
        payload = {
            "device": self.device_id,
            "title": title,
            "message": message,
            "emoji": emoji,
            "silent": silent,
        }
        try:
            niquests.post(
                f"{self.relay_url.rstrip('/')}/api/notify", json=payload, timeout=15
            ).raise_for_status()
            return True
        except niquests.RequestException as e:
            print(f"relay alert failed: {redact(e)}", file=sys.stderr)
            return False

    def _telegram(self, title: str, message: str, emoji: str, silent: bool) -> bool:
        heading = f"{emoji} {title}" if emoji else title
        payload = {
            "chat_id": self.chat_id,
            "text": f"<b>{html.escape(heading)}</b>\n{html.escape(message)}",
            "parse_mode": "HTML",
            "disable_notification": silent,
            "link_preview_options": {"is_disabled": True},
        }
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            niquests.post(url, json=payload, timeout=15).raise_for_status()
            return True
        except niquests.RequestException as e:
            print(f"telegram alert failed: {redact(e)}", file=sys.stderr)
            return False
