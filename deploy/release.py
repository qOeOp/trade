"""Pull admitted versions into the isolated Web release plane: the public `deploy-ready` channel, which CI moves
only for the commit of the newest version tag (`main-ready`, every checked main build, is staging and never read here).

The host runs only the control code inside the CI-built, digest-pinned service image `deploy-ready` names: each
version's own control releases it (deploy/control.py). Git and Docker use no existing credential configuration.
"""

import argparse
import contextlib
from datetime import datetime, UTC
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback

from .control import HANDOFF, hand_off, running
from .live_host import LIVE, AccountLockBusy, AccountLockWaitExpired, LiveBusy, LiveHost
from .paper_host import PAPER, PaperHost
from .paper_release import PaperRelease
from .release_host import (
    AGENT,
    DOCKER_API,
    DOCKER_API_IMAGE,
    DOCKER_API_REF,
    FOLLOWERS,
    DockerFailure,
    HostCondition,
    ReaderFailure,
    IMAGE_REF,
    SERVICE_IMAGE,
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
    until_ready,
)
from .notices import Notices
from .source import GitSource, SourceUnreachable


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
            "a pending release transaction waits for an admitted control": "pending journal waits for a control",
        }
        message = error.args[0] if len(error.args) == 1 and type(error.args[0]) is str else None
        if message is None:
            return f"unclassified runtime failure ({failure_origin(error)})"
        if message.startswith("protected container changed during release: "):
            return "protected container changed"  # a ledger, Docker API or Paper container restarted mid-release
        if message.startswith("compose service did not start on its image: "):  # DockerHost.recreate: a fixed name
            return f"{message.rpartition(': ')[2]} did not start on its image"
        return known.get(message) or f"unclassified runtime failure ({failure_origin(error)})"
    return f"unexpected release failure ({failure_origin(error)})"


def report_failure(phase: str, error: Exception) -> None:
    labels = {"primary": "Primary release failure", "recovery": "Release recovery failure",
              "previous": "Previous Web left running", "control": "Previous Live control left running",
              "cleanup": "Release cleanup skipped", "release": "Release tick failed",
              "services": "Compose service move failed"}
    with contextlib.suppress(OSError, ValueError):  # A closed diagnostic stream must not prevent transaction recovery.
        print(f"{labels.get(phase, 'Release failure')}: {failure_summary(error)}",
              file=sys.stderr, flush=True)


# Paper states whose run the controller is about to stop, resume or seal: a lifecycle operation is due.
PAPER_OPERATIONS = frozenset({"stopping", "ended", "unsealed"})
PAPER_LISTING_SECONDS = 3  # past the Paper controller's listing cache (paper/serve.py LIST_SECONDS)


# A compose service a move put back (Release.move) is created after the routed Web, as one the operator recreated is.
# Either is moved again once it is FOLLOW_RETRY_SECONDS old, while it was created within
# (FOLLOW_ATTEMPTS - 1) * FOLLOW_RETRY_SECONDS of the Web: each undone move leaves a container at least that much
# newer than the last, so a version tries at most FOLLOW_ATTEMPTS moves, an hour apart, and then leaves the service to
# the next version with a drift notice (doctor 20261117-02). Nothing is stored: Docker's creation times are the count.
FOLLOW_RETRY_SECONDS, FOLLOW_ATTEMPTS = 3600, 3


def epoch(created: tuple[str, str]) -> float:
    """A `moment` as seconds since the epoch (to the microsecond)."""
    whole, fraction = created
    return datetime.fromisoformat(f"{whole}.{fraction[:6]}").replace(tzinfo=UTC).timestamp()


def retry(since: tuple[str, str], created: tuple[str, str], now: float) -> str:
    """For a service created after the routed Web (created `since`): "due" to be moved again, "wait" for its retry,
    or "over" once this version's attempts are spent."""
    if epoch(created) - epoch(since) >= (FOLLOW_ATTEMPTS - 1) * FOLLOW_RETRY_SECONDS:
        return "over"
    return "due" if now - epoch(created) >= FOLLOW_RETRY_SECONDS else "wait"


