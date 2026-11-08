"""The skill name check refuses dead product names and leaves prose and outside names alone."""

import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".github/scripts/skill-names.py"
_spec = importlib.util.spec_from_file_location("skill_names", SCRIPT)
assert _spec and _spec.loader
names = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(names)


class CommandLineCallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree, cls.runners, cls.runner_options = names.command_tree()
        cls.runner = sorted(cls.runners)[0]
        noun, verb = cls.runner.split()
        cls.plain = next(f"{n} {v}" for n, verbs in sorted(cls.tree.items()) for v in sorted(verbs)
                         if f"{n} {v}" not in cls.runners)
        cls.option = sorted(o for o in cls.tree[noun][verb] if o.startswith("--") and o != "--help")[0]

    def check(self, span):
        return names.check_call(span, self.tree, self.runners, self.runner_options)

    def test_existing_calls_resolve(self):
        for span in (self.runner, f"{self.runner} {self.option} VALUE", f"{self.runner} --help",
                     f"uv run --frozen python -m cli.main {self.runner} {self.option} <id>",
                     f"{self.runner} {self.option} X -- --start T --execution quotes --trade-ticks"):
            with self.subTest(span=span):
                self.assertIsNone(self.check(span))

    def test_dead_verbs_options_and_runner_arguments_are_refused(self):
        noun = self.runner.split()[0]
        for span, reason in ((f"{noun} no-such-verb", "no verb"),
                             (f"{self.runner} --no-such-option", "has no --no-such-option"),
                             (f"{self.runner} -- --market-root /tmp/m", "has no --market-root"),
                             (f"{self.plain} -- --start T", "takes no runner arguments"),
                             ("python -m cli.main nosuchnoun verb", "no command")):
            with self.subTest(span=span):
                self.assertIn(reason, self.check(span) or "")

    def test_prose_record_ids_and_placeholders_are_not_calls(self):
        noun = self.runner.split()[0]
        for span in (f"{noun} 31", f"{noun} stream recording is not available", "python -m cli.main <noun> <verb>",
                     f"{noun} VERB", "nosuchnoun verb --flag", "closing_order_tag"):
            with self.subTest(span=span):
                self.assertIsNone(self.check(span))


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, files):
        for name, text in files.items():
            path = self.repo / name
            if text is None:
                path.unlink()
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        self.git("add", "-A")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "-qm", "change")
        return self.git("rev-parse", "HEAD")

    def run_check(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.repo, capture_output=True, text=True)

    def test_a_rename_that_leaves_skill_and_eval_text_behind_is_refused(self):
        skill = "Read `closing_order_tags` from `tables()`; a FRED series has `realtime_start`.\n"
        base = self.commit({"report/analysis.py": "def tables():\n    return {'closing_order_tags': []}\n",
                            ".agents/skills/x/SKILL.md": skill,
                            ".agents/evals/x/case/prompt.md": "Group by `closing_order_tags`.\n"})
        self.commit({"report/analysis.py": "def tables():\n    return {'closing_order_tag': []}\n"})
        result = self.run_check("--base", base)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        lines = result.stdout.splitlines()
        self.assertEqual([line.split(": ")[0:2] for line in lines],
                         [[".agents/evals/x/case/prompt.md:1", "closing_order_tags"],
                          [".agents/skills/x/SKILL.md:1", "closing_order_tags"]])

    def test_a_rename_that_updates_the_skill_or_moves_the_name_passes(self):
        base = self.commit({"report/analysis.py": "TAGS = 'closing_order_tags'\n",
                            ".agents/skills/x/SKILL.md": "Read `closing_order_tags`.\n"})
        self.commit({"report/analysis.py": "TAGS = 'closing_order_tag'\n",
                     ".agents/skills/x/SKILL.md": "Read `closing_order_tag`.\n"})
        self.assertEqual(self.run_check("--base", base).returncode, 0)
        base = self.commit({"report/old.py": "X = 'plans_won'\n", ".agents/skills/x/SKILL.md": "Read `plans_won`.\n"})
        self.commit({"report/old.py": None, "report/new.py": "X = 'plans_won'\n"})
        self.assertEqual(self.run_check("--base", base).returncode, 0)

    def test_skill_text_and_design_pages_do_not_keep_a_name_alive(self):
        base = self.commit({"report/analysis.py": "FIELD = 'freeze_latest'\n",
                            "docs/plans/design.md": "`freeze_latest`\n",
                            ".agents/skills/x/SKILL.md": "Read `freeze_latest`.\n"})
        self.commit({"report/analysis.py": "FIELD = None\n"})
        self.assertEqual(self.run_check("--base", base).returncode, 1)

    def test_missing_skill_files_and_links_are_refused(self):
        self.commit({".agents/skills/x/references/real.md": "text\n",
                     ".agents/skills/x/SKILL.md": "See [real](references/real.md), `references/real.md`, "
                                                  "[web](https://example.com) and `ip|oi`.\n"})
        self.assertEqual(self.run_check().returncode, 0)
        self.commit({".agents/skills/x/SKILL.md": "See [gone](references/gone.md) and `templates/gone.md`.\n"
                                                  "```\n[fenced](references/fenced.md)\n```\n"})
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertEqual([line.split(": ")[1] for line in result.stdout.splitlines()],
                         ["templates/gone.md", "references/gone.md"])


if __name__ == "__main__":
    unittest.main()
