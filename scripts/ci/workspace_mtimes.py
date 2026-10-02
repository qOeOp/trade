#!/usr/bin/env python3
"""
Let a pull request reuse the workspace artifacts main cached, by giving cargo honest
mtimes.

cargo treats a local unit as stale when a file in its dep-info (a source, an `include_str!` or
`include_bytes!` input, a `rerun-if-changed` path) is newer than the unit's fingerprint. Checkout
gives every file a new mtime, so without this every workspace crate rebuilds on every run.

`record` runs on main before anything compiles. It writes the commit being built and the time T
into a nested cache directory the Rust cache keeps (rust-cache deletes every other file at the
target root before saving, but keeps `CACHEDIR.TAG` in a nested target).

`reuse` runs on a pull request after the cache is restored. It sets every tracked file that is
unchanged since that commit to T - 1 and every changed file to now, and does the same for every
directory holding a tracked file, by whether any path below it changed. A `rerun-if-changed` that
names a directory makes cargo compare the newest mtime in that tree, directories included, and a
directory keeps its checkout time otherwise (vibe-serialization's `schemas/capnp` rebuilt all 52
member crates on a pull request that changed one shell script, run 37041880456). A file removed
from such a directory shows only in the directory's mtime, which is why a deletion counts too:

- a unit main built in the recording run has outputs newer than T, so it stays fresh;
- a unit an earlier run left in the cache has outputs older than T, so it rebuilds;
- a unit that reads a changed file rebuilds, whatever kind of file that is;
- a unit that watches a directory rebuilds when a file below it changed, appeared or went away.

Commit times are never used. A pull request's commits can predate the cache, which would make a
changed file older than a stale output and pass the output as fresh.

Whenever `reuse` cannot prove the mapping, it leaves the checkout's mtimes, so everything
rebuilds, and prints why: no marker, the cached commit unreachable, a failed diff, or a change to
a manifest, the lock file, cargo configuration or the toolchain.

`stash` runs on main after the build, `reuse` unpacks what it stored. rust-cache keeps the units of
packages outside the workspace root and of workspace members, and deletes everything else before
saving (Swatinem/rust-cache c19371144, src/save.ts:41-53 and src/cleanup.ts:55-70). A path
dependency inside the root that is not a member - `patches/pyo3-stub-gen`, which 37 crates depend
on - falls in neither, so every pull request recompiled it and everything above it (65 of 77 local
crates on every pull request on 2026-09-27). `stash` packs those packages' build, fingerprint and
deps files, mtimes included, into a CACHEDIR.TAG, the one file name the cleanup keeps at any depth
(src/cleanup.ts:10-30); `reuse` unpacks it before it sets any mtime. A source change in such a
package still rebuilds it: its sources get the new mtime like any other changed file.

`prune` runs on main after everything compiled and before the cache is saved. It deletes every
workspace unit no file of which this run wrote, which is every one older than T: when main's key
changes, the new entry is saved on top of the one it restored, and those older units would ride
along in every later entry although a pull request rebuilds each of them anyway. Units of
dependencies stay, and so does any file named like one; the stash and the marker are not units.

`verify` checks the result by a second route, blob by blob between the two trees rather than
through `git diff`. Every tracked file whose content differs must be newer than T and every
other tracked file must be exactly T - 1, whatever its type; a directory above a differing or
removed path must be newer than T and every other one exactly T - 1. A path left wrong fails by
name.
`reuse` ends by running it.

"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path


SIGNATURE = "Signature: 8a477f597d28d172789f06886806bc55"
MARKER_LINE = re.compile(r"^# workspace source ([0-9a-f]{40}) ([0-9]+)$")
# A change here reaches every crate through something cargo does not tie to one crate's
# fingerprint: the workspace manifest and lock, cargo configuration, the toolchain, and the build
# environment make sets. A member crate's own Cargo.toml is not here: cargo fingerprints what it
# compiles from (features, dependencies and their versions, targets, build scripts), so a change
# rebuilds exactly that crate's closure (measured field by field; see the pull request).
FALLBACK_PATHS = re.compile(
    r"^Cargo\.toml$|^Cargo\.lock$|(^|/)\.cargo/|^rust-toolchain(\.toml)?$|^build-env\.mk$",
)
PREFIX = "workspace artifacts:"
GIT = shutil.which("git") or "git"


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run([GIT, *args], capture_output=True, check=check)


def stash_path(target_dir: Path) -> Path:
    return target_dir / "path-dep-stash" / "CACHEDIR.TAG"


def metadata() -> dict:
    cargo = shutil.which("cargo") or "cargo"
    return json.loads(
        subprocess.run(
            [cargo, "metadata", "--format-version", "1", "--locked"],
            capture_output=True,
            check=True,
        ).stdout,
    )


LIBRARY_KINDS = frozenset({"lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"})


def crate_names(
    package: dict,
    *,
    only: frozenset[str] | None = None,
    exclude: frozenset[str] | set[str] = frozenset(),
) -> list[str]:
    return sorted(
        {
            t["name"].replace("-", "_")
            for t in package["targets"]
            if (only is None or only & set(t["kind"])) and not exclude & set(t["kind"])
        },
    )


def stashed_packages() -> list[tuple[str, list[str]]]:
    """
    Return (package name, crate names) for every local path package inside this checkout
    that is not a workspace member.
    """
    meta = metadata()
    root = os.path.realpath(meta["workspace_root"]) + os.sep
    members = set(meta["workspace_members"])
    packages = []
    for package in meta["packages"]:
        manifest = os.path.realpath(package["manifest_path"])
        if (
            package.get("source") is None
            and package["id"] not in members
            and manifest.startswith(root)
        ):
            packages.append((package["name"], crate_names(package)))
    return sorted(packages)


def member_packages() -> tuple[list[tuple[str, list[str]]], set[str]]:
    """
    Return (package name, crate names) for every workspace member, and every name a unit
    from outside the workspace can carry in the target.
    """
    meta = metadata()
    members = set(meta["workspace_members"])
    # A build script's binary lives in its unit's build directory, named by package, never in deps.
    own = sorted(
        (package["name"], crate_names(package, exclude={"custom-build"}))
        for package in meta["packages"]
        if package["id"] in members
    )
    # A dependency is built only as its library: its units carry its package name and the crate
    # name of its library target, never the name of one of its tests or binaries.
    shared = {
        name
        for package in meta["packages"]
        if package["id"] not in members
        for name in [package["name"], *crate_names(package, only=LIBRARY_KINDS)]
    }
    return own, shared


def profile_dirs(target_dir: Path) -> list[Path]:
    """
    Return every profile directory under the target, nested targets included.
    """
    profiles = []
    # A walk that never descends into the unit directories themselves: the target holds hundreds
    # of thousands of files, and a profile directory is recognised by its `.fingerprint` child.
    for directory, subdirectories, _files in os.walk(target_dir):
        if ".fingerprint" in subdirectories:
            profiles.append(Path(directory))
        subdirectories[:] = [
            d for d in subdirectories if d not in {".fingerprint", "build", "deps", "incremental"}
        ]
    return profiles


def unit_entries(target_dir: Path, packages: list[tuple[str, list[str]]]) -> list[Path]:
    """
    Return every build and fingerprint directory and deps file those packages left in
    any profile directory under the target.
    """
    names = [name for name, _ in packages]
    crates = [crate for _, crate_list in packages for crate in crate_list]
    if not names:
        return []
    # cargo names a unit `<package>-<16 hex>` and its outputs `[lib]<crate>-<16 hex>[.ext]`. Matching
    # the whole shape keeps `pyo3-stub-gen-derive`, a different package, out of `pyo3-stub-gen`.
    unit = re.compile(rf"^(?:{'|'.join(map(re.escape, names))})-[0-9a-f]{{16}}$")
    output = re.compile(rf"^(?:lib)?(?:{'|'.join(map(re.escape, crates))})-[0-9a-f]{{16}}(?:\.|$)")
    found = []
    for profile in profile_dirs(target_dir):
        for kind in (".fingerprint", "build"):
            found.extend(e for e in (profile / kind).glob("*") if unit.match(e.name))
        found.extend(
            entry
            for entry in (profile / "deps").glob("*")
            if entry.is_file() and output.match(entry.name)
        )
    return sorted(set(found))


def unit_files(target_dir: Path, packages: list[tuple[str, list[str]]]) -> list[Path]:
    """
    Return every build, fingerprint and deps file those packages left in any profile
    directory under the target, nested targets included.
    """
    found = []
    for entry in unit_entries(target_dir, packages):
        found.extend(p for p in [entry, *entry.rglob("*")] if p.is_file())
    return sorted(set(found))


def entry_files(entry: Path) -> list[Path]:
    return [entry] if entry.is_file() else [p for p in entry.rglob("*") if p.is_file()]


def prune(target_dir: Path) -> int:
    """
    Delete the workspace units this run did not build, before main saves the target.
    """
    marker = read_marker(target_dir)
    if marker is None:
        print(f"{PREFIX} no source marker in {target_dir}; nothing pruned")
        return 0
    sha, recorded = marker
    own, shared = member_packages()
    # A name a dependency's units also carry would match them, and they reuse by hash and must
    # stay: a member test named `uuid` shares `deps/` with the uuid crate. Such a name is left out,
    # and with it only that name's files; a package name no member shares today.
    packages = [
        (name, [crate for crate in crates if crate not in shared])
        for name, crates in own
        if name not in shared
    ]
    units = removed = 0
    for entry in unit_entries(target_dir, packages):
        files = entry_files(entry)
        # A unit this run built or re-ran has an output written after T; one it only restored has
        # none. The pull request would rebuild it anyway: reuse sets unchanged sources to T - 1.
        if any(f.stat().st_mtime >= recorded for f in files):
            continue
        removed += sum(f.stat().st_size for f in files)
        units += 1
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    print(
        f"{PREFIX} pruned {units} workspace unit entries, {removed} bytes, that this run did not build "
        f"(older than {sha[:9]} at {recorded})",
    )
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"pruned-entries={units}\npruned-bytes={removed}\n")
    return 0


def stash(target_dir: Path) -> int:
    packages = stashed_packages()
    names = ", ".join(name for name, _ in packages) or "none"
    files = unit_files(target_dir, packages)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for path in files:
            archive.add(path, arcname=str(path.relative_to(target_dir)), recursive=False)
    path = stash_path(target_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buffer.getvalue())
    print(
        f"{PREFIX} stashed path dependencies outside the members ({names}): "
        f"{len(files)} file(s), {path.stat().st_size} bytes in {path}",
    )
    return 0


def unstash(target_dir: Path) -> None:
    path = stash_path(target_dir)
    if not path.is_file():
        print(
            f"{PREFIX} no path-dependency stash restored ({path} is missing); those crates rebuild",
        )
        return
    with tarfile.open(path) as archive:
        members = [
            m for m in archive.getmembers() if m.isfile() and not m.name.startswith(("/", ".."))
        ]
        archive.extractall(target_dir, members=members, filter="data")
    print(
        f"{PREFIX} unstashed path dependencies: {len(members)} file(s), {path.stat().st_size} bytes from {path}",
    )


def marker_path(target_dir: Path) -> Path:
    return target_dir / "source-marker" / "CACHEDIR.TAG"


def read_marker(target_dir: Path) -> tuple[str, int] | None:
    try:
        lines = marker_path(target_dir).read_text().splitlines()
    except OSError:
        return None
    for line in lines:
        match = MARKER_LINE.match(line)
        if match:
            return match.group(1), int(match.group(2))
    return None


def tree(rev: str) -> dict[str, str]:
    """
    Return path -> "mode blob" for every file in the commit, submodules excluded.
    """
    out = git("ls-tree", "-r", "-z", "--full-tree", rev).stdout.decode()
    entries = {}
    for record in filter(None, out.split("\0")):
        meta, path = record.split("\t", 1)
        mode, kind, blob = meta.split()
        if kind == "blob":
            entries[path] = f"{mode} {blob}"
    return entries


def record(target_dir: Path) -> int:
    sha = git("rev-parse", "HEAD").stdout.decode().strip()
    now = int(time.time())
    path = marker_path(target_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{SIGNATURE}\n# workspace source {sha} {now}\n")
    print(f"{PREFIX} recorded source {sha} at {now}")
    return 0


def full_rebuild(reason: str) -> int:
    print(f"{PREFIX} full rebuild: {reason}")
    return 0


def reachable(sha: str) -> bool:
    if git("cat-file", "-e", f"{sha}^{{tree}}", check=False).returncode == 0:
        return True
    fetch = ["fetch", "--no-tags", "--quiet", "--depth=1", "origin", sha]
    token = os.environ.get("GIT_FETCH_TOKEN", "")
    if token:
        credential = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        fetch = [
            "-c",
            f"http.https://github.com/.extraheader=AUTHORIZATION: basic {credential}",
            *fetch,
        ]
    return git(*fetch, check=False).returncode == 0


def directories(paths: set[str] | dict[str, str]) -> set[str]:
    """
    Return every directory above those paths, the checkout root excluded.
    """
    found = set()
    for path in paths:
        parent = os.path.dirname(path)
        while parent and parent not in found:
            found.add(parent)
            parent = os.path.dirname(parent)
    return found


def set_mtime(path: str, seconds: float) -> None:
    os.utime(path, (seconds, seconds), follow_symlinks=False)


def reuse(target_dir: Path) -> int:
    marker = read_marker(target_dir)
    if marker is None:
        return full_rebuild(
            f"the restored cache carries no source marker ({marker_path(target_dir)})",
        )
    sha, recorded = marker
    if not reachable(sha):
        return full_rebuild(f"cannot reach the cached source commit {sha}")
    diff = git("diff", "--name-only", "--no-renames", "-z", sha, "HEAD", check=False)
    if diff.returncode != 0:
        return full_rebuild(f"git diff {sha} HEAD failed: {diff.stderr.decode().strip()}")
    changed = [p for p in diff.stdout.decode().split("\0") if p]
    blocking = [p for p in changed if FALLBACK_PATHS.search(p)]
    if blocking:
        return full_rebuild(f"{', '.join(blocking[:5])} changed since the cached source {sha}")

    unstash(target_dir)
    unchanged_time = recorded - 1
    now = time.time()
    changed_set = set(changed)
    tracked = tree("HEAD")
    for path in tracked:
        if os.path.lexists(path):
            set_mtime(path, now if path in changed_set else unchanged_time)
    # Setting a file's mtime leaves its directory's alone, so the directories go after the files.
    above_changed = directories(changed_set)
    folders = directories(tracked)
    for folder in folders:
        set_mtime(folder, now if folder in above_changed else unchanged_time)
    touched = sum(1 for p in changed if p in tracked)
    moved = len(folders & above_changed)
    print(
        f"{PREFIX} reusing main's build of {sha} (recorded {recorded}): "
        f"{touched} changed file(s) set to now, {len(tracked) - touched} unchanged set to {unchanged_time}; "
        f"{moved} directories above a change set to now, {len(folders) - moved} set to {unchanged_time}",
    )
    for path in changed[:20]:
        print(f"{PREFIX}   changed {path}")
    return verify(target_dir)


def wrong_mtime(label: str, differs: bool, why: str, sha: str, recorded: int) -> str | None:
    """
    Describe a path whose mtime is not the one its content calls for, else None.
    """
    mtime = os.lstat(label.rstrip("/")).st_mtime
    if differs:
        if mtime <= recorded:
            return f"{label}: {why} differs from {sha} but its mtime {mtime:.0f} is not after {recorded}"
    elif int(mtime) != recorded - 1:
        return f"{label}: {why} is unchanged since {sha} but its mtime {mtime:.0f} is not {recorded - 1}"
    return None


def verify(target_dir: Path) -> int:
    marker = read_marker(target_dir)
    if marker is None:
        print(f"{PREFIX} verify: no source marker at {marker_path(target_dir)}", file=sys.stderr)
        return 1
    sha, recorded = marker
    before, after = tree(sha), tree("HEAD")
    wrong = [
        f"{path}: tracked but missing from the checkout"
        for path in after
        if not os.path.lexists(path)
    ]
    wrong += [
        wrong_mtime(path, before.get(path) != entry, "its content", sha, recorded)
        for path, entry in after.items()
        if os.path.lexists(path)
    ]
    differing = {
        path for path in before.keys() | after.keys() if before.get(path) != after.get(path)
    }
    above_differing = directories(differing)
    folders = directories(after)
    wrong += [
        wrong_mtime(f"{folder}/", folder in above_differing, "the tree below it", sha, recorded)
        for folder in sorted(folders)
    ]
    wrong = [line for line in wrong if line]
    if wrong:
        for line in wrong[:50]:
            print(f"{PREFIX} WRONG MTIME {line}", file=sys.stderr)
        print(
            f"{PREFIX} {len(wrong)} tracked path(s) would let cargo reuse or rebuild the wrong artifacts",
            file=sys.stderr,
        )
        return 1
    print(
        f"{PREFIX} verified {len(after)} tracked file(s) and {len(folders)} directories against {sha}, blob by blob",
    )
    return 0


def main() -> int:
    commands = {"record": record, "reuse": reuse, "verify": verify, "stash": stash, "prune": prune}
    if len(sys.argv) != 3 or sys.argv[1] not in commands:
        print(f"usage: {sys.argv[0]} {'|'.join(commands)} <target-dir>", file=sys.stderr)
        return 2
    return commands[sys.argv[1]](Path(sys.argv[2]))


if __name__ == "__main__":
    sys.exit(main())
