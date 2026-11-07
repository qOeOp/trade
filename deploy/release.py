"""Pull successful public main builds into the isolated Web release plane.

The host service installs a reviewed copy of this module; it never executes deployment code from
the fetched checkout. Git and Docker use no existing credential configuration.
"""

import argparse
from contextlib import nullcontext
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

from .release_host import (
    AGENT,
    IMAGE_REF,
    SERVICE_REF,
    RUNTIME_REF,
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
from .runtime_inputs import DOCKERFILE, project


def failure_summary(error: Exception) -> str:
    """Only fixed classifications cross the journal boundary; exception payloads stay private."""
    from .live_host import AccountLockBusy, AccountLockWaitExpired, LiveBusy

    if isinstance(error, AccountLockWaitExpired):
        return "account lock wait expired"
    if isinstance(error, AccountLockBusy):
        return "account lock occupied"
    if isinstance(error, LiveBusy):
        return "Live account admission unavailable"
    if isinstance(error, subprocess.TimeoutExpired):
        return "external operation timed out"
    if isinstance(error, subprocess.CalledProcessError):
        return "external operation failed"
    if isinstance(error, OSError):
        return "filesystem or operating-system operation failed"
    if isinstance(error, AssertionError):
        return "invariant check failed"
    if isinstance(error, (ValueError, KeyError, TypeError)):
        return "release metadata unavailable"
    if type(error) is RuntimeError:
        known = {
            "CI eligibility was withdrawn or superseded during preparation": "CI eligibility changed",
            "Live idle observation is unavailable": "Live idle observation unavailable",
            "Live custody path changed during release": "Live custody identity changed",
            "Live account lock identity changed during release": "Live account lock identity changed",
            "router has an independent change; preserve transaction and stop": "router identity changed",
            "router changed before commit; preserve independent routing": "router identity changed",
            "router changed during final account admission": "router identity changed",
            "rollback route changed during final probes; preserve transaction": "rollback router identity changed",
            "Agent changed before commit": "Agent identity changed",
            "Agent changed during final account admission": "Agent identity changed",
            "Agent changed during rollback admission": "rollback Agent identity changed",
        }
        message = error.args[0] if len(error.args) == 1 and type(error.args[0]) is str else None
        return known.get(message, "unclassified runtime failure") if message is not None else "unclassified runtime failure"
    return "unexpected release failure"


def report_failure(phase: str, error: Exception) -> None:
    labels = {"primary": "Primary Web release failure", "recovery": "Web release recovery failure",
              "retired": "Retired Live controller retained", "cleanup": "Release cleanup skipped"}
    try:
        print(f"{labels.get(phase, 'Web release kept or rolled back')}: {failure_summary(error)}",
              file=sys.stderr, flush=True)
    except (OSError, ValueError):
        pass  # A closed diagnostic stream must not prevent transaction recovery.


class GitSource:
    """Consume the append-only CI eligibility channel, not mutable image tags or host API credentials."""

    def __init__(self, state: Path):
        self.state = state
        self.repo = state / "source.git"

    def git(self, *args: str, check: bool = True, raw: bool = False) -> str:
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
        return (result.stdout if raw else result.stdout.strip()) if result.returncode == 0 else ""

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
        if set(value) not in ({"revision", "image"}, {"revision", "image", "service", "runtime"}) or not isinstance(
            value["revision"], str
        ):
            raise RuntimeError("unrecognized CI eligibility record")
        sha = value["revision"]
        if not REVISION.fullmatch(sha) or not self.ancestor(sha, self.git("rev-parse", "refs/heads/main")):
            raise RuntimeError("CI eligibility subject is not on main")
        image = value["image"]
        if image is not None and (not isinstance(image, str) or not IMAGE_REF.fullmatch(image)):
            raise RuntimeError("CI eligibility has no exact native image identity")
        for field, pattern in (("service", SERVICE_REF), ("runtime", RUNTIME_REF)):
            ref = value.get(field)
            if ref is not None and (not isinstance(ref, str) or not pattern.fullmatch(ref)):
                raise RuntimeError(f"CI eligibility has no exact {field} identity")
        if "service" in value and image is not None and (value["service"] is None or value["runtime"] is None):
            raise RuntimeError("admitted Web release has no admitted execution images")
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
    def __init__(self, host: DockerHost, github: GitSource, live=None):
        self.host = host
        self.github = github
        self.state = host.state
        self.transaction = self.state / "transaction.json"
        self.failed = self.state / "failed"
        self.live = live
        if self.live is None and os.path.lexists(self.state / "live/configuration.json"):
            from .live_host import LiveHost

            self.live = LiveHost(host, github)

    def require_live_installation(self, name: str) -> None:
        if self.live is None and self.host.requires_live(name):
            raise RuntimeError("installed Live configuration is missing; retain the existing Web/control pair")

    def retire_live(self) -> None:
        if self.live is not None:
            try:
                self.live.retire()
            except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
                report_failure("retired", error)

    def journal(self, candidate: str, previous: str, agent_before: str | None = "unchanged") -> dict:
        revision(candidate)
        if previous != LEGACY:
            self.host.checked(previous)
        transaction: dict[str, str | None] = {"candidate": candidate, "previous": previous}
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
        try:
            self._recover()
        except Exception as error:
            report_failure("recovery", error)
            raise

    def _recover(self) -> None:
        if not self.transaction.exists():
            return
        transaction = json.loads(self.transaction.read_text())
        candidate, previous = transaction["candidate"], transaction["previous"]
        self.require_live_installation(previous)
        if self.live is None and self.host.exists(candidate):
            self.require_live_installation(candidate)
        sha = revision(candidate)
        if previous != LEGACY:
            self.host.checked(previous)
        self.known_routes(transaction)
        print(f"Rolling back uncommitted Web release {sha}", flush=True)
        if self.live is not None:
            self.live.restore(previous)
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
        agent = self.host.agent(allow_legacy=previous == LEGACY)
        barrier = (self.live.barrier(candidate, wait_for_lock=True)
                   if self.live is not None else nullcontext(lambda: None))
        with barrier as held:
            held()
            self.known_routes(transaction)
            if self.host.live_route() != previous:
                raise RuntimeError("rollback route changed during final probes; preserve transaction")
            if self.host.agent(allow_legacy=previous == LEGACY) != agent:
                raise RuntimeError("Agent changed during rollback admission")
            self.host.ensure_protected(protected)
            held()
            self.host.persist_route(previous)
            self.mark_failed(candidate)
            self.clear()  # only a verified rollback commits removal of the recovery journal
        if self.host.exists(candidate):
            self.host.stop(candidate)
        self.retire_live()
        print(f"Restored previous Web release {previous}", flush=True)

    def apply(self, target: dict) -> None:
        sha = target["revision"]
        candidate = f"{WEB}{sha}"
        previous = self.host.disk_route()
        self.require_live_installation(previous)
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
        if self.live is None:
            # Preserve the existing Web-only ordering; Live first admits the account before lifecycle effects.
            for name in self.host.managed(WEB, running_only=True):
                if name != previous:
                    self.host.stop(name)
            if not self.host.memory_available():
                raise RuntimeError("insufficient candidate memory headroom; keep current release")
        image = self.host.pull(sha, target["image"])
        self.github.ensure(target)
        if self.live is not None:
            from .live_host import LiveBusy

            self.live.prepare(previous, target)
            try:
                with self.live.barrier(candidate, target["service"], idle=True) as held:
                    held()
                    self.github.ensure(target)
                    self.journal(candidate, previous, agent if change_agent else "unchanged")
            except LiveBusy:
                print("Live is active or unresolved; keeping the current Web/control pair", flush=True)
                return
        else:
            self.journal(candidate, previous, agent if change_agent else "unchanged")
        print(f"Preparing main Web release {sha}", flush=True)
        try:
            if self.live is not None:
                for name in self.host.managed(WEB, running_only=True):
                    if name != previous:
                        self.host.stop(name)
                if not self.host.memory_available():
                    raise RuntimeError("insufficient candidate memory headroom; keep current release")
                self.live.create(candidate, target["service"])
                self.live.start(candidate)
                self.live.warm(candidate)
                self.host.create(candidate, image, live_socket=self.live.socket(candidate))
            else:
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
            if self.live is not None:
                self.live.health(candidate)
            self.github.ensure(target)
            if self.host.live_route() != candidate or self.host.disk_route() != previous:
                raise RuntimeError("router changed before commit; preserve independent routing")
            if self.host.agent() != (f"{AGENT}{sha}" if change_agent else agent):
                raise RuntimeError("Agent changed before commit")
            self.host.ensure_protected(protected)
            barrier = (self.live.barrier(candidate, idle=True, wait_for_lock=True)
                       if self.live is not None else nullcontext(lambda: None))
            with barrier as held:
                held()
                self.github.ensure(target)
                if self.host.live_route() != candidate or self.host.disk_route() != previous:
                    raise RuntimeError("router changed during final account admission")
                if self.host.agent() != (f"{AGENT}{sha}" if change_agent else agent):
                    raise RuntimeError("Agent changed during final account admission")
                self.host.ensure_protected(protected)
                held()
                self.host.persist_route(candidate)
                self.clear()
            print(f"Committed Web release {sha} as {image}", flush=True)
        except Exception as error:
            # If recovery itself fails, retain the journal and every side for the next invocation/operator.
            report_failure("primary", error)
            self.recover()
            raise
        self.retire_live()

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

    def prune(self) -> None:
        """Housekeeping after a settled tick: it must never fail or undo a release."""
        if self.transaction.exists() or (self.state / "paper-transaction.json").exists():
            return
        try:
            active = {self.host.disk_route()}
            prefixes: tuple[str, ...] = (WEB, AGENT)
            revisions = {path.name for path in self.failed.iterdir()} if self.failed.exists() else set()
            failed = {prefix + sha for sha in revisions for prefix in prefixes}
            if (self.state / "paper-router/active.json").exists():
                # Only here: a host without the Paper extension has no paper_host installed.
                from .paper_host import PAPER, PaperHost

                active.add(PaperHost(self.host.config).disk_route())
                prefixes += (PAPER,)
                paper = self.state / "paper-failed"
                if paper.exists():
                    failed |= {PAPER + path.name for path in paper.iterdir()}
            self.host.prune(prefixes, active, failed)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("cleanup", error)

    def tick(self) -> None:
        if (self.state / "paper-router/active.json").exists():
            from .paper_release import PaperRelease
            from .paper_host import PaperHost

            PaperRelease(PaperHost(self.host.config), self.github).recover()
        self.recover()
        active = self.host.disk_route()
        if active == LEGACY:
            raise RuntimeError("initial adoption has not completed")
        self.host.checked(active)
        self.require_live_installation(active)
        if self.live is not None and self.host.requires_live(active):
            self.live.restore(active)
        target = self.github.choose(revision(active), self.failed)
        if target:
            self.apply(target)
        else:
            print(f"No newer successful main image; keeping {active}", flush=True)
        if (self.state / "paper-router/active.json").exists():
            PaperRelease(PaperHost(self.host.config), self.github).tick()
        self.retire_live()
        self.prune()


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
        report_failure("release", error)
        raise SystemExit(1) from error
