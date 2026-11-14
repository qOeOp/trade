"""Transactional replacement of the Paper API, never of its independently running strategies.

The Paper controller moves only inside the Web release of the same version (deploy/release.py Release.apply): 0.x
keeps no compatibility between versions, so Web N never serves beside a Paper controller N-1 once a release settles.
`prepare` refuses before any journal, `switch` journals and hands the API to the candidate with new starts held,
the Web release then warms, switches, observes and commits against it, and `commit` opens new starts last.

Recovery converges both sides on one version. While this journal is open, the Paper side rolls forward (commits)
only when the Web release committed the same revision: no Web journal is open and Web's disk route names it.
Otherwise it rolls back to the previous controller, before the Web rolls back, and the version is marked failed.
"""

import os
import json
from .paper_host import PAPER, PaperHost
from .release_host import SERVICE_REF, RUNTIME_REF, WEB, durable_json, revision, sync_directory


class PaperRelease:
    def __init__(self, host: PaperHost, source):
        self.host, self.source = host, source
        self.transaction = host.state / "paper-transaction.json"
        self.failed = host.state / "failed"  # one marker per version, shared with the Web release
        self.web_transaction = host.state / "transaction.json"

    def clear(self):
        self.transaction.unlink()
        sync_directory(self.host.state)

    def fail(self, candidate):
        self.failed.mkdir(exist_ok=True)
        with (self.failed / revision(candidate, PAPER)).open("w") as stream:
            stream.write("Release failed or was interrupted before commit; inspect the host service journal.\n")
            stream.flush()
            os.fsync(stream.fileno())
        sync_directory(self.failed)

    def web_committed(self, candidate: str) -> bool:
        """The Web release of the candidate's revision committed: the crash fell between the two commits."""
        return not self.web_transaction.exists() and self.host.web.disk_route() == WEB + revision(candidate, PAPER)

    def recover(self):
        if not self.transaction.exists():
            self.host.normalize()  # commit may have preceded unfreezing starts
            return
        value = json.loads(self.transaction.read_text())
        candidate, previous = value["candidate"], value["previous"]
        revision(candidate, PAPER)
        if self.web_committed(candidate):
            print(f"Web committed {revision(candidate, PAPER)}; finishing its Paper controller commit", flush=True)
            self.commit(candidate)
            return
        self.host.checked(previous)
        self.host.pending(candidate, previous)
        if not self.host.exists(candidate):
            if (
                self.host.live_route() != previous
                or self.host.disk_route() != previous
                or not self.host.inspect(previous)["running"]
            ):
                raise RuntimeError("Paper candidate missing after a routing change; preserve transaction")
        else:
            service = self.host.inspect(candidate)["image"]
            self.host.switch(self.host.live_route(), "all")
            with self.host.barrier(service) as held:
                self.host.pending(candidate, previous)
                held()
                self.host.pending(candidate, previous)
                self.host.stop(candidate)
                held()
                self.host.start(previous)
                self.host.warm(previous, self.host.protected())
                held()
                self.host.pending(candidate, previous)
                self.host.persist_route(previous, "starts")
                self.host.switch(previous, "starts")
            self.host.health(previous)
        self.host.pending(candidate, previous)
        if self.host.live_route() != previous or self.host.disk_route() != previous:
            raise RuntimeError("Paper rollback route changed during final checks")
        if not self.web_transaction.exists():
            self.fail(candidate)  # otherwise the Web's verified rollback, which follows, marks the version
        self.clear()
        self.host.normalize()
        print(f"Restored Paper controller {previous}; every strategy keeps its original image", flush=True)

    def prepare(self, target: dict) -> dict | None:
        """The Paper side's refusals before any journal of the release, so a transient one marks nothing failed.
        None when the controller already serves this revision."""
        sha = target["revision"]
        candidate, previous = PAPER + sha, self.host.disk_route()
        if previous == candidate:
            return None
        self.host.known({previous})
        if self.host.live_route() != previous:
            raise RuntimeError("Paper disk/live routes disagree")
        if not self.host.memory_available():
            raise RuntimeError("insufficient memory for a standby Paper controller")
        self.host.pull(target["service"], SERVICE_REF, sha)
        runtime_source = self.host.pull(target["runtime"], RUNTIME_REF)
        self.source.require_runtime(runtime_source, sha)
        return {"candidate": candidate, "previous": previous}

    def switch(self, target: dict, plan: dict) -> None:
        """Inside the Web release's transaction: journal, warm the candidate and hand the API to it with new starts
        held. Raising leaves the journal for recover()."""
        candidate, previous = plan["candidate"], plan["previous"]
        protected = self.host.protected()
        durable_json(self.transaction, {"candidate": candidate, "previous": previous})
        print(f"Preparing Paper controller {target['revision']}; new starts will use {target['runtime']}", flush=True)
        self.host.create(candidate, target["service"], target["runtime"])
        self.host.start(candidate)
        self.host.warm(candidate, protected)
        self.source.ensure(target)
        self.host.known({candidate, previous})
        self.host.switch(previous, "all")
        with self.host.barrier(target["service"]) as held:
            self.host.known({candidate, previous})
            self.host.ensure_protected(protected)
            held()
            self.host.phase(previous, "all", None)
            self.host.stop(previous)
            held()
            self.host.phase(previous, "all", None)
            self.host.persist_route(candidate, "starts")
            self.host.switch(candidate, "starts")

    def held(self, candidate: str) -> None:
        """The switched candidate still serves with new starts held: checked before the Web release commits."""
        self.host.phase(candidate, "starts", "starts")

    def commit(self, candidate: str) -> None:
        """After the Web of the same revision committed. No new-runtime start is allowed before this point."""
        self.held(candidate)
        self.clear()
        self.host.normalize()
        print(f"Committed Paper controller {revision(candidate, PAPER)}; existing runner/egress containers were "
              "not restarted", flush=True)
