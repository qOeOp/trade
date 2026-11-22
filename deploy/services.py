"""The long-lived compose services of the release host follow the routed version (deploy/release.py Release.follow):
each is recreated when what the version's own compose definition creates differs from the running container.

What compose creates is compared, not only the image: compose's own configuration hash of the service (its
`com.docker.compose.config-hash` label), the host file each file-based config is mounted from and the content of each
inline config (`definitions`, `follows`). So a version that changes a command, a mount, the Caddyfile
or OAuth2 Proxy's settings reaches the host with no operator step, and a service whose definition is unchanged is left
alone (docs/plans/release-moves-ledger-mirror-20261116.zh.md; doctor 20261122-32).
"""

from datetime import datetime, UTC
import io
import json
import subprocess
import tarfile
import time

from .live_host import LiveBusy
from .release_host import (
    DOCKER_API,
    DOCKER_API_IMAGE,
    DOCKER_API_REF,
    FOLLOWERS,
    DockerFailure,
    PAPER_ROUTER,
    SERVICE_IMAGE,
    SERVICE_REF,
    SERVICES,
    WEB,
    DockerHost,
    revision,
    until_ready,
)
from .source import GitSource

# Paper states whose run the controller is about to stop, resume or seal: a lifecycle operation is due.
PAPER_OPERATIONS = frozenset({"stopping", "ended", "unsealed"})
PAPER_LISTING_SECONDS = 3  # past the Paper controller's listing cache (paper/serve.py LIST_SECONDS)
# The services whose image a version names through a variable of deploy/compose.yaml: only these are put back on the
# image they ran before when a move fails. The others change only with the definition, which a move cannot put back.
VARIABLES = {"ledger": SERVICE_IMAGE, "market-import": SERVICE_IMAGE, "docker-api": DOCKER_API_IMAGE}


# A compose service a move put back (Follow.move) is created after the routed Web, as one the operator recreated is.
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


def images(github: GitSource, target: dict) -> dict[str, str]:
    """The image variables of version `target`'s compose definition: its admitted service digest, and the docker-api
    digest its deploy/compose.yaml pins (passed in the process environment, over the env file)."""
    return {SERVICE_IMAGE: target["service"], DOCKER_API_IMAGE: github.docker_api(target["revision"])}


def drift(host: DockerHost, github: GitSource) -> dict[str, str]:
    """What on the host does not follow the active version (doctor 20261116-04): docker-api against the digest the
    version pins, and the compose services of the service image against its digest, once the release no longer
    moves them (Follow.run)."""
    sha = revision(host.disk_route())
    short = sha[:12]
    facts = {}
    since, now = host.created(WEB + sha), time.time()
    pin = github.docker_api(sha)
    running = host.inspect(DOCKER_API)["image"]
    if running != pin and host.created(DOCKER_API) > since and retry(since, host.created(DOCKER_API), now) == "over":
        # One created before the routed Web, or whose retries are not spent, is moved by a settled tick (Follow.run).
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


def definitions(host: DockerHost, files: list[str], env: dict[str, str]) -> dict[str, dict]:
    """What compose creates for each service of `files` with the image variables `env` over the env file: its
    image, compose's configuration hash of it (`config --hash`, the CONFIG_HASH label of what `up` creates) and
    each config it puts in the container by target: a file's host path, which compose bind mounts, or inline
    content, which it copies in. The hash leaves out what a config holds and where its file is."""
    hashes = dict(line.split(" ", 1) for line in host.compose(files, "config", "--hash", "*", env=env).splitlines()
                  if line.strip())
    project = json.loads(host.compose(files, "config", "--format", "json", env=env))
    found = {}
    for name, value in hashes.items():
        service, configs = project["services"][name], {}
        for used in service.get("configs") or []:
            source = project["configs"][used["source"]]
            target = used.get("target") or f"/{used['source']}"
            configs[target] = {"file": source["file"]} if "file" in source else {"content": source.get("content")}
        found[name] = {"image": service["image"], "hash": value.strip(), "configs": configs}
    return found


def follows(host: DockerHost, name: str, found: dict, wanted: dict) -> bool:
    """Whether the running container `name` (`follower`'s facts) is what `wanted` (`definitions`) creates."""
    if found["image"] != wanted["image"] or found["hash"] != wanted["hash"]:
        return False
    return all(found["mounts"].get(target) == config["file"] if "file" in config
               else content(host, name, target) == config["content"]
               for target, config in wanted["configs"].items())


def content(host: DockerHost, name: str, path: str) -> str | None:
    """The text of file `path` in container `name`, read with `docker cp` (no shell in the image needed); None
    when it cannot be read."""
    try:
        with tarfile.open(fileobj=io.BytesIO(host.docker("cp", f"{name}:{path}", "-", binary=True))) as archive:
            member = archive.next()
            held = archive.extractfile(member) if member is not None else None
            return held.read().decode() if held is not None else None
    except (DockerFailure, tarfile.TarError, UnicodeDecodeError):
        return None


