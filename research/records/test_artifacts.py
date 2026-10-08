"""Custody integrity and recovery boundaries using a small sealed fixture."""

import json
import shutil
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

from research.records.artifacts import ArtifactError
from research.records.artifacts import _files
from research.records.artifacts import _sha
from research.records.artifacts import _check_inputs
from research.records.artifacts import backup
from research.records.artifacts import create_input_identity
from research.records.artifacts import restore
from research.records.artifacts import verify


class ArtifactCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "archive"
        self.run_id = "fixture-1"
        self.seal = self.root / self.run_id
        reports = self.seal / "reports"
        reports.mkdir(parents=True)
        (reports / "orders.csv").write_text("order_id,status\na,FILLED\n")
        manifest = {
            "schema_version": 1,
            "run_id": self.run_id,
            "status": "failed",
            "files": _files(self.seal),
        }
        (self.seal / "manifest.json").write_text(json.dumps(manifest))

    def test_verify_and_restore_preserve_bytes(self):
        self.assertTrue(verify(self.root, self.run_id)["verified"])
        output = Path(self.temp.name) / "recovered" / "reports"
        restore(self.root, self.run_id, output)
        self.assertEqual(
            _sha(output / "orders.csv"), _sha(self.seal / "reports" / "orders.csv")
        )
        with self.assertRaisesRegex(ArtifactError, "already exists"):
            restore(self.root, self.run_id, output)

    def test_backup_can_restore_without_primary(self):
        backup_root = Path(self.temp.name) / "backup"
        backup(self.root, self.run_id, backup_root)
        self.assertEqual(
            _sha(self.root / self.run_id / "manifest.json"),
            _sha(backup_root / self.run_id / "manifest.json"),
        )
        shutil.rmtree(self.root / self.run_id)
        output = Path(self.temp.name) / "from-backup"
        restore(backup_root, self.run_id, output)
        self.assertEqual(
            (output / "orders.csv").read_text(), "order_id,status\na,FILLED\n"
        )

    def test_tampered_or_extra_file_is_rejected(self):
        report = self.seal / "reports" / "orders.csv"
        report.write_text("order_id,status\na,REJECTED\n")
        with self.assertRaisesRegex(ArtifactError, "SHA-256 differs"):
            verify(self.root, self.run_id)
        report.write_text("order_id,status\na,FILLED\n")
        (self.seal / "reports" / "extra.csv").write_text("not registered\n")
        with self.assertRaisesRegex(ArtifactError, "file set"):
            verify(self.root, self.run_id)

    def test_manifest_run_id_is_bound_to_directory(self):
        manifest = json.loads((self.seal / "manifest.json").read_text())
        manifest["run_id"] = "another-run"
        (self.seal / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ArtifactError, "identity mismatch"):
            verify(self.root, self.run_id)

    def test_new_input_identity_detects_catalog_mutation(self):
        minute = Path(self.temp.name) / "minute" / "BTC" / "minute"
        daily = Path(self.temp.name) / "daily" / "BTC" / "daily"
        minute.mkdir(parents=True)
        daily.mkdir(parents=True)
        (minute / "bars.parquet").write_bytes(b"minute")
        (daily / "bars.parquet").write_bytes(b"daily")
        quantity = Path(self.temp.name) / "quantity.csv"
        quantity.write_text("coin,quantity\nBTC,1\n")
        output = Path(self.temp.name) / "identity.json"
        create_input_identity(
            catalog_root=minute.parents[1],
            daily_root=daily.parents[1],
            quantity_csv=quantity,
            coins=["BTC"],
            output=output,
        )
        replay = Namespace(
            catalog_root=minute.parents[1],
            daily_root=daily.parents[1],
            quantity_csv=quantity,
            coins=["BTC"],
        )
        identity = json.loads(output.read_text())
        self.assertEqual(len(_check_inputs(identity, replay)), 1)
        (minute / "bars.parquet").write_bytes(b"changed")
        with self.assertRaisesRegex(ArtifactError, "bytes differ"):
            _check_inputs(identity, replay)


if __name__ == "__main__":
    unittest.main()
