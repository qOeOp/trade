"""Pull admitted versions into the isolated Web release plane: the public `deploy-ready` channel, which CI moves
only for the commit of the newest version tag (`main-ready`, every checked main build, is staging and never read here).

The host runs only the control code inside the CI-built, digest-pinned service image `deploy-ready` names: each
version's own control releases it (deploy/control.py). Git and Docker use no existing credential configuration.
"""

import argparse
import contextlib
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback

from .control import HANDOFF, hand_off, running
from .generation import Generation
from .live_host import LIVE, AccountLockBusy, AccountLockWaitExpired, LiveBusy, LiveHost
from .paper_host import PAPER, PaperHost
from .paper_release import PaperRelease
from .release_host import (
    AGENT,
    DockerFailure,
    HostCondition,
    ReaderFailure,
    IMAGE_REF,
    SERVICE_REF,
    RUNTIME_REF,
    WEB,
    Config,
    DockerHost,
    JOURNAL_FORMAT,
    durable_json,
    read_journal,
    revision,
    sync_directory,
)
from .notices import Notices
from .services import Follow, drift, settled
from .source import GitSource, SourceUnreachable


KINDS = (WEB, AGENT, PAPER, LIVE)  # the release containers of a version, pruned alike


def source_line(error: BaseException, outside: str | None = None) -> str | None:
    """The innermost product source line the exception passed outside the function named `outside`."""
    root = Path(__file__).resolve().parent.parent
    where = None
    for frame, line in traceback.walk_tb(error.__traceback__):
        path = Path(frame.f_code.co_filename).resolve()
        if path.is_relative_to(root) and "site-packages" not in path.parts and frame.f_code.co_name != outside:
            where = f"{path.relative_to(root)}:{line}"
    return where


def failure_origin(error: BaseException) -> str:
    """The exception class and the innermost product source line it passed, never its payload."""
    kind = type(error)
    name = kind.__qualname__ if kind.__module__ == "builtins" else f"{kind.__module__}.{kind.__qualname__}"
    where = source_line(error)
    return f"{name} at {where}" if where else name


def failure_summary(error: Exception) -> str:
    """Only fixed classifications and code identity cross the journal boundary; exception payloads
    stay private. An unclassified failure names its class and source line so the operator can find
    it without rerunning the release under a traceback wrapper."""
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
    if isinstance(error, ReaderFailure):  # doctor 20261117-02: which reader, which path, what it answered
        return f"{error.reader} unhealthy at {error.path}: {error.answer}"
    if isinstance(error, SourceUnreachable):
        return f"GitHub source unreachable (public git {error.command} failed)"
    if isinstance(error, DockerFailure):  # its stderr can quote what a container printed
        return f"docker {error.command} exited {error.status} (called at {source_line(error, 'docker')})"
    if isinstance(error, (ValueError, KeyError, TypeError)):
        return "release metadata unavailable"
    if type(error) in (RuntimeError, HostCondition):
        known = {
            "CI eligibility was withdrawn or superseded during preparation": "CI eligibility changed",
            "Live idle observation is unavailable": "Live idle observation unavailable",
            "Live custody path changed during release": "Live custody identity changed",
            "Live account lock identity changed during release": "Live account lock identity changed",
            "Live custody root differs from its product installation": "Live custody root differs",
            "router has an independent change; preserve transaction and stop": "router identity changed",
            "router changed before commit; preserve independent routing": "router identity changed",
            "router changed during final account admission": "router identity changed",
            "rollback route changed during final probes; preserve transaction": "rollback router identity changed",
            "Agent changed before commit": "Agent identity changed",
            "Agent changed during final account admission": "Agent identity changed",
            "Agent changed during rollback admission": "rollback Agent identity changed",
            "compose services did not move; previous images restored": "service move failed and was undone",
            "compose services did not move nor return; left for the operator": "service move and its undo failed",
            # DockerHost.memory_available refused (doctor 20261116-05): nothing was journaled, the next tick asks again.
            "insufficient memory for a standby Paper controller":
                "host memory below the 2 GiB a standby Paper controller needs; the release waits",
            "insufficient candidate memory headroom; keep current release":
                "host memory below the 2 GiB a candidate Web needs; the release waits",
            JOURNAL_FORMAT: "pending journal not in this control's format",
            # deploy/generation.py: the cutover's journal stays and the next tick goes on from its step.
            "the new data generation's ledger is not the version's schema generation":
                "the new data generation's ledger does not hold the version's schema generation",
            "a data generation cutover is pending for another version; left for the operator":
                "data generation cutover pending for another version",
            "a data generation cutover is pending for another line; left for the operator":
                "data generation cutover pending for another line",
            "the moved mirror does not follow the research repository":
                "the moved mirror does not follow the research repository",
            "a pending release transaction waits for an admitted control": "pending journal waits for a control",
        }
        message = error.args[0] if len(error.args) == 1 and type(error.args[0]) is str else None
        if message is None:
            return f"unclassified runtime failure ({failure_origin(error)})"
        if message.startswith("protected container changed during release: "):
            return "protected container changed"  # a ledger, Docker API or Paper container restarted mid-release
        if message.startswith("compose service did not start on its image: "):  # DockerHost.recreate: a fixed name
            return f"{message.rpartition(': ')[2]} did not start on its image"
        if message.startswith("compose service is ") and " after its wait: " in message:  # a Docker health status
            status, _, service = message.removeprefix("compose service is ").partition(" after its wait: ")
            return f"{service} is {status} after its wait"
        return known.get(message) or f"unclassified runtime failure ({failure_origin(error)})"
    return f"unexpected release failure ({failure_origin(error)})"


