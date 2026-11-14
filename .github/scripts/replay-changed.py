"""Select the replay image build: does HEAD's replay input differ from the build it would replace?

A pull request compares with its base, as ci-paths.py does. A push to main compares with the revision the current
replay image (`main`) was built from, read from its label: a replay input changed since that build, or no such build
can be read, selects a build. Comparing with the image, not with the previous push, means a cancelled or failed run
leaves the next one to build, so `main` never stays behind the replay inputs on main. Any other event builds.
A difference only in what the image copies but never reads selects no build, since a new digest would leave every
passed run behind the image: `pyproject.toml`'s `project.version`, `build-system` and `tool.uv.build-backend`, which
an install with `--no-install-project` never reads. Any `uv.lock` difference builds, a release's version line
included: the image hashes the file's bytes into `dependency_lock_sha256` (engine/config.py), and Live backs a run
only with replays whose value equals its execution image's (live/runs.py REPLAY_CODE), which rebuilds on every
`uv.lock` change.
"""

import json
import os
import subprocess
import tomllib
from urllib.request import Request, urlopen


ACCEPT = ", ".join(f"application/vnd.{kind}+json" for kind in (
    "oci.image.index.v1", "oci.image.manifest.v1",
    "docker.distribution.manifest.list.v2", "docker.distribution.manifest.v2"))


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


def _same_replay(name: str, base: str) -> bool:
    """Whether `name` differs between `base` and HEAD only in what the replay image never reads."""
    if name != "pyproject.toml":
        return False
    try:
        return _replayed(_show(base, name)) == _replayed(_show("HEAD", name))
    except (subprocess.CalledProcessError, tomllib.TOMLDecodeError, KeyError, TypeError):
        return False


def main() -> None:
    value = changed(os.environ["CI_EVENT_NAME"], os.environ["CI_PATHS"].splitlines(),
                    os.environ.get("CI_BASE_SHA", ""), os.environ.get("CI_REPLAY_IMAGE", ""))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"changed={str(value).lower()}\n")


if __name__ == "__main__":
    main()
