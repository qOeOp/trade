"""The release control's handoff: each admitted version is released by its own control code.

The host runs `deploy/remote/trade-release-tick`, which starts `python3 -m deploy.release tick` in
`/var/lib/trade-release/control/current`, or in the bootstrap copy `install-release.sh` put at `/opt/trade-release`
until the first handoff. A settled tick whose admitted `deploy-ready` revision differs from the running control's
copies `/opt/trade/deploy/*.py` out of that version's service image, which CI built and `deploy-ready` pins by digest,
without running the image, then points `current` at it and ends; the launcher runs the tick again under it.

Every later version's handoff runs through this code of the version before it: keep it small and keep its
contract (`deploy.release` and `deploy.control` importable with the host's python3, exit status HANDOFF).
"""

import os
from pathlib import Path
import shutil
import subprocess
import sys

from .release_host import REVISION, SERVICE_REF, DockerHost, sync_directory


CONTROLS = "control"  # under the release state
CURRENT = "current"
HANDOFF = 3  # the exit status of a tick that handed control over: the launcher runs one more tick
IMAGE_DEPLOY = "/opt/trade/deploy"  # deploy/Dockerfile: WORKDIR /opt/trade, COPY . ./ (deploy/*.py)
EXTRACTOR = "trade-release-control-extract"
IMPORTS = ("deploy.release", "deploy.control")
CHECK = ("import importlib, sys\n"
         "root = sys.argv[1]\n"
         "sys.path.insert(0, root)\n"
         "for name in sys.argv[2:]:\n"
         "    if not importlib.import_module(name).__file__.startswith(root + '/'):\n"
         "        raise SystemExit(name + ' did not load from the staged control')\n")


def running(state: Path, code: Path = Path(__file__)) -> str | None:
    """The revision of the control this process runs: the name of its directory under `state/control`. The
    bootstrap copy has none."""
    root = code.resolve().parent.parent
    if root.parent == (state / CONTROLS).resolve() and REVISION.fullmatch(root.name):
        return root.name
    return None


def _durable_copy(source: Path, target: Path) -> None:
    with target.open("wb") as out:
        out.write(source.read_bytes())
        os.fchmod(out.fileno(), 0o644)
        out.flush()
        os.fsync(out.fileno())


def hand_off(host: DockerHost, target: dict, current: str | None, python: str = sys.executable) -> None:
    """Install the control code of `target`'s service image as `control/<revision>` and point `current` at it.
    Nothing it does touches a route or a release container; a failure leaves `current` where it was."""
    sha = target["revision"]
    service = target["service"]
    if not REVISION.fullmatch(sha) or not isinstance(service, str):
        raise RuntimeError("admitted control has no revision or service image")
    controls = host.state / CONTROLS
    if os.path.islink(controls / CURRENT) and os.readlink(controls / CURRENT) == sha:
        print(f"Release control {sha} is already current", flush=True)  # the installer run again
        return
    host.pull(service, SERVICE_REF, sha)  # amd64, this repository, this revision, the admitted digest
    controls.mkdir(mode=0o700, exist_ok=True)
    staged = controls / f"{sha}.new"
    shutil.rmtree(staged, ignore_errors=True)  # an interrupted handoff's copy
    staged.mkdir(mode=0o700)
    host.docker("rm", "--force", EXTRACTOR, check=False)
    host.docker("create", "--name", EXTRACTOR, "--network", "none", service, "true")  # created, never started
    try:
        host.docker("cp", f"{EXTRACTOR}:{IMAGE_DEPLOY}", str(staged / "image"))
    finally:
        host.docker("rm", "--force", EXTRACTOR, check=False)
    modules = staged / "deploy"
    modules.mkdir()
    for path in sorted((staged / "image").iterdir()):
        if path.suffix == ".py" and path.is_file() and not path.is_symlink():
            _durable_copy(path, modules / path.name)
    shutil.rmtree(staged / "image")
    sync_directory(modules)
    sync_directory(staged)
    checked = subprocess.run([python, "-I", "-B", "-c", CHECK, str(staged), *IMPORTS],
                             capture_output=True, text=True, timeout=120, check=False)
    if checked.returncode:
        raise RuntimeError("the admitted control does not import with the host's python3; keeping the current control")
    installed = controls / sha
    if installed.exists():
        shutil.rmtree(installed)  # a copy an interrupted handoff renamed but never pointed `current` at
    staged.rename(installed)
    link = controls / f"{CURRENT}.new"
    if os.path.lexists(link):
        link.unlink()
    link.symlink_to(sha)
    link.replace(controls / CURRENT)
    sync_directory(controls)
    for path in controls.iterdir():  # keep the new control and the one handing over, which is still running
        if path.name not in {CURRENT, sha, current or ""}:
            if path.is_symlink() or not path.is_dir():
                path.unlink()
            else:
                shutil.rmtree(path)
    print(f"Handed release control from {current or 'the bootstrap copy'} to {sha}; "
          "the next tick runs under it", flush=True)
