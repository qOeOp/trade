"""Fail when a tracked text file still holds a merge conflict marker: a line starting with `<<<<<<< `, `>>>>>>> ` or
`||||||| `, or a bare `=======` inside such a block. A squash can carry one onto main unnoticed (#3244)."""

import re
import subprocess
import sys


OPEN = re.compile(r"(<<<<<<<|\|\|\|\|\|\|\|) ")
CLOSE = re.compile(r">>>>>>> ")


def markers(text: str) -> list[int]:
    """The 1-based numbers of the lines that are conflict markers."""
    found, inside = [], False
    for number, line in enumerate(text.splitlines(), 1):
        if OPEN.match(line):
            found.append(number)
            inside = True
        elif CLOSE.match(line):
            found.append(number)
            inside = False
        elif inside and line == "=======":
            found.append(number)
    return found


def main() -> int:
    # Text files only (-I): a binary file can hold these bytes by chance.
    names = subprocess.run(["git", "grep", "-I", "-l", "-z", "-E", r"^(<<<<<<< |>>>>>>> |\|{7} )"],
                           capture_output=True, check=False)
    if names.returncode not in (0, 1):
        raise RuntimeError(names.stderr.decode(errors="replace"))
    failed = False
    for name in filter(None, names.stdout.decode().split("\0")):
        with open(name, encoding="utf-8", errors="replace") as source:
            for number in markers(source.read()):
                print(f"::error file={name},line={number}::merge conflict marker")
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
