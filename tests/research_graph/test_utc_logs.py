"""The two HTTP log renderers use UTC without changing request filtering or host TZ."""
import os
import subprocess
import sys
import unittest


class UtcLogTests(unittest.TestCase):
    def test_http_log_prefixes_are_utc_in_a_non_utc_host_timezone(self):
        script = r'''
import io
import time
from unittest.mock import patch
from paper import serve as paper
from ide.research_graph import serve as graph

with patch.object(graph, "_page", return_value=b"<html></html>"):
    handlers = [paper.handler(None, frozenset()), graph.handler(None, frozenset())]
for epoch, expected in [(1767227400, "2026-01-01T00:30:00Z"), (1782865800, "2026-07-01T00:30:00Z")]:
    utc = time.gmtime(epoch)
    for cls in handlers:
        obj = object.__new__(cls)
        with patch.object(time, "gmtime", return_value=utc), patch("sys.stderr", new_callable=io.StringIO) as out:
            obj.log_message("%s %d", "fixture", 409)
            assert out.getvalue() == expected + " fixture 409\n", out.getvalue()
'''
        # One zone away from UTC: the patched gmtime makes every zone the same check, and a round trip through
        # local time would pass only in UTC.
        result = subprocess.run(
            [sys.executable, "-c", script],
            env={"PATH": os.environ.get("PATH", ""), "TZ": "Asia/Shanghai"},
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
