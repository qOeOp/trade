"""The service Docker context must contain every declared Python package, including Live authority."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest

from pathspec import PathSpec


ROOT = Path(__file__).resolve().parents[2]


def service_context(destination):
    # The current Docker rules use ordered root exclusions, includes and directory patterns.
    # Basic ordered matching yields the same selected files for this vocabulary; this is
    # not a general Docker matcher. Real image CI still verifies both final image targets.
    rules = PathSpec.from_lines("gitignore", (ROOT / "deploy/Dockerfile.dockerignore").read_text().splitlines())
    tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout
    for relative in tracked.decode().split("\0"):
        if relative and not rules.match_file(relative):
            source, target = ROOT / relative, destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


class ServiceContextTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("uv"), "offline service wheel check needs the existing uv tool")
    def test_filtered_service_context_builds_and_installs_live_authority_outside_source(self):
        with tempfile.TemporaryDirectory(prefix="live-filtered-context-") as temporary:
            work = Path(temporary)
            context, wheels, installed = work / "context", work / "wheels", work / "installed"
            service_context(context)
            declared = tomllib.loads((context / "pyproject.toml").read_text())["tool"]["uv"]["build-backend"]["module-name"]
            for module in declared:
                self.assertTrue((context / module / "__init__.py").is_file(), module)
            self.assertTrue((context / "deploy/live_configuration.py").is_file())
            subprocess.run(["uv", "build", "--wheel", "--offline", "--out-dir", str(wheels)], cwd=context,
                           capture_output=True, text=True, check=True)
            wheel, = wheels.glob("*.whl")
            subprocess.run(["uv", "pip", "install", "--python", sys.executable, "--offline", "--no-index", "--no-deps", "--target", str(installed),
                            str(wheel)], cwd=work, capture_output=True, text=True, check=True)
            source = '''
import importlib, pathlib, sys
root = pathlib.Path(sys.argv[1])
sys.path.insert(0, str(root))
for name in ("live.authority", "deploy.live_configuration", "deploy.live_host"):
    module = importlib.import_module(name)
    assert pathlib.Path(module.__file__).is_relative_to(root), (name, module.__file__)
'''
            subprocess.run([sys.executable, "-I", "-c", source, str(installed)], cwd=work,
                           capture_output=True, text=True, check=True)

    def test_the_service_image_carries_the_control_code_a_handoff_copies(self):
        from deploy.control import IMAGE_DEPLOY

        dockerfile = (ROOT / "deploy/Dockerfile").read_text()
        product = dockerfile[dockerfile.index(" AS product"):dockerfile.index(" AS service")]
        self.assertIn("WORKDIR /opt/trade\n", product)
        self.assertIn("COPY . ./\n", product)
        self.assertEqual(IMAGE_DEPLOY, "/opt/trade/deploy")
        with tempfile.TemporaryDirectory(prefix="control-context-") as temporary:
            service_context(Path(temporary))
            for path in (ROOT / "deploy").glob("*.py"):
                self.assertTrue((Path(temporary) / "deploy" / path.name).is_file(), path.name)
