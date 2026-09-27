#!/usr/bin/env python3
"""
Both directions for workspace_mtimes.py's path-dependency stash, against rust-cache's
cleanup.

The stash exists because of how one pinned version of Swatinem/rust-cache cleans the target before
it saves. The simulation below restates that version's rules and names where each one lives, so a
new pin must be read against its own source: the test fails while any workflow pins a rust-cache
other than the one these rules were read from.

- the stash survives the cleanup that deletes the path dependency's own units, and unpacking it
  restores those units byte for byte with their mtimes;
- the same bytes under any other file name do not survive, so the file name is what keeps them;
- units of a different package whose name only starts the same are left out;
- a missing stash says so, rather than passing in silence.

"""

from __future__ import annotations

import contextlib
import io
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
import workspace_mtimes as w


ROOT = Path(__file__).resolve().parents[2]
# The rust-cache these rules were read from. Changing the pin in any workflow fails this test until
# the rules below are re-read against the new version's source and this line is updated with them.
VERIFIED_RUST_CACHE = "c19371144df3bb44fab255c43d04cbc2ab54d1c4"
HASH = "0123456789abcdef"


def fail(message: str) -> None:
    sys.exit(f"FAIL: {message}")


def simulate_cleanup(target: Path, keep: list[tuple[str, list[str]]]) -> None:
    """
    Restate rust-cache's cleanTargetDir at VERIFIED_RUST_CACHE for the packages it
    keeps.
    """
    # src/cleanup.ts:10-33 cleanTargetDir: every file at this level goes except CACHEDIR.TAG; a
    # directory holding CACHEDIR.TAG or .rustc_info.json is a nested target and is cleaned the same
    # way; any other directory is a profile directory.
    for entry in list(target.iterdir()):
        if entry.is_dir():
            if (entry / "CACHEDIR.TAG").exists() or (entry / ".rustc_info.json").exists():
                simulate_cleanup(entry, keep)
            else:
                clean_profile(entry, keep)
        elif entry.name != "CACHEDIR.TAG":
            entry.unlink()


def clean_profile(profile: Path, keep: list[tuple[str, list[str]]]) -> None:
    # src/cleanup.ts:57-76 cleanProfileTarget: only build, .fingerprint and deps stay; in build and
    # .fingerprint an entry stays when its name without the trailing `-hash` is a kept package
    # name, in deps when it is a kept crate name or that name with `lib` before it.
    # src/cleanup.ts:268-294 rmExcept strips the part after the last `-`.
    for entry in list(profile.iterdir()):
        if entry.name not in {"build", ".fingerprint", "deps"}:
            shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
    names = {name for name, _ in keep}
    crates = {crate for _, crate_list in keep for crate in crate_list}
    keep_deps = crates | {f"lib{crate}" for crate in crates}
    for kind, kept in (("build", names), (".fingerprint", names), ("deps", keep_deps)):
        for entry in list((profile / kind).glob("*")):
            name = entry.name.rsplit("-", 1)[0] if "-" in entry.name else entry.name
            if name not in kept:
                shutil.rmtree(entry) if entry.is_dir() else entry.unlink()