def report_failure(phase: str, error: Exception) -> None:
    labels = {"primary": "Primary release failure", "recovery": "Release recovery failure",
              "previous": "Previous Web left running", "control": "Previous Live control left running",
              "cleanup": "Release cleanup skipped", "release": "Release tick failed",
              "services": "Compose service move failed", "settled": "Settled check skipped"}
    with contextlib.suppress(OSError, ValueError):  # A closed diagnostic stream must not prevent transaction recovery.
        print(f"{labels.get(phase, 'Release failure')}: {failure_summary(error)}",
              file=sys.stderr, flush=True)


class Release:
    """One version moves Web, the Agent, its Live control and the Paper controller together: either all reach it,
    or all stay on the previous version and `failed/<revision>` blocks it. Paper's own journal and the roll-forward
    rule between the two commits are deploy/paper_release.py's."""

    def __init__(self, host: DockerHost, github: GitSource, live=None, paper: PaperRelease | None = None):
        self.host = host
        self.github = github
        self.state = host.state
        self.transaction = self.state / "transaction.json"
        self.failed = self.state / "failed"
        self.live = live or LiveHost(host, github)
        self._paper = paper
        self._generation: Generation | None = None
        self.waits: dict[str, str] = {}  # why the admitted version waits this tick, as notice facts (deploy/notices.py)
        self.cleaned: list[str] = []  # what this tick's prune removed
        self.settled: dict[str, str] | None = None  # the routed version against its record, once a tick checked it

    def stop_controls(self, kept: str) -> None:
        """Inside the account lock, once the route is committed: stop every Live control but `kept`'s. A failure
        leaves one running, which the account no longer admits (live/release.py admission_locked); the next
        release stops it."""
        try:
            self.live.stop_others(kept)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("control", error)

    def journal(self, candidate: str, previous: str, agent_before: str | None = None) -> dict:
        """`agent_before` names the Agent a release replaces; None keeps it."""
        revision(candidate)
        self.host.checked(previous)
        transaction: dict[str, str] = {"candidate": candidate, "previous": previous}
        if agent_before is not None:
            self.host.checked(agent_before, AGENT)
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

    def recover(self, failed: bool = True) -> None:
        """Paper first: it rolls forward only when the Web commit already happened, else it rolls back while the
        Web journal is still open, and the Web rolls back after it. `failed` False (a host condition stopped the
        release, `waits`) leaves the version unmarked; a journal found at the start of a tick (an interrupted
        release) marks it. After a data generation cutover the previous version may not read the host's ledger, so
        the rollback does not wait for it to answer healthy (Generation.done)."""
        try:
            self.paper().lenient = self.generation().done()
            self.paper().recover()
            self._recover(failed)
        except Exception as error:
            report_failure("recovery", error)
            raise

    def _recover(self, failed: bool) -> None:
        if not self.transaction.exists():
            return
        transaction = read_journal(self.transaction, frozenset({"candidate", "previous"}), frozenset({"agent_before"}))
        candidate, previous = transaction["candidate"], transaction["previous"]
        sha = revision(candidate)
        self.host.checked(previous)
        self.known_routes(transaction)
        print(f"Rolling back uncommitted Web release {sha}", flush=True)
        self.live.restore(previous)
        if "agent_before" in transaction:
            before = transaction["agent_before"]
            after = f"{AGENT}{sha}"
            current = self.host.agent()
            if current not in {None, before, after}:
                raise RuntimeError("Agent has an independent change; preserve transaction and stop")
            if self.host.exists(after):
                self.host.stop(after)
            self.host.start(before)
        self.host.start(previous)
        protected = self.host.protected()
        lenient = self.generation().done()  # the previous version cannot read a new generation's ledger
        if not lenient:
            self.host.warm(previous, protected)
        self.known_routes(transaction)
        self.host.switch(previous)
        if not lenient:
            self.host.health(previous, self.host.lines(previous), routed=True)
        self.host.auth_denied()
        self.known_routes(transaction)
        if self.host.live_route() != previous:
            raise RuntimeError("rollback route changed during final probes; preserve transaction")
        agent = self.host.agent()
        with self.live.barrier(candidate, wait_for_lock=True) as held:
            held()
            self.known_routes(transaction)
            if self.host.live_route() != previous:
                raise RuntimeError("rollback route changed during final probes; preserve transaction")
            if self.host.agent() != agent:
                raise RuntimeError("Agent changed during rollback admission")
            self.host.ensure_protected(protected)
            held()
            self.host.persist_route(previous)
            if failed:
                self.mark_failed(candidate)
            self.clear()  # only a verified rollback commits removal of the recovery journal
            self.stop_controls(previous)  # the candidate's control admitted no effect while the journal was open
        if self.host.exists(candidate):
            self.host.stop(candidate)
        print(f"Restored previous Web release {previous}", flush=True)

    def retire_webs(self, routed: str) -> None:
        """Stop every Web but the routed one. Nothing reads a Web the router left: a rollback starts the previous
        one again (`_recover`), as it does the Paper controller and the Agent."""
        for name in self.host.managed(WEB, running_only=True):
            if name != routed:
                self.host.stop(name)

    def cleared(self, previous: str) -> None:
        """Stop stale Webs and check headroom, inside the release's account admission and before its journal: a
        transient refusal journals nothing, so it never marks the version failed."""
        self.retire_webs(previous)
        if not self.host.memory_available():
            raise HostCondition("insufficient candidate memory headroom; keep current release")

    def apply(self, target: dict) -> None:
        sha = target["revision"]
        candidate = f"{WEB}{sha}"
        previous = self.host.disk_route()
        if self.host.live_route() != previous:
            raise RuntimeError("disk and loaded router state disagree")
        if self.failed.joinpath(sha).exists():
            raise RuntimeError("this uncommitted revision is blocked from automatic retry")
        if revision(previous) == sha:
            return
        agent = self.host.agent()
        if agent is None:
            raise RuntimeError("standalone Agent is missing; recover it first")
        before = revision(agent, AGENT)
        change_agent = self.github.agent_changed(before, sha)
        protected = self.host.protected()
        # Every release pairs: the candidate brings its own control and takes the account, only while Live is idle
        # (0.x keeps no compatibility between versions, the user 2026-11-14).
        owner = revision(previous)
        # When this host's inputs changed only the candidate's control reads them, so its inspection answers.
        if self.live.current(owner):
            # Ask the owner's control whether Live is busy before preparing anything for the candidate, so
            # a revision waiting to pair costs one inspection per tick. A held account lock is no answer.
            try:
                with self.live.barrier(WEB + owner, idle=True):
                    pass
            except AccountLockBusy:
                print("A Live operation holds the account lock; keeping the current Web/control pair", flush=True)
                return
            except LiveBusy as busy:
                print(f"{busy}; the release waits until Live is idle", flush=True)
                return
        image = target["image"]
        paper = self.paper()
        paper_plan = None

        def ready() -> bool:
            """The other images are pulled and the Paper side refuses nothing, before any journal; False waits."""
            nonlocal paper_plan
            self.host.pull(image, IMAGE_REF, sha)
            try:
                paper_plan = paper.prepare(target)
            except HostCondition as condition:
                self.wait(sha, condition)
                return False
            return True

        self.host.pull(target["service"], SERVICE_REF, sha)  # all that a new data generation's question reads
        # Read before the journal (a failure here journals nothing), and before a wait, whose step uses the files.
        self.host.definition(target["service"], sha)
        # A new data generation first, the release follows next tick. It asks `ready` once the public ledger and Paper
        # runners allow it, before it changes anything: until then no other image is pulled (qOeOp/trade#3494).
        if self.generation().due(target, owner, ready) or not ready():
            return
        self.github.ensure(target)
        agent_before = agent if change_agent else None
        self.live.prepare(owner, target)
        try:
            with self.live.barrier(candidate, target["service"], idle=True) as held:
                held()
                self.github.ensure(target)
                self.cleared(previous)
                transaction = self.journal(candidate, previous, agent_before)
        except LiveBusy as busy:
            print(f"{busy}; the next tick asks again", flush=True)  # it became busy since the owner was asked
            return
        except HostCondition as condition:
            self.wait(sha, condition)
            return
        print(f"Preparing main Web release {sha}", flush=True)
        try:
            self.live.create(candidate, target["service"])
            self.live.start(candidate)
            self.live.warm(candidate)
            self.host.create(candidate, image, live_socket=self.live.socket(candidate))
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
            if paper_plan is not None:
                # Before the Web warms: its readiness and observation read Paper through the router.
                paper.switch(target, paper_plan)
            lines = self.host.warm(candidate, protected)
            self.github.ensure(target)
            self.known_routes(transaction)
            self.host.switch(candidate)
            self.host.observe(candidate, lines, protected)
            self.live.health(candidate)
            self.github.ensure(target)

            def unchanged(final: bool) -> None:
                if self.host.live_route() != candidate or self.host.disk_route() != previous:
                    raise RuntimeError("router changed during final account admission" if final
                                       else "router changed before commit; preserve independent routing")
                if self.host.agent() != (f"{AGENT}{sha}" if change_agent else agent):
                    raise RuntimeError("Agent changed during final account admission" if final else "Agent changed before commit")
                self.host.ensure_protected(protected)
                if paper_plan is not None:
                    paper.held(paper_plan["candidate"])

            unchanged(False)
            with self.live.barrier(candidate, idle=True, wait_for_lock=True) as held:
                held()
                self.github.ensure(target)
                unchanged(True)
                held()
                self.host.persist_route(candidate)
                self.clear()
                # Live is idle under this lock, so the previous control holds no run: stop it now.
                self.stop_controls(candidate)
            print(f"Committed Web release {sha} as {image}", flush=True)
            if paper_plan is not None:
                paper.commit(paper_plan["candidate"])  # a crash before this rolls Paper forward on recovery
        except Exception as error:
            # If recovery itself fails, retain the journal and every side for the next invocation/operator.
            report_failure("primary", error)
            waits = isinstance(error, (HostCondition, LiveBusy))  # Live became busy, or its lock wait expired
            self.recover(failed=not waits)
            if not waits:
                raise
            self.wait(sha, error)
            return
        try:
            self.retire_webs(candidate)  # the previous Web held its memory until the next release
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("previous", error)  # the next release's admission stops it

    def wait(self, sha: str, condition: Exception) -> None:
        """A host condition stopped the release of `sha` (HostCondition, a Live that became busy): nothing is marked
        failed, one notice says why, and the next tick tries again (doctor 20261122-31)."""
        summary = failure_summary(condition)
        print(f"Version {sha} waits: {summary}", flush=True)
        self.waits[f"wait:host:{sha}:{summary}"] = (
            f"Version {sha[:12]} waits for the host: {summary}. Nothing is marked failed and the next tick tries "
            "again; journalctl -u trade-release.service says more.")

    def follow(self, active: str) -> None:
        """Recreate the long-lived compose services whose definition the committed version changed (deploy/services.py),
        on a settled tick, while no Paper operation is in progress and Live is idle."""
        Follow(self, report_failure).run(active)

    def generation(self) -> Generation:
        if self._generation is None:
            self._generation = Generation(self)
        return self._generation

    def paper(self) -> PaperRelease:
        if self._paper is None:
            self._paper = PaperRelease(PaperHost(self.host.config), self.github)
        return self._paper

    def install(self) -> None:
        """A new host's first release: the admitted version's Paper controller, Live control, Web and Agent, with
        both routes written for the routers the installer starts next. Nothing ran before, so nothing rolls back;
        after a failure, remove the containers it created and install again."""
        paper = self.paper().host
        if (self.host.routes / "active.json").exists() or (paper.routes / "active.json").exists():
            raise RuntimeError("release routing already exists; do not overwrite it")
        target = self.github.approved()
        sha = target["revision"]
        if target["image"] is None:
            raise RuntimeError("the newest deploy-ready version is not admitted; install after a version is admitted")
        image = target["image"]
        self.host.pull(image, IMAGE_REF, sha)
        paper.pull(target["service"], SERVICE_REF, sha)
        self.github.require_runtime(paper.pull(target["runtime"], RUNTIME_REF), sha)
        self.github.ensure(target)
        controller, web, agent = PAPER + sha, f"{WEB}{sha}", f"{AGENT}{sha}"
        self.live.prepare(None, target)  # creates the custody root and the control's snapshot
        self.host.definition(target["service"], sha)  # install-release.sh starts the routers from these files
        paper.persist_route(controller)  # the controller reads its own route to know it is the active one
        paper.create_controller(controller, target["service"], target["runtime"])
        self.live.create(web, target["service"])
        self.host.create(web, image, live_socket=self.live.socket(web))
        self.host.create(agent, image, agent=True)
        paper.start(controller)
        self.live.start(web)
        self.live.warm(web)
        self.host.start(web)
        self.host.start(agent)
        self.host.persist_route(web)
        print(f"Created the first release {sha}; start the routers, then verify it", flush=True)

    def verify(self) -> None:
        """The installed first release through the routers: Paper and Web readiness, routed health, Paper
        progress and the public authentication boundary. It changes nothing."""
        paper = self.paper().host
        controller, web = paper.disk_route(), self.host.disk_route()
        if paper.live_route() != controller or self.host.live_route() != web:
            raise RuntimeError("disk and loaded router state disagree")
        protected = self.host.protected()
        paper.warm_controller(controller, protected)
        self.host.observe(web, self.host.warm(web, protected), protected)
        print(f"Verified {web} and {controller}; automatic main releases can start", flush=True)

    def prune(self, target: dict | None = None) -> None:
        """Housekeeping after a settled tick: it must never fail or undo a release. `target` is the version this tick
        released or left waiting: its images stay, or the next tick would pull them all again (qOeOp/trade#3494)."""
        if self.transaction.exists() or (self.state / "paper-transaction.json").exists():
            return
        try:
            paper_host = self.paper().host
            active = {self.host.disk_route(), paper_host.disk_route()}
            runtimes = {paper_host.runtime(name) for name in paper_host.managed(PAPER)}
            revisions = {path.name for path in self.failed.iterdir()} if self.failed.exists() else set()
            failed = {prefix + sha for sha in revisions for prefix in KINDS}
            # A failed version older than the routed one can no longer be chosen (GitSource.choose): neither its
            # marker nor its newest container is needed any more.
            routed = revision(self.host.disk_route())
            old = {sha for sha in revisions if sha != routed and self.github.ancestor(sha, routed)}
            # A Live controller and its directory survive while its Web does: a return by hand needs both.
            kept = {revision(name) for name in self.host.managed(WEB)}
            active |= {LIVE + sha for sha in kept}
            runtimes |= self.live.runtimes()  # read before its directories are pruned
            self.cleaned = self.host.prune(KINDS, active, failed, runtimes,
                                           frozenset(prefix + sha for sha in old for prefix in KINDS),
                                           frozenset(target[key] for key in ("image", "service", "runtime"))
                                           if target else frozenset())
            self.live.prune(kept)
            remaining = {revision(name, prefix) for prefix in KINDS for name in self.host.managed(prefix)}
            for sha in sorted(old - remaining):  # a running one, or one routed, stays with its marker
                (self.failed / sha).unlink()
                self.cleaned.append(f"failed/{sha}")
            if old - remaining:
                sync_directory(self.failed)
            # Paper's own markers, which no version writes since 0.3.1 (one marker per version, in failed/).
            if (self.state / "paper-failed").is_dir():
                shutil.rmtree(self.state / "paper-failed")
                self.cleaned.append("paper-failed/")
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("cleanup", error)

    def settle(self) -> None:
        """Compare the host with the routed version's admitted record (deploy/services.py `settled`). Like prune it
        never fails the tick: one it cannot read leaves the notice as it was."""
        try:
            self.settled = settled(self, self.cleaned)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("settled", error)

    def handoff(self, control: str | None) -> bool:
        """Hand control over to the admitted version's own control code unless it is `control`, the one running;
        True when it did. A version marked failed keeps its control, which hands the next one over."""
        target = self.github.approved()
        sha = target["revision"]
        if target["image"] is None or sha == control:
            return False
        if control is not None and not self.github.ancestor(control, sha):
            return False
        hand_off(self.host, target, control)
        return True

    def tick(self) -> bool:
        """One release step under the running control; True when it handed control over instead.

        A newer admitted control takes over first, before this one prepares or recovers anything, so a control
        whose own preparation or recovery fails cannot keep out the version that fixes it (doctor 20261116-06,
        the user 2026-11-16). A pending transaction is then recovered by whichever control runs, the newer one
        included, which reads the journal only in exactly its own format (`read_journal`)."""
        control = running(self.state)
        if self.handoff(control):
            return True
        if control is None:
            # The bootstrap copy only hands over: it has no revision and recovers nothing.
            if self.transaction.exists() or (self.state / "paper-transaction.json").exists():
                raise RuntimeError("a pending release transaction waits for an admitted control")
            print("No admitted version to hand release control to", flush=True)
            return False
        self.host.prepare()
        if self.generation().resume(control):  # its ledger may be down: before any recovery reads it
            return False
        pending = self.transaction.exists() or (self.state / "paper-transaction.json").exists()
        self.recover()
        if pending:
            print("Recovered a pending release transaction; the next tick goes on from there", flush=True)
            return False
        active = self.host.disk_route()
        self.host.checked(active)
        self.live.restore(active)
        self.generation().finish(revision(active))
        target = self.github.choose(revision(active), self.failed)
        if target:
            self.apply(target)
        else:
            print(f"No newer successful main image; keeping {active}", flush=True)
        if not target:  # a tick that released something leaves the services to the next one
            self.follow(active)
        self.prune(target)
        if not target:
            self.settle()
        return False

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("handoff", "install", "verify", "tick"))
    args = parser.parse_args()
    config = Config.installed()
    host = DockerHost(config)
    config.state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (config.state / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == "tick":
            if tick(host, Notices(config.state)):
                raise SystemExit(HANDOFF)
            return
        host.prepare()
        release = Release(host, GitSource(config.state))
        if args.action == "handoff":  # install-release.sh: the first control, from the admitted image
            if running(config.state) is not None:
                raise RuntimeError("an installed control hands over only within a tick")
            if not release.handoff(None):
                raise RuntimeError("the newest deploy-ready version is not admitted; install after a version is admitted")
        elif args.action == "install":
            release.install()
        else:
            release.verify()


def tick(host: DockerHost, notices: Notices) -> bool:
    """One timer tick, then the failure notices of what it and the routed Web saw; True when it handed control over."""
    try:
        release = Release(host, GitSource(host.state))
        handed = release.tick()  # it prepares the host after any handoff
        notices.released(None)
        if not handed:  # a handoff's second tick, under the new control, says what that version waits for
            notices.observe("wait", release.waits)
            if release.settled is not None:
                notices.observe("settled", release.settled)
        return handed
    except Exception as error:
        # A fetch that failed right after one that succeeded leaves the release kind unobserved: what was sent
        # stays sent and nothing new is sent. The next tick's failure is noticed.
        if not (isinstance(error, SourceUnreachable) and error.first):
            notices.released(failure_summary(error))
        raise
    finally:
        notices.watch(lambda path, routed=False: host.probe(host.disk_route(), path, routed), host.condition)
        notices.drifted(lambda: drift(host, GitSource(host.state)))
        notices.send()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        report_failure("release", error)
        raise SystemExit(1) from error
