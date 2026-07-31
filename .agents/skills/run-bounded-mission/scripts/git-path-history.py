#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def escaped_text(value):
    escaped = []
    for character in value:
        if character == "\\":
            escaped.append("\\\\")
        elif character.isascii() and character.isprintable():
            escaped.append(character)
        else:
            codepoint = ord(character)
            width = 4 if codepoint <= 0xFFFF else 8
            prefix = "\\u" if width == 4 else "\\U"
            escaped.append(f"{prefix}{codepoint:0{width}x}")
    return "".join(escaped)


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        super().error(escaped_text(message))


def parse_args():
    parser = SafeArgumentParser(
        description="List bounded Git history and per-path line changes."
    )
    parser.add_argument(
        "--path",
        action="append",
        required=True,
        dest="paths",
        help="Repository-relative path to inspect; repeat for multiple paths.",
    )
    parser.add_argument(
        "--repo",
        default=".",
        help="Path inside the Git repository. Defaults to the current directory.",
    )
    parser.add_argument(
        "--revision",
        default="HEAD",
        help="Git revision or range to inspect. Defaults to HEAD.",
    )
    parser.add_argument("--since", help="Limit commits to this Git date.")
    parser.add_argument("--until", help="Limit commits to this Git date.")
    parser.add_argument(
        "--max-count",
        type=int,
        default=50,
        help="Maximum commits to return, from 1 to 1000. Defaults to 50.",
    )
    parser.add_argument(
        "--max-files",
        type=int,
        default=50,
        help="Maximum file records to return, from 1 to 10000. Defaults to 50.",
    )
    parser.add_argument(
        "--follow",
        action="store_true",
        help="Follow renames. Valid only with one --path.",
    )
    parser.add_argument(
        "--include-merges",
        action="store_true",
        help="Include merge commits and compare them with their first parent.",
    )
    parser.add_argument(
        "--format",
        choices=("table", "json"),
        default="table",
        help="Output format. Defaults to table.",
    )
    args = parser.parse_args()

    if not 1 <= args.max_count <= 1000:
        parser.error("--max-count must be between 1 and 1000")
    if not 1 <= args.max_files <= 10000:
        parser.error("--max-files must be between 1 and 10000")
    if args.follow and len(args.paths) != 1:
        parser.error("--follow requires exactly one --path")
    if args.follow and args.include_merges:
        parser.error("--follow cannot be combined with --include-merges")
    if args.revision.startswith("-"):
        parser.error("--revision must be a revision or range, not a Git option")
    return args


def run_git(repo, arguments, text=True):
    environment = os.environ.copy()
    environment["GIT_NO_LAZY_FETCH"] = "1"
    environment["GIT_TERMINAL_PROMPT"] = "0"
    result = subprocess.run(
        ["git", "-C", repo, *arguments],
        capture_output=True,
        text=text,
        errors="surrogateescape" if text else None,
        check=False,
        env=environment,
    )
    if result.returncode != 0:
        error = result.stderr.strip()
        raise RuntimeError(error or f"git {' '.join(arguments)} failed")
    return result.stdout


def repository_root(repo):
    return Path(
        run_git(repo, ["rev-parse", "--show-toplevel"]).strip()
    ).resolve()


def normalize_paths(root, paths):
    normalized = []
    for raw_path in paths:
        candidate = Path(raw_path)
        absolute = Path(
            os.path.abspath(candidate if candidate.is_absolute() else root / candidate)
        )
        try:
            relative = absolute.relative_to(root)
        except ValueError as error:
            raise ValueError(f"path is outside the repository: {raw_path}") from error
        value = relative.as_posix()
        if value == ".":
            raise ValueError("--path must identify a file or directory below the repository root")
        if value not in normalized:
            normalized.append(value)
    return normalized


def matching_commits(root, args, paths):
    command = [
        "--literal-pathspecs",
        "log",
        "--format=%H",
        "--date-order",
        f"--max-count={args.max_count + 1}",
    ]
    if not args.include_merges:
        command.append("--no-merges")
    else:
        command.append("--full-history")
    if args.follow:
        command.append("--follow")
    if args.since:
        command.append(f"--since={args.since}")
    if args.until:
        command.append(f"--until={args.until}")
    command.extend([args.revision, "--", *paths])
    output = run_git(str(root), command)
    commits = [line for line in output.splitlines() if line]
    return commits[: args.max_count], len(commits) > args.max_count