def drift(host: DockerHost, github: GitSource) -> dict[str, str]:
    """What on the host does not follow the active version (doctor 20261116-04): docker-api against the digest the
    version pins, and the compose services of the service image against its digest, once the release no longer
    moves them (Release.follow)."""
    sha = revision(host.disk_route())
    short = sha[:12]
    facts = {}
    since, now = host.created(WEB + sha), time.time()
    pin = github.docker_api(sha)
    running = host.inspect(DOCKER_API)["image"]
    if running != pin and host.created(DOCKER_API) > since and retry(since, host.created(DOCKER_API), now) == "over":
        # One created before the routed Web, or whose retries are not spent, is moved by a settled tick (Release.follow).
        facts[f"drift:docker-api:{pin}"] = (
            f"docker-api runs {running}, but the active version {short} pins {pin}. It was recreated after that "
            "version was released (a move undone, or by hand) and the release's retries are spent, so it stays until "
            "the next version; recreate it by hand from that version's compose files (deploy/remote/README.md).")
    target = github.approved()
    service = target["service"] if target["revision"] == sha else None
    for name, container, _ in FOLLOWERS if service is not None else ():
        found = host.follower(container)
        if (found is not None and found["image"] != service and found["created"] > since
                and retry(since, found["created"], now) == "over"):
            facts[f"drift:{name}:{service}"] = (
                f"{name} runs {found['image']}, but the active version {short} runs {service}. Its moves were undone "
                "(or it was recreated by hand) and the release's retries are spent, so it stays until the next "
                "version; journalctl -u trade-release.service names the reader that failed.")
    return facts


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
        self.waits: dict[str, str] = {}  # why the admitted version waits this tick, as notice facts (deploy/notices.py)

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
        release) marks it."""
        try:
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
        self.host.warm(previous, protected)
        self.known_routes(transaction)
        self.host.switch(previous)
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
        self.host.pull(image, IMAGE_REF, sha)
        paper = self.paper()
        try:
            paper_plan = paper.prepare(target)  # its refusals journal nothing
        except HostCondition as condition:
            self.wait(sha, condition)
            return
        # Read before the journal (a failure here journals nothing), and before a wait, whose step uses the files.
        self.host.definition(target["service"], sha)
        if self.generations(target):
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

    def generations(self, target: dict) -> bool:
        """Whether the version waits for the host's ledger service to hold the schema generations its code reads: its
        own `ledger service check` refuses a database with SCHEMA_MISMATCH (PaperHost.generations). Before the
        journal, so a ledger generation the owner has not moved the host to yet changes nothing and marks nothing
        failed; every tick asks again (doctor 20261122-30)."""
        sha = target["revision"]
        found = self.paper().host.generations(target["service"])
        if not found:
            return False
        named = " and ".join(f"the {database} database" + (f" (its code reads generation {generation})"
                                                           if generation else "")
                             for database, generation in sorted(found.items()))
        print(f"Version {sha} does not read the schema generation of {named} on the host; the release waits",
              flush=True)
        self.waits[f"wait:generation:{sha}:{','.join(sorted(found))}"] = (
            f"Version {sha[:12]} waits before its release: the host's ledger service holds another schema generation "
            f"of {named} than its code reads (SCHEMA_MISMATCH). Nothing was changed or marked failed, and every tick "
            "checks again. Moving the host to that generation is the owner's step: deploy/remote/README.md, A version "
            "that needs a new ledger generation.")
        return True

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
        paper.create(controller, target["service"], target["runtime"])
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
        paper.warm(controller, protected)
        self.host.observe(web, self.host.warm(web, protected), protected)
        print(f"Verified {web} and {controller}; automatic main releases can start", flush=True)

    def prune(self) -> None:
        """Housekeeping after a settled tick: it must never fail or undo a release."""
        if self.transaction.exists() or (self.state / "paper-transaction.json").exists():
            return
        try:
            paper_host = self.paper().host
            active = {self.host.disk_route(), paper_host.disk_route()}
            runtimes = {paper_host.runtime(name) for name in paper_host.managed(PAPER)}
            revisions = {path.name for path in self.failed.iterdir()} if self.failed.exists() else set()
            failed = {prefix + sha for sha in revisions for prefix in (WEB, AGENT, PAPER, LIVE)}
            # A Live controller and its directory survive while its Web does: a return by hand needs both.
            kept = {revision(name) for name in self.host.managed(WEB)}
            active |= {LIVE + sha for sha in kept}
            runtimes |= self.live.runtimes()  # read before its directories are pruned
            self.host.prune((WEB, AGENT, PAPER, LIVE), active, failed, runtimes)
            self.live.prune(kept)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("cleanup", error)

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
        pending = self.transaction.exists() or (self.state / "paper-transaction.json").exists()
        self.recover()
        if pending:
            print("Recovered a pending release transaction; the next tick goes on from there", flush=True)
            return False
        active = self.host.disk_route()
        self.host.checked(active)
        self.live.restore(active)
        target = self.github.choose(revision(active), self.failed)
        if target:
            self.apply(target)
        else:
            print(f"No newer successful main image; keeping {active}", flush=True)
        if not target:  # a tick that released something leaves the services to the next one
            self.follow(active)
        self.prune()
        return False

    def paper_quiet(self, web: str) -> set[int] | None:
        """No Paper operation is in progress, read through the routed Web: no run is starting, stopping, or ended
        or unsealed and so about to be resumed or sealed. Open runs and their containers are allowed (the user,
        2026-11-16, 「放宽」): runners never reach the ledger, and what the controller does with an open run across a
        restart either fails before any effect or replays, and is retried every 15 s. The runs that already carry a
        recovery failure; None when an operation is in progress or the listing is unreadable."""
        try:
            listed = self.host.probe(web, "/api/paper/runs", routed=True)
            if listed["starting"] or any(run["state"] in PAPER_OPERATIONS for run in listed["runs"]):
                return None
            return {run["id"] for run in listed["runs"] if run["recovery"]}
        except (RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired):
            return None

    def recovered(self, web: str, before: set[int]) -> None:
        """Wait a while for recovery failures that appeared during the move to clear: a run that ended while the
        ledger restarted fails to resume or seal until the controller's next round, and the tick's notices would
        report it as a run that could not resume. One that stays is reported; it does not undo the move."""
        def cleared() -> None:
            runs = self.host.probe(web, "/api/paper/runs", routed=True)["runs"]
            if any(run["recovery"] and run["id"] not in before for run in runs):
                raise RuntimeError("a Paper recovery failed during the service move")

        try:
            until_ready(cleared, 180, 5, errors=(RuntimeError, ValueError, KeyError, subprocess.SubprocessError))
        except (RuntimeError, ValueError, KeyError, subprocess.SubprocessError):
            print("A Paper run's recovery still fails after the service move; the notice reports it", flush=True)

    def follow(self, active: str) -> None:
        """Move the compose services to the committed version: the ledger mirror and market-import to its admitted
        service digest, and docker-api to the digest its deploy/compose.yaml pins (the user, 2026-11-15 and
        2026-11-16, doctors 20261115-06 and 20261116-04; docs/plans/release-moves-ledger-mirror-20261116.zh.md),
        each from the version's own compose files (DockerHost.definition), while no Paper operation is in progress and
        Live is idle. A running service created after the active Web was recreated since this version committed, by a
        move undone or by the operator: it is moved again under the same conditions once `retry` says so, at most
        FOLLOW_ATTEMPTS moves per version, and then stays until the next version (`drift` sends the notice). One that
        is absent or stopped is the operator's and is never started."""
        sha = revision(active)
        target = self.github.approved()
        service = target["service"]
        if target["revision"] != sha or service is None:
            return
        wanted = [(name, container, healthy, SERVICE_IMAGE, service) for name, container, healthy in FOLLOWERS]
        wanted.append(("docker-api", DOCKER_API, False, DOCKER_API_IMAGE, self.github.docker_api(sha)))
        since, now = self.host.created(active), time.time()
        moving = []
        for name, container, healthy, variable, image in wanted:
            found = self.host.follower(container)
            if found is None or found["image"] == image:
                continue
            again = retry(since, found["created"], now) if found["created"] > since else "due"
            if again == "over":
                print(f"{name} was recreated after {active} and its retries are spent; it stays on {found['image']} "
                      "until the next version", flush=True)
                continue
            if again == "wait":
                print(f"{name} was recreated after {active} (a move undone, or by hand); the release moves it again "
                      f"{FOLLOW_RETRY_SECONDS // 60} minutes after that", flush=True)
                continue
            moving.append((name, container, healthy, variable, image, found["image"]))
        if not moving:
            return
        if self.paper_quiet(active) is None:
            print("The compose services wait until no Paper operation is in progress", flush=True)
            return
        files = self.host.definition(service, sha)
        for _, _, _, variable, image, _ in moving:
            if variable == DOCKER_API_IMAGE:
                self.host.pull(image, DOCKER_API_REF)  # this repository and amd64, built from an earlier commit
            else:
                self.host.pull(image, SERVICE_REF, sha)
        paper = self.paper().host
        controller = paper.disk_route()
        paper.switch(controller, "all")  # new Paper writes wait; recover() unfreezes it after a crash
        try:
            with paper.barrier(paper.inspect(controller)["image"]) as drained:
                drained()  # a lifecycle operation that passed before the freeze has finished
            time.sleep(PAPER_LISTING_SECONDS)
            before = self.paper_quiet(active)
            if before is None:
                print("A Paper operation began; the compose services wait", flush=True)
                return
            with self.live.barrier(active, idle=True) as held:
                held()
                self.move(active, controller, moving, files, held)
        except LiveBusy as busy:
            print(f"{busy}; the compose services wait until Live is idle", flush=True)
            return
        finally:
            paper.normalize()
        self.recovered(active, before)

    def move(self, web: str, controller: str, moving: list, files: list[str], held) -> None:
        """Recreate each service on its image, then check what reads them; on any failure put back every one it
        touched on its previous image and fail the tick. docker-api is recreated, never only restarted, so it also
        mounts what the definition names now. While it is down the Paper controller's Docker calls fail (its listing,
        start, stop, resume and seal refuse with RUNTIME_UNAVAILABLE) and running runs, whose containers the engine
        runs, go on."""
        touched = []
        try:
            for name, container, healthy, variable, image, _ in moving:
                touched.append(name)
                print(f"Moving {name} to {image}", flush=True)
                self.host.recreate(name, container, image, healthy, files, variable=variable)
                held()

            def readers() -> None:
                # Not /api/live: this move holds the Live account lock that its listing waits on (doctor 20261117-02).
                # The services moved here are not on the Web to Live control path it would check.
                self.host.health(web, [], routed=True, live=False)
                self.paper().host.health(controller)  # its listing reads Docker through docker-api

            until_ready(readers, 180, 5, errors=(RuntimeError, ValueError, KeyError, subprocess.SubprocessError))
        except Exception as error:
            report_failure("services", error)
            try:
                for name, container, healthy, variable, _, previous in reversed(moving):
                    if name in touched:
                        self.host.recreate(name, container, previous, healthy, files, pull=True, variable=variable)
            except Exception as undo:
                report_failure("services", undo)
                raise RuntimeError("compose services did not move nor return; left for the operator") from undo
            raise RuntimeError("compose services did not move; previous images restored") from error
        print(f"Moved {', '.join(touched)}", flush=True)


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
