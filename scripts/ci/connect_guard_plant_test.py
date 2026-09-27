#!/usr/bin/env python3
"""
Both directions for the check-connect-guard-plant pre-commit hook.

scripts/ci/check-disallowed-connect-outside-union.bash appends a plant on every run to a real source
file and restore it on exit. A killed run cannot restore it, so the hook refuses any `.rs` file that
contains the plants' marker. The hook repeats the marker as a literal, so this reads both files and
checks that:
- the hook's pattern finds each plant the script writes, rendered from the script's own text, so a
  marker changed on one side only fails here;
- its `files` covers the file the script plants into;
- the real plant file, and the plant with its marker altered, are not refused.

Stdlib only: this runs in the no-compile job, whose python3 has no PyYAML. The hook's block is read
by its `- id:` line, which is enough for its three flat keys.

"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / ".pre-commit-config.yaml"
SCRIPT = ROOT / "scripts/ci/check-disallowed-connect-outside-union.bash"
HOOK = "check-connect-guard-plant"


def fail(message: str) -> None:
    sys.exit(f"FAIL: {message}")


def hook_keys() -> dict[str, str]:
    block = re.search(
        rf"^\s*- id: {re.escape(HOOK)}\n(.*?)(?=^\s*- id: |\Z)",
        CONFIG.read_text(),
        re.MULTILINE | re.DOTALL,
    )
    if block is None:
        fail(f"{CONFIG.name} has no hook {HOOK}")
    return dict(re.findall(r"^\s*(entry|language|files): (.+?)\s*$", block.group(1), re.MULTILINE))


def plants() -> tuple[str, list[str]]:
    text = SCRIPT.read_text()
    marker = re.search(r'^plant_marker="([^"]+)"$', text, re.MULTILINE)
    plant_file = re.search(r'^plant_file="([^"]+)"$', text, re.MULTILINE)
    if marker is None or plant_file is None:
        fail(f"{SCRIPT.name} no longer sets plant_marker and plant_file")
    bodies = re.findall(r'cat >> "\$plant_file" << EOF\n(.*?)\nEOF\n', text, re.DOTALL)
    if len(bodies) != 2:
        fail(f"expected the two plants (the gate's, --self-test-bisect's), found {len(bodies)}")
    return plant_file.group(1), [
        body.replace("${plant_marker}", marker.group(1)) for body in bodies
    ]


def main() -> None:
    keys = hook_keys()
    if keys.get("language") != "pygrep":
        fail(f"{HOOK} must be a pygrep hook, it is {keys.get('language')!r}")
    pattern = re.compile(keys["entry"])
    plant_file, rendered = plants()
    for body in rendered:
        if not pattern.search(body):
            fail(f"{HOOK} does not refuse this plant:\n{body}")
    print(f"ok the pattern refuses both plants ({len(rendered)})")
    if not re.search(keys["files"], plant_file):
        fail(f"{HOOK}'s files {keys['files']!r} do not cover the plant file {plant_file}")
    print(f"ok its files cover {plant_file}")
    if pattern.search((ROOT / plant_file).read_text()):
        fail(f"{HOOK} refuses {plant_file} as committed")
    altered = [body.replace("planted_", "planted-") for body in rendered]
    if any(pattern.search(body) for body in altered) or altered == rendered:
        fail("an altered marker is still refused, so the pattern is not the marker")
    print("ok the committed plant file and an altered marker pass")
    print(f"ok: {HOOK} refuses exactly the marker the guard's self-tests plant")


if __name__ == "__main__":
    main()
