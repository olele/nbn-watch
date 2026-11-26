"""Colours for the local UI: the current Omarchy theme when present, else Tokyo Night."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

# Omarchy's default theme (Tokyo Night) as the fallback everywhere else.
DEFAULT: dict[str, str] = {
    "accent": "#7aa2f7",
    "background": "#1a1b26",
    "dark_background": "#13141c",
    "lighter_background": "#24283b",
    "selection": "#292e42",
    "muted": "#414868",
    "foreground": "#a9b1d6",
    "dark_foreground": "#565f89",
    "bright_foreground": "#c0caf5",
    "red": "#f7768e",
    "yellow": "#e0af68",
    "green": "#9ece6a",
    "blue": "#7aa2f7",
    "cyan": "#449dab",
}
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
OMARCHY_COLORS = Path.home() / ".local" / "state" / "omarchy" / "current" / "theme" / "colors.toml"


def load_theme(path: Path = OMARCHY_COLORS) -> dict[str, str]:
    colours = dict(DEFAULT)
    try:
        data = tomllib.loads(path.read_text())
    except (OSError, tomllib.TOMLDecodeError):
        return colours
    for key in DEFAULT:
        value = data.get(key)
        if isinstance(value, str) and _HEX.match(value):
            colours[key] = value
    return colours


def css_vars(colours: dict[str, str]) -> str:
    return ":root{" + "".join(f"--{k.replace('_', '-')}:{v};" for k, v in colours.items()) + "}"