def commit_metadata(root, commit):
    separator = "\x00"
    output = run_git(
        str(root),
        [
            "show",
            "-s",
            "--format=%H%x00%aI%x00%cI%x00%an%x00%s%x00%P",
            commit,
        ],
    ).rstrip("\n")
    fields = output.split(separator)
    if len(fields) != 6:
        raise RuntimeError(f"unexpected metadata for commit {commit}")
    parents = fields[5].split()
    raw_commit = run_git(str(root), ["cat-file", "-p", commit])
    raw_parents = []
    for line in raw_commit.splitlines():
        if not line:
            break
        if line.startswith("parent "):
            raw_parents.append(line.removeprefix("parent "))
    return {
        "commit": fields[0],
        "authored_at": fields[1],
        "committed_at": fields[2],
        "author": fields[3],
        "subject": fields[4],
        "parents": parents,
        "raw_parents": raw_parents,
    }


def parse_numstat(output):
    parts = output.split(b"\x00")
    changes = []
    index = 0
    while index < len(parts):
        header = parts[index]
        index += 1
        if not header:
            continue
        fields = header.split(b"\t", 2)
        if len(fields) != 3:
            raise RuntimeError("unexpected git numstat output")
        additions_raw, deletions_raw, path_raw = fields
        old_path = None
        if path_raw:
            path = os.fsdecode(path_raw)
        else:
            if index + 1 >= len(parts):
                raise RuntimeError("incomplete rename entry in git numstat output")
            old_path = os.fsdecode(parts[index])
            path = os.fsdecode(parts[index + 1])
            index += 2
        binary = additions_raw == b"-" or deletions_raw == b"-"
        changes.append(
            {
                "path": path,
                "old_path": old_path,
                "additions": None if binary else int(additions_raw),
                "deletions": None if binary else int(deletions_raw),
                "binary": binary,
            }
        )
    return changes


def commit_changes(root, metadata, paths=None):
    parents = metadata["parents"]
    if parents:
        command = [
            "--literal-pathspecs",
            "diff",
            "--numstat",
            "-z",
            "--find-renames",
            parents[0],
            metadata["commit"],
        ]
        comparison = "first-parent" if len(parents) > 1 else "parent"
    else:
        empty_tree = run_git(
            str(root), ["hash-object", "-t", "tree", "/dev/null"]
        ).strip()
        command = [
            "--literal-pathspecs",
            "diff",
            "--numstat",
            "-z",
            "--find-renames",
            empty_tree,
            metadata["commit"],
        ]
        comparison = "empty-tree"
    if paths:
        command.extend(["--", *paths])
    output = run_git(str(root), command, text=False)
    return parse_numstat(output), comparison


def follow_commit_changes(root, commit, path):
    output = run_git(
        str(root),
        [
            "--literal-pathspecs",
            "log",
            "-1",
            "--follow",
            "--format=",
            "--numstat",
            "-z",
            commit,
            "--",
            path,
        ],
        text=False,
    )
    return parse_numstat(output)


def path_type(root, commit, path):
    output = run_git(
        str(root),
        ["--literal-pathspecs", "ls-tree", "-z", commit, "--", path],
        text=False,
    )
    for entry in output.split(b"\x00"):
        if not entry:
            continue
        metadata, entry_path = entry.split(b"\t", 1)
        if os.fsdecode(entry_path) == path:
            return metadata.split()[1].decode("ascii")
    return None


def revision_tips(root, revision):
    output = run_git(
        str(root),
        ["rev-parse", "--revs-only", "--end-of-options", revision],
    )
    return [line.removeprefix("^") for line in output.splitlines() if line]


