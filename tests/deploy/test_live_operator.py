"""The supported host recipe retains its selected release and image, across route changes."""

from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class LiveOperatorRecipeTests(unittest.TestCase):
    def test_selected_service_and_release_stay_paired_after_later_shell_revision_changes(self):
        recipe = (ROOT / "deploy/remote/README.md").read_text().split(
            'readonly LIVE_SELECTED_REVISION="$LIVE_REVISION"', 1)[1].split('\n}\n', 1)[0]
        recipe = 'readonly LIVE_SELECTED_REVISION="$LIVE_REVISION"' + recipe + '\n}\n'
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "selected.env"
            recipe = recipe.replace('/root/live-images.env', shlex.quote(str(env_file)))
            # Only fake image resolution and a Docker argv printer; no registry or daemon.
            shell = '''
set -eu
LIVE_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
LIVE_ROOT=/private-custody
LIVE_INPUTS=/private-inputs
KEY=/fake-never-read-key
python3() {
  test "$1" = -m && test "$2" = deploy.images && test "$3" = --revision
  test "$4" = "$LIVE_REVISION" && test "$5" = --env
  printf '%s\n' 'TRADE_SERVICE_IMAGE=service-a' 'TRADE_RUNTIME_IMAGE=runtime-a' > "$6"
}
docker() { printf '%s\n' "$@"; }
''' + recipe + '''
LIVE_REVISION=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TRADE_SERVICE_IMAGE=service-b
TRADE_RUNTIME_IMAGE=runtime-b
live start --root "$LIVE_ROOT" --run-id original --credentials-file "$KEY" --confirm-real-orders fake
'''
            result = subprocess.run(["sh", "-c", shell], capture_output=True, text=True, check=True)
        argv = result.stdout.splitlines()
        self.assertIn("service-a", argv)
        self.assertNotIn("service-b", argv)
        self.assertEqual(argv[-2:], ["--release-web", "trade-release-web-" + "a" * 40])
        self.assertEqual(argv.count("--release-web"), 1)

    def test_mutating_cli_requires_selected_release_but_observation_does_not(self):
        from cli.main import _parser
        parser = _parser()
        result = subprocess.run([sys.executable, "-m", "cli.main", "live", "reconcile", "--root", "/never-created",
                                 "--run-id", "original", "--credentials-file", "/never-read"],
                                capture_output=True, text=True, check=False, cwd=ROOT)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--release-web", result.stderr)
        for action in ("status", "logs", "stop"):
            parsed = parser.parse_args(["live", action, "--root", "/original", "--run-id", "original"])
            self.assertFalse(hasattr(parsed, "release_web"))
