"""The IDE image's entrypoint under `sh`, with stand-in `node` and `python3` on PATH: never the real services."""

import contextlib
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest

ENTRYPOINT = Path(__file__).resolve().parents[2] / "deploy/entrypoint.sh"


class EntrypointTests(unittest.TestCase):
    def test_overview_is_restarted_after_it_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            bin_dir, starts = Path(directory, "bin"), Path(directory, "starts")
            bin_dir.mkdir()
            # The overview dies at once, as the kernel's OOM kill left it; serve exits 0 once it has started twice.
            (bin_dir / "node").write_text('#!/bin/sh\necho "$1" >> "$STARTS"\nexit 3\n')
            (bin_dir / "python3").write_text(
                '#!/bin/sh\nfor _ in $(seq 100); do\n'
                '  [ "$(grep -c overview "$STARTS" 2>/dev/null)" -ge 2 ] && exit 0\n  sleep 0.1\ndone\nexit 1\n'
            )
            for name in ("node", "python3"):
                (bin_dir / name).chmod(0o755)
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "STARTS": str(starts),
                   "TRADE_IDE_CHAT": "0"}
            process = subprocess.Popen(["sh", str(ENTRYPOINT)], env=env, stderr=subprocess.PIPE, text=True,
                                       start_new_session=True)
            try:
                process.wait(timeout=30)
            finally:
                # The restart loop outlives serve here and holds stderr open; a container's teardown would end it.
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
            assert process.stderr is not None
            stderr = process.stderr.read()
            process.stderr.close()
            self.assertEqual(process.returncode, 0, stderr)
            self.assertIn("overview exited with status 3; restarting in 1s", stderr)


if __name__ == "__main__":
    unittest.main()
