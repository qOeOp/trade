"""Runtime pairing uses tracked input identity, including additions, removals and modes."""

import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from deploy.release import GitSource
from deploy.runtime_inputs import DOCKERFILE, project


BASE = "FROM example.invalid/python@sha256:" + "1" * 64 + "\n"
DOCKER = BASE + "COPY engine/*.py ./engine/\nCOPY pyproject.toml uv.lock ./\n"


def blob(path, content="", mode="100644", kind="blob"):
    data = content.encode()
    identity = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    return {"path": path, "mode": mode, "type": kind, "sha": identity}


def tree(dockerfile=DOCKER):
    return [blob(DOCKERFILE, dockerfile), blob("engine/run.py", "run\n"),
            blob("pyproject.toml", "project\n"), blob("uv.lock", "lock\n")]


class ProjectionTests(unittest.TestCase):
    def test_all_context_files_and_modes_participate_but_unrelated_files_do_not(self):
        original = tree()
        expected = project(original, DOCKER)
        self.assertEqual(project(original + [blob("docs/note.md"), blob("engine/nested/not-copied.py")], DOCKER), expected)
        changes = (
            original + [blob("engine/new.py")],
            [item for item in original if item["path"] != "engine/run.py"] + [blob("engine/other.py", "run\n")],
            [dict(item, mode="100755") if item["path"] == "engine/run.py" else item for item in original],
            [blob("uv.lock", "changed\n") if item["path"] == "uv.lock" else item for item in original],
            original + [blob(".dockerignore", "engine/new.py\n")],
            original + [blob(".github/workflows/runtime-image.yml", "build\n")],
        )
        for changed in changes:
            with self.subTest(changed=changed):
                self.assertNotEqual(project(changed, DOCKER), expected)

    def test_directory_copy_includes_all_descendants_and_detects_deletion(self):
        dockerfile = BASE + "COPY engine/ ./engine/\n"
        original = tree(dockerfile) + [blob("engine/nested/worker.py"), blob("engine/notes.txt")]
        selected = {path for path, _, _ in project(original, dockerfile)}
        self.assertIn("engine/nested/worker.py", selected)
        self.assertIn("engine/notes.txt", selected)
        self.assertNotEqual(project(original[:-1], dockerfile), project(original, dockerfile))

    def test_glob_matched_directory_includes_descendants_with_both_tree_sources(self):
        original = tree()
        leaves = original + [blob("engine/plugin.py/mod.py", "runtime addition\n")]
        api_tree = leaves + [blob("engine/plugin.py", "", "040000", "tree")]
        self.assertNotEqual(project(original, DOCKER), project(leaves, DOCKER))
        self.assertIn("engine/plugin.py/mod.py", {path for path, _, _ in project(leaves, DOCKER)})
        self.assertEqual(project(leaves, DOCKER), project(api_tree, DOCKER))

    def test_declared_digest_pinned_stage_copy_does_not_consume_local_paths(self):
        dockerfile = BASE.rstrip() + " AS tools\n" + BASE + "COPY --from=tools /bin/tool /bin/tool\nCOPY engine/*.py ./\n"
        self.assertEqual({path for path, _, _ in project(tree(dockerfile), dockerfile)},
                         {DOCKERFILE, "engine/run.py"})

    def test_content_is_bound_to_blob_without_stripping_final_newline(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            project(tree(), DOCKER.rstrip())

    def test_unreviewed_context_sources_are_refused(self):
        cases = (
            "FROM python:latest\nCOPY engine/*.py ./\n",
            BASE + "COPY --from=other /bin/tool /bin/\nCOPY engine/*.py ./\n",
            BASE + "COPY engine/${FILE} ./\n",
            BASE + 'COPY ["engine/run.py", "./"]\n',
            BASE + "COPY --link engine/*.py ./\n",
            BASE + "COPY engine/**/*.py ./\n",
            BASE + "COPY ../engine/run.py ./\n",
            BASE + "COPY absent/*.py ./\n",
            BASE + "ADD engine/ ./\n",
            BASE + "RUN --mount=type=bind,target=/src true\nCOPY engine/*.py ./\n",
            BASE + "ONBUILD COPY engine/*.py ./\n",
            BASE + "FUTURE_INPUT engine/\nCOPY engine/*.py ./\n",
            "# syntax=docker/dockerfile:1\n" + DOCKER,
            "#syntax=docker/dockerfile:1\n" + DOCKER,
            "# SYNTAX = docker/dockerfile:1\n" + DOCKER,
            "# escape=`\n" + BASE + "COPY engine/run.py `\nengine/other.py ./\n",
            BASE + "COPY engine/*.py \\\n ./\n",
        )
        for dockerfile in cases:
            with self.subTest(dockerfile=dockerfile), self.assertRaises(ValueError):
                project(tree(dockerfile), dockerfile)

    def test_selected_symlink_submodule_duplicate_and_malformed_paths_are_refused(self):
        cases = (
            tree() + [blob("engine/link.py", "../external", "120000")],
            tree() + [blob("engine/module.py", "", "160000", "commit")],
            tree() + [blob("engine/run.py", "duplicate")],
            tree() + [blob("../escape", "")],
            [item for item in tree() if item["path"] != DOCKERFILE],
        )
        for entries in cases:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                project(entries, DOCKER)


class GitHistoryTests(unittest.TestCase):
    def test_actual_git_history_accepts_service_only_change_and_refuses_old_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.run(["git", "-C", str(root), *args], check=True,
                                      capture_output=True, text=True).stdout.strip()

            def write(path, content):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)

            def commit():
                git("add", ".")
                git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "-c", "commit.gpgsign=false", "commit", "-m", "fixture")
                return git("rev-parse", "HEAD")

            git("init")
            write(DOCKERFILE, DOCKER)
            write("engine/run.py", "run\n")
            write("pyproject.toml", "project\n")
            write("uv.lock", "lock\n")
            runtime = commit()
            write("deploy/service.py", "service-only\n")
            service = commit()
            write("engine/added.py", "new runtime check\n")
            changed = commit()
            source = GitSource(root)
            source.repo = root / ".git"
            source.require_runtime(runtime, service)
            source.require_runtime(changed, changed)
            self.assertEqual(source.runtime_inputs(runtime), source.runtime_inputs(service))
            with self.assertRaisesRegex(RuntimeError, "build inputs"):
                source.require_runtime(runtime, changed)
            with self.assertRaisesRegex(RuntimeError, "ancestor"):
                source.require_runtime(changed, service)


if __name__ == "__main__":
    unittest.main()
