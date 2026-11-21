"""The eval-case selector lists the cases citing a name from a changed skill paragraph, and leaves out common names."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / ".github/scripts/eval-cases.py"


class EvalCasesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        self.git("init", "-q")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, files):
        for name, text in files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        self.git("add", "-A")
        self.git("-c", "user.name=CI", "-c", "user.email=ci@example.com", "commit", "-qm", "change")
        return self.git("rev-parse", "HEAD")

    def test_cases_citing_a_changed_paragraphs_rare_names(self):
        skill = ".agents/skills/s/SKILL.md"
        base = self.commit({
            skill: "Read `dev_years` and `common_name`.\n\nUntouched `other_name` paragraph.\n",
            ".agents/evals/s/a/prompt.md": "Uses dev_years and common_name.\n",
            ".agents/evals/s/b/prompt.md": "Cites common_name and other_name.\n",
            ".agents/evals/s/c/prompt.md": "Nothing relevant: my_dev_years_x.\n",
            ".agents/evals/s/c/graders/criteria.md": "Does it cite common_name?\n"})
        self.commit({skill: "Read `dev_years`, its `mark_max_drawdown` and `common_name`.\n\n"
                            "Untouched `other_name` paragraph.\n"})
        run = subprocess.run([sys.executable, str(SCRIPT), "--base", base, "--max", "2"], cwd=self.repo,
                             capture_output=True, text=True, check=True)
        # common_name is cited by three cases (over --max), other_name's paragraph is unchanged
        self.assertEqual(run.stdout, "s/a: dev_years\n")


if __name__ == "__main__":
    unittest.main()