def write(path: Path, content: bytes, mtime: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    os.utime(path, (mtime, mtime))


def fixture(target: Path) -> dict[Path, tuple[bytes, int]]:
    """
    Lay out a profile with a path dependency, a member and a lookalike package.
    """
    target.mkdir(parents=True)
    (target / "CACHEDIR.TAG").write_text(w.SIGNATURE)
    profile = target / "ci-pr"
    stashed = {
        profile / ".fingerprint" / f"pyo3-stub-gen-{HASH}" / "lib-pyo3_stub_gen": (
            b"fp",
            1790000100,
        ),
        profile / "deps" / f"libpyo3_stub_gen-{HASH}.rlib": (b"rlib", 1790000200),
        profile / "deps" / f"pyo3_stub_gen-{HASH}.d": (b"depinfo", 1790000300),
    }
    for path, (content, mtime) in stashed.items():
        write(path, content, mtime)
    write(profile / ".fingerprint" / f"vibe-core-{HASH}" / "lib-vibe_core", b"member", 1790000400)
    write(profile / "deps" / f"libpyo3_stub_gen_derive-{HASH}.so", b"lookalike", 1790000500)
    write(
        profile / ".fingerprint" / f"pyo3-stub-gen-derive-{HASH}" / "lib",
        b"lookalike",
        1790000500,
    )
    return stashed


def check_pin() -> None:
    pins = set()
    for path in [*ROOT.joinpath(".github").rglob("*.yml")]:
        pins.update(
            re.findall(r"Swatinem/rust-cache@([0-9a-f]{40})", path.read_text(encoding="utf-8")),
        )
    if not pins:
        fail(
            "no Swatinem/rust-cache pin found under .github; the rules below have nothing to hold to",
        )
    if pins != {VERIFIED_RUST_CACHE}:
        fail(
            f"rust-cache is pinned at {sorted(pins)}, but the cleanup rules this stash relies on were "
            f"read at {VERIFIED_RUST_CACHE}. Re-read src/cleanup.ts (cleanTargetDir, "
            "cleanProfileTarget, rmExcept) and src/save.ts at the new pin, confirm CACHEDIR.TAG is "
            "still kept at any depth, then update VERIFIED_RUST_CACHE and simulate_cleanup.",
        )
    print(f"ok every rust-cache pin is the verified {VERIFIED_RUST_CACHE[:9]}")


PACKAGES = [("pyo3-stub-gen", ["pyo3_stub_gen"])]
MEMBERS = [("vibe-core", ["vibe_core"])]


def check_units(target: Path, stashed: dict[Path, tuple[bytes, int]]) -> None:
    found = w.unit_files(target, PACKAGES)
    if sorted(found) != sorted(stashed) or any("derive" in str(p) for p in found):
        fail(
            f"unit_files found {sorted(map(str, found))}, expected only the path dependency's units",
        )
    print("ok only the path dependency's own units are found, not the lookalike")


def check_cleanup(scratch: Path, target: Path, stashed: dict[Path, tuple[bytes, int]]) -> None:
    with contextlib.redirect_stdout(io.StringIO()) as out:
        w.stash(target)
    if (
        "stashed path dependencies outside the members (pyo3-stub-gen): 3 file(s)"
        not in out.getvalue()
    ):
        fail(f"stash did not say what it stored: {out.getvalue()!r}")
    control = scratch / "control"
    shutil.copytree(target, control)
    control_stash = control / w.stash_path(target).relative_to(target)
    control_stash.rename(control_stash.with_name("stash.tar"))
    simulate_cleanup(target, MEMBERS)
    simulate_cleanup(control, MEMBERS)
    if any(path.exists() for path in stashed):
        fail(
            "the simulated cleanup kept the path dependency's units, so it does not model the loss",
        )
    if not (target / "ci-pr" / ".fingerprint" / f"vibe-core-{HASH}").exists():
        fail("the simulated cleanup dropped a member's units")
    if not w.stash_path(target).exists():
        fail("the stash did not survive the cleanup")
    if any((control / "path-dep-stash").glob("*")):
        fail("the same bytes under another file name survived; the name is not what keeps them")
    print("ok the stash survives the cleanup that drops the units, and only under CACHEDIR.TAG")


def check_unstash(target: Path, stashed: dict[Path, tuple[bytes, int]]) -> None:
    with contextlib.redirect_stdout(io.StringIO()) as out:
        w.unstash(target)
    if "unstashed path dependencies: 3 file(s)" not in out.getvalue():
        fail(f"unstash did not say what it restored: {out.getvalue()!r}")
    for path, (content, mtime) in stashed.items():
        if path.read_bytes() != content or int(path.stat().st_mtime) != mtime:
            fail(f"{path.name} came back with other bytes or mtime {path.stat().st_mtime}")
    print("ok unstash restores every unit with its bytes and mtime")
    w.stash_path(target).unlink()
    with contextlib.redirect_stdout(io.StringIO()) as out:
        w.unstash(target)
    if "no path-dependency stash restored" not in out.getvalue():
        fail(f"a missing stash passed in silence: {out.getvalue()!r}")
    print("ok a missing stash is reported")


def main() -> None:
    check_pin()
    w.stashed_packages = lambda: PACKAGES
    with tempfile.TemporaryDirectory() as scratch:
        target = Path(scratch) / "target"
        stashed = fixture(target)
        check_units(target, stashed)
        check_cleanup(Path(scratch), target, stashed)
        check_unstash(target, stashed)
    print("ok: the path-dependency stash survives rust-cache's cleanup and restores exactly")


if __name__ == "__main__":
    main()
