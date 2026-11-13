"""A changed or incomplete checkpoint must never be accepted as an unchanged Paper account."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from engine import paper_checkpoint as checkpoint
from engine.config import Refusal


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.output = Path(directory.name)
        self.identity = "a" * 64
        (self.output / "events.jsonl").write_bytes(b'{"kind":"started"}\n')
        self.rdb = self.output / "native.rdb"
        self.rdb.write_bytes(b"opaque-native-original")
        checkpoint.dirty(self.output)
        self.point = checkpoint.publish(self.output, self.identity, self.rdb)

    def refuses(self):
        with self.assertRaises(Refusal) as found:
            checkpoint.read(self.output, self.identity)
        self.assertEqual(found.exception.code, "PAPER_RECOVERY_UNAVAILABLE")

    def test_committed_cut_and_native_original_are_bound(self):
        self.assertEqual(checkpoint.read(self.output, self.identity), self.point)
        with self.assertRaises(Refusal):
            checkpoint.read(self.output, "b" * 64)

    def test_a_callback_after_the_cut_is_not_silently_discarded(self):
        checkpoint.dirty(self.output)
        self.refuses()

    def test_both_complete_and_partial_journal_tails_are_retained_and_refused(self):
        original = (self.output / "events.jsonl").read_bytes()
        for tail in (b'{"kind":"order"}\n', b'{"kind":"ord'):
            with self.subTest(tail=tail):
                (self.output / "events.jsonl").write_bytes(original + tail)
                self.refuses()
                self.assertEqual((self.output / "events.jsonl").read_bytes(), original + tail)

    def test_changed_prefix_and_cache_are_refused(self):
        original = (self.output / "events.jsonl").read_bytes()
        (self.output / "events.jsonl").write_bytes(original.replace(b"started", b"stopped"))
        self.refuses()
        (self.output / "events.jsonl").write_bytes(original)
        (self.output / "recovery" / f"{self.point['cache_sha256']}.rdb").write_bytes(b"changed")
        self.refuses()

    def test_failed_manifest_publication_leaves_the_previous_original_and_dirty_intent(self):
        checkpoint.dirty(self.output)
        self.rdb.write_bytes(b"newer-native-original")
        with mock.patch.object(checkpoint, "atomic", side_effect=OSError("write interrupted")):
            with self.assertRaises(OSError):
                checkpoint.publish(self.output, self.identity, self.rdb)
        self.assertEqual(json.loads((self.output / "recovery" / "current.json").read_bytes()), self.point)
        self.assertTrue((self.output / "recovery" / f"{self.point['cache_sha256']}.rdb").is_file())
        self.refuses()

    def test_used_original_survives_a_new_current_checkpoint(self):
        used = checkpoint.retain_used(self.output, self.point)
        checkpoint.dirty(self.output)
        self.rdb.write_bytes(b"a-later-cut")
        checkpoint.publish(self.output, self.identity, self.rdb)
        self.assertEqual(used.read_bytes(), b"opaque-native-original")
        self.assertEqual(json.loads((used.parent / "manifest.json").read_bytes()), self.point)

    def test_native_original_symlinks_are_not_followed(self):
        cached = self.output / "recovery" / f"{self.point['cache_sha256']}.rdb"
        cached.unlink()
        cached.symlink_to(self.rdb)
        self.refuses()
