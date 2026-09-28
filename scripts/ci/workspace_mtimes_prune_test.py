#!/usr/bin/env python3
"""
Both directions for workspace_mtimes.py's prune, against a stand-in target.

- a workspace unit with no file written at or after T goes: its fingerprint directory, its build
  directory, its deps files;
- a workspace unit with any file written at or after T stays whole, older files included;
- an external dependency's unit stays, however old;
- a member's file named like a dependency's unit stays, however old, while that member's other
  units still go;
- the path-dependency stash and the source marker stay;
- the counts it prints are the counts it writes for the next job;
- with no marker nothing is pruned, and it says so;
- a member's build script is not one of its crate names, and a dependency carries only its package
  and library names, not its tests'.

"""

from __future__ import annotations

import contextlib
import io
import os
import sys
import tempfile
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
import workspace_mtimes as w


T = 1790540469
OLD, NEW = T - 3600, T + 60
HASH_A, HASH_B = "0123456789abcdef", "fedcba9876543210"


def fail(message: str) -> None:
    sys.exit(f"FAIL: {message}")


def write(path: Path, content: bytes, mtime: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    os.utime(path, (mtime, mtime))
    return path


def fixture(target: Path) -> tuple[list[Path], list[Path]]:
    """
    Return (files that must go, files that must stay).
    """
    write(target / "CACHEDIR.TAG", w.SIGNATURE.encode(), OLD)
    marker = w.marker_path(target)
    write(marker, f"{w.SIGNATURE}\n# workspace source {'a' * 40} {T}\n".encode(), T)
    profile = target / "ci-pr"
    go = [
        write(profile / "deps" / f"vibe_alias-{HASH_A}", b"bin", OLD),
        write(profile / ".fingerprint" / f"vibe-core-{HASH_A}" / "lib-vibe_core", b"fp", OLD),
        write(profile / "build" / f"vibe-core-{HASH_A}" / "out" / "generated.rs", b"out", OLD),
        write(profile / "deps" / f"libvibe_core-{HASH_A}.rlib", b"rlib" * 100, OLD),
        write(profile / "deps" / f"vibe_core-{HASH_A}.d", b"d", OLD),
    ]
    stay = [
        # The same member under the hash this run built: one fresh file keeps the whole unit.
        write(profile / ".fingerprint" / f"vibe-core-{HASH_B}" / "lib-vibe_core", b"fp", NEW),
        write(profile / "build" / f"vibe-core-{HASH_B}" / "out" / "unchanged.rs", b"o", OLD),
        write(profile / "build" / f"vibe-core-{HASH_B}" / "output", b"o", NEW),
        write(profile / "deps" / f"libvibe_core-{HASH_B}.rlib", b"rlib", NEW),
        # External dependencies reuse by hash.
        write(profile / ".fingerprint" / f"serde-{HASH_A}" / "lib-serde", b"fp", OLD),
        write(profile / "deps" / f"libserde-{HASH_A}.rlib", b"rlib", OLD),
        # A member whose name an external package also uses.
        write(profile / "deps" / f"libshared_name-{HASH_A}.rlib", b"rlib", OLD),
        write(profile / ".fingerprint" / f"shared-name-{HASH_A}" / "lib", b"fp", OLD),
        # A member test whose crate name a dependency's library also uses: that name's files stay,
        # while the same member's other units, below, still go.
        write(profile / "deps" / f"libalias_crate-{HASH_A}.rlib", b"rlib", OLD),
        # The stash and the marker.
        write(w.stash_path(target), b"tar", OLD),
        marker,
    ]
    return go, stay


PACKAGES = (
    [
        ("shared-name", ["shared_name"]),
        ("vibe-alias", ["alias_crate", "vibe_alias"]),
        ("vibe-core", ["vibe_core"]),
    ],
    {"serde", "shared-name", "shared_name", "alias_crate"},
)


def check_prune(scratch: Path) -> None:
    target = scratch / "target"
    go, stay = fixture(target)
    output = scratch / "github_output"
    os.environ["GITHUB_OUTPUT"] = str(output)
    size = sum(p.stat().st_size for p in go)
    with contextlib.redirect_stdout(io.StringIO()) as out:
        w.prune(target)
    left = [p for p in go if p.exists()]
    if left:
        fail(f"prune kept units this run did not build: {left}")
    print("ok a workspace unit with no file written after T is gone, all three of its kinds")
    gone = [p for p in stay if not p.exists()]
    if gone:
        fail(f"prune deleted what must stay: {gone}")
    print(
        "ok a unit this run built stays whole; externals, a shared name, the stash and marker stay",
    )
    expected = f"pruned 5 workspace unit entries, {size} bytes"
    if expected not in out.getvalue():
        fail(f"prune said {out.getvalue()!r}, expected {expected!r}")
    if output.read_text() != f"pruned-entries=5\npruned-bytes={size}\n":
        fail(f"prune wrote {output.read_text()!r} for the next job")
    print("ok the counts it prints are the counts it hands on")


def check_no_marker(scratch: Path) -> None:
    target = scratch / "unmarked"
    go, _stay = fixture(target)
    w.marker_path(target).unlink()
    with contextlib.redirect_stdout(io.StringIO()) as out:
        w.prune(target)
    if "nothing pruned" not in out.getvalue() or not all(p.exists() for p in go):
        fail(f"with no marker prune did not leave everything: {out.getvalue()!r}")
    print("ok without a marker nothing is pruned, and it says so")


def target(name: str, kind: str) -> dict:
    return {"name": name, "kind": [kind]}


def check_member_packages() -> None:
    real = w.metadata
    w.metadata = lambda: {
        "workspace_members": ["core"],
        "packages": [
            {
                "id": "core",
                "name": "vibe-core",
                "targets": [
                    target("vibe_core", "lib"),
                    target("build-script-build", "custom-build"),
                    target("uuid", "test"),
                ],
            },
            {
                "id": "uuid",
                "name": "uuid",
                "targets": [target("uuid", "lib"), target("smoke", "test")],
            },
        ],
    }
    try:
        own, shared = w.member_packages()
    finally:
        w.metadata = real
    if own != [("vibe-core", ["uuid", "vibe_core"])]:
        fail(f"members read as {own}; a build script never lands in deps and is not a member crate")
    if shared != {"uuid"}:
        fail(f"a dependency's units read as carrying {shared}; only its package and library names")
    print(
        "ok members name no build script; a dependency carries only its package and library names",
    )


def main() -> None:
    check_member_packages()
    w.member_packages = lambda: PACKAGES
    with tempfile.TemporaryDirectory() as scratch:
        check_prune(Path(scratch))
        check_no_marker(Path(scratch))
    print("ok: prune removes only the workspace units this run did not build")


if __name__ == "__main__":
    main()
