"""Pull admitted versions into the isolated Web release plane: the public `deploy-ready` channel, which CI moves
only for the commit of the newest version tag (`main-ready`, every checked main build, is staging and never read here).

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
import traceback

from .paper_host import PAPER, PaperHost
from .paper_release import PaperRelease
from .release_host import (
    AGENT,
    IMAGE_REF,
    SERVICE_REF,
    RUNTIME_REF,
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
from .telegram import Failure, settings, telegram


# Paths outside the images' build context (deploy/Dockerfile.dockerignore), plus top-level *.md: a diff touching
# only these changes no container.
OUTSIDE_IMAGE = ("docs/", "tests/", ".agents/", ".github/", "deploy/remote/")
OUTSIDE_IMAGE_FILES = frozenset({"deploy/README.md", "deploy/compose.yaml"})
# What the Agent never loads, beside those paths: it runs ide/agent and the product's Python but never the browser,
# the overview or deploy's host modules; deploy/Dockerfile, which builds its image, is a change.
AGENT_UNCHANGED = ("ide/web/", "ide/overview/", "deploy/")


def outside_image(path: str) -> bool:
    return path.startswith(OUTSIDE_IMAGE) or path in OUTSIDE_IMAGE_FILES or ("/" not in path and path.endswith(".md"))


def failure_origin(error: BaseException) -> str:
    """The exception class and the innermost product source line it passed, never its payload."""
    kind = type(error)
    name = kind.__qualname__ if kind.__module__ == "builtins" else f"{kind.__module__}.{kind.__qualname__}"
    root = Path(__file__).resolve().parent.parent
    where = None
    for frame, line in traceback.walk_tb(error.__traceback__):
        path = Path(frame.f_code.co_filename).resolve()
        if path.is_relative_to(root) and "site-packages" not in path.parts:
            where = f"{path.relative_to(root)}:{line}"
    return f"{name} at {where}" if where else name


def failure_summary(error: Exception) -> str:
    """Only fixed classifications and code identity cross the journal boundary; exception payloads
    stay private. An unclassified failure names its class and source line so the operator can find
    it without rerunning the release under a traceback wrapper."""
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
            return f"unclassified runtime failure ({failure_origin(error)})"
        if message.startswith("protected container changed during release: "):
            return "protected container changed"  # a ledger, Docker API or Paper container restarted mid-release
        return known.get(message) or f"unclassified runtime failure ({failure_origin(error)})"
    return f"unexpected release failure ({failure_origin(error)})"


def report_failure(phase: str, error: Exception) -> None:
    labels = {"primary": "Primary Web release failure", "recovery": "Web release recovery failure",
              "retired": "Retired Live controller retained", "cleanup": "Release cleanup skipped",
              "release": "Release tick failed"}
    try:
        print(f"{labels.get(phase, 'Release failure')}: {failure_summary(error)}",
              file=sys.stderr, flush=True)
    except (OSError, ValueError):
        pass  # A closed diagnostic stream must not prevent transaction recovery.


# What a notice may quote from a probe: a Paper run's candidate and its refusal code.
NOTICE_TEXT = re.compile(r"[A-Za-z0-9_.@:-]{1,80}\Z")
LEDGER_LAG_SECONDS = 1800  # the ledger service retries a publish every 5 minutes: six retries have failed


class Notices:
    """Failures outside Live, sent to the chat the Live page bound (deploy/telegram.py): a release tick that
    failed, a Paper run that stopped and could not resume, and a research ledger whose publish has failed for
    LEDGER_LAG_SECONDS or whose origin history changed elsewhere.

    Each kind the tick observed replaces that kind's facts; one it could not observe keeps what was sent. A fact
    is sent when it first appears and again only after it has cleared. Without Live or a saved token nothing
    is sent and nothing is marked sent. Sending never raises into the tick.
    """

    def __init__(self, state: Path, call=telegram):
        self.state, self.call = state, call
        self.found: dict[str, dict[str, str]] = {}

    def observe(self, kind: str, facts: dict[str, str]) -> None:
        self.found[kind] = facts

    def released(self, error: Exception | None) -> None:
        summary = None if error is None else failure_summary(error)
        self.observe("release", {} if summary is None else {
            f"release:{summary}": f"Release tick failed on the host: {summary}. Web and the Paper controller "
                                  "each stay on the route they last committed; see journalctl -u "
                                  "trade-release.service."})

    def watch(self, probe) -> None:
        """Read Paper runs and the ledger's publication through the routed Web; `probe(path)` is its facts."""
        try:
            paper = {}
            for run in probe("/api/paper/runs")["runs"]:
                code = run.get("recovery")
                if code is not None:
                    code = code if isinstance(code, str) and NOTICE_TEXT.fullmatch(code) else "other"
                    candidate = run.get("candidate")
                    named = f" ({candidate})" if isinstance(candidate, str) and NOTICE_TEXT.fullmatch(candidate) else ""
                    paper[f"paper:{int(run['id'])}:{code}"] = (
                        f"Paper run {int(run['id'])}{named} stopped and could not resume: {code}. It stays stopped "
                        "with its account and originals; see the Paper page.")
            self.observe("paper", paper)
        except Exception:
            pass  # unknown this tick: what was sent stays sent
        try:
            ledger = probe("/api/about")["ledger"]
            if isinstance(ledger, dict):
                behind = ledger.get("behind_seconds")
                if ledger.get("diverged") is True:
                    facts = {"ledger:diverged": "The research ledger's origin history changed elsewhere; a "
                                                "publish retry cannot settle it. New writes stay unpublished."}
                elif ledger.get("unpublished") is True and type(behind) is int and behind >= LEDGER_LAG_SECONDS:
                    facts = {"ledger:behind": f"The research ledger has not been published for {behind // 60} "
                                              "minutes: its publish keeps failing (publish_failed)."}
                else:
                    facts = {}
                self.observe("ledger", facts)
        except Exception:
            pass

    def send(self) -> None:
        try:
            self._send()
        except Exception as error:  # the type only: a payload could carry what a file held
            print(f"Failure notices not sent: {type(error).__name__}", file=sys.stderr, flush=True)

    def _token(self) -> tuple[str, int] | None:
        from .live_configuration import declaration

        path = self.state / "live/configuration.json"
        if not os.path.lexists(path):
            return None  # a host without Live has no Telegram chat
        return settings(Path(declaration(path)["root"]) / "notify")

    def _send(self) -> None:
        path = self.state / "notices.json"
        record = json.loads(path.read_text()) if path.exists() else {}
        sent = {kind: set(keys) for kind, keys in record.items()}
        for kind, facts in self.found.items():
            sent[kind] = sent.get(kind, set()) & set(facts)  # a cleared fact may be sent again
        new = [(kind, key, text) for kind, facts in self.found.items()
               for key, text in facts.items() if key not in sent[kind]]
        found = self._token() if new else None
        if found is not None:
            token, chat = found
            for kind, key, text in new:
                try:
                    self.call(token, "sendMessage", {"chat_id": chat, "text": text[:4000]})
                except Failure as error:
                    print(f"Failure notice not sent: {error.code}", file=sys.stderr, flush=True)
                    if error.status is None or not 400 <= error.status < 500 or error.status == 429:
                        break  # the next tick retries, in order
                sent[kind].add(key)  # delivered, or refused by Telegram: retrying cannot deliver it
        if {kind: sorted(keys) for kind, keys in sent.items()} != record:
            durable_json(path, {kind: sorted(keys) for kind, keys in sorted(sent.items())}, mode=0o600)


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
            raise RuntimeError(f"public git {args[0]} failed")
        return result.stdout if raw else result.stdout.strip()

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
        return any(path == "deploy/Dockerfile" or not (outside_image(path) or path.startswith(AGENT_UNCHANGED))
                   for path in paths)

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
        self.host.checked(previous)
        self.known_routes(transaction)
        print(f"Rolling back uncommitted Web release {sha}", flush=True)
        if self.live is not None:
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
        barrier = (self.live.barrier(candidate, wait_for_lock=True)
                   if self.live is not None else nullcontext(lambda: None))
        with barrier as held:
            held()
            self.known_routes(transaction)
            if self.host.live_route() != previous:
                raise RuntimeError("rollback route changed during final probes; preserve transaction")
            if self.host.agent() != agent:
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

    def cleared(self, previous: str) -> None:
        """Stop stale Webs and check headroom: before the journal of a release without Live, and inside a paired
        release's account admission."""
        for name in self.host.managed(WEB, running_only=True):
            if name != previous:
                self.host.stop(name)
        if not self.host.memory_available():
            raise RuntimeError("insufficient candidate memory headroom; keep current release")

    def apply(self, target: dict) -> None:
        sha = target["revision"]
        candidate = f"{WEB}{sha}"
        previous = self.host.disk_route()
        self.require_live_installation(previous)
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
        # With Live installed every release pairs: the candidate brings its own control and takes the account,
        # only while Live is idle (0.x keeps no compatibility between versions, the user 2026-11-14).
        paired = self.live is not None
        owner = revision(previous) if paired and self.host.requires_live(previous) else None
        if not paired:
            self.cleared(previous)
        from .live_host import AccountLockBusy, LiveBusy

        # A changed Live declaration also pairs: only a new control reads it. The owner's control refuses
        # every new effect against it, its idle inspection included, so the candidate's inspection answers.
        if owner is not None and self.live.current(owner):
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
        self.github.ensure(target)
        agent_before = agent if change_agent else None
        if paired:
            self.live.prepare(owner, target)
            try:
                with self.live.barrier(candidate, target["service"], idle=True) as held:
                    held()
                    self.github.ensure(target)
                    transaction = self.journal(candidate, previous, agent_before)
            except LiveBusy as busy:
                print(f"{busy}; the next tick asks again", flush=True)  # it became busy since the owner was asked
                return
        else:
            transaction = self.journal(candidate, previous, agent_before)
        print(f"Preparing main Web release {sha}", flush=True)
        try:
            if paired:
                self.cleared(previous)
                self.live.create(candidate, target["service"])
                self.live.start(candidate)
                self.live.warm(candidate)
                self.host.create(candidate, image, live_socket=self.live.socket(candidate))
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
            self.host.switch(candidate)
            self.host.observe(candidate, lines, protected)
            if paired:
                self.live.health(candidate)
            self.github.ensure(target)

            def unchanged(final: bool) -> None:
                if self.host.live_route() != candidate or self.host.disk_route() != previous:
                    raise RuntimeError("router changed during final account admission" if final
                                       else "router changed before commit; preserve independent routing")
                if self.host.agent() != (f"{AGENT}{sha}" if change_agent else agent):
                    raise RuntimeError("Agent changed during final account admission" if final else "Agent changed before commit")
                self.host.ensure_protected(protected)

            unchanged(False)
            barrier = (self.live.barrier(candidate, idle=True, wait_for_lock=True)
                       if paired else nullcontext(lambda: None))
            with barrier as held:
                held()
                self.github.ensure(target)
                unchanged(True)
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

    def paper(self) -> PaperRelease:
        return PaperRelease(PaperHost(self.host.config), self.github)

    def install(self) -> None:
        """A new host's first release: the admitted version's Paper controller, Web and Agent, with both
        routes written for the routers the installer starts next. Nothing ran before, so nothing rolls back;
        after a failure, remove the containers it created and install again."""
        paper = self.paper().host
        if (self.host.routes / "active.json").exists() or (paper.routes / "active.json").exists():
            raise RuntimeError("release routing already exists; do not overwrite it")
        if self.live is not None:
            raise RuntimeError("install the Live declaration after the first release")
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
        paper.persist_route(controller)  # the controller reads its own route to know it is the active one
        paper.create(controller, target["service"], target["runtime"])
        self.host.create(web, image)
        self.host.create(agent, image, agent=True)
        paper.start(controller)
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
            prefixes: tuple[str, ...] = (WEB, AGENT, PAPER)
            revisions = {path.name for path in self.failed.iterdir()} if self.failed.exists() else set()
            failed = {prefix + sha for sha in revisions for prefix in (WEB, AGENT)}
            paper = self.state / "paper-failed"
            if paper.exists():
                failed |= {PAPER + path.name for path in paper.iterdir()}
            kept: set[str] = set()
            if self.live is not None:
                from .live_host import LIVE

                # A Live controller and its directory survive while its Web does: a return by hand needs both.
                kept = {revision(name) for name in self.host.managed(WEB)}
                prefixes += (LIVE,)
                active |= {LIVE + sha for sha in kept}
                failed |= {LIVE + sha for sha in revisions}
                runtimes |= self.live.runtimes()  # read before its directories are pruned
            self.host.prune(prefixes, active, failed, runtimes)
            if self.live is not None:
                self.live.prune(kept)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            report_failure("cleanup", error)

    def tick(self) -> None:
        paper = self.paper()
        paper.recover()
        self.recover()
        active = self.host.disk_route()
        self.host.checked(active)
        self.require_live_installation(active)
        if self.live is not None and self.host.requires_live(active):
            self.live.restore(active)
        target = self.github.choose(revision(active), self.failed)
        if target:
            self.apply(target)
        else:
            print(f"No newer successful main image; keeping {active}", flush=True)
        paper.tick()
        self.retire_live()
        self.prune()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "verify", "tick"))
    args = parser.parse_args()
    config = Config.installed()
    host = DockerHost(config)
    config.state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (config.state / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == "tick":
            tick(host, Notices(config.state))
            return
        host.prepare()
        release = Release(host, GitSource(config.state))
        if args.action == "install":
            release.install()
        else:
            release.verify()


def tick(host: DockerHost, notices: Notices) -> None:
    """One timer tick, then the failure notices of what it and the routed Web saw."""
    try:
        host.prepare()
        Release(host, GitSource(host.state)).tick()
        notices.released(None)
    except Exception as error:
        notices.released(error)
        raise
    finally:
        notices.watch(lambda path: host.probe(host.disk_route(), path))
        notices.send()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        report_failure("release", error)
        raise SystemExit(1) from error
