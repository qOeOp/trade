"""Pull successful public main builds into the isolated Web release plane.

The host service installs a reviewed copy of this module; it never executes deployment code from
the fetched checkout. Git and Docker use no existing credential configuration.
"""

import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

from .release_host import (
    AGENT,
    IMAGE_REF,
    LEGACY,
    REVISION,
    SOURCE,
    WEB,
    Config,
    DockerHost,
    durable_json,
    revision,
    sync_directory,
)


class GitSource:
    """Consume the append-only CI eligibility channel, not mutable image tags or host API credentials."""

    def __init__(self, state: Path):
        self.state = state
        self.repo = state / "source.git"

    def git(self, *args: str, check: bool = True) -> str:
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
        if check and result.returncode:
            raise RuntimeError(f"public git {args[0]} failed")
        return result.stdout.strip() if result.returncode == 0 else ""

    def refresh(self) -> None:
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not self.repo.exists():
            subprocess.run(["git", "init", "--bare", str(self.repo)], check=True, capture_output=True)
        self.git("config", "remote.origin.url", f"{SOURCE}.git")
        self.git("config", "remote.origin.promisor", "true")
        self.git("config", "remote.origin.partialclonefilter", "blob:none")
        self.git(
            "fetch",
            "--atomic",
            "--filter=blob:none",
            "origin",
            "refs/heads/main:refs/heads/main",
            "refs/heads/deploy-ready:refs/heads/deploy-ready",
        )

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

    def agent_changed(self, before: str, after: str) -> bool:
        if not self.ancestor(before, after):
            raise RuntimeError("Agent revision is not an ancestor of the candidate")
        paths = self.git("diff", "--no-renames", "--name-only", before, after).splitlines()
        return any(
            path == "deploy/Dockerfile"
            or not path.startswith(("ide/web/", "ide/overview/", "docs/", ".github/", "deploy/"))
            for path in paths
        )

    def approved(self) -> dict:
        self.refresh()
        value = json.loads(self.git("show", "refs/heads/deploy-ready:release.json"))
        if set(value) != {"revision", "image"} or not isinstance(value["revision"], str):
            raise RuntimeError("unrecognized CI eligibility record")
        sha = value["revision"]
        if not REVISION.fullmatch(sha) or not self.ancestor(sha, self.git("rev-parse", "refs/heads/main")):
            raise RuntimeError("CI eligibility subject is not on main")
        image = value["image"]
        if image is not None and (not isinstance(image, str) or not IMAGE_REF.fullmatch(image)):
            raise RuntimeError("CI eligibility has no exact native image identity")
        return value

    def choose(self, active: str, failed: Path) -> dict | None:
        target = self.approved()
        sha = target["revision"]
        if target["image"] is None or sha == active or (failed / sha).exists():
            return None
        return target if self.ancestor(active, sha) else None

    def ensure(self, target: dict) -> None:
        if self.approved() != target:
            raise RuntimeError("CI eligibility was withdrawn or superseded during preparation")


