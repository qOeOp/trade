"""Select the replay image build: does HEAD's replay input differ from the build it would replace?

A pull request compares with its base, as ci-paths.py does. A push to main compares with the revision the current
replay image (`main`) was built from, read from its label: a replay input changed since that build, or no such build
can be read, selects a build. Comparing with the image, not with the previous push, means a cancelled or failed run
leaves the next one to build, so `main` never stays behind the replay inputs on main. Any other event builds.
A difference only in what the image copies but never reads selects no build, since a new digest would leave every
passed run behind the image: `pyproject.toml`'s `project.version`, `build-system` and `tool.uv.build-backend`, which
an install with `--no-install-project` never reads, and `uv.lock`'s version of the project's own (editable) package,
which `dependency_lock_sha256` (engine/config.py) leaves out, so a release changes no replay identity. Any other
`uv.lock` difference builds: Live backs a run only with replays whose `dependency_lock_sha256` equals its execution
image's (live/runs.py REPLAY_CODE).
"""

import json
import os
import shlex
import subprocess
import tomllib
from urllib.request import Request, urlopen


ACCEPT = ", ".join(f"application/vnd.{kind}+json" for kind in (
    "oci.image.index.v1", "oci.image.manifest.v1",
    "docker.distribution.manifest.list.v2", "docker.distribution.manifest.v2"))


WORKFLOW = ".github/workflows/runtime-image.yml"
DOCKERFILE = "engine/runtime/replay.Dockerfile"


def replay_paths(root: str = ".") -> list[str]:
    """What a replay build reads: the workflow that builds it, its Dockerfile and ignore file, and every file the
    Dockerfile copies from the build context (the replay closure, pyproject.toml and uv.lock). `root` is the
    checkout."""
    copied = []
    with open(os.path.join(root, DOCKERFILE), encoding="utf-8") as source:
        for line in source:
            words = [] if line.lstrip().startswith("#") else shlex.split(line)
            if words[:1] == ["COPY"] and not any(word.startswith("--from=") for word in words):
                copied += [word for word in words[1:-1] if not word.startswith("--")]
    return [WORKFLOW, DOCKERFILE, f"{DOCKERFILE}.dockerignore", *copied]


def pathspec(path: str) -> str:
    return f":(top,glob,exclude){path[1:]}" if path.startswith("!") else f":(top,glob){path}"


def _get(url: str, token: str, accept: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}", **({"Accept": accept} if accept else {})}
    with urlopen(Request(url, headers=headers), timeout=60) as response:
        return json.load(response)


def built_from(image: str) -> str | None:
    """The revision label of `image` (registry/name:tag), read anonymously; None when it cannot be read."""
    registry, rest = image.split("/", 1)
    name, tag = rest.rsplit(":", 1)
    try:
        with urlopen(f"https://{registry}/token?scope=repository:{name}:pull", timeout=60) as response:
            token = json.load(response)["token"]
        manifest = _get(f"https://{registry}/v2/{name}/manifests/{tag}", token, ACCEPT)
        if "manifests" in manifest:
            child = next(item["digest"] for item in manifest["manifests"]
                         if item.get("platform", {}).get("architecture") == "amd64")
            manifest = _get(f"https://{registry}/v2/{name}/manifests/{child}", token, ACCEPT)
        config = _get(f"https://{registry}/v2/{name}/blobs/{manifest['config']['digest']}", token)
        revision = config["config"]["Labels"]["org.opencontainers.image.revision"]
    except (OSError, ValueError, KeyError, StopIteration, TypeError):
        return None
    return revision if isinstance(revision, str) else None


def changed(event: str, paths: list[str], base: str, image: str) -> bool:
    if not paths or any(not path for path in paths):
        raise ValueError("nonempty path patterns are required")
    if event == "pull_request":
        if not base:
            raise ValueError("a PR base is required")
    elif event == "push":
        base = built_from(image) or ""
        if not base or subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], check=False,
                                      capture_output=True).returncode:
            return True
    else:
        return True
    result = subprocess.run(["git", "diff", "--name-only", base, "HEAD", "--", *map(pathspec, paths)], check=False,
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("cannot compare the replay inputs")
    return any(not _same_replay(name, base) for name in result.stdout.splitlines())


def _show(revision: str, name: str) -> str:
    return subprocess.run(["git", "show", f"{revision}:{name}"], check=True, capture_output=True, text=True).stdout


def _replayed(text: str) -> dict:
    """`pyproject.toml` parsed, without its project version or build backend."""
    data = tomllib.loads(text)
    data["project"].pop("version", None)
    data.pop("build-system", None)
    data.get("tool", {}).get("uv", {}).pop("build-backend", None)
    return data


def _locked(text: str) -> dict:
    """`uv.lock` parsed, without the project's own version, as engine.config.dependency_lock_sha256 reads it."""
    data = tomllib.loads(text)
    for package in data.get("package", []):
        if package.get("source") == {"editable": "."}:
            package.pop("version", None)
    return data


def _same_replay(name: str, base: str) -> bool:
    """Whether `name` differs between `base` and HEAD only in what the replay image never reads."""
    read = {"pyproject.toml": _replayed, "uv.lock": _locked}.get(name)
    if read is None:
        return False
    try:
        return read(_show(base, name)) == read(_show("HEAD", name))
    except (subprocess.CalledProcessError, tomllib.TOMLDecodeError, KeyError, TypeError, AttributeError):
        return False


def main() -> None:
    value = changed(os.environ["CI_EVENT_NAME"], replay_paths(), os.environ.get("CI_BASE_SHA", ""),
                    os.environ.get("CI_REPLAY_IMAGE", ""))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"changed={str(value).lower()}\n")


if __name__ == "__main__":
    main()
