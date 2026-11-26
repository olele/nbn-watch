"""Small shared helpers."""

from __future__ import annotations

import re

_BOT_TOKEN = re.compile(r"bot\d+:[A-Za-z0-9_-]{20,}")
_QUERY = re.compile(r"(https?://[^\s?'\"]+)\?[^\s'\"]*")


def redact(error: object, limit: int = 300) -> str:
    """Error text safe for logs: no bot tokens or URL query strings (they can carry IDs)."""
    text = str(error)
    text = _BOT_TOKEN.sub("bot<redacted>", text)
    text = _QUERY.sub(r"\1?<redacted>", text)
    return text[:limit]