class Release:
    def __init__(self, host: DockerHost, github: GitSource):
        self.host = host
        self.github = github
        self.state = host.state
        self.transaction = self.state / "transaction.json"
        self.failed = self.state / "failed"

    def journal(self, candidate: str, previous: str, agent_before: str | None = "unchanged") -> dict:
        revision(candidate)
        if previous != LEGACY:
            self.host.checked(previous)
        transaction = {"candidate": candidate, "previous": previous}
        if agent_before != "unchanged":
            if agent_before is not None:
                self.host.checked(agent_before, AGENT)
            elif previous != LEGACY:
                raise RuntimeError("only initial adoption can have no previous standalone Agent")
            transaction["agent_before"] = agent_before
        durable_json(self.transaction, transaction)
        return transaction

    def clear(self) -> None:
        self.transaction.unlink()
        sync_directory(self.state)

    def mark_failed(self, candidate: str) -> None:
        self.failed.mkdir(exist_ok=True)
        # A failed or interrupted uncommitted attempt, not a verdict about strategy evidence.
        path = self.failed / revision(candidate)
        with path.open("w") as out:
            out.write("Release failed or was interrupted before commit; inspect the host service journal.\n")
            out.flush()
            os.fsync(out.fileno())
        sync_directory(self.failed)

    def known_routes(self, transaction: dict) -> None:
        allowed = {transaction["previous"], transaction["candidate"]}
        if self.host.live_route() not in allowed or self.host.disk_route() not in allowed:
            raise RuntimeError("router has an independent change; preserve transaction and stop")

    def recover(self) -> None:
        if not self.transaction.exists():
            return
        transaction = json.loads(self.transaction.read_text())
        candidate, previous = transaction["candidate"], transaction["previous"]
        sha = revision(candidate)
        if previous != LEGACY:
            self.host.checked(previous)
        self.known_routes(transaction)
        print(f"Rolling back uncommitted Web release {sha}", flush=True)
        if "agent_before" in transaction:
            before = transaction["agent_before"]
            after = f"{AGENT}{sha}"
            current = self.host.agent(allow_legacy=before is None)
            if current not in {None, before, after}:
                raise RuntimeError("Agent has an independent change; preserve transaction and stop")
            if self.host.exists(after):
                self.host.stop(after)
            if before is not None:
                self.host.start(before)
        self.host.start(previous)
        protected = self.host.protected()
        self.host.warm(previous, protected)
        self.known_routes(transaction)
        self.host.switch(previous)
        self.host.health(previous, self.host.lines(previous), routed=True)
        self.host.auth_denied()
        self.known_routes(transaction)
        if self.host.live_route() != previous:
            raise RuntimeError("rollback route changed during final probes; preserve transaction")
        self.host.persist_route(previous)
        self.mark_failed(candidate)
        self.clear()  # only a verified rollback commits removal of the recovery journal
        if self.host.exists(candidate):
            self.host.stop(candidate)
        print(f"Restored previous Web release {previous}", flush=True)

    def apply(self, target: dict) -> None:
        sha = target["revision"]
        candidate = f"{WEB}{sha}"
        previous = self.host.disk_route()
        if self.host.live_route() != previous:
            raise RuntimeError("disk and loaded router state disagree")
        if self.failed.joinpath(sha).exists():
            raise RuntimeError("this uncommitted revision is blocked from automatic retry")
        if previous != LEGACY and revision(previous) == sha:
            return
        agent = self.host.agent()
        if agent is None:
            raise RuntimeError("standalone Agent is missing; bootstrap or recover first")
        before = revision(agent, AGENT)
        change_agent = self.github.agent_changed(before, sha)
        protected = self.host.protected()
        # Free the previous standby before starting a third Web process. Retain every container/image.
        for name in self.host.managed(WEB, running_only=True):
            if name != previous:
                self.host.stop(name)
        if not self.host.memory_available():
            raise RuntimeError("insufficient candidate memory headroom; keep current release")
        image = self.host.pull(sha, target["image"])
        self.github.ensure(target)
        self.journal(candidate, previous, agent if change_agent else "unchanged")
        print(f"Preparing main Web release {sha}", flush=True)
        try:
            self.host.create(candidate, image)
            self.host.start(candidate)
            if change_agent:
                after = f"{AGENT}{sha}"
                self.host.create(after, image, agent=True)
                if self.host.agent() != agent:
                    raise RuntimeError("Agent changed during preparation; preserve independent replacement")
                self.host.stop(agent)
                if self.host.agent() is not None:
                    raise RuntimeError("Agent writer appeared during handoff")
                self.host.start(after)
            lines = self.host.warm(candidate, protected)
            self.github.ensure(target)
            self.known_routes({"candidate": candidate, "previous": previous})
            self.host.switch(candidate)
            self.host.observe(candidate, lines, protected)
            self.github.ensure(target)
            if self.host.live_route() != candidate or self.host.disk_route() != previous:
                raise RuntimeError("router changed before commit; preserve independent routing")
            if self.host.agent() != (f"{AGENT}{sha}" if change_agent else agent):
                raise RuntimeError("Agent changed before commit")
            self.host.ensure_protected(protected)
            self.host.persist_route(candidate)
            self.clear()
            print(f"Committed Web release {sha} as {image}", flush=True)
        except Exception:
            # If recovery itself fails, retain the journal and every side for the next invocation/operator.
            self.recover()
            raise

    def bootstrap(self) -> None:
        if self.host.disk_route() != LEGACY or self.host.live_route() != LEGACY:
            raise RuntimeError("bootstrap requires the unchanged legacy Web route")
        old = self.host.inspect(LEGACY)
        sha = old["revision"]
        if not REVISION.fullmatch(sha):
            raise RuntimeError("legacy IDE has no verified product revision")
        candidate = f"{WEB}{sha}"
        protected = self.host.protected()
        image = self.host.pull(sha, old["image"])
        transaction = self.journal(candidate, LEGACY, None)
        try:
            self.host.create(candidate, image)
            self.host.start(candidate)
            self.host.warm(candidate, protected, agent=False)
            self.known_routes(transaction)
            self.host.create(f"{AGENT}{sha}", image, agent=True)
            self.host.stop(LEGACY)  # end the old embedded Agent before starting the single new writer
            self.host.start(f"{AGENT}{sha}")
            lines = self.host.warm(candidate, protected)
            self.known_routes(transaction)
            self.host.switch(candidate)
            self.host.observe(candidate, lines, protected)
            if self.host.live_route() != candidate or self.host.disk_route() != LEGACY:
                raise RuntimeError("router changed before bootstrap commit")
            if self.host.agent() != f"{AGENT}{sha}":
                raise RuntimeError("Agent changed before bootstrap commit")
            self.host.ensure_protected(protected)
            self.host.persist_route(candidate)
            self.clear()
            print(f"Adopted legacy revision {sha}; automatic main releases can now start", flush=True)
        except Exception:
            self.recover()
            raise

    def tick(self) -> None:
        self.recover()
        active = self.host.disk_route()
        if active == LEGACY:
            raise RuntimeError("initial adoption has not completed")
        self.host.checked(active)
        target = self.github.choose(revision(active), self.failed)
        if target:
            self.apply(target)
        else:
            print(f"No newer successful main image; keeping {active}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "bootstrap", "tick"))
    args = parser.parse_args()
    config = Config()
    host = DockerHost(config)
    config.state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (config.state / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        host.prepare()
        release = Release(host, GitSource(config.state))
        if args.action == "prepare":
            if (config.state / "router/active.json").exists():
                raise RuntimeError("router configuration already exists; do not overwrite it")
            host.persist_route(LEGACY)
        elif args.action == "bootstrap":
            release.recover()
            release.bootstrap()
        else:
            release.tick()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Web release kept or rolled back: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
