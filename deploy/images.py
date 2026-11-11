"""Name the images CI admitted in a compose env file (README.md here, Image versions).

The channel admits amd64 digests. This host may be arm64, so each admitted digest must sit in its
build's published platform manifest, and the env file gets this CPU's image from that manifest.
Everything read is public and read with no credential. Nothing is pulled or recreated.
The default channel, deploy-ready, admits versions (production; a server runs this too); main-ready admits
every checked main build (staging).
"""

import argparse
import json
import os
from pathlib import Path
import platform
from typing import Callable
import sys
import tempfile
from urllib.request import Request, urlopen

from .release import GitSource
from .release_host import IMAGE_REF, REVISION, RUNTIME_REF, SERVICE_REF, SOURCE, sync_directory


# Field, env key, pattern and the tag prefix of the build's platform index. The release's runtime is the execution
# image for Paper and Live (`exec-sha-REV` in ghcr.io/qoeop/trade-runtime, beside the replay image's `sha-REV`).
# A runtime built before the split (its revision has no SPLIT file) is the one combined image, which replays and
# executes; its own index is `sha-REV`, and its amd64 child must still be the admitted digest.
FIELDS = (
    ("image", "TRADE_IDE_IMAGE", IMAGE_REF, ""),
    ("service", "TRADE_SERVICE_IMAGE", SERVICE_REF, ""),
    ("runtime", "TRADE_RUNTIME_IMAGE", RUNTIME_REF, "exec-"),
)
EXECUTION = dict((field, prefix) for field, _, _, prefix in FIELDS)["runtime"]
SPLIT = "engine/runtime/replay.Dockerfile"
CHANNELS = {"deploy": "deploy-ready", "main": "main-ready"}
ARCHITECTURES = {"arm64": "arm64", "aarch64": "arm64", "amd64": "amd64", "x86_64": "amd64"}
MANIFESTS = ", ".join(
    f"application/vnd.{kind}+json"
    for kind in (
        "oci.image.index.v1",
        "oci.image.manifest.v1",
        "docker.distribution.manifest.list.v2",
        "docker.distribution.manifest.v2",
    )
)


class Registry:
    """Anonymous reads of the public GHCR packages."""

    def __init__(self):
        self.tokens = {}

    def get(self, repository: str, path: str, accept: str | None = None) -> dict:
        name = repository.removeprefix("ghcr.io/")
        if name not in self.tokens:
            self.tokens[name] = self.fetch(f"https://ghcr.io/token?scope=repository:{name}:pull", {})["token"]
        headers = {"Authorization": f"Bearer {self.tokens[name]}"}
        if accept:
            headers["Accept"] = accept
        return self.fetch(f"https://ghcr.io/v2/{name}/{path}", headers)

    @staticmethod
    def fetch(url: str, headers: dict) -> dict:
        with urlopen(Request(url, headers=headers), timeout=60) as response:
            return json.load(response)

    def manifest(self, repository: str, reference: str) -> dict:
        return self.get(repository, f"manifests/{reference}", MANIFESTS)

    def config(self, repository: str, digest: str) -> dict:
        return self.get(repository, f"blobs/{self.manifest(repository, digest)['config']['digest']}")


def records(source: GitSource, branch: str = CHANNELS["deploy"]):
    """The channel's records, newest first."""
    for commit in source.git("log", "--format=%H", f"refs/heads/{branch}", "--", "release.json").splitlines():
        yield json.loads(source.git("show", f"{commit}:release.json"))


def admitted(history, revision: str | None = None) -> dict:
    """The newest admitted record, or that of one revision. A later null record withholds its revision only."""
    withheld = set()
    for record in history:
        sha = record.get("revision")
        if record.get("image") is None:
            withheld.add(sha)
        elif sha not in withheld and record.get("service") and record.get("runtime") and revision in (None, sha):
            return record
    raise RuntimeError(f"no admitted record for {revision or 'any revision'} names all three images")


