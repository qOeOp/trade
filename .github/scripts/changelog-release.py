"""Move every changelog.d/ entry under a new version in CHANGELOG.md and delete the files.

Usage: python .github/scripts/changelog-release.py X.Y.Z

Each file holds list entries ("- " at the start of a line, continued by indented lines). The new section goes right
after the Unreleased text, dated today (UTC), breaking entries ("- Breaking") first, then the rest, each group in file
name order. The release's notes are that section; CHANGELOG.md says how a version is released.
"""

from datetime import UTC, datetime
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
FRAGMENTS = ROOT / "changelog.d"
CHANGELOG = ROOT / "CHANGELOG.md"


def entries(text: str) -> list[str]:
    found: list[str] = []
    for line in text.splitlines():
        if line.startswith("- "):
            found.append(line)
        elif line.strip() and found:
            found[-1] += "\n" + line
        elif line.strip():
            raise SystemExit(f"text outside a list entry: {line!r}")
    return found


def main(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("usage: changelog-release.py X.Y.Z")
    files = sorted(FRAGMENTS.glob("*.md"))
    if not files:
        raise SystemExit("changelog.d/ holds no entries")
    found = [entry for path in files for entry in entries(path.read_text())]
    ordered = [e for e in found if e.startswith("- Breaking")] + [e for e in found if not e.startswith("- Breaking")]
    text = CHANGELOG.read_text()
    marker = re.search(r"^## \d+\.\d+\.\d+ ", text, re.M)
    if marker is None or "## Unreleased\n" not in text[: marker.start()]:
        raise SystemExit("CHANGELOG.md has no Unreleased section before its newest version")
    if f"## {version} " in text:
        raise SystemExit(f"CHANGELOG.md already has {version}")
    section = f"## {version} ({datetime.now(UTC).date().isoformat()})\n\n" + "\n".join(ordered) + "\n\n"
    CHANGELOG.write_text(text[: marker.start()] + section + text[marker.start() :])
    for path in files:
        path.unlink()
    print(section, end="")


if __name__ == "__main__":
    main(*sys.argv[1:2] or [""])
