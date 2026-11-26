# AI-assisted router support

A daily job (`scripts/sync_router_issues.py`, installed with
`scripts/install-issue-sync.sh`) turns new reports into `router-support` issues
and saves sanitised captures to `captures/<fingerprint>.json` (gitignored).

Right after, `scripts/ai_router_driver.py` hands every new issue that has a
capture to Claude Code (headless), then opens a **draft PR**. How it is contained,
because the capture comes from a stranger and may contain prompt-injection text:

- a fresh git worktree per issue, holding only that capture (no `.env`, no other captures);
- Claude runs inside a bubblewrap jail: the home directory is hidden apart from the
  worktree and tool installs; only file tools plus `uv run pytest` / `uv run ruff`
  are allowed, no web tools, and Claude's own sandbox runs those commands offline;
- the script re-runs the tests itself in a jail with no network;
- only files under `nbn_watch/routers/` and `tests/` are committed, and the push is
  refused if the diff contains any secret the script knows about;
- if the capture is missing pages, the AI writes a request instead and the issue gets
  `needs-capture` plus a comment telling the reporter exactly what to record.

Logs are in `../.nbn-watch-ai/<fingerprint>.log`. Run by hand with
`python scripts/ai_router_driver.py --dry-run` or `--issue N`.

The brief Claude works from (abridged; the full text is in the script):

> You are adding support for a modem to NBN Watch.
> Inputs: the GitHub issue (model, ISP, page title, server header, linked paths)
> and `captures/<fingerprint>.json` (sanitised HAR: paths, parameter names,
> status codes, cleaned page/script/JSON bodies).
> 1. Work out from the capture how the modem logs in (form fields, hashing,
>    tokens, cookies) and where it exposes: current WAN (NBN vs mobile backup),
>    NBN link state, mobile backup state/signal, and any failover log.
> 2. Write `nbn_watch/routers/<family>.py` (see CONTRIBUTING.md) with
>    `experimental = True`, `matches()` from pre-login facts only, and `read()`.
> 3. Write tests that replay the capture's responses through a mocked session,
>    including a bad-password case.
> 4. Never hard-code credentials, never add network calls other than to the
>    modem, never weaken the capture sanitiser.
> 5. Open a PR referencing the issue. If the capture lacks the needed pages,
>    comment on the issue asking for a capture of the specific page instead.

PRs are reviewed by a maintainer before merge — drivers handle passwords, so
they are never auto-merged. Issues the assistant can't solve get the `bounty`
label (see CONTRIBUTING.md).
