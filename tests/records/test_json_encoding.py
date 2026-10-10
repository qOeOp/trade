"""Persistent research JSON uses UTF-8 independently of the host locale."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


class JsonEncodingTests(unittest.TestCase):
    def test_json_read_write_and_review_plan_under_ascii_locale(self):
        # Review plans require an external retained location. This temporary
        # test directory uses the home directory and is removed after the test.
        with tempfile.TemporaryDirectory(prefix="trade-json-encoding-", dir=Path.home()) as directory:
            script = textwrap.dedent(r'''
                import json
                import locale
                from argparse import Namespace
                from pathlib import Path
                import sys
                from types import SimpleNamespace
                from unittest.mock import Mock, patch

                from research.records.common import _read_json
                from research.records.artifacts import _write_json
                from research.records import ledger

                assert locale.getencoding().upper() in {"US-ASCII", "ANSI_X3.4-1968", "ASCII"}
                root = Path(sys.argv[1])
                value = {"decision": "\u652f\u6491\u89e6\u78b0\uff1a\u4fdd\u7559\u5931\u8d25\u7ed3\u8bba"}
                expected = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                input_file = root / "input.json"
                input_file.write_bytes(expected)
                assert _read_json(input_file) == value

                output = root / "native.json"
                _write_json(output, value, exclusive=True)
                assert output.read_bytes() == expected
                assert _read_json(output) == value

                config_file = root / "backend.json"
                adapter = Mock()
                adapter.initialize.return_value = {"initialized": True}
                with patch.object(ledger, "config_path", return_value=config_file), \
                     patch.object(ledger, "_binary", return_value=root / "dolt"), \
                     patch.object(ledger, "start", return_value={"running": True}), \
                     patch.object(ledger, "DoltStore", return_value=adapter):
                    ledger.initialize(root / "dolt", root / "data-root")
                config = _read_json(config_file)
                assert config_file.read_bytes() == (json.dumps(config, indent=2) + "\n").encode("utf-8")

                plan = {**value, "operation_id": "fixture", "payload_sha256": "a" * 64,
                        "base_commit": "b" * 32, "expected_version": 1, "counts": {}}
                destination = root / "review.json"
                args = Namespace(command="material", action="review", review_action="prepare", at=None,
                                 inventory_id="inventory:fixture", revision=1, source_at="b" * 32,
                                 decisions=None, supplemental=None, destination=destination)
                with patch.object(ledger, "open_store", return_value=SimpleNamespace(adapter=adapter)), \
                     patch("research.records.reviews.prepare", return_value=plan):
                    ledger.command(args)
                assert destination.read_bytes() == (json.dumps(plan, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                assert _read_json(destination) == plan
                print("utf8-json-roundtrip-ok")
            ''')
            environment = {**os.environ, "LC_ALL": "C", "LANG": "C", "PYTHONUTF8": "0",
                           "PYTHONCOERCECLOCALE": "0", "PYTHONDONTWRITEBYTECODE": "1"}
            result = subprocess.run([sys.executable, "-c", script, directory], env=environment,
                                    capture_output=True, text=True, encoding="utf-8", check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "utf8-json-roundtrip-ok")


if __name__ == "__main__":
    unittest.main()