def build_history(root, args, paths):
    followed_path = paths[0] if args.follow else None
    if args.follow and any(
        path_type(root, revision, followed_path) == "tree"
        for revision in revision_tips(root, args.revision)
    ):
        raise ValueError("--follow requires a file path; directories are not supported")

    commits, truncated = matching_commits(root, args, paths)
    history = []
    remaining_files = args.max_files
    files_truncated = False

    if args.follow and commits:
        first_metadata = commit_metadata(root, commits[0])
        if any(
            path_type(root, revision, followed_path) == "tree"
            for revision in [commits[0], *first_metadata["parents"][:1]]
        ):
            raise ValueError("--follow requires a file path; directories are not supported")

    for commit in commits:
        metadata = commit_metadata(root, commit)
        if metadata["parents"] != metadata["raw_parents"]:
            history.append(
                {
                    "commit": metadata["commit"],
                    "authored_at": metadata["authored_at"],
                    "committed_at": metadata["committed_at"],
                    "author": metadata["author"],
                    "subject": metadata["subject"],
                    "parent_count": len(metadata["raw_parents"]),
                    "comparison": "unavailable-parent",
                    "additions": None,
                    "deletions": None,
                    "binary_files": None,
                    "file_count": None,
                    "files_truncated": False,
                    "files": [],
                    "unavailable_reason": "parent history is not available locally",
                }
            )
            continue
        if args.follow:
            changes = follow_commit_changes(root, commit, followed_path)
            comparison = "empty-tree" if not metadata["parents"] else "parent"
        else:
            changes, comparison = commit_changes(root, metadata, paths)
        if args.follow:
            previous_path = followed_path
            for change in changes:
                if change["path"] == followed_path:
                    if change["old_path"] is not None:
                        previous_path = change["old_path"]
            followed_path = previous_path

        if not changes:
            continue
        additions = sum(change["additions"] or 0 for change in changes)
        deletions = sum(change["deletions"] or 0 for change in changes)
        included_changes = changes[:remaining_files]
        commit_files_truncated = len(included_changes) < len(changes)
        files_truncated = files_truncated or commit_files_truncated
        remaining_files -= len(included_changes)
        history.append(
            {
                "commit": metadata["commit"],
                "authored_at": metadata["authored_at"],
                "committed_at": metadata["committed_at"],
                "author": metadata["author"],
                "subject": metadata["subject"],
                "parent_count": len(metadata["raw_parents"]),
                "comparison": comparison,
                "additions": additions,
                "deletions": deletions,
                "binary_files": sum(change["binary"] for change in changes),
                "file_count": len(changes),
                "files_truncated": commit_files_truncated,
                "files": included_changes,
            }
        )
    return history, truncated, files_truncated


def table_cell(value):
    return escaped_text(value)


def print_table(history):
    print("commit\tcommitted_at\tadditions\tdeletions\tpath\tsubject")
    for commit in history:
        if not commit["files"]:
            if commit["comparison"] != "unavailable-parent":
                print(
                    f"{commit['commit']}\t{commit['committed_at']}\t"
                    f"{commit['additions']}\t{commit['deletions']}\t"
                    f"[file details omitted]\t{table_cell(commit['subject'])}"
                )
                continue
            print(
                f"{commit['commit']}\t{commit['committed_at']}\t"
                f"unavailable\tunavailable\t-\t{table_cell(commit['subject'])}"
            )
            continue
        for change in commit["files"]:
            path = change["path"]
            if change["old_path"] is not None:
                path = f"{change['old_path']} -> {path}"
            additions = "binary" if change["binary"] else str(change["additions"])
            deletions = "binary" if change["binary"] else str(change["deletions"])
            path = table_cell(path)
            subject = table_cell(commit["subject"])
            print(
                f"{commit['commit']}\t{commit['committed_at']}\t"
                f"{additions}\t{deletions}\t{path}\t{subject}"
            )


def main():
    args = parse_args()
    try:
        root = repository_root(args.repo)
        paths = normalize_paths(root, args.paths)
        shallow = run_git(
            str(root), ["rev-parse", "--is-shallow-repository"]
        ).strip() == "true"
        history, truncated, files_truncated = build_history(root, args, paths)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"git-path-history: {escaped_text(str(error))}", file=sys.stderr)
        return 1

    result = {
        "revision": args.revision,
        "paths": paths,
        "since": args.since,
        "until": args.until,
        "max_count": args.max_count,
        "max_files": args.max_files,
        "follow": args.follow,
        "include_merges": args.include_merges,
        "shallow_repository": shallow,
        "truncated": truncated,
        "files_truncated": files_truncated,
        "commits": history,
    }
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=True, indent=2))
    else:
        print_table(history)
        if shallow:
            print(
                "warning: repository is shallow; earlier matching commits may be unavailable",
                file=sys.stderr,
            )
        if truncated:
            print(
                "warning: result reached --max-count; earlier matches were not inspected",
                file=sys.stderr,
            )
        if files_truncated:
            print(
                "warning: result reached --max-files; later file records were not emitted",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