def native(registry: Registry, reference: str, pattern, architecture: str, revision: str | None,
           prefix: str | Callable[[str], str] = "") -> tuple[str, str]:
    """This CPU's image of an admitted digest's build, and the revision it was built from. `prefix` is the tag
    prefix of the build's platform index, or a function of the build's revision that gives it."""
    if not isinstance(reference, str) or not pattern.fullmatch(reference):
        raise RuntimeError(f"not an admitted image reference: {reference!r}")
    repository, digest = reference.split("@")

    def built(candidate: str, expected: str) -> str:
        config = registry.config(repository, candidate)
        labels = config["config"]["Labels"]
        source = labels.get("org.opencontainers.image.revision")
        if (
            config["architecture"] != expected
            or labels.get("org.opencontainers.image.source") != SOURCE
            or not isinstance(source, str)
            or not REVISION.fullmatch(source)
        ):
            raise RuntimeError(f"{repository}@{candidate} is not a {expected} image of this repository")
        return source

    source = built(digest, "amd64")
    if revision is not None and source != revision:
        raise RuntimeError(f"{reference} was built from {source}, not the admitted {revision}")
    index = registry.manifest(repository, f"{prefix(source) if callable(prefix) else prefix}sha-{source}")
    children = {
        item.get("platform", {}).get("architecture"): item["digest"]
        for item in index.get("manifests", [])
    }
    if children.get("amd64") != digest:
        raise RuntimeError(f"{reference} is not in the published manifest of {source}")
    child = children.get(architecture)
    if child is None:
        raise RuntimeError(f"{source} has no {architecture} image in {repository}")
    if built(child, architecture) != source:
        raise RuntimeError(f"{repository}@{child} was not built from {source}")
    return f"{repository}@{child}", source


def write_env(path: Path, values: dict) -> None:
    """Replace these keys in one step and leave every other line as it is."""
    lines = path.read_text().splitlines() if path.exists() else []
    kept = [line for line in lines if line.split("=", 1)[0].strip() not in values]
    text = "\n".join([*kept, *(f"{key}={value}" for key, value in values.items())]) + "\n"
    temporary = path.with_name(path.name + ".pending")
    with temporary.open("w") as out:
        out.write(text)
        os.fchmod(out.fileno(), path.stat().st_mode & 0o777 if path.exists() else 0o600)
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


def resolve(source: GitSource, registry: Registry, architecture: str, revision: str | None,
            branch: str = CHANNELS["deploy"]) -> tuple[str, dict]:
    record = admitted(records(source, branch), revision)
    sha = record["revision"]
    main = source.git("rev-parse", "refs/heads/main")

    def runtime_prefix(built: str) -> str:
        if not source.ancestor(built, main):
            raise RuntimeError(f"the runtime was built from {built}, which is not on main")
        return EXECUTION if source.git("ls-tree", "--name-only", built, "--", SPLIT).strip() else ""

    values = {}
    for field, key, pattern, prefix in FIELDS:
        # A runtime carries forward from an earlier build; the IDE and service are built from the record's revision.
        reference, built = native(registry, record[field], pattern, architecture,
                                  None if field == "runtime" else sha, runtime_prefix if field == "runtime" else prefix)
        if not source.ancestor(built, main):
            raise RuntimeError(f"{reference} was built from {built}, which is not on main")
        if field == "runtime":
            source.require_runtime(built, sha)
        values[key] = reference
    return sha, values


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, type=Path, help="the compose env file these three keys are replaced in")
    parser.add_argument("--revision", help="an earlier admitted revision, to go back to it (default: the newest)")
    parser.add_argument("--channel", choices=tuple(CHANNELS), default="deploy",
                        help="deploy: the admitted versions (default); main: every checked main build, for staging")
    parser.add_argument("--arch", choices=("arm64", "amd64"), help="the Docker engine's CPU (default: this machine's)")
    args = parser.parse_args()
    architecture = args.arch or ARCHITECTURES.get(platform.machine().lower())
    if architecture is None:
        raise RuntimeError(f"no images for {platform.machine()}")
    with tempfile.TemporaryDirectory() as state:
        source = GitSource(Path(state))
        source.refresh()
        branch = CHANNELS[args.channel]
        if branch != CHANNELS["deploy"]:  # refresh fetches only the host's refs, main and deploy-ready
            source.git("fetch", "--filter=blob:none", "origin", f"refs/heads/{branch}:refs/heads/{branch}")
        sha, values = resolve(source, Registry(), architecture, args.revision, branch)
    write_env(args.env, values)
    print(json.dumps({"revision": sha, "channel": branch, "architecture": architecture, **values}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"No image changed: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
