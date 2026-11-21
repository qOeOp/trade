"""Select CI work from the complete PR merge diff, without GitHub's path-list limit.

The patterns are the calling workflow's own `on.push.paths` (CI_WORKFLOW, `github.workflow_ref`), so a component
runs on a pull request exactly when its push run on main would: release-ready.cjs reads "no push run" as "nothing to
release". A workflow whose push is not filtered names its patterns instead (CI_PATHS).
"""

import os
import subprocess


def pathspec(path: str) -> str:
    """A pattern selects its files; with a leading `!` it leaves them out of the other patterns."""
    return f":(top,glob,exclude){path[1:]}" if path.startswith("!") else f":(top,glob){path}"


def push_paths(source: str) -> list[str]:
    """The `on.push.paths` list of a workflow, in the block layout every workflow here uses: two spaces per level,
    one `- pattern` per line, quoted when it starts with `!`. Blank and comment lines are skipped."""
    keys: list[str] = []  # the block keys enclosing the current line, one per level
    found = []
    for line in source.splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        level = (len(line) - len(line.lstrip())) // 2
        if keys == ["on", "push", "paths"] and level == 3 and text.startswith("- "):
            item = text[2:].strip()
            found.append(item[1:-1] if len(item) > 1 and item[0] == item[-1] and item[0] in "'\"" else item)
            continue
        if found:
            break
        keys = keys[:level] + ([text[:-1]] if text.endswith(":") else [])
    if not found:
        raise ValueError("the workflow has no on.push.paths list")
    return found


def workflow(reference: str) -> str:
    """The repository path of the running workflow from `github.workflow_ref` (owner/repo/path@ref)."""
    path = reference.rpartition("@")[0].split("/", 2)[2]
    if not path.startswith(".github/workflows/"):
        raise ValueError("the running workflow is not a repository workflow")
    return path


def main() -> None:
    changed = True
    if os.environ["CI_EVENT_NAME"] == "pull_request":
        base = os.environ["CI_BASE_SHA"]
        named = os.environ.get("CI_PATHS", "")
        if named:
            paths = named.splitlines()
        else:
            with open(workflow(os.environ["CI_WORKFLOW"]), encoding="utf-8") as source:
                paths = push_paths(source.read())
        if not base or not paths or any(not path for path in paths):
            raise ValueError("A PR base and nonempty path patterns are required")
        result = subprocess.run(
            ["git", "diff", "--quiet", base, "HEAD", "--", *map(pathspec, paths)], check=False
        )
        if result.returncode not in (0, 1):
            raise RuntimeError("Cannot determine the PR's changed paths")
        changed = result.returncode == 1
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"changed={str(changed).lower()}\n")


if __name__ == "__main__":
    main()
