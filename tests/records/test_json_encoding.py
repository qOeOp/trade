"""Persistent research JSON uses UTF-8 independently of the host locale."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


class JsonEncodingTests(unittest.TestCase):
    def test_json_read_write_under_ascii_locale(self):
        with tempfile.TemporaryDirectory(prefix="trade-json-encoding-", dir=Path.home()) as directory:
            script = textwrap.dedent(r'''
                import json
                import locale
                from pathlib import Path
                import sys
                
                from research.records.common import _read_json
                from research.records.artifacts import _write_json

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
