"""Move every changelog.d/ entry under a version in CHANGELOG.md and delete the files, or print a version's notes.

Usage: python .github/scripts/changelog-release.py X.Y.Z
       python .github/scripts/changelog-release.py --notes X.Y.Z

Each file holds list entries ("- " at the start of a line, continued by indented lines). The section goes right
after the Unreleased text, dated today (UTC), breaking entries ("- Breaking") first, then the rest, each group in file
name order. When the newest section already is X.Y.Z (its version was raised earlier and not yet released), the
entries join it after its own, and its date becomes today. The release's notes are that section's entries
(--notes); CHANGELOG.md says how a version is released.
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
            if not line[2:].strip():
                raise SystemExit(f"empty list entry: {line!r}")
            found.append(line)
        elif line.strip() and found and line[0].isspace():
            found[-1] += "\n" + line
        elif line.strip():
            raise SystemExit(f"text outside a list entry: {line!r}")
    return found


def newest(text: str) -> tuple[re.Match[str], int]:
    """The newest version section's heading and where the section ends."""
    marker = re.search(r"^## (\d+\.\d+\.\d+) \(", text, re.M)
    if marker is None or "## Unreleased\n" not in text[: marker.start()]:
        raise SystemExit("CHANGELOG.md has no Unreleased section before its newest version")
    following = re.search(r"^## ", text[marker.end() :], re.M)
    return marker, marker.end() + following.start() if following else len(text)


def notes(version: str) -> str:
    """One version's entries, as the release's notes."""
    text = CHANGELOG.read_text()
    heading = re.search(rf"^## {re.escape(version)} \(.*\)\n", text, re.M)
    if heading is None:
        raise SystemExit(f"CHANGELOG.md has no {version}")
    following = re.search(r"^## ", text[heading.end() :], re.M)
    body = text[heading.end() : heading.end() + following.start() if following else len(text)].strip()
    if not body:
        raise SystemExit(f"CHANGELOG.md's {version} has no entries")
    return body + "\n"


def main(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("usage: changelog-release.py [--notes] X.Y.Z")
    files = sorted(FRAGMENTS.glob("*.md"))
    if not files:
        raise SystemExit("changelog.d/ holds no entries")
    found = [entry for path in files for entry in entries(path.read_text())]
    text = CHANGELOG.read_text()
    marker, end = newest(text)
    if marker[1] == version:
        # Raised earlier and not released yet: its own entries keep their place before the new ones.
        found = entries(text[text.index("\n", marker.start()) : end]) + found
    elif f"## {version} " in text:
        raise SystemExit(f"CHANGELOG.md already has {version} below its newest version")
    else:
        end = marker.start()
    ordered = [e for e in found if e.startswith("- Breaking")] + [e for e in found if not e.startswith("- Breaking")]
    section = f"## {version} ({datetime.now(UTC).date().isoformat()})\n\n" + "\n".join(ordered) + "\n\n"
    CHANGELOG.write_text(text[: marker.start()] + section + text[end:])
    for path in files:
        path.unlink()
    print(section, end="")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--notes"]:
        print(notes(*sys.argv[2:3] or [""]), end="")
    else:
        main(*sys.argv[1:2] or [""])
