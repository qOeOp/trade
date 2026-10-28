"""Select CI work from the complete PR merge diff, without GitHub's path-list limit."""

import os
import subprocess


def main() -> None:
    changed = True
    if os.environ["CI_EVENT_NAME"] == "pull_request":
        base = os.environ["CI_BASE_SHA"]
        paths = os.environ["CI_PATHS"].splitlines()
        if not base or not paths or any(not path for path in paths):
            raise ValueError("A PR base and nonempty path patterns are required")
        result = subprocess.run(
            ["git", "diff", "--quiet", base, "HEAD", "--", *(f":(top,glob){path}" for path in paths)], check=False
        )
        if result.returncode not in (0, 1):
            raise RuntimeError("Cannot determine the PR's changed paths")
        changed = result.returncode == 1
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"changed={str(changed).lower()}\n")


if __name__ == "__main__":
    main()
