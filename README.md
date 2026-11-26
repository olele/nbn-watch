# NBN Watch

**Know the moment your NBN drops — and when it's really back.**

NBN Watch is a small free desktop app for Australian homes. It watches your
modem directly, so it sees an NBN dropout (and the switch to 4G backup) the
moment it happens — usually well before NBN Co's own status page updates — and
tells you on Telegram. Opt in, and your area joins a live community outage map
with real recovery times.

🗺️ **Live map & statistics:** https://nbn-community.nbnstatus.workers.dev

## Features

- 🛜 **Router-level detection** — reads your modem's status and failover log:
  NBN lost → 4G backup ON, NBN back → backup OFF, with exact times. The modem is
  treated as the source of truth; NBN Co's status page is shown alongside.
- 🔍 **Finds the right box** — mesh Wi-Fi in front of the ISP modem? NBN Watch
  traces the path to the internet and picks the modem that faces the NBN.
- 🏢 **NBN Co status** for your address, including planned work and degradation.
- 🔔 **Telegram alerts** with clear icons — *what happened* (🔴 🟢 🟠 🚧) and
  *who noticed* (🛜 router, 🏢 NBN Co, 🚀 speed test). Connect in one tap with a
  code; no bot setup.
- 🚀 **Speed tests** every 30 minutes (never over metered 4G) and alerts on big drops.
- 👥 **Community outage map** (opt-in): only your ~1 km area is shared — never
  your address. Outage counts, average/median recovery time, by area, state and
  connection type.
- 🖥️ **Tray app** for Windows, macOS and Linux, a setup wizard, and an
  [Omarchy](https://omarchy.org) bar widget. Updates itself.

## Supported modems

| Modem | Status |
|---|---|
| Optus Smart Modem / Ultra WiFi Modem (Arcadyan HGW) | ✅ supported |
| Telstra Smart Modem Gen 2 (Technicolor DJA0231) | 🧪 experimental — please test |
| Telstra Smart Modem Gen 3 / 4 | 🔜 recognised, needs a diagnostic capture |
| TP-Link, Netgear, ASUS, Nest/Google Wifi, … | 🔜 [help add yours](CONTRIBUTING.md) |

No supported modem? NBN Watch still works using NBN Co's status, speed tests
and the community map — and the app can send a **diagnostic capture** so support
can be added (see below). Your password never leaves your computer.

## Install

Download from [Releases](https://github.com/olele/nbn-watch/releases):

- **Windows:** `NBN-Watch-…-windows.exe` — run it; the setup page opens.
- **macOS:** `…-macos-arm64.dmg` (Apple silicon) or `…-macos-x64.dmg` (Intel).
  First launch: right-click → Open (the app isn't notarised yet).
- **Linux (any distro):** `NBN-Watch-…-x86_64.AppImage` → `chmod +x` and run.
  **Ubuntu/Debian:** `sudo apt install ./nbn-watch_…_amd64.deb`.
  Omarchy: `packaging/linux/install.sh NBN-Watch-…AppImage` also adds the bar widget.

Then follow the wizard: **address → modem admin login → Telegram → preferences.**

> The modem password is the **admin** password (often on the modem's sticker),
> not your Wi-Fi password.

## How it protects your privacy

- Your address, LOC ID and modem password stay on your computer.
- The community map receives your NBN serving area, suburb and the centre of a
  ~1 km grid square — re-coarsened by the server too.
- Optional *recovery watch*: during an outage only, your NBN location ID is sent
  so the server can log the recovery even if your computer is offline; it is
  stored encrypted and deleted when the outage ends.
- Diagnostic captures are cleaned on your computer (passwords, cookies, Wi-Fi
  names, MAC/IP addresses, serials, phone numbers, e-mails) and you see a
  summary before anything is sent.

## Help add your modem

1. In the wizard's **Router** step, choose your modem → **Help add support**.
2. Record its admin page in your browser (F12 → Network → *Save all as HAR*)
   and pick the file. NBN Watch cleans it and shows you what will be sent.
3. Every day new reports become GitHub issues labelled `router-support`; an AI
   assistant drafts a driver and tests it against the capture, a maintainer
   reviews it, and the next release ships it — your app updates itself.
4. Anything the AI can't crack becomes a public **honour bounty** — see
   [CONTRIBUTING.md](CONTRIBUTING.md) and the [Hall of Fame](HALL_OF_FAME.md).

## Development

```bash
uv sync --extra desktop
uv run pytest tests/          # 85% coverage gate
uv run python -m nbn_watch.desktop --no-tray
cd community-server && npm test   # Cloudflare Worker + D1
```

Layout: `nbn_watch/` (engine, NBN API client, `routers/` drivers, probe,
capture, desktop app), `community-server/` (map, stats, reports, Telegram relay,
updates), `packaging/` (PyInstaller, AppImage, .deb, Omarchy widget).

## Credits

- Inspired by **[teh-hippo/nbn-status](https://github.com/teh-hippo/nbn-status)**,
  the NBN outage monitor that showed how to read NBN Co's status for an address.
  NBN Watch is an independent implementation (no code from that project); it adds
  real-time router detection, 4G-failover tracking, the community map and the
  desktop app.
- Telstra Gen 2 login: SRP variant reverse-engineered by
  **[hatdz/telstra-smart-modem](https://github.com/hatdz/telstra-smart-modem)** (MIT).
- Maps: [MapLibre](https://maplibre.org) and [OpenFreeMap](https://openfreemap.org),
  © OpenMapTiles, data © OpenStreetMap contributors.

Not affiliated with NBN Co, Optus or Telstra. MIT licence.
