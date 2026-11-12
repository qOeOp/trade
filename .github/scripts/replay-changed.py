"""Select the replay image build: does HEAD's replay input differ from the build it would replace?

A pull request compares with its base, as ci-paths.py does. A push to main compares with the revision the current
replay image (`main`) was built from, read from its label: a replay input changed since that build, or no such build
can be read, selects a build. Comparing with the image, not with the previous push, means a cancelled or failed run
leaves the next one to build, so `main` never stays behind the replay inputs on main. Any other event builds.
A difference only in this project's own version (`pyproject.toml`'s `project.version` and that package's entry in
`uv.lock`, both copied into the image) selects no build: a release raises it, and a new digest would leave every
passed run behind the image for nothing the replay executes.
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
    return any(not _same_but_version(name, base) for name in result.stdout.splitlines())


def _show(revision: str, name: str) -> str:
    return subprocess.run(["git", "show", f"{revision}:{name}"], check=True, capture_output=True, text=True).stdout


def _without_version(name: str, text: str, own: str) -> dict:
    """`pyproject.toml` or `uv.lock` parsed, with the version of the project named `own` removed."""
    data = tomllib.loads(text)
    packages = [data["project"]] if name == "pyproject.toml" else data["package"]
    for package in packages:
        if package["name"] == own:
            package.pop("version", None)
    return data


def _same_but_version(name: str, base: str) -> bool:
    """Whether `name` differs between `base` and HEAD only in this project's own version."""
    if name not in ("pyproject.toml", "uv.lock"):
        return False
    try:
        own = tomllib.loads(_show("HEAD", "pyproject.toml"))["project"]["name"]
        return _without_version(name, _show(base, name), own) == _without_version(name, _show("HEAD", name), own)
    except (subprocess.CalledProcessError, tomllib.TOMLDecodeError, KeyError, TypeError):
        return False


def main() -> None:
    value = changed(os.environ["CI_EVENT_NAME"], os.environ["CI_PATHS"].splitlines(),
                    os.environ.get("CI_BASE_SHA", ""), os.environ["CI_REPLAY_IMAGE"])
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"changed={str(value).lower()}\n")


if __name__ == "__main__":
    main()
