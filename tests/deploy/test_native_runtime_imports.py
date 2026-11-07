"""Native CI must exercise packaged deploy contracts, never its mounted validation checkout."""

import importlib
import os
from pathlib import Path
import runpy
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / ".github/scripts/check-native-runtime.py"
CHECK = runpy.run_path(str(SCRIPT))


class ReachedTests(Exception):
    pass


class NativeRuntimeImportTests(unittest.TestCase):
    def test_child_checks_packaged_contract_from_validation_cwd_and_restores_environment(self):
        observed = []
        def module(name):
            observed.append(name)
            return SimpleNamespace(__file__=f"/opt/trade/{name.replace('.', '/')}/__init__.py")
        def child(argv, **kwargs):
            self.assertEqual(kwargs, {"cwd": Path("/validation"), "check": True, "timeout": 30})
            self.assertEqual(os.environ["PYTHONPATH"], "/opt/trade:/opt/trade/ide")
            self.assertEqual(os.environ["PYTHONSAFEPATH"], "1")
            exec(argv[2], {})
        with patch.dict(os.environ, {"PYTHONPATH": "original-fixture-path", "PYTHONSAFEPATH": "0"}), \
                patch.object(importlib, "import_module", side_effect=module), patch.object(subprocess, "run", side_effect=child):
            with CHECK["service_test_imports"](Path("/validation")):
                self.assertEqual(observed, ["cli", "live", "deploy", "deploy.live_configuration"])
            self.assertEqual(os.environ["PYTHONPATH"], "original-fixture-path")
            self.assertEqual(os.environ["PYTHONSAFEPATH"], "0")

    def test_child_refuses_mounted_deploy_or_parser_and_restores_environment_on_failure(self):
        for foreign in ("cli", "live", "deploy", "deploy.live_configuration"):
            with self.subTest(foreign=foreign):
                def module(name):
                    root = "/validation" if name == foreign else "/opt/trade"
                    return SimpleNamespace(__file__=f"{root}/{name.replace('.', '/')}/__init__.py")
                def child(argv, **_):
                    exec(argv[2], {})
                with patch.dict(os.environ, {"PYTHONPATH": "original", "PYTHONSAFEPATH": "0"}), \
                        patch.object(importlib, "import_module", side_effect=module), \
                        patch.object(subprocess, "run", side_effect=child):
                    with self.assertRaises(AssertionError):
                        with CHECK["service_test_imports"](Path("/validation")):
                            self.fail("validation source accepted")
                    self.assertEqual(os.environ["PYTHONPATH"], "original")
                    self.assertEqual(os.environ["PYTHONSAFEPATH"], "0")

    def preimports(self, kind, foreign=None):
        observed = []
        def module(name):
            self.assertNotIn("/validation", sys.path)
            observed.append(name)
            root = "/validation" if name == foreign else "/opt/trade"
            if name == "research_graph":
                root += "/ide"
            return SimpleNamespace(__file__=f"{root}/{name.replace('.', '/')}/__init__.py")
        def tests(*_, **__):
            raise ReachedTests
        with patch.object(sys, "argv", [str(SCRIPT), kind, "amd64"]), \
                patch.object(sys, "path", [p for p in sys.path if p != "/validation"]), \
                patch.object(CHECK["platform"], "machine", return_value="x86_64"), \
                patch.object(importlib, "import_module", side_effect=module), \
                patch.object(subprocess, "check_output", return_value="dolt version 2.7.2\n"), \
                patch.dict(sys.modules, {"research_graph.render": SimpleNamespace(built_page=tests)}), \
                patch.object(unittest.defaultTestLoader, "discover", side_effect=tests), \
                patch.object(unittest.defaultTestLoader, "loadTestsFromNames", side_effect=tests):
            with self.assertRaises(AssertionError if foreign else ReachedTests):
                CHECK["main"]()
        return observed

    def test_service_and_ide_preimport_deploy_and_shared_parser_before_exposing_checkout(self):
        for kind in ("service", "ide"):
            with self.subTest(kind=kind):
                names = self.preimports(kind)
                self.assertIn("deploy", names)
                self.assertIn("deploy.live_configuration", names)
                self.assertLess(names.index("deploy"), names.index("deploy.live_configuration"))
                self.assertLess(names.index("deploy.live_configuration"), names.index("research_graph"))
                for foreign in ("deploy", "deploy.live_configuration"):
                    with self.subTest(foreign=foreign):
                        self.assertEqual(self.preimports(kind, foreign)[-1], foreign)

    def test_runtime_preimports_remain_engine_only(self):
        self.assertEqual(self.preimports("runtime"), ["engine"])
