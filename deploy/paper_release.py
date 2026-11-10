"""Transactional replacement of the Paper API, never of its independently running strategies."""

import os
import json
from .paper_host import PAPER, PaperHost
from .release_host import SERVICE_REF, RUNTIME_REF, durable_json, revision, sync_directory


class PaperRelease:
    def __init__(self, host: PaperHost, source):
        self.host, self.source = host, source
        self.transaction = host.state / "paper-transaction.json"
        self.failed = host.state / "paper-failed"

    def clear(self):
        self.transaction.unlink()
        sync_directory(self.host.state)

    def fail(self, candidate):
        self.failed.mkdir(exist_ok=True)
        with (self.failed / revision(candidate, PAPER)).open("w") as stream:
            stream.write("Paper release failed or was interrupted before commit; inspect the service journal.\n")
            stream.flush()
            os.fsync(stream.fileno())
        sync_directory(self.failed)

    def recover(self):
        if not self.transaction.exists():
            self.host.normalize()  # commit may have preceded unfreezing starts
            return
        value = json.loads(self.transaction.read_text())
        candidate, previous = value["candidate"], value["previous"]
        revision(candidate, PAPER)
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
        self.fail(candidate)
        self.clear()
        self.host.normalize()
        print(f"Restored Paper controller {previous}; every strategy keeps its original image", flush=True)

    def apply(self, target):
        sha = target["revision"]
        candidate, previous = PAPER + sha, self.host.disk_route()
        if previous == candidate or (self.failed / sha).exists():
            return
        self.host.known({previous})
        if self.host.live_route() != previous:
            raise RuntimeError("Paper disk/live routes disagree")
        protected = self.host.protected()
        if not self.host.memory_available():
            raise RuntimeError("insufficient memory for a standby Paper controller")
        self.host.pull(target["service"], SERVICE_REF, sha)
        runtime_source = self.host.pull(target["runtime"], RUNTIME_REF)
        self.source.require_runtime(runtime_source, sha)
        self.source.ensure(target)
        durable_json(self.transaction, {"candidate": candidate, "previous": previous})
        print(f"Preparing Paper controller {sha}; new starts will use {target['runtime']}", flush=True)
        try:
            self.host.create(candidate, target["service"], target["runtime"])
            self.host.start(candidate)
            self.host.warm(candidate, protected)
            self.source.ensure(target)
            self.host.known({candidate, previous})
            self.host.switch(previous, "all")
            with self.host.barrier(target["service"]) as held:
                self.host.known({candidate, previous})
                self.host.ensure_protected(protected)
                # Include a start accepted by the previous controller during candidate preparation.
                self.host.compatible(candidate)
                protected = self.host.protected()
                held()
                self.host.phase(previous, "all", None)
                self.host.stop(previous)
                held()
                self.host.phase(previous, "all", None)
                self.host.persist_route(candidate, "starts")
                self.host.switch(candidate, "starts")
            active_web = self.host.web.disk_route()
            self.host.web.observe(active_web, self.host.web.lines(active_web), protected)
            self.source.ensure(target)
            self.host.phase(candidate, "starts", "starts")
            self.host.ensure_protected(protected)
            self.clear()  # no new-runtime start is allowed before this commit point
            self.host.normalize()
            print(f"Committed Paper controller {sha}; existing runner/egress containers were not restarted", flush=True)
        except Exception:
            self.recover()
            raise

    def tick(self):
        self.recover()
        target = self.source.approved()
        if target.get("image") and target.get("service") and target.get("runtime"):
            # The Web of the same revision goes first.
            if self.host.web.disk_route().endswith(target["revision"]):
                self.apply(target)
