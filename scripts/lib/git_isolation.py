"""
Run git on a repository other than the one that started this process, without touching
the latter.

The Python side of scripts/lib/git-isolation.bash, which says why. Import it before the first git
call: `isolate_git_environment()` clears every GIT_* variable, and `init_fixture_repository()`
refuses a repository that is not the directory it was asked for.

"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


GIT = shutil.which("git") or "git"


def isolate_git_environment() -> None:
    for name in [name for name in os.environ if name.startswith("GIT_")]:
        del os.environ[name]


def init_fixture_repository(directory: Path) -> None:
    """
    Create an empty repository at `directory`, proven to be that directory.
    """
    isolate_git_environment()
    subprocess.run([GIT, "init", "-q", "--initial-branch=main", str(directory)], check=True)
    toplevel = subprocess.run(
        [GIT, "-C", str(directory), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if Path(toplevel).resolve() != directory.resolve():
        raise SystemExit(f"git-isolation: {directory} resolves to the repository at {toplevel}")
    for key, value in (("user.email", "fixture@example.invalid"), ("user.name", "fixture")):
        subprocess.run([GIT, "-C", str(directory), "config", key, value], check=True)
