# Contributing to NBN Watch

The most valuable contribution is **support for another modem**. Australia has
dozens of NBN modems; every driver makes the app useful to thousands more homes.

## How a new modem gets supported

```
user's app finds an unsupported modem
  → user sends model details and/or a diagnostic capture (cleaned locally)
  → community server stores it
  → daily sync opens a GitHub issue labelled `router-support`
     (the capture itself is kept privately by maintainers, never in the issue)
  → AI assistant drafts a driver + tests from the capture (see docs/ai-router-support.md)
  → a maintainer reviews and merges (never auto-merged: drivers handle passwords)
  → release → every user's app updates itself
```

If the AI can't do it, the issue gets the **`bounty`** label and anyone can
claim it.

## Honour bounties

NBN Watch doesn't pay bounties — it gives credit:

- Your name (and link) in the **[Hall of Fame](HALL_OF_FAME.md)** and on the
  app's *About* page.
- The driver file carries your credit, and the modem is listed as
  "supported thanks to @you" in the README.
- Release notes thank you by name.

To claim one: comment "I'll take this" on a `bounty` issue, then open a PR.
First working PR wins; ties are shared.

## Writing a driver

A driver lives in `nbn_watch/routers/<family>.py` and subclasses
`nbn_watch.routers.base.Driver`:

```python
class MyModem(Driver):
    id = "acme_x1"              # stable id, stored in settings
    name = "ACME X1 NBN Modem"  # shown to users
    isp = "ACME"
    experimental = True         # until someone confirms it on a real modem
    has_log = False             # True if read() returns failover events

    def matches(self, fp: Fingerprint) -> bool:
        # Pre-login facts only: login page HTML, <title>, Server header, UPnP model.
        return "acme x1" in fp.text

    def read(self, host, user, password, session=None) -> RouterReading:
        # Log in, then return RouterReading(live=RouterLive(...), events=[...]).
        # Raise LoginError for bad credentials, UnreachableError for network errors.
```

Then add it to `DRIVERS` in `nbn_watch/routers/__init__.py` and write tests in
`tests/` that replay the captured pages with a mocked session (see the Optus and
Telstra tests). **Never** log or send credentials; drivers only talk to the
modem on the local network.

What NBN Watch needs from a modem, in order of value:

1. **Is traffic on NBN or the mobile backup right now?** (`RouterLive.on_mobile`)
2. Is the NBN link up? Is the 4G/5G backup ready? Signal?
3. A log of failover / failback times (`RouterEvent`s), if the modem keeps one.

## Development setup

```bash
uv sync --extra desktop
uv run ruff check . && uv run ruff format --check . && uv run mypy nbn_watch
uv run pytest tests/
cd community-server && npm test
```

## Ground rules

- Privacy first: addresses, LOC IDs, passwords and IPs never leave the user's
  machine (the only exception is the opt-in, encrypted recovery watch).
- Australia only — NBN is Australian.
- Be kind. Discussion: GitHub Discussions.