class Follow:
    """Recreate the long-lived compose services whose definition the routed version changed, under the release's
    conditions: no Paper operation in progress, Paper writes paused, Live idle inside its account lock."""

    def __init__(self, release, report):
        self.release, self.host, self.github, self.report = release, release.host, release.github, report

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

    def run(self, active: str) -> None:
        """Recreate each running service of SERVICES whose container differs from what the committed version's own
        compose files create (DockerHost.definition, `definitions`), the image variables naming its service
        digest and its docker-api pin. A running service created after the active Web was recreated since this
        version committed, by a move undone or by the operator: it is moved again under the same conditions once
        `retry` says so, at most FOLLOW_ATTEMPTS moves per version, and then stays until the next version (`drift`
        sends the notice). One that is absent or stopped is the operator's and is never started."""
        sha = revision(active)
        target = self.github.approved()
        if target["revision"] != sha or target["service"] is None:
            return
        present = {name: found for name, container, _ in SERVICES if (found := self.host.follower(container))}
        if not present:
            return
        env = images(self.github, target)
        files = self.host.definition(target["service"], sha)
        wanted = definitions(self.host, files, env)
        since, now = self.host.created(active), time.time()
        moving = []
        for name, container, healthy in SERVICES:
            found = present.get(name)
            if found is None or name not in wanted or follows(self.host, container, found, wanted[name]):
                continue
            again = retry(since, found["created"], now) if found["created"] > since else "due"
            if again == "over":
                print(f"{name} was recreated after {active} and its retries are spent; it stays as it is until the "
                      "next version", flush=True)
                continue
            if again == "wait":
                print(f"{name} was recreated after {active} (a move undone, or by hand); the release moves it again "
                      f"{FOLLOW_RETRY_SECONDS // 60} minutes after that", flush=True)
                continue
            moving.append((name, container, healthy, found["image"]))
        if not moving:
            return
        if self.paper_quiet(active) is None:
            print("The compose services wait until no Paper operation is in progress", flush=True)
            return
        for name, _, _, running in moving:
            image = wanted[name]["image"]
            if image != running and VARIABLES.get(name) == DOCKER_API_IMAGE:
                self.host.pull(image, DOCKER_API_REF)  # this repository and amd64, built from an earlier commit
            elif image != running and VARIABLES.get(name) == SERVICE_IMAGE:
                self.host.pull(image, SERVICE_REF, sha)
        paper = self.release.paper().host
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
            with self.release.live.barrier(active, idle=True) as held:
                held()
                self.move(active, controller, moving, wanted, files, env, held)
        except LiveBusy as busy:
            print(f"{busy}; the compose services wait until Live is idle", flush=True)
            return
        finally:
            paper.normalize()
        self.recovered(active, before)

    def move(self, web: str, controller: str, moving: list, wanted: dict, files: list[str], env: dict[str, str],
             held) -> None:
        """Recreate each service from the version's definition, then check what reads them; on any failure put back
        every one it touched whose image a variable names on the image it ran before, and fail the tick. A service is
        recreated, never only restarted, so it also mounts what the definition names now. While docker-api is down the
        Paper controller's Docker calls fail (its listing, start, stop, resume and seal refuse with
        RUNTIME_UNAVAILABLE) and running runs, whose containers the engine runs, go on. A new Paper router loads the
        unpaused route from disk, so the pause is applied to it again."""
        paper = self.release.paper().host
        touched = []
        try:
            for name, container, healthy, _ in moving:
                touched.append(name)
                image = wanted[name]["image"]
                print(f"Moving {name} to {image} and its version's definition", flush=True)
                self.host.recreate(name, container, image, healthy, files, env,
                                   pull=VARIABLES.get(name) is None)  # a third-party image pinned by digest
                if container == PAPER_ROUTER:
                    paper.switch(controller, "all")
                held()

            def readers() -> None:
                # Not /api/live: this move holds the Live account lock that its listing waits on (doctor 20261117-02).
                # The services moved here are not on the Web to Live control path it would check.
                self.host.health(web, [], routed=True, live=False)
                paper.health(controller)  # its listing reads Docker through docker-api
                self.host.auth_denied()  # the public boundary: edge and OAuth2 Proxy

            until_ready(readers, 180, 5, errors=(RuntimeError, ValueError, KeyError, subprocess.SubprocessError))
        except Exception as error:
            self.report("services", error)
            try:
                for name, container, healthy, previous in reversed(moving):
                    variable = VARIABLES.get(name)
                    if name in touched and variable is not None and previous != wanted[name]["image"]:
                        self.host.recreate(name, container, previous, healthy, files, {**env, variable: previous},
                                           pull=True)
            except Exception as undo:
                self.report("services", undo)
                raise RuntimeError("compose services did not move nor return; left for the operator") from undo
            raise RuntimeError("compose services did not move; previous images restored") from error
        print(f"Moved {', '.join(touched)}", flush=True)
