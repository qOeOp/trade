"""The public CI eligibility channel the release reads: `deploy-ready`, through public Git only (deploy/release.py)."""

import json
import os
from pathlib import Path
import re
import subprocess

from .release_host import IMAGE_REF, REVISION, RUNTIME_REF, SERVICE_REF, SOURCE
from .runtime_inputs import DOCKERFILE, project


# What a version's deploy/compose.yaml pins docker-api to, with or without TRADE_DOCKER_API_IMAGE around it.
DOCKER_API_PIN = re.compile(r"ghcr\.io/qoeop/trade-docker-api@sha256:[0-9a-f]{64}")


class SourceUnreachable(RuntimeError):
    """A public git command against GitHub failed: `command` names it, never its output. `first` is set on a fetch
    whose previous fetch succeeded: a brief GitHub outage fails one tick and the next fetch succeeds (production,
    2026-11-19), so only a second failure in a row is noticed."""

    def __init__(self, command: str):
        super().__init__(f"public git {command} failed")
        self.command = command
        self.first = False


class GitSource:
    """Consume the append-only CI eligibility channel, not mutable image tags or host API credentials."""

    def __init__(self, state: Path):
        self.state = state
        self.repo = state / "source.git"

    def git(self, *args: str, raw: bool = False) -> str:
        env = {
            "PATH": os.defpath,
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0",
        }
        result = subprocess.run(
            ["git", "-c", "credential.helper=", "--git-dir", str(self.repo), *args],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode:
            raise SourceUnreachable(args[0])
        return result.stdout if raw else result.stdout.strip()

    def refresh(self) -> None:
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not self.repo.exists():
            subprocess.run(["git", "init", "--bare", str(self.repo)], check=True, capture_output=True)
        self.git("config", "remote.origin.url", f"{SOURCE}.git")
        self.git("config", "remote.origin.promisor", "true")
        self.git("config", "remote.origin.partialclonefilter", "blob:none")
        # git empties FETCH_HEAD when a fetch starts and fills it only when the fetch gets the refs, so a non-empty
        # one says the previous fetch succeeded.
        head = self.repo / "FETCH_HEAD"
        succeeded = head.exists() and head.stat().st_size > 0
        try:
            self.git(
                "fetch",
                "--atomic",
                "--filter=blob:none",
                "origin",
                "refs/heads/main:refs/heads/main",
                "refs/heads/deploy-ready:refs/heads/deploy-ready",
            )
        except SourceUnreachable as error:
            error.first = succeeded
            raise

    def ancestor(self, before: str, after: str) -> bool:
        if not REVISION.fullmatch(before) or not REVISION.fullmatch(after):
            return False
        result = subprocess.run(
            ["git", "--git-dir", str(self.repo), "merge-base", "--is-ancestor", before, after],
            capture_output=True,
            timeout=30,
            check=False,
        )
        return result.returncode == 0

    def docker_api(self, sha: str) -> str:
        """The docker-api digest `sha`'s deploy/compose.yaml pins: a version's proxy, which CI does not admit."""
        if not REVISION.fullmatch(sha):
            raise RuntimeError("invalid docker-api revision")
        pins = set(DOCKER_API_PIN.findall(self.git("show", f"{sha}:deploy/compose.yaml")))
        if len(pins) != 1:
            raise RuntimeError("the version pins no single docker-api digest")
        return pins.pop()

    def runtime_inputs(self, sha: str) -> tuple:
        if not REVISION.fullmatch(sha):
            raise RuntimeError("invalid runtime input revision")
        entries = []
        for row in self.git("ls-tree", "-r", "-z", sha, raw=True).split("\0"):
            if row:
                facts, path = row.split("\t", 1)
                mode, kind, identity = facts.split(" ")
                entries.append({"path": path, "mode": mode, "type": kind, "sha": identity})
        return project(entries, self.git("show", f"{sha}:{DOCKERFILE}", raw=True))

    def require_runtime(self, runtime_source: str, target: str) -> None:
        """The OCI label was checked by the consumer; now bind its inputs to the target."""
        if not self.ancestor(runtime_source, target):
            raise RuntimeError("admitted runtime is not an ancestor of its service source")
        if self.runtime_inputs(runtime_source) != self.runtime_inputs(target):
            raise RuntimeError("admitted runtime build inputs do not match its service source")

    def approved(self) -> dict:
        self.refresh()
        value = json.loads(self.git("show", "refs/heads/deploy-ready:release.json"))
        if set(value) != {"revision", "image", "service", "runtime"} or not isinstance(value["revision"], str):
            raise RuntimeError("unrecognized CI eligibility record")
        sha = value["revision"]
        if not REVISION.fullmatch(sha) or not self.ancestor(sha, self.git("rev-parse", "refs/heads/main")):
            raise RuntimeError("CI eligibility subject is not on main")
        image = value["image"]
        if image is not None and (not isinstance(image, str) or not IMAGE_REF.fullmatch(image)):
            raise RuntimeError("CI eligibility has no exact native image identity")
        for field, pattern in (("service", SERVICE_REF), ("runtime", RUNTIME_REF)):
            ref = value[field]
            if ref is not None and (not isinstance(ref, str) or not pattern.fullmatch(ref)):
                raise RuntimeError(f"CI eligibility has no exact {field} identity")
        if image is not None and (value["service"] is None or value["runtime"] is None):
            raise RuntimeError("admitted Web release has no admitted execution images")
        return value

    def choose(self, active: str, failed: Path) -> dict | None:
        """The admitted record newer than `active`."""
        target = self.approved()
        sha = target["revision"]
        if target["image"] is None or sha == active or (failed / sha).exists():
            return None
        return target if self.ancestor(active, sha) else None

    def ensure(self, target: dict) -> None:
        if self.approved() != target:
            raise RuntimeError("CI eligibility was withdrawn or superseded during preparation")
