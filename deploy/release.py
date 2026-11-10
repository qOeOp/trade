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
import re
import subprocess
import sys

from .release_host import (
    AGENT,
    AHEAD,
    IMAGE_REF,
    SERVICE_REF,
    RUNTIME_REF,
    LEGACY,
    REVISION,
    SOURCE,
    WEB,
    Config,
    DockerHost,
    ahead,
    durable_json,
    revision,
    sync_directory,
)
from .runtime_inputs import DOCKERFILE, project


# What a Live control never loads and what cannot change one already running: the browser's and the other
# services' sources (in its image, never imported by `live`), and paths outside its build context
# (deploy/Dockerfile.dockerignore). A diff from the owner's revision touching only these keeps the control.
CONTROL_UNCHANGED = ("ide/web/", "ide/overview/", "ide/agent/", "docs/", "tests/", ".agents/", ".github/",
                     "deploy/remote/")
CONTROL_UNCHANGED_FILES = frozenset({"deploy/README.md", "deploy/compose.yaml"})
# The browser's contract with a Live control, read as text from a revision and never executed. Equal numbers
# let a Web serve beside an older control while Live is busy (docs/plans/live-web-first-release-20261108.zh.md).
PROTOCOL_FILE = "live/protocol.py"
PROTOCOL = re.compile(r"^PROTOCOL = ([1-9][0-9]*)$", re.MULTILINE)


