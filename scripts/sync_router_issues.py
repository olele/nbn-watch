"""Copy new router-support reports from the community server into GitHub issues.

Runs daily (see scripts/install-issue-sync.sh). Each unsupported router model
users reported becomes one issue in the repo (label ``router-support``) with
its fingerprint and sanitized login page, so support can be added and shipped
in an app update. Needs ``COMMUNITY_ADMIN_TOKEN`` and an authenticated ``gh``.

    python scripts/sync_router_issues.py [--dry-run]
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import niquests

SERVER = os.environ.get("COMMUNITY_URL", "https://nbn-community.nbnstatus.workers.dev").rstrip("/")
REPO = os.environ.get("ROUTER_ISSUE_REPO", "olele/nbn-watch")
CAPTURES = Path(__file__).resolve().parent.parent / "captures"  # gitignored: never published
LABEL = "router-support"


def title(issue: dict[str, Any]) -> str:
    model = " ".join(
        x
        for x in (
            issue.get("upnp_manufacturer"),
            issue.get("upnp_model"),
            issue.get("upnp_model_number"),
        )
        if x
    )
    name = (
        model
        or issue.get("title")
        or issue.get("realm")
        or issue.get("server_header")
        or "unknown model"
    )
    isp = f" ({issue['isp']})" if issue.get("isp") else ""
    return f"Router support: {name}{isp}"[:200]


def capture_note(issue: dict[str, Any]) -> str:
    size = int(issue.get("capture_bytes") or 0)
    if not size:
        return "not yet — ask the reporter to send one from the app"
    return f"yes ({size // 1024} KB, kept privately in captures/{issue.get('fp_key')}.json)"


def body(issue: dict[str, Any]) -> str:
    rows = [
        ("ISP", issue.get("isp")),
        ("Country", issue.get("country")),
        ("UPnP manufacturer", issue.get("upnp_manufacturer")),
        ("UPnP model", issue.get("upnp_model")),
        ("UPnP model number", issue.get("upnp_model_number")),
        ("UPnP friendly name", issue.get("upnp_friendly")),
        ("Page title", issue.get("title")),
        ("Server header", issue.get("server_header")),
        ("Auth realm", issue.get("realm")),
        ("Reports / devices", f"{issue.get('reports')} / {issue.get('device_count')}"),
        ("App / OS", f"{issue.get('app_version')} / {issue.get('os')}"),
        ("Error", issue.get("error")),
        ("Diagnostic capture", capture_note(issue)),
        ("Recordings received", issue.get("recordings")),
        ("Credit (Hall of Fame)", issue.get("credit")),
    ]
    table = "\n".join(f"| {k} | {str(v).replace('|', '/')} |" for k, v in rows if v)
    try:
        paths = ", ".join(f"`{p}`" for p in json.loads(issue.get("paths") or "[]"))
    except ValueError:
        paths = ""
    page = (issue.get("login_page") or "").replace("```", "'''")[:15000]
    return (
        "A user's NBN Watch app found a router it cannot read yet.\n\n"
        "| Field | Value |\n|---|---|\n"
        + table
        + "\n\n"
        + (f"**Linked paths:** {paths}\n\n" if paths else "")
        + "<details><summary>Sanitized login page</summary>\n\n```html\n"
        + page
        + "\n```\n</details>\n\n"
        "To support it: add a driver in `nbn_watch/routers/` (see CONTRIBUTING.md) with "
        "tests, then publish a release. When a capture is attached, "
        "`scripts/ai_router_driver.py` drafts the driver as a draft PR for review.\n"
        f"\n_fingerprint `{issue.get('fp_key')}`_"
    )


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    token = os.environ.get("COMMUNITY_ADMIN_TOKEN", "")
    if not token:
        print("COMMUNITY_ADMIN_TOKEN is not set", file=sys.stderr)
        return 2
    auth = {"Authorization": f"Bearer {token}"}
    resp = niquests.get(f"{SERVER}/api/admin/router-issues", headers=auth, timeout=20)
    resp.raise_for_status()
    issues = resp.json().get("issues", [])
    print(f"{len(issues)} new router report(s)")
    if not issues or dry:
        for i in issues:
            print(" -", title(i))
        return 0
    subprocess.run(
        [
            "gh",
            "label",
            "create",
            LABEL,
            "-R",
            REPO,
            "--color",
            "e0af68",
            "--force",
            "--description",
            "Router model the desktop app cannot read yet",
        ],
        check=False,
        capture_output=True,
    )
    done: list[int] = []
    CAPTURES.mkdir(exist_ok=True)
    for issue in issues:
        if issue.get("capture_bytes"):
            cap = niquests.get(
                f"{SERVER}/api/admin/router-issues/{issue['id']}/capture", headers=auth, timeout=30
            )
            if cap.status_code == 200 and cap.content:
                (CAPTURES / f"{issue['fp_key']}.json").write_bytes(cap.content)
        result = subprocess.run(
            [
                "gh",
                "issue",
                "create",
                "-R",
                REPO,
                "--label",
                LABEL,
                "--title",
                title(issue),
                "--body-file",
                "-",
            ],
            input=body(issue),
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            print("created", result.stdout.strip())
            done.append(int(issue["id"]))
        else:
            print("gh failed:", result.stderr.strip()[:300], file=sys.stderr)
    if done:
        niquests.post(
            f"{SERVER}/api/admin/router-issues/ack", headers=auth, json={"ids": done}, timeout=20
        )
    return 0 if len(done) == len(issues) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
