"""If this fails, a `ledger temp` whose service did not start removes the log the refusal pointed to without
showing what it said, so the failure cannot be diagnosed (the paper container's LEDGER_START, #2952)."""

from __future__ import annotations

import contextlib
import io
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from cli import ledger_commands
from shared.errors import Refusal
from shared.refusals import refuse


class FailedStartTests(unittest.TestCase):
    def test_the_end_of_the_service_log_reaches_stderr_before_the_root_is_removed(self):
        root = Path(tempfile.gettempdir()) / "ledger-failed-start-test"
        self.addCleanup(shutil.rmtree, root, True)

        def failed(name, kind, service_root):
            service_root.mkdir(parents=True)
            (service_root / "server.log").write_text("".join(f"line {i}\n" for i in range(60)) + "bind: refused\n")
            raise refuse("LEDGER_START", "the Dolt service did not accept connections in time or exited")

        stderr = io.StringIO()
        with mock.patch.object(ledger_commands, "ledger_init", side_effect=failed), \
                contextlib.redirect_stderr(stderr), self.assertRaises(Refusal) as caught:
            ledger_commands.ledger_temp(str(root))
        self.assertEqual(caught.exception.code, "LEDGER_START")
        self.assertFalse(root.exists())
        shown = stderr.getvalue()
        self.assertIn("bind: refused", shown)
        self.assertIn("line 59", shown)
        self.assertNotIn("line 20\n", shown)  # only the end


if __name__ == "__main__":
    unittest.main()
