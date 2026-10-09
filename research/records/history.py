"""Read explicitly archived Git bytes at one retained commit, without recovery writes.

The archive index locates Git-owned historical receipts and source evidence.
It never chooses a metadata backend, searches other revisions or fetches Git.
"""

from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

from research.records.common import RecordError


INDEX_PATH = "research/records/history.json"


def relative_path(value: str) -> str:
    if (not isinstance(value, str) or not value or any(ord(char) < 32 for char in value)
            or any(char in value for char in ("\\", ":", "*", "?", "["))):
        raise RecordError(f"invalid archived source path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or value == "." or ".." in path.parts or path.as_posix() != value:
        raise RecordError(f"invalid archived source path: {value!r}")
    return value


def _git(root: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)
    except OSError as exc:
        raise RecordError(f"fixed Git archive cannot be read: {exc}") from exc
    if result.returncode:
        raise RecordError("fixed Git archive is unavailable: " + result.stderr.decode(errors="replace").strip())
    return result.stdout


@dataclass(frozen=True)
class GitArchive:
    root: Path
    commit: str
    prefixes: tuple[str, ...]

    def allows(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self.prefixes)

    def paths(self, prefix: str) -> list[str]:
        relative_path(prefix.removesuffix("/"))
        if not prefix.endswith("/") or not self.allows(prefix):
            raise RecordError(f"fixed Git archive does not cover prefix: {prefix}")
        raw = _git(self.root, "ls-tree", "-r", "--name-only", "-z", self.commit, "--", prefix)
        try:
            return [item.decode("utf-8") for item in raw.split(b"\0") if item]
        except UnicodeDecodeError as exc:
            raise RecordError("fixed Git archive contains a non-UTF-8 path") from exc

    def read_bytes(self, path: str) -> bytes | None:
        path = relative_path(path)
        if not self.allows(path):
            return None
        entries = _git(self.root, "ls-tree", "-z", self.commit, "--", path).split(b"\0")
        entries = [entry for entry in entries if entry]
        if len(entries) != 1:
            raise RecordError(f"archived source is unavailable at {self.commit}: {path}")
        metadata, name = entries[0].split(b"\t", 1)
        mode, kind, _ = metadata.split()
        if name.decode("utf-8") != path or kind != b"blob" or mode not in (b"100644", b"100755"):
            raise RecordError(f"archived source is not a regular Git blob: {path}")
        return _git(self.root, "show", f"{self.commit}:{path}")


def load_archive(root: Path | None = None) -> GitArchive | None:
    if root is None:
        from research.records.common import ROOT
        root = ROOT
    root = Path(root).resolve()
    index = root / INDEX_PATH
    if index.is_symlink() or not index.resolve().is_relative_to(root):
        raise RecordError("fixed Git archive index must be a repository file")
    if not index.exists():
        return None
    try:
        value = json.loads(index.read_bytes())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecordError(f"cannot read fixed Git archive index: {exc}") from exc
    if (not isinstance(value, dict) or type(value.get("schema_version")) is not int
            or value["schema_version"] != 1):
        raise RecordError("unsupported fixed Git archive index")
    commit, prefixes = value.get("git_commit"), value.get("prefixes")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RecordError("fixed Git archive requires an exact 40-character commit")
    if (not isinstance(prefixes, list) or not prefixes or any(not isinstance(prefix, str) for prefix in prefixes)
            or len(set(prefixes)) != len(prefixes)):
        raise RecordError("fixed Git archive requires distinct source prefixes")
    for prefix in prefixes:
        if not isinstance(prefix, str) or not prefix.endswith("/"):
            raise RecordError("fixed Git archive prefixes must be relative directory paths")
        relative_path(prefix[:-1])
    if _git(root, "cat-file", "-t", commit).strip() != b"commit":
        raise RecordError("fixed Git archive anchor is not a commit")
    return GitArchive(root, commit, tuple(prefixes))


def read_archive_bytes(path: str, root: Path | None = None) -> bytes | None:
    archive = load_archive(root)
    return archive.read_bytes(path) if archive else None