def owners(transaction: dict) -> tuple[str | None, str]:
    """The (previous, candidate) owner revisions of a release transaction.

    A Web-only transaction names its unchanged owner; a paired one owns its candidate and names its
    previous owner only where that differs from the previous Web.
    """
    if "candidate_owner" in transaction:
        return transaction["candidate_owner"], transaction["candidate_owner"]
    previous = transaction["previous"]
    before = transaction.get("previous_owner") or (None if previous == LEGACY else revision(previous))
    return before, revision(transaction["candidate"])


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
        if message is None:
            return "unclassified runtime failure"
        if message.startswith("protected container changed during release: "):
            return "protected container changed"  # a ledger, Docker API or Paper container restarted mid-release
        return known.get(message, "unclassified runtime failure")
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

    def control_changed(self, before: str, after: str) -> bool:
        if not self.ancestor(before, after):
            raise RuntimeError("Live owner revision is not an ancestor of the candidate")
        paths = self.git("diff", "--no-renames", "--name-only", before, after).splitlines()
        return any(
            not (path.startswith(CONTROL_UNCHANGED) or path in CONTROL_UNCHANGED_FILES
                 or ("/" not in path and path.endswith(".md")))
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

    def protocol(self, sha: str) -> int | None:
        """The revision's declared browser-control protocol, or None when it has no declaration.

        A declaration that is not one plain line is a ValueError; a failed read raises as any Git failure."""
        if not REVISION.fullmatch(sha):
            raise RuntimeError("invalid protocol revision")
        if not self.git("ls-tree", "--name-only", sha, "--", PROTOCOL_FILE).strip():
            return None
        found = PROTOCOL.findall(self.git("show", f"{sha}:{PROTOCOL_FILE}", raw=True))
        if len(found) != 1:
            raise ValueError("the browser protocol declaration is not one plain line")
        return int(found[0])

    def choose(self, active: str, failed: Path, again: bool = False) -> dict | None:
        """The admitted record newer than `active`; with `again` (its Web runs ahead of its control) also
        the record of `active` itself, to pair that revision's own control."""
        target = self.approved()
        sha = target["revision"]
        if target["image"] is None or sha == active and not again or (failed / sha).exists():
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

    def journal(self, candidate: str, previous: str, agent_before: str | None = "unchanged",
                owner: dict[str, str] | None = None) -> dict:
        revision(candidate)
        if previous != LEGACY:
            self.host.checked(previous)
        transaction: dict[str, str | None] = {"candidate": candidate, "previous": previous, **(owner or {})}
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

    def routed(self, owner: str | None) -> str | None:
        """The owner a route is written with: none without Live."""
        return owner if self.live is not None else None

    def known_routes(self, transaction: dict) -> None:
        allowed = {transaction["previous"], transaction["candidate"]}
        if self.host.live_route() not in allowed or self.host.disk_route() not in allowed:
            raise RuntimeError("router has an independent change; preserve transaction and stop")
        if self.live is not None:
            before, after = owners(transaction)
            pairs = {(transaction["previous"], before), (transaction["candidate"], after)}
            if ((self.host.live_route(), self.host.live_owner()) not in pairs
                    or (self.host.disk_route(), self.host.disk_owner()) not in pairs):
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
        owner, _ = owners(transaction)
        self.require_live_installation(previous)
        if self.live is None and self.host.exists(candidate):
            self.require_live_installation(candidate)
        sha = revision(candidate)
        if previous != LEGACY:
            self.host.checked(previous)
        self.known_routes(transaction)
        print(f"Rolling back uncommitted Web release {sha}", flush=True)
        if self.live is not None:
            self.live.restore(previous, owner)
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
        self.host.switch(previous, self.routed(owner))
        self.host.health(previous, self.host.lines(previous), routed=True)
        self.host.auth_denied()
        self.known_routes(transaction)
        if self.host.live_route() != previous:
            raise RuntimeError("rollback route changed during final probes; preserve transaction")
        agent = self.host.agent(allow_legacy=previous == LEGACY)
        # A Web-only candidate never owned the account and has no control or configuration of its own.
        barrier = (self.live.barrier(candidate, wait_for_lock=True)
                   if self.live is not None and "candidate_owner" not in transaction else nullcontext(lambda: None))
        with barrier as held:
            held()
            self.known_routes(transaction)
            if self.host.live_route() != previous:
                raise RuntimeError("rollback route changed during final probes; preserve transaction")
            if self.host.agent(allow_legacy=previous == LEGACY) != agent:
                raise RuntimeError("Agent changed during rollback admission")
            self.host.ensure_protected(protected)
            held()
            self.host.persist_route(previous, self.routed(owner))
            self.mark_failed(candidate)
            self.clear()  # only a verified rollback commits removal of the recovery journal
        if self.host.exists(candidate):
            self.host.stop(candidate)
        self.retire_live()
        print(f"Restored previous Web release {previous}", flush=True)

    def cleared(self, previous: str, beside_live: bool) -> bool:
        """Before a journal that brings no control (no Live installed, or a Web beside the owner's control):
        stop stale Webs and check headroom. False keeps the current Web; a paired release does this inside
        its account admission instead."""
        for name in self.host.managed(WEB, running_only=True):
            if name != previous:
                self.host.stop(name)
        if self.host.memory_available():
            return True
        if not beside_live:
            raise RuntimeError("insufficient candidate memory headroom; keep current release")
        print("Insufficient memory headroom beside Live; keeping the current Web", flush=True)
        return False

    def kept_ahead(self, owner: str | None, sha: str, previous: str) -> str | None:
        """Why the candidate's Web cannot serve ahead of the owner's control while Live is busy; None if it can."""
        if owner is None:
            return "no owner control to serve beside"
        if previous == f"{WEB}{sha}{AHEAD}":
            return "this revision already serves ahead of it"
        try:
            mine, theirs = self.github.protocol(sha), self.github.protocol(owner)
        except ValueError:
            return "a browser protocol is malformed"
        if mine is None or theirs is None:
            return "a browser protocol is undeclared"
        if mine != theirs:
            return f"the owner's browser protocol {theirs} differs from {mine}"
        return None

    def apply(self, target: dict) -> None:
        sha = target["revision"]
        candidate = f"{WEB}{sha}"
        previous = self.host.disk_route()
        self.require_live_installation(previous)
        if self.host.live_route() != previous:
            raise RuntimeError("disk and loaded router state disagree")
        if self.failed.joinpath(sha).exists():
            raise RuntimeError("this uncommitted revision is blocked from automatic retry")
        if previous != LEGACY and revision(previous) == sha and not ahead(previous):
            return
        agent = self.host.agent()
        if agent is None:
            raise RuntimeError("standalone Agent is missing; bootstrap or recover first")
        before = revision(agent, AGENT)
        change_agent = self.github.agent_changed(before, sha)
        protected = self.host.protected()
        # Paired: the candidate brings its own control and takes the account, only while Live is idle.
        # Web-only: nothing the owner control runs changed, so the candidate mounts the owner's socket
        # and the account's owner, lock and runs stay as they are, busy or not.
        owner = self.host.disk_owner() if self.live is not None and self.host.requires_live(previous) else None
        if owner is not None and self.host.live_owner() != owner:
            raise RuntimeError("disk and loaded router state disagree")
        # A changed Live declaration also pairs: only a new control reads it. The owner's control refuses
        # every new effect against it, its idle inspection included, so the candidate's inspection answers.
        current = owner is None or self.live.current(owner)
        web_only = owner is not None and not self.github.control_changed(owner, sha) and current
        paired = self.live is not None and not web_only
        if not paired and not self.cleared(previous, web_only):
            return
        from .live_host import AccountLockBusy, LiveBusy

        if paired and owner is not None and current:
            # Ask the owner's control whether Live is busy before preparing anything for the candidate, so
            # a revision waiting to pair costs one inspection per tick. A held account lock is no answer.
            # Not current: the candidate is prepared each waiting tick and its own inspection answers.
            try:
                with self.live.barrier(WEB + owner, idle=True):
                    pass
            except AccountLockBusy:
                print("A Live operation holds the account lock; keeping the current Web/control pair", flush=True)
                return
            except LiveBusy:
                # Web first: the candidate's Web serves beside the owner's control, which keeps the account;
                # its own control pairs once Live is idle. Only where both declare one browser protocol.
                kept = self.kept_ahead(owner, sha, previous)
                if kept:
                    print(f"Live is active or unresolved; keeping the current Web/control pair ({kept})", flush=True)
                    return
                candidate, web_only, paired = f"{WEB}{sha}{AHEAD}", True, False
                if not self.cleared(previous, True):
                    return
        image = self.host.pull(sha, target["image"])
        self.github.ensure(target)
        agent_before = agent if change_agent else "unchanged"
        if web_only:
            control = WEB + owner
            self.live.health(control)
            identity = self.live.checked(control)["id"]
            transaction = self.journal(candidate, previous, agent_before, {"candidate_owner": owner})
        elif paired:
            # From a Web-only state the previous control is the owner's, not the previous Web's.
            self.live.prepare(owner, target)
            moved = {} if owner is None or owner == revision(previous) else {"previous_owner": owner}
            try:
                with self.live.barrier(candidate, target["service"], idle=True) as held:
                    held()
                    self.github.ensure(target)
                    transaction = self.journal(candidate, previous, agent_before, moved)
            except LiveBusy as busy:
                print(f"{busy}; the next tick asks again", flush=True)  # it became busy since the owner was asked
                return
        else:
            transaction = self.journal(candidate, previous, agent_before)
        after = owner if web_only else sha
        print(f"Preparing main Web release {sha}" + (
            f" ahead of Live control {owner}" if ahead(candidate) else
            " beside the unchanged Live control" if web_only else ""), flush=True)
        try:
            if paired:
                for name in self.host.managed(WEB, running_only=True):
                    if name != previous:
                        self.host.stop(name)
                if not self.host.memory_available():
                    raise RuntimeError("insufficient candidate memory headroom; keep current release")
                self.live.create(candidate, target["service"])
                self.live.start(candidate)
                self.live.warm(candidate)
                self.host.create(candidate, image, live_socket=self.live.socket(candidate))
            elif web_only:
                self.host.create(candidate, image, live_socket=self.live.socket(WEB + owner))
            else:
                self.host.create(candidate, image)
            self.host.start(candidate)
            if change_agent:
                replacement = f"{AGENT}{sha}"
                self.host.create(replacement, image, agent=True)
                if self.host.agent() != agent:
                    raise RuntimeError("Agent changed during preparation; preserve independent replacement")
                self.host.stop(agent)
                if self.host.agent() is not None:
                    raise RuntimeError("Agent writer appeared during handoff")
                self.host.start(replacement)
            lines = self.host.warm(candidate, protected)
            self.github.ensure(target)
            self.known_routes(transaction)
            self.host.switch(candidate, self.routed(after))
            self.host.observe(candidate, lines, protected)
            if self.live is not None:
                self.live.health(WEB + after)
            self.github.ensure(target)

            def unchanged(final: bool) -> None:
                if (self.host.live_route() != candidate or self.host.disk_route() != previous
                        or self.live is not None and self.host.live_owner() != after):
                    raise RuntimeError("router changed during final account admission" if final
                                       else "router changed before commit; preserve independent routing")
                if self.host.agent() != (f"{AGENT}{sha}" if change_agent else agent):
                    raise RuntimeError("Agent changed during final account admission" if final else "Agent changed before commit")
                if web_only and self.live.checked(WEB + owner)["id"] != identity:
                    raise RuntimeError("Live owner control changed during a Web-only release")
                self.host.ensure_protected(protected)

            unchanged(False)
            barrier = (self.live.barrier(candidate, idle=True, wait_for_lock=True)
                       if paired else nullcontext(lambda: None))
            with barrier as held:
                held()
                self.github.ensure(target)
                unchanged(True)
                held()
                self.host.persist_route(candidate, self.routed(after))
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
            self.host.switch(candidate, None)
            self.host.observe(candidate, lines, protected)
            if self.host.live_route() != candidate or self.host.disk_route() != LEGACY:
                raise RuntimeError("router changed before bootstrap commit")
            if self.host.agent() != f"{AGENT}{sha}":
                raise RuntimeError("Agent changed before bootstrap commit")
            self.host.ensure_protected(protected)
            self.host.persist_route(candidate, None)
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
            runtimes: set[str] = set()
            prefixes: tuple[str, ...] = (WEB, AGENT)
            revisions = {path.name for path in self.failed.iterdir()} if self.failed.exists() else set()
            failed = {prefix + sha for sha in revisions for prefix in prefixes} | {WEB + sha + AHEAD for sha in revisions}
            if (self.state / "paper-router/active.json").exists():
                # Only here: a host without the Paper extension has no paper_host installed.
                from .paper_host import PAPER, PaperHost, runtime_default

                active.add(PaperHost(self.host.config).disk_route())
                prefixes += (PAPER,)
                runtimes |= {runtime_default(json.loads(self.host.docker("inspect", "--format", "{{json .Config.Cmd}}", name)))
                             for name in self.host.managed(PAPER)}
                paper = self.state / "paper-failed"
                if paper.exists():
                    failed |= {PAPER + path.name for path in paper.iterdir()}
            kept = self.live_kept() if self.live is not None else None
            if kept is not None:
                from .live_host import LIVE

                prefixes += (LIVE,)
                active |= {LIVE + sha for sha in kept}
                failed |= {LIVE + sha for sha in revisions}
            if self.live is not None:
                runtimes |= self.live.runtimes()  # read before its directories are pruned
            self.host.prune(prefixes, active, failed, runtimes)
            if kept is not None:
                self.live.prune(kept)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("cleanup", error)

    def live_kept(self) -> set[str] | None:
        """Revisions whose Live controller and directory survive a prune: the account's owner (a restore
        starts it again, however old) and every Web still here (it mounts a socket; a return by hand needs
        its control). None, which prunes no Live controller, unless both owners read."""
        try:
            owners = {self.host.disk_owner(), self.host.live_owner()}
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("cleanup", error)
            return None
        webs = self.host.managed(WEB)
        sockets = self.host.mounted_sockets(set(webs))
        return {sha for sha in owners if sha} | {revision(name) for name in webs} | {path.parent.name for path in sockets}

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
            self.live.restore(active, self.host.disk_owner())
        target = self.github.choose(revision(active), self.failed, again=ahead(active))
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
            host.persist_route(LEGACY, None)
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
