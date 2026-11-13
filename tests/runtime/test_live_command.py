"""Real-account credentials have one read-only mount and cannot enter Paper or egress."""

from pathlib import Path
import tempfile
import unittest

from engine.config import RUNTIME_CONTRACT
from shared.errors import Refusal
from runtime import container


IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/amd64", "runtime_contract": RUNTIME_CONTRACT}


class LiveCommandTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.secret = root / "credential.json"
        self.secret.write_text("synthetic credential")
        self.mounts = [(root, "/reports", False), (self.secret, "/run/secrets/binance.json", True)]

    def command(self, module="engine.live", mounts=None, network="trade-live-one"):
        return container.live_command(IDENTITY, self.mounts if mounts is None else mounts, module, [],
                                      name="trade-live-one-run", network=network, memory="2g", labels={})

    def test_live_container_is_hardened_with_no_secret_environment(self):
        result = self.command()
        self.assertIn("--read-only", result)
        self.assertIn("no-new-privileges", result)
        self.assertIn("--detach", result)
        self.assertNotIn("--rm", result)
        self.assertNotIn("synthetic credential", str(result))
        self.assertEqual([result[i + 1] for i, item in enumerate(result) if item == "--env"],
                         ["PYTHONDONTWRITEBYTECODE=1"])
        self.assertTrue(any("target=/run/secrets/binance.json,readonly" in part for part in result))

    def test_secret_missing_or_writable_and_public_network_are_refused(self):
        for options in ({"mounts": self.mounts[:1]},
                        {"mounts": [self.mounts[0], (self.secret, "/run/secrets/binance.json", False)]},
                        {"network": "host"}, {"network": "bridge"}, {"module": "engine.paper"},
                        {"module": "engine.egress"}):
            with self.subTest(options=options), self.assertRaises(Refusal):
                self.command(**options)

    def test_paper_cannot_select_live_module(self):
        with self.assertRaises(Refusal) as caught:
            container.paper_command(IDENTITY, self.mounts[:1], "engine.live", [], name="paper-one",
                                    network="paper-one", memory="2g", labels={})
        self.assertEqual(caught.exception.code, "MODULE_NOT_IN_LAYOUT")
