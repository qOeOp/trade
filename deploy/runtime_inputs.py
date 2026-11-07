"""Compare runtime build and qualification inputs, without executing fetched source.

The publisher and installed host controller use this same projection. This is deliberately
the small Dockerfile vocabulary used by our runtime, not a general Dockerfile interpreter.
An unfamiliar way to consume build context must be reviewed before its image can be reused.
"""

import fnmatch
import hashlib
import json
from pathlib import PurePosixPath
import re
import shlex
import sys


DOCKERFILE = "engine/runtime/Dockerfile"
DEFINITIONS = (
    ".dockerignore", "engine/runtime/Dockerfile.dockerignore",
    ".github/workflows/runtime-image.yml", ".github/scripts/publish-platform-image.sh",
    ".github/scripts/check-native-runtime.py", ".github/scripts/ci-paths.py",
    ".github/actions/ci-paths/action.yml", "deploy/runtime_inputs.py",
)
SHA = re.compile(r"[0-9a-f]{40}\Z")


def _path(value):
    if (not isinstance(value, str) or not value or value.startswith("/") or "\\" in value
            or "\x00" in value or any(part in ("", ".", "..") for part in value.split("/"))):
        raise ValueError("runtime input has an invalid repository path")
    return value


def project(tree, dockerfile):
    """Return a complete sorted (path, mode, blob) projection from a full Git tree."""
    if not isinstance(tree, list) or not isinstance(dockerfile, str):
        raise ValueError("runtime inputs need a complete tree and its Dockerfile")
    entries = {}
    for item in tree:
        path = _path(item["path"])
        if path in entries or not isinstance(item.get("sha"), str) or not SHA.fullmatch(item["sha"]):
            raise ValueError("runtime tree has duplicate paths or invalid object identities")
        entries[path] = item
    selected = set()

    def include(path):
        item = entries.get(path)
        if item is None or item.get("type") != "blob" or item.get("mode") not in ("100644", "100755"):
            raise ValueError("runtime input is missing or is not a regular tracked file")
        selected.add(path)

    include(DOCKERFILE)
    content = dockerfile.encode("utf-8")
    identity = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
    if entries[DOCKERFILE]["sha"] != identity:
        raise ValueError("Dockerfile content does not match its Git tree identity")
    for path in DEFINITIONS:
        if path in entries:
            include(path)

    stages = set()
    stage_count = 0
    copies = 0
    for physical in dockerfile.splitlines():
        line = physical.strip()
        if not line or line.startswith("#"):
            if re.match(r"#\s*(syntax|escape)\s*=", line, flags=re.IGNORECASE):
                raise ValueError("Dockerfile parser directives need an input contract review")
            continue
        if line.endswith("\\"):
            raise ValueError("continued Dockerfile instructions need an input contract review")
        parts = line.split(None, 1)
        instruction = parts[0].upper()
        argument = parts[1] if len(parts) == 2 else ""
        if instruction == "FROM":
            words = shlex.split(argument)
            if (len(words) not in (1, 3) or not re.fullmatch(r"[^\s$]+@sha256:[0-9a-f]{64}", words[0])
                    or len(words) == 3 and (words[1].upper() != "AS" or not re.fullmatch(r"[A-Za-z0-9_-]+", words[2]))):
                raise ValueError("runtime base images must use the reviewed digest-pinned FROM contract")
            stages.add(str(stage_count))
            stage_count += 1
            if len(words) == 3:
                stages.add(words[2].lower())
        elif instruction in ("ADD", "ONBUILD") or instruction == "RUN" and "--mount" in argument:
            raise ValueError("additional build-context consumers need an input contract review")
        elif instruction == "COPY":
            if argument.startswith("[") or "$" in argument:
                raise ValueError("dynamic or JSON COPY needs an input contract review")
            words = shlex.split(argument)
            if words and words[0].startswith("--from="):
                if words[0].split("=", 1)[1].lower() not in stages or len(words) < 3:
                    raise ValueError("COPY may only reference a declared build stage")
                if any(word.startswith("--") for word in words[1:]):
                    raise ValueError("unrecognized stage COPY option")
                continue
            if len(words) < 2 or any(word.startswith("--") for word in words):
                raise ValueError("unrecognized local COPY options")
            for source in words[:-1]:
                source = source.rstrip("/")
                _path(source)
                if "**" in source or any(char in source for char in ("?", "[", "]")):
                    raise ValueError("unrecognized local COPY glob")
                pattern = PurePosixPath(source).parts
                matches = []
                for path, entry in entries.items():
                    parts = PurePosixPath(path).parts
                    # Docker's glob can match a directory (even one named plugin.py).
                    # Compare path prefixes so its entire subtree participates, whether
                    # the tree source includes directory entries (API) or only leaves (Git).
                    matched = len(parts) >= len(pattern) and all(
                        fnmatch.fnmatchcase(part, glob) for part, glob in zip(parts, pattern, strict=False))
                    if matched and entry.get("type") != "tree":
                        matches.append(path)
                if not matches:
                    raise ValueError("local COPY has no tracked regular inputs")
                for path in matches:
                    include(path)
                copies += 1
        elif instruction not in {
            "RUN", "WORKDIR", "ENV", "LABEL", "CMD", "ARG", "ENTRYPOINT", "EXPOSE",
            "USER", "VOLUME", "STOPSIGNAL", "HEALTHCHECK", "SHELL",
        }:
            raise ValueError("unrecognized Dockerfile instruction needs an input contract review")
    if not stage_count or not copies:
        raise ValueError("runtime Dockerfile has no recognized base or local inputs")
    return tuple((path, entries[path]["mode"], entries[path]["sha"]) for path in sorted(selected))


def main():
    payload = json.load(sys.stdin)
    print(json.dumps(project(payload["tree"], payload["dockerfile"]), separators=(",", ":")))


if __name__ == "__main__":
    main()
