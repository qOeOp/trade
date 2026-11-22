"""Delete pull request image versions of trade-ide, trade-service and trade-docker-api from GHCR after 30 days.

Usage: python .github/scripts/ghcr-retention.py [--delete]

Without --delete it only prints what it would delete. A pull request build publishes three versions per image: the
platform index tagged `pr-N` and `sha-<merge commit>`, and its two native manifests tagged `pr-N-<arch>` and
`sha-<merge commit>-<arch>` (ide-image.yml, publish-platform-image.sh). Each is its own package version, so each is
deleted by its own tags. A version is deleted only when every tag is one of those shapes, at least one is `pr-N`,
no `sha-` names a commit of main, its digest is not pinned in this checkout, and it was last updated (tagged) more
than 30 days ago. Untagged versions and every other image (trade-runtime above all: ledger trials and Live manifests
name its digests) are never touched.
"""

from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any
import urllib.error
import urllib.request

OWNER = "qOeOp"
PACKAGES = ("trade-ide", "trade-service", "trade-docker-api")
AGE = timedelta(days=30)
TAG = re.compile(r"(?:pr-[1-9][0-9]*|sha-(?P<sha>[0-9a-f]{40}))(?:-amd64|-arm64)?")
API = "https://api.github.com"


def removable(version: dict[str, Any], now: datetime, on_main: Any, pinned: set[str]) -> bool:
    tags = version["metadata"]["container"]["tags"]
    matches = [TAG.fullmatch(tag) for tag in tags]
    if not tags or not all(matches) or not any(tag.startswith("pr-") for tag in tags):
        return False
    if any(match and match["sha"] and on_main(match["sha"]) for match in matches):
        return False
    if version["name"] in pinned:
        return False
    updated = datetime.fromisoformat(version["updated_at"].replace("Z", "+00:00"))
    return now - updated > AGE


def is_on_main(sha: str) -> bool:
    """A commit of main's history; the checkout holds all of it, so an unknown commit is not on main."""
    result = subprocess.run(["git", "merge-base", "--is-ancestor", sha, "origin/main"], capture_output=True)
    if result.returncode in (0, 1):
        return result.returncode == 0
    known = subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"], capture_output=True).returncode == 0
    if known:
        raise SystemExit(f"cannot tell whether {sha} is on main: {result.stderr.decode().strip()}")
    return False


def pinned_digests(root: Path) -> set[str]:
    listed = subprocess.run(["git", "grep", "-hoE", r"trade-[a-z-]+@sha256:[0-9a-f]{64}"], cwd=root,
                            capture_output=True, text=True)
    if listed.returncode not in (0, 1):
        raise SystemExit(f"git grep failed: {listed.stderr.strip()}")
    return {line.split("@", 1)[1] for line in listed.stdout.split()}


def request(method: str, url: str) -> tuple[Any, str]:
    call = urllib.request.Request(url, method=method, headers={
        "Accept": "application/vnd.github+json", "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
        "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(call, timeout=60) as response:
        body = response.read()
        links = response.headers.get("Link") or ""
    following = re.search(r'<([^>]+)>; rel="next"', links)
    return (json.loads(body) if body else None), (following[1] if following else "")


def versions(package: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    url = f"{API}/users/{OWNER}/packages/container/{package}/versions?per_page=100"
    while url:
        page, url = request("GET", url)
        found += page
    return found


def main(argv: list[str]) -> None:
    if argv not in ([], ["--delete"]):
        raise SystemExit("usage: ghcr-retention.py [--delete]")
    delete = argv == ["--delete"]
    now = datetime.now(UTC)
    pinned = pinned_digests(Path.cwd())
    failed = 0
    for package in PACKAGES:
        chosen = [version for version in versions(package) if removable(version, now, is_on_main, pinned)]
        print(f"{package}: {len(chosen)} pull request versions older than {AGE.days} days")
        for version in chosen:
            tags = ",".join(version["metadata"]["container"]["tags"])
            print(f"  {'delete' if delete else 'would delete'} {version['id']} {version['name']} {tags}")
            if not delete:
                continue
            try:
                request("DELETE", f"{API}/users/{OWNER}/packages/container/{package}/versions/{version['id']}")
            except urllib.error.HTTPError as error:
                failed += 1
                print(f"::error::{package} version {version['id']} ({tags}) was not deleted: HTTP {error.code}")
    if failed:
        raise SystemExit(f"{failed} versions were not deleted")


if __name__ == "__main__":
    main(sys.argv[1:])
